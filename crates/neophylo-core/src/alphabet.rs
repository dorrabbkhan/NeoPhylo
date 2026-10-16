//! Sequence alphabets: DNA and protein (v1.1 spec §3.1).
//!
//! Every `Alignment` carries an `Alphabet`. FASTA input is auto-detected:
//! protein if any character is in `E F I L P Q J O Z X *`, DNA if at least
//! 90% of the remaining characters are in `A C G T U N` (`-` and `?` are
//! ignored), protein otherwise. `with_alphabet` re-validates an alignment
//! against a chosen alphabet and is how a user overrides detection.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::NeoError;
use crate::seq::{validate, Alignment};

/// The molecule type of an alignment (v1.1 spec §3.1). Serde `default` is
/// `Dna` so v1 data without the field deserializes unchanged.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum Alphabet {
    #[default]
    Dna,
    Protein,
}

impl Alphabet {
    /// Lowercase name, matching the serde spelling.
    pub fn name(self) -> &'static str {
        match self {
            Alphabet::Dna => "dna",
            Alphabet::Protein => "protein",
        }
    }
}

/// Standard amino-acid state order, indices 0–19 — the order of the
/// published JTT data (v1.1 spec §3.1).
pub const PROTEIN_STATES: &[u8; 20] = b"ARNDCQEGHILKMFPSTWYV";

/// Index of `c` in `PROTEIN_STATES`, case-insensitive. Returns `None` for
/// every non-standard character (`B Z J X U O * - ?` and anything else),
/// i.e. the characters that are pairwise-deleted for every model.
pub fn protein_index(c: u8) -> Option<u8> {
    let c = c.to_ascii_uppercase();
    PROTEIN_STATES.iter().position(|&s| s == c).map(|i| i as u8)
}

/// A character accepted in a protein alignment (v1.1 spec §3.1): the 20
/// standard states plus `B Z J X U O * - ?`, all of which except the 20
/// count as missing data.
pub(crate) fn is_protein_char(c: u8) -> bool {
    let c = c.to_ascii_uppercase();
    protein_index(c).is_some()
        || matches!(
            c,
            b'B' | b'Z' | b'J' | b'X' | b'U' | b'O' | b'*' | b'-' | b'?'
        )
}

/// Characters that force protein detection (v1.1 spec §3.1).
fn is_protein_trigger(c: u8) -> bool {
    matches!(
        c,
        b'E' | b'F' | b'I' | b'L' | b'P' | b'Q' | b'J' | b'O' | b'Z' | b'X' | b'*'
    )
}

/// Auto-detect the alphabet of a set of sequences (v1.1 spec §3.1),
/// ignoring `-` and `?`:
/// - Protein if any character is in `E F I L P Q J O Z X *`.
/// - Otherwise DNA if at least 90% of the remaining characters are in
///   `A C G T U N`.
/// - Otherwise protein (including input with no countable characters).
///
/// Case-insensitive; raw (unnormalized) input is accepted.
pub fn detect_alphabet(seqs: &[Vec<u8>]) -> Alphabet {
    let mut dna = 0u64;
    let mut total = 0u64;
    for seq in seqs {
        for &b in seq {
            let c = b.to_ascii_uppercase();
            if c == b'-' || c == b'?' {
                continue;
            }
            if is_protein_trigger(c) {
                return Alphabet::Protein;
            }
            total += 1;
            if matches!(c, b'A' | b'C' | b'G' | b'T' | b'U' | b'N') {
                dna += 1;
            }
        }
    }
    if total > 0 && dna * 10 >= total * 9 {
        Alphabet::Dna
    } else {
        Alphabet::Protein
    }
}

/// Re-validate `aln` against alphabet `a` and return the re-tagged
/// alignment (v1.1 spec §3.1 override).
///
/// `Dna` validation is strict: only `A C G T U N - ?` are accepted
/// (`U` normalizes to `T`), so forcing DNA onto a protein reports the
/// first amino-acid letter as `UnsupportedCharacter` instead of silently
/// accepting the overlapping IUPAC ambiguity codes. `Protein` validation
/// accepts every valid DNA sequence too.
pub fn with_alphabet(aln: Alignment, a: Alphabet) -> Result<Alignment, NeoError> {
    let seqs = validate(&aln.labels, &aln.seqs, a, true)?;
    Ok(Alignment {
        labels: aln.labels,
        seqs,
        alphabet: a,
    })
}
