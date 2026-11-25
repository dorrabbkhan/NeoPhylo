//! Gradable tasks (v1.5 spec §5.3, plan Task 4): every task's answer
//! is computed from the student's own variant — targets are named by
//! **role**, never by taxon name, so the same `TaskRef` grades every
//! variant. `task_key` produces the accepted answer; `check_task`
//! scores a `TaskAnswer` — the same function practice feedback uses.
//!
//! - `predict_pair` answers with tip indices in the variant's tip
//!   order (= the distance-matrix label order); a pick names the two
//!   active clusters containing those tips, and every tied pair of the
//!   join is accepted — both the benign complement tie
//!   (`tie_same_split`) and a genuinely ambiguous tie (documented;
//!   `tie_free` premises are what keep built-ins fair).
//! - Numeric tasks compare scaled integers at [`PRECISION`]: the
//!   student's value is correct exactly when it equals the engine
//!   value rounded at display precision.
//! - `predict_branch` answers with the least-supported grouping of
//!   the variant's own seeded bootstrap run — the run the app shows
//!   (`bootstrap_batch_filtered` under the exercise's analysis, the
//!   seed and replicates in `content.bootstrap`, ≤ 200 replicates).
//!   A pick is correct when its support is within 5 points of the
//!   weakest grouping's — the same rule the lesson verdict applies
//!   (`web/src/views/App.tsx:1114-1117`).

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::algos::{build_tree, BuildOptions, Method, Trace};
use crate::assess::assignment::{Content, Variant};
use crate::assess::precision::scaled_quantity;
use crate::assess::variant::{exercise_alignment, exercise_distance_matrix};
use crate::bootstrap::{bootstrap_batch_filtered, support_on_tree, tree_splits};
use crate::dist::{compute_filtered, DistanceMatrix};
use crate::error::NeoError;
use crate::exercise::Exercise;
use crate::matrix::Matrix;
use crate::reading::{
    answer as reading_answer, check as reading_check, Accepted, CladeKey, Response,
};
use crate::site_filter::SiteFilter;
use crate::tree::{NodeId, Tree};
use crate::worksheet::{worksheet_facts, JoinFacts};

fn invalid(field: &str, msg: impl Into<String>) -> NeoError {
    NeoError::InvalidAssignment {
        field: field.to_string(),
        msg: msg.into(),
    }
}

/// A task in an assignment's graded list (spec §5.3). `step` is the
/// 1-based join number matching `JoinFacts.step` — the same number
/// `prompts[*].at_step` carries.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(
    tag = "kind",
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum TaskRef {
    /// Which pair joins at `step`.
    PredictPair { step: u32 },
    /// Which grouping is least supported by the seeded bootstrap run.
    PredictBranch,
    /// A worksheet quantity at `step`, for the pair named by `role`.
    Numeric {
        step: u32,
        quantity: Quantity,
        role: PairRole,
    },
    /// A reading-set item, by index.
    Reading { item: usize },
}

/// The worksheet quantities numeric tasks ask for (spec §5.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum Quantity {
    /// The NJ Q-matrix cell — `InvalidAssignment` on a UPGMA exercise
    /// or the final three-way join, which have no Q.
    QValue,
    /// A branch length of the join — `len_i`/`len_j`, named by the
    /// `ChosenFirstToNew`/`ChosenSecondToNew` roles.
    BranchLength,
    /// The new node's distance to the nearer still-active member of
    /// the role's pair — `InvalidAssignment` when no member stays
    /// active (a `Chosen` pair is always fully consumed).
    NewDistance,
    /// The pair's distance in the step's matrix — the corrected value
    /// the heatmap shows.
    CorrectedDistance,
}

/// Which pair (or member) a numeric task targets (spec §5.3 —
/// "targets are defined by role, never by names"). The conductor's
/// minimal set; first/second is the engine's `(i, j)` scan order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum PairRole {
    /// The pair joined at that step.
    Chosen,
    /// The minimum raw-distance pair at that step. Numeric tasks on
    /// it refuse an ambiguous closest-pair tie (`closest.len() != 1`)
    /// with `InvalidAssignment`.
    ClosestRaw,
    /// The edge from the first chosen node to the new node — `len_i`.
    ChosenFirstToNew,
    /// The edge from the second chosen node to the new node — `len_j`.
    ChosenSecondToNew,
}

/// A student's answer to a gradable task. `Number` is already scaled
/// at the quantity's display precision (spec §5.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
#[ts(
    tag = "kind",
    content = "value",
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum TaskAnswer {
    Pair(u16, u16),
    Branch(CladeKey),
    Number(#[ts(type = "number")] i64),
    Reading(Response),
}

/// What `task_key` computes — the accepted answer(s) of a task on a
/// variant. `Pairs` lists every accepted unordered tip pair; `Number`
/// is the engine value scaled at `PRECISION`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
#[ts(
    tag = "kind",
    content = "value",
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum AcceptedAnswer {
    Pairs(Vec<(u16, u16)>),
    Branch(CladeKey),
    Number(#[ts(type = "number")] i64),
    Reading(Accepted),
}

/// The accepted answer of `task` on `variant` — `InvalidAssignment`
/// when the task cannot apply to the content.
pub fn task_key(variant: &Variant, task: &TaskRef) -> Result<AcceptedAnswer, NeoError> {
    match task {
        TaskRef::PredictPair { step } => {
            let run = ExerciseRun::new(variant)?;
            Ok(AcceptedAnswer::Pairs(run.accepted_pairs(*step)?))
        }
        TaskRef::Numeric {
            step,
            quantity,
            role,
        } => {
            let run = ExerciseRun::new(variant)?;
            Ok(AcceptedAnswer::Number(
                run.numeric(*step, *quantity, *role)?,
            ))
        }
        TaskRef::PredictBranch => {
            let b = branch_run(variant)?;
            Ok(AcceptedAnswer::Branch(b.weakest))
        }
        TaskRef::Reading { item } => {
            let Content::Reading(set) = &variant.content else {
                return Err(invalid("content", "reading tasks need reading content"));
            };
            let key = reading_answer(set, *item)
                .map_err(|_| invalid("item", format!("no readable item at index {item}")))?;
            Ok(AcceptedAnswer::Reading(key.accepted))
        }
    }
}

/// Score `answer` on `variant`'s `task` — `Ok(false)` for a
/// well-formed wrong answer, `InvalidAssignment` when the task cannot
/// apply to the content.
pub fn check_task(
    variant: &Variant,
    task: &TaskRef,
    answer: &TaskAnswer,
) -> Result<bool, NeoError> {
    match (task, answer) {
        (TaskRef::PredictPair { step }, TaskAnswer::Pair(a, b)) => {
            let run = ExerciseRun::new(variant)?;
            let s = run.step(*step)?;
            // Each picked tip resolves to the active cluster
            // containing it; the cluster's canonical member (lowest
            // tip index) names it, so a pick of "c vs u2" lands on the
            // same pair whatever tip inside u2 was touched.
            let (Some(x), Some(y)) = (s.canonical(*a), s.canonical(*b)) else {
                return Ok(false);
            };
            if x == y {
                return Ok(false);
            }
            let pick = (x.min(y), x.max(y));
            Ok(run.accepted_pairs(*step)?.contains(&pick))
        }
        (
            TaskRef::Numeric {
                step,
                quantity,
                role,
            },
            TaskAnswer::Number(v),
        ) => {
            let run = ExerciseRun::new(variant)?;
            Ok(run.numeric(*step, *quantity, *role)? == *v)
        }
        (TaskRef::PredictBranch, TaskAnswer::Branch(clade)) => {
            let b = branch_run(variant)?;
            let mut picked = clade.clone();
            picked.sort();
            // The lesson verdict rule: within 5 points of the weakest
            // grouping's support (App.tsx:1114-1117); a pick naming no
            // in-scope grouping is wrong, as a terminal pick is.
            match b.by_key.get(&picked) {
                Some(s) => Ok(s - b.weakest_support <= 0.05 + 1e-9),
                None => Ok(false),
            }
        }
        (TaskRef::Reading { item }, TaskAnswer::Reading(r)) => {
            let Content::Reading(set) = &variant.content else {
                return Err(invalid("content", "reading tasks need reading content"));
            };
            Ok(reading_check(set, *item, r)
                .map_err(|_| invalid("item", format!("no readable item at index {item}")))?
                .correct)
        }
        // A response kind that doesn't fit the task kind is a wrong
        // answer, not an engine error.
        _ => Ok(false),
    }
}

// --- the exercise pipeline one task reads -------------------------------------

/// The variant's distance pipeline plus its trace — the data every
/// exercise task is computed from.
struct ExerciseRun<'a> {
    matrix: DistanceMatrix,
    tree: Tree,
    trace: Trace,
    facts: Vec<JoinFacts>,
    leaves: usize,
    /// Matrix label → tip index (labels are unique post-validation).
    tip_index: HashMap<String, u16>,
    _ex: &'a Exercise,
}

impl<'a> ExerciseRun<'a> {
    fn new(variant: &'a Variant) -> Result<Self, NeoError> {
        let Content::Exercise(ex) = &variant.content else {
            return Err(invalid("content", "task needs exercise content"));
        };
        let matrix = exercise_distance_matrix(ex)?;
        let res = build_tree(&matrix, ex.analysis.method, BuildOptions { trace: true })?;
        let Some(trace) = res.trace else {
            return Err(invalid("trace", "build produced no trace"));
        };
        let facts = worksheet_facts(&matrix, ex.analysis.method)?;
        let leaves = res
            .tree
            .nodes
            .iter()
            .filter(|n| n.children.is_empty())
            .count();
        let tip_index = matrix
            .labels
            .iter()
            .enumerate()
            .map(|(i, l)| (l.clone(), i as u16))
            .collect();
        Ok(Self {
            matrix,
            tree: res.tree,
            trace,
            facts,
            leaves,
            tip_index,
            _ex: ex,
        })
    }

    /// The stepper's node name for `id` — the `worksheet`
    /// `node_name` rule (a display convention, deliberately identical
    /// in both places).
    fn name_of(&self, id: NodeId) -> String {
        let i = id.0 as usize;
        let label = || {
            self.tree
                .nodes
                .get(i)
                .and_then(|n| n.label.clone())
                .unwrap_or_else(|| format!("#{i}"))
        };
        if i < self.leaves {
            label()
        } else {
            format!("u{}", i - self.leaves + 1)
        }
    }

    /// `active` position of the node named `name`, if any.
    fn index_named(&self, active: &[NodeId], name: &str) -> Option<usize> {
        active.iter().position(|&id| self.name_of(id) == name)
    }

    /// One join step's data — NJ's final three-way join is
    /// synthesised from `NjFinal` like `worksheet_facts` does.
    fn step(&self, step: u32) -> Result<StepData<'_>, NeoError> {
        if step == 0 || step as usize > self.facts.len() {
            return Err(invalid(
                "step",
                format!(
                    "join step {step} is out of range (the run has {} joins)",
                    self.facts.len()
                ),
            ));
        }
        let f = &self.facts[step as usize - 1];
        let (active, distance, q, chosen, len_i, len_j, new_row) = match &self.trace {
            Trace::Nj {
                steps, final_join, ..
            } if step as usize == steps.len() + 1 => (
                vec![final_join.a, final_join.b, final_join.c],
                final_join.distance.clone(),
                None,
                (0usize, 1usize),
                final_join.la,
                final_join.lb,
                vec![(final_join.c, final_join.lc)],
            ),
            Trace::Nj { steps, .. } => {
                let s = &steps[step as usize - 1];
                (
                    s.active.clone(),
                    s.distance.clone(),
                    Some(s.q.clone()),
                    s.chosen,
                    s.len_i,
                    s.len_j,
                    remaining(&s.active, s.chosen, &s.new_row),
                )
            }
            Trace::Upgma { steps } => {
                let s = &steps[step as usize - 1];
                (
                    s.active.clone(),
                    s.distance.clone(),
                    None,
                    s.chosen,
                    s.len_i,
                    s.len_j,
                    remaining(&s.active, s.chosen, &s.new_row),
                )
            }
        };
        // tip index → active index, and each active node's canonical
        // member (lowest tip index of its leaf set).
        let mut cluster_of = vec![usize::MAX; self.matrix.labels.len()];
        let mut canonical = Vec::with_capacity(active.len());
        for (k, &id) in active.iter().enumerate() {
            let mut best = u16::MAX;
            for leaf in leaf_tips(&self.tree, id) {
                if let Some(&t) = self.tip_index.get(leaf.as_str()) {
                    cluster_of[t as usize] = k;
                    best = best.min(t);
                }
            }
            canonical.push(best);
        }
        Ok(StepData {
            active,
            distance,
            q,
            chosen,
            len_i,
            len_j,
            new_row,
            canonical,
            cluster_of,
            facts: f,
        })
    }

    /// Every accepted unordered tip pair of the join at `step` — all
    /// of `JoinFacts.tied` (see the module docstring).
    fn accepted_pairs(&self, step: u32) -> Result<Vec<(u16, u16)>, NeoError> {
        let s = self.step(step)?;
        let mut out = Vec::with_capacity(s.facts.tied.len());
        for (a, b) in &s.facts.tied {
            let (Some(ia), Some(ib)) = (
                self.index_named(&s.active, a),
                self.index_named(&s.active, b),
            ) else {
                return Err(invalid(
                    "step",
                    format!("tied pair ({a}, {b}) is not active at this join"),
                ));
            };
            let (x, y) = (s.canonical[ia], s.canonical[ib]);
            out.push((x.min(y), x.max(y)));
        }
        Ok(out)
    }

    /// The numeric task value scaled at `quantity`'s precision.
    fn numeric(&self, step: u32, quantity: Quantity, role: PairRole) -> Result<i64, NeoError> {
        let s = self.step(step)?;
        let f = s.facts;
        // The pair of `active` indices a role names — `Chosen` is the
        // step's own pair; `ClosestRaw` resolves `JoinFacts.closest`,
        // refusing an ambiguous closest-pair tie (the conductor's
        // ruling for Task 4).
        let pair_indices = |role: PairRole| -> Result<(usize, usize), NeoError> {
            match role {
                PairRole::Chosen => Ok(s.chosen),
                PairRole::ClosestRaw => {
                    if f.closest.len() != 1 {
                        return Err(invalid(
                            "role",
                            "closest_raw cannot name a pair: the closest raw pair is tied",
                        ));
                    }
                    let (a, b) = &f.closest[0];
                    let (Some(ia), Some(ib)) = (
                        self.index_named(&s.active, a),
                        self.index_named(&s.active, b),
                    ) else {
                        return Err(invalid("role", "the closest pair is not active"));
                    };
                    Ok((ia, ib))
                }
                _ => Err(invalid("role", "a member→new edge is not a pair of nodes")),
            }
        };
        // The member NAMES a pair role covers — used by `new_distance`,
        // whose `new_row` entries are keyed by remaining node.
        let pair_names = |role: PairRole| -> Result<(String, String), NeoError> {
            match role {
                PairRole::Chosen => Ok(f.chosen.clone()),
                PairRole::ClosestRaw => {
                    if f.closest.len() != 1 {
                        return Err(invalid(
                            "role",
                            "closest_raw cannot name a pair: the closest raw pair is tied",
                        ));
                    }
                    Ok(f.closest[0].clone())
                }
                _ => Err(invalid("role", "a member→new edge is not a pair of nodes")),
            }
        };
        let value = match (quantity, role) {
            (Quantity::QValue, PairRole::Chosen | PairRole::ClosestRaw) => {
                let Some(q) = &s.q else {
                    return Err(invalid(
                        "quantity",
                        "q_value needs an NJ join — UPGMA and the final join have no Q matrix",
                    ));
                };
                let (i, j) = pair_indices(role)?;
                q.data
                    .get(i * q.n + j)
                    .copied()
                    .ok_or_else(|| invalid("quantity", "q cell out of range"))?
            }
            (Quantity::CorrectedDistance, PairRole::Chosen | PairRole::ClosestRaw) => {
                let (i, j) = pair_indices(role)?;
                s.distance
                    .data
                    .get(i * s.distance.n + j)
                    .copied()
                    .ok_or_else(|| invalid("quantity", "distance cell out of range"))?
            }
            (Quantity::NewDistance, PairRole::Chosen | PairRole::ClosestRaw) => {
                let (a, b) = pair_names(role)?;
                // The new node's distance to the nearer still-active
                // member of the pair.
                let mut best: Option<f64> = None;
                for (id, v) in &s.new_row {
                    let name = self.name_of(*id);
                    if name == a || name == b {
                        best = Some(best.map_or(*v, |x: f64| x.min(*v)));
                    }
                }
                best.ok_or_else(|| {
                    invalid("role", "the pair's members were joined — no new distance")
                })?
            }
            (Quantity::BranchLength, PairRole::ChosenFirstToNew) => s.len_i,
            (Quantity::BranchLength, PairRole::ChosenSecondToNew) => s.len_j,
            (Quantity::QValue, _)
            | (Quantity::CorrectedDistance, _)
            | (Quantity::NewDistance, _) => {
                return Err(invalid(
                    "role",
                    "a member→new edge carries no pair quantity",
                ))
            }
            (Quantity::BranchLength, _) => {
                return Err(invalid("role", "a pair of nodes is not a member→new edge"))
            }
        };
        scaled_quantity(quantity, value)
    }
}

/// The active nodes left after the join, paired with their new-node
/// distances (the trace's `new_row` order).
fn remaining(active: &[NodeId], chosen: (usize, usize), new_row: &[f64]) -> Vec<(NodeId, f64)> {
    active
        .iter()
        .copied()
        .enumerate()
        .filter(|(k, _)| *k != chosen.0 && *k != chosen.1)
        .map(|(_, id)| id)
        .zip(new_row.iter().copied())
        .collect()
}

/// One join step's data, resolved to owned values.
struct StepData<'a> {
    /// Active cluster nodes before the join, in trace order.
    active: Vec<NodeId>,
    /// The step's distance matrix over `active`.
    distance: Matrix,
    /// NJ's Q matrix; `None` for UPGMA and the final join.
    q: Option<Matrix>,
    /// `active` indices of the joined pair, `i < j`.
    chosen: (usize, usize),
    len_i: f64,
    len_j: f64,
    /// Remaining nodes → their new-node distance, in trace order.
    new_row: Vec<(NodeId, f64)>,
    /// Each active node's canonical tip index (lowest tip index of
    /// its leaf set, in matrix-label order).
    canonical: Vec<u16>,
    /// Tip index → `active` index of the cluster containing it.
    cluster_of: Vec<usize>,
    /// The worksheet facts of the same join — `tied`, `closest`,
    /// `chosen` names.
    facts: &'a JoinFacts,
}

impl StepData<'_> {
    /// The canonical tip index of the cluster containing tip `t`, or
    /// `None` when `t` is out of range.
    fn canonical(&self, t: u16) -> Option<u16> {
        let k = *self.cluster_of.get(t as usize)?;
        (k != usize::MAX).then(|| self.canonical[k])
    }
}

/// Leaf labels under `id` (the node's whole tip set), DFS.
fn leaf_tips(tree: &Tree, id: NodeId) -> Vec<String> {
    let mut out = Vec::new();
    let mut stack = vec![id];
    while let Some(cur) = stack.pop() {
        let Some(node) = tree.nodes.get(cur.0 as usize) else {
            continue;
        };
        if node.children.is_empty() {
            if let Some(l) = &node.label {
                out.push(l.clone());
            }
        } else {
            stack.extend(node.children.iter().copied());
        }
    }
    out
}

// --- predict_branch -----------------------------------------------------------

/// The seeded bootstrap run behind a `predict_branch` task — the
/// same tally the app draws (`bootstrapKeyFacts`), seeded from the
/// variant.
struct BranchRun {
    /// Canonical grouping (sorted tip labels) → its support.
    by_key: BTreeMap<Vec<String>, f64>,
    /// The least-supported grouping's key and support.
    weakest: CladeKey,
    weakest_support: f64,
}

fn branch_run(variant: &Variant) -> Result<BranchRun, NeoError> {
    let Content::Exercise(ex) = &variant.content else {
        return Err(invalid("content", "predict_branch needs exercise content"));
    };
    let aln = exercise_alignment(ex)?;
    let filter = ex.analysis.site_filter.unwrap_or(SiteFilter::Pairwise);
    // Spec §5.6: bootstrap tasks fix the settings — replicates and
    // seed come from the variant content's own `bootstrap` block (the
    // single source the app's panel reads — never `variant.seed`); a
    // variant without one falls back to the app's defaults
    // (`web/src/state/bootstrap.ts`: 100 replicates, seed 1).
    let (replicates, seed) = ex
        .bootstrap
        .map(|b| (b.replicates.min(200), b.seed))
        .unwrap_or((100, 1));
    let tally = bootstrap_batch_filtered(
        &aln,
        ex.analysis.correction,
        ex.analysis.method,
        filter,
        seed,
        0,
        replicates,
    )?;
    let m = compute_filtered(&aln, ex.analysis.correction, filter)?;
    let tree = build_tree(&m, ex.analysis.method, BuildOptions { trace: false })?.tree;
    let st = support_on_tree(&tree, &tally);
    let rooted = ex.analysis.method == Method::Upgma;
    let splits = tree_splits(&tree, &tally.labels, rooted);
    // In-scope internal branches are exactly the ones `support_on_tree`
    // annotated (spec §3.4, §3.7 — the duplicate-root-side dedup
    // included); the weakest is the first minimum in node order.
    let mut by_key = BTreeMap::new();
    let mut weakest: Option<(Vec<String>, f64)> = None;
    for (id, split) in &splits {
        let Some(support) = st.branches[id.0 as usize].support else {
            continue;
        };
        let key = split.labels(&tally.labels);
        by_key.insert(key.clone(), support);
        if weakest.as_ref().is_none_or(|(_, s)| support < *s) {
            weakest = Some((key, support));
        }
    }
    let Some((weakest, weakest_support)) = weakest else {
        return Err(invalid(
            "content",
            "the inferred tree has no internal branches",
        ));
    };
    Ok(BranchRun {
        by_key,
        weakest,
        weakest_support,
    })
}
