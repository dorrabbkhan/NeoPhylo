// Display names for tree nodes (plan Global Constraints: leaves are
// NodeId(0..n) in input order, internal nodes are numbered in creation
// order). Applied to inferred trees, this names internal nodes u1, u2, …
// matching textbook NJ/UPGMA notation: u1 is the node created by step 1
// and the final NJ central node / UPGMA root gets the last number.
//
// Parsed trees share the same leaf-first arena convention (see newick.rs),
// so the u-names computed here are consistent even though their internal
// nodes were numbered in preorder rather than by agglomeration step.

import type { Tree } from "../engine/generated/Tree";

/** Number of leaves in the arena; ids `0..n-1` are leaves. */
function leafCount(tree: Tree): number {
  let n = 0;
  for (const node of tree.nodes) {
    if (node.children.length === 0) n += 1;
  }
  return n;
}

/**
 * The display name of node `id` in `tree`: the leaf's label when `id`
 * is a leaf, otherwise its own label or `u<creation order>`.
 */
export function nodeName(tree: Tree, id: number): string {
  const node = tree.nodes[id];
  if (id < leafCount(tree)) return node.label ?? `#${id}`;
  return node.label ?? `u${id - leafCount(tree) + 1}`;
}
