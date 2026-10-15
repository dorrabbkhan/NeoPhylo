//! Robinson–Foulds tree comparison (spec §4.6).
//!
//! Unrooted RF distance over bipartitions, so it works for both NJ and
//! UPGMA output; a rooted tree is treated as unrooted (its degree-2 root
//! is suppressed automatically because both of its edges induce the same
//! bipartition). Only non-trivial splits count — both sides must contain
//! at least two leaves.
//!
//! Each split is stored as one canonical side: the side *containing* the
//! lexicographically smallest label of the shared leaf set, sorted. This
//! is an orientation-invariant canonicalization that also makes
//! `missing_in_inferred`/`extra_in_inferred` read like clades in the
//! common cases. (Note: the v1 plan's prose comment says "NOT
//! containing", but its pinned `one_nni` expected values require this
//! side; the test values are authoritative.)

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use ts_rs::TS;

use crate::error::NeoError;
use crate::tree::{NodeId, Tree};

/// One side of a bipartition, canonically the side containing the
/// lexicographically smallest leaf label; labels are sorted.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Split {
    pub side: Vec<String>,
}

/// Result of `rf`: raw and normalized RF distance plus the truth splits
/// missing from the inferred tree and vice versa.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct RfResult {
    pub rf: u32,
    pub max_rf: u32,
    pub normalized: f64,
    pub missing_in_inferred: Vec<Split>,
    pub extra_in_inferred: Vec<Split>,
}

/// Labels of the leaves under `id` (inclusive). Iterative with a fresh
/// visited set so a malformed cyclic arena cannot hang.
fn leaf_set(tree: &Tree, id: NodeId, out: &mut BTreeSet<String>) {
    let mut seen = vec![false; tree.nodes.len()];
    let mut stack = vec![id];
    while let Some(nid) = stack.pop() {
        let i = nid.0 as usize;
        let Some(node) = tree.nodes.get(i) else {
            continue;
        };
        if seen[i] {
            continue;
        }
        seen[i] = true;
        if node.children.is_empty() {
            out.insert(node.label.clone().unwrap_or_default());
        } else {
            stack.extend(node.children.iter().copied());
        }
    }
}

/// The set of non-trivial canonical splits induced by the tree's edges.
/// Every non-root node defines the edge to its parent; `under` is the
/// leaf set below it. A split is kept when both sides have >= 2 leaves.
fn splits(tree: &Tree, all: &BTreeSet<String>, min_label: &str) -> BTreeSet<Vec<String>> {
    let n = all.len();
    let mut out = BTreeSet::new();
    for i in 0..tree.nodes.len() {
        let id = NodeId(i as u32);
        if id == tree.root {
            continue;
        }
        let mut under = BTreeSet::new();
        leaf_set(tree, id, &mut under);
        if under.len() < 2 || under.len() > n.saturating_sub(2) {
            continue;
        }
        let side: Vec<String> = if under.iter().any(|l| l == min_label) {
            under.into_iter().collect()
        } else {
            all.iter()
                .filter(|l| !under.contains(*l))
                .cloned()
                .collect()
        };
        out.insert(side);
    }
    out
}

/// Unrooted Robinson–Foulds distance between `truth` and `inferred`.
/// Both trees must have the same leaf label set.
pub fn rf(truth: &Tree, inferred: &Tree) -> Result<RfResult, NeoError> {
    let labels_a: BTreeSet<String> = truth.leaf_labels().into_iter().collect();
    let labels_b: BTreeSet<String> = inferred.leaf_labels().into_iter().collect();
    if labels_a != labels_b {
        return Err(NeoError::LabelMismatch {
            only_in_a: labels_a.difference(&labels_b).cloned().collect(),
            only_in_b: labels_b.difference(&labels_a).cloned().collect(),
        });
    }
    let n = labels_a.len();
    let Some(min_label) = labels_a.iter().next().cloned() else {
        // Two empty trees trivially match.
        return Ok(RfResult {
            rf: 0,
            max_rf: 0,
            normalized: 0.0,
            missing_in_inferred: Vec::new(),
            extra_in_inferred: Vec::new(),
        });
    };
    let s_truth = splits(truth, &labels_a, &min_label);
    let s_inferred = splits(inferred, &labels_a, &min_label);
    let missing: Vec<Split> = s_truth
        .difference(&s_inferred)
        .map(|side| Split { side: side.clone() })
        .collect();
    let extra: Vec<Split> = s_inferred
        .difference(&s_truth)
        .map(|side| Split { side: side.clone() })
        .collect();
    let rf = (missing.len() + extra.len()) as u32;
    let max_rf = 2 * n.saturating_sub(3) as u32;
    let normalized = if max_rf == 0 {
        0.0
    } else {
        rf as f64 / max_rf as f64
    };
    Ok(RfResult {
        rf,
        max_rf,
        normalized,
        missing_in_inferred: missing,
        extra_in_inferred: extra,
    })
}
