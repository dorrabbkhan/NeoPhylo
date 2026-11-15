//! Worksheet facts (v1.4c spec §7.2): one `JoinFacts` per join —
//! chosen pair, every tied pair, same-split ties, closest pair, limb
//! lengths and the new node's distances — all read from the trace
//! `build_tree` records, never recomputed, so an answer key can never
//! disagree with the engine.
//!
//! Node names follow the stepper's convention
//! (`web/src/state/names.ts::nodeName`): leaves show their taxon label
//! and internal nodes show `u<creation order>` — u1 is the node step 1
//! creates, and NJ's central node / UPGMA's root takes the last number.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::algos::{build_tree, BuildOptions, Method, Trace};
use crate::dist::DistanceMatrix;
use crate::error::NeoError;
use crate::matrix::Matrix;
use crate::tree::{NodeId, Tree};

/// One join's worksheet facts (v1.4c spec §7.2). Every number comes
/// from the engine trace; names are the stepper's active-node names.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct JoinFacts {
    /// 1-based join number, matching the stepper's numbering — NJ's
    /// final three-way join is one step past the last `NjStep`.
    pub step: u32,
    /// Row sums of the step's distance matrix — NJ only; `None` for
    /// UPGMA (UPGMA worksheets use cluster averages instead of Q).
    pub row_sums: Option<Vec<f64>>,
    /// The chosen pair's display names.
    pub chosen: (String, String),
    /// Every pair sharing the minimum criterion — Q for NJ, raw
    /// distance for UPGMA — in the engine's lexicographic `(i, j)`
    /// scan order, so `tied[0] == chosen`. NJ's final join has no real
    /// choice and lists only `(a, b)`. Exact `==`, no epsilon.
    pub tied: Vec<(String, String)>,
    /// True when `tied` is exactly two complementary pairs over four
    /// active nodes — either choice yields the same split.
    pub tie_same_split: bool,
    /// Every pair at the minimum raw distance, scan order.
    pub closest: Vec<(String, String)>,
    /// Whether `chosen` is one of `closest`.
    pub chosen_is_closest: bool,
    /// Branch length from the first chosen node to the new node.
    pub len_i: f64,
    /// Branch length from the second chosen node to the new node.
    pub len_j: f64,
    /// Distances from the new node to the remaining active nodes,
    /// paired in the trace's order — NJ's final entry lists `(c, lc)`.
    pub new_distances: Vec<(String, f64)>,
    /// True only for NJ's final three-way join — a synthetic entry
    /// appended after the last `NjStep` so the worksheet covers the
    /// join the stepper already shows (conductor's call, v1.4c Task 6).
    pub final_join: bool,
}

/// The facts for every join `build_tree` records for `m` under
/// `method` — one per `NjStep` plus NJ's final three-way join, or one
/// per `UpgmaStep`. Whatever `build_tree` returns for `m` is passed
/// through — fewer than 3 taxa is `TooFewTaxa`, never a panic.
pub fn worksheet_facts(m: &DistanceMatrix, method: Method) -> Result<Vec<JoinFacts>, NeoError> {
    let res = build_tree(m, method, BuildOptions { trace: true })?;
    let Some(trace) = res.trace else {
        // `trace: true` above makes this unreachable; never panic.
        return Err(NeoError::InvalidExercise {
            field: "trace".to_string(),
            msg: "build produced no trace".to_string(),
        });
    };
    let tree = &res.tree;
    let leaves = tree.nodes.iter().filter(|n| n.children.is_empty()).count();
    match trace {
        Trace::Nj { steps, final_join } => {
            let mut out = Vec::with_capacity(steps.len() + 1);
            for s in &steps {
                out.push(step_facts(
                    tree,
                    leaves,
                    &StepView {
                        step: s.step,
                        active: &s.active,
                        distance: &s.distance,
                        criterion: Some(&s.q),
                        chosen: s.chosen,
                        row_sums: Some(s.r.clone()),
                        len_i: s.len_i,
                        len_j: s.len_j,
                        new_row: &s.new_row,
                    },
                ));
            }
            // The three-way join has no choice to narrate: chosen is
            // (a, b), tied lists only it, len_i/len_j are la/lb and
            // new_distances is c's branch to the centre — identical to
            // the NJ new-distance formula with n = 3.
            let f = &final_join;
            let fm = &f.distance;
            let row_sums = Some(if fm.n == 3 && fm.data.len() == 9 {
                (0..3)
                    .map(|i| (0..3).map(|j| fm.data[i * 3 + j]).sum())
                    .collect()
            } else {
                Vec::new()
            });
            let mut fin = step_facts(
                tree,
                leaves,
                &StepView {
                    step: steps.len() as u32 + 1,
                    active: &[f.a, f.b, f.c],
                    distance: fm,
                    criterion: None,
                    chosen: (0, 1),
                    row_sums,
                    len_i: f.la,
                    len_j: f.lb,
                    new_row: &[f.lc],
                },
            );
            fin.tied = vec![fin.chosen.clone()];
            fin.tie_same_split = false;
            fin.final_join = true;
            out.push(fin);
            Ok(out)
        }
        Trace::Upgma { steps } => Ok(steps
            .iter()
            .map(|s| {
                step_facts(
                    tree,
                    leaves,
                    &StepView {
                        step: s.step,
                        active: &s.active,
                        distance: &s.distance,
                        criterion: None,
                        chosen: s.chosen,
                        row_sums: None,
                        len_i: s.len_i,
                        len_j: s.len_j,
                        new_row: &s.new_row,
                    },
                )
            })
            .collect()),
    }
}

/// The stepper's node name (`state/names.ts::nodeName`): leaves show
/// their label; internal nodes show `u<id - leaves + 1>`.
fn node_name(tree: &Tree, leaves: usize, id: NodeId) -> String {
    let i = id.0 as usize;
    let Some(node) = tree.nodes.get(i) else {
        return format!("#{i}");
    };
    let label = node.label.clone();
    if i < leaves {
        return label.unwrap_or_else(|| format!("#{i}"));
    }
    label.unwrap_or_else(|| format!("u{}", i - leaves + 1))
}

/// Every `(i, j)` pair `i < j` achieving the minimum of `get`, in the
/// engine's lexicographic scan order — the exact `==` rule the join
/// loops use, no epsilon. A missing cell reads as `+∞`, never panics.
fn min_pairs(n: usize, get: impl Fn(usize, usize) -> f64) -> Vec<(usize, usize)> {
    let mut best = f64::INFINITY;
    let mut out = Vec::new();
    for i in 0..n {
        for j in (i + 1)..n {
            let v = get(i, j);
            if v < best {
                best = v;
                out.clear();
                out.push((i, j));
            } else if v == best {
                out.push((i, j));
            }
        }
    }
    out
}

fn cell(m: &Matrix, k: usize, i: usize, j: usize) -> f64 {
    m.data.get(i * k + j).copied().unwrap_or(f64::INFINITY)
}

/// A borrowed view over one trace record — `NjStep`, `UpgmaStep` or
/// the synthesized `NjFinal` join.
struct StepView<'a> {
    step: u32,
    active: &'a [NodeId],
    distance: &'a Matrix,
    /// NJ's Q matrix; `None` minimizes raw distance (UPGMA and the
    /// final join's `tied` override).
    criterion: Option<&'a Matrix>,
    chosen: (usize, usize),
    row_sums: Option<Vec<f64>>,
    len_i: f64,
    len_j: f64,
    new_row: &'a [f64],
}

/// Assemble one `JoinFacts` from a single trace step.
fn step_facts(tree: &Tree, leaves: usize, s: &StepView) -> JoinFacts {
    let k = s.active.len();
    let name = |idx: usize| {
        s.active
            .get(idx)
            .map(|&id| node_name(tree, leaves, id))
            .unwrap_or_else(|| format!("#{idx}"))
    };
    let named = |p: (usize, usize)| (name(p.0), name(p.1));
    let tied_idx = match s.criterion {
        Some(q) => min_pairs(k, |i, j| cell(q, k, i, j)),
        None => min_pairs(k, |i, j| cell(s.distance, k, i, j)),
    };
    let closest_idx = min_pairs(k, |i, j| cell(s.distance, k, i, j));
    let tie_same_split = tied_idx.len() == 2 && k == 4 && {
        let (a, b) = (tied_idx[0], tied_idx[1]);
        a.0 != b.0 && a.0 != b.1 && a.1 != b.0 && a.1 != b.1
    };
    let tied: Vec<(String, String)> = tied_idx.iter().map(|&p| named(p)).collect();
    let closest: Vec<(String, String)> = closest_idx.iter().map(|&p| named(p)).collect();
    let chosen_named = named(s.chosen);
    let new_distances: Vec<(String, f64)> = s
        .active
        .iter()
        .enumerate()
        .filter(|(i, _)| *i != s.chosen.0 && *i != s.chosen.1)
        .zip(s.new_row.iter())
        .map(|((_, &id), &v)| (node_name(tree, leaves, id), v))
        .collect();
    JoinFacts {
        step: s.step,
        row_sums: s.row_sums.clone(),
        chosen_is_closest: closest.contains(&chosen_named),
        chosen: chosen_named,
        tied,
        tie_same_split,
        closest,
        len_i: s.len_i,
        len_j: s.len_j,
        new_distances,
        final_join: false,
    }
}
