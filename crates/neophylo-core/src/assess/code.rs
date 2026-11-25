//! Completion codes (v1.5 spec §5.4, plan Task 5): the short text a
//! student pastes into the LMS, carrying their normalised id, the
//! variant's retry index and every task's answers and attempt count.
//! [`crate::assess::grade::grade`] turns a code back into a score.
//!
//! ## Text form
//!
//! `NP1-` + Crockford base32 symbols grouped by 5 with `-`
//! (`NP1-XXXXX-XXXXX-…`). The alphabet drops `I`, `L`, `O` and `U`;
//! decoding is case-insensitive, reads `i`/`l` as `1` and `o` as `0`,
//! and ignores `-`, space, tab and line breaks.
//!
//! ## Bit layout (format 1)
//!
//! Fields are written most-significant bit first; the payload is
//! zero-padded to a whole byte and a CRC-16/CCITT-FALSE over those
//! payload bytes is appended (16 bits = 4 base32 symbols). The code's
//! total bit count is then zero-padded to a whole symbol.
//!
//! | field | bits | notes |
//! |---|---|---|
//! | format | 4 | [`FORMAT_VERSION`] |
//! | generator | 8 | [`GENERATOR_VERSION`] |
//! | fingerprint | 20 | low 20 bits, [`fingerprint`] |
//! | id_len | 7 | id byte length (≤ [`MAX_ID_BYTES`] on encode) |
//! | id | 8·id_len | normalised student id, UTF-8 |
//! | retry | 6 | variant retry index, 0..=[`MAX_RETRIES`] |
//! | task_count | 4 | 1..=[`MAX_TASKS`] |
//! | per task | 9+2w | tag 4 · first w · has_last 1 · last w (iff set) · attempts 4 |
//! | finished_min | 24 | minutes since 2026-01-01 UTC |
//! | crc | 16 | CRC-16/CCITT-FALSE of the payload bytes |
//!
//! `last` reuses the task's kind tag — both answers to one task are
//! the same kind — and a `Skipped` first never carries a `last`.
//! Answer payload widths `w`:
//!
//! | tag | [`PackedAnswer`] | bits |
//! |---|---|---|
//! | 0 | `Skipped` (no answer given) | 0 |
//! | 1 | `Pair(a, b)` two tip indices, canonical a<b | 16+16 |
//! | 2 | `Tips` sorted index list → bitmask | 64 |
//! | 3 | `Letter` point-letter byte − 'A' | 8 |
//! | 4 | `Order` Lehmer permutation code | 64 |
//! | 5 | `Choice` option index | 8 |
//! | 6 | `Choices` sorted index list → bitmask | 64 |
//! | 7 | `Number` reading count answer | 32 |
//! | 8 | `Pairwise` B=0 / C=1 / Equal=2 | 2 |
//! | 9 | `TwoTier` inner tag+payload, then reason index | 4+inner+8 |
//! | 10 | `Numeric` signed scaled integer | 32 |
//!
//! Answers pack in index form (owner 2026-11-25): the code cannot
//! carry taxon names (the 250-char budget) and `decode_code` has no
//! assignment to resolve them against, so every name is an index into
//! the variant's [`name_table`]. An order answer is a permutation rank
//! — the Lehmer code over the item's node list.
//!
//! [`MAX_RETRIES`]: crate::assess::variant::MAX_RETRIES

use std::collections::BTreeSet;

use crate::assess::assignment::{Assignment, Content, Variant};
use crate::assess::hash::fnv1a64;
use crate::assess::task::{TaskAnswer, TaskRef};
use crate::assess::variant::{exercise_distance_matrix, MAX_RETRIES};
use crate::error::NeoError;
use crate::newick::parse_newick;
use crate::reading::query::Closer;
use crate::reading::{Item, Question, ReadingSet, RelForm, Response, TraitAsk};

/// The wire format of this encoder (the `NP1-` prefix's `1`).
pub const FORMAT_VERSION: u8 = 1;
/// The generator that wrote the layout; bumped when the layout changes
/// so old decoders refuse with `"version"` instead of misparsing.
pub const GENERATOR_VERSION: u8 = 1;
/// Maximum normalised student id the code carries, in UTF-8 bytes
/// (spec §5.4). `encode_code` refuses longer with
/// `InvalidCode { reason: "length" }`; Task 8 refuses them at entry,
/// so a code this cap rejects can never have been issued.
pub const MAX_ID_BYTES: usize = 64;
/// Codes carry at most 15 tasks (the 250-char budget, spec §5.4).
pub const MAX_TASKS: usize = 15;
/// `attempts` is stored in 4 bits; the encoder clamps at 15.
const ATTEMPTS_CAP: u8 = 15;
/// `finished_min` is 24 bits: minutes since 2026-01-01 UTC, good
/// through mid-2057.
pub const MAX_FINISHED_MIN: u32 = (1 << 24) - 1;
/// A numeric task's scaled answer must fit the code's signed 32-bit
/// field: `|n| ≤ 2^31 − 1`. `encode_code` and `pack_answer` refuse
/// wider with `InvalidCode { reason: "malformed" }`.
const MAX_NUMERIC: i64 = i32::MAX as i64;

const B32: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";

fn bad_code(reason: &str) -> NeoError {
    NeoError::InvalidCode {
        reason: reason.to_string(),
    }
}

fn bad_answer(msg: impl Into<String>) -> NeoError {
    NeoError::InvalidAssignment {
        field: "answer".to_string(),
        msg: msg.into(),
    }
}

// --- the packed answer ---------------------------------------------------------

/// The code's self-describing answer form (owner 2026-11-25): no
/// taxon names, no letters as strings — every reference is an index
/// into the variant's [`name_table`] or the item's own option/node
/// list. `Tips`/`Choices` carry a sorted index list (encoded as a
/// 64-bit bitmask; the table is capped at 64 entries). `Order` is the
/// permutation's Lehmer code (≤ 20 nodes). `Skipped` scores wrong and
/// is never an error.
#[derive(Debug, Clone, PartialEq)]
pub enum PackedAnswer {
    /// The student never answered this task.
    Skipped,
    /// `predict_pair`: two tip indices, canonical `a < b`.
    Pair(u16, u16),
    /// `predict_branch` or a reading tip-set: sorted [`name_table`]
    /// indices.
    Tips(Vec<u8>),
    /// A point letter's index — `A` is 0.
    Letter(u8),
    /// An `order_nodes` answer: the permutation's Lehmer code.
    Order(u64),
    /// A single-option reading pick.
    Choice(u8),
    /// A multi-option reading pick: sorted option indices.
    Choices(Vec<u8>),
    /// A reading count answer (`count_clades`, `how_many_changes`).
    Number(u32),
    /// `closest_relative` in pairwise form: 0 = B, 1 = C, 2 = Equal.
    Pairwise(u8),
    /// `two_tier`: the packed first-tier answer plus the reason index.
    TwoTier {
        first: Box<PackedAnswer>,
        reason: u8,
    },
    /// A numeric task's answer, scaled and signed.
    Numeric(i32),
}

/// The kinds a [`PackedAnswer`] tag can name — used to decide whether
/// an unpacked response kind can fit a question's widget.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum PackedKind {
    Tips,
    Letter,
    Order,
    Choice,
    Choices,
    Number,
    Pairwise,
    TwoTier,
}

fn tag_of(a: &PackedAnswer) -> u8 {
    match a {
        PackedAnswer::Skipped => 0,
        PackedAnswer::Pair(..) => 1,
        PackedAnswer::Tips(..) => 2,
        PackedAnswer::Letter(..) => 3,
        PackedAnswer::Order(..) => 4,
        PackedAnswer::Choice(..) => 5,
        PackedAnswer::Choices(..) => 6,
        PackedAnswer::Number(..) => 7,
        PackedAnswer::Pairwise(..) => 8,
        PackedAnswer::TwoTier { .. } => 9,
        PackedAnswer::Numeric(..) => 10,
    }
}

/// One task's recorded answers: the first submission, the last when
/// it differs, and how many times the task was submitted.
#[derive(Debug, Clone, PartialEq)]
pub struct Attempt {
    pub first: PackedAnswer,
    /// Only present when it differs from `first`; `encode_code`
    /// normalises `Some(first)` away.
    pub last: Option<PackedAnswer>,
    /// Submission count, clamped to 15 by the encoder.
    pub attempts: u8,
}

/// A decoded completion code (spec §5.4).
#[derive(Debug, Clone, PartialEq)]
pub struct CodePayload {
    pub format: u8,
    pub generator: u8,
    /// The assignment fingerprint (20 bits) — [`fingerprint`].
    pub fingerprint: u32,
    /// The student's normalised id as encoded.
    pub student_id: String,
    /// The variant retry index the code was issued on.
    pub retry: u8,
    pub attempts: Vec<Attempt>,
    /// Minutes since 2026-01-01 UTC.
    pub finished_min: u32,
}

// --- bit io --------------------------------------------------------------------

fn push(bits: &mut Vec<bool>, v: u64, n: usize) {
    for i in (0..n).rev() {
        bits.push((v >> i) & 1 == 1);
    }
}

fn bytes_of(bits: &[bool]) -> Vec<u8> {
    let mut out = vec![0u8; bits.len().div_ceil(8)];
    for (i, &b) in bits.iter().enumerate() {
        if b {
            out[i / 8] |= 0x80 >> (i % 8);
        }
    }
    out
}

struct BitReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl BitReader<'_> {
    fn read(&mut self, n: usize) -> Option<u64> {
        if n > 64 || self.pos + n > self.data.len() * 8 {
            return None;
        }
        let mut v = 0u64;
        for _ in 0..n {
            v = (v << 1) | u64::from((self.data[self.pos / 8] >> (7 - self.pos % 8)) & 1);
            self.pos += 1;
        }
        Some(v)
    }

    fn remaining(&self) -> usize {
        self.data.len() * 8 - self.pos
    }
}

/// CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF, no reflection,
/// xorout 0). Known answer: `b"123456789"` → `0x29B1`.
pub fn crc16(data: &[u8]) -> u16 {
    let mut crc: u16 = 0xFFFF;
    for &b in data {
        crc ^= u16::from(b) << 8;
        for _ in 0..8 {
            crc = if crc & 0x8000 != 0 {
                (crc << 1) ^ 0x1021
            } else {
                crc << 1
            };
        }
    }
    crc
}

fn b32_val(c: u8) -> Option<u8> {
    match c.to_ascii_uppercase() {
        b'0' | b'O' => Some(0),
        b'1' | b'I' | b'L' => Some(1),
        c @ b'2'..=b'9' => Some(c - b'0'),
        c => B32[10..]
            .iter()
            .position(|&x| x == c)
            .map(|i| (i + 10) as u8),
    }
}

// --- encode ----------------------------------------------------------------------

/// Serialise `p` to its `NP1-…` text. Refuses non-format-1 payloads
/// (`"version"`), an over-long id (`"length"`) and values that do not
/// fit their fields (`"malformed"`); `attempts` counts clamp to 15
/// and `last == first` normalises to absent.
pub fn encode_code(p: &CodePayload) -> Result<String, NeoError> {
    if p.format != FORMAT_VERSION || p.generator != GENERATOR_VERSION {
        return Err(bad_code("version"));
    }
    if p.fingerprint > 0x000F_FFFF {
        return Err(bad_code("malformed"));
    }
    let id = p.student_id.as_bytes();
    if id.len() > MAX_ID_BYTES {
        return Err(bad_code("length"));
    }
    if p.retry > MAX_RETRIES
        || p.attempts.is_empty()
        || p.attempts.len() > MAX_TASKS
        || p.finished_min > MAX_FINISHED_MIN
    {
        return Err(bad_code("malformed"));
    }
    let mut bits = Vec::new();
    push(&mut bits, u64::from(FORMAT_VERSION), 4);
    push(&mut bits, u64::from(GENERATOR_VERSION), 8);
    push(&mut bits, u64::from(p.fingerprint), 20);
    push(&mut bits, id.len() as u64, 7);
    for &b in id {
        push(&mut bits, u64::from(b), 8);
    }
    push(&mut bits, u64::from(p.retry), 6);
    push(&mut bits, p.attempts.len() as u64, 4);
    for a in &p.attempts {
        let last = a.last.as_ref().filter(|l| *l != &a.first);
        if let Some(l) = last {
            if tag_of(l) != tag_of(&a.first) {
                return Err(bad_code("malformed"));
            }
        }
        push(&mut bits, u64::from(tag_of(&a.first)), 4);
        write_answer(&mut bits, &a.first)?;
        push(&mut bits, u64::from(last.is_some()), 1);
        if let Some(l) = last {
            write_answer(&mut bits, l)?;
        }
        push(&mut bits, u64::from(a.attempts.min(ATTEMPTS_CAP)), 4);
    }
    push(&mut bits, u64::from(p.finished_min), 24);
    // The payload pads to a whole byte before the CRC starts.
    while bits.len() % 8 != 0 {
        bits.push(false);
    }
    let payload = bytes_of(&bits);
    push(&mut bits, u64::from(crc16(&payload)), 16);
    // Pad to a whole symbol; the decoder recovers the pad width.
    while bits.len() % 5 != 0 {
        bits.push(false);
    }
    let mut text = String::from("NP1-");
    for (i, chunk) in bits.chunks(5).enumerate() {
        if i > 0 && i % 5 == 0 {
            text.push('-');
        }
        let v = chunk.iter().fold(0u8, |v, &b| (v << 1) | u8::from(b));
        text.push(B32[v as usize] as char);
    }
    Ok(text)
}

/// An answer's body bits — the kind tag is written once per task by
/// the caller (`TwoTier`'s inner answer keeps its own tag).
fn write_answer(bits: &mut Vec<bool>, a: &PackedAnswer) -> Result<(), NeoError> {
    let mask = |ix: &[u8]| -> Result<u64, NeoError> {
        let mut m = 0u64;
        for &i in ix {
            if i > 63 {
                return Err(bad_code("malformed"));
            }
            m |= 1u64 << i;
        }
        Ok(m)
    };
    match a {
        PackedAnswer::Skipped => {}
        PackedAnswer::Pair(x, y) => {
            push(bits, u64::from(*x), 16);
            push(bits, u64::from(*y), 16);
        }
        PackedAnswer::Tips(ix) => push(bits, mask(ix)?, 64),
        PackedAnswer::Letter(i) => {
            if *i > 62 {
                return Err(bad_code("malformed"));
            }
            push(bits, u64::from(*i), 8);
        }
        PackedAnswer::Order(v) => push(bits, *v, 64),
        PackedAnswer::Choice(i) => push(bits, u64::from(*i), 8),
        PackedAnswer::Choices(ix) => push(bits, mask(ix)?, 64),
        PackedAnswer::Number(v) => push(bits, u64::from(*v), 32),
        PackedAnswer::Pairwise(v) => {
            if *v > 2 {
                return Err(bad_code("malformed"));
            }
            push(bits, u64::from(*v), 2);
        }
        PackedAnswer::TwoTier { first, reason } => {
            push(bits, u64::from(tag_of(first)), 4);
            write_answer(bits, first)?;
            push(bits, u64::from(*reason), 8);
        }
        PackedAnswer::Numeric(v) => {
            if *v == i32::MIN {
                return Err(bad_code("malformed"));
            }
            push(bits, u64::from(*v as u32), 32);
        }
    }
    Ok(())
}

// --- decode ----------------------------------------------------------------------

/// Parse a completion code. Never panics; every failure is
/// `InvalidCode` with the spec's reason: `"prefix"` (no `NP1-`),
/// `"length"` (symbol count, padding or truncated fields),
/// `"malformed"` (a bad symbol or field value), `"checksum"` (CRC
/// mismatch), `"version"` (unknown format or generator).
pub fn decode_code(text: &str) -> Result<CodePayload, NeoError> {
    let bytes = text.as_bytes();
    let start = (0..bytes.len().saturating_sub(2))
        .find(|&i| {
            bytes[i].eq_ignore_ascii_case(&b'n')
                && bytes[i + 1].eq_ignore_ascii_case(&b'p')
                && bytes[i + 2] == b'1'
            // The prefix ends at a separator or a symbol — `np1` inside
            // a longer word does not start a code.
            && (i + 3 == bytes.len() || bytes[i + 3] == b'-' || bytes[i + 3] == b' '
                || bytes[i + 3] == b'\t' || bytes[i + 3] == b'\r' || bytes[i + 3] == b'\n'
                || b32_val(bytes[i + 3]).is_some())
        })
        .ok_or_else(|| bad_code("prefix"))?;
    let mut vals: Vec<u8> = Vec::new();
    for &b in &bytes[start + 3..] {
        match b {
            b'-' | b' ' | b'\t' | b'\r' | b'\n' => {}
            _ => match b32_val(b) {
                Some(v) => vals.push(v),
                None => return Err(bad_code("malformed")),
            },
        }
    }
    let s = vals.len();
    let rem = (5 * s) % 8;
    if rem > 4 {
        return Err(bad_code("length"));
    }
    let pad = rem;
    if pad > 0 && (s == 0 || vals[s - 1] & ((1 << pad) - 1) != 0) {
        return Err(bad_code("length"));
    }
    let total_bits = 5 * s - pad;
    let nbytes = total_bits / 8;
    if nbytes < 3 {
        return Err(bad_code("length"));
    }
    let mut data = vec![0u8; nbytes];
    for i in 0..total_bits {
        if (vals[i / 5] >> (4 - i % 5)) & 1 == 1 {
            data[i / 8] |= 0x80 >> (i % 8);
        }
    }
    let (payload, crc_b) = data.split_at(nbytes - 2);
    let want = u16::from_be_bytes([crc_b[0], crc_b[1]]);
    if crc16(payload) != want {
        return Err(bad_code("checksum"));
    }
    let mut r = BitReader {
        data: payload,
        pos: 0,
    };
    let get = |r: &mut BitReader, n: usize| r.read(n).ok_or_else(|| bad_code("length"));
    let format = get(&mut r, 4)? as u8;
    if format != FORMAT_VERSION {
        return Err(bad_code("version"));
    }
    let generator = get(&mut r, 8)? as u8;
    if generator != GENERATOR_VERSION {
        return Err(bad_code("version"));
    }
    let fingerprint = get(&mut r, 20)? as u32;
    let id_len = get(&mut r, 7)? as usize;
    let mut id = Vec::with_capacity(id_len.min(4096));
    for _ in 0..id_len {
        id.push(get(&mut r, 8)? as u8);
    }
    let student_id = String::from_utf8(id).map_err(|_| bad_code("malformed"))?;
    let retry = get(&mut r, 6)? as u8;
    if retry > MAX_RETRIES {
        return Err(bad_code("malformed"));
    }
    let n_tasks = get(&mut r, 4)? as usize;
    if n_tasks == 0 {
        return Err(bad_code("malformed"));
    }
    let mut attempts = Vec::with_capacity(n_tasks);
    for _ in 0..n_tasks {
        let tag = get(&mut r, 4)? as u8;
        let first = read_answer(&mut r, tag)?;
        let has_last = get(&mut r, 1)? == 1;
        if first == PackedAnswer::Skipped && has_last {
            return Err(bad_code("malformed"));
        }
        let last = if has_last {
            Some(read_answer(&mut r, tag)?)
        } else {
            None
        };
        let count = get(&mut r, 4)? as u8;
        attempts.push(Attempt {
            first,
            last,
            attempts: count,
        });
    }
    let finished_min = get(&mut r, 24)? as u32;
    if r.remaining() >= 8 {
        return Err(bad_code("length"));
    }
    while r.remaining() > 0 {
        if r.read(1) != Some(0) {
            return Err(bad_code("length"));
        }
    }
    Ok(CodePayload {
        format,
        generator,
        fingerprint,
        student_id,
        retry,
        attempts,
        finished_min,
    })
}

/// An answer body of kind `tag` — the tag is read once per task by
/// the caller (`TwoTier`'s inner answer reads its own tag).
fn read_answer(r: &mut BitReader, tag: u8) -> Result<PackedAnswer, NeoError> {
    let get = |r: &mut BitReader, n: usize| r.read(n).ok_or_else(|| bad_code("length"));
    let list = |m: u64| -> Vec<u8> {
        (0..64)
            .filter(|&i| m >> i & 1 == 1)
            .map(|i| i as u8)
            .collect()
    };
    Ok(match tag {
        0 => PackedAnswer::Skipped,
        1 => PackedAnswer::Pair(get(r, 16)? as u16, get(r, 16)? as u16),
        2 => PackedAnswer::Tips(list(get(r, 64)?)),
        3 => {
            let i = get(r, 8)? as u8;
            if i > 62 {
                return Err(bad_code("malformed"));
            }
            PackedAnswer::Letter(i)
        }
        4 => PackedAnswer::Order(get(r, 64)?),
        5 => PackedAnswer::Choice(get(r, 8)? as u8),
        6 => PackedAnswer::Choices(list(get(r, 64)?)),
        7 => PackedAnswer::Number(get(r, 32)? as u32),
        8 => match get(r, 2)? {
            v @ 0..=2 => PackedAnswer::Pairwise(v as u8),
            _ => return Err(bad_code("malformed")),
        },
        9 => {
            let inner = get(r, 4)? as u8;
            PackedAnswer::TwoTier {
                first: Box::new(read_answer(r, inner)?),
                reason: get(r, 8)? as u8,
            }
        }
        10 => {
            let v = get(r, 32)? as u32 as i32;
            if v == i32::MIN {
                return Err(bad_code("malformed"));
            }
            PackedAnswer::Numeric(v)
        }
        _ => return Err(bad_code("malformed")),
    })
}

// --- the name table ---------------------------------------------------------------

/// The variant's tip labels in the order a code packs them (spec
/// §5.4): an exercise uses the distance-matrix label order — the same
/// order `predict_pair` tip indices count in — and a reading set uses
/// the sorted unique labels over all its trees.
pub fn name_table(variant: &Variant) -> Result<Vec<String>, NeoError> {
    match &variant.content {
        Content::Exercise(ex) => Ok(exercise_distance_matrix(ex)?.labels),
        Content::Reading(set) => {
            let mut all = BTreeSet::new();
            for rt in set.trees.values() {
                let tree = parse_newick(&rt.newick).map_err(|e| NeoError::InvalidAssignment {
                    field: "trees".to_string(),
                    msg: format!("a reading tree does not parse: {e}"),
                })?;
                all.extend(tree.leaf_labels());
            }
            Ok(all.into_iter().collect())
        }
    }
}

fn mask(table: &[String], names: &[String]) -> Result<Vec<u8>, NeoError> {
    let mut out = Vec::with_capacity(names.len());
    for n in names {
        let i = table
            .iter()
            .position(|t| t == n)
            .ok_or_else(|| bad_answer(format!("'{n}' is not in the variant's name table")))?;
        let i = u8::try_from(i)
            .ok()
            .filter(|&i| i <= 63)
            .ok_or_else(|| bad_answer("the name table does not fit a 64-bit mask"))?;
        out.push(i);
    }
    out.sort_unstable();
    out.dedup();
    Ok(out)
}

fn names_of(table: &[String], ix: &[u8]) -> Result<Vec<String>, NeoError> {
    let mut out = Vec::with_capacity(ix.len());
    for &i in ix {
        let n = table
            .get(i as usize)
            .ok_or_else(|| bad_answer("a packed index is past the name table"))?;
        out.push(n.clone());
    }
    out.sort();
    out.dedup();
    Ok(out)
}

// --- pack / unpack -----------------------------------------------------------------

/// Convert the app's answer form to the code's index form (spec
/// §5.4): a `TaskAnswer` against `variant`'s name table and the
/// item's own option/node lists. Errors are `InvalidAssignment`
/// (`field: "answer"`) for an answer that cannot be represented —
/// a wrong kind, an unknown name, an out-of-range numeric.
pub fn pack_answer(
    variant: &Variant,
    task: &TaskRef,
    answer: &TaskAnswer,
) -> Result<PackedAnswer, NeoError> {
    match (task, answer) {
        (TaskRef::PredictPair { .. }, TaskAnswer::Pair(a, b)) => {
            Ok(PackedAnswer::Pair((*a).min(*b), (*a).max(*b)))
        }
        (TaskRef::PredictBranch, TaskAnswer::Branch(clade)) => {
            Ok(PackedAnswer::Tips(mask(&name_table(variant)?, clade)?))
        }
        (TaskRef::Numeric { .. }, TaskAnswer::Number(v)) => {
            if v.unsigned_abs() > MAX_NUMERIC as u64 {
                return Err(bad_answer("a scaled answer does not fit the code's range"));
            }
            Ok(PackedAnswer::Numeric(*v as i32))
        }
        (TaskRef::Reading { item }, TaskAnswer::Reading(r)) => {
            let Content::Reading(set) = &variant.content else {
                return Err(bad_answer("a reading answer needs reading content"));
            };
            let it = set
                .items
                .get(*item)
                .ok_or_else(|| bad_answer(format!("no reading item at index {item}")))?;
            pack_response(&it.question, r, &name_table(variant)?)
        }
        _ => Err(bad_answer("the answer kind does not fit the task")),
    }
}

/// The inverse of [`pack_answer`]: the code's index form back to the
/// app's answer form. Errors when the payload cannot name a
/// well-formed answer for `task` — a `Skipped`, a tag with no
/// question context (an `Order` outside `order_nodes`), or a name /
/// letter / option index the item does not admit. `grade` treats the
/// error as a wrong answer.
pub fn unpack_answer(
    variant: &Variant,
    task: &TaskRef,
    packed: &PackedAnswer,
) -> Result<TaskAnswer, NeoError> {
    match packed {
        PackedAnswer::Skipped => Err(bad_answer("a skipped task has no answer")),
        PackedAnswer::Pair(a, b) => Ok(TaskAnswer::Pair(*a, *b)),
        PackedAnswer::Numeric(v) => Ok(TaskAnswer::Number(i64::from(*v))),
        PackedAnswer::Tips(ix) => {
            let names = names_of(&name_table(variant)?, ix)?;
            match item_of(variant, task)? {
                Some((set, item)) => {
                    let t0 = first_tree(set, item)?;
                    for n in &names {
                        if !t0.tips.contains(n) {
                            return Err(bad_answer(format!(
                                "'{n}' is not a tip of the item's tree"
                            )));
                        }
                    }
                    if matches!(
                        item.question,
                        Question::Mrca { options: None } | Question::SmallestClade
                    ) {
                        Ok(TaskAnswer::Reading(Response::Node { clade: names }))
                    } else {
                        Ok(TaskAnswer::Reading(Response::Tips { tips: names }))
                    }
                }
                None => match task {
                    TaskRef::Reading { .. } => {
                        Ok(TaskAnswer::Reading(Response::Tips { tips: names }))
                    }
                    _ => Ok(TaskAnswer::Branch(names)),
                },
            }
        }
        _ => {
            let ctx = item_of(variant, task)?;
            let (q, t0) = match ctx {
                Some((set, item)) => (Some(&item.question), Some(first_tree(set, item)?)),
                None => (None, None),
            };
            Ok(TaskAnswer::Reading(unpack_response(
                q,
                t0.as_ref(),
                packed,
                &name_table(variant)?,
            )?))
        }
    }
}

/// The item a `Reading` task names, with its set — `None` for
/// exercise-side tasks or exercise content. An out-of-range index on
/// a real reading task is `InvalidAssignment` (a task defect).
pub(crate) fn item_of<'v>(
    variant: &'v Variant,
    task: &TaskRef,
) -> Result<Option<(&'v ReadingSet, &'v Item)>, NeoError> {
    let TaskRef::Reading { item } = task else {
        return Ok(None);
    };
    let Content::Reading(set) = &variant.content else {
        return Ok(None);
    };
    let it = set
        .items
        .get(*item)
        .ok_or_else(|| NeoError::InvalidAssignment {
            field: "task".to_string(),
            msg: format!("no reading item at index {item}"),
        })?;
    Ok(Some((set, it)))
}

/// The memberships of an item's first tree — the tree `check`
/// answers against — that unpacking validates: its tip labels and
/// point letters.
struct ItemTree {
    tips: BTreeSet<String>,
    points: BTreeSet<String>,
}

fn first_tree(set: &ReadingSet, item: &Item) -> Result<ItemTree, NeoError> {
    let task_err = |msg: String| NeoError::InvalidAssignment {
        field: "task".to_string(),
        msg,
    };
    let name = item
        .trees
        .first()
        .ok_or_else(|| task_err(format!("item '{}' names no tree", item.id)))?;
    let rt = set
        .trees
        .get(name)
        .ok_or_else(|| task_err(format!("item '{}' names unknown tree '{name}'", item.id)))?;
    let tree = parse_newick(&rt.newick).map_err(|e| {
        task_err(format!(
            "item '{}' tree '{name}' does not parse: {e}",
            item.id
        ))
    })?;
    Ok(ItemTree {
        tips: tree.leaf_labels().into_iter().collect(),
        points: rt.points.iter().map(|p| p.letter.clone()).collect(),
    })
}

/// The packed kinds a question's widget can produce — mirrors the
/// web mapping (`web/src/reading/QuestionControls.tsx`).
fn response_kinds(q: &Question) -> &'static [PackedKind] {
    use PackedKind::*;
    match q {
        Question::WhichDiffers { .. } | Question::WhichFits { .. } | Question::IsClade { .. } => {
            &[Choice]
        }
        Question::Mrca { options: Some(_) } | Question::PlaceTaxon { .. } => &[Letter],
        Question::Mrca { options: None } | Question::SmallestClade => &[Tips],
        Question::ClosestRelative {
            form: RelForm::Pairwise,
        } => &[Pairwise],
        Question::ClosestRelative { .. } => &[Tips],
        Question::CountClades => &[Number],
        Question::OrderNodes { .. } => &[Order],
        Question::SelectTrue { .. } | Question::Concept { .. } => &[Choices],
        Question::Trait { ask } => match ask {
            TraitAsk::WhichHave { .. } | TraitAsk::HasNot { .. } => &[Tips],
            TraitAsk::WhichShared { .. }
            | TraitAsk::AncestralOrDerived { .. }
            | TraitAsk::Homologous { .. } => &[Choice],
            TraitAsk::HowManyChanges { .. } => &[Number],
            TraitAsk::Profile { .. } => &[Choices],
        },
        Question::TwoTier { .. } => &[TwoTier],
    }
}

fn kind_of_response(r: &Response) -> PackedKind {
    match r {
        Response::Choice { .. } => PackedKind::Choice,
        Response::Choices { .. } => PackedKind::Choices,
        Response::Node { .. } | Response::Tips { .. } => PackedKind::Tips,
        Response::Point { .. } => PackedKind::Letter,
        Response::Order { .. } => PackedKind::Order,
        Response::Number { .. } => PackedKind::Number,
        Response::Pairwise { .. } => PackedKind::Pairwise,
        Response::TwoTier { .. } => PackedKind::TwoTier,
    }
}

/// Whether `r`'s kind is one `q`'s widget can produce — the fit check
/// `grade` runs before scoring (a mismatched kind is a wrong answer,
/// never an engine error).
pub(crate) fn response_fits(q: &Question, r: &Response) -> bool {
    match r {
        Response::TwoTier { first, .. } => match q {
            Question::TwoTier { first: fq, .. } => response_fits(fq, first),
            _ => false,
        },
        _ => response_kinds(q).contains(&kind_of_response(r)),
    }
}

/// Whether `ta`'s kind fits `task` — exercise tasks want their own
/// kinds; a reading task wants a response kind the item's widget can
/// produce. `item` is the task's reading item, when the task applies.
pub(crate) fn answer_fits(task: &TaskRef, ta: &TaskAnswer, item: Option<&Item>) -> bool {
    match (task, ta) {
        (TaskRef::PredictPair { .. }, TaskAnswer::Pair(..)) => true,
        (TaskRef::PredictBranch, TaskAnswer::Branch(..)) => true,
        (TaskRef::Numeric { .. }, TaskAnswer::Number(..)) => true,
        (TaskRef::Reading { .. }, TaskAnswer::Reading(r)) => {
            item.is_none_or(|it| response_fits(&it.question, r))
        }
        _ => false,
    }
}

/// A single-char letter `>= 'A'` → index (`'A'` is 0). Letters are
/// ASCII `A`–`DEL`, so indices stay ≤ 62.
fn letter_idx(letter: &str) -> Option<u8> {
    let b = letter.as_bytes();
    if b.len() != 1 || b[0] < 0x41 {
        return None;
    }
    Some(b[0] - 0x41).filter(|&i| i <= 62)
}

fn pack_response(q: &Question, r: &Response, table: &[String]) -> Result<PackedAnswer, NeoError> {
    let want = response_kinds(q);
    let bad = || bad_answer("the response kind does not fit the question");
    match r {
        Response::Choice { index } if want.contains(&PackedKind::Choice) => {
            Ok(PackedAnswer::Choice(
                u8::try_from(*index).map_err(|_| bad_answer("option index out of range"))?,
            ))
        }
        Response::Choices { indices } if want.contains(&PackedKind::Choices) => {
            let mut ix = Vec::with_capacity(indices.len());
            for &i in indices {
                ix.push(
                    u8::try_from(i)
                        .ok()
                        .filter(|&i| i <= 63)
                        .ok_or_else(|| bad_answer("option index out of range"))?,
                );
            }
            ix.sort_unstable();
            ix.dedup();
            Ok(PackedAnswer::Choices(ix))
        }
        Response::Node { clade } if want.contains(&PackedKind::Tips) => {
            Ok(PackedAnswer::Tips(mask(table, clade)?))
        }
        Response::Tips { tips } if want.contains(&PackedKind::Tips) => {
            Ok(PackedAnswer::Tips(mask(table, tips)?))
        }
        Response::Point { letter } if want.contains(&PackedKind::Letter) => Ok(
            PackedAnswer::Letter(letter_idx(letter).ok_or_else(|| bad_answer("bad point letter"))?),
        ),
        Response::Order { letters } => {
            let Question::OrderNodes { nodes } = q else {
                return Err(bad());
            };
            Ok(PackedAnswer::Order(lehmer_rank(nodes, letters)?))
        }
        Response::Number { value } if want.contains(&PackedKind::Number) => {
            Ok(PackedAnswer::Number(*value))
        }
        Response::Pairwise { answer } if want.contains(&PackedKind::Pairwise) => {
            Ok(PackedAnswer::Pairwise(match answer {
                Closer::B => 0,
                Closer::C => 1,
                Closer::Equal => 2,
            }))
        }
        Response::TwoTier { first, reason } => {
            let Question::TwoTier { first: fq, .. } = q else {
                return Err(bad());
            };
            let reason =
                u8::try_from(*reason).map_err(|_| bad_answer("reason index out of range"))?;
            Ok(PackedAnswer::TwoTier {
                first: Box::new(pack_response(fq, first, table)?),
                reason,
            })
        }
        _ => Err(bad()),
    }
}

/// Unpack a reading-kind payload to the app's `Response`, with `q`
/// (the item's question) and `t0` (its first tree, resolved) when the
/// task names a readable item. Validates the memberships `check`
/// errors on — unknown tips, unknown point letters, a `select_true`
/// pick past the statement list — so a forged payload unpacks to a
/// bad answer (`Err` → wrong) instead of erroring grading.
fn unpack_response(
    q: Option<&Question>,
    t0: Option<&ItemTree>,
    packed: &PackedAnswer,
    table: &[String],
) -> Result<Response, NeoError> {
    match packed {
        PackedAnswer::Choice(i) => Ok(Response::Choice {
            index: usize::from(*i),
        }),
        PackedAnswer::Choices(ix) => {
            if let Some(Question::SelectTrue { statements }) = q {
                if ix.iter().any(|&i| usize::from(i) >= statements.len()) {
                    return Err(bad_answer("a selected statement does not exist"));
                }
            }
            Ok(Response::Choices {
                indices: ix.iter().map(|&i| usize::from(i)).collect(),
            })
        }
        PackedAnswer::Tips(ix) => {
            let tips = names_of(table, ix)?;
            if let Some(t0) = t0 {
                for n in &tips {
                    if !t0.tips.contains(n) {
                        return Err(bad_answer(format!("'{n}' is not a tip of the item's tree")));
                    }
                }
            }
            Ok(Response::Tips { tips })
        }
        PackedAnswer::Letter(i) => {
            let letter = char::from(0x41 + *i).to_string();
            if let Some(t0) = t0 {
                if !t0.points.contains(&letter) {
                    return Err(bad_answer(format!("unknown point letter '{letter}'")));
                }
            }
            Ok(Response::Point { letter })
        }
        PackedAnswer::Order(rank) => {
            let Some(Question::OrderNodes { nodes }) = q else {
                return Err(bad_answer("an order answer needs an order_nodes item"));
            };
            Ok(Response::Order {
                letters: lehmer_unrank(nodes, *rank),
            })
        }
        PackedAnswer::Number(v) => Ok(Response::Number { value: *v }),
        PackedAnswer::Pairwise(v) => Ok(Response::Pairwise {
            answer: match v {
                0 => Closer::B,
                1 => Closer::C,
                _ => Closer::Equal,
            },
        }),
        PackedAnswer::TwoTier { first, reason } => {
            let inner_q = match q {
                Some(Question::TwoTier { first: fq, .. }) => Some(&**fq),
                Some(_) => return Err(bad_answer("the packed answer does not fit the question")),
                None => None,
            };
            Ok(Response::TwoTier {
                first: Box::new(unpack_response(inner_q, t0, first, table)?),
                reason: usize::from(*reason),
            })
        }
        PackedAnswer::Pair(..) | PackedAnswer::Numeric(..) | PackedAnswer::Skipped => {
            Err(bad_answer("the packed tag is not a reading answer"))
        }
    }
}

// --- Lehmer codes ---------------------------------------------------------------------

/// The permutation rank of `letters` over `nodes` — `letters` must be
/// a permutation of `nodes` (validated; also bounds the list at 20 so
/// the rank fits u64).
fn lehmer_rank(nodes: &[String], letters: &[String]) -> Result<u64, NeoError> {
    let n = nodes.len();
    if n > 20 {
        return Err(bad_answer("an order question packs at most 20 nodes"));
    }
    let mut sorted_l = letters.to_vec();
    let mut sorted_n = nodes.to_vec();
    sorted_l.sort();
    sorted_n.sort();
    if sorted_l != sorted_n {
        return Err(bad_answer(
            "the order is not a permutation of the listed nodes",
        ));
    }
    let mut remaining: Vec<&String> = nodes.iter().collect();
    let mut rank = 0u64;
    for (i, l) in letters.iter().enumerate() {
        let j = remaining
            .iter()
            .position(|&x| x == l)
            .ok_or_else(|| bad_answer("the order repeats a node"))?;
        remaining.remove(j);
        rank = rank * (n - i) as u64 + j as u64;
    }
    Ok(rank)
}

fn lehmer_unrank(nodes: &[String], mut rank: u64) -> Vec<String> {
    // The inverse of `lehmer_rank`: position n−k's digit has radix k.
    // Each digit is < k = the remaining length at that step, so any
    // u64 unranks to a permutation of `nodes`.
    let n = nodes.len();
    let mut ls = vec![0u64; n];
    for k in 1..=n {
        ls[n - k] = rank % k as u64;
        rank /= k as u64;
    }
    let mut remaining = nodes.to_vec();
    ls.iter().map(|&j| remaining.remove(j as usize)).collect()
}

// --- fingerprint & size bounds -----------------------------------------------------

/// The assignment fingerprint a code carries (spec §5.7): the low 20
/// bits of `fnv1a64` over `serde_json::to_vec` of the assignment —
/// with `content` replaced by the recorded `content_hash` when one
/// exists (a built-in reference). An edited embedded exercise shifts
/// the fingerprint (`AssignmentMismatch`); a changed built-in keeps it
/// (`ContentChanged`, via `served_content_hash` on the assignment).
pub fn fingerprint(a: &Assignment) -> u32 {
    let mut value = serde_json::to_value(a).unwrap_or(serde_json::Value::Null);
    if let Some(h) = &a.content_hash {
        if let Some(obj) = value.as_object_mut() {
            obj.insert("content".to_string(), serde_json::Value::String(h.clone()));
        }
    }
    let bytes = serde_json::to_vec(&value).unwrap_or_default();
    (fnv1a64(&bytes) & 0x000F_FFFF) as u32
}

/// The exact worst-case code length for assignment `a` (spec §5.4):
/// every field at its widest — a [`MAX_ID_BYTES`]-byte id, `has_last`
/// set on every task, each payload at the widest kind the task's
/// widget can produce — plus `NP1-` and the group hyphens.
pub fn max_code_len(a: &Assignment) -> usize {
    let mut bits: usize = 4 + 8 + 20 + 7 + 8 * MAX_ID_BYTES + 6 + 4;
    for t in &a.tasks {
        let w = task_width(a, &t.task);
        bits += 4 + w + 1 + w + 4;
    }
    bits += 24;
    let payload_bytes = bits.div_ceil(8);
    let total_bits = payload_bytes * 8 + 16;
    let symbols = total_bits.div_ceil(5);
    4 + symbols + (symbols - 1) / 5
}

/// The widest payload a task's answers can take, in bits.
fn task_width(a: &Assignment, t: &TaskRef) -> usize {
    match t {
        TaskRef::PredictPair { .. } | TaskRef::Numeric { .. } => 32,
        TaskRef::PredictBranch => 64,
        TaskRef::Reading { item } => {
            let Content::Reading(set) = &a.content else {
                return 64;
            };
            set.items
                .get(*item)
                .map(|it| question_width(&it.question))
                .unwrap_or(64)
        }
    }
}

fn kind_width(k: PackedKind) -> usize {
    match k {
        PackedKind::Tips | PackedKind::Order | PackedKind::Choices => 64,
        PackedKind::Number => 32,
        PackedKind::Letter | PackedKind::Choice => 8,
        PackedKind::Pairwise => 2,
        PackedKind::TwoTier => 0,
    }
}

fn question_width(q: &Question) -> usize {
    if let Question::TwoTier { first, .. } = q {
        return 4 + question_width(first) + 8;
    }
    response_kinds(q)
        .iter()
        .map(|&k| kind_width(k))
        .max()
        .unwrap_or(0)
}
