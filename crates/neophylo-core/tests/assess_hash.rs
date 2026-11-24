//! Assignment hashing (v1.5 spec §5.1, plan Task 4): the FNV-1a-64
//! primitive, the variant-seed recipe and the retry-seed recipe, all
//! pinned to known answers so the web build derives the same variants.

use neophylo_core::assess::{fnv1a64, retry_seed, variant_seed};

#[test]
fn fnv1a64_known_answers() {
    assert_eq!(fnv1a64(b""), 0xcbf2_9ce4_8422_2325);
    assert_eq!(fnv1a64(b"a"), 0xaf63_dc4c_8601_ec8c);
    assert_eq!(fnv1a64(b"foobar"), 0x8594_4171_f739_67e8);
}

#[test]
fn variant_seed_is_assignment_id_plus_separator_plus_id() {
    // fnv1a64("assignment-1" ++ "\u{1f}" ++ "ana.lopez@uni.edu")
    // — pinned literal computed independently (python); changing the
    // recipe changes every student's variant.
    assert_eq!(
        variant_seed("assignment-1", "ana.lopez@uni.edu"),
        0x6bc4_f2d5_fbc9_da19,
    );
    // The separator must be part of the recipe: hashing the
    // concatenation without it gives a different value.
    assert_ne!(
        variant_seed("assignment-1", "ana.lopez@uni.edu"),
        fnv1a64(b"assignment-1ana.lopez@uni.edu"),
    );
}

#[test]
fn retry_seed_appends_attempt_as_u64_le() {
    // attempt k hashes `le_bytes(seed) ++ le_bytes(k as u64)` — the
    // plan's Decided block pins `k` to a 64-bit counter; a u8/u32
    // recipe would hash different bytes.
    let seed: u64 = 0x0123_4567_89ab_cdef;
    let mut bytes = seed.to_le_bytes().to_vec();
    bytes.extend_from_slice(&3u64.to_le_bytes());
    assert_eq!(retry_seed(seed, 3), fnv1a64(&bytes));
    // A different-width counter gives a different value: 3 as u32.
    let mut bytes32 = seed.to_le_bytes().to_vec();
    bytes32.extend_from_slice(&3u32.to_le_bytes());
    assert_ne!(retry_seed(seed, 3), fnv1a64(&bytes32));
    // Known answer for seed 0, k = 1 (python cross-checked).
    assert_eq!(retry_seed(0, 1), 0x6925_58b0_5610_1a44);
}
