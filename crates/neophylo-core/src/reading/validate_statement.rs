//! Validation of `select_true` statements and `trait` asks against an
//! item's resolved trees (v1.4d spec §5.1, plan Task 4).

use crate::error::NeoError;
use crate::reading::question::{Statement, TraitAsk};
use crate::reading::resolve::{resolve_tips, ResolvedTree};
use crate::reading::set::invalid_item;
use crate::reading::validate::known_trait;
/// Map a query error (item already empty) onto this item and field.
pub(crate) fn refield(item: &str, field: &str, e: NeoError) -> NeoError {
    match e {
        NeoError::InvalidReading { msg, .. } => invalid_item(item, field, msg),
        other => other,
    }
}

pub(crate) fn validate_ask(
    t0: &ResolvedTree,
    id: &str,
    ask: &mut TraitAsk,
) -> Result<(), NeoError> {
    let need_trait = |t: &str, f: &str| {
        if known_trait(t0, t) {
            Ok(())
        } else {
            Err(invalid_item(id, f, format!("unknown trait '{t}'")))
        }
    };
    let need_tip2 = |t: &str, f: &str| {
        if t0.tips.contains(t) {
            Ok(())
        } else {
            Err(invalid_item(id, f, format!("unknown tip '{t}'")))
        }
    };
    match ask {
        TraitAsk::WhichHave { trait_name } | TraitAsk::HowManyChanges { trait_name } => {
            need_trait(trait_name, "trait_name")?
        }
        TraitAsk::WhichShared { tips } => {
            *tips = resolve_tips(t0, tips, id, "tips")?;
            if tips.is_empty() {
                return Err(invalid_item(id, "tips", "which_shared needs tips"));
            }
        }
        TraitAsk::Profile { tip } => need_tip2(tip, "tip")?,
        TraitAsk::AncestralOrDerived { trait_name, tip } => {
            need_trait(trait_name, "trait_name")?;
            need_tip2(tip, "tip")?;
        }
        TraitAsk::HasNot { has, lacks } => {
            need_trait(has, "has")?;
            need_trait(lacks, "lacks")?;
        }
        TraitAsk::Homologous { trait_name, x, y } => {
            need_trait(trait_name, "trait_name")?;
            need_tip2(x, "x")?;
            need_tip2(y, "y")?;
        }
    }
    Ok(())
}

pub(crate) fn validate_statement(
    id: &str,
    trees: &[ResolvedTree],
    s: &mut Statement,
) -> Result<(), NeoError> {
    let t0 = &trees[0];
    let tree_at = |i: usize| -> Result<&ResolvedTree, NeoError> {
        trees
            .get(i)
            .ok_or_else(|| invalid_item(id, "statements", format!("no tree at index {i}")))
    };
    let need_letter = |l: &str| -> Result<(), NeoError> {
        if t0.letters.contains_key(l) {
            Ok(())
        } else {
            Err(invalid_item(
                id,
                "statements",
                format!("unknown node letter '{l}'"),
            ))
        }
    };
    match s {
        Statement::CloserThan { x, y, z, .. } => {
            for t in [x, y, z] {
                if !t0.tips.contains(t) {
                    return Err(invalid_item(id, "statements", format!("unknown tip '{t}'")));
                }
            }
        }
        Statement::IsClade { tips, .. } => {
            *tips = resolve_tips(t0, tips, id, "statements")?;
        }
        Statement::CladeInNotIn {
            tips,
            tree_i,
            tree_j,
            ..
        } => {
            let ti = tree_at(*tree_i)?;
            let tj = tree_at(*tree_j)?;
            *tips = resolve_tips(ti, tips, id, "statements")?;
            resolve_tips(tj, tips, id, "statements")?;
        }
        Statement::SameRelationships { tree_i, tree_j, .. } => {
            tree_at(*tree_i)?;
            tree_at(*tree_j)?;
        }
        Statement::OlderThan { p, q, .. } => {
            need_letter(p)?;
            need_letter(q)?;
        }
        Statement::OlderThanAge { p, .. } => {
            if t0.ages.is_none() {
                return Err(invalid_item(
                    id,
                    "statements",
                    "this statement needs times ages",
                ));
            }
            need_letter(p)?;
            let node = t0.letters[p.as_str()];
            let key = crate::reading::query::clade_key(&t0.tree, node);
            if t0.age_of(&key).is_none() {
                return Err(invalid_item(
                    id,
                    "statements",
                    format!("node '{p}' has no age"),
                ));
            }
        }
        Statement::LineageAtLeast { tip, .. } => {
            if t0.ages.is_none() {
                return Err(invalid_item(
                    id,
                    "statements",
                    "this statement needs times ages",
                ));
            }
            if !t0.tips.contains(tip) {
                return Err(invalid_item(
                    id,
                    "statements",
                    format!("unknown tip '{tip}'"),
                ));
            }
        }
        Statement::HasTrait {
            tip, trait_name, ..
        } => {
            if !t0.tips.contains(tip) {
                return Err(invalid_item(
                    id,
                    "statements",
                    format!("unknown tip '{tip}'"),
                ));
            }
            if !known_trait(t0, trait_name) {
                return Err(invalid_item(
                    id,
                    "statements",
                    format!("unknown trait '{trait_name}'"),
                ));
            }
        }
        Statement::SharedDerived {
            trait_name, tips, ..
        } => {
            if !known_trait(t0, trait_name) {
                return Err(invalid_item(
                    id,
                    "statements",
                    format!("unknown trait '{trait_name}'"),
                ));
            }
            *tips = resolve_tips(t0, tips, id, "statements")?;
        }
        Statement::GainedWithin { inner, outer, .. } => {
            for t in [inner, outer] {
                if !known_trait(t0, t) {
                    return Err(invalid_item(
                        id,
                        "statements",
                        format!("unknown trait '{t}'"),
                    ));
                }
            }
        }
    }
    Ok(())
}
