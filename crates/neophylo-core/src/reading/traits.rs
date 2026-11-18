//! Trait marks → tip states (v1.4d spec §4.3 `trait`, §5.2, plan Task 3).
//!
//! A [`Mark`] sits on the branch leading to the clade named by `on`
//! (a branch is named by the clade below it). Tip states are computed by
//! walking the root→tip path and applying each branch's marks for the
//! trait in the order listed; the root state is `false` — matching the
//! independent `ape::nodepath` oracle in `fixtures/generate_reading.R`.

use std::collections::{BTreeMap, HashMap};

use serde::{Deserialize, Serialize};

use crate::error::NeoError;
use crate::reading::query::{clade_key, tip_node, CladeKey};
use crate::tree::{NodeId, Tree};

/// A trait change on the branch above the clade `on`; `trait` is renamed
/// because `trait` is a Rust keyword.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Mark {
    /// Tip set of the node below the marked branch.
    pub on: CladeKey,
    #[serde(rename = "trait")]
    pub trait_name: String,
    pub change: Change,
}

/// The direction of a trait change; JSON `"gain"` / `"loss"`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Change {
    Gain,
    Loss,
}

/// Nodes on the path from the root to `id`, root first, `id` last;
/// cycle-guarded.
fn path_from_root(tree: &Tree, id: NodeId) -> Vec<NodeId> {
    let mut path = Vec::new();
    let mut cur = Some(id);
    while let Some(nid) = cur {
        if path.contains(&nid) {
            break;
        }
        path.push(nid);
        cur = tree.nodes.get(nid.0 as usize).and_then(|n| n.parent);
    }
    path.reverse();
    path
}

/// Each tip's state of `trait_name`: `false` at the root, then every
/// branch on the root→tip path applies its marks for the trait in the
/// order listed. Marks naming a clade the tree does not contain simply
/// apply to no branch (branch validity is checked at load, Task 4).
pub fn tip_states(
    tree: &Tree,
    marks: &[Mark],
    trait_name: &str,
) -> Result<BTreeMap<String, bool>, NeoError> {
    let keys: HashMap<NodeId, CladeKey> = tree
        .preorder()
        .into_iter()
        .map(|id| (id, clade_key(tree, id)))
        .collect();
    let mut out = BTreeMap::new();
    for id in tree.preorder() {
        if !tree.is_leaf(id) {
            continue;
        }
        let mut state = false;
        for &nd in &path_from_root(tree, id) {
            if nd == tree.root {
                continue;
            }
            let Some(k) = keys.get(&nd) else {
                continue;
            };
            for m in marks {
                if m.trait_name == trait_name && &m.on == k {
                    state = m.change == Change::Gain;
                }
            }
        }
        let label = tree.nodes[id.0 as usize].label.clone().unwrap_or_default();
        out.insert(label, state);
    }
    Ok(out)
}

/// The number of marks recorded for `trait_name` — the "how many times
/// did T change" answer.
pub fn change_count(marks: &[Mark], trait_name: &str) -> u32 {
    marks.iter().filter(|m| m.trait_name == trait_name).count() as u32
}

/// Whether `x` and `y` share one origin of `trait_name`: a single gain
/// mark lies on both root paths — i.e. its `on` clade contains both tips.
/// Unknown tips give `InvalidReading` with `field` "tips".
pub fn origins_shared(
    tree: &Tree,
    marks: &[Mark],
    trait_name: &str,
    x: &str,
    y: &str,
) -> Result<bool, NeoError> {
    tip_node(tree, x)?;
    tip_node(tree, y)?;
    Ok(marks.iter().any(|m| {
        m.trait_name == trait_name
            && m.change == Change::Gain
            && m.on.iter().any(|t| t == x)
            && m.on.iter().any(|t| t == y)
    }))
}
