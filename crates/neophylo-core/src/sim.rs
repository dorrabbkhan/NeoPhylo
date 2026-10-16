//! Sequence simulation along a true tree (spec §4.2).
//!
//! The RNG is `ChaCha8Rng` seeded from `spec.seed`. Draws are consumed in
//! a fixed order so results are reproducible and bit-identical between
//! native and wasm builds: the root sequence first (one uniform draw per
//! site), then branches in preorder with children in stored order (one
//! draw per site per branch). Uniforms are `rng.next_u64() as f64` divided
//! by 2^64, written out so the derivation does not depend on the `rand`
//! version.
//!
//! Outcomes for a site draw are ordered `[same, transition, transversion
//! targets in alphabetical order]` for both models. The draw is compared
//! against the cumulative probabilities, so a draw that lands past the
//! last cumulative value (rounding, NaN lengths) picks the final outcome
//! rather than panicking.

use libm::exp;
use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::alphabet::Alphabet;
use crate::error::NeoError;
use crate::seq::Alignment;
use crate::tree::Tree;

/// Shortest simulation the engine accepts (spec §4.2).
pub const MIN_SIM_LEN: u32 = 10;
/// Longest simulation the engine accepts (spec §4.2).
pub const MAX_SIM_LEN: u32 = 100_000;
/// Largest seed the engine accepts: 2^53 - 1, the largest integer that
/// survives a round trip through a JS `number` unchanged.
pub const MAX_SEED: u64 = 9_007_199_254_740_991;

/// Alphabetical DNA base order used for root draws and outcome ordering.
const BASES: [u8; 4] = *b"ACGT";
/// 2^64, the divisor turning a `u64` draw into a uniform on [0, 1).
const TWO_POW_64: f64 = 18_446_744_073_709_551_616.0;

/// Substitution model for `simulate` (spec §4.2).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum SimModel {
    /// Jukes–Cantor 1969: every change is equally likely.
    Jc69,
    /// Kimura 1980 two-parameter with transition/transversion ratio
    /// `kappa`.
    K80 { kappa: f64 },
}

/// What to simulate: model, site count and the RNG seed.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct SimSpec {
    pub model: SimModel,
    pub length: u32,
    #[ts(type = "number")]
    pub seed: u64,
}

/// Engine-level `SimSpec` validation (spec §4.2). `length` must be in
/// `10..=100_000` and `kappa` must be positive.
pub(crate) fn check_spec(spec: &SimSpec) -> Result<(), NeoError> {
    if !(MIN_SIM_LEN..=MAX_SIM_LEN).contains(&spec.length) {
        return Err(NeoError::InvalidExercise {
            field: "sim.length".to_string(),
            msg: format!("length must be in {MIN_SIM_LEN}..={MAX_SIM_LEN}"),
        });
    }
    if spec.seed > MAX_SEED {
        return Err(NeoError::InvalidExercise {
            field: "sim.seed".to_string(),
            msg: "seed must be at most 2^53 - 1".to_string(),
        });
    }
    if let SimModel::K80 { kappa } = spec.model {
        // `is_nan` is checked explicitly: kappa from JSON is finite, but a
        // hand-built spec could carry NaN and must still be rejected.
        if kappa.is_nan() || kappa <= 0.0 {
            return Err(NeoError::InvalidExercise {
                field: "sim.kappa".to_string(),
                msg: "kappa must be positive".to_string(),
            });
        }
    }
    Ok(())
}

/// Every node reachable from the root except the root itself needs a
/// branch length before any simulation may run (spec §11, gap 5).
pub(crate) fn check_branch_lengths(tree: &Tree) -> Result<(), NeoError> {
    for id in tree.preorder() {
        if id != tree.root && tree.branch_length(id).is_none() {
            return Err(NeoError::InvalidExercise {
                field: "true_tree".to_string(),
                msg: "branch length missing".to_string(),
            });
        }
    }
    Ok(())
}

/// Evolve `spec.length` sites along `tree`, returning the tip sequences
/// in `tree.leaf_labels()` order.
pub fn simulate(tree: &Tree, spec: &SimSpec) -> Result<Alignment, NeoError> {
    check_spec(spec)?;
    check_branch_lengths(tree)?;

    let order = tree.preorder();
    if order.is_empty() {
        return Err(NeoError::InvalidExercise {
            field: "true_tree".to_string(),
            msg: "tree is empty".to_string(),
        });
    }

    let mut rng = ChaCha8Rng::seed_from_u64(spec.seed);
    let len = spec.length as usize;
    let mut seqs: Vec<Vec<u8>> = vec![Vec::new(); tree.nodes.len()];

    // 1. The root sequence: `len` draws, each uniform over A/C/G/T.
    let mut root_seq = Vec::with_capacity(len);
    for _ in 0..len {
        let u = uniform(&mut rng);
        root_seq.push(BASES[((u * 4.0) as usize).min(BASES.len() - 1)]);
    }
    seqs[tree.root.0 as usize] = root_seq;

    // 2. Branches in preorder, children in stored order, one uniform draw
    //    per site per branch.
    for &id in order.iter().skip(1) {
        let Some(parent) = tree.nodes[id.0 as usize].parent else {
            continue;
        };
        let len_edge = tree.branch_length(id).unwrap_or(0.0);
        let src = seqs[parent.0 as usize].clone();
        seqs[id.0 as usize] = evolve(&src, len_edge, spec.model, &mut rng);
    }

    let mut labels = Vec::new();
    let mut out = Vec::new();
    for &id in &order {
        if tree.is_leaf(id) {
            labels.push(tree.nodes[id.0 as usize].label.clone().unwrap_or_default());
            out.push(std::mem::take(&mut seqs[id.0 as usize]));
        }
    }
    Ok(Alignment {
        labels,
        seqs: out,
        alphabet: Alphabet::Dna,
    })
}

/// One uniform draw on [0, 1): `next_u64 / 2^64`.
fn uniform(rng: &mut ChaCha8Rng) -> f64 {
    rng.next_u64() as f64 / TWO_POW_64
}

/// Apply the mutations of a branch of length `d` to `parent`, consuming
/// one uniform draw per site.
fn evolve(parent: &[u8], d: f64, model: SimModel, rng: &mut ChaCha8Rng) -> Vec<u8> {
    parent
        .iter()
        .map(|&b| mutate(b, d, model, uniform(rng)))
        .collect()
}

/// Transition target: A↔G and C↔T (same rule as `dist`).
fn transition_target(base: u8) -> u8 {
    match base {
        b'A' | b'G' => {
            if base == b'A' {
                b'G'
            } else {
                b'A'
            }
        }
        _ => {
            if base == b'C' {
                b'T'
            } else {
                b'C'
            }
        }
    }
}

/// The four outcomes of a site draw, in spec order: same, transition,
/// transversions in alphabetical order. One order for both models
/// (spec §4.2).
fn outcomes(base: u8) -> [u8; 4] {
    let ti = transition_target(base);
    let mut rest = BASES.iter().copied().filter(|&b| b != base && b != ti);
    [
        base,
        ti,
        rest.next().unwrap_or(base),
        rest.next().unwrap_or(base),
    ]
}

/// One site on one branch: pick the outcome `u` lands in over the
/// cumulative transition probabilities (spec §4.2). Bases outside
/// A/C/G/T are never produced internally but are passed through
/// unchanged so a hand-built tree cannot be mutated into a panic.
fn mutate(base: u8, d: f64, model: SimModel, u: f64) -> u8 {
    if !BASES.contains(&base) {
        return base;
    }
    let probs: [f64; 4] = match model {
        // P(same) = 1/4 + 3/4 e^(-4d/3); each other base 1/4 - 1/4 e^(-4d/3).
        SimModel::Jc69 => {
            let e = exp(-4.0 * d / 3.0);
            let p_other = 0.25 - 0.25 * e;
            [0.25 + 0.75 * e, p_other, p_other, p_other]
        }
        // P(ti) = 1/4 + 1/4 e^(-4d/(k+2)) - 1/2 e^(-2d(k+1)/(k+2)),
        // P(each tv) = 1/4 - 1/4 e^(-4d/(k+2)), P(same) = 1 - ti - 2*tv.
        SimModel::K80 { kappa } => {
            let e1 = exp(-4.0 * d / (kappa + 2.0));
            let e2 = exp(-2.0 * d * (kappa + 1.0) / (kappa + 2.0));
            let p_ti = 0.25 + 0.25 * e1 - 0.5 * e2;
            let p_tv = 0.25 - 0.25 * e1;
            [1.0 - p_ti - 2.0 * p_tv, p_ti, p_tv, p_tv]
        }
    };
    let outs = outcomes(base);
    let mut cum = 0.0;
    for (p, &t) in probs.iter().zip(outs.iter()) {
        cum += p;
        if u < cum {
            return t;
        }
    }
    outs[3]
}
