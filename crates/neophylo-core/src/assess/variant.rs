//! Variant generation (v1.5 spec §5.2, plan Task 4): one student's
//! seeded content, with premise retry. Every transform draws from
//! `ChaCha8Rng` (the same stream `sim` and the reading transforms
//! use), seeded from tagged [`sub_seed`]s so independent parts never
//! share a stream.
//!
//! Per content kind:
//! - `Simulated` — `sim.seed` comes from the variant seed; the true
//!   tree's tips are relabelled by a seeded permutation of the
//!   exercise's own taxon names, the tree is rotated, and the served
//!   alignment's row order is a seeded shuffle of the variant tree's
//!   leaf labels (`sim.tip_order`, owner decision 2026-11-25) so a
//!   join's matrix positions differ across students.
//! - `Matrix` with `reference.kind == "true"` — *derived*: a seeded
//!   random tree on the same taxa whose branch lengths are rounded to
//!   the author's decimals (see [`author_decimals`]); the variant's
//!   matrix is that tree's exact path-length matrix served in a
//!   seeded row order (same decision) and the generated tree becomes
//!   the true reference.
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
//!
//! The bootstrap seed is the attempt seed masked to
//! [`sim::MAX_SEED`](crate::sim::MAX_SEED) (2^53 − 1) so it survives a
//! JS `number` round trip; every served variant carries it — on the
//! content's `bootstrap` block for an exercise with an alignment
//! (spec §5.6), and as `Variant.seed` always.

use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};
use std::collections::BTreeMap;

use crate::alphabet::with_alphabet;
use crate::assess::assignment::{Content, Variant};
use crate::assess::hash::{retry_seed, sub_seed};
use crate::assess::premise::{premises_hold, Premise};
use crate::dist::{compute_filtered, DistanceMatrix};
use crate::error::NeoError;
use crate::exercise::{Exercise, ExerciseBootstrap, ExerciseData, Reference, ReferenceKind};
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
            content: with_bootstrap(base.clone(), seed & MAX_SEED),
            seed: seed & MAX_SEED,
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
                    content: with_bootstrap(candidate, s & MAX_SEED),
                    seed: s & MAX_SEED,
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
        content: with_bootstrap(base.clone(), seed & MAX_SEED),
        seed: seed & MAX_SEED,
        retry: 0,
        fell_back: true,
    })
}

/// The per-student bootstrap block a served variant carries (spec
/// §5.6): on an exercise with an alignment (`Simulated`, `Embedded` —
/// labs included) `content.bootstrap` is set to the base's replicates
/// (default 100) capped at 200 and `bootstrap_seed` — already masked
/// to [`MAX_SEED`] by the caller. The block is the single source
/// `predict_branch` and the app's panel both read. Matrix exercises
/// and reading sets carry no bootstrap block.
fn with_bootstrap(content: Content, bootstrap_seed: u64) -> Content {
    let Content::Exercise(ex) = &content else {
        return content;
    };
    if !matches!(
        ex.data,
        ExerciseData::Simulated { .. } | ExerciseData::Embedded { .. }
    ) {
        return content;
    }
    let mut ex = ex.clone();
    ex.bootstrap = Some(ExerciseBootstrap {
        replicates: ex.bootstrap.map_or(100, |b| b.replicates).min(200),
        seed: bootstrap_seed,
    });
    Content::Exercise(ex)
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
/// tree and every `reveal_pair` prompt pair — and `sim.tip_order`
/// shuffles the served alignment's row order (owner decision
/// 2026-11-25).
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

    // Owner decision 2026-11-25 (option A): the served alignment's
    // row order is a seeded shuffle of the variant tree's leaf labels.
    // Rotation alone cannot move a cherry's matrix positions (the
    // middle cherry of `nj-basics` was at positions 2–3 for every
    // student), so `tip_order` shuffles the rows themselves. The app
    // and the grader both read `data.sim`, so both see this order.
    let mut tip_order = tree.leaf_labels();
    shuffle(
        &mut tip_order,
        &mut ChaCha8Rng::seed_from_u64(sub_seed(seed, "order")),
    );

    let mut out = ex.clone();
    out.data = ExerciseData::Simulated {
        true_tree: write_newick(&tree),
        sim: crate::sim::SimSpec {
            seed: seed & MAX_SEED,
            tip_order: Some(tip_order),
            ..sim.clone()
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
/// binary tree on the exercise's own taxa with branch lengths rounded
/// to the author's decimals, its path-length matrix at those same
/// decimals served in a seeded row order (`permute_matrix`, owner
/// decision 2026-11-25) — so the served matrix is additive and the
/// lesson note "every distance is the exact path between two tips of
/// that tree" stays true — and the generated tree as the new true
/// reference.
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
    let d = author_decimals(lower);
    let tree = random_tree(names, sub_seed(seed, "tree"), d);
    // `Some(d)`: the branch lengths are already rounded to `d`, so the
    // path sums are exact decimals at `d` places; rounding only strips
    // the binary float noise of the additions (owner 2026-11-25 —
    // e.g. 0.1 + 0.2 serving 0.3, not 0.30000000000000004).
    let input = additive_matrix(&tree, Some(d))?;
    // Same owner decision as `tip_order`: serve the rows in a seeded
    // shuffle so a join's matrix positions vary across students. The
    // reference tree is unchanged — only `names`/`lower` move.
    let (names, lower) = permute_matrix(&input.names, &input.lower, sub_seed(seed, "order"));
    let mut out = ex.clone();
    out.data = ExerciseData::Matrix {
        names,
        lower,
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
/// author set"). A derived variant rounds every generated branch
/// length to `d`, so both the reference newick and the path lengths
/// carry the author's decimals. Rounding uses the same `libm` round
/// `additive_matrix` applies.
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

/// Fisher–Yates over `v` consuming `v.len()-1` draws — the same
/// shuffle `reading::variant` uses.
fn shuffle<T>(v: &mut [T], rng: &mut ChaCha8Rng) {
    for i in (1..v.len()).rev() {
        let j = (rng.next_u64() % (i as u64 + 1)) as usize;
        v.swap(i, j);
    }
}

/// `names`/`lower` re-served under a seeded permutation of the row
/// order (owner decision 2026-11-25): `new_names[k] = names[perm[k]]`
/// and `new_lower` carries the same cells reindexed — the matrix
/// itself is unchanged, only the positions of each taxon move.
fn permute_matrix(names: &[String], lower: &[f64], seed: u64) -> (Vec<String>, Vec<f64>) {
    let n = names.len();
    let mut perm: Vec<usize> = (0..n).collect();
    shuffle(&mut perm, &mut ChaCha8Rng::seed_from_u64(seed));
    let new_names: Vec<String> = perm.iter().map(|&i| names[i].clone()).collect();
    let mut new_lower = vec![0.0; lower.len()];
    for j in 1..n {
        for i in 0..j {
            let (a, b) = (perm[i].min(perm[j]), perm[i].max(perm[j]));
            new_lower[j * (j - 1) / 2 + i] = lower[b * (b - 1) / 2 + a];
        }
    }
    (new_names, new_lower)
}

/// A seeded random rooted binary tree over `names` (permuted onto the
/// leaves) with branch lengths uniform in `[1, 10)`, each rounded to
/// `decimals` places and floored at `10^-decimals` so no length is
/// zero. Rounded lengths make the tree's path-length matrix exactly
/// additive at the author's decimals — the matrix is computed with
/// `additive_matrix(&tree, Some(decimals))`, which only strips the
/// float noise of summing already-rounded lengths. Draws are
/// consumed in a fixed order — a name shuffle, then per join the two
/// members and their two lengths — so a seed always yields the same
/// tree.
fn random_tree(names: &[String], seed: u64, decimals: u8) -> Tree {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    let mut perm = names.to_vec();
    shuffle(&mut perm, &mut rng);
    let mut tree = Tree::new();
    let mut active: Vec<NodeId> = perm
        .iter()
        .map(|n| tree.add_node(Some(n.clone())))
        .collect();
    let scale = libm::pow(10.0, f64::from(decimals));
    let len = |rng: &mut ChaCha8Rng| {
        let raw = 1.0 + 9.0 * (rng.next_u64() as f64) / 18_446_744_073_709_551_616.0;
        (libm::round(raw * scale) / scale).max(1.0 / scale)
    };
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
    shuffle(&mut perm, &mut rng);
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
