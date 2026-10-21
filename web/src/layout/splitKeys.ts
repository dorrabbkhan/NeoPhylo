// Canonical grouping keys for drawn nodes (v1.2 checkpoint 15). Every
// node marker and support label carries `data-split` so an exported
// figure can be matched back to the run's tally and to the on-screen
// tree. The key mirrors the canonical side `bootstrap::split` uses
// (spec §3.3, §4) — a display attribute, not engine math:
//
// - `rooted` (UPGMA-style cluster tallies): the node's own leaf set.
// - unrooted (NJ split tallies): the bipartition the edge above the
//   node induces, canonicalized to the side NOT containing taxa[0] —
//   a rerooted display tree keeps its computed groupings, so the key
//   does not depend on where the drawing's root sits.
// - the root carries the whole taxon set; a leaf carries its own
//   label (or, unrooted, the complement when the leaf is taxa[0]).
//
// The key is the side's labels, sorted and joined with "|" — the same
// sorted-label-list form a `Split`/`BootstrapTally.counts` row
// serializes to, so a key matches its tally row verbatim.

import type { Tree } from "../engine/generated/Tree";

/** The leaf set under every node (iterative post-order; a malformed
 * cyclic arena still terminates). */
function leafSets(tree: Tree): Map<number, Set<string>> {
  const sets = new Map<number, Set<string>>();
  const seen = new Array<boolean>(tree.nodes.length).fill(false);
  const stack: { id: number; expanded: boolean }[] = [
    { id: tree.root, expanded: false },
  ];
  while (stack.length > 0) {
    const top = stack[stack.length - 1];
    const node = tree.nodes[top.id];
    if (node === undefined || seen[top.id]) {
      stack.pop();
      continue;
    }
    if (node.children.length === 0) {
      seen[top.id] = true;
      sets.set(top.id, new Set(node.label === null ? [] : [node.label]));
      stack.pop();
      continue;
    }
    if (!top.expanded) {
      top.expanded = true;
      for (const c of node.children) stack.push({ id: c, expanded: false });
      continue;
    }
    const under = new Set<string>();
    for (const c of node.children) {
      for (const l of sets.get(c) ?? []) under.add(l);
    }
    seen[top.id] = true;
    sets.set(top.id, under);
    stack.pop();
  }
  return sets;
}

/** Leaf labels in arena order — engine trees number leaves `0..n` in
 * input order, so this is the alignment order for every tree the
 * engine built or parsed (the default for `splitKeys`' `taxa`). */
export function treeTaxaOrder(tree: Tree): string[] {
  const out: string[] = [];
  for (const node of tree.nodes) {
    if (node.children.length === 0 && node.label !== null) {
      out.push(node.label);
    }
  }
  return out;
}

/**
 * `data-split` for every node of `tree`: node id -> canonical grouping
 * key (see the header for the convention). `taxa` is the taxon list in
 * alignment order — its first entry is the taxon-0 the unrooted
 * canonicalization excludes; `rooted` selects the cluster convention
 * (UPGMA tallies) vs the unrooted-split convention (NJ tallies,
 * including a rerooted NJ drawing).
 */
export function splitKeys(
  tree: Tree,
  taxa: string[],
  rooted: boolean,
): Map<number, string> {
  const first = taxa[0];
  const sets = leafSets(tree);
  const keys = new Map<number, string>();
  for (const [id, under] of sets) {
    let side = under;
    if (!rooted && id !== tree.root && under.has(first)) {
      const complement = new Set(taxa.filter((l) => !under.has(l)));
      // A node holding every taxon has no complement — keep the leaf
      // set itself rather than emitting an empty key.
      if (complement.size > 0) side = complement;
    }
    keys.set(id, [...side].sort().join("|"));
  }
  return keys;
}
