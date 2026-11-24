//! Hashing for assignments (v1.5 spec §5.1, plan Task 4): one
//! hand-written FNV-1a-64 used for every derived seed — the variant
//! seed from `(assignment.id, normalised student id)`, the retry seeds
//! `hash(seed, k)` and the tagged sub-seeds the transforms draw from.
//! Written by hand so the recipe is stable across engine versions and
//! identical to what the web build computes — pinned by the known
//! answers in `tests/assess_hash.rs`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::NeoError;

/// FNV-1a, 64-bit: offset basis `0xcbf29ce484222325`, prime
/// `0x100000001b3`.
pub fn fnv1a64(bytes: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf2_9ce4_8422_2325;
    for &b in bytes {
        h ^= u64::from(b);
        h = h.wrapping_mul(0x0000_0100_0000_01b3);
    }
    h
}

/// The unit separator joining assignment id and student id in the
/// variant-seed recipe. `normalise_id` does not strip control
/// characters, but no id a student can type carries `\x1f`, so the
/// pair hashes unambiguously in practice; a crafted id that did
/// contain the byte would only change its own seed.
const SEP: u8 = 0x1f;

/// How a student id string is normalised before hashing. The default
/// — and currently only — rule is [`IdRule::TrimLower`].
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum IdRule {
    /// Trim Unicode whitespace and lowercase; an empty remainder is
    /// refused. `" Ana.Lopez@Uni.edu "` and `"ana.lopez@uni.edu"`
    /// name the same student; `"josé"` stays `"josé"`.
    #[default]
    TrimLower,
}

/// Normalise a raw student id under `rule`. The normalised id is what
/// [`variant_seed`] hashes and what the completion code records —
/// case- and padding-different spellings of the same id must land on
/// the same variant (v1.5 spec §5.1, Review Focus 2).
pub fn normalise_id(raw: &str, rule: IdRule) -> Result<String, NeoError> {
    let out = match rule {
        IdRule::TrimLower => raw.trim().to_lowercase(),
    };
    if out.is_empty() {
        return Err(NeoError::InvalidAssignment {
            field: "student_id".to_string(),
            msg: "a student id is required".to_string(),
        });
    }
    Ok(out)
}

/// The seed a student's variant grows from:
/// `fnv1a64(assignment_id ++ "\u{1f}" ++ normalised_id)`.
pub fn variant_seed(assignment_id: &str, normalised_id: &str) -> u64 {
    let mut bytes = Vec::with_capacity(assignment_id.len() + 1 + normalised_id.len());
    bytes.extend_from_slice(assignment_id.as_bytes());
    bytes.push(SEP);
    bytes.extend_from_slice(normalised_id.as_bytes());
    fnv1a64(&bytes)
}

/// The seed of retry attempt `k` (plan's Decided block): attempt 0 is
/// `seed` itself; `k = 1..=50` hashes
/// `le_bytes(seed) ++ le_bytes(k as u64)` — the counter is a full
/// u64, pinned to width in `tests/assess_hash.rs`.
pub fn retry_seed(seed: u64, k: u64) -> u64 {
    let mut bytes = Vec::with_capacity(16);
    bytes.extend_from_slice(&seed.to_le_bytes());
    bytes.extend_from_slice(&k.to_le_bytes());
    fnv1a64(&bytes)
}

/// A tagged sub-seed so the independent draws inside one variant
/// (simulation, relabelling, rotation, reading transforms) each get
/// their own stream: `fnv1a64(le_bytes(seed) ++ tag)`.
pub(crate) fn sub_seed(seed: u64, tag: &str) -> u64 {
    let mut bytes = Vec::with_capacity(8 + tag.len());
    bytes.extend_from_slice(&seed.to_le_bytes());
    bytes.extend_from_slice(tag.as_bytes());
    fnv1a64(&bytes)
}
