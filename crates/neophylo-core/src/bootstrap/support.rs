//! Bootstrap support on the original tree (v1.2 spec §3.4).
//!
//! Support is a *branch* attribute, so it follows its grouping under
//! display rerooting (spec §3.7). Every internal branch whose split
//! (NJ) or cluster (UPGMA) is in scope for the tally's method gets
//! `Some(count / successful)`, `0.0` when the grouping never appeared
//! in a successful replicate. Terminal branches — and any internal
//! branch that induces no in-scope grouping — keep `None`.

use crate::algos::Method;
use crate::bootstrap::split::tree_splits;
use crate::bootstrap::tally::BootstrapTally;
use crate::tree::Tree;

/// Copy `tree` with `BranchAttrs.support` set on every in-scope
/// internal branch (spec §3.4). The input tree is never mutated.
///
/// `tally.labels` names taxa in alignment order; labels absent from
/// the tree induce no grouping and are simply ignored by
/// `tree_splits`.
pub fn support_on_tree(tree: &Tree, tally: &BootstrapTally) -> Tree {
    let mut out = tree.clone();
    let rooted = tally.method == Method::Upgma;
    for (id, split) in tree_splits(tree, &tally.labels, rooted) {
        let count = tally.counts.get(&split).copied().unwrap_or(0);
        let support = if tally.successful == 0 {
            0.0
        } else {
            count as f64 / tally.successful as f64
        };
        out.branches[id.0 as usize].support = Some(support);
    }
    out
}
