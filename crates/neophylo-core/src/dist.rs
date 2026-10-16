//! Pairwise distances: p, JC69 and K80 (spec §4.3).
//!
//! A site counts for a pair only when both bases are A, C, G or T
//! (pairwise deletion). A pair with zero comparable sites gives
//! `NeoError::InsufficientOverlap`. Cells that fail a model's saturation
//! condition come back as `Cell::Saturated`; `DistanceMatrix::to_matrix`
//! refuses to hand out a plain `Matrix` while a saturated cell remains.

use libm::log;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::alphabet::{protein_index, Alphabet};
use crate::error::NeoError;
use crate::matrix::Matrix;
use crate::seq::Alignment;

/// Distance correction model (spec §4.3).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum DistModel {
    /// Uncorrected proportion of differences. Never saturates.
    P,
    /// Jukes–Cantor 1969. Saturates at p ≥ 0.75.
    Jc69,
    /// Kimura 1980 two-parameter. Saturates when either log argument
    /// is non-positive.
    K80,
}

impl DistModel {
    /// The exercise-file spelling of the model name ("p", "JC69", "K80").
    pub fn name(self) -> &'static str {
        match self {
            DistModel::P => "p",
            DistModel::Jc69 => "JC69",
            DistModel::K80 => "K80",
        }
    }

    /// Models valid for `alphabet` (v1.1 spec §3.4). `Kimura` and `Jtt`
    /// join the protein arm in Task 6.
    fn supports(self, alphabet: Alphabet) -> bool {
        match alphabet {
            Alphabet::Dna => matches!(self, DistModel::P | DistModel::Jc69 | DistModel::K80),
            Alphabet::Protein => matches!(self, DistModel::P),
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

fn is_base(b: u8) -> bool {
    matches!(b, b'A' | b'C' | b'G' | b'T')
}

/// Transitions are A↔G and C↔T (spec §4.3).
fn is_transition(a: u8, b: u8) -> bool {
    matches!(
        (a, b),
        (b'A', b'G') | (b'G', b'A') | (b'C', b'T') | (b'T', b'C')
    )
}

/// Per-pair counts under pairwise deletion. Sites at which either
/// character is not a standard state of the alphabet (A/C/G/T for DNA,
/// the 20 amino acids for protein) are skipped; sites past the end of
/// the shorter sequence are skipped too, so ragged input cannot panic.
#[derive(Default)]
struct PairCounts {
    comparable: u64,
    differences: u64,
    transitions: u64,
}

fn pair_counts(a: &[u8], b: &[u8], alphabet: Alphabet) -> PairCounts {
    let is_standard: fn(u8) -> bool = match alphabet {
        Alphabet::Dna => is_base,
        Alphabet::Protein => |b| protein_index(b).is_some(),
    };
    let mut counts = PairCounts::default();
    for k in 0..a.len().min(b.len()) {
        let (x, y) = (a[k], b[k]);
        if !is_standard(x) || !is_standard(y) {
            continue;
        }
        counts.comparable += 1;
        if x != y {
            counts.differences += 1;
            if alphabet == Alphabet::Dna && is_transition(x, y) {
                counts.transitions += 1;
            }
        }
    }
    counts
}

fn distance(counts: &PairCounts, model: DistModel) -> Cell {
    let sites = counts.comparable as f64;
    let p = counts.differences as f64 / sites;
    match model {
        DistModel::P => Cell::Value(p),
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
pub fn compute(aln: &Alignment, model: DistModel) -> Result<DistanceMatrix, NeoError> {
    if !model.supports(aln.alphabet) {
        return Err(NeoError::ModelAlphabetMismatch {
            model: model.name().to_string(),
            alphabet: aln.alphabet,
        });
    }
    let n = aln.seqs.len();
    let mut cells = vec![Cell::Value(0.0); n * n];
    for i in 0..n {
        for j in (i + 1)..n {
            let counts = pair_counts(&aln.seqs[i], &aln.seqs[j], aln.alphabet);
            if counts.comparable == 0 {
                return Err(NeoError::InsufficientOverlap {
                    a: label(&aln.labels, i),
                    b: label(&aln.labels, j),
                });
            }
            let cell = distance(&counts, model);
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

fn label(labels: &[String], i: usize) -> String {
    labels
        .get(i)
        .cloned()
        .unwrap_or_else(|| format!("taxon{}", i + 1))
}
