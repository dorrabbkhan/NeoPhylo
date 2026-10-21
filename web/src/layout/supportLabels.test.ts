// Support-label placement tests (v1.2 spec §6.3; owner checkpoint:
// labels must sit above the segment into their node, not float between
// nodes). Every support pill is drawn centred just above the
// horizontal segment that leads into its node and right-aligned near
// the node end — so for every label the nearest incoming segment is
// unambiguously its own. A segment too short for the pill is stretched
// (display-only) unless the stretch would exceed 20% of the drawing
// width; then the label is drawn offset with a leader line to the
// node. In every case a pill stays clear of node markers, leaf names,
// "0" markers and other pills, and lies inside the content bounds that
// become the fitted viewBox.

import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { Tree } from "../engine/generated/Tree";

import { layout } from "./phylogram";
import {
  supportLabels,
  segFitPx,
  type LabelBox,
} from "./supportLabels";
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

/** Point→horizontal-segment distance (the incoming branch of a node). */
function segDist(
  px: number,
  py: number,
  x1: number,
  x2: number,
  y: number,
): number {
  const lo = Math.min(x1, x2);
  const hi = Math.max(x1, x2);
  const dx = px < lo ? lo - px : px > hi ? px - hi : 0;
  return Math.hypot(dx, py - y);
}

const SL_OPTS = {
  fontSize: FONT,
  nameFontSize: NAME_FONT,
  nodeRadius: NODE_RADIUS,
  labelOffset: LABEL_OFFSET,
};

const FIG_OPTS = {
  kind: "phylogram" as const,
  clampNegative: false,
  leafSpacing: 20,
  panelWidth: FIGURE_DEFAULT_PANEL_WIDTH,
};

describe("supportLabels: on-segment placement", () => {
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

  it("draws each supported edge ≥ its label's fit width, or uses a leader", () => {
    const t = weakLadder();
    const fig = treeFigure(t, FIG_OPTS);
    for (const p of fig.placed) {
      const n = fig.byId.get(p.id)!;
      const seg = n.x - n.parentX;
      const fit = segFitPx(p.text, fig.smallFont, FIGURE_NODE_RADIUS);
      // At the default panel width the 20% cap never binds: every
      // segment is extended until it holds its pill.
      expect(p.leader).toBeUndefined();
      expect(seg, `edge into node ${p.id}`).toBeGreaterThanOrEqual(fit - 0.5);
    }
  });

  it("places each pill just above its own incoming segment, right-aligned", () => {
    const t = weakLadder();
    const fig = treeFigure(t, FIG_OPTS);
    expect(fig.placed).toHaveLength(2);
    for (const p of fig.placed) {
      const n = fig.byId.get(p.id)!;
      // Right-aligned near the node end: the right edge clears the
      // marker box by the gap (markerR + 1 + GAP = 6 px left of x).
      expect(p.box.maxX).toBeCloseTo(n.x - NODE_RADIUS - 1 - 2, 5);
      // Centred just above the segment: bottom edge one gap over the
      // line at the node's row.
      expect(p.box.maxY).toBeCloseTo(n.y - 2, 5);
      // The whole pill lies over its own segment [parentX, x).
      expect(p.box.minX).toBeGreaterThanOrEqual(n.parentX);
      expect(p.box.maxX).toBeLessThanOrEqual(n.x);
      // Full text, "*" merged in for weak support.
      expect(p.text).toBe("30*");
      expect(p.weak).toBe(true);
    }
  });

  it("the nearest incoming segment to each label is its own node's", () => {
    const t = weakLadder();
    const fig = treeFigure(t, FIG_OPTS);
    // Every node with a visible parent owns a horizontal segment.
    const segs = fig.laid.nodes.filter((n) => n.parentX !== n.x);
    for (const p of fig.placed) {
      const n = fig.byId.get(p.id)!;
      // The label's anchor: its pill's bottom centre, or the leader's
      // endpoint at the node when it is drawn as a callout.
      const ax = p.leader?.x2 ?? (p.box.minX + p.box.maxX) / 2;
      const ay = p.leader?.y2 ?? p.box.maxY;
      const own = segDist(ax, ay, n.parentX, n.x, n.y);
      for (const m of segs) {
        if (m.id === n.id) continue;
        const other = segDist(ax, ay, m.parentX, m.x, m.y);
        expect(
          own < other,
          `label ${p.text} on node ${p.id}: own ${own.toFixed(1)} vs ` +
            `segment into ${m.id} ${other.toFixed(1)}`,
        ).toBe(true);
      }
    }
  });

  it("no pill intersects a node marker, a leaf name or another pill", () => {
    const t = weakLadder();
    const l = layout(t, OPTS);
    const labels = supportLabels(t, l, SL_OPTS);
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
      // The pill is wide enough for its text (≥ 0.5 em per character).
      const w = p.box.maxX - p.box.minX;
      expect(w).toBeGreaterThanOrEqual(p.text.length * 0.5 * FONT);
    }
  });

  it("every label box lies inside the fitted content bounds", () => {
    const t = weakLadder();
    const fig = treeFigure(t, FIG_OPTS);
    for (const p of fig.placed) {
      expect(p.box.minX).toBeGreaterThanOrEqual(fig.bounds.minX);
      expect(p.box.maxX).toBeLessThanOrEqual(fig.bounds.maxX);
      expect(p.box.minY).toBeGreaterThanOrEqual(fig.bounds.minY);
      expect(p.box.maxY).toBeLessThanOrEqual(fig.bounds.maxY);
    }
  });
});

describe("supportLabels: leader offset (20% stretch cap)", () => {
  it("offsets the pill with a leader when stretching would distort >20%", () => {
    const t = weakLadder();
    // A 120 px panel leaves ~80 px of draw width; the cap is ~16 px
    // while each pill needs ~42 — the stretch is refused and both
    // labels become leader callouts.
    const fig = treeFigure(t, { ...FIG_OPTS, panelWidth: 120 });
    expect(fig.placed).toHaveLength(2);
    for (const p of fig.placed) {
      const n = fig.byId.get(p.id)!;
      const fit = segFitPx(p.text, fig.smallFont, FIGURE_NODE_RADIUS);
      // The segment stayed short (floor stretch only)…
      expect(n.x - n.parentX).toBeLessThan(fit - 0.5);
      // …the pill is offset (no longer in the just-above-the-segment
      // band) but still hangs over its own node end…
      expect(p.leader).toBeDefined();
      expect(p.box.maxX).toBeLessThanOrEqual(n.x);
      expect(p.box.maxY).toBeLessThan(n.y - fig.smallFont);
      // …and the leader runs from the pill's bottom centre down to
      // the node itself.
      const leader = p.leader!;
      expect(leader.x1).toBeCloseTo((p.box.minX + p.box.maxX) / 2, 5);
      expect(leader.y1).toBeCloseTo(p.box.maxY, 5);
      expect(leader.x2).toBeCloseTo(n.x, 5);
      expect(leader.y2).toBeCloseTo(n.y, 5);
      // In bounds, and clear of markers and names.
      expect(p.box.minX).toBeGreaterThanOrEqual(fig.bounds.minX);
      expect(p.box.maxX).toBeLessThanOrEqual(fig.bounds.maxX);
      expect(p.box.minY).toBeGreaterThanOrEqual(fig.bounds.minY);
      expect(p.box.maxY).toBeLessThanOrEqual(fig.bounds.maxY);
      for (const m of fig.laid.nodes) {
        expect(hit(p.box, markerBox(m.x, m.y)), `leader pill vs marker ${m.id}`).toBe(false);
        if (m.leaf && m.label !== null) {
          expect(
            hit(p.box, nameBox(m.x, m.y, m.label, fig.fontSize)),
            `leader pill vs leaf name ${m.label}`,
          ).toBe(false);
        }
      }
    }
    // The two leader pills are disjoint from each other.
    expect(hit(fig.placed[0].box, fig.placed[1].box)).toBe(false);
    // Association stays explicit: each leader endpoint sits on its
    // own segment (distance 0). In a same-row chain the node point is
    // also its child's segment start — a boundary tie, not ambiguity,
    // since the line lands on the node marker itself — hence ≤.
    const segs = fig.laid.nodes.filter((n) => n.parentX !== n.x);
    for (const p of fig.placed) {
      const n = fig.byId.get(p.id)!;
      const own = segDist(p.leader!.x2, p.leader!.y2, n.parentX, n.x, n.y);
      for (const m of segs) {
        if (m.id === n.id) continue;
        expect(
          own <=
            segDist(p.leader!.x2, p.leader!.y2, m.parentX, m.x, m.y) +
              1e-9,
          `leader on node ${p.id} nearer a segment into ${m.id}`,
        ).toBe(true);
      }
    }
  });
});

describe("supportLabels: misc", () => {
  it("no support values → no labels and no name hiding", () => {
    const t = parse("((A:1,B:1):1,C:2);");
    const l = layout(t, OPTS);
    const labels = supportLabels(t, l, SL_OPTS);
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
    const labels = supportLabels(withSupport, l, SL_OPTS);
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
