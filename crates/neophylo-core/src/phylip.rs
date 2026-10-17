//! PHYLIP alignment input and distance-matrix output (v1.1 spec §3.2).
//!
//! `parse_phylip` reads the sequential and interleaved layouts. A line is
//! split into name and sequence under `NameMode`:
//!
//! - `Strict`: the name is the first 10 characters, trimmed of trailing
//!   spaces; everything from column 11 on is sequence.
//! - `Relaxed`: the name runs up to the first whitespace; the rest of the
//!   line is sequence.
//! - `Auto`: Relaxed when that parse is consistent with the header
//!   counts, otherwise Strict. The mode used is returned so the UI can
//!   show it.
//!
//! The first block has one line per taxon (name + sequence); further
//! lines are interleaved continuations without names, assigned to taxa in
//! order and restarting at the first taxon after each blank line.
//! Internal whitespace inside sequence data is ignored. A UTF-8 BOM,
//! CRLF endings and blank lines are tolerated, as in FASTA.
//!
//! `write_phylip_matrix` writes `neighbor` input: `n` on the first line,
//! then per taxon the name (padded to 10 in Strict, followed by one space
//! in Relaxed) and the distances at 6 decimals. Saturated cells are
//! written as `-1.000000`, PHYLIP's convention.

use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use ts_rs::TS;

use crate::alphabet::detect_alphabet;
use crate::dist::{Cell, DistanceMatrix};
use crate::error::NeoError;
use crate::seq::{seq_byte, validate, Alignment, MAX_SITES, MAX_TAXA};

/// How taxon names are delimited in PHYLIP text (v1.1 spec §3.2).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum NameMode {
    /// Name in the first 10 characters of the line.
    Strict,
    /// Name up to the first whitespace.
    Relaxed,
    /// Relaxed when consistent with the header, else Strict.
    Auto,
}

fn parse_err(line: u32, msg: String) -> NeoError {
    NeoError::Parse { line, col: 1, msg }
}

/// The header is `n m` with optional trailing option letters ignored.
fn parse_header(line_no: u32, line: &str) -> Result<(usize, usize), NeoError> {
    let mut tok = line.split_whitespace();
    let n = tok.next().and_then(|t| t.parse::<usize>().ok());
    let m = tok.next().and_then(|t| t.parse::<usize>().ok());
    match (n, m) {
        (Some(n), Some(m)) => Ok((n, m)),
        _ => Err(parse_err(
            line_no,
            "expected a 'number-of-sequences number-of-sites' header".to_string(),
        )),
    }
}

/// Split one first-block line into `(name, sequence fragment)` under
/// `mode`. Internal whitespace in the fragment is removed; the name may
/// be Unicode but every sequence character must be ASCII (`seq_byte`).
fn split_line(line_no: u32, line: &str, mode: NameMode) -> Result<(String, Vec<u8>), NeoError> {
    match mode {
        NameMode::Strict => {
            let name: String = line.chars().take(10).collect::<String>();
            let name = name.trim_end().to_string();
            if name.is_empty() {
                return Err(parse_err(line_no, "empty taxon name".to_string()));
            }
            let mut frag = Vec::new();
            for c in line.chars().skip(10).filter(|c| !c.is_whitespace()) {
                frag.push(seq_byte(&name, frag.len(), c)?);
            }
            Ok((name, frag))
        }
        NameMode::Relaxed => {
            let mut tok = line.split_whitespace();
            let name = tok.next().unwrap_or_default().to_string();
            if name.is_empty() {
                return Err(parse_err(line_no, "empty taxon name".to_string()));
            }
            let mut frag = Vec::new();
            for c in tok.flat_map(str::chars) {
                frag.push(seq_byte(&name, frag.len(), c)?);
            }
            Ok((name, frag))
        }
        // `parse_phylip` resolves `Auto` into Strict or Relaxed before
        // `parse_mode` runs, so it can never reach this arm.
        NameMode::Auto => Err(parse_err(
            line_no,
            "internal error: unresolved name mode".to_string(),
        )),
    }
}

/// Full parse under a concrete (non-`Auto`) `mode`.
fn parse_mode(text: &str, mode: NameMode) -> Result<Alignment, NeoError> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);

    let mut labels: Vec<String> = Vec::new();
    let mut seqs: Vec<Vec<u8>> = Vec::new();
    let mut first_line: Vec<u32> = Vec::new();
    let mut seen: HashSet<String> = HashSet::new();
    let mut n = 0usize;
    let mut m = 0usize;
    let mut have_header = false;
    let mut last_line = 0u32;
    // Interleaved continuation: next taxon index, reset to 0 by a blank
    // line once the first block is complete.
    let mut pos = 0usize;

    for (i, raw) in text.lines().enumerate() {
        let line_no = (i + 1) as u32;
        let line = raw.trim_end();
        if line.trim().is_empty() {
            pos = 0;
            continue;
        }
        last_line = line_no;
        if !have_header {
            let (nn, mm) = parse_header(line_no, line)?;
            if nn == 0 {
                return Err(parse_err(
                    line_no,
                    "expected at least 1 sequence".to_string(),
                ));
            }
            if nn > MAX_TAXA {
                return Err(NeoError::TooManyTaxa {
                    max: MAX_TAXA,
                    got: nn,
                });
            }
            if mm > MAX_SITES {
                return Err(parse_err(
                    line_no,
                    format!("header requests {mm} sites, maximum is {MAX_SITES}"),
                ));
            }
            n = nn;
            m = mm;
            have_header = true;
            continue;
        }

        if labels.len() < n {
            let (name, frag) = split_line(line_no, line, mode)?;
            if !seen.insert(name.clone()) {
                return Err(parse_err(line_no, format!("duplicate name '{name}'")));
            }
            labels.push(name);
            first_line.push(line_no);
            if frag.len() > m {
                return Err(parse_err(
                    line_no,
                    format!(
                        "taxon '{}': expected {m} sites, got {}",
                        labels.last().unwrap(),
                        frag.len()
                    ),
                ));
            }
            seqs.push(frag);
            continue;
        }

        // Continuation line: all characters are sequence data for the
        // taxon at `pos`.
        for c in line.chars().filter(|c| !c.is_whitespace()) {
            let position = seqs[pos].len();
            seqs[pos].push(seq_byte(&labels[pos], position, c)?);
        }
        if seqs[pos].len() > m {
            return Err(parse_err(
                line_no,
                format!(
                    "taxon '{}': expected {m} sites, got {}",
                    labels[pos],
                    seqs[pos].len()
                ),
            ));
        }
        pos = (pos + 1) % n;
    }

    if !have_header {
        return Err(parse_err(
            1,
            "expected a 'number-of-sequences number-of-sites' header".to_string(),
        ));
    }
    if labels.len() < n {
        return Err(parse_err(
            last_line.saturating_add(1),
            format!("expected {n} sequences, got {}", labels.len()),
        ));
    }
    for (i, seq) in seqs.iter().enumerate() {
        if seq.len() != m {
            return Err(parse_err(
                first_line[i],
                format!(
                    "taxon '{}': expected {m} sites, got {}",
                    labels[i],
                    seq.len()
                ),
            ));
        }
    }

    let alphabet = detect_alphabet(&seqs);
    let seqs = validate(&labels, &seqs, alphabet)?;
    Ok(Alignment {
        labels,
        seqs,
        alphabet,
    })
}

/// Parse PHYLIP text into an `Alignment` plus the name mode actually
/// used (v1.1 spec §3.2). Under `Auto`, when both parses fail the
/// Relaxed error is reported: Auto prefers Relaxed, and its error names
/// tokens that appear verbatim in the file.
pub fn parse_phylip(text: &str, names: NameMode) -> Result<(Alignment, NameMode), NeoError> {
    match names {
        NameMode::Strict => parse_mode(text, NameMode::Strict).map(|a| (a, NameMode::Strict)),
        NameMode::Relaxed => parse_mode(text, NameMode::Relaxed).map(|a| (a, NameMode::Relaxed)),
        NameMode::Auto => match parse_mode(text, NameMode::Relaxed) {
            Ok(aln) => Ok((aln, NameMode::Relaxed)),
            Err(relaxed_err) => match parse_mode(text, NameMode::Strict) {
                Ok(aln) => Ok((aln, NameMode::Strict)),
                Err(_) => Err(relaxed_err),
            },
        },
    }
}

/// Write a `DistanceMatrix` as `neighbor` input (v1.1 spec §3.2): `n`
/// on line one, then each row's name — padded to 10 characters under
/// `Strict`, followed by one space under `Relaxed` — and the distances
/// at 6 decimals. Saturated cells become `-1.000000`. `Auto` picks
/// `Strict` when every name fits, else `Relaxed`.
pub fn write_phylip_matrix(m: &DistanceMatrix, names: NameMode) -> Result<String, NeoError> {
    let n = m.labels.len();
    if m.cells.len() != n * n {
        return Err(NeoError::InvalidExercise {
            field: "cells".to_string(),
            msg: format!("matrix has {} cells for {n} taxa", m.cells.len()),
        });
    }
    let mode = match names {
        NameMode::Auto => {
            if m.labels.iter().all(|l| l.chars().count() <= 10) {
                NameMode::Strict
            } else {
                NameMode::Relaxed
            }
        }
        other => other,
    };
    for label in &m.labels {
        match mode {
            NameMode::Strict if label.chars().count() > 10 => {
                return Err(NeoError::InvalidExercise {
                    field: "names".to_string(),
                    msg: format!("name '{label}' is longer than 10 characters; use Relaxed names"),
                });
            }
            NameMode::Relaxed if label.is_empty() || label.chars().any(|c| c.is_whitespace()) => {
                return Err(NeoError::InvalidExercise {
                    field: "names".to_string(),
                    msg: format!("name '{label}' is empty or contains whitespace"),
                });
            }
            _ => {}
        }
    }

    let mut out = format!("{n}\n");
    for (i, label) in m.labels.iter().enumerate() {
        match mode {
            NameMode::Strict => out.push_str(&format!("{label:<10}")),
            _ => {
                out.push_str(label);
                out.push(' ');
            }
        }
        for j in 0..n {
            let v = match m.cells[i * n + j] {
                Cell::Value(v) => v,
                Cell::Saturated => -1.0,
            };
            out.push_str(&format!(" {v:.6}"));
        }
        out.push('\n');
    }
    Ok(out)
}
