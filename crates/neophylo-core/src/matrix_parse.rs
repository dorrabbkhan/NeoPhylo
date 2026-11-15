//! Distance-matrix file and paste parsers (v1.4c spec §5.1, plan
//! Task 4): PHYLIP matrix files (square and lower-triangular), MEGA
//! `.meg` distance files (LowerLeft and UpperRight), the tolerant
//! pasted-matrix form, `detect_matrix_format` and `write_meg_matrix`.
//! Every parser validates through [`validate_input`]; structural
//! problems are `NeoError::InvalidMatrix`, file-syntax problems are
//! `NeoError::Parse`. Nothing here panics on any input.
//!
//! # PHYLIP grammar
//!
//! The first non-blank line is the taxon count `n` alone. Then `n`
//! rows, each starting on a fresh line with its name; values are
//! whitespace-separated and may wrap across lines. Two shapes are
//! recognised: square (row `i` has `n` values) and lower-triangular
//! (row `i` has `i` values, so the first row is a name alone). Square
//! is tried first; when both readings fail, the error comes from the
//! shape the first row suggests — a first row carrying values looks
//! square, a name alone looks lower. Under every `NameMode` a name is
//! the first whitespace-delimited token of the row's first line; under
//! `Strict` its identity is its first 10 characters, and two distinct
//! names truncating to the same string are `InvalidMatrix` naming
//! both full names (Review Focus 2) — exact duplicates reuse
//! `validate_input`'s refusal. `Auto` tries Relaxed first and falls
//! back to Strict, reporting the Relaxed error, as `parse_phylip`
//! does.
//!
//! A square matrix must be symmetric and zero on the diagonal: the
//! first differing cell is `InvalidMatrix` naming both taxa, unless
//! `use_lower_if_asymmetric` is set, which takes the lower triangle
//! and reports a notice instead. `-1` (exactly) is a
//! dnadist/protdist saturation marker — `InvalidMatrix` "saturated in
//! the source program"; any other negative or non-finite value is the
//! normal negative-value refusal naming the cell. Non-numeric tokens
//! in a value position are `Parse { line, col }`.
//!
//! # `.meg` grammar
//!
//! `#mega` on the first non-blank line (case-insensitive), `!Title`,
//! `!Format` with `DataType=Distance` (required; `DataFormat` is
//! `LowerLeft` — the default, with a notice — or `UpperRight`, and a
//! declared `NTaxa` must equal the `#name` count), other `!` commands
//! ignored as notices, `"…"` comments stripped. `#name` lines may be
//! interleaved with data rows; the tail of a `#name` line counts as
//! one data row. Data rows then fill the declared triangle in order —
//! LowerLeft: `n−1` rows of 1, 2, …, `n−1` values (row `r` is taxon
//! `r+1`); UpperRight: `n−1` rows of `n−1`, …, 1 values (row `r` is
//! taxon `r`). `?` or `n/c` is `InvalidMatrix` naming the cell.
//!
//! # Paste grammar
//!
//! Tries `parse_phylip_matrix` first, then a tabular reading: lines
//! are rows, cells are separated by whitespace runs (spaces, tabs,
//! NBSP) and — unless `decimal_comma` is set — commas. Unicode minus
//! `−` reads as `-` (and is then refused as negative). The value
//! block is square (`n` cells a row), lower+diagonal (`i+1` cells a
//! row — a square whose upper triangle was left blank) or, only when
//! a name column is present, strict lower (`i` cells; without names a
//! strict-lower block would need an extra taxon with no row at all).
//! Diagonal cells must be zero and a square block must be symmetric.
//! With no name column the taxa are named A, B, C, … (a notice).
//!
//! Each `PasteOptions` field left `None` is resolved by trying both
//! readings; `MatrixAmbiguous` is returned only when the text
//! genuinely admits two. A comma inside a dot-free numeric token
//! (`0,25`) is ambiguous — decimal mark or separator — and is asked
//! about whenever `decimal_comma` is unset; a token already carrying
//! `.` is settled (`0.25`), and under `decimal_comma` a comma is
//! never split into two cells. A header row whose tokens equal the
//! first column's names settles both name questions. When several
//! fields are unset and the surviving readings differ, the header
//! question is asked before the name-column one.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::{NeoError, PasteQuestion};
use crate::matrix_input::{validate_input, DistanceInput};
use crate::phylip::NameMode;
use crate::seq::MAX_TAXA;

/// Which matrix file format [`detect_matrix_format`] recognised.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum MatrixFormat {
    /// `n` alone on the first line, then name + value rows.
    Phylip,
    /// `#mega` with `!Format DataType=Distance`.
    Meg,
}

/// A parsed distance matrix plus display metadata.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct MatrixFile {
    pub matrix: DistanceInput,
    pub title: Option<String>,
    pub notices: Vec<String>,
}

/// Options for [`parse_phylip_matrix`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct PhylipMatrixOptions {
    /// How taxon names are delimited (same meaning as `parse_phylip`).
    pub names: NameMode,
    /// When a square matrix's triangles disagree, take the lower one
    /// and report a notice instead of refusing.
    pub use_lower_if_asymmetric: bool,
}

/// Options for [`parse_pasted_matrix`]. A `None` field is resolved
/// from the text when it settles the question, else asked as
/// `NeoError::MatrixAmbiguous`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct PasteOptions {
    /// Does the first column hold the taxon names?
    pub first_column_names: Option<bool>,
    /// Is the first row a header of names?
    pub header_row: Option<bool>,
    /// Is a comma a decimal mark (`true`) or a cell separator
    /// (`false`)?
    pub decimal_comma: Option<bool>,
}

fn parse_err(line: u32, col: u32, msg: impl Into<String>) -> NeoError {
    NeoError::Parse {
        line,
        col,
        msg: msg.into(),
    }
}

fn invalid(row: &str, col: &str, msg: impl Into<String>) -> NeoError {
    NeoError::InvalidMatrix {
        row: row.to_string(),
        col: col.to_string(),
        msg: msg.into(),
    }
}

fn structural(msg: impl Into<String>) -> NeoError {
    invalid("", "", msg)
}

/// Non-blank lines with their 1-based numbers, BOM stripped.
fn nonblank_lines(text: &str) -> Vec<(u32, String)> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    text.lines()
        .enumerate()
        .map(|(i, l)| ((i + 1) as u32, l.trim_end().to_string()))
        .filter(|(_, l)| !l.trim().is_empty())
        .collect()
}

/// Whitespace-separated tokens with their 1-based char column.
/// `char::is_whitespace` covers NBSP and friends.
fn tokenize(line: &str) -> Vec<(u32, &str)> {
    let mut out = Vec::new();
    let mut col = 0u32;
    let mut start: Option<usize> = None;
    let mut start_col = 0u32;
    for (i, c) in line.char_indices() {
        col += 1;
        if c.is_whitespace() {
            if let Some(s) = start.take() {
                out.push((start_col, &line[s..i]));
            }
        } else if start.is_none() {
            start = Some(i);
            start_col = col;
        }
    }
    if let Some(s) = start {
        out.push((start_col, &line[s..]));
    }
    out
}

/// `-1` exactly is a dnadist/protdist saturation marker; any other
/// negative or non-finite value is refused naming the cell.
fn check_value(v: f64, row: &str, col: &str) -> Result<(), NeoError> {
    if v == -1.0 {
        Err(invalid(
            row,
            col,
            "distance is -1: the cell was saturated in the source program",
        ))
    } else if !v.is_finite() || v < 0.0 {
        Err(invalid(
            row,
            col,
            format!("distance must be finite and non-negative, got {v}"),
        ))
    } else {
        Ok(())
    }
}

/// Refuse exact-duplicate names first (the `validate_input` refusal,
/// naming the shared full name); then, under Strict, refuse two
/// distinct names that collide at 10 characters — `InvalidMatrix`
/// naming both full names and the truncated one (Review Focus 2).
fn effective_names(full: &[String], strict: bool) -> Result<Vec<String>, NeoError> {
    for (k, name) in full.iter().enumerate() {
        for (l, earlier) in full.iter().enumerate().take(k) {
            if earlier == name {
                return Err(invalid(
                    name,
                    name,
                    format!("taxa {} and {} share the name '{name}'", l + 1, k + 1),
                ));
            }
        }
    }
    if !strict {
        return Ok(full.to_vec());
    }
    let eff: Vec<String> = full.iter().map(|n| n.chars().take(10).collect()).collect();
    for (k, e) in eff.iter().enumerate() {
        for (l, earlier) in eff.iter().enumerate().take(k) {
            if earlier == e {
                return Err(invalid(
                    &full[l],
                    &full[k],
                    format!("both become '{e}' under PHYLIP's 10-character limit"),
                ));
            }
        }
    }
    Ok(eff)
}

// ---- PHYLIP --------------------------------------------------------

/// One shape parse: `full_names` are the raw name tokens and `rows`
/// the value rows (`n` wide for a square parse, `i` wide for lower).
/// The error return carries how far the attempt got, to pick the
/// better error when both shapes fail.
struct PhylipShape {
    full_names: Vec<String>,
    rows: Vec<Vec<f64>>,
    square: bool,
}

fn phylip_shape(
    lines: &[(u32, String)],
    n: usize,
    square: bool,
) -> Result<PhylipShape, (NeoError, u32)> {
    let toklines: Vec<Vec<(u32, &str)>> = lines.iter().map(|(_, l)| tokenize(l)).collect();
    let last_line = lines.last().map(|(no, _)| *no).unwrap_or(1);
    let mut full_names = Vec::with_capacity(n);
    let mut rows: Vec<Vec<f64>> = Vec::with_capacity(n);
    let mut li = 1usize; // data lines start after the header
    for i in 0..n {
        if li >= toklines.len() {
            return Err((
                parse_err(
                    last_line + 1,
                    1,
                    format!("expected {n} matrix rows, got {i}"),
                ),
                li as u32,
            ));
        }
        // A row's name is its line's first token; non-blank lines
        // always have one.
        let full = toklines[li][0].1.to_string();
        let need = if square { n } else { i };
        let mut vals = Vec::with_capacity(need);
        let mut l = li;
        let mut t = 1usize; // skip the name token on the first line
        while vals.len() < need {
            if l >= toklines.len() {
                return Err((
                    parse_err(
                        last_line + 1,
                        1,
                        format!(
                            "row for '{full}' has {} values, expected {need}",
                            vals.len()
                        ),
                    ),
                    l as u32,
                ));
            }
            let lt = &toklines[l];
            while t < lt.len() && vals.len() < need {
                let (col, tok) = lt[t];
                match tok.parse::<f64>() {
                    Ok(v) => vals.push(v),
                    Err(_) => {
                        return Err((
                            parse_err(lines[l].0, col, format!("expected a number, got '{tok}'")),
                            l as u32,
                        ))
                    }
                }
                t += 1;
            }
            if vals.len() == need && t < lt.len() {
                return Err((
                    parse_err(
                        lines[l].0,
                        lt[t].0,
                        format!("extra value '{}' after the row for '{full}'", lt[t].1),
                    ),
                    l as u32,
                ));
            }
            if vals.len() < need {
                l += 1;
                t = 0;
            }
        }
        li = l + 1;
        full_names.push(full);
        rows.push(vals);
    }
    if li < lines.len() {
        return Err((
            parse_err(
                lines[li].0,
                1,
                format!("extra content after the {n} matrix rows"),
            ),
            li as u32,
        ));
    }
    Ok(PhylipShape {
        full_names,
        rows,
        square,
    })
}

/// Names, value and symmetry checks on a completed PHYLIP shape
/// parse, then the assembled `DistanceInput`.
fn phylip_finish(
    sh: &PhylipShape,
    strict: bool,
    use_lower: bool,
    notices: &mut Vec<String>,
) -> Result<DistanceInput, NeoError> {
    let names = effective_names(&sh.full_names, strict)?;
    let n = names.len();
    if sh.square {
        for i in 0..n {
            for j in 0..n {
                check_value(sh.rows[i][j], &names[i], &names[j])?;
            }
            if sh.rows[i][i] != 0.0 {
                return Err(invalid(
                    &names[i],
                    &names[i],
                    format!("diagonal cell must be 0, got {}", sh.rows[i][i]),
                ));
            }
        }
        let mut asymmetric = false;
        'outer: for i in 0..n {
            for j in 0..i {
                if sh.rows[i][j] != sh.rows[j][i] {
                    if !use_lower {
                        return Err(invalid(
                            &names[i],
                            &names[j],
                            format!(
                                "matrix is not symmetric: d({},{}) = {} but d({},{}) = {}",
                                names[i],
                                names[j],
                                sh.rows[i][j],
                                names[j],
                                names[i],
                                sh.rows[j][i]
                            ),
                        ));
                    }
                    asymmetric = true;
                    break 'outer;
                }
            }
        }
        if asymmetric {
            notices.push("square matrix was asymmetric; used the lower triangle".to_string());
        }
        let mut lower = Vec::with_capacity(n * n.saturating_sub(1) / 2);
        for i in 0..n {
            lower.extend_from_slice(&sh.rows[i][..i]);
        }
        let m = DistanceInput { names, lower };
        validate_input(&m)?;
        Ok(m)
    } else {
        let mut lower = Vec::with_capacity(n * n.saturating_sub(1) / 2);
        for (i, row) in sh.rows.iter().enumerate() {
            for (j, &v) in row.iter().enumerate() {
                check_value(v, &names[i], &names[j])?;
                lower.push(v);
            }
        }
        let m = DistanceInput { names, lower };
        validate_input(&m)?;
        Ok(m)
    }
}

fn phylip_inner(
    text: &str,
    opts: PhylipMatrixOptions,
    mode: NameMode,
) -> Result<MatrixFile, NeoError> {
    let lines = nonblank_lines(text);
    let (hno, hline) = match lines.first() {
        Some((no, l)) => (*no, l.as_str()),
        None => return Err(parse_err(1, 1, "empty input; expected a taxon count")),
    };
    let toks = tokenize(hline);
    let n = match toks.as_slice() {
        [(col, t)] => match t.parse::<usize>() {
            Ok(n) => n,
            Err(_) => {
                return Err(parse_err(
                    hno,
                    *col,
                    format!("expected a taxon count on the first line, got '{t}'"),
                ))
            }
        },
        _ => {
            return Err(parse_err(
                hno,
                toks.first().map(|(c, _)| *c).unwrap_or(1),
                "expected a taxon count alone on the first line",
            ))
        }
    };
    if n > MAX_TAXA {
        return Err(NeoError::TooManyTaxa {
            max: MAX_TAXA,
            got: n,
        });
    }
    let sh = match (
        phylip_shape(&lines, n, true),
        phylip_shape(&lines, n, false),
    ) {
        (Ok(s), _) => s,
        (Err(_), Ok(l)) => l,
        (Err((es, ps)), Err((el, pl))) => {
            // Both readings failed: report the error of the shape the
            // first row suggests (a name line carrying values looks
            // square; a name alone looks lower), breaking ties by
            // which parse saw more lines.
            let row0_values = lines.get(1).map(|(_, l)| tokenize(l).len() > 1);
            return Err(if row0_values == Some(false) {
                if pl >= ps {
                    el
                } else {
                    es
                }
            } else if ps >= pl {
                es
            } else {
                el
            });
        }
    };
    let mut notices = Vec::new();
    let matrix = phylip_finish(
        &sh,
        mode == NameMode::Strict,
        opts.use_lower_if_asymmetric,
        &mut notices,
    )?;
    Ok(MatrixFile {
        matrix,
        title: None,
        notices,
    })
}

/// Parse PHYLIP `neighbor` input: `n` alone on the first line, then
/// square or lower-triangular rows of name + values, rows possibly
/// wrapping (v1.4c spec §5.1).
pub fn parse_phylip_matrix(text: &str, opts: PhylipMatrixOptions) -> Result<MatrixFile, NeoError> {
    match opts.names {
        NameMode::Auto => match phylip_inner(text, opts, NameMode::Relaxed) {
            Ok(f) => Ok(f),
            Err(relaxed_err) => match phylip_inner(text, opts, NameMode::Strict) {
                Ok(f) => Ok(f),
                Err(_) => Err(relaxed_err),
            },
        },
        mode => phylip_inner(text, opts, mode),
    }
}

// ---- .meg ----------------------------------------------------------

/// Strip `"…"` comments (they may span lines), keeping one cleaned
/// string per input line with its 1-based number; a UTF-8 BOM is
/// removed. An unterminated comment is an error at its opening `"`.
/// Mirrors `meg::parse_meg`'s comment rules.
fn meg_lines(text: &str) -> Result<Vec<(u32, String)>, NeoError> {
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

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum MegLayout {
    LowerLeft,
    UpperRight,
}

/// `!Format` `key=value` pairs: whitespace is tolerated around `=`
/// (`DataType = Distance`), unknown keys ignored.
fn meg_format_pairs(rest: &str) -> Vec<(String, String)> {
    let toks: Vec<&str> = rest.split_whitespace().collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < toks.len() {
        let mut tok = toks[i].to_string();
        while !tok.contains('=') && toks.get(i + 1).is_some_and(|t| t.starts_with('=')) {
            i += 1;
            tok.push_str(toks[i]);
        }
        if tok.ends_with('=') && toks.get(i + 1).is_some_and(|t| !t.contains('=')) {
            i += 1;
            tok.push_str(toks[i]);
        }
        i += 1;
        if let Some(eq) = tok.find('=') {
            out.push((tok[..eq].to_ascii_lowercase(), tok[eq + 1..].to_string()));
        }
    }
    out
}

/// State accumulated while scanning a `.meg` distance file.
struct MegScan {
    seen_header: bool,
    pending: Option<(u32, String)>,
    names: Vec<String>,
    /// Data rows in order: (line number, value tokens with columns).
    data: Vec<(u32, Vec<(u32, String)>)>,
    title: Option<String>,
    notices: Vec<String>,
    layout: Option<MegLayout>,
    ntaxa: Option<usize>,
    distance: bool,
    last_line: u32,
}

impl MegScan {
    fn command(&mut self, line_no: u32, body: &str) -> Result<(), NeoError> {
        let body = body.trim();
        let mut it = body.splitn(2, char::is_whitespace);
        let name = it.next().unwrap_or_default().trim_end_matches(':');
        let rest = it.next().unwrap_or_default().trim();
        match name.to_ascii_lowercase().as_str() {
            "" => {}
            "title" => self.title = Some(rest.to_string()),
            "format" => {
                for (key, val) in meg_format_pairs(rest) {
                    match key.as_str() {
                        "datatype" => {
                            if val.eq_ignore_ascii_case("distance") {
                                self.distance = true;
                            } else {
                                return Err(parse_err(
                                    line_no,
                                    1,
                                    format!(
                                        "this .meg file holds {val} data, not a distance matrix"
                                    ),
                                ));
                            }
                        }
                        "dataformat" => {
                            self.layout = Some(match val.to_ascii_lowercase().as_str() {
                                "lowerleft" => MegLayout::LowerLeft,
                                "upperright" => MegLayout::UpperRight,
                                other => {
                                    return Err(parse_err(
                                        line_no,
                                        1,
                                        format!("unknown !Format DataFormat '{other}'"),
                                    ))
                                }
                            });
                        }
                        "ntaxa" => {
                            self.ntaxa = Some(val.parse::<usize>().map_err(|_| {
                                parse_err(line_no, 1, format!("bad NTaxa '{val}'"))
                            })?);
                        }
                        _ => {}
                    }
                }
            }
            _ => self
                .notices
                .push(format!("ignored !{name} command at line {line_no}")),
        }
        Ok(())
    }

    fn data_line(&mut self, line_no: u32, text: &str) {
        self.data.push((
            line_no,
            tokenize(text)
                .into_iter()
                .map(|(c, t)| (c, t.to_string()))
                .collect(),
        ));
    }
}

/// Parse a MEGA `.meg` distance file (`!Format DataType=Distance`)
/// into a `MatrixFile` (v1.4c spec §5.1).
pub fn parse_meg_matrix(text: &str) -> Result<MatrixFile, NeoError> {
    let lines = meg_lines(text)?;
    let mut p = MegScan {
        seen_header: false,
        pending: None,
        names: Vec::new(),
        data: Vec::new(),
        title: None,
        notices: Vec::new(),
        layout: None,
        ntaxa: None,
        distance: false,
        last_line: 0,
    };
    for (line_no, clean) in &lines {
        let (line_no, mut rest) = (*line_no, clean.as_str());
        loop {
            if let Some((start, mut acc)) = p.pending.take() {
                match rest.find(';') {
                    Some(end) => {
                        acc.push_str(&rest[..end]);
                        p.command(start, &acc)?;
                        rest = &rest[end + 1..];
                        continue;
                    }
                    None => {
                        acc.push_str(rest);
                        p.pending = Some((start, acc));
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
                        p.pending = Some((line_no, rest[1..].to_string()));
                        break;
                    }
                },
                b'#' => {
                    let body = &rest[1..];
                    let name_len = body.find(char::is_whitespace).unwrap_or(body.len());
                    let name = &body[..name_len];
                    if name.is_empty() {
                        return Err(parse_err(line_no, 1, "empty taxon name after '#'"));
                    }
                    p.names.push(name.to_string());
                    let tail = body[name_len..].trim();
                    if !tail.is_empty() {
                        p.data_line(line_no, tail);
                    }
                    break;
                }
                _ => {
                    p.data_line(line_no, rest);
                    break;
                }
            }
        }
    }

    if !p.seen_header {
        return Err(parse_err(1, 1, "expected '#mega' on the first line"));
    }
    if let Some((start, _)) = p.pending {
        return Err(parse_err(
            start,
            1,
            "unterminated '!' command (expected ';')",
        ));
    }
    if !p.distance {
        return Err(parse_err(
            p.last_line.max(1),
            1,
            "expected !Format DataType=Distance for a distance-matrix .meg file",
        ));
    }
    if p.names.is_empty() {
        return Err(parse_err(p.last_line.max(1), 1, "no '#name' records found"));
    }
    let n = p.names.len();
    if let Some(m) = p.ntaxa {
        if m != n {
            return Err(parse_err(
                p.last_line,
                1,
                format!("!Format declares NTaxa={m} but {n} names were found"),
            ));
        }
    }
    if n > MAX_TAXA {
        return Err(NeoError::TooManyTaxa {
            max: MAX_TAXA,
            got: n,
        });
    }
    let layout = match p.layout {
        Some(l) => l,
        None => {
            p.notices
                .push("no !Format DataFormat; read as LowerLeft".to_string());
            MegLayout::LowerLeft
        }
    };
    if p.data.len() + 1 != n {
        return Err(parse_err(
            p.last_line,
            1,
            format!(
                "expected {} matrix rows for {n} taxa, got {}",
                n.saturating_sub(1),
                p.data.len()
            ),
        ));
    }

    // Rows are positional: LowerLeft row r is taxon r+1 with r+1
    // values d(r+1, 0..r); UpperRight row r is taxon r with n−1−r
    // values d(r, r+1..n−1).
    let mut lower = vec![f64::NAN; n * n.saturating_sub(1) / 2];
    for (r, (line_no, toks)) in p.data.iter().enumerate() {
        let (i, want) = match layout {
            MegLayout::LowerLeft => (r + 1, r + 1),
            MegLayout::UpperRight => (r, n - 1 - r),
        };
        if toks.len() != want {
            return Err(parse_err(
                *line_no,
                1,
                format!(
                    "row for '{}' has {} values, expected {want}",
                    p.names[i],
                    toks.len()
                ),
            ));
        }
        for (k, (col, tok)) in toks.iter().enumerate() {
            // Cell (i, j): LowerLeft j = k; UpperRight j = r+1+k.
            let j = match layout {
                MegLayout::LowerLeft => k,
                MegLayout::UpperRight => r + 1 + k,
            };
            let (row, cn) = if i > j { (i, j) } else { (j, i) };
            let v = if tok == "?" || tok.eq_ignore_ascii_case("n/c") {
                return Err(invalid(
                    &p.names[row],
                    &p.names[cn],
                    format!("missing distance ('{tok}')"),
                ));
            } else {
                match tok.parse::<f64>() {
                    Ok(v) => v,
                    Err(_) => {
                        return Err(parse_err(
                            *line_no,
                            *col,
                            format!("expected a number, got '{tok}'"),
                        ))
                    }
                }
            };
            check_value(v, &p.names[row], &p.names[cn])?;
            lower[row * (row - 1) / 2 + cn] = v;
        }
    }
    let m = DistanceInput {
        names: p.names,
        lower,
    };
    validate_input(&m)?;
    Ok(MatrixFile {
        matrix: m,
        title: p.title,
        notices: p.notices,
    })
}

/// Write a `DistanceInput` as a MEGA `.meg` distance file (v1.4c spec
/// §5.4): `#mega`, `!Title`, `!Format DataType=Distance
/// DataFormat=LowerLeft NTaxa=n`, the `#name` lines, then the strict
/// lower triangle at full precision (`{}` round-trips an `f64`).
///
/// Name rules follow `write_meg`: whitespace maps to `_`, and a `"`
/// in a label or two labels colliding after the mapping is
/// `InvalidExercise`. The title cannot contain `"`, `;` or a line
/// break.
pub fn write_meg_matrix(m: &DistanceInput, title: &str) -> Result<String, NeoError> {
    validate_input(m)?;
    if title.chars().any(|c| matches!(c, '"' | ';' | '\r' | '\n')) {
        return Err(NeoError::InvalidExercise {
            field: "title".to_string(),
            msg: "title contains '\"', ';' or a line break, which cannot be written in a .meg command"
                .to_string(),
        });
    }
    let mut mapped: Vec<String> = Vec::with_capacity(m.names.len());
    for label in &m.names {
        let name: String = label
            .chars()
            .map(|c| if c.is_whitespace() { '_' } else { c })
            .collect();
        if name.contains('"') {
            return Err(NeoError::InvalidExercise {
                field: "names".to_string(),
                msg: format!("label '{label}' contains '\"', which cannot appear in a .meg name"),
            });
        }
        if mapped.contains(&name) {
            return Err(NeoError::InvalidExercise {
                field: "names".to_string(),
                msg: format!("labels '{label}' and another both map to '{name}' in .meg output"),
            });
        }
        mapped.push(name);
    }
    let n = m.names.len();
    let mut out = String::new();
    out.push_str("#mega\n!Title ");
    out.push_str(title);
    out.push_str(";\n!Format DataType=Distance DataFormat=LowerLeft NTaxa=");
    out.push_str(&n.to_string());
    out.push_str(";\n\n");
    for name in &mapped {
        out.push('#');
        out.push_str(name);
        out.push('\n');
    }
    out.push('\n');
    for i in 1..n {
        for j in 0..i {
            if j > 0 {
                out.push(' ');
            }
            out.push_str(&format!("{}", m.get(i, j)));
        }
        out.push('\n');
    }
    Ok(out)
}

// ---- detection ------------------------------------------------------

/// Does a `!Format` command body declare `DataType=Distance` (any
/// spacing or case)?
fn format_declares_distance(body: &str) -> bool {
    let b = body.trim();
    let mut it = b.splitn(2, char::is_whitespace);
    let first = it.next().unwrap_or_default().trim_end_matches(':');
    if !first.eq_ignore_ascii_case("format") {
        return false;
    }
    meg_format_pairs(it.next().unwrap_or_default())
        .iter()
        .any(|(k, v)| k == "datatype" && v.eq_ignore_ascii_case("distance"))
}

/// Sniff a matrix file's format (v1.4c spec §5.1, plan): `#mega` plus
/// `DataType=Distance` (any spacing or case) is `Meg`; a first
/// non-blank line holding a single integer followed by a row starting
/// with a name is `Phylip`; anything else — alignments, FASTA,
/// Newick, a sequence `.meg` — is `None`.
pub fn detect_matrix_format(text: &str) -> Option<MatrixFormat> {
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let mut lines = text.lines().map(str::trim).filter(|l| !l.is_empty());
    let first = lines.next()?;
    if first
        .get(..5)
        .is_some_and(|h| h.eq_ignore_ascii_case("#mega"))
    {
        // Scan `!…;` commands (skipping `"…"` comments) for a !Format
        // declaring DataType=Distance.
        let mut in_cmd = false;
        let mut in_quote = false;
        let mut body = String::new();
        for c in text.chars() {
            if in_quote {
                if c == '"' {
                    in_quote = false;
                }
                continue;
            }
            if c == '"' {
                in_quote = true;
                continue;
            }
            if in_cmd {
                if c == ';' {
                    if format_declares_distance(&body) {
                        return Some(MatrixFormat::Meg);
                    }
                    body.clear();
                    in_cmd = false;
                } else {
                    body.push(c);
                }
            } else if c == '!' {
                in_cmd = true;
            }
        }
        return None;
    }
    let mut toks = first.split_whitespace();
    match (toks.next(), toks.next()) {
        (Some(t), None) if t.parse::<usize>().is_ok() => {}
        _ => return None,
    }
    // The next row must start with a name — a token that is not a
    // number.
    let second = lines.next()?;
    let tok = second.split_whitespace().next()?;
    if tok.parse::<f64>().is_ok() {
        None
    } else {
        Some(MatrixFormat::Phylip)
    }
}

// ---- paste ----------------------------------------------------------

/// A comma that sits between digits inside a dot-free token could be
/// a decimal mark or a separator; `0,25` asks, `0.25` is settled.
fn comma_ambiguous(tok: &str) -> bool {
    if !tok.contains(',') || tok.contains('.') {
        return false;
    }
    let b = tok.as_bytes();
    b.iter().enumerate().any(|(i, &c)| {
        c == b','
            && i > 0
            && b[i - 1].is_ascii_digit()
            && b.get(i + 1).is_some_and(|d| d.is_ascii_digit())
    })
}

/// Generated name for the no-name-column reading: A–Z, then taxon27….
fn generated_name(i: usize) -> String {
    if i < 26 {
        ((b'A' + i as u8) as char).to_string()
    } else {
        format!("taxon{}", i + 1)
    }
}

struct PasteRow {
    line: u32,
    cells: Vec<(u32, String)>,
}

/// A numeric cell: under `decimal_comma` a comma inside the cell is a
/// decimal mark; it is never split into two cells.
fn paste_num(cell: &str, dc: bool) -> Option<f64> {
    if dc {
        cell.replace(',', ".").parse::<f64>().ok()
    } else {
        cell.parse::<f64>().ok()
    }
}

/// The header's name list: all `n` cells, or `n + 1` cells with the
/// first being the corner cell. `None` when the count does not fit.
fn header_names(h: &PasteRow, n: usize) -> Option<Vec<String>> {
    let c = &h.cells;
    if c.len() == n {
        Some(c.iter().map(|(_, s)| s.clone()).collect())
    } else if c.len() == n + 1 {
        Some(c[1..].iter().map(|(_, s)| s.clone()).collect())
    } else {
        None
    }
}

/// One structural reading of the paste grid. `score` marks how far a
/// failed reading got (0 = header/name structure, 1 = shape,
/// 2 = a non-numeric value cell, 3 = value checks and validation), so
/// when no reading succeeds the deepest failure is the one reported.
fn try_tabular(
    rows: &[PasteRow],
    header: bool,
    names_col: bool,
    dc: bool,
) -> Result<(DistanceInput, Vec<String>), (NeoError, u8)> {
    let (hrow, data): (Option<&PasteRow>, &[PasteRow]) = if header {
        match rows.split_first() {
            Some((h, d)) if !d.is_empty() => (Some(h), d),
            _ => return Err((parse_err(1, 1, "a header row needs data rows under it"), 0)),
        }
    } else {
        (None, rows)
    };
    let n = data.len();
    if n > MAX_TAXA {
        return Err((
            NeoError::TooManyTaxa {
                max: MAX_TAXA,
                got: n,
            },
            0,
        ));
    }
    let mut notices: Vec<String> = Vec::new();
    let names: Vec<String> = if names_col {
        data.iter().map(|r| r.cells[0].1.clone()).collect()
    } else if let Some(h) = hrow {
        match header_names(h, n) {
            Some(ns) => ns,
            None => {
                return Err((
                    parse_err(
                        h.line,
                        1,
                        format!("header row has {} cells for {n} taxa", h.cells.len()),
                    ),
                    0,
                ))
            }
        }
    } else {
        notices.push("no taxon names found; taxa are named A, B, C, …".to_string());
        (0..n).map(generated_name).collect()
    };
    if names_col {
        if let Some(h) = hrow {
            match header_names(h, n) {
                Some(hn) if hn == names => {}
                Some(hn) => {
                    return Err((
                        structural(format!(
                            "header row names '{}' do not match the first column '{}'",
                            hn.join(", "),
                            names.join(", ")
                        )),
                        1,
                    ))
                }
                None => {
                    return Err((
                        parse_err(
                            h.line,
                            1,
                            format!("header row has {} cells for {n} taxa", h.cells.len()),
                        ),
                        0,
                    ))
                }
            }
        }
    }

    // Shape: square (n cells a row), lower+diagonal (i+1 — a square
    // with a blank upper triangle) or, only with a name column,
    // strict lower (i cells). The first shape whose expectation every
    // row meets wins; ties are impossible above one row (square wants
    // n cells and lower+diagonal wants i+1 — they only agree for the
    // n == 1 row, where both read the same single diagonal cell).
    let counts: Vec<usize> = data
        .iter()
        .map(|r| r.cells.len() - usize::from(names_col))
        .collect();
    let mut shape: Option<u8> = None;
    // Deepest miss (row index) per shape, for the no-shape error.
    let mut miss: Option<(usize, usize)> = None; // (row, expected)
    for rank in 0u8..3 {
        if rank == 2 && !names_col {
            continue;
        }
        let mut bad: Option<usize> = None;
        for (i, &c) in counts.iter().enumerate() {
            let e = match rank {
                0 => n,
                1 => i + 1,
                _ => i,
            };
            if c != e {
                bad = Some(i);
                if miss.is_none_or(|(mi, _)| i >= mi) {
                    miss = Some((i, e));
                }
                break;
            }
        }
        if bad.is_none() {
            shape = Some(rank);
            break;
        }
    }
    let rank = match shape {
        Some(r) => r,
        None => {
            let (i, e) = miss.unwrap_or((0, 0));
            return Err((
                parse_err(
                    data[i].line,
                    1,
                    format!(
                        "row for '{}' has {} value cells, expected {e}",
                        names[i], counts[i]
                    ),
                ),
                1,
            ));
        }
    };

    let mut grid: Vec<Vec<f64>> = Vec::with_capacity(n);
    for (i, r) in data.iter().enumerate() {
        let mut row = Vec::with_capacity(counts[i]);
        for (col, tok) in &r.cells[usize::from(names_col)..] {
            match paste_num(tok, dc) {
                Some(v) => row.push(v),
                None => {
                    return Err((
                        parse_err(r.line, *col, format!("expected a number, got '{tok}'")),
                        2,
                    ))
                }
            }
        }
        grid.push(row);
    }

    let mut lower = Vec::with_capacity(n * n.saturating_sub(1) / 2);
    match rank {
        0 => {
            for i in 0..n {
                for j in 0..n {
                    check_value(grid[i][j], &names[i], &names[j]).map_err(|e| (e, 3u8))?;
                }
                if grid[i][i] != 0.0 {
                    return Err((
                        invalid(
                            &names[i],
                            &names[i],
                            format!("diagonal cell must be 0, got {}", grid[i][i]),
                        ),
                        3,
                    ));
                }
            }
            for i in 0..n {
                for j in 0..i {
                    if grid[i][j] != grid[j][i] {
                        return Err((
                            invalid(
                                &names[i],
                                &names[j],
                                format!(
                                    "matrix is not symmetric: d({},{}) = {} but d({},{}) = {}",
                                    names[i], names[j], grid[i][j], names[j], names[i], grid[j][i]
                                ),
                            ),
                            3,
                        ));
                    }
                    lower.push(grid[i][j]);
                }
            }
        }
        1 => {
            for i in 0..n {
                for j in 0..=i {
                    check_value(grid[i][j], &names[i], &names[j]).map_err(|e| (e, 3u8))?;
                }
                if grid[i][i] != 0.0 {
                    return Err((
                        invalid(
                            &names[i],
                            &names[i],
                            format!("diagonal cell must be 0, got {}", grid[i][i]),
                        ),
                        3,
                    ));
                }
                lower.extend_from_slice(&grid[i][..i]);
            }
        }
        _ => {
            for i in 0..n {
                for j in 0..i {
                    check_value(grid[i][j], &names[i], &names[j]).map_err(|e| (e, 3u8))?;
                    lower.push(grid[i][j]);
                }
            }
        }
    }
    let m = DistanceInput { names, lower };
    validate_input(&m).map_err(|e| (e, 3u8))?;
    Ok((m, notices))
}

/// Parse a pasted matrix (v1.4c spec §5.1): tries PHYLIP first, then
/// the tabular grammar documented at the top of this module.
pub fn parse_pasted_matrix(text: &str, opts: PasteOptions) -> Result<MatrixFile, NeoError> {
    // A pasted PHYLIP file parses directly and asks nothing.
    if let Ok(f) = parse_phylip_matrix(
        text,
        PhylipMatrixOptions {
            names: NameMode::Auto,
            use_lower_if_asymmetric: false,
        },
    ) {
        return Ok(f);
    }
    let text = text.strip_prefix('\u{feff}').unwrap_or(text);
    let text = text.replace('\u{2212}', "-");
    let raw: Vec<(u32, Vec<(u32, &str)>)> = text
        .lines()
        .enumerate()
        .map(|(i, l)| ((i + 1) as u32, tokenize(l)))
        .filter(|(_, t)| !t.is_empty())
        .collect();
    if raw.is_empty() {
        return Err(parse_err(1, 1, "empty input"));
    }
    let dc = match opts.decimal_comma {
        Some(d) => d,
        None => {
            if raw
                .iter()
                .any(|(_, toks)| toks.iter().any(|(_, t)| comma_ambiguous(t)))
            {
                return Err(NeoError::MatrixAmbiguous {
                    question: PasteQuestion::DecimalComma,
                });
            }
            false
        }
    };
    // Cell splitting: under decimal_comma a comma stays inside its
    // cell; otherwise commas separate, and trailing empty cells from
    // spreadsheet trailing commas are dropped.
    let mut rows: Vec<PasteRow> = Vec::with_capacity(raw.len());
    for (line, toks) in raw {
        let mut cells: Vec<(u32, String)> = Vec::new();
        for (col, t) in toks {
            if dc {
                cells.push((col, t.to_string()));
            } else {
                for (k, piece) in t.split(',').enumerate() {
                    cells.push((col + k as u32, piece.to_string()));
                }
            }
        }
        while cells.last().is_some_and(|(_, s)| s.is_empty()) {
            cells.pop();
        }
        if !cells.is_empty() {
            rows.push(PasteRow { line, cells });
        }
    }
    if rows.is_empty() {
        return Err(parse_err(1, 1, "empty input"));
    }

    let headers: &[bool] = match opts.header_row {
        Some(h) => {
            if h {
                &[true]
            } else {
                &[false]
            }
        }
        None => &[false, true],
    };
    let name_cols: &[bool] = match opts.first_column_names {
        Some(c) => {
            if c {
                &[true]
            } else {
                &[false]
            }
        }
        None => &[false, true],
    };
    let mut valid: Vec<(bool, bool, DistanceInput, Vec<String>)> = Vec::new();
    let mut best_err: Option<(NeoError, u8)> = None;
    for &h in headers {
        for &nc in name_cols {
            match try_tabular(&rows, h, nc, dc) {
                Ok((m, notices)) => valid.push((h, nc, m, notices)),
                Err((e, score)) => {
                    if best_err.as_ref().is_none_or(|(_, s)| score > *s) {
                        best_err = Some((e, score));
                    }
                }
            }
        }
    }
    match valid.len() {
        0 => Err(best_err
            .map(|(e, _)| e)
            .unwrap_or_else(|| parse_err(1, 1, "could not read a distance matrix"))),
        1 => match valid.into_iter().next() {
            Some((_, _, m, notices)) => Ok(MatrixFile {
                matrix: m,
                title: None,
                notices,
            }),
            None => Err(parse_err(1, 1, "could not read a distance matrix")),
        },
        _ => {
            let h_varies = valid.iter().any(|v| v.0) && valid.iter().any(|v| !v.0);
            Err(NeoError::MatrixAmbiguous {
                question: if h_varies {
                    PasteQuestion::HeaderRow
                } else {
                    PasteQuestion::FirstColumnNames
                },
            })
        }
    }
}
