//! MEGA `.meg` sequence import and export (v1.4b spec §3.4).
//!
//! `parse_meg` reads sequence files: a `#mega` header (first non-blank
//! line, case-insensitive), `!Title <text>;`, `!Format` with
//! `key=value` pairs (`DataType`, `Identical`, `Missing`, `Indel`;
//! keys case-insensitive, any order), `#name` lines and `"…"` comments,
//! which may span lines. Commands are `!` statements terminated by `;`
//! and may also span lines; `!Gene`, `!Domain`, `!Label` and any other
//! unrecognised command are read, ignored and reported as notices.
//!
//! Sequence data may start on the `#name` line itself (as in MEGA's
//! own examples: `#Human   ACTGACTGAC` — the name runs to the first
//! whitespace) or on the following lines, and may wrap across lines;
//! whitespace inside data is ignored. A repeated `#name` continues
//! that taxon's sequence (the interleaved layout), so later blocks may
//! name taxa in any order. The identity symbol (default `.`, or the
//! `!Format Identical=` character) expands against the *first-declared*
//! sequence; in the first sequence itself it is an error at that line.
//! A UTF-8 BOM and CRLF endings are tolerated, as in FASTA.
//!
//! `DataType` is case-insensitive: `DNA`/`Nucleotide` selects DNA,
//! `Protein` selects protein, `Distance` is refused with a message
//! pointing at v1.4c matrix import, and anything else is a parse error.
//! Absent `DataType`, the alphabet is auto-detected with a notice.
//!
//! `write_meg` emits `#mega`, `!Title`, a `!Format` line naming the gap
//! and missing symbols, a blank line, then one `#<label>` + full
//! sequence per taxon (sequential layout, no identity symbol). MEGA
//! names cannot contain whitespace, so every whitespace character in a
//! label is written as `_`; two labels colliding after the mapping are
//! an error naming both. `parse_meg` keeps names literally, never
//! mapping `_` back.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use ts_rs::TS;

use crate::alphabet::{detect_alphabet, Alphabet};
use crate::error::NeoError;
use crate::seq::{seq_byte, validate, Alignment, MAX_SITES, MAX_TAXA};

/// A parsed `.meg` file: the alignment plus display metadata
/// (v1.4b spec §3.4). `notices` lists ignored commands and
/// auto-detection for the UI to show.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct MegFile {
    pub alignment: Alignment,
    pub title: Option<String>,
    pub notices: Vec<String>,
}

/// Sentinel byte standing in for the identity symbol until it is
/// expanded against the first sequence once the whole file is read.
/// `seq_byte` only produces ASCII, so 0xFF cannot come from the input.
const IDENTITY: u8 = 0xFF;

fn parse_err(line: u32, col: u32, msg: impl Into<String>) -> NeoError {
    NeoError::Parse {
        line,
        col,
        msg: msg.into(),
    }
}

/// Strip `"…"` comments (they may span lines), keeping one cleaned
/// string per input line with its 1-based number. An unterminated
/// comment is an error at the line of its opening `"`.
fn strip_comments(text: &str) -> Result<Vec<(u32, String)>, NeoError> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut out = Vec::new();
    let mut open: Option<(u32, u32)> = None;
    for (i, raw) in text.lines().enumerate() {
        let line_no = (i + 1) as u32;
        let mut clean = String::with_capacity(raw.len());
        for (j, c) in raw.chars().enumerate() {
            match (open, c) {
                (Some(_), '"') => open = None,
                (Some(_), _) => {}
                (None, '"') => open = Some((line_no, (j + 1) as u32)),
                (None, _) => clean.push(c),
            }
        }
        out.push((line_no, clean));
    }
    if let Some((line, col)) = open {
        return Err(parse_err(line, col, "unterminated '\"' comment"));
    }
    Ok(out)
}

/// The declared data symbols (v1.4b spec §3.4): MEGA's defaults are
/// `Identical=.`, `Indel=-` and `Missing=?`.
#[derive(Debug)]
struct Symbols {
    identical: char,
    indel: char,
    missing: char,
}

impl Default for Symbols {
    fn default() -> Self {
        Symbols {
            identical: '.',
            indel: '-',
            missing: '?',
        }
    }
}

struct Parser {
    seen_header: bool,
    pending_cmd: Option<(u32, String)>,
    labels: Vec<String>,
    seqs: Vec<Vec<u8>>,
    first_line: Vec<u32>,
    dots: Vec<Vec<usize>>,
    name_to_idx: HashMap<String, usize>,
    current: Option<usize>,
    title: Option<String>,
    notices: Vec<String>,
    declared: Option<Alphabet>,
    symbols: Symbols,
    last_line: u32,
}

impl Parser {
    /// Handle one `!…` command body (the text between `!` and `;`).
    fn command(&mut self, line_no: u32, body: &str) -> Result<(), NeoError> {
        let body = body.trim();
        let mut it = body.splitn(2, char::is_whitespace);
        let name = it.next().unwrap_or_default().trim_end_matches(':');
        let rest = it.next().unwrap_or_default().trim();
        match name.to_ascii_lowercase().as_str() {
            "" => {}
            "title" => self.title = Some(rest.to_string()),
            "format" => self.format(line_no, rest)?,
            _ => self
                .notices
                .push(format!("ignored !{name} command at line {line_no}")),
        }
        Ok(())
    }

    /// `!Format` holds `key=value` pairs in any order; unknown keys and
    /// bare tokens are ignored. `DataType` resolves immediately so a
    /// distance-matrix file is refused at this line, before its data
    /// rows can fail as sequences.
    fn format(&mut self, line_no: u32, rest: &str) -> Result<(), NeoError> {
        for tok in rest.split_whitespace() {
            let Some(eq) = tok.find('=') else {
                continue;
            };
            let key = tok[..eq].to_ascii_lowercase();
            let val = &tok[eq + 1..];
            match key.as_str() {
                "datatype" => {
                    self.declared = Some(match val.to_ascii_lowercase().as_str() {
                        "dna" | "nucleotide" => Alphabet::Dna,
                        "protein" => Alphabet::Protein,
                        "distance" => return Err(parse_err(
                            line_no,
                            1,
                            "distance-matrix .meg files are not supported yet (planned for v1.4c)",
                        )),
                        other => {
                            return Err(parse_err(
                                line_no,
                                1,
                                format!("unsupported !Format DataType '{other}'"),
                            ))
                        }
                    });
                }
                "identical" => {
                    if let Some(c) = val.chars().next() {
                        self.symbols.identical = c;
                    }
                }
                "indel" => {
                    if let Some(c) = val.chars().next() {
                        self.symbols.indel = c;
                    }
                }
                "missing" => {
                    if let Some(c) = val.chars().next() {
                        self.symbols.missing = c;
                    }
                }
                _ => {}
            }
        }
        Ok(())
    }

    /// One `#name` line: a new taxon, or a continuation when the name
    /// was seen before (the interleaved layout). The name runs from
    /// after `#` to the first whitespace; the rest of the line, if any,
    /// is sequence data for that taxon (`#Human   ACTGACTGAC` in
    /// MEGA's own examples). `col` is the 1-based char column of the
    /// `#`, so errors in the same-line data point at the right column.
    fn name(&mut self, line_no: u32, col: u32, rest: &str) -> Result<(), NeoError> {
        let body = &rest[1..];
        let name_len = body.find(char::is_whitespace).unwrap_or(body.len());
        let name = &body[..name_len];
        if name.is_empty() {
            return Err(parse_err(line_no, col, "empty taxon name after '#'"));
        }
        let idx = match self.name_to_idx.get(name) {
            Some(&idx) => idx,
            None => {
                if self.labels.len() >= MAX_TAXA {
                    return Err(NeoError::TooManyTaxa {
                        max: MAX_TAXA,
                        got: self.labels.len() + 1,
                    });
                }
                self.labels.push(name.to_string());
                self.seqs.push(Vec::new());
                self.first_line.push(line_no);
                self.dots.push(Vec::new());
                self.name_to_idx
                    .insert(name.to_string(), self.labels.len() - 1);
                self.labels.len() - 1
            }
        };
        self.current = Some(idx);
        let tail = &body[name_len..];
        if !tail.trim().is_empty() {
            // `#` (at `col`) plus the name's chars precede `tail`.
            self.data(line_no, col + name.chars().count() as u32, tail)?;
        }
        Ok(())
    }

    /// Sequence data appended to the current taxon — a whole data line,
    /// or the tail of a `#name` line. The identity symbol expands
    /// later; declared indel/missing symbols map to `-`/`?`; everything
    /// else must be ASCII (`seq_byte`) and is validated against the
    /// alphabet at the end (`seq.rs` rules). `col_base` is the number
    /// of line characters preceding `rest`, so error columns point into
    /// the original line.
    fn data(&mut self, line_no: u32, col_base: u32, rest: &str) -> Result<(), NeoError> {
        let idx = match self.current {
            Some(idx) => idx,
            None => {
                return Err(parse_err(
                    line_no,
                    1,
                    "sequence data before the first '#name'",
                ))
            }
        };
        for (j, c) in rest.chars().enumerate() {
            if c.is_whitespace() {
                continue;
            }
            let pos = self.seqs[idx].len();
            let byte = if c == self.symbols.identical {
                if idx == 0 {
                    return Err(parse_err(
                        line_no,
                        col_base + (j + 1) as u32,
                        format!(
                            "identity symbol '{}' has no referent in the first sequence",
                            self.symbols.identical
                        ),
                    ));
                }
                self.dots[idx].push(pos);
                IDENTITY
            } else if c == self.symbols.indel {
                b'-'
            } else if c == self.symbols.missing {
                b'?'
            } else {
                seq_byte(&self.labels[idx], pos, c)?
            };
            self.seqs[idx].push(byte);
            if self.seqs[idx].len() > MAX_SITES {
                return Err(parse_err(
                    line_no,
                    col_base + (j + 1) as u32,
                    format!("sequence exceeds the {MAX_SITES}-site import limit"),
                ));
            }
        }
        Ok(())
    }
}

/// The 1-based char column of `rest`'s first char inside `line`
/// (`rest` is always a suffix of `line`, so the prefix is a char
/// boundary).
fn col_of(line: &str, rest: &str) -> u32 {
    (line[..line.len() - rest.len()].chars().count() + 1) as u32
}

/// Parse MEGA `.meg` text into a `MegFile` (v1.4b spec §3.4). Every
/// malformed input is a `NeoError` with a 1-based line number over the
/// BOM-stripped text; the parser never panics.
pub fn parse_meg(text: &str) -> Result<MegFile, NeoError> {
    let lines = strip_comments(text)?;
    let mut p = Parser {
        seen_header: false,
        pending_cmd: None,
        labels: Vec::new(),
        seqs: Vec::new(),
        first_line: Vec::new(),
        dots: Vec::new(),
        name_to_idx: HashMap::new(),
        current: None,
        title: None,
        notices: Vec::new(),
        declared: None,
        symbols: Symbols::default(),
        last_line: 0,
    };

    for (line_no, clean) in &lines {
        let (line_no, mut rest) = (*line_no, clean.as_str());
        loop {
            if let Some((start, mut acc)) = p.pending_cmd.take() {
                match rest.find(';') {
                    Some(end) => {
                        acc.push_str(&rest[..end]);
                        p.command(start, &acc)?;
                        rest = &rest[end + 1..];
                        continue;
                    }
                    None => {
                        acc.push_str(rest);
                        p.pending_cmd = Some((start, acc));
                        break;
                    }
                }
            }
            rest = rest.trim_start();
            if rest.is_empty() {
                break;
            }
            p.last_line = line_no;
            if !p.seen_header {
                if !rest
                    .get(..5)
                    .is_some_and(|h| h.eq_ignore_ascii_case("#mega"))
                {
                    return Err(parse_err(1, 1, "expected '#mega' on the first line"));
                }
                p.seen_header = true;
                break;
            }
            match rest.as_bytes()[0] {
                b'!' => match rest.find(';') {
                    Some(end) => {
                        p.command(line_no, &rest[1..end])?;
                        rest = &rest[end + 1..];
                    }
                    None => {
                        p.pending_cmd = Some((line_no, rest[1..].to_string()));
                        break;
                    }
                },
                b'#' => {
                    p.name(line_no, col_of(clean, rest), rest)?;
                    break;
                }
                _ => {
                    p.data(line_no, col_of(clean, rest) - 1, rest)?;
                    break;
                }
            }
        }
    }

    if !p.seen_header {
        return Err(parse_err(1, 1, "expected '#mega' on the first line"));
    }
    if let Some((start, _)) = p.pending_cmd {
        return Err(parse_err(
            start,
            1,
            "unterminated '!' command (expected ';')",
        ));
    }
    if p.labels.is_empty() {
        return Err(parse_err(
            p.last_line.max(1),
            1,
            "no '#name' sequence records found",
        ));
    }
    let m = p.seqs[0].len();
    for (i, seq) in p.seqs.iter().enumerate() {
        if seq.len() != m {
            return Err(parse_err(
                p.first_line[i],
                1,
                format!(
                    "taxon '{}': expected {m} sites, got {}",
                    p.labels[i],
                    seq.len()
                ),
            ));
        }
    }
    // Expand the identity symbol against the first-declared sequence.
    for i in 1..p.seqs.len() {
        for &pos in &p.dots[i] {
            p.seqs[i][pos] = p.seqs[0][pos];
        }
    }

    let alphabet = match p.declared {
        Some(a) => a,
        None => {
            p.notices
                .push("no !Format DataType; alphabet auto-detected".to_string());
            detect_alphabet(&p.seqs)
        }
    };
    let seqs = validate(&p.labels, &p.seqs, alphabet)?;
    Ok(MegFile {
        alignment: Alignment {
            labels: p.labels,
            seqs,
            alphabet,
        },
        title: p.title,
        notices: p.notices,
    })
}

/// Write an `Alignment` in MEGA `.meg` format (v1.4b spec §3.4):
/// `#mega`, `!Title`, `!Format` declaring `DataType=<DNA|Protein>
/// Indel=- Missing=?`, a blank line, then `#<label>` and the full
/// sequence per taxon.
///
/// MEGA names cannot contain whitespace, so every whitespace character
/// in a label is written as `_`. Two labels colliding after that
/// mapping (e.g. `a b` and `a_b`), an empty label, or a label
/// containing `"` (which would open a comment on re-parse) is an
/// `InvalidExercise` error naming the offending labels. The title
/// cannot contain `"`, `;` or a line break.
pub fn write_meg(aln: &Alignment, title: &str) -> Result<String, NeoError> {
    if title.chars().any(|c| matches!(c, '"' | ';' | '\r' | '\n')) {
        return Err(NeoError::InvalidExercise {
            field: "title".to_string(),
            msg: "title contains '\"', ';' or a line break, which cannot be written in a .meg command"
                .to_string(),
        });
    }
    if aln.labels.is_empty() {
        return Err(NeoError::InvalidExercise {
            field: "names".to_string(),
            msg: "no taxa to write".to_string(),
        });
    }
    if aln.labels.len() != aln.seqs.len() {
        return Err(NeoError::InvalidExercise {
            field: "seqs".to_string(),
            msg: format!(
                "{} labels but {} sequences",
                aln.labels.len(),
                aln.seqs.len()
            ),
        });
    }
    let sites = aln.seqs[0].len();
    for (label, seq) in aln.labels.iter().zip(&aln.seqs) {
        if seq.len() != sites {
            return Err(NeoError::InvalidExercise {
                field: "seqs".to_string(),
                msg: format!(
                    "sequence '{label}' has {} sites, expected {sites}",
                    seq.len()
                ),
            });
        }
    }

    let mut mapped: Vec<String> = Vec::with_capacity(aln.labels.len());
    let mut seen: HashMap<String, &str> = HashMap::new();
    for label in &aln.labels {
        let name: String = label
            .chars()
            .map(|c| if c.is_whitespace() { '_' } else { c })
            .collect();
        if name.is_empty() {
            return Err(NeoError::InvalidExercise {
                field: "names".to_string(),
                msg: "empty label cannot be written to .meg".to_string(),
            });
        }
        if name.contains('"') {
            return Err(NeoError::InvalidExercise {
                field: "names".to_string(),
                msg: format!("label '{label}' contains '\"', which cannot appear in a .meg name"),
            });
        }
        if let Some(prev) = seen.get(&name) {
            return Err(NeoError::InvalidExercise {
                field: "names".to_string(),
                msg: format!("labels '{prev}' and '{label}' both map to '{name}' in .meg output"),
            });
        }
        seen.insert(name.clone(), label);
        mapped.push(name);
    }

    let dtype = match aln.alphabet {
        Alphabet::Dna => "DNA",
        Alphabet::Protein => "Protein",
    };
    let mut out = String::new();
    out.push_str("#mega\n");
    out.push_str("!Title ");
    out.push_str(title);
    out.push_str(";\n");
    out.push_str("!Format DataType=");
    out.push_str(dtype);
    out.push_str(" Indel=- Missing=?;\n\n");
    for (label, seq) in mapped.iter().zip(&aln.seqs) {
        out.push('#');
        out.push_str(label);
        out.push('\n');
        let data = std::str::from_utf8(seq).map_err(|_| NeoError::InvalidExercise {
            field: "seqs".to_string(),
            msg: format!("sequence '{label}' contains non-UTF-8 data"),
        })?;
        out.push_str(data);
        out.push('\n');
    }
    Ok(out)
}
