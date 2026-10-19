//! Bootstrap support on the original tree (v1.2 spec §3.4).
//!
//! Support is a *branch* attribute, so it follows its grouping under
//! display rerooting (spec §3.7). Every internal branch whose split
//! (NJ) or cluster (UPGMA) is in scope for the tally's method gets
//! `Some(count / successful)`, `0.0` when the grouping never appeared
//! in a successful replicate. Terminal branches — and any internal
//! branch that induces no in-scope grouping — keep `None`.
//!
//! One split, shown once (spec §3.7): on an unrooted tree's degree-2
//! root both edges induce the *same* canonical split. The value goes on
//! the edge whose subtree is the canonical side (the side not
//! containing taxon 0); the complementary edge keeps `None`. Rooted
//! (UPGMA) root children are real clusters and are unaffected.

use crate::algos::Method;
use crate::bootstrap::split::{tree_splits, Split};
use crate::bootstrap::tally::BootstrapTally;
use crate::tree::{NodeId, Tree};

/// Copy `tree` with `BranchAttrs.support` set on every in-scope
/// internal branch (spec §3.4). The input tree is never mutated.
///
/// `tally.labels` names taxa in alignment order; labels absent from
/// the tree induce no grouping and are simply ignored by
/// `tree_splits`.
pub fn support_on_tree(tree: &Tree, tally: &BootstrapTally) -> Tree {
    let mut out = tree.clone();
    let rooted = tally.method == Method::Upgma;
    let splits = tree_splits(tree, &tally.labels, rooted);
    for (id, split) in &splits {
        if !rooted && is_dup_root_side(tree, &splits, *id, *split, &tally.labels) {
            continue; // the split is shown on the canonical-side edge
        }
        let count = tally.counts.get(split).copied().unwrap_or(0);
        let support = if tally.successful == 0 {
            0.0
        } else {
            count as f64 / tally.successful as f64
        };
        out.branches[id.0 as usize].support = Some(support);
    }
    out
}

/// Whether the edge above `id` is the hidden half of a duplicated
/// unrooted split: an edge directly under the root, sharing its
/// canonical split with another in-scope edge, whose own subtree
/// contains taxon 0 (so it is *not* the canonical side). Spec §3.7
/// shows such a split once, on the complementary edge.
fn is_dup_root_side(
    tree: &Tree,
    splits: &[(NodeId, Split)],
    id: NodeId,
    split: Split,
    labels: &[String],
) -> bool {
    if tree.nodes[id.0 as usize].parent != Some(tree.root) {
        return false;
    }
    if splits.iter().filter(|(_, s)| *s == split).count() < 2 {
        return false;
    }
    under_contains_taxon0(tree, id, labels)
}

/// Whether taxon 0 (`labels[0]`) sits in the subtree under `id` —
/// checked by climbing ancestors from that leaf, so no subtree set
/// needs rebuilding. Returns false when the label is absent from the
/// tree (then no subtree contains it) or on a malformed cyclic arena
/// (the bounded climb keeps the no-panic rule).
fn under_contains_taxon0(tree: &Tree, id: NodeId, labels: &[String]) -> bool {
    let Some(taxon0) = labels.first() else {
        return false;
    };
    let Some(mut cur) = tree
        .nodes
        .iter()
        .position(|n| n.label.as_deref() == Some(taxon0.as_str()))
    else {
        return false;
    };
    for _ in 0..=tree.nodes.len() {
        if cur == id.0 as usize {
            return true;
        }
        match tree.nodes[cur].parent {
            Some(p) => cur = p.0 as usize,
            None => return false,
        }
    }
    false
}
