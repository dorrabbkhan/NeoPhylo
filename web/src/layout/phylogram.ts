// Rectangular tree layout (spec §6.1, plan Task 14). Pure functions, kept
// separate from rendering: the same output feeds the on-screen SVG and the
// export pipeline. No engine math lives here — branch lengths are taken
// verbatim from the `Tree` arena produced by `neophylo-core`.
//
// Conventions:
// - `x` is the cumulative root-to-node branch length times `scale` for a
//   phylogram, or the depth (edge count) times `scale` for a cladogram.
//   In a cladogram all leaves are aligned at the right edge.
// - `scale` is pixels per unit, chosen so the deepest node sits exactly at
//   `width`. It is 0 for a zero-length tree, keeping every x at 0.
// - Leaves are spaced `leafSpacing` apart in preorder; leaf i sits at
//   (i + 0.5) * leafSpacing, so `height` is leafCount * leafSpacing.
// - Internal nodes sit at the vertical midpoint of their outermost children.
// - `parentX` is the parent's x, i.e. where the vertical elbow segment sits.
//   A forest root has `parentX === x`, so no stub is drawn.
// - `visibleNodes` restricts output to a subset (used while stepping through
//   a trace): invisible nodes are omitted and each maximal visible subtree
//   becomes an independent forest root starting at x = 0.

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

  // Full preorder over the original tree. Only used to order the forest
  // roots, so visibility does not affect traversal here.
  const preorder: number[] = [];
  const stack: number[] = [tree.root];
  while (stack.length > 0) {
    const id = stack.pop()!;
    preorder.push(id);
    const children = tree.nodes[id].children;
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push(children[i]);
    }
  }

  // Horizontal coordinate in tree units (length or depth), before scaling.
  const cum = new Map<number, number>();
  const y = new Map<number, number>();
  const order: number[] = [];
  let leafCount = 0;
  let maxCum = 0;

  const visit = (id: number, parentCum: number, fromVisibleParent: boolean): void => {
    const len = tree.branches[id].length;
    let edge = 0;
    if (fromVisibleParent) {
      edge = opts.kind === "cladogram" ? 1 : (len ?? 0);
      if (opts.clampNegative && edge < 0) edge = 0;
    }
    const here = parentCum + edge;
    if (here > maxCum) maxCum = here;
    cum.set(id, here);
    order.push(id);

    const kids = tree.nodes[id].children.filter(isVisible);
    if (kids.length === 0) {
      y.set(id, (leafCount + 0.5) * opts.leafSpacing);
      leafCount += 1;
      return;
    }
    for (const k of kids) {
      visit(k, here, true);
    }
    y.set(id, (y.get(kids[0])! + y.get(kids[kids.length - 1])!) / 2);
  };

  // A visible node whose parent is invisible (or absent) is a forest root.
  for (const id of preorder) {
    if (!isVisible(id)) continue;
    const parent = tree.nodes[id].parent;
    if (parent === null || !isVisible(parent)) {
      visit(id, 0, false);
    }
  }

  const scale = maxCum > 0 ? opts.width / maxCum : 0;

  const nodes: LaidOutNode[] = order.map((id) => {
    const parent = tree.nodes[id].parent;
    const hasVisibleParent = parent !== null && isVisible(parent);
    const isLeaf = !tree.nodes[id].children.some(isVisible);
    // Cladogram: tips align at the right edge regardless of their depth.
    const ownCum = opts.kind === "cladogram" && isLeaf ? maxCum : cum.get(id)!;
    const x = ownCum * scale;
    const parentX = hasVisibleParent ? cum.get(parent)! * scale : x;
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
