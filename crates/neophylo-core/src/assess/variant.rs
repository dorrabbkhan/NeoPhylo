//! Variant generation (v1.5 spec §5.2, plan Task 4): one student's
//! seeded content, with premise retry. Every transform draws from
//! `ChaCha8Rng` (the same stream `sim` and the reading transforms
//! use), seeded from tagged [`sub_seed`]s so independent parts never
//! share a stream.
//!
//! Per content kind:
//! - `Simulated` — `sim.seed` comes from the variant seed; the true
//!   tree's tips are relabelled by a seeded permutation of the
//!   exercise's own taxon names and the tree is rotated.
//! - `Matrix` with `reference.kind == "true"` — *derived*: a seeded
//!   random tree on the same taxa, its additive (patristic) matrix
//!   rounded to the author's decimals (see [`author_decimals`]); the
//!   generated tree becomes the true reference.
//! - `Matrix` without a true reference, `Embedded` data and labs —
//!   *fixed*: data is unchanged; only the bootstrap seed comes from
//!   the variant.
//! - Reading sets — the v1.4d transforms: `rotate`,
//!   `shuffle_tip_order`, `relabel`, each on its own sub-seed.
//!
//! Retry (plan's Decided block): attempt 0 uses `seed`; attempt
//! `k = 1..=50` uses `fnv1a64(le_bytes(seed) ++ le_bytes(k as u64))`.
//! `Variant.retry` records the attempt used (0 = the seed itself); a
//! `fell_back` variant carries the base content with `retry = 0`. A
//! premise that cannot apply is `InvalidAssignment`, not a retry.

use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};
use std::collections::BTreeMap;

use crate::alphabet::with_alphabet;
use crate::assess::assignment::{Content, Variant};
use crate::assess::hash::{retry_seed, sub_seed};
use crate::assess::premise::{premises_hold, Premise};
use crate::dist::{compute_filtered, DistanceMatrix};
use crate::error::NeoError;
use crate::exercise::{Exercise, ExerciseData, Reference, ReferenceKind};
use crate::matrix_input::{additive_matrix, DistanceInput};
use crate::newick::{parse_newick, write_newick};
use crate::reading;
use crate::seq::{parse_fasta, Alignment};
use crate::sim::{simulate, MAX_SEED};
use crate::site_filter::SiteFilter;
use crate::tree::{NodeId, Tree};

/// The most retries the generator makes after the seed itself
/// (spec §5.2's `k = 1…50`), so `retry` is always in `0..=50`.
pub const MAX_RETRIES: u8 = 50;

/// Build `base`'s variant for `seed`. `vary == false` returns the
/// base unchanged — only the bootstrap seed is per-student — and
/// premises are not consulted (the base is what the author wrote).
/// Otherwise each attempt transforms the content and checks every
/// premise; `fell_back` reports that none held after `MAX_RETRIES`.
pub fn make_variant(
    base: &Content,
    premises: &[Premise],
    seed: u64,
    vary: bool,
) -> Result<Variant, NeoError> {
    if !vary {
        return Ok(Variant {
            content: base.clone(),
            seed,
            retry: 0,
            fell_back: false,
        });
    }
    for attempt in 0..=MAX_RETRIES {
        let s = if attempt == 0 {
            seed
        } else {
            retry_seed(seed, u64::from(attempt))
        };
        let candidate = transform(base, s)?;
        match premises_hold(&candidate, premises) {
            Ok(true) => {
                return Ok(Variant {
                    content: candidate,
                    seed: s,
                    retry: attempt,
                    fell_back: false,
                })
            }
            Ok(false) => continue,
            // A premise that cannot apply is a defect in the
            // assignment, not bad luck — no retry can fix it.
            Err(e @ NeoError::InvalidAssignment { .. }) => return Err(e),
            // A compute failure on this attempt's data (e.g. a
            // saturated simulated matrix) is seed-dependent — retry.
            Err(_) => continue,
        }
    }
    Ok(Variant {
        content: base.clone(),
        seed,
        retry: 0,
        fell_back: true,
    })
}

/// The content transform for one attempt seed.
fn transform(base: &Content, seed: u64) -> Result<Content, NeoError> {
    match base {
        Content::Exercise(ex) => Ok(Content::Exercise(transform_exercise(ex, seed)?)),
        Content::Reading(set) => Ok(Content::Reading(transform_reading(set, seed)?)),
    }
}

/// Reading variants compose the v1.4d transforms (spec §5.2): tip
/// order rotated, then shuffled, then tips relabelled from
/// `taxa_pool` — each on a tagged sub-seed.
fn transform_reading(
    set: &crate::reading::ReadingSet,
    seed: u64,
) -> Result<crate::reading::ReadingSet, NeoError> {
    let set = reading::rotate(set, sub_seed(seed, "rotate"));
    let set = reading::shuffle_tip_order(&set, sub_seed(seed, "shuffle"));
    reading::relabel(&set, sub_seed(seed, "relabel"))
}

/// Exercise variants dispatch on `data.kind` per spec §5.2.
fn transform_exercise(ex: &Exercise, seed: u64) -> Result<Exercise, NeoError> {
    match &ex.data {
        ExerciseData::Simulated { .. } => transform_simulated(ex, seed),
        ExerciseData::Matrix { .. }
            if ex
                .reference
                .as_ref()
                .is_some_and(|r| r.kind == ReferenceKind::True) =>
        {
            transform_derived_matrix(ex, seed)
        }
        _ => Ok(ex.clone()),
    }
}

/// A simulated exercise (§5.2): the seed drives `sim`; the true tree
/// is rotated and its tips relabelled by a permutation of the
/// exercise's own taxon names — applied consistently to the reference
/// tree and every `reveal_pair` prompt pair.
fn transform_simulated(ex: &Exercise, seed: u64) -> Result<Exercise, NeoError> {
    let ExerciseData::Simulated { true_tree, sim } = &ex.data else {
        return Err(NeoError::InvalidAssignment {
            field: "data".to_string(),
            msg: "transform_simulated called on non-simulated data".to_string(),
        });
    };
    let mut tree = parse_newick(true_tree).map_err(|e| NeoError::InvalidAssignment {
        field: "true_tree".to_string(),
        msg: e.to_string(),
    })?;
    let map = permutation_map(&tree.leaf_labels(), sub_seed(seed, "relabel"));
    rotate_tree(&mut tree, sub_seed(seed, "rotate"));
    relabel_tree(&mut tree, &map);

    let mut out = ex.clone();
    out.data = ExerciseData::Simulated {
        true_tree: write_newick(&tree),
        sim: crate::sim::SimSpec {
            seed: seed & MAX_SEED,
            ..*sim
        },
    };
    if let Some(r) = &mut out.reference {
        if let Ok(mut rt) = parse_newick(&r.newick) {
            rotate_tree(&mut rt, sub_seed(seed, "rotate"));
            relabel_tree(&mut rt, &map);
            r.newick = write_newick(&rt);
        }
    }
    for p in &mut out.prompts {
        if let Some(pair) = &mut p.reveal_pair {
            for label in pair.iter_mut() {
                if let Some(new) = map.get(label.as_str()) {
                    *label = new.clone();
                }
            }
        }
    }
    Ok(out)
}

/// A matrix exercise derived from a tree (§5.2): a seeded random
/// binary tree on the exercise's own taxa, its additive matrix
/// rounded to the author's decimals, and the generated tree as the
/// new true reference.
fn transform_derived_matrix(ex: &Exercise, seed: u64) -> Result<Exercise, NeoError> {
    let ExerciseData::Matrix {
        names,
        lower,
        source,
    } = &ex.data
    else {
        return Err(NeoError::InvalidAssignment {
            field: "data".to_string(),
            msg: "transform_derived_matrix called on non-matrix data".to_string(),
        });
    };
    let tree = random_tree(names, sub_seed(seed, "tree"));
    let d = author_decimals(lower);
    let input = additive_matrix(&tree, Some(d))?;
    let mut out = ex.clone();
    out.data = ExerciseData::Matrix {
        names: input.names,
        lower: input.lower,
        source: source.clone(),
    };
    out.reference = Some(Reference {
        newick: write_newick(&tree),
        kind: ReferenceKind::True,
    });
    Ok(out)
}

/// The decimals the authored matrix carries: the smallest `d` in
/// `0..=6` that leaves every `lower` value unchanged when rounded to
/// `d` places (the author's own rounding — spec §5.2 "rounded as the
/// author set"). Rounding uses the same `libm` round `additive_matrix`
/// applies.
fn author_decimals(lower: &[f64]) -> u8 {
    'outer: for d in 0..=6u8 {
        let scale = libm::pow(10.0, f64::from(d));
        for &v in lower {
            if libm::round(v * scale) / scale != v {
                continue 'outer;
            }
        }
        return d;
    }
    6
}

/// A seeded random rooted binary tree over `names` (permuted onto the
/// leaves) with branch lengths uniform in `[1, 10)`. Draws are
/// consumed in a fixed order — a name shuffle, then per join the two
/// members and their two lengths — so a seed always yields the same
/// tree.
fn random_tree(names: &[String], seed: u64) -> Tree {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    let mut perm = names.to_vec();
    for i in (1..perm.len()).rev() {
        let j = (rng.next_u64() % (i as u64 + 1)) as usize;
        perm.swap(i, j);
    }
    let mut tree = Tree::new();
    let mut active: Vec<NodeId> = perm
        .iter()
        .map(|n| tree.add_node(Some(n.clone())))
        .collect();
    let len =
        |rng: &mut ChaCha8Rng| 1.0 + 9.0 * (rng.next_u64() as f64) / 18_446_744_073_709_551_616.0;
    while active.len() > 1 {
        let i = (rng.next_u64() % active.len() as u64) as usize;
        let mut j = (rng.next_u64() % (active.len() as u64 - 1)) as usize;
        if j >= i {
            j += 1;
        }
        let u = tree.add_node(None);
        let (li, lj) = (len(&mut rng), len(&mut rng));
        let (a, b) = (active[i], active[j]);
        tree.attach(u, a, Some(li));
        tree.attach(u, b, Some(lj));
        for member in [i.max(j), i.min(j)] {
            active.remove(member);
        }
        active.push(u);
    }
    if let Some(&root) = active.first() {
        tree.set_root(root);
    }
    tree
}

/// A seeded permutation `name -> name` over `labels` — the relabel a
/// variant applies; names absent from `labels` are untouched.
fn permutation_map(labels: &[String], seed: u64) -> BTreeMap<String, String> {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    let mut perm = labels.to_vec();
    for i in (1..perm.len()).rev() {
        let j = (rng.next_u64() % (i as u64 + 1)) as usize;
        perm.swap(i, j);
    }
    labels
        .iter()
        .cloned()
        .zip(perm)
        .collect::<BTreeMap<String, String>>()
}

/// Seeded coin flip per internal node (preorder, ids fixed before
/// mutation — the same stream discipline `reading::rotate` uses):
/// reverse its children. Topology is unchanged; only the drawing
/// order moves.
fn rotate_tree(tree: &mut Tree, seed: u64) {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    for id in tree.preorder() {
        let children = &mut tree.nodes[id.0 as usize].children;
        if children.len() > 1 && rng.next_u64() & 1 == 1 {
            children.reverse();
        }
    }
}

/// Apply a `name -> name` map to every leaf label present in it.
fn relabel_tree(tree: &mut Tree, map: &BTreeMap<String, String>) {
    for node in &mut tree.nodes {
        if let Some(l) = &mut node.label {
            if let Some(new) = map.get(l.as_str()) {
                *l = new.clone();
            }
        }
    }
}

/// The alignment an exercise's data produces — `simulated` reruns the
/// simulation on the (variant) true tree, `embedded` parses the
/// stored FASTA; a matrix exercise has no alignment and callers that
/// need one get `InvalidAssignment`.
pub(crate) fn exercise_alignment(ex: &Exercise) -> Result<Alignment, NeoError> {
    let aln = match &ex.data {
        ExerciseData::Simulated { true_tree, sim } => {
            let tree = parse_newick(true_tree).map_err(|e| NeoError::InvalidAssignment {
                field: "true_tree".to_string(),
                msg: e.to_string(),
            })?;
            simulate(&tree, sim)?
        }
        ExerciseData::Embedded { fasta, .. } => parse_fasta(fasta)?,
        ExerciseData::Matrix { .. } => {
            return Err(NeoError::InvalidAssignment {
                field: "content".to_string(),
                msg: "a matrix exercise has no alignment".to_string(),
            })
        }
    };
    with_alphabet(aln, ex.alphabet)
}

/// The distance matrix an exercise's pipeline builds — the same
/// inputs the app uses (`distancesFiltered` under the exercise's
/// correction and site filter, or the supplied matrix itself).
pub(crate) fn exercise_distance_matrix(ex: &Exercise) -> Result<DistanceMatrix, NeoError> {
    match &ex.data {
        ExerciseData::Matrix { names, lower, .. } => DistanceInput {
            names: names.clone(),
            lower: lower.clone(),
        }
        .to_distance_matrix(),
        _ => {
            let aln = exercise_alignment(ex)?;
            let filter = ex.analysis.site_filter.unwrap_or(SiteFilter::Pairwise);
            compute_filtered(&aln, ex.analysis.correction, filter)
        }
    }
}
