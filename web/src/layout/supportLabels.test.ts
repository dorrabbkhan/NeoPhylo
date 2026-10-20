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

/** Leaf-name box, matching supportLabels' estimate. */
function nameBox(x: number, y: number, label: string): LabelBox {
  return {
    minX: x + NODE_RADIUS + LABEL_OFFSET,
    maxX: x + NODE_RADIUS + LABEL_OFFSET + label.length * NAME_FONT * 0.62,
    minY: y - NAME_FONT / 2 - 2,
    maxY: y + NAME_FONT / 2 + 2,
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
      // Placement contract: the pill ends left of its node marker.
      const node = l.nodes.find((n) => n.id === p.id)!;
      expect(p.box.maxX).toBeLessThanOrEqual(node.x - NODE_RADIUS);
      // …and reads Math.round(100·s), weak here.
      expect(p.text).toBe("30");
      expect(p.weak).toBe(true);
      expect(p.markerX).not.toBeNull();
    }
  });

  it("a second label nudges clear instead of stacking", () => {
    // Same-row labels on the ladder collide without nudging; the later
    // one must move vertically.
    const t = weakLadder();
    const l = layout(t, OPTS);
    const labels = supportLabels(t, l, {
      fontSize: FONT,
      nameFontSize: NAME_FONT,
      nodeRadius: NODE_RADIUS,
      labelOffset: LABEL_OFFSET,
    });
    const [first, second] = labels;
    // Without collision handling both would occupy the preferred row;
    // the resolved boxes must differ in y enough to be disjoint.
    const firstH = first.box.maxY - first.box.minY;
    const secondH = second.box.maxY - second.box.minY;
    expect(firstH).toBeGreaterThan(0);
    expect(secondH).toBeGreaterThan(0);
    expect(
      Math.min(
        Math.abs(first.box.minY - second.box.maxY),
        Math.abs(second.box.minY - first.box.maxY),
      ),
    ).toBeLessThanOrEqual(2);
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
    expect(p.markerX).toBeNull();
    for (const n of l.nodes) {
      expect(hit(p.box, markerBox(n.x, n.y))).toBe(false);
      if (n.leaf && n.label !== null) {
        expect(hit(p.box, nameBox(n.x, n.y, n.label))).toBe(false);
      }
    }
  });
});
