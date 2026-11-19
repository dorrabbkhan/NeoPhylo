//! `which_differs`: partition an item's candidate trees by rooted
//! equality and name the unique outlier, with the distinguishing clade
//! for its explanation (v1.4d spec §4.3, plan Task 4).

use std::collections::BTreeSet;

use crate::error::NeoError;
use crate::reading::answer::{item_err, join_and};
use crate::reading::query::{restrict, rooted_clades, same_relationships, CladeKey};
use crate::reading::resolve::{resolve, ResolvedTree};
use crate::reading::set::{invalid_item, Item, ReadingSet};

/// `which_differs`: partition candidates by rooted equality; the unique
/// outlier (or the "all show the same" index `trees.len()`) is the
/// answer. With `reference`, candidates are compared to the reference
/// restricted to their tips.
pub(crate) fn which_differs(
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
        // Index n = "all show the same": every candidate agrees with
        // the reference. Exactly one conflict is the unique outlier;
        // anything else is refused (spec §4.3).
        match differs.len() {
            0 => {
                return Ok((
                    trees.len(),
                    "every tree agrees with the reference tree.".to_string(),
                ));
            }
            1 => {
                return Ok((
                    differs[0],
                    format!(
                        "tree '{}' conflicts with the reference tree.",
                        item.trees[differs[0]]
                    ),
                ));
            }
            _ => {
                return Err(invalid_item(
                    id,
                    "trees",
                    format!(
                        "which_differs needs at most one tree conflicting with the reference; {} conflict",
                        differs.len()
                    ),
                ));
            }
        }
    }

    let n = trees.len();
    // Index n = "all show the same" holds only when every pair of
    // trees agrees — not merely when no single outlier exists (two
    // disjoint pairs of equal trees is refused, spec §4.3).
    let all_same = trees.iter().enumerate().all(|(i, ti)| {
        trees
            .iter()
            .enumerate()
            .all(|(j, tj)| i == j || same_relationships(&ti.tree, &tj.tree).unwrap_or(false))
    });
    if all_same {
        return Ok((n, "all the trees show the same relationships.".to_string()));
    }
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
