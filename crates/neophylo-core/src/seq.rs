//! Sequences, alignments and FASTA import (spec §4.1, v1.1 §3.1).
//!
//! Input is case-insensitive. The alphabet is auto-detected after parsing
//! (v1.1 spec §3.1): DNA input validates exactly as v1 — `U` is read as
//! `T`, the accepted letters are the IUPAC nucleotide codes plus `-` and
//! `?` (`ACGTRYKMSWBDHVN-?`) — while protein input accepts the 20 standard
//! amino acids plus `B Z J X U O * - ?` (all missing data, `U` kept as
//! selenocysteine). Anything else is `NeoError::UnsupportedCharacter`.
//! All sequences in an imported alignment must have the same length.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use ts_rs::TS;

use crate::alphabet::{detect_alphabet, is_protein_char, Alphabet};
use crate::error::NeoError;

/// Maximum number of taxa accepted on import (spec §4.1).
pub const MAX_TAXA: usize = 200;
/// Maximum number of sites accepted on import (spec §4.1).
pub const MAX_SITES: usize = 100_000;

/// An imported or simulated alignment. Sequences are uppercase ASCII;
/// in DNA mode `U` is normalized to `T`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Alignment {
    pub labels: Vec<String>,
    pub seqs: Vec<Vec<u8>>,
    /// Detected at import or set by `with_alphabet`; `Dna` when absent
    /// in v1 data.
    #[serde(default)]
    pub alphabet: Alphabet,
}

/// Convert one sequence-data character to a byte. Non-ASCII input is
/// rejected — never truncated — as `UnsupportedCharacter` carrying the
/// original `char`; `position` is the 0-based index into the accumulated
/// sequence. Taxon names/labels stay Unicode; only sequence data must
/// be ASCII.
pub(crate) fn seq_byte(label: &str, position: usize, c: char) -> Result<u8, NeoError> {
    if !c.is_ascii() {
        return Err(NeoError::UnsupportedCharacter {
            label: label.to_string(),
            position,
            ch: c,
        });
    }
    Ok(c as u8)
}

/// Bytes accepted in a sequence after uppercasing. `U` is handled separately
/// because it is normalized to `T` rather than kept.
fn is_allowed(b: u8) -> bool {
    matches!(
        b,
        b'A' | b'C'
            | b'G'
            | b'T'
            | b'R'
            | b'Y'
            | b'K'
            | b'M'
            | b'S'
            | b'W'
            | b'B'
            | b'D'
            | b'H'
            | b'V'
            | b'N'
            | b'-'
            | b'?'
    )
}

/// Parse FASTA text into an `Alignment`.
///
/// Tolerates the messy pastes students produce: a UTF-8 BOM, CRLF endings,
/// wrapped sequence lines, blank lines and surrounding whitespace. Header
/// text after `>` becomes the label, trimmed at the ends only.
///
/// Line numbers in errors are 1-based over the input after the BOM is
/// stripped. `position` in `UnsupportedCharacter` is a 0-based index into the
/// (accumulated) sequence.
pub fn parse_fasta(text: &str) -> Result<Alignment, NeoError> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);

    let mut labels: Vec<String> = Vec::new();
    let mut seqs: Vec<Vec<u8>> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut current: Option<usize> = None;

    for (i, raw) in text.lines().enumerate() {
        let line_no = (i + 1) as u32;
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(header) = line.strip_prefix('>') {
            if labels.len() >= MAX_TAXA {
                return Err(NeoError::TooManyTaxa {
                    max: MAX_TAXA,
                    got: labels.len() + 1,
                });
            }
            let label = header.trim().to_string();
            if !seen.insert(label.clone()) {
                return Err(NeoError::Parse {
                    line: line_no,
                    col: 1,
                    msg: format!("duplicate label '{label}'"),
                });
            }
            labels.push(label);
            seqs.push(Vec::new());
            current = Some(labels.len() - 1);
            continue;
        }

        let idx = match current {
            Some(idx) => idx,
            None => {
                return Err(NeoError::Parse {
                    line: line_no,
                    col: 1,
                    msg: "sequence data before the first '>' header".to_string(),
                })
            }
        };
        // Characters are collected raw (uppercased) and validated only
        // after the whole alignment is read, because the alphabet is
        // detected from all sequences at once and it decides whether `U`
        // means uracil (DNA) or selenocysteine (protein, missing).
        for c in line.chars() {
            let position = seqs[idx].len();
            seqs[idx].push(seq_byte(&labels[idx], position, c)?.to_ascii_uppercase());
            if seqs[idx].len() > MAX_SITES {
                return Err(NeoError::Parse {
                    line: line_no,
                    col: 1,
                    msg: format!("sequence exceeds the {MAX_SITES}-site import limit"),
                });
            }
        }
    }

    if labels.is_empty() {
        return Err(NeoError::Parse {
            line: 1,
            col: 1,
            msg: "no FASTA records found".to_string(),
        });
    }

    let alphabet = detect_alphabet(&seqs);
    let seqs = validate(&labels, &seqs, alphabet)?;

    let expected = seqs[0].len();
    for (k, seq) in seqs.iter().enumerate() {
        if seq.len() != expected {
            return Err(NeoError::UnequalLengths {
                label: labels[k].clone(),
                expected,
                got: seq.len(),
            });
        }
    }

    Ok(Alignment {
        labels,
        seqs,
        alphabet,
    })
}

/// Re-validate sequences against `alphabet` and return normalized copies
/// (uppercase; `U`→`T` for DNA only). `Dna` applies exactly the v1 FASTA
/// acceptance set (`is_allowed` plus `U`), so `parse_fasta` and
/// `with_alphabet` cannot drift apart.
pub(crate) fn validate(
    labels: &[String],
    seqs: &[Vec<u8>],
    alphabet: Alphabet,
) -> Result<Vec<Vec<u8>>, NeoError> {
    let mut out = Vec::with_capacity(seqs.len());
    for (k, seq) in seqs.iter().enumerate() {
        let mut norm = Vec::with_capacity(seq.len());
        for (i, &b) in seq.iter().enumerate() {
            let c = b.to_ascii_uppercase();
            let ok = match alphabet {
                Alphabet::Dna => is_allowed(c) || c == b'U',
                Alphabet::Protein => is_protein_char(c),
            };
            if !ok {
                return Err(NeoError::UnsupportedCharacter {
                    label: labels.get(k).cloned().unwrap_or_default(),
                    position: i,
                    ch: b as char,
                });
            }
            norm.push(if alphabet == Alphabet::Dna && c == b'U' {
                b'T'
            } else {
                c
            });
        }
        out.push(norm);
    }
    Ok(out)
}
