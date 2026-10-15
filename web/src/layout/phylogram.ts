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
  const scale = span > 0 ? opts.width / span : 0;

  const nodes: LaidOutNode[] = order.filter(isVisible).map((id) => {
    const parent = tree.nodes[id].parent;
    const hasVisibleParent = parent !== null && isVisible(parent);
    const isLeaf = !tree.nodes[id].children.some(isVisible);
    // Cladogram: tips align at the right edge regardless of their depth.
    const ownCum = opts.kind === "cladogram" && isLeaf ? maxCum : cum.get(id)!;
    const x = (ownCum - base) * scale;
    const parentX = hasVisibleParent ? (cum.get(parent)! - base) * scale : x;
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

  return {
    nodes,
    width: opts.width,
    height: leafCount * opts.leafSpacing,
    scale,
  };
}
