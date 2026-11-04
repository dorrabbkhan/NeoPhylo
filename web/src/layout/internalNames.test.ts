// Highlighted internal-node name placement (owner-requested rendering
// follow-up on PR #139): the u1/u2/… step names used to be drawn
// unconditionally right of their node, so a name could sit on a child
// marker on the same row (the globins NJ run's u20 ended on top of the
// Cow_HBB leaf marker) or on another name. Names are now placed
// against the same obstacle set the support pills avoid — node
// markers, leaf names, "0" markers and already-placed names — first
// nudged vertically off the row, then mirrored to the node's left,
// and only then climbed above the figure on a leader. Branch lines
// and connectors are deliberately NOT obstacles: the halo plate
// behind each name masks them, the same convention as the pills.

import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { Tree } from "../engine/generated/Tree";

import type { LabelBox } from "./labelCollision";
import {
  FIGURE_LABEL_OFFSET,
  FIGURE_NODE_RADIUS,
  treeFigure,
  type TreeFigure,
} from "./treeFigure";

function parse(nwk: string): Tree {
  const r = engine.parseNewick(nwk);
  if (!r.ok) throw new Error(`parseNewick failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

const FIG = {
  kind: "phylogram" as const,
  clampNegative: false,
  leafSpacing: 20,
  panelWidth: 400,
};

function hit(a: LabelBox, b: LabelBox): boolean {
  return (
    a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
  );
}

/** Marker obstacle box, matching the layout's padding. */
function markerBox(x: number, y: number): LabelBox {
  const r = FIGURE_NODE_RADIUS + 1;
  return { minX: x - r, maxX: x + r, minY: y - r, maxY: y + r };
}

/** Leaf-name obstacle box (jsdom runs the estimate path: 0.62 em per
 * char, the same asymmetric vertical extents the layout uses). */
function leafNameBox(
  x: number,
  y: number,
  label: string,
  font: number,
): LabelBox {
  return {
    minX: x + FIGURE_NODE_RADIUS + FIGURE_LABEL_OFFSET,
    maxX:
      x +
      FIGURE_NODE_RADIUS +
      FIGURE_LABEL_OFFSET +
      label.length * font * 0.62,
    minY: y - font - 2,
    maxY: y + font * 0.5 + 2,
  };
}

/** Zero-length "0" marker obstacle box, matching the box
 * labelCollision.ts builds: centred on the branch's midpoint,
 * alphabetic-baseline extents + NAME_PAD (jsdom takes the estimate
 * path — "0" is one 0.62 em char with top −fontSize, bottom 0). */
function zeroMarkerBox(
  parentX: number,
  x: number,
  y: number,
  smallFont: number,
): LabelBox {
  const mid = (parentX + x) / 2;
  const w = smallFont * 0.62 + 4;
  return {
    minX: mid - w / 2,
    maxX: mid + w / 2,
    minY: y - 4 - smallFont - 2,
    maxY: y - 4 + 2,
  };
}

/** Every internal node id in the arena. */
function internalIds(t: Tree): Set<number> {
  const out = new Set<number>();
  t.nodes.forEach((n, id) => {
    if (n.children.length > 0) out.add(id);
  });
  return out;
}

/** The placement invariant: no name box may intersect a node marker,
 * a leaf name, a "0" marker or another name box. */
function expectNamesClear(t: Tree, fig: TreeFigure): void {
  const obstacles: LabelBox[] = [];
  for (const n of fig.laid.nodes) {
    obstacles.push(markerBox(n.x, n.y));
    if (n.leaf && n.label !== null) {
      obstacles.push(leafNameBox(n.x, n.y, n.label, fig.fontSize));
    }
    const parent = t.nodes[n.id].parent;
    if (
      parent !== null &&
      fig.byId.has(parent) &&
      t.branches[n.id].length === 0
    ) {
      obstacles.push(zeroMarkerBox(n.parentX, n.x, n.y, fig.smallFont));
    }
  }
  const names = [...fig.nameById.values()];
  for (const nm of names) {
    for (const o of obstacles) {
      expect(
        hit(nm.box, o),
        `${nm.text}'s plate hits a marker, leaf name or "0" marker`,
      ).toBe(false);
    }
    for (const other of names) {
      if (other.id !== nm.id) {
        expect(
          hit(nm.box, other.box),
          `${nm.text}'s plate hits ${other.text}'s plate`,
        ).toBe(false);
      }
    }
  }
}

describe("internalNames placement", () => {
  it("places a name on every highlighted internal node, leaves alone", () => {
    const t = parse("((A:1,B:1):1,(C:1,D:1):1);");
    const fig = treeFigure(t, { ...FIG, highlight: internalIds(t) });
    expect(fig.nameById.size).toBe(3);
    for (const [id, nm] of fig.nameById) {
      expect(t.nodes[id].children.length).toBeGreaterThan(0);
      expect(nm.text).toMatch(/^u\d+$/);
    }
  });

  it("keeps the resting spot right of the node when it is free", () => {
    const t = parse("((A:1,B:1):1,(C:1,D:1):1);");
    const fig = treeFigure(t, { ...FIG, highlight: internalIds(t) });
    for (const [id, nm] of fig.nameById) {
      const n = fig.byId.get(id)!;
      // The resting plate: text starts marker+offset right of the
      // node, vertically centered on its row — the pre-fix anchor.
      expect(nm.anchor).toBe("start");
      expect(nm.textX).toBeCloseTo(
        n.x + FIGURE_NODE_RADIUS + FIGURE_LABEL_OFFSET,
        6,
      );
      expect(nm.textY).toBeCloseTo(n.y, 6);
      expect(nm.leader).toBeUndefined();
    }
  });

  it("moves a name off a child marker on its row (the globins u20 case)", () => {
    // ((X,C),D): the shallow leaf C sits just under the root's row on
    // a near-zero branch, so the root's name at its resting spot lands
    // on C's marker — the same shape as globins NJ's u20/Cow_HBB.
    const t = parse("((X:0.001,C:0.05):0.001,D:1);");
    const fig = treeFigure(t, { ...FIG, highlight: internalIds(t) });
    expectNamesClear(t, fig);
    const root = fig.laid.nodes.find(
      (n) => !n.leaf && t.nodes[n.id].parent === null,
    )!;
    const nm = fig.nameById.get(root.id)!;
    // It did move — the resting spot is blocked.
    const restingMinX =
      root.x + FIGURE_NODE_RADIUS + FIGURE_LABEL_OFFSET - 3;
    expect(
      nm.anchor !== "start" || Math.abs(nm.box.minX - restingMinX) > 1e-9 ||
        Math.abs(nm.textY - root.y) > 1e-9,
      "the colliding name still sits at its resting spot",
    ).toBe(true);
  });

  it("names stay clear of each other on adjacent rows", () => {
    // Pectinate, near-zero internal edges: the four u-names' resting
    // boxes all sit at nearly the same x on rows 10 px apart — they
    // cannot all keep the row.
    const t = parse(
      "((((A:1,B:1):0.001,C:1):0.001,D:1):0.001,E:1);",
    );
    const fig = treeFigure(t, { ...FIG, highlight: internalIds(t) });
    expectNamesClear(t, fig);
  });

  it("names avoid the zero-length '0' markers too", () => {
    const t = parse("((A:1,B:0):1,C:1);");
    const fig = treeFigure(t, { ...FIG, highlight: internalIds(t) });
    expectNamesClear(t, fig);
  });

  it("clears in a cladogram the same way", () => {
    const t = parse("((X:0.001,C:0.05):0.001,D:1);");
    const fig = treeFigure(t, {
      ...FIG,
      kind: "cladogram",
      highlight: internalIds(t),
    });
    expectNamesClear(t, fig);
  });

  it("only names visible nodes while stepping a trace", () => {
    const t = parse("((A:1,B:1):1,(C:1,D:1):1);");
    const visible = new Set(fig0LeafAndRootIds(t));
    const fig = treeFigure(t, {
      ...FIG,
      highlight: internalIds(t),
      visibleNodes: visible,
    });
    for (const id of fig.nameById.keys()) {
      expect(visible.has(id)).toBe(true);
    }
  });
});

/** The leaves plus the root — one visible internal node only. */
function fig0LeafAndRootIds(t: Tree): number[] {
  const out: number[] = [];
  t.nodes.forEach((n, id) => {
    if (n.children.length === 0 || n.parent === null) out.push(id);
  });
  return out;
}
