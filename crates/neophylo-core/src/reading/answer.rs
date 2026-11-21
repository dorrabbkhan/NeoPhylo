//! Answers, explanations and `check` for reading items (v1.4d spec
//! §4.3, §5.3, plan Task 4).
//!
//! `answer` returns the [`AnswerKey`]: the [`Accepted`] answer plus a
//! short explanation built from fixed English templates (one per
//! question type; names and node letters fill the slots, "the node
//! joining x and y" stands in when a node is unlettered). `check` (in
//! `crate::reading::check`) compares a student
//! [`crate::reading::Response`] and returns a
//! [`crate::reading::Verdict`]. `which_differs` lives in `differs`,
//! `trait` asks in `trait_answer`, `select_true` statements in
//! `statement`.
//!
//! Choice-index conventions (kept stable for the UI): the options of a
//! `which_differs` item are its trees in order followed by "all show
//! the same" at index `trees.len()`; a bare `is_clade` is 0 = clade /
//! 1 = not a clade; with `by_trait` it is 0 = mono-, 1 = para-,
//! 2 = polyphyletic; `ancestral_or_derived` is 0 = ancestral,
//! 1 = derived; `homologous` is 0 = homologous, 1 = independent.

use crate::error::NeoError;
use crate::reading::differs::which_differs;
use crate::reading::query::{
    clade_key, closer, count_clades, is_clade, mrca, outside_tips, restrict, same_relationships,
    sister_tips, CladeKey, Closer,
};
use crate::reading::question::{Question, RelForm};
use crate::reading::resolve::{item_trees, resolve, ResolvedTree};
use crate::reading::response::{Accepted, AnswerKey};
use crate::reading::set::{invalid_item, Item, Point, PointAt, ReadingSet};
use crate::reading::statement::eval_statement;
use crate::reading::trait_answer::trait_answer;
use crate::reading::traits::{tip_states, Change, Mark};

// --- small helpers ------------------------------------------------------------------

pub(crate) fn item_err(item: &Item, field: &str, e: NeoError) -> NeoError {
    match e {
        NeoError::InvalidReading { msg, .. } => invalid_item(&item.id, field, msg),
        other => other,
    }
}

/// "a and b" / "a, b and c".
pub(crate) fn join_and(list: &[String]) -> String {
    match list {
        [] => String::new(),
        [x] => x.clone(),
        [x, y] => format!("{x} and {y}"),
        [rest @ .., last] => format!("{} and {}", rest.join(", "), last),
    }
}

pub(crate) fn sorted(tips: &[String]) -> Vec<String> {
    let mut v = tips.to_vec();
    v.sort();
    v.dedup();
    v
}

pub(crate) fn sorted_usize(v: &[usize]) -> Vec<usize> {
    let mut v = v.to_vec();
    v.sort();
    v.dedup();
    v
}

/// The tips whose `trait_name` state is derived (`true`).
pub(crate) fn derived_of(
    rt: &ResolvedTree,
    marks: &[Mark],
    trait_name: &str,
) -> Result<CladeKey, NeoError> {
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
        item.trees
            .get(i)
            .and_then(|name| set.trees.get(name))
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
    // `set` need not come from `load_reading_set`: an item with no
    // trees is invalid, never a panic.
    let Some(t0) = trees.first() else {
        return Err(invalid_item(id, "trees", "an item shows at least one tree"));
    };
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
            let mut stem: Vec<&Point> = t0
                .points
                .values()
                .filter(|p| p.at == PointAt::Branch && sorted(&p.on) == k)
                .collect();
            stem.sort_by(|x, y| x.letter.cmp(&y.letter));
            let [p] = stem.as_slice() else {
                return Err(invalid_item(
                    id,
                    "sister",
                    "exactly one point must sit on the stem branch",
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
                let mut keyed: Vec<(f64, String)> = Vec::with_capacity(nodes.len());
                for l in nodes {
                    let Some(&n) = t0.letters.get(l) else {
                        return Err(invalid_item(
                            id,
                            "nodes",
                            format!("unknown node letter '{l}'"),
                        ));
                    };
                    keyed.push((
                        t0.age_of(&clade_key(&t0.tree, n)).unwrap_or(f64::NAN),
                        l.clone(),
                    ));
                }
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
                1 => format!("statement {} is true.", true_ix[0]),
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
