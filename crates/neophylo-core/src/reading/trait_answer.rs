//! Answers to `trait` asks — which have it, which trait is shared,
//! change counts, profiles, ancestral-or-derived, has-not and homology
//! (v1.4d spec §4.3, plan Task 4).

use std::collections::{BTreeMap, BTreeSet};

use crate::error::NeoError;
use crate::reading::answer::{derived_of, item_err, join_and};
use crate::reading::question::TraitAsk;
use crate::reading::resolve::ResolvedTree;
use crate::reading::response::{Accepted, AnswerKey};
use crate::reading::set::{invalid_item, Item};
use crate::reading::traits::{change_count, origins_shared, tip_states, Mark};

// --- trait answers ---------------------------------------------------------------------

pub(crate) fn trait_answer(
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
