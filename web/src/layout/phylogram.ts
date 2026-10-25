// Rectangular tree layout (spec §6.1, plan Task 14). Pure functions, kept
// separate from rendering: the same output feeds the on-screen SVG and the
// export pipeline. No engine math lives here — branch lengths are taken
// verbatim from the `Tree` arena produced by `neophylo-core`.
//
// Conventions:
// - `x` is the cumulative root-to-node branch length times `scale` for a
//   phylogram, or the depth (edge count) times `scale` for a cladogram.
//   In a cladogram all leaves are aligned at the right edge.
// - `scale` is pixels per unit, chosen so the laid-out span covers exactly
//   `width`. It is 0 for a zero-length tree, keeping every x at 0.
// - In a phylogram with `clampNegative` off, a negative branch can push a
//   cumulative position below 0. Positions are scaled over
//   `maxCum - minCum` and shifted so the minimum x is 0 — no node ever
//   draws left of the canvas. Cladogram depths are never negative, so
//   the shift is not applied there.
// - Leaves are spaced `leafSpacing` apart in preorder; leaf i sits at
//   (i + 0.5) * leafSpacing, so `height` is leafCount * leafSpacing.
// - Internal nodes sit at the vertical midpoint of their outermost children.
// - `parentX` is the parent's x, i.e. where the vertical elbow segment sits.
//   A node with no visible parent has `parentX === x`, so no stub is drawn.
// - `visibleNodes` restricts output to a subset (used while stepping through
//   a trace). Positions are always computed on the full tree first — a
//   node keeps the same x and y at every step — and hidden nodes are
//   omitted from the result, never re-laid out.
// - `minBranchPx` (display-only, checkpoint 11) stretches internal branches
//   that carry a support value to at least that many drawn pixels, so a
//   weak branch's thinner stroke stays visible on very short edges. It is
//   a flat floor, not a fit: labels overhang short segments leftward
//   rather than stretching them (refinement 21-10-26). The extra width is
//   a shift inherited by the whole subtree: a node's drawn branch grows
//   by its own stretch only, and positions stay stable across steps.
//   When the accumulated stretch would push the deepest node past
//   `opts.width`, `scale` shrinks until tree and stretch fit together
//   (owner decision 3A — that overrun is what clipped leaf labels
//   behind the panel's scroll). Only a tree whose flat minPx floors
//   alone exceed `width` still overflows, leaving the panel to scroll.

import type { Tree } from "../engine/generated/Tree";

export interface LaidOutNode {
  id: number;
  x: number;
  y: number;
  parentX: number;
  label: string | null;
  leaf: boolean;
  negative: boolean;
}

export interface Layout {
  nodes: LaidOutNode[];
  width: number;
  height: number;
  scale: number;
}

export interface LayoutOptions {
  kind: "phylogram" | "cladogram";
  clampNegative: boolean;
  leafSpacing: number;
  width: number;
  visibleNodes?: Set<number>;
  /** Display-only minimum drawn length (px) for internal branches that
   * carry a support value; 0/omitted disables the stretch. */
  minBranchPx?: number;
}

export function layout(tree: Tree, opts: LayoutOptions): Layout {
  const visible = opts.visibleNodes;
  const isVisible = (id: number): boolean => !visible || visible.has(id);

  // Positions come from the full tree; visibility only decides which nodes
  // are emitted afterwards.
  const cum = new Map<number, number>();
  const y = new Map<number, number>();
  const order: number[] = [];
  let leafCount = 0;
  let maxCum = 0;
  let minCum = 0;

  const visit = (id: number, parentCum: number, isRoot: boolean): void => {
    const len = tree.branches[id].length;
    let edge = 0;
    if (!isRoot) {
      edge = opts.kind === "cladogram" ? 1 : (len ?? 0);
      if (opts.clampNegative && edge < 0) edge = 0;
    }
    const here = parentCum + edge;
    if (here > maxCum) maxCum = here;
    if (here < minCum) minCum = here;
    cum.set(id, here);
    order.push(id);

    const kids = tree.nodes[id].children;
    if (kids.length === 0) {
      y.set(id, (leafCount + 0.5) * opts.leafSpacing);
      leafCount += 1;
      return;
    }
    for (const k of kids) {
      visit(k, here, false);
    }
    y.set(id, (y.get(kids[0])! + y.get(kids[kids.length - 1])!) / 2);
  };
  visit(tree.root, 0, true);

  // Phylogram only: shift by the minimum cumulative position so an
  // unclamped negative branch cannot push any node left of x = 0.
  // Cladogram depths are non-negative, so base is always 0 there.
  const base = opts.kind === "phylogram" ? minCum : 0;
  const span = maxCum - base;
  let scale = span > 0 ? opts.width / span : 0;

  // Support-label branches get a display-only minimum drawn length
  // (minBranchPx). `shift` accumulates each node's own stretch plus its
  // ancestors': a branch's drawn length grows by exactly its own stretch
  // because the parent's shift cancels. Computed over the full tree —
  // visibility changes nothing, so positions stay stable across steps.
  const minPx = opts.minBranchPx ?? 0;
  const shift = new Map<number, number>();

  // (Re)fill `shift` at scale `s` and return the deepest drawn x over
  // the same node set the emit step produces — cladogram tips at their
  // aligned cum included. A node's drawn x is (cum − base)·s plus
  // Σ max(0, minPx − e·s) over its support-carrying ancestors, which is
  // continuous and non-decreasing in s (a stretched edge draws exactly
  // minPx whatever the scale), so fitting the stretch inside `width`
  // is a monotone bisection on the scale below.
  const extentAt = (s: number): number => {
    for (const id of order) {
      const parent = tree.nodes[id].parent;
      if (parent === null) {
        shift.set(id, 0);
        continue;
      }
      let extra = 0;
      if (
        tree.branches[id].support !== null &&
        tree.nodes[id].children.length > 0
      ) {
        const edgePx = (cum.get(id)! - cum.get(parent)!) * s;
        extra = Math.max(0, minPx - edgePx);
      }
      shift.set(id, (shift.get(parent) ?? 0) + extra);
    }
    let deepest = 0;
    for (const id of order) {
      if (!isVisible(id)) continue;
      const leaf = !tree.nodes[id].children.some(isVisible);
      const ownCum =
        opts.kind === "cladogram" && leaf ? maxCum : cum.get(id)!;
      const x = (ownCum - base) * s + (shift.get(id) ?? 0);
      if (x > deepest) deepest = x;
    }
    return deepest;
  };

  if (minPx > 0) {
    // The stretch can push the deepest node past `opts.width` — the
    // accumulated shift used to just grow the drawing, which is what
    // clipped leaf names behind the canvas's scroll (owner decision
    // 3A). Shrink the scale until tree plus stretch fit: the scale
    // then comes from (width − accumulated stretch on the deepest
    // path). Only when even the flat minPx floors can't fit does the
    // drawing stay wider than `width` — the panel's horizontal scroll
    // exists for that case.
    if (extentAt(scale) > opts.width && extentAt(0) <= opts.width) {
      let lo = 0;
      let hi = scale;
      for (let i = 0; i < 48 && hi - lo > 1e-9; i += 1) {
        const mid = (lo + hi) / 2;
        if (extentAt(mid) <= opts.width) lo = mid;
        else hi = mid;
      }
      scale = lo;
    }
    // Leave `shift` filled at the final scale for the emit step.
    extentAt(scale);
  }
  const sh = (id: number): number => shift.get(id) ?? 0;

  const nodes: LaidOutNode[] = order.filter(isVisible).map((id) => {
    const parent = tree.nodes[id].parent;
    const hasVisibleParent = parent !== null && isVisible(parent);
    const isLeaf = !tree.nodes[id].children.some(isVisible);
    // Cladogram: tips align at the right edge regardless of their depth.
    const ownCum = opts.kind === "cladogram" && isLeaf ? maxCum : cum.get(id)!;
    const x = (ownCum - base) * scale + sh(id);
    const parentX = hasVisibleParent
      ? (cum.get(parent)! - base) * scale + sh(parent)
      : x;
    const len = tree.branches[id].length;
    return {
      id,
      x,
      y: y.get(id)!,
      parentX,
      label: tree.nodes[id].label,
      leaf: isLeaf,
      negative: hasVisibleParent && len !== null && len < 0,
    };
  });

  // A cladogram's tips still share one x after stretching: ancestors'
  // shifts differ per leaf, so every tip gets the maximum leaf shift.
  if (minPx > 0 && opts.kind === "cladogram") {
    const tipX = nodes.reduce((m, n) => (n.leaf ? Math.max(m, n.x) : m), 0);
    for (const n of nodes) if (n.leaf) n.x = tipX;
  }

  return {
    nodes,
    width: nodes.reduce((m, n) => Math.max(m, n.x), opts.width),
    height: leafCount * opts.leafSpacing,
    scale,
  };
}
