//! Deterministic seeded variants of a reading set (v1.4d spec §5.4,
//! plan Task 4). All draws come from `ChaCha8Rng` seeded with `seed`,
//! consumed in a fixed order (trees in name order, nodes in preorder),
//! so a seed always yields the same variant.
//!
//! - [`rotate`] — seeded coin flip per internal node: reverse its
//!   children. Topology (and every clade key, hence every answer) is
//!   unchanged; only the drawing order moves.
//! - [`shuffle_tip_order`] — a seeded Fisher–Yates shuffle of each
//!   internal node's children: a uniform random drawing order of the
//!   same topology.
//! - [`relabel`] — for each `taxa_pool` list a seeded permutation of
//!   the pool itself; every tree tip that is a pool member takes the
//!   name at its permuted index, consistently across trees, item
//!   fields and statements. Tips not in any pool keep their names.
//!
//! Answers are never copied across — they are recomputed from the
//! transformed set, which is why rotation invariance and relabelling
//! equivariance are real properties (§5.5).

use std::collections::BTreeMap;

use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};

use crate::error::NeoError;
use crate::newick::{parse_newick, write_newick};
use crate::reading::set::{Question, ReadingSet, Statement, Times, TraitAsk};
use crate::tree::NodeId;

/// Fisher–Yates over `v` consuming `v.len()-1` draws.
fn shuffle<T>(v: &mut [T], rng: &mut ChaCha8Rng) {
    for i in (1..v.len()).rev() {
        let j = (rng.next_u64() % (i as u64 + 1)) as usize;
        v.swap(i, j);
    }
}

/// Reorder children at every internal node of every stored tree.
/// `how` decides the new order; `ids` are fixed before mutation so the
/// RNG is consumed in preorder regardless of rewrites.
fn reorder(
    set: &ReadingSet,
    seed: u64,
    how: impl Fn(&mut Vec<NodeId>, &mut ChaCha8Rng),
) -> ReadingSet {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    let mut out = set.clone();
    for rt in out.trees.values_mut() {
        let Ok(mut tree) = parse_newick(&rt.newick) else {
            continue;
        };
        let ids: Vec<NodeId> = tree.preorder();
        for id in ids {
            how(&mut tree.nodes[id.0 as usize].children, &mut rng);
        }
        rt.newick = write_newick(&tree);
    }
    out
}

/// Seeded rotation: each internal node's children are reversed with a
/// coin flip (spec §5.4 `rotate`).
pub fn rotate(set: &ReadingSet, seed: u64) -> ReadingSet {
    reorder(set, seed, |ch, rng| {
        if ch.len() > 1 && rng.next_u32() & 1 == 1 {
            ch.reverse();
        }
    })
}

/// Seeded tip-order shuffle: each internal node's children get a full
/// Fisher–Yates permutation (spec §5.4 `shuffle_tip_order`).
pub fn shuffle_tip_order(set: &ReadingSet, seed: u64) -> ReadingSet {
    reorder(set, seed, |ch, rng| shuffle(&mut ch[..], rng))
}

/// The tip-name permutation `relabel(set, seed)` applies: one seeded
/// permutation per `taxa_pool` list, `name → permuted name`. Names in
/// two pools take the first pool's image (pools are visited in map
/// order); names in no pool are absent — callers treat them as fixed.
pub fn relabel_map(set: &ReadingSet, seed: u64) -> Result<BTreeMap<String, String>, NeoError> {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    let mut map = BTreeMap::new();
    for pool in set.taxa_pool.values() {
        let mut perm = pool.clone();
        shuffle(&mut perm, &mut rng);
        for (i, from) in pool.iter().enumerate() {
            map.entry(from.clone()).or_insert_with(|| perm[i].clone());
        }
    }
    Ok(map)
}

/// Rename one taxon if the map covers it.
fn rename_one(name: &mut String, map: &BTreeMap<String, String>) {
    if let Some(new) = map.get(name) {
        *name = new.clone();
    }
}

/// Rename a clade key in place; re-sort and dedup so it stays
/// canonical.
fn rename_key(key: &mut Vec<String>, map: &BTreeMap<String, String>) {
    for t in key.iter_mut() {
        rename_one(t, map);
    }
    key.sort();
    key.dedup();
}

fn rename_question(q: &mut Question, map: &BTreeMap<String, String>) {
    match q {
        Question::PlaceTaxon { sister, .. } => rename_key(sister, map),
        Question::SelectTrue { statements } => {
            for s in statements {
                rename_statement(s, map);
            }
        }
        Question::Trait { ask } => match ask {
            TraitAsk::WhichShared { tips } => rename_key(tips, map),
            TraitAsk::Profile { tip } | TraitAsk::AncestralOrDerived { tip, .. } => {
                rename_one(tip, map)
            }
            TraitAsk::Homologous { x, y, .. } => {
                rename_one(x, map);
                rename_one(y, map);
            }
            _ => {}
        },
        Question::TwoTier { first, .. } => rename_question(first, map),
        _ => {}
    }
}

fn rename_statement(s: &mut Statement, map: &BTreeMap<String, String>) {
    match s {
        Statement::CloserThan { x, y, z, .. } => {
            rename_one(x, map);
            rename_one(y, map);
            rename_one(z, map);
        }
        Statement::IsClade { tips, .. }
        | Statement::CladeInNotIn { tips, .. }
        | Statement::SharedDerived { tips, .. } => rename_key(tips, map),
        Statement::LineageAtLeast { tip, .. } | Statement::HasTrait { tip, .. } => {
            rename_one(tip, map)
        }
        _ => {}
    }
}

/// Relabel every tree tip covered by a `taxa_pool` list through that
/// pool's seeded permutation (spec §5.4 `relabel`). The same map is
/// applied to stored clade keys and taxon-bearing item fields, so
/// accepted tip sets map through the same permutation (§5.5
/// equivariance).
///
/// Authored `text`/`Statement::text` strings are untouched: item text
/// refers to taxa only through `{a}`–`{c}`/`{set}` placeholders, and
/// statement text is authored content the engine must not rewrite.
pub fn relabel(set: &ReadingSet, seed: u64) -> Result<ReadingSet, NeoError> {
    let map = relabel_map(set, seed)?;
    let mut out = set.clone();
    for rt in out.trees.values_mut() {
        if let Ok(mut tree) = parse_newick(&rt.newick) {
            for n in &mut tree.nodes {
                if let Some(l) = &mut n.label {
                    rename_one(l, &map);
                }
            }
            rt.newick = write_newick(&tree);
        }
        for nl in &mut rt.node_letters {
            rename_key(&mut nl.on, &map);
        }
        if let Some(Times::Ages { ages, .. }) = &mut rt.times {
            for na in ages {
                rename_key(&mut na.on, &map);
            }
        }
        for m in &mut rt.marks {
            rename_key(&mut m.on, &map);
        }
        for p in &mut rt.points {
            rename_key(&mut p.on, &map);
        }
    }
    for item in &mut out.items {
        for x in [&mut item.a, &mut item.b, &mut item.c]
            .into_iter()
            .flatten()
        {
            rename_one(x, &map);
        }
        rename_key(&mut item.tips, &map);
        rename_question(&mut item.question, &map);
    }
    Ok(out)
}
