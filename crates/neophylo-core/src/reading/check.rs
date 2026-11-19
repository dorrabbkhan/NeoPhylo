//! `check`: compare a student [`Response`] with the engine
//! [`AnswerKey`] and return the [`Verdict`] (v1.4d spec §5.3, plan
//! Task 4).

use std::collections::BTreeSet;

use crate::error::NeoError;
use crate::reading::answer::{answer, sorted, sorted_usize};
use crate::reading::query::order_consistent;
use crate::reading::question::Question;
use crate::reading::resolve::{item_trees, ResolvedTree};
use crate::reading::response::{Accepted, Response, Verdict};
use crate::reading::set::{invalid_item, Item, ReadingSet};

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
    let Some(t0) = trees.first() else {
        return Err(invalid_item(
            &item.id,
            "trees",
            "an item shows at least one tree",
        ));
    };
    match (acc, r) {
        (Accepted::Choices(a), Response::Choice { index }) => Ok(a.len() == 1 && a[0] == *index),
        (Accepted::Choices(a), Response::Choices { indices }) => Ok(sorted_usize(indices) == *a),
        (Accepted::Clade(k), Response::Node { clade }) => {
            check_tips_exist(t0, clade, item)?;
            Ok(sorted(clade) == *k)
        }
        (Accepted::Clade(k), Response::Tips { tips }) => {
            check_tips_exist(t0, tips, item)?;
            Ok(sorted(tips) == *k)
        }
        (Accepted::Point(l), Response::Point { letter }) => {
            if !t0.points.contains_key(letter) {
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
            check_tips_exist(t0, tips, item)?;
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
