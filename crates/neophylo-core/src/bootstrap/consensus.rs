//! Consensus trees (v1.2 spec §3.5): strict, majority and extended
//! majority over the groupings a `BootstrapTally` counted, plus the
//! list of original-tree groupings a consensus dropped.
//!
//! Acceptance rules (`successful` = replicates that produced a tree):
//! - **Strict:** `count == successful`.
//! - **Majority:** `count > successful / 2` (strictly greater — a 50%
//!   grouping is never a majority).
//! - **Extended:** start from Majority, then consider the remaining
//!   groupings by decreasing count, ties broken by ascending bitset
//!   value (lowest taxon indices first), adding each grouping that is
//!   compatible with every accepted one; stop when the tree is fully
//!   resolved or no candidates remain.
//!
//! The tree built from the accepted groupings carries no branch
//! lengths; each grouping's internal branch gets `support =
//! count / successful`. The accepted set is always pairwise
//! compatible (incompatible groupings can never both exceed half, and
//! extended filters the rest), so it is a laminar family: each
//! grouping nests inside the smallest accepted grouping that strictly
//! contains it, or hangs directly off the root.
//!
//! Unrooted tallies (NJ) produce an unrooted consensus — canonical
//! sides leave at least two taxa outside including taxon 0, so the
//! root always keeps degree >= 3. Rooted tallies (UPGMA) produce a
//! rooted consensus whose root children are the maximal clusters and
//! the unclustered leaves.

use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::algos::Method;
use crate::bootstrap::split::Split;
use crate::bootstrap::tally::BootstrapTally;
use crate::tree::{NodeId, Tree};

/// Which consensus rule to apply (spec §3.5). Serialized as
/// `"Strict" | "Majority" | "Extended"` (spec §4).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum ConsensusKind {
    /// Only groupings seen in every successful replicate.
    Strict,
    /// Groupings seen in more than half of the successful replicates.
    Majority,
    /// Majority, then remaining groupings by decreasing count while
    /// they stay compatible with those already accepted.
    Extended,
}

/// A grouping of the original tree missing from a consensus, with its
/// bootstrap support fraction (spec §3.5); shown in the UI as
/// "Dropped from this consensus".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct DroppedGroup {
    /// The grouping's taxa, sorted (spec §4 display form).
    pub labels: Vec<String>,
    /// `count / successful`, or `0.0` when the tally saw no successes.
    pub support: f64,
}

/// The groupings a consensus of `kind` accepts from `tally`, each with
/// its count. Private to the module; `consensus` and
/// `consensus_dropped` share it.
fn accepted(tally: &BootstrapTally, kind: ConsensusKind) -> Vec<(Split, u32)> {
    let successful = tally.successful;
    let majority: Vec<(Split, u32)> = tally
        .counts
        .iter()
        .filter(|(_, &c)| u64::from(c) * 2 > u64::from(successful))
        .map(|(&s, &c)| (s, c))
        .collect();
    match kind {
        ConsensusKind::Strict => tally
            .counts
            .iter()
            .filter(|(_, &c)| c == successful && successful > 0)
            .map(|(&s, &c)| (s, c))
            .collect(),
        ConsensusKind::Majority => majority,
        ConsensusKind::Extended => {
            let n = tally.labels.len();
            let resolved = if tally.method == Method::Upgma {
                n.saturating_sub(2)
            } else {
                n.saturating_sub(3)
            };
            let mut acc: Vec<(Split, u32)> = majority;
            let chosen: BTreeSet<Split> = acc.iter().map(|(s, _)| *s).collect();
            // BTreeMap order is ascending bitset value already, so a
            // stable descending-count sort yields the spec's ordering.
            let mut rest: Vec<(Split, u32)> = tally
                .counts
                .iter()
                .filter(|(s, _)| !chosen.contains(*s))
                .map(|(&s, &c)| (s, c))
                .collect();
            rest.sort_by(|a, b| b.1.cmp(&a.1).then_with(|| a.0.cmp(&b.0)));
            for (s, c) in rest {
                if acc.len() >= resolved {
                    break; // the tree is fully resolved
                }
                if acc.iter().all(|(g, _)| g.compatible(&s, n)) {
                    acc.push((s, c));
                }
            }
            acc
        }
    }
}

/// Whether every bit of `a` (below index `n`) is also set in `b`.
/// Stray bits at or beyond `n` are masked out, matching
/// `Split::compatible`'s universe.
fn is_subset(a: &Split, b: &Split, n: usize) -> bool {
    let nw = n.min(256).div_ceil(64);
    for w in 0..nw {
        let hi = w * 64;
        let mask = if n >= hi + 64 {
            u64::MAX
        } else if n <= hi {
            0
        } else {
            (1u64 << (n - hi)) - 1
        };
        if a.0[w] & mask & !b.0[w] != 0 {
            return false;
        }
    }
    true
}

/// Build the consensus tree from the accepted (pairwise compatible)
/// groupings. Every accepted grouping gets one internal node; its
/// parent is the smallest strictly containing grouping, else the root.
/// Leaves 0..n are created first, per the node-id convention.
fn build_consensus_tree(
    labels: &[String],
    groups: &[(Split, u32)],
    successful: u32,
    rooted: bool,
) -> Tree {
    let n = labels.len();
    let mut tree = Tree::new();
    tree.rooted = rooted;
    for label in labels {
        tree.add_node(Some(label.clone()));
    }
    let leaves: Vec<NodeId> = (0..n).map(|i| NodeId(i as u32)).collect();
    let root = tree.add_node(None);
    tree.set_root(root);

    // Ascending size: a grouping's strict superset always sorts after
    // it, and compatible groupings nest, so the first superset in this
    // order is the smallest one — the correct parent.
    let mut sorted: Vec<(Split, u32)> = groups.to_vec();
    sorted.sort_by_key(|(s, _)| s.len());
    let gnodes: Vec<NodeId> = sorted.iter().map(|_| tree.add_node(None)).collect();

    for (i, (g, count)) in sorted.iter().enumerate() {
        let parent = sorted[i + 1..]
            .iter()
            .zip(&gnodes[i + 1..])
            .find(|(h, _)| h.0.len() > g.len() && is_subset(g, &h.0, n))
            .map(|(_, &id)| id)
            .unwrap_or(root);
        tree.attach(parent, gnodes[i], None);
        tree.branches[gnodes[i].0 as usize].support = Some(if successful == 0 {
            0.0
        } else {
            *count as f64 / successful as f64
        });
    }
    for (i, leaf) in leaves.iter().enumerate() {
        let parent = sorted
            .iter()
            .zip(&gnodes)
            .find(|(g, _)| g.0.contains(i))
            .map(|(_, &id)| id)
            .unwrap_or(root);
        tree.attach(parent, *leaf, None);
    }
    tree
}

/// The consensus tree of `tally` under `kind` (spec §3.5). Rooted
/// (UPGMA) tallies produce a rooted consensus, unrooted (NJ) tallies an
/// unrooted one. The tree has no branch lengths; each accepted
/// grouping's internal branch carries `support = count / successful`.
/// `tally.labels` supplies the leaf names (a deviation the plan itself
/// records: the spec's `labels` argument lives inside the tally).
pub fn consensus(tally: &BootstrapTally, kind: ConsensusKind) -> Tree {
    let rooted = tally.method == Method::Upgma;
    let groups = accepted(tally, kind);
    build_consensus_tree(&tally.labels, &groups, tally.successful, rooted)
}

/// Groupings of `original` that the `kind` consensus of `tally` does
/// not contain, each with its support fraction (spec §3.5). Ordered by
/// ascending bitset value, deterministically.
pub fn consensus_dropped(
    original: &Tree,
    tally: &BootstrapTally,
    kind: ConsensusKind,
) -> Vec<DroppedGroup> {
    let rooted = tally.method == Method::Upgma;
    let in_consensus: BTreeSet<Split> = accepted(tally, kind).iter().map(|(s, _)| *s).collect();
    let originals: BTreeSet<Split> =
        crate::bootstrap::split::tree_splits(original, &tally.labels, rooted)
            .into_iter()
            .map(|(_, s)| s)
            .collect();
    originals
        .iter()
        .filter(|s| !in_consensus.contains(*s))
        .map(|s| {
            let count = tally.counts.get(s).copied().unwrap_or(0);
            DroppedGroup {
                labels: s.labels(&tally.labels),
                support: if tally.successful == 0 {
                    0.0
                } else {
                    count as f64 / tally.successful as f64
                },
            }
        })
        .collect()
}
