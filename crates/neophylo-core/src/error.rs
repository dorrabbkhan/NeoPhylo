//! The single engine error type (spec §4.7).
//!
//! Every failure in `neophylo-core` is reported as a `NeoError`; the engine
//! must never panic on any input. The enum is internally tagged (`kind`) so it
//! serializes to a TypeScript union with one case per variant.

use serde::{Deserialize, Serialize};
use std::fmt;
use ts_rs::TS;

use crate::alphabet::Alphabet;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind")]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum NeoError {
    Parse {
        line: u32,
        col: u32,
        msg: String,
    },
    UnequalLengths {
        label: String,
        expected: usize,
        got: usize,
    },
    UnsupportedCharacter {
        label: String,
        position: usize,
        ch: char,
    },
    InsufficientOverlap {
        a: String,
        b: String,
    },
    TooManyTaxa {
        max: usize,
        got: usize,
    },
    TooFewTaxa {
        min: usize,
        got: usize,
    },
    SaturatedMatrix {
        cells: Vec<(usize, usize)>,
    },
    LabelMismatch {
        only_in_a: Vec<String>,
        only_in_b: Vec<String>,
    },
    InvalidExercise {
        field: String,
        msg: String,
    },
    /// A distance or simulation model that does not apply to the
    /// alignment's alphabet (v1.1 spec §3.4).
    ModelAlphabetMismatch {
        model: String,
        alphabet: Alphabet,
    },
    /// Every requested bootstrap replicate was skipped (v1.2 spec §3.3,
    /// §3.8): `failed` of `total` replicates.
    BootstrapFailed {
        failed: u32,
        total: u32,
    },
    /// An editing operation on a tree was refused (v1.4 spec §5.1);
    /// the message names the taxon or node that caused the refusal.
    InvalidEdit {
        msg: String,
    },
}

impl fmt::Display for NeoError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Parse { line, col, msg } => write!(f, "parse error at {line}:{col}: {msg}"),
            Self::UnequalLengths {
                label,
                expected,
                got,
            } => write!(
                f,
                "sequence '{label}' has length {got}, expected {expected}"
            ),
            Self::UnsupportedCharacter {
                label,
                position,
                ch,
            } => write!(
                f,
                "sequence '{label}' has unsupported character '{ch}' at position {position}"
            ),
            Self::InsufficientOverlap { a, b } => {
                write!(f, "sequences '{a}' and '{b}' have no comparable sites")
            }
            Self::TooManyTaxa { max, got } => {
                write!(f, "too many taxa: got {got}, maximum is {max}")
            }
            Self::TooFewTaxa { min, got } => {
                write!(f, "too few taxa: got {got}, minimum is {min}")
            }
            Self::SaturatedMatrix { cells } => {
                write!(f, "distance matrix has {} saturated cells", cells.len())
            }
            Self::LabelMismatch {
                only_in_a,
                only_in_b,
            } => write!(
                f,
                "label mismatch: {} only in first tree, {} only in second",
                only_in_a.len(),
                only_in_b.len()
            ),
            Self::InvalidExercise { field, msg } => {
                write!(f, "invalid exercise field '{field}': {msg}")
            }
            Self::ModelAlphabetMismatch { model, alphabet } => {
                write!(
                    f,
                    "model '{model}' does not apply to {} data",
                    alphabet.name()
                )
            }
            Self::BootstrapFailed { failed, total } => {
                write!(
                    f,
                    "all {total} bootstrap replicates failed ({failed} skipped)"
                )
            }
            Self::InvalidEdit { msg } => write!(f, "{msg}"),
        }
    }
}

impl std::error::Error for NeoError {}
