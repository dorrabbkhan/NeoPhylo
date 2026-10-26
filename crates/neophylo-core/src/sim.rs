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

use crate::alphabet::{protein_index, Alphabet, PROTEIN_STATES};
use crate::dist_phylip;
use crate::error::NeoError;
use crate::model::JTT;
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
    /// Jones–Taylor–Thornton 1992 (protein): root draws from
    /// `JTT.freqs`, branch transitions from `JTT.transition_probs(t)`
    /// (v1.1 spec §3.5).
    Jtt,
    /// F84 (v1.4 spec §3.5): dnadist's default model with
    /// transition/transversion ratio `kappa` and caller-set base
    /// frequencies in A, C, G, T order (default equal). Root draws and
    /// stationary frequencies come from `base_freqs`.
    F84 { kappa: f64, base_freqs: [f64; 4] },
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
/// `10..=100_000`, `kappa` must be positive, and an F84 `kappa` must
/// be feasible for the given base frequencies.
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
    if let SimModel::F84 {
        kappa, base_freqs, ..
    } = spec.model
    {
        if !kappa.is_finite() || kappa <= 0.0 {
            return Err(NeoError::InvalidExercise {
                field: "sim.kappa".to_string(),
                msg: "kappa must be positive and finite".to_string(),
            });
        }
        for f in base_freqs {
            if !f.is_finite() || f <= 0.0 {
                return Err(NeoError::InvalidExercise {
                    field: "sim.base_freqs".to_string(),
                    msg: "base frequencies must be positive and finite".to_string(),
                });
            }
        }
        let sum: f64 = base_freqs.iter().sum();
        if (sum - 1.0).abs() > 1e-6 {
            return Err(NeoError::InvalidExercise {
                field: "sim.base_freqs".to_string(),
                msg: format!("base frequencies must sum to 1 within 1e-6, got {sum}"),
            });
        }
        // A kappa below (a·g + c·t)/(freqR·freqY) is impossible with
        // these frequencies: `ratio_params` would have aa < 0 and
        // silently reset to its F81 floor (xi = 0). The simulator
        // refuses instead (owner decision 2026-10-26, PR #90); the
        // distance path keeps dnadist's reset. freqs are positive and
        // finite here, so the denominator is non-zero. kappa equal to
        // the floor is allowed — it is exactly the F81 limit.
        let (a, c, g, t) = (base_freqs[0], base_freqs[1], base_freqs[2], base_freqs[3]);
        let min_kappa = (a * g + c * t) / ((a + g) * (c + t));
        if kappa < min_kappa {
            return Err(NeoError::InvalidExercise {
                field: "sim.kappa".to_string(),
                msg: format!(
                    "kappa {kappa} is impossible with these base frequencies; \
                     the minimum is {min_kappa}"
                ),
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

    // 1. The root sequence: `len` draws — uniform over A/C/G/T for
    //    JC69/K80, cumulative over `base_freqs` in A/C/G/T order for
    //    F84 (v1.4 spec §3.5), cumulative over `JTT.freqs` in
    //    PROTEIN_STATES order for JTT (v1.1 spec §3.5).
    let mut root_seq = Vec::with_capacity(len);
    match spec.model {
        SimModel::Jtt => {
            for _ in 0..len {
                root_seq.push(sample_aa(&JTT.freqs, uniform(&mut rng)));
            }
        }
        SimModel::F84 { base_freqs, .. } => {
            for _ in 0..len {
                root_seq.push(sample_base(&base_freqs, uniform(&mut rng)));
            }
        }
        _ => {
            for _ in 0..len {
                let u = uniform(&mut rng);
                root_seq.push(BASES[((u * 4.0) as usize).min(BASES.len() - 1)]);
            }
        }
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
        alphabet: match spec.model {
            SimModel::Jtt => Alphabet::Protein,
            _ => Alphabet::Dna,
        },
    })
}

/// One uniform draw on [0, 1): `next_u64 / 2^64`.
fn uniform(rng: &mut ChaCha8Rng) -> f64 {
    rng.next_u64() as f64 / TWO_POW_64
}

/// Apply the mutations of a branch of length `d` to `parent`, consuming
/// one uniform draw per site.
fn evolve(parent: &[u8], d: f64, model: SimModel, rng: &mut ChaCha8Rng) -> Vec<u8> {
    // JTT: P(d) is computed once per branch; each site then samples from
    // the row of its parent's amino acid (v1.1 spec §3.5).
    if model == SimModel::Jtt {
        let p = JTT.transition_probs(d);
        return parent
            .iter()
            .map(|&b| mutate_protein(b, &p, uniform(rng)))
            .collect();
    }
    // F84: the branch's two exponentials are likewise shared by all its
    // sites (v1.4 spec §3.5).
    if let SimModel::F84 {
        kappa, base_freqs, ..
    } = model
    {
        // `tt` is dnadist's time parameter: the branch length in
        // expected substitutions per site divided by `fracchange`,
        // exactly what `makev` scales back at the end of its solve.
        let rp = dist_phylip::ratio_params(&base_freqs, kappa);
        let tt = d / rp.fracchange;
        let z1 = exp(-rp.xv * tt);
        let z1zz = exp(-tt);
        return parent
            .iter()
            .map(|&b| mutate_f84(b, &base_freqs, z1, z1zz, uniform(rng)))
            .collect();
    }
    parent
        .iter()
        .map(|&b| mutate(b, d, model, uniform(rng)))
        .collect()
}

/// Draw one amino-acid state by cumulative comparison over `probs` in
/// `PROTEIN_STATES` order (v1.1 spec §3.5) — a frequency vector for the
/// root, or a transition row `P(d)[x]` for a branch. A draw landing
/// past the last cumulative value (rounding) picks the final state
/// rather than panicking.
fn sample_aa(probs: &[f64; 20], u: f64) -> u8 {
    let mut cum = 0.0;
    for (i, &p) in probs.iter().enumerate() {
        cum += p;
        if u < cum {
            return PROTEIN_STATES[i];
        }
    }
    PROTEIN_STATES[PROTEIN_STATES.len() - 1]
}

/// Draw one DNA base by cumulative comparison over `probs` in A/C/G/T
/// order — the F84 root distribution (v1.4 spec §3.5). A draw landing
/// past the last cumulative value (rounding) picks the final base
/// rather than panicking.
fn sample_base(probs: &[f64; 4], u: f64) -> u8 {
    let mut cum = 0.0;
    for (i, &p) in probs.iter().enumerate() {
        cum += p;
        if u < cum {
            return BASES[i];
        }
    }
    BASES[BASES.len() - 1]
}

/// One protein site on one branch: the outcome `u` lands in over the
/// cumulative row `P(d)[x]` (v1.1 spec §3.5). Characters outside the
/// 20 standard states are never produced internally but pass through
/// unchanged so a hand-built tree cannot be mutated into a panic.
fn mutate_protein(aa: u8, p: &[[f64; 20]; 20], u: f64) -> u8 {
    match protein_index(aa) {
        Some(x) => sample_aa(&p[x as usize], u),
        None => aa,
    }
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

/// One F84 site on one branch (v1.4 spec §3.5). `z1 = e^(−xv·tt)` and
/// `z1zz = e^(−tt)` are the branch's shared exponentials in dnadist's
/// time parameter `tt = d/fracchange` — the same `tt` whose likelihood
/// `makev` maximizes, so branch length `d` stays in expected
/// substitutions per site. P(y|x) is `makev`'s pattern probability
/// divided by πx:
/// `πy·(1 − z1) + [same class]·(πy/fclass)·(z1 − z1zz) + δxy·z1zz`.
/// The outcome order is the shared `[same, transition, transversions]`
/// of `outcomes`, so draw consumption matches the other models.
fn mutate_f84(base: u8, f: &[f64; 4], z1: f64, z1zz: f64, u: f64) -> u8 {
    if !BASES.contains(&base) {
        return base;
    }
    // Purines are A and G (indices 0 and 2), pyrimidines C and T.
    let purine = matches!(base, b'A' | b'G');
    let f_class = if purine { f[0] + f[2] } else { f[1] + f[3] };
    let prob = |y: u8| -> f64 {
        let (fy, same_class) = match y {
            b'A' | b'G' => (f[if y == b'A' { 0 } else { 2 }], purine),
            _ => (f[if y == b'C' { 1 } else { 3 }], !purine),
        };
        let mut q = fy * (1.0 - z1);
        if same_class {
            q += fy / f_class * (z1 - z1zz);
        }
        if y == base {
            q += z1zz;
        }
        q
    };
    let outs = outcomes(base);
    let probs = [prob(outs[0]), prob(outs[1]), prob(outs[2]), prob(outs[3])];
    let mut cum = 0.0;
    for (p, &t) in probs.iter().zip(outs.iter()) {
        cum += p;
        if u < cum {
            return t;
        }
    }
    outs[3]
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
        // Unreachable: `evolve` samples JTT branches through
        // `mutate_protein` with a per-branch P(d) and F84 branches
        // through `mutate_f84`. "Same" is the honest fallthrough.
        SimModel::Jtt | SimModel::F84 { .. } => [1.0, 0.0, 0.0, 0.0],
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
