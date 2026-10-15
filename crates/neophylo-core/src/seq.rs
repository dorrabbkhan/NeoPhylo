//! DNA sequences, alignments and FASTA import (spec §4.1).
//!
//! Input is case-insensitive and `U` is read as `T`. The accepted alphabet is
//! the IUPAC nucleotide codes plus `-` and `?` (`ACGTRYKMSWBDHVN-?`); anything
//! else is `NeoError::UnsupportedCharacter`. All sequences in an imported
//! alignment must have the same length.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use ts_rs::TS;

use crate::error::NeoError;

/// Maximum number of taxa accepted on import (spec §4.1).
pub const MAX_TAXA: usize = 200;
/// Maximum number of sites accepted on import (spec §4.1).
pub const MAX_SITES: usize = 100_000;

/// An imported or simulated alignment. Sequences are uppercase ASCII with
/// `U` already normalized to `T`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Alignment {
    pub labels: Vec<String>,
    pub seqs: Vec<Vec<u8>>,
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
        for &b in line.as_bytes() {
            let norm = match b.to_ascii_uppercase() {
                b'U' => b'T',
                c if is_allowed(c) => c,
                _ => {
                    return Err(NeoError::UnsupportedCharacter {
                        label: labels[idx].clone(),
                        position: seqs[idx].len(),
                        ch: b as char,
                    })
                }
            };
            seqs[idx].push(norm);
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

    Ok(Alignment { labels, seqs })
}
