//! Answers, explanations and `check` for reading items (v1.4d spec
//! §4.3, §5.3, plan Task 4).
//!
//! `answer` returns the [`AnswerKey`]: the [`Accepted`] answer plus a
//! short explanation built from fixed English templates (one per
//! question type; names and node letters fill the slots, "the node
//! joining x and y" stands in when a node is unlettered). `check`
//! compares a student [`Response`] and returns a [`Verdict`].
//!
//! Choice-index conventions (kept stable for the UI): the options of a
//! `which_differs` item are its trees in order followed by "all show
//! the same" at index `trees.len()`; a bare `is_clade` is 0 = clade /
//! 1 = not a clade; with `by_trait` it is 0 = mono-, 1 = para-,
//! 2 = polyphyletic; `ancestral_or_derived` is 0 = ancestral,
//! 1 = derived; `homologous` is 0 = homologous, 1 = independent.

use std::collections::{BTreeMap, BTreeSet};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::NeoError;
use crate::reading::query::{
    clade_key, closer, count_clades, is_ancestor, is_clade, mrca, order_consistent, outside_tips,
    restrict, rooted_clades, same_relationships, sister_tips, CladeKey, Closer,
};
use crate::reading::set::{
    invalid_item, item_trees, resolve, Item, PointAt, Question, ReadingSet, RelForm, ResolvedTree,
    Statement, TraitAsk,
};
use crate::reading::traits::{change_count, origins_shared, tip_states, Change, Mark};

// --- wire types ------------------------------------------------------------------

/// A student's response; `kind` tags the JSON.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(
    tag = "kind",
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum Response {
    Choice {
        index: usize,
    },
    Choices {
        indices: Vec<usize>,
    },
    Node {
        clade: CladeKey,
    },
    Point {
        letter: String,
    },
    Tips {
        tips: Vec<String>,
    },
    Order {
        letters: Vec<String>,
    },
    Number {
        value: u32,
    },
    Pairwise {
        #[ts(type = "\"B\" | \"C\" | \"Equal\"")]
        answer: Closer,
    },
    TwoTier {
        first: Box<Response>,
        reason: usize,
    },
}

/// The accepted answer of an item; adjacently tagged
/// (`{"kind": "clade", "value": [...]}`) because several variants carry
/// a bare tip set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
#[ts(
    tag = "kind",
    content = "value",
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum Accepted {
    /// Accepted option indices (`which_differs` may name the
    /// "all show the same" index `trees.len()`).
    Choices(Vec<usize>),
    /// A node named by its tip set (`mrca`, `smallest_clade`).
    Clade(CladeKey),
    /// A point letter (`mrca` with options, `place_taxon`).
    Point(String),
    /// Exactly this tip set (select-all questions).
    TipSet(CladeKey),
    /// Any one tip of the set, or the whole set — `closest_relative`
    /// accepts both the single-answer and the select-all response.
    AnyTipOf(CladeKey),
    /// `order_nodes` acceptance rule: "ancestry" (every linear
    /// extension) or "ages" (the unique order by age).
    Orders {
        rule: String,
    },
    Number(u32),
    Pairwise(#[ts(type = "\"B\" | \"C\" | \"Equal\"")] Closer),
    /// Per-statement truth values for `select_true`.
    Statements(Vec<bool>),
    TwoTier {
        first: Box<Accepted>,
        reason: usize,
    },
}

/// The engine key for one item. `authored` marks the parts the file
/// wrote itself (concept answers and `two_tier` reasons — labelled
/// "authored answer" wherever shown, spec §4.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct AnswerKey {
    pub accepted: Accepted,
    pub explanation: String,
    pub authored: bool,
}

/// `check`'s verdict: correctness plus the explanation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Verdict {
    pub correct: bool,
    pub explanation: String,
}

// --- small helpers ------------------------------------------------------------------

fn item_err(item: &Item, field: &str, e: NeoError) -> NeoError {
    match e {
        NeoError::InvalidReading { msg, .. } => invalid_item(&item.id, field, msg),
        other => other,
    }
}

/// "a and b" / "a, b and c".
fn join_and(list: &[String]) -> String {
    match list.len() {
        0 => String::new(),
        1 => list[0].clone(),
        2 => format!("{} and {}", list[0], list[1]),
        _ => {
            let (last, rest) = list.split_last().unwrap();
            format!("{} and {}", rest.join(", "), last)
        }
    }
}

fn sorted(tips: &[String]) -> Vec<String> {
    let mut v = tips.to_vec();
    v.sort();
    v.dedup();
    v
}

fn sorted_usize(v: &[usize]) -> Vec<usize> {
    let mut v = v.to_vec();
    v.sort();
    v.dedup();
    v
}

/// The tips whose `trait_name` state is derived (`true`).
fn derived_of(rt: &ResolvedTree, marks: &[Mark], trait_name: &str) -> Result<CladeKey, NeoError> {
    Ok(tip_states(&rt.tree, marks, trait_name)?
        .into_iter()
        .filter(|(_, s)| *s)
        .map(|(t, _)| t)
        .collect())
}

// --- the entry points -----------------------------------------------------------------

/// The engine's answer for `item` index of `set` (spec §5.3).
pub fn answer(set: &ReadingSet, item: usize) -> Result<AnswerKey, NeoError> {
    let item = set
        .items
        .get(item)
        .ok_or_else(|| invalid_item("", "item", format!("no item at index {item}")))?;
    let trees = item_trees(set, item)?;
    let marks_of = |i: usize| -> Vec<Mark> {
        set.trees
            .get(&item.trees[i])
            .map(|t| t.marks.clone())
            .unwrap_or_default()
    };
    answer_question(set, item, &trees, &marks_of)
}

/// `trees[i]` resolved for the item; `marks(i)` gives that tree's
/// marks. Split so `two_tier`'s nested question shares the context.
fn answer_question(
    set: &ReadingSet,
    item: &Item,
    trees: &[ResolvedTree],
    marks_of: &dyn Fn(usize) -> Vec<Mark>,
) -> Result<AnswerKey, NeoError> {
    let id = item.id.as_str();
    let t0 = &trees[0];
    let marks0 = marks_of(0);
    let key = |accepted: Accepted, explanation: String| {
        Ok(AnswerKey {
            accepted,
            explanation,
            authored: false,
        })
    };
    match &item.question {
        Question::WhichDiffers { reference } => {
            let (idx, expl) = which_differs(set, item, trees, reference.as_deref())?;
            key(Accepted::Choices(vec![idx]), expl)
        }
        Question::WhichFits { small } => {
            let mut fits = Vec::new();
            for (i, cand) in trees.iter().enumerate() {
                let mut ok = true;
                for s in small {
                    let st = set
                        .trees
                        .get(s)
                        .ok_or_else(|| invalid_item(id, "small", format!("unknown tree '{s}'")))?;
                    let small_t = resolve(s, st).map_err(|e| item_err(item, "small", e))?;
                    if !small_t.tips.is_subset(&cand.tips) {
                        ok = false;
                        break;
                    }
                    let tips: Vec<String> = small_t.tips.iter().cloned().collect();
                    let sub =
                        restrict(&cand.tree, &tips).map_err(|e| item_err(item, "trees", e))?;
                    let same = same_relationships(&sub, &small_t.tree)
                        .map_err(|e| item_err(item, "trees", e))?;
                    if !same {
                        ok = false;
                        break;
                    }
                }
                if ok {
                    fits.push(i);
                }
            }
            if fits.len() != 1 {
                return Err(invalid_item(
                    id,
                    "trees",
                    format!(
                        "which_fits needs exactly one fitting tree; {} fit",
                        fits.len()
                    ),
                ));
            }
            key(
                Accepted::Choices(fits.clone()),
                format!(
                    "tree '{}' agrees with every small tree.",
                    item.trees[fits[0]]
                ),
            )
        }
        Question::Mrca { options } => {
            let m = mrca(&t0.tree, &item.tips).map_err(|e| item_err(item, "tips", e))?;
            let k = clade_key(&t0.tree, m);
            let expl = format!(
                "the most recent common ancestor of {} is {}.",
                join_and(&item.tips),
                t0.node_desc(m)
            );
            match options {
                None => key(Accepted::Clade(k), expl),
                Some(opts) => {
                    let mut found: Vec<String> = opts
                        .iter()
                        .filter(|l| {
                            t0.points
                                .get(*l)
                                .is_some_and(|p| p.at == PointAt::Node && p.on == k)
                        })
                        .cloned()
                        .collect();
                    found.sort();
                    found.dedup();
                    if found.len() != 1 {
                        return Err(invalid_item(
                            id,
                            "options",
                            "exactly one option must sit on the MRCA node",
                        ));
                    }
                    key(
                        Accepted::Point(found[0].clone()),
                        format!("{expl} That is point {}.", found[0]),
                    )
                }
            }
        }
        Question::PlaceTaxon { name, sister } => {
            let m = mrca(&t0.tree, sister).map_err(|e| item_err(item, "sister", e))?;
            if m == t0.tree.root {
                return Err(invalid_item(id, "sister", "the root has no stem branch"));
            }
            let k = clade_key(&t0.tree, m);
            let point = t0
                .points
                .values()
                .find(|p| p.at == PointAt::Branch && p.on == k);
            let Some(p) = point else {
                return Err(invalid_item(
                    id,
                    "sister",
                    "no point sits on the stem branch",
                ));
            };
            key(
                Accepted::Point(p.letter.clone()),
                format!(
                    "{name} is sister to {}: it attaches at point {}.",
                    join_and(sister),
                    p.letter
                ),
            )
        }
        Question::IsClade { by_trait } => match by_trait {
            None => {
                let yes = is_clade(&t0.tree, &item.tips).map_err(|e| item_err(item, "tips", e))?;
                key(
                    Accepted::Choices(vec![!yes as usize]),
                    format!(
                        "{} {} a clade.",
                        join_and(&item.tips),
                        if yes { "form" } else { "do not form" }
                    ),
                )
            }
            Some(trait_name) => {
                let group = derived_of(t0, &marks0, trait_name)?;
                if group.is_empty() {
                    return Err(invalid_item(
                        id,
                        "by_trait",
                        format!("no taxon has '{trait_name}'"),
                    ));
                }
                let gains = marks0
                    .iter()
                    .filter(|m| m.trait_name == *trait_name && m.change == Change::Gain)
                    .count();
                // Spec §4.3's three-way rule: exactly a clade → mono;
                // one gain → para; several gains → poly.
                let (idx, why) =
                    if is_clade(&t0.tree, &group).map_err(|e| item_err(item, "by_trait", e))? {
                        (0usize, "they are exactly a clade")
                    } else if gains == 1 {
                        (
                            1usize,
                            "the trait arose once, but the group leaves out part of that clade",
                        )
                    } else {
                        (2usize, "the trait arose independently more than once")
                    };
                key(
                    Accepted::Choices(vec![idx]),
                    format!(
                        "the taxa with {trait_name} are {}phyletic: {why}.",
                        ["mono", "para", "poly"][idx]
                    ),
                )
            }
        },
        Question::SmallestClade => {
            let m = mrca(&t0.tree, &item.tips).map_err(|e| item_err(item, "tips", e))?;
            let k = clade_key(&t0.tree, m);
            key(
                Accepted::Clade(k),
                format!(
                    "the smallest clade containing {} is {}.",
                    join_and(&item.tips),
                    t0.node_desc(m)
                ),
            )
        }
        Question::ClosestRelative { form } => {
            let a = item.a.clone().unwrap_or_default();
            match form {
                RelForm::Closest => {
                    let s = sister_tips(&t0.tree, &a).map_err(|e| item_err(item, "a", e))?;
                    if s.is_empty() {
                        return Err(invalid_item(id, "a", format!("'{a}' has no sisters")));
                    }
                    key(
                        Accepted::AnyTipOf(s.clone()),
                        format!("{a}'s closest relatives are {}.", join_and(&s)),
                    )
                }
                RelForm::MostDistant => {
                    let s = outside_tips(&t0.tree, &a).map_err(|e| item_err(item, "a", e))?;
                    if s.is_empty() {
                        return Err(invalid_item(
                            id,
                            "a",
                            format!("nothing lies outside '{a}'s lineage"),
                        ));
                    }
                    key(
                        Accepted::AnyTipOf(s.clone()),
                        format!("the tips most distant from {a} are {}.", join_and(&s)),
                    )
                }
                RelForm::Pairwise => {
                    let b = item.b.clone().unwrap_or_default();
                    let c = item.c.clone().unwrap_or_default();
                    let v = closer(&t0.tree, &a, &b, &c).map_err(|e| item_err(item, "a", e))?;
                    let ab = mrca(&t0.tree, &[a.clone(), b.clone()])
                        .map_err(|e| item_err(item, "a", e))?;
                    let ac = mrca(&t0.tree, &[a.clone(), c.clone()])
                        .map_err(|e| item_err(item, "a", e))?;
                    let expl = match v {
                        Closer::Equal => format!(
                            "{a} is equally close to {b} and {c}: they meet at the same node."
                        ),
                        _ => {
                            let (near, far, x, y) = if v == Closer::B {
                                (ab, ac, &b, &c)
                            } else {
                                (ac, ab, &c, &b)
                            };
                            format!(
                                "{a} and {x} meet at {}; {a} and {y} meet at {}, which is older.",
                                t0.node_desc(near),
                                t0.node_desc(far)
                            )
                        }
                    };
                    key(Accepted::Pairwise(v), expl)
                }
            }
        }
        Question::CountClades => {
            let n = count_clades(&t0.tree);
            key(
                Accepted::Number(n),
                format!("the tree has {n} clades (internal nodes including the root)."),
            )
        }
        Question::OrderNodes { nodes } => {
            let rule = if t0.ages.is_some() {
                "ages"
            } else {
                "ancestry"
            };
            let expl = if rule == "ages" {
                let mut keyed: Vec<(f64, String)> = nodes
                    .iter()
                    .map(|l| {
                        let n = t0.letters[l];
                        (
                            t0.age_of(&clade_key(&t0.tree, n)).unwrap_or(f64::NAN),
                            l.clone(),
                        )
                    })
                    .collect();
                keyed.sort_by(|x, y| y.0.total_cmp(&x.0));
                format!(
                    "oldest to youngest by age: {}.",
                    keyed
                        .iter()
                        .map(|(_, l)| l.as_str())
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            } else {
                "nodes on different lineages cannot be ordered; every order consistent with ancestry is accepted.".to_string()
            };
            key(Accepted::Orders { rule: rule.into() }, expl)
        }
        Question::SelectTrue { statements } => {
            let mut vals = Vec::with_capacity(statements.len());
            for s in statements {
                vals.push(eval_statement(item, trees, marks_of, s)?);
            }
            let true_ix: Vec<String> = vals
                .iter()
                .enumerate()
                .filter(|(_, v)| **v)
                .map(|(i, _)| (i + 1).to_string())
                .collect();
            let expl = match true_ix.len() {
                0 => "no statement is true.".to_string(),
                _ => format!("statements {} are true.", join_and(&true_ix)),
            };
            key(Accepted::Statements(vals), expl)
        }
        Question::Trait { ask } => trait_answer(t0, &marks0, item, ask),
        Question::Concept { options, correct } => {
            let c = sorted_usize(correct);
            Ok(AnswerKey {
                accepted: Accepted::Choices(c.clone()),
                explanation: c
                    .iter()
                    .map(|&i| options.get(i).cloned().unwrap_or_default())
                    .collect::<Vec<_>>()
                    .join("; "),
                authored: true,
            })
        }
        Question::TwoTier {
            first,
            correct_reason,
            ..
        } => {
            // The inner question shares the item's trees and fields.
            let mut inner_item = item.clone();
            inner_item.question = (**first).clone();
            let inner = answer_question(set, &inner_item, trees, marks_of)?;
            Ok(AnswerKey {
                accepted: Accepted::TwoTier {
                    first: Box::new(inner.accepted),
                    reason: *correct_reason,
                },
                explanation: format!("{} (reason: authored answer)", inner.explanation),
                authored: true,
            })
        }
    }
}

/// `which_differs`: partition candidates by rooted equality; the unique
/// outlier (or the "all show the same" index `trees.len()`) is the
/// answer. With `reference`, candidates are compared to the reference
/// restricted to their tips.
fn which_differs(
    set: &ReadingSet,
    item: &Item,
    trees: &[ResolvedTree],
    reference: Option<&str>,
) -> Result<(usize, String), NeoError> {
    let id = item.id.as_str();
    if let Some(ref_name) = reference {
        let rt = set
            .trees
            .get(ref_name)
            .ok_or_else(|| invalid_item(id, "reference", format!("unknown tree '{ref_name}'")))?;
        let reft = resolve(ref_name, rt).map_err(|e| item_err(item, "reference", e))?;
        let mut differs = Vec::new();
        for (i, cand) in trees.iter().enumerate() {
            let tips: Vec<String> = cand.tips.iter().cloned().collect();
            let sub = restrict(&reft.tree, &tips).map_err(|e| item_err(item, "trees", e))?;
            if !same_relationships(&sub, &cand.tree).unwrap_or(false) {
                differs.push(i);
            }
        }
        if differs.len() != 1 {
            return Err(invalid_item(
                id,
                "trees",
                format!(
                    "which_differs needs exactly one tree conflicting with the reference; {} conflict",
                    differs.len()
                ),
            ));
        }
        return Ok((
            differs[0],
            format!(
                "tree '{}' conflicts with the reference tree.",
                item.trees[differs[0]]
            ),
        ));
    }

    let n = trees.len();
    // A tree is the outlier when it differs from every other tree and
    // all the others agree among themselves.
    let mut diff = Vec::new();
    for i in 0..n {
        let outlier = trees.iter().enumerate().all(|(j, tj)| {
            i == j || !same_relationships(&trees[i].tree, &tj.tree).unwrap_or(false)
        });
        if outlier {
            diff.push(i);
        }
    }
    if diff.is_empty() {
        return Ok((n, "all the trees show the same relationships.".to_string()));
    }
    if diff.len() == 1 && others_agree(trees, diff[0]) {
        let i = diff[0];
        return Ok((
            i,
            format!(
                "tree '{}' is the only one that groups {}.",
                item.trees[i],
                join_and(&distinguishing_clade(trees, i))
            ),
        ));
    }
    Err(invalid_item(
        id,
        "trees",
        "which_differs needs a unique differing tree",
    ))
}

/// Every tree except `outlier` is equal to every other — the outlier is
/// the unique answer.
fn others_agree(trees: &[ResolvedTree], outlier: usize) -> bool {
    trees.iter().enumerate().all(|(i, ti)| {
        trees.iter().enumerate().all(|(j, tj)| {
            i == outlier
                || j == outlier
                || i == j
                || same_relationships(&ti.tree, &tj.tree).unwrap_or(false)
        })
    })
}

/// A clade the differing tree has that no other candidate has — used in
/// its explanation. Falls back to the root clade.
fn distinguishing_clade(trees: &[ResolvedTree], i: usize) -> CladeKey {
    let others: BTreeSet<CladeKey> = trees
        .iter()
        .enumerate()
        .filter(|(j, _)| *j != i)
        .flat_map(|(_, t)| rooted_clades(&t.tree))
        .collect();
    rooted_clades(&trees[i].tree)
        .into_iter()
        .filter(|c| !others.contains(c))
        .min_by_key(|c| (c.len(), c.clone()))
        .unwrap_or_else(|| trees[i].tips.iter().cloned().collect())
}

// --- trait answers ---------------------------------------------------------------------

fn trait_answer(
    t0: &ResolvedTree,
    marks: &[Mark],
    item: &Item,
    ask: &TraitAsk,
) -> Result<AnswerKey, NeoError> {
    let id = item.id.as_str();
    let key = |accepted: Accepted, explanation: String| {
        Ok(AnswerKey {
            accepted,
            explanation,
            authored: false,
        })
    };
    let state_of = |trait_name: &str| -> Result<BTreeMap<String, bool>, NeoError> {
        tip_states(&t0.tree, marks, trait_name).map_err(|e| item_err(item, "ask", e))
    };
    match ask {
        TraitAsk::WhichHave { trait_name } => {
            let group = derived_of(t0, marks, trait_name)?;
            if group.is_empty() {
                return Err(invalid_item(
                    id,
                    "trait_name",
                    format!("no taxon has '{trait_name}'"),
                ));
            }
            key(
                Accepted::TipSet(group.clone()),
                format!("{} have {trait_name}.", join_and(&group)),
            )
        }
        TraitAsk::WhichShared { tips } => {
            let want: BTreeSet<String> = tips.iter().cloned().collect();
            let mut found = Vec::new();
            for (i, name) in t0.trait_names.iter().enumerate() {
                let got: BTreeSet<String> = state_of(name)?
                    .into_iter()
                    .filter(|(_, s)| *s)
                    .map(|(t, _)| t)
                    .collect();
                if got == want {
                    found.push((i, name.clone()));
                }
            }
            if found.len() != 1 {
                return Err(invalid_item(
                    id,
                    "tips",
                    "which_shared needs exactly one matching trait",
                ));
            }
            let (i, name) = &found[0];
            key(
                Accepted::Choices(vec![*i]),
                format!("{name} is shared by exactly {}.", join_and(tips)),
            )
        }
        TraitAsk::HowManyChanges { trait_name } => {
            let n = change_count(marks, trait_name);
            key(
                Accepted::Number(n),
                format!("{trait_name} changes {n} times."),
            )
        }
        TraitAsk::Profile { tip } => {
            let mut idxs = Vec::new();
            let mut names = Vec::new();
            for (i, name) in t0.trait_names.iter().enumerate() {
                if state_of(name)?.get(tip).copied().unwrap_or(false) {
                    idxs.push(i);
                    names.push(name.clone());
                }
            }
            let expl = if names.is_empty() {
                format!("{tip} has no derived states.")
            } else {
                format!("{tip} has the derived state of {}.", join_and(&names))
            };
            key(Accepted::Choices(idxs), expl)
        }
        TraitAsk::AncestralOrDerived { trait_name, tip } => {
            let derived = state_of(trait_name)?.get(tip).copied().unwrap_or(false);
            key(
                Accepted::Choices(vec![derived as usize]),
                format!(
                    "{trait_name} is {} in {tip}.",
                    if derived { "derived" } else { "ancestral" }
                ),
            )
        }
        TraitAsk::HasNot { has, lacks } => {
            let sh = state_of(has)?;
            let sl = state_of(lacks)?;
            let group: Vec<String> = sh
                .iter()
                .filter(|(t, s)| **s && !sl.get(*t).copied().unwrap_or(false))
                .map(|(t, _)| t.clone())
                .collect();
            if group.is_empty() {
                return Err(invalid_item(
                    id,
                    "has",
                    format!("no taxon has '{has}' and lacks '{lacks}'"),
                ));
            }
            key(
                Accepted::TipSet(group.clone()),
                format!("{} have {has} but lack {lacks}.", join_and(&group)),
            )
        }
        TraitAsk::Homologous { trait_name, x, y } => {
            let shared = origins_shared(&t0.tree, marks, trait_name, x, y)
                .map_err(|e| item_err(item, "ask", e))?;
            key(
                Accepted::Choices(vec![!shared as usize]),
                format!(
                    "{trait_name} in {x} and {y} {}.",
                    if shared {
                        "is homologous: a single gain covers both"
                    } else {
                        "arose independently: separate gains"
                    }
                ),
            )
        }
    }
}

// --- statements ---------------------------------------------------------------------------

/// Evaluate one `select_true` statement against the item's trees.
/// Indices `tree_i`/`tree_j` name `item.trees`; statements without an
/// index run on the first tree.
fn eval_statement(
    item: &Item,
    trees: &[ResolvedTree],
    marks_of: &dyn Fn(usize) -> Vec<Mark>,
    s: &Statement,
) -> Result<bool, NeoError> {
    let t0 = &trees[0];
    let err = |e: NeoError| item_err(item, "statements", e);
    match s {
        Statement::CloserThan { x, y, z, .. } => {
            Ok(closer(&t0.tree, x, y, z).map_err(err)? == Closer::B)
        }
        Statement::IsClade { tips, .. } => is_clade(&t0.tree, tips).map_err(err),
        Statement::CladeInNotIn {
            tips,
            tree_i,
            tree_j,
            ..
        } => Ok(is_clade(&trees[*tree_i].tree, tips).map_err(err)?
            && !is_clade(&trees[*tree_j].tree, tips).map_err(err)?),
        Statement::SameRelationships { tree_i, tree_j, .. } => {
            // Different tip sets simply cannot show the same
            // relationships — the statement is false, not an error.
            Ok(same_relationships(&trees[*tree_i].tree, &trees[*tree_j].tree).unwrap_or(false))
        }
        Statement::OlderThan { p, q, .. } => {
            let np = t0.letters[p.as_str()];
            let nq = t0.letters[q.as_str()];
            let kp = clade_key(&t0.tree, np);
            let kq = clade_key(&t0.tree, nq);
            match (t0.age_of(&kp), t0.age_of(&kq)) {
                (Some(a), Some(b)) => Ok(a > b),
                _ => Ok(is_ancestor(&t0.tree, np, nq)),
            }
        }
        Statement::OlderThanAge { p, age, .. } => {
            let n = t0.letters[p.as_str()];
            Ok(t0.age_of(&clade_key(&t0.tree, n)).unwrap_or(0.0) > *age)
        }
        Statement::LineageAtLeast { tip, age, .. } => {
            // A lineage is at least as old as its sister group's oldest
            // fossil tip (spec §4.3).
            let sisters = sister_tips(&t0.tree, tip).map_err(err)?;
            let bound = sisters
                .iter()
                .map(|t| t0.tip_age(t))
                .fold(0.0_f64, f64::max);
            Ok(bound >= *age)
        }
        Statement::HasTrait {
            tip, trait_name, ..
        } => Ok(tip_states(&t0.tree, &marks_of(0), trait_name)
            .map_err(err)?
            .get(tip)
            .copied()
            .unwrap_or(false)),
        Statement::SharedDerived {
            trait_name, tips, ..
        } => {
            let states = tip_states(&t0.tree, &marks_of(0), trait_name).map_err(err)?;
            if !tips.iter().all(|t| states.get(t).copied().unwrap_or(false)) {
                return Ok(false);
            }
            // One gain whose clade covers all the tips = shared derived.
            let want: BTreeSet<String> = tips.iter().cloned().collect();
            Ok(marks_of(0).iter().any(|m| {
                m.trait_name == *trait_name
                    && m.change == Change::Gain
                    && want.iter().all(|t| m.on.contains(t))
            }))
        }
        Statement::GainedWithin { inner, outer, .. } => {
            // `inner` arose on a branch strictly inside a clade that
            // already carried `outer`'s gain.
            let marks = marks_of(0);
            Ok(marks.iter().any(|mi| {
                mi.trait_name == *inner
                    && mi.change == Change::Gain
                    && marks.iter().any(|mo| {
                        mo.trait_name == *outer
                            && mo.change == Change::Gain
                            && mi.on.iter().all(|t| mo.on.contains(t))
                            && mi.on != mo.on
                    })
            }))
        }
    }
}

// --- check ---------------------------------------------------------------------------------

/// Compare a student [`Response`] with the engine key (spec §5.3).
/// A response that names nothing the item knows — a bad kind, an
/// unknown point letter, an unknown tip — is `InvalidReading` with
/// `field` "response", never a panic.
pub fn check(set: &ReadingSet, item: usize, r: &Response) -> Result<Verdict, NeoError> {
    let item_ref = set
        .items
        .get(item)
        .ok_or_else(|| invalid_item("", "item", format!("no item at index {item}")))?;
    let key = answer(set, item)?;
    let trees = item_trees(set, item_ref)?;
    let ok = matches(item_ref, &trees, &item_ref.question, &key.accepted, r)?;
    Ok(Verdict {
        correct: ok,
        explanation: key.explanation,
    })
}

fn wrong_kind(item: &Item) -> NeoError {
    invalid_item(
        &item.id,
        "response",
        "the response kind does not fit the question",
    )
}

fn matches(
    item: &Item,
    trees: &[ResolvedTree],
    q: &Question,
    acc: &Accepted,
    r: &Response,
) -> Result<bool, NeoError> {
    match (acc, r) {
        (Accepted::Choices(a), Response::Choice { index }) => Ok(a.len() == 1 && a[0] == *index),
        (Accepted::Choices(a), Response::Choices { indices }) => Ok(sorted_usize(indices) == *a),
        (Accepted::Clade(k), Response::Node { clade }) => {
            check_tips_exist(&trees[0], clade, item)?;
            Ok(sorted(clade) == *k)
        }
        (Accepted::Clade(k), Response::Tips { tips }) => {
            check_tips_exist(&trees[0], tips, item)?;
            Ok(sorted(tips) == *k)
        }
        (Accepted::Point(l), Response::Point { letter }) => {
            if !trees[0].points.contains_key(letter) {
                return Err(invalid_item(
                    &item.id,
                    "response",
                    format!("unknown point letter '{letter}'"),
                ));
            }
            Ok(l == letter)
        }
        (Accepted::TipSet(k), Response::Tips { tips })
        | (Accepted::AnyTipOf(k), Response::Tips { tips }) => {
            check_tips_exist(&trees[0], tips, item)?;
            let whole = sorted(tips) == *k;
            // AnyTipOf also accepts a single tip of the set — the
            // single-answer form of closest_relative.
            let single =
                matches!(acc, Accepted::AnyTipOf(_)) && tips.len() == 1 && k.contains(&tips[0]);
            Ok(whole || single)
        }
        (Accepted::Orders { .. }, Response::Order { letters }) => {
            let Question::OrderNodes { nodes } = q else {
                return Err(wrong_kind(item));
            };
            if sorted(letters) != sorted(nodes) {
                return Ok(false); // not a permutation of the item's nodes
            }
            let t0 = &trees[0];
            let mut ids = Vec::new();
            for l in letters {
                let Some(&n) = t0.letters.get(l) else {
                    return Err(invalid_item(
                        &item.id,
                        "response",
                        format!("unknown node letter '{l}'"),
                    ));
                };
                ids.push(n);
            }
            // `ages` is `Some` exactly under `Times::Ages`, which is the
            // "ages" rule; otherwise the ancestry order rules.
            Ok(order_consistent(&t0.tree, &ids, t0.ages.as_ref()))
        }
        (Accepted::Number(n), Response::Number { value }) => Ok(n == value),
        (Accepted::Pairwise(v), Response::Pairwise { answer }) => Ok(v == answer),
        (Accepted::Statements(vals), Response::Choices { indices }) => {
            if indices.iter().any(|&i| i >= vals.len()) {
                return Err(invalid_item(
                    &item.id,
                    "response",
                    "a selected statement does not exist",
                ));
            }
            let selected: BTreeSet<usize> = indices.iter().copied().collect();
            Ok(vals
                .iter()
                .enumerate()
                .all(|(i, v)| *v == selected.contains(&i)))
        }
        (
            Accepted::TwoTier { first, reason },
            Response::TwoTier {
                first: r_first,
                reason: r_reason,
            },
        ) => {
            let Question::TwoTier { first: fq, .. } = q else {
                return Err(wrong_kind(item));
            };
            let inner = matches(item, trees, fq, first, r_first)?;
            Ok(inner && reason == r_reason)
        }
        _ => Err(wrong_kind(item)),
    }
}

/// Responses naming unknown tips are malformed.
fn check_tips_exist(rt: &ResolvedTree, tips: &[String], item: &Item) -> Result<(), NeoError> {
    for t in tips {
        if !rt.tips.contains(t) {
            return Err(invalid_item(
                &item.id,
                "response",
                format!("unknown tip '{t}'"),
            ));
        }
    }
    Ok(())
}
