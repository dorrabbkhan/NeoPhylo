// Support-label placement tests (v1.2 spec §6.3; owner checkpoint
// 21-10-26 refined same day). Every support pill sits just above the
// horizontal segment into its node, right-aligned near the node end
// and holding the node's own y — a short segment lets the pill
// overhang LEFT past the segment's start (over the parent's vertical;
// the pill's background masks it). Collisions are checked against
// labels, leaf names and node markers only — never branch lines — and
// resolved by a ≤ 6 px vertical nudge; only a still-blocked spot earns
// a leader line, routed so it crosses no branch.

import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { Tree } from "../engine/generated/Tree";

import { layout, type Layout } from "./phylogram";
import { supportLabels, type LabelBox } from "./supportLabels";
import { treeFigure, FIGURE_DEFAULT_PANEL_WIDTH } from "./treeFigure";

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
 * ~2-unit span — about 1 px at a 400 px width — so both pills must
 * overhang far left past their segment's start. And because the middle
 * node is degree-2 (a single-child wrapper), it shares its child's row:
 * the two pills collide on the same row and the later one earns a
 * leader — the one collision a nudge cannot fix.
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

/**
 * True when point (x, y) lies strictly inside segment s (u ∈ (0, 1)) —
 * the leader-interior crossing check for branch polylines.
 */
function onSegInterior(
  x: number,
  y: number,
  s: { x1: number; y1: number; x2: number; y2: number },
): boolean {
  const dxs = s.x2 - s.x1;
  const dys = s.y2 - s.y1;
  if (Math.abs(dxs) > Math.abs(dys)) {
    const u = (x - s.x1) / dxs;
    return u > 1e-6 && u < 1 - 1e-6 && Math.abs(s.y1 + u * dys - y) < 1e-6;
  }
  const u = dys === 0 ? -1 : (y - s.y1) / dys;
  return u > 1e-6 && u < 1 - 1e-6 && Math.abs(s.x1 + u * dxs - x) < 1e-6;
}

/** The drawn branch polylines, mirroring the renderers: incoming
 * horizontal segments plus vertical connectors. */
function drawnBranches(t: Tree, l: Layout) {
  const byId = new Map(l.nodes.map((n) => [n.id, n]));
  const segs: { x1: number; y1: number; x2: number; y2: number }[] = [];
  for (const n of l.nodes) {
    if (n.parentX !== n.x)
      segs.push({ x1: n.parentX, y1: n.y, x2: n.x, y2: n.y });
    const kids = t.nodes[n.id].children.filter((c) => byId.has(c));
    if (kids.length > 0) {
      const ys = kids.map((c) => byId.get(c)!.y);
      segs.push({
        x1: n.x,
        y1: Math.min(...ys),
        x2: n.x,
        y2: Math.max(...ys),
      });
    }
  }
  return segs;
}

/** Sampled interior of a leader crosses no drawn branch. */
function expectLeaderClear(
  leader: { x1: number; y1: number; x2: number; y2: number },
  segs: { x1: number; y1: number; x2: number; y2: number }[],
) {
  for (let k = 0; k <= 200; k += 1) {
    const t01 = (k / 200) * 0.97; // stay short of the node landing
    const px = leader.x1 + (leader.x2 - leader.x1) * t01;
    const py = leader.y1 + (leader.y2 - leader.y1) * t01;
    for (const s of segs)
      expect(
        onSegInterior(px, py, s),
        `leader crosses ${JSON.stringify(s)} at t=${t01.toFixed(2)}`,
      ).toBe(false);
  }
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
  it("keeps the 12 px stroke floor on supported internal branches", () => {
    const t = weakLadder();
    const unclamped = layout(t, { ...OPTS, minBranchPx: 0 });
    const stretched = layout(t, OPTS);
    const labeled = t.nodes
      .map((n, id) => ({ n, id }))
      .filter(
        ({ n, id }) => n.parent !== null && t.branches[id].support !== null,
      );
    for (const { id } of labeled) {
      const before = unclamped.nodes.find((n) => n.id === id)!;
      const after = stretched.nodes.find((n) => n.id === id)!;
      // Premise: the fixture's labeled branches really are < 10 px.
      expect(before.x - before.parentX).toBeLessThan(10);
      // Display-only floor: the weak-styled stroke stays ≥12 px.
      expect(after.x - after.parentX).toBeGreaterThanOrEqual(12);
    }
  });

  it("right-aligns a free pill just above its node, overhanging left", () => {
    const t = weakLadder();
    const fig = treeFigure(t, FIG_OPTS);
    expect(fig.placed).toHaveLength(2);
    // The first-laid label (the parent's) keeps its row…
    const p = fig.placed[0];
    const n = fig.byId.get(p.id)!;
    const seg = n.x - n.parentX;
    const pillW = p.box.maxX - p.box.minX;
    // …the segment is far shorter than the pill and NOT stretched to
    // fit — the pill overhangs left past its start instead.
    expect(seg).toBeLessThan(pillW);
    expect(p.box.minX).toBeLessThan(n.parentX);
    // Right-aligned: right edge clears the marker by the gap.
    expect(p.box.maxX).toBeCloseTo(n.x - NODE_RADIUS - 1 - 2, 5);
    // Bottom edge just above the segment — 1.75 px of air keeps the
    // centre strictly inside the 10 px bound (BOUND_INSET); no leader.
    expect(p.box.maxY).toBeCloseTo(n.y - 1.75, 5);
    const cy = (p.box.minY + p.box.maxY) / 2;
    expect(Math.abs(cy - n.y)).toBeLessThanOrEqual(10 + 1e-6);
    expect(p.leader).toBeUndefined();
    expect(p.text).toBe("30*");
    expect(p.weak).toBe(true);
    // …the second label is the same-row collision → leader (asserted
    // in the fallback suite).
  });

  it("the nearest incoming segment to each label is its own node's", () => {
    const t = weakLadder();
    const fig = treeFigure(t, FIG_OPTS);
    const segs = fig.laid.nodes.filter((n) => n.parentX !== n.x);
    for (const p of fig.placed) {
      const n = fig.byId.get(p.id)!;
      // Anchor: the pill's bottom centre (leader labels anchor at
      // their line's endpoint on the node).
      const ax = p.leader?.x2 ?? (p.box.minX + p.box.maxX) / 2;
      const ay = p.leader?.y2 ?? p.box.maxY;
      const own = segDist(ax, ay, n.parentX, n.x, n.y);
      for (const m of segs) {
        if (m.id === n.id) continue;
        // Boundary ties allowed: in a same-row chain the anchor can be
        // equidistant from a segment ending where its own begins.
        expect(
          own <= segDist(ax, ay, m.parentX, m.x, m.y) + 1e-9,
          `label ${p.text} on node ${p.id} nearer a segment into ${m.id}`,
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

describe("supportLabels: nudge and leader fallback", () => {
  /**
   * Both internal nodes of ((A,B),(C,D)) moved onto the same row —
   * a dense-cluster stand-in with real layout() geometry underneath.
   */
  function crowded(tweak: (l: Layout, p1: number, p2: number) => void): {
    t: Tree;
    l: Layout;
    p1: number;
    p2: number;
  } {
    const t = parse("((A:1,B:1):0.5,(C:1,D:1):0.5);");
    const internals = t.nodes
      .map((n, id) => ({ n, id }))
      .filter(({ n }) => n.children.length === 2 && n.parent !== null);
    expect(internals.length).toBe(2);
    const [p1, p2] = internals.map(({ id }) => id);
    const l = layout(t, OPTS);
    tweak(l, p1, p2);
    return { t, l, p1, p2 };
  }
  const withSupport = (t: Tree, ids: number[]): Tree => ({
    ...t,
    branches: t.branches.map((b, id) =>
      ids.includes(id) ? { ...b, support: 0.9 } : b,
    ),
  });

  it("a ≤6 px vertical nudge clears a label-vs-marker collision", () => {
    // p2's marker box lands on p1's right-aligned pill zone; p1 must
    // nudge a few px (not slide, not leader) and stay put.
    const { t, l, p1, p2 } = crowded((lay, a, b) => {
      const na = lay.nodes.find((n) => n.id === a)!;
      const nb = lay.nodes.find((n) => n.id === b)!;
      na.x = 60;
      na.y = 20;
      nb.x = 54; // marker box [50,58] reaches the pill's right end
      nb.y = 20;
    });
    const nb = l.nodes.find((n) => n.id === p2)!;
    const labels = supportLabels(withSupport(t, [p1]), l, SL_OPTS);
    expect(labels).toHaveLength(1);
    const p = labels[0];
    expect(p.leader).toBeUndefined();
    // Nudged up 3 px (the six earlier candidates all still touch the
    // marker box; the base raise is now 1.75 under BOUND_INSET).
    expect(p.box.maxY).toBeCloseTo(20 - 1.75 - 3, 5);
    expect(p.box.maxX).toBeCloseTo(60 - NODE_RADIUS - 1 - 2, 5);
    expect(hit(p.box, markerBox(nb.x, nb.y))).toBe(false);
  });

  it("same-row labels that a nudge cannot separate get a leader", () => {
    // weakLadder's two internal nodes share a row: the later label's
    // ±6 px nudge can never clear a same-height pill, so it earns the
    // only kind of leader the convention still allows.
    const t = weakLadder();
    const l = layout(t, OPTS);
    const labels = supportLabels(t, l, SL_OPTS);
    const [first, second] = labels;
    expect(first.leader).toBeUndefined();
    expect(second.leader).toBeDefined();
    const n = l.nodes.find((x) => x.id === second.id)!;
    const leader = second.leader!;
    // From the pill's bottom edge down to the node itself.
    expect(leader.x2).toBeCloseTo(n.x, 5);
    expect(leader.y2).toBeCloseTo(n.y, 5);
    expect(leader.y1).toBeCloseTo(second.box.maxY, 5);
    expect(leader.x1).toBeGreaterThanOrEqual(second.box.minX - 1e-9);
    expect(leader.x1).toBeLessThanOrEqual(second.box.maxX + 1e-9);
    // The offset pill clears the first label and every marker.
    expect(hit(first.box, second.box)).toBe(false);
    for (const m of l.nodes)
      expect(hit(second.box, markerBox(m.x, m.y))).toBe(false);
    // And the leader is routed without crossing any branch.
    expectLeaderClear(leader, drawnBranches(t, l));
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
