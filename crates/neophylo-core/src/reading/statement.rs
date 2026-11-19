//! `eval_statement`: evaluate one `select_true` statement template
//! against an item's resolved trees (v1.4d spec §4.3, plan Task 4).

use std::collections::BTreeSet;

use crate::error::NeoError;
use crate::reading::answer::item_err;
use crate::reading::query::{
    clade_key, closer, is_ancestor, is_clade, same_relationships, sister_tips, Closer,
};
use crate::reading::question::Statement;
use crate::reading::resolve::ResolvedTree;
use crate::reading::set::{invalid_item, Item};
use crate::reading::traits::{tip_states, Change, Mark};
use crate::tree::NodeId;

// --- statements ---------------------------------------------------------------------------

/// Evaluate one `select_true` statement against the item's trees.
/// Indices `tree_i`/`tree_j` name `item.trees`; statements without an
/// index run on the first tree.
pub(crate) fn eval_statement(
    item: &Item,
    trees: &[ResolvedTree],
    marks_of: &dyn Fn(usize) -> Vec<Mark>,
    s: &Statement,
) -> Result<bool, NeoError> {
    let id = item.id.as_str();
    let Some(t0) = trees.first() else {
        return Err(invalid_item(id, "trees", "an item shows at least one tree"));
    };
    let err = |e: NeoError| item_err(item, "statements", e);
    let tree_at = |i: usize| -> Result<&ResolvedTree, NeoError> {
        trees
            .get(i)
            .ok_or_else(|| invalid_item(id, "statements", format!("no tree at index {i}")))
    };
    let letter_node = |l: &str| -> Result<NodeId, NeoError> {
        t0.letters
            .get(l)
            .copied()
            .ok_or_else(|| invalid_item(id, "statements", format!("unknown node letter '{l}'")))
    };
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
        } => Ok(is_clade(&tree_at(*tree_i)?.tree, tips).map_err(err)?
            && !is_clade(&tree_at(*tree_j)?.tree, tips).map_err(err)?),
        Statement::SameRelationships { tree_i, tree_j, .. } => {
            // Different tip sets simply cannot show the same
            // relationships — the statement is false, not an error.
            Ok(
                same_relationships(&tree_at(*tree_i)?.tree, &tree_at(*tree_j)?.tree)
                    .unwrap_or(false),
            )
        }
        Statement::OlderThan { p, q, .. } => {
            let np = letter_node(p)?;
            let nq = letter_node(q)?;
            let kp = clade_key(&t0.tree, np);
            let kq = clade_key(&t0.tree, nq);
            match (t0.age_of(&kp), t0.age_of(&kq)) {
                (Some(a), Some(b)) => Ok(a > b),
                _ => Ok(is_ancestor(&t0.tree, np, nq)),
            }
        }
        Statement::OlderThanAge { p, age, .. } => {
            let n = letter_node(p)?;
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
            // already carried `outer`'s gain. On one shared branch the
            // listed order decides (as in `tip_states`): `outer`'s gain
            // listed before `inner`'s means the lineage carried `outer`
            // first; `inner` first means it did not.
            let marks = marks_of(0);
            Ok(marks.iter().enumerate().any(|(ii, mi)| {
                mi.trait_name == *inner
                    && mi.change == Change::Gain
                    && marks.iter().enumerate().any(|(oi, mo)| {
                        if mo.trait_name != *outer || mo.change != Change::Gain {
                            return false;
                        }
                        let same_branch =
                            mi.on.len() == mo.on.len() && mi.on.iter().all(|t| mo.on.contains(t));
                        if same_branch {
                            oi < ii
                        } else {
                            mi.on.iter().all(|t| mo.on.contains(t))
                        }
                    })
            }))
        }
    }
}
