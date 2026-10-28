//! Pairwise distances: p, JC69 and K80 (spec §4.3), the protein models
//! of v1.1 (§3.4 there), the v1.4 PHYLIP-parity models F84 and
//! K2P_PHYLIP (v1.4 spec §3.1, implemented in `dist_phylip`), plus the
//! v1.2 weighted form used by bootstrap resampling (v1.2 spec §3.1).
//!
//! A site counts for a pair only when both bases are A, C, G or T
//! (pairwise deletion). A pair with zero comparable sites gives
//! `NeoError::InsufficientOverlap`. Cells that fail a model's saturation
//! condition come back as `Cell::Saturated`; `DistanceMatrix::to_matrix`
//! refuses to hand out a plain `Matrix` while a saturated cell remains.
//!
//! `compute_weighted` multiplies each column's contribution by an
//! integer weight (weight 0 drops the column). `compute` delegates to it
//! with all-ones weights, so the unweighted path is unchanged bit for
//! bit.

use libm::log;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::alphabet::{protein_index, Alphabet};
use crate::dist_phylip;
use crate::error::NeoError;
use crate::matrix::Matrix;
use crate::protein_dist;
use crate::seq::Alignment;
use crate::site_filter::{site_mask, SiteFilter};

/// Distance correction model (spec §4.3, v1.1 §3.4, v1.4 §3.1).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum DistModel {
    /// Uncorrected proportion of differences. Never saturates.
    P,
    /// Jukes–Cantor 1969 (DNA). Saturates at p ≥ 0.75.
    Jc69,
    /// Kimura 1980 two-parameter (DNA). Saturates when either log
    /// argument is non-positive.
    K80,
    /// Kimura protein correction (protein), `d = −ln(1 − p − 0.2p²)`.
    /// Saturates when `1 − p − 0.2p² ≤ 0`.
    Kimura,
    /// JTT maximum-likelihood distance (protein). Saturates when the
    /// likelihood still rises at the search bound.
    Jtt,
    /// Poisson correction (protein), `d = −ln(1 − p)`. Saturates at
    /// `p ≥ 1` (v1.4b spec §3.3).
    Poisson,
    /// F84 as PHYLIP `dnadist` computes it (v1.4 §3.1): ML distance with
    /// empirical base frequencies and the fixed ratio 2.0.
    F84,
    /// PHYLIP `dnadist`'s "Kimura 2-parameter" (v1.4 §3.1): an ML
    /// distance at the user-fixed transition/transversion `ratio` with
    /// equal base frequencies — not K80's closed form (spec §3.3).
    /// `ratio` must be positive and finite.
    K2pPhylip { ratio: f64 },
}

impl DistModel {
    /// The exercise-file spelling of the model name ("p", "JC69",
    /// "K80", "Kimura", "JTT", "F84", "K2P_PHYLIP"). `K2pPhylip`'s ratio
    /// travels in the enum, not the name.
    pub fn name(self) -> &'static str {
        match self {
            DistModel::P => "p",
            DistModel::Jc69 => "JC69",
            DistModel::K80 => "K80",
            DistModel::Kimura => "Kimura",
            DistModel::Jtt => "JTT",
            DistModel::Poisson => "Poisson",
            DistModel::F84 => "F84",
            DistModel::K2pPhylip { .. } => "K2P_PHYLIP",
        }
    }

    /// Models valid for `alphabet` (v1.1 spec §3.4, v1.4 §3.1).
    pub(crate) fn supports(self, alphabet: Alphabet) -> bool {
        match alphabet {
            Alphabet::Dna => matches!(
                self,
                DistModel::P
                    | DistModel::Jc69
                    | DistModel::K80
                    | DistModel::F84
                    | DistModel::K2pPhylip { .. }
            ),
            Alphabet::Protein => {
                matches!(
                    self,
                    DistModel::P | DistModel::Kimura | DistModel::Jtt | DistModel::Poisson
                )
            }
        }
    }
}

/// One cell of a `DistanceMatrix`.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum Cell {
    /// A finite, non-negative distance.
    Value(f64),
    /// The model cannot correct this much divergence.
    Saturated,
}

/// A symmetric n×n distance matrix with a zero diagonal.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct DistanceMatrix {
    pub labels: Vec<String>,
    pub model: DistModel,
    /// Row-major cells, `labels.len()`² entries.
    pub cells: Vec<Cell>,
}

impl DistanceMatrix {
    /// Number of taxa.
    pub fn n(&self) -> usize {
        self.labels.len()
    }

    /// Saturated cells with `i < j`, in row-major order.
    pub fn saturated_cells(&self) -> Vec<(usize, usize)> {
        let n = self.n();
        let mut out = Vec::new();
        for i in 0..n {
            for j in (i + 1)..n {
                if self.cells.get(i * n + j) == Some(&Cell::Saturated) {
                    out.push((i, j));
                }
            }
        }
        out
    }

    /// Plain `Matrix` of distances, or `NeoError::SaturatedMatrix` listing
    /// the saturated pairs.
    pub fn to_matrix(&self) -> Result<Matrix, NeoError> {
        let cells = self.saturated_cells();
        if !cells.is_empty() {
            return Err(NeoError::SaturatedMatrix { cells });
        }
        let mut data = Vec::with_capacity(self.cells.len());
        for (idx, cell) in self.cells.iter().enumerate() {
            match cell {
                Cell::Value(v) => data.push(*v),
                // A saturated cell with i > j cannot come from `compute`,
                // only from a hand-built matrix; report it rather than
                // guessing.
                Cell::Saturated => {
                    let n = self.n().max(1);
                    let (i, j) = (idx / n, idx % n);
                    return Err(NeoError::SaturatedMatrix {
                        cells: vec![(i.min(j), i.max(j))],
                    });
                }
            }
        }
        Ok(Matrix { n: self.n(), data })
    }

    /// Wrap an already-computed `Matrix` (model `P`). For tests and for
    /// importing a matrix computed elsewhere.
    pub fn from_values(labels: Vec<String>, m: &Matrix) -> DistanceMatrix {
        DistanceMatrix {
            labels,
            model: DistModel::P,
            cells: m.data.iter().map(|&v| Cell::Value(v)).collect(),
        }
    }
}

pub(crate) fn is_base(b: u8) -> bool {
    matches!(b, b'A' | b'C' | b'G' | b'T')
}

/// Transitions are A↔G and C↔T (spec §4.3).
fn is_transition(a: u8, b: u8) -> bool {
    matches!(
        (a, b),
        (b'A', b'G') | (b'G', b'A') | (b'C', b'T') | (b'T', b'C')
    )
}

/// Per-pair counts under pairwise deletion, with per-column weights.
/// Column `k` contributes `w[k]` to each counter; a weight of 0 drops
/// the column and a missing `w[k]` is treated as 0, so a short `w` can
/// never index past its end. Sites at which either character is not a
/// standard state of the alphabet (A/C/G/T for DNA, the 20 amino acids
/// for protein) are skipped; sites past the end of the shorter sequence
/// are skipped too, so ragged input cannot panic.
#[derive(Default)]
struct PairCounts {
    comparable: u64,
    differences: u64,
    transitions: u64,
    /// Weighted 4×4 pattern counts, A/C/G/T order (needed by F84, whose
    /// likelihood terms depend on the actual bases, not just the
    /// transition/transversion class). DNA only; stays all-zero for
    /// protein alignments, which never reach `distance`.
    table: [u64; 16],
}

fn pair_counts_weighted(a: &[u8], b: &[u8], alphabet: Alphabet, w: &[u32]) -> PairCounts {
    let is_standard: fn(u8) -> bool = match alphabet {
        Alphabet::Dna => is_base,
        Alphabet::Protein => |b| protein_index(b).is_some(),
    };
    let mut counts = PairCounts::default();
    for k in 0..a.len().min(b.len()) {
        let wt = u64::from(w.get(k).copied().unwrap_or(0));
        if wt == 0 {
            continue;
        }
        let (x, y) = (a[k], b[k]);
        if !is_standard(x) || !is_standard(y) {
            continue;
        }
        counts.comparable += wt;
        if alphabet == Alphabet::Dna {
            if let (Some(ix), Some(iy)) = (dist_phylip::base_index(x), dist_phylip::base_index(y)) {
                counts.table[ix * 4 + iy] += wt;
            }
        }
        if x != y {
            counts.differences += wt;
            if alphabet == Alphabet::Dna && is_transition(x, y) {
                counts.transitions += wt;
            }
        }
    }
    counts
}

/// Per-call constants the DNA-only models need beyond `PairCounts`:
/// F84's empirical-frequency context and `K2pPhylip`'s equal-frequency
/// ratio parameters. `None` for the closed-form models.
enum DnaParams {
    F84(dist_phylip::F84Ctx),
    K2p(dist_phylip::RatioParams),
    Other,
}

fn distance(counts: &PairCounts, model: DistModel, params: &DnaParams) -> Cell {
    let sites = counts.comparable as f64;
    let p = counts.differences as f64 / sites;
    match model {
        DistModel::P => Cell::Value(p),
        // Unreachable: `supports` keeps protein models out of the DNA
        // dispatch that calls this function, and `compute` handles
        // protein pairs through `protein_dist` directly. A saturated
        // cell is the honest fallthrough for a wrong model.
        DistModel::Kimura | DistModel::Jtt | DistModel::Poisson => Cell::Saturated,
        // dnadist's ML solves; `params` is built for the same model in
        // `compute_weighted`, so the Other arm is unreachable in
        // practice and Saturated stays the honest fallthrough.
        DistModel::F84 => match params {
            DnaParams::F84(ctx) => dist_phylip::f84_distance(ctx, &counts.table),
            _ => Cell::Saturated,
        },
        DistModel::K2pPhylip { .. } => match params {
            DnaParams::K2p(rp) => dist_phylip::k2p_distance(
                (counts.comparable - counts.differences) as f64,
                counts.transitions as f64,
                (counts.differences - counts.transitions) as f64,
                rp,
            ),
            _ => Cell::Saturated,
        },
        // d = -3/4 ln(1 - 4p/3); saturated at p >= 0.75.
        DistModel::Jc69 => {
            if p >= 0.75 {
                Cell::Saturated
            } else {
                Cell::Value(-0.75 * log(1.0 - 4.0 * p / 3.0))
            }
        }
        // d = -1/2 ln(1 - 2P - Q) - 1/4 ln(1 - 2Q); saturated when either
        // argument is non-positive.
        DistModel::K80 => {
            let p_ti = counts.transitions as f64 / sites;
            let q = (counts.differences - counts.transitions) as f64 / sites;
            let a = 1.0 - 2.0 * p_ti - q;
            let b = 1.0 - 2.0 * q;
            if a <= 0.0 || b <= 0.0 {
                Cell::Saturated
            } else {
                Cell::Value(-0.5 * log(a) - 0.25 * log(b))
            }
        }
    }
}

/// All pairwise distances for `aln` under `model` (spec §4.3, v1.1 §3.4).
/// `model` must be valid for `aln.alphabet`, else `ModelAlphabetMismatch`.
///
/// Delegates to `compute_weighted` with an all-ones weight vector, so
/// the two paths cannot drift apart.
pub fn compute(aln: &Alignment, model: DistModel) -> Result<DistanceMatrix, NeoError> {
    let w = vec![1u32; aln.seqs.iter().map(Vec::len).max().unwrap_or(0)];
    compute_weighted(aln, model, &w)
}

/// Pairwise distances under a site filter (v1.4b spec §3.1): the
/// filter's 0/1 column weights go through `compute_weighted`, so every
/// model gets all three of MEGA's gap treatments with no distance
/// function changes. `SiteFilter::Pairwise` is exactly `compute`.
pub fn compute_filtered(
    aln: &Alignment,
    model: DistModel,
    filter: SiteFilter,
) -> Result<DistanceMatrix, NeoError> {
    let mask = site_mask(aln, filter)?;
    compute_weighted(aln, model, &mask.weights)
}

/// Weighted pairwise distances (v1.2 spec §3.1): column `k` counts
/// `w[k]` times in comparable sites, differences and (JTT) pair counts.
/// `w.len()` must equal the number of alignment columns (the longest
/// sequence, so ragged tails are covered), else
/// `InvalidExercise { field: "weights" }`. A pair whose weighted
/// comparable-site count is zero gives `InsufficientOverlap`.
pub fn compute_weighted(
    aln: &Alignment,
    model: DistModel,
    w: &[u32],
) -> Result<DistanceMatrix, NeoError> {
    let cols = aln.seqs.iter().map(Vec::len).max().unwrap_or(0);
    if w.len() != cols {
        return Err(NeoError::InvalidExercise {
            field: "weights".to_string(),
            msg: format!("expected {cols} column weights, got {}", w.len()),
        });
    }
    if let DistModel::K2pPhylip { ratio } = model {
        if !ratio.is_finite() || ratio <= 0.0 {
            return Err(NeoError::InvalidExercise {
                field: "ratio".to_string(),
                msg: format!("K2P_PHYLIP ratio must be positive and finite, got {ratio}"),
            });
        }
    }
    if !model.supports(aln.alphabet) {
        return Err(NeoError::ModelAlphabetMismatch {
            model: model.name().to_string(),
            alphabet: aln.alphabet,
        });
    }
    let dna_params = match model {
        DistModel::F84 => DnaParams::F84(dist_phylip::f84_context(aln, w)),
        DistModel::K2pPhylip { ratio } => {
            DnaParams::K2p(dist_phylip::ratio_params(&[0.25; 4], ratio))
        }
        _ => DnaParams::Other,
    };
    let n = aln.seqs.len();
    let mut cells = vec![Cell::Value(0.0); n * n];
    for i in 0..n {
        for j in (i + 1)..n {
            let cell = match aln.alphabet {
                Alphabet::Dna => {
                    let counts = pair_counts_weighted(&aln.seqs[i], &aln.seqs[j], aln.alphabet, w);
                    if counts.comparable == 0 {
                        return Err(NeoError::InsufficientOverlap {
                            a: label(&aln.labels, i),
                            b: label(&aln.labels, j),
                        });
                    }
                    distance(&counts, model, &dna_params)
                }
                Alphabet::Protein => {
                    let (table, comparable, differences) =
                        protein_dist::pair_counts_weighted(&aln.seqs[i], &aln.seqs[j], w);
                    if comparable == 0 {
                        return Err(NeoError::InsufficientOverlap {
                            a: label(&aln.labels, i),
                            b: label(&aln.labels, j),
                        });
                    }
                    let p = differences as f64 / comparable as f64;
                    match model {
                        DistModel::P => Cell::Value(p),
                        DistModel::Kimura => protein_dist::kimura_from_p(p),
                        DistModel::Jtt => protein_dist::jtt_ml(&table),
                        DistModel::Poisson => protein_dist::poisson_from_p(p),
                        other => {
                            return Err(NeoError::ModelAlphabetMismatch {
                                model: other.name().to_string(),
                                alphabet: aln.alphabet,
                            })
                        }
                    }
                }
            };
            cells[i * n + j] = cell;
            cells[j * n + i] = cell;
        }
    }
    // The matrix dimension follows `seqs`; a hand-built `Alignment` with
    // fewer labels than sequences gets generated labels rather than a
    // panic or a length mismatch between `labels` and `cells`.
    let labels = (0..n).map(|i| label(&aln.labels, i)).collect();
    Ok(DistanceMatrix {
        labels,
        model,
        cells,
    })
}

pub(crate) fn label(labels: &[String], i: usize) -> String {
    labels
        .get(i)
        .cloned()
        .unwrap_or_else(|| format!("taxon{}", i + 1))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::seq::parse_fasta;

    fn aln(records: &[(&str, &str)]) -> Alignment {
        let text: String = records
            .iter()
            .map(|(name, seq)| format!(">{name}\n{seq}\n"))
            .collect();
        parse_fasta(&text).unwrap()
    }

    #[test]
    fn pair_counts_table_matches_class_counts() {
        // 1 transition (A→G), 2 transversions (A→C, A→T), 3 identical.
        let a = parse_fasta(">a\nAAAAAA\n").unwrap();
        let b = parse_fasta(">b\nGCTAAA\n").unwrap();
        let w = [1u32; 6];
        let c = pair_counts_weighted(&a.seqs[0], &b.seqs[0], Alphabet::Dna, &w);
        assert_eq!(c.comparable, 6);
        assert_eq!(c.differences, 3);
        assert_eq!(c.transitions, 1);
        // A→G at index 0·4+2, A→C at 0·4+1, A→T at 0·4+3.
        assert_eq!(c.table[2], 1);
        assert_eq!(c.table[1], 1);
        assert_eq!(c.table[3], 1);
        assert_eq!(c.table.iter().sum::<u64>(), c.comparable);
    }

    #[test]
    fn k2p_equal_frequency_ratio_params() {
        // getbasefreqs at equal frequencies: xv = 1/(r + 0.5),
        // fracchange = 0.5·xi + 0.75·xv (PHYLIP 3.697 seq.c).
        let rp = dist_phylip::ratio_params(&[0.25; 4], 2.0);
        assert!((rp.xv - 0.4).abs() < 1e-12);
        assert!((rp.fracchange - 0.6).abs() < 1e-12);
        // r ≤ 0.5 hits dnadist's "impossible ratio" reset: xi = 0, xv = 1.
        let rp = dist_phylip::ratio_params(&[0.25; 4], 0.4);
        assert_eq!(rp.xv, 1.0);
    }

    #[test]
    fn k2p_distances_increase_in_divergence() {
        // Monotone in observed divergence on a fixed pair (spec §3.4):
        // each step adds two more differences to an 8-site pair.
        let a = "AAAAAAAA";
        let mut d_prev = 0.0;
        for diffs in [0usize, 2, 4] {
            let mut b = a.to_string();
            for (k, ch) in "GGTT".chars().enumerate().take(diffs) {
                b.replace_range(k..k + 1, &ch.to_string());
            }
            let aln = aln(&[("a", a), ("b", &b)]);
            let m = compute(&aln, DistModel::K2pPhylip { ratio: 2.0 }).unwrap();
            match m.cells[1] {
                Cell::Value(d) => {
                    assert!(d >= d_prev, "distance must not decrease");
                    d_prev = d;
                }
                Cell::Saturated => panic!("8-site pair should not saturate"),
            }
        }
    }
}
