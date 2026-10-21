// Support-label placement tests (v1.2 plan Task 11, spec §6.3;
// checkpoint 11 fixes). The fixture is a ladder whose two internal
// branches draw under 10 px wide and whose labeled nodes share a row —
// the worst case the collision rule exists for. Every support pill
// must stay clear of node markers, leaf names, "0" markers and the
// other pills, and the labeled branches must stretch to ≥12 px.

import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { Tree } from "../engine/generated/Tree";

import { layout } from "./phylogram";
import { supportLabels, type LabelBox } from "./supportLabels";
import {
  treeFigure,
  FIGURE_DEFAULT_PANEL_WIDTH,
  FIGURE_NODE_RADIUS,
} from "./treeFigure";

function parse(nwk: string): Tree {
  const r = engine.parseNewick(nwk);
  if (!r.ok) throw new Error(`parseNewick failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

const FONT = 12;
const NAME_FONT = 14;
const NODE_RADIUS = 3;
const LABEL_OFFSET = 4;
const OPTS = {
  kind: "phylogram" as const,
  clampNegative: false,
  leafSpacing: 20,
  width: 400,
  minBranchPx: 12,
};

/**
 * (((A:1,B:1):0.005):0.005,C:2): the two internal edges are 0.005 of a
 * ~2-unit span — about 1 px at a 400 px width — and both internal nodes
 * sit at y of the (A,B) midpoint, i.e. the same row. Both carry weak
 * support.
 */
function weakLadder(): Tree {
  const t = parse("(((A:1,B:1):0.005):0.005,C:2);");
  const internal = t.nodes
    .map((n, id) => ({ n, id }))
    .filter(({ n }) => n.children.length > 0 && n.parent !== null);
  expect(internal.length).toBe(2);
  const branches = t.branches.map((b, id) =>
    internal.some(({ id: i }) => i === id) ? { ...b, support: 0.3 } : b,
  );
  return { ...t, branches };
}

function hit(a: LabelBox, b: LabelBox): boolean {
  return (
    a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
  );
}

/** Marker box for a node, matching supportLabels' obstacle padding. */
function markerBox(x: number, y: number): LabelBox {
  const r = NODE_RADIUS + 1;
  return { minX: x - r, maxX: x + r, minY: y - r, maxY: y + r };
}

/** Leaf-name box, matching supportLabels' (asymmetric) estimate. */
function nameBox(
  x: number,
  y: number,
  label: string,
  font: number = NAME_FONT,
): LabelBox {
  return {
    minX: x + NODE_RADIUS + LABEL_OFFSET,
    maxX: x + NODE_RADIUS + LABEL_OFFSET + label.length * font * 0.62,
    minY: y - font - 2,
    maxY: y + font * 0.5 + 2,
  };
}

describe("supportLabels (checkpoint 11)", () => {
  it("stretches support-carrying internal branches to ≥12 px", () => {
    const t = weakLadder();
    const unclamped = layout(t, { ...OPTS, minBranchPx: 0 });
    const stretched = layout(t, OPTS);
    const labeled = t.nodes
      .map((n, id) => ({ n, id }))
      .filter(({ n, id }) => n.parent !== null && t.branches[id].support !== null);
    for (const { id } of labeled) {
      const before = unclamped.nodes.find((n) => n.id === id)!;
      const after = stretched.nodes.find((n) => n.id === id)!;
      // Premise: the fixture's labeled branches really are < 10 px.
      expect(before.x - before.parentX).toBeLessThan(10);
      // Display-only stretch: the branch draws at least 12 px wide.
      expect(after.x - after.parentX).toBeGreaterThanOrEqual(12);
    }
  });

  it("no pill intersects a node marker, a leaf name or another pill", () => {
    const t = weakLadder();
    const l = layout(t, OPTS);
    const labels = supportLabels(t, l, {
      fontSize: FONT,
      nameFontSize: NAME_FONT,
      nodeRadius: NODE_RADIUS,
      labelOffset: LABEL_OFFSET,
    });
    expect(labels.length).toBe(2);

    for (const p of labels) {
      for (const n of l.nodes) {
        expect(
          hit(p.box, markerBox(n.x, n.y)),
          `pill on node ${p.id} vs marker ${n.id}`,
        ).toBe(false);
        if (n.leaf && n.label !== null) {
          expect(
            hit(p.box, nameBox(n.x, n.y, n.label)),
            `pill on node ${p.id} vs leaf name ${n.label}`,
          ).toBe(false);
        }
      }
      for (const q of labels) {
        if (q.id === p.id) continue;
        expect(
          hit(p.box, q.box),
          `pills on nodes ${p.id} and ${q.id}`,
        ).toBe(false);
      }
      // Placement contract (checkpoint 15): the pill lands RIGHT of
      // its node when that space is free — this fixture leaves it free,
      // so that is what is asserted here — and LEFT over the incoming
      // branch only when the right candidates collide (the blockedRight
      // fixture below covers that). In every case the box lies inside
      // the figure's content bounds, which the renderers pad into the
      // SVG viewBox.
      const node = l.nodes.find((n) => n.id === p.id)!;
      expect(p.box.minX).toBeGreaterThanOrEqual(node.x + NODE_RADIUS);
      // …and reads the full value, "*" merged in for weak support.
      expect(p.text).toBe("30*");
      expect(p.weak).toBe(true);
      // The pill is wide enough for its text (≥ 0.5 em per character).
      const w = p.box.maxX - p.box.minX;
      expect(w).toBeGreaterThanOrEqual(p.text.length * 0.5 * FONT);
    }
  });

  it("a second label takes another in-reach spot instead of stacking", () => {
    // Same-row labels on the ladder collide on the preferred spot; the
    // later one must move to a disjoint box still adjacent to its own
    // node (checkpoint 15: candidates keep labels within ~30 px rather
    // than climbing a staircase).
    const t = weakLadder();
    const l = layout(t, OPTS);
    const labels = supportLabels(t, l, {
      fontSize: FONT,
      nameFontSize: NAME_FONT,
      nodeRadius: NODE_RADIUS,
      labelOffset: LABEL_OFFSET,
    });
    const [first, second] = labels;
    expect(first.box.maxY - first.box.minY).toBeGreaterThan(0);
    expect(second.box.maxY - second.box.minY).toBeGreaterThan(0);
    // Disjoint boxes…
    expect(hit(first.box, second.box)).toBe(false);
    // …and each still within 30 px of its node (anchor distance).
    for (const p of labels) {
      const n = l.nodes.find((x) => x.id === p.id)!;
      const d = Math.hypot(
        (p.box.minX + p.box.maxX) / 2 - n.x,
        (p.box.minY + p.box.maxY) / 2 - n.y,
      );
      expect(d, `pill on node ${p.id}`).toBeLessThanOrEqual(30);
    }
  });

  it("places the label LEFT of the node when the right side is occupied", () => {
    // ((A:0.01,B:0.005):1.5,C:3): A and B sit one and two rows around
    // the labeled node with near-zero terminal branches, so their leaf
    // names cover BOTH right-side candidate spots. The branch into the
    // node is long, leaving the left spots over the incoming branch
    // clear — placement must take one of them (checkpoint 15).
    const t = parse("((A:0.01,B:0.005):1.5,C:3);");
    const withSupport = {
      ...t,
      branches: t.branches.map((b, id) =>
        t.nodes[id].children.length > 0 && t.nodes[id].parent !== null
          ? { ...b, support: 0.47 }
          : b,
      ),
    };
    const fig = treeFigure(withSupport, {
      kind: "phylogram",
      clampNegative: false,
      leafSpacing: 20,
      panelWidth: FIGURE_DEFAULT_PANEL_WIDTH,
    });
    expect(fig.placed).toHaveLength(1);
    const p = fig.placed[0];
    const node = fig.byId.get(p.id)!;

    // Premise: the preferred right-above spot really is occupied by
    // A's name (B's name covers right-below), so a right placement is
    // impossible here.
    const pillW = p.box.maxX - p.box.minX;
    const pillH = p.box.maxY - p.box.minY;
    const rightAbove: LabelBox = {
      minX: node.x + FIGURE_NODE_RADIUS + 2,
      maxX: node.x + FIGURE_NODE_RADIUS + 2 + pillW,
      minY: node.y - FIGURE_NODE_RADIUS - 2 - pillH,
      maxY: node.y - FIGURE_NODE_RADIUS - 2,
    };
    const aNode = fig.laid.nodes.find((n) => n.label === "A")!;
    expect(
      hit(rightAbove, nameBox(aNode.x, aNode.y, "A", fig.fontSize)),
      "fixture premise: the right-above spot must be occupied",
    ).toBe(true);

    // The pill hangs LEFT of the node, over the incoming branch…
    expect(p.box.maxX).toBeLessThanOrEqual(node.x - FIGURE_NODE_RADIUS);
    // …within the 30 px reach, full text intact…
    const anchor = Math.hypot(
      (p.box.minX + p.box.maxX) / 2 - node.x,
      (p.box.minY + p.box.maxY) / 2 - node.y,
    );
    expect(anchor).toBeLessThanOrEqual(30);
    expect(p.text).toBe("47*");
    expect(p.weak).toBe(true);
    // …fully inside the fitted content bounds (the old fixed viewBox
    // clipped left-hanging pills at x = 0)…
    expect(p.box.minX).toBeGreaterThanOrEqual(fig.bounds.minX);
    expect(p.box.maxX).toBeLessThanOrEqual(fig.bounds.maxX);
    expect(p.box.minY).toBeGreaterThanOrEqual(fig.bounds.minY);
    expect(p.box.maxY).toBeLessThanOrEqual(fig.bounds.maxY);
    // …and clear of every marker and leaf name.
    for (const n of fig.laid.nodes) {
      expect(
        hit(p.box, markerBox(n.x, n.y)),
        `left pill vs marker ${n.id}`,
      ).toBe(false);
      if (n.leaf && n.label !== null) {
        expect(
          hit(p.box, nameBox(n.x, n.y, n.label, fig.fontSize)),
          `left pill vs leaf name ${n.label}`,
        ).toBe(false);
      }
    }
  });

  it("no support values → no labels and no name hiding", () => {
    const t = parse("((A:1,B:1):1,C:2);");
    const l = layout(t, OPTS);
    const labels = supportLabels(t, l, {
      fontSize: FONT,
      nameFontSize: NAME_FONT,
      nodeRadius: NODE_RADIUS,
      labelOffset: LABEL_OFFSET,
    });
    expect(labels).toHaveLength(0);
  });

  it("labels on a rerooted degree-2 root stay clear too", () => {
    // The degree-2 root (two children, one the labeled edge) is the
    // shape §6.7's reroot produces; the label must clear both the new
    // root marker and the leaf names around it.
    const t = parse("((A:0.5,B:0.5):0.25,C:0.25);");
    const withSupport = {
      ...t,
      branches: t.branches.map((b, id) =>
        t.nodes[id].children.length > 0 && t.nodes[id].parent !== null
          ? { ...b, support: 0.9 }
          : b,
      ),
    };
    const l = layout(withSupport, OPTS);
    const labels = supportLabels(withSupport, l, {
      fontSize: FONT,
      nameFontSize: NAME_FONT,
      nodeRadius: NODE_RADIUS,
      labelOffset: LABEL_OFFSET,
    });
    expect(labels.length).toBe(1);
    const p = labels[0];
    expect(p.text).toBe("90");
    expect(p.weak).toBe(false);
    for (const n of l.nodes) {
      expect(hit(p.box, markerBox(n.x, n.y))).toBe(false);
      if (n.leaf && n.label !== null) {
        expect(hit(p.box, nameBox(n.x, n.y, n.label))).toBe(false);
      }
    }
  });
});
