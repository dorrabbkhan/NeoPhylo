//! Column resampling (v1.2 spec §3.2): determinism, the committed
//! SHA-256 golden that locks the RNG scheme (`ChaCha8Rng` seeded by
//! `seed`, `set_stream(i)`, multiply-shift draws), and the undrawn-column
//! fraction.
//!
//! The golden constant was generated once when this test was added
//! (see docs/decisions.md); it pins the exact RNG stream layout, so any
//! change here is a deliberate RNG break, never a regen.

use neophylo_core::bootstrap::resample_weights;

#[test]
fn weights_deterministic() {
    for i in 0..10u32 {
        let a = resample_weights(1, i, 100);
        let b = resample_weights(1, i, 100);
        assert_eq!(a, b, "same (seed, i, l) must give identical weights");
        assert_eq!(a.iter().sum::<u32>(), 100, "weights must sum to l");
    }
    assert_ne!(
        resample_weights(1, 0, 100),
        resample_weights(1, 1, 100),
        "different replicates must draw different columns"
    );
    assert_ne!(
        resample_weights(1, 0, 100),
        resample_weights(2, 0, 100),
        "different seeds must draw different columns"
    );
    assert!(resample_weights(1, 0, 0).is_empty());
}

/// Minimal SHA-256 so the golden needs no new dependency. Verified
/// against the published "abc" test vector in `sha256_sanity`.
fn sha256(data: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
        0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
        0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
        0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
        0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
        0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
        0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
        0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
        0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
        0xc67178f2,
    ];
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut msg = data.to_vec();
    let bitlen = (data.len() as u64).wrapping_mul(8);
    msg.push(0x80);
    while msg.len() % 64 != 56 {
        msg.push(0);
    }
    msg.extend_from_slice(&bitlen.to_be_bytes());
    // Padding above guarantees a whole number of 64-byte blocks.
    for chunk in msg.as_chunks::<64>().0 {
        let mut w = [0u32; 64];
        for t in 0..16 {
            w[t] = u32::from_be_bytes([
                chunk[4 * t],
                chunk[4 * t + 1],
                chunk[4 * t + 2],
                chunk[4 * t + 3],
            ]);
        }
        for t in 16..64 {
            let s0 = w[t - 15].rotate_right(7) ^ w[t - 15].rotate_right(18) ^ (w[t - 15] >> 3);
            let s1 = w[t - 2].rotate_right(17) ^ w[t - 2].rotate_right(19) ^ (w[t - 2] >> 10);
            w[t] = w[t - 16]
                .wrapping_add(s0)
                .wrapping_add(w[t - 7])
                .wrapping_add(s1);
        }
        let (mut a, mut b, mut c, mut d, mut e, mut f, mut g, mut hh) =
            (h[0], h[1], h[2], h[3], h[4], h[5], h[6], h[7]);
        for t in 0..64 {
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(K[t])
                .wrapping_add(w[t]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            hh = g;
            g = f;
            f = e;
            e = d.wrapping_add(t1);
            d = c;
            c = b;
            b = a;
            a = t1.wrapping_add(t2);
        }
        h[0] = h[0].wrapping_add(a);
        h[1] = h[1].wrapping_add(b);
        h[2] = h[2].wrapping_add(c);
        h[3] = h[3].wrapping_add(d);
        h[4] = h[4].wrapping_add(e);
        h[5] = h[5].wrapping_add(f);
        h[6] = h[6].wrapping_add(g);
        h[7] = h[7].wrapping_add(hh);
    }
    let mut out = [0u8; 32];
    for (i, word) in h.iter().enumerate() {
        out[4 * i..4 * i + 4].copy_from_slice(&word.to_be_bytes());
    }
    out
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

#[test]
fn sha256_sanity() {
    // Published SHA-256 test vector, so a broken local implementation
    // fails here rather than silently corrupting the golden below.
    assert_eq!(
        hex(&sha256(b"abc")),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
}

/// SHA-256 of the concatenated weight vectors (each `u32` as four
/// little-endian bytes, replicate-major order) for seed 1, replicates
/// 0..10, l = 100.
const WEIGHTS_GOLDEN_SHA256: &str =
    "e1891dcc8d4e15c9b8c61233eb0d6e0ae9cca04e5c9feef76a6811d0f827d3cc";

#[test]
fn weights_golden() {
    let mut data = Vec::new();
    for i in 0..10u32 {
        for w in resample_weights(1, i, 100) {
            data.extend_from_slice(&w.to_le_bytes());
        }
    }
    assert_eq!(hex(&sha256(&data)), WEIGHTS_GOLDEN_SHA256);
}

#[test]
fn undrawn_fraction() {
    // spec §6.6 / §8.2: the chance a column is never drawn is
    // (1 - 1/L)^L ~ e^-1 ~ 0.368.
    let l = 500usize;
    let replicates = 2_000u32;
    let mut zeros = 0u64;
    for i in 0..replicates {
        zeros += resample_weights(1, i, l)
            .iter()
            .filter(|&&w| w == 0)
            .count() as u64;
    }
    let frac = zeros as f64 / (replicates as f64 * l as f64);
    assert!(
        (frac - 0.368).abs() <= 0.01,
        "undrawn fraction {frac} not within 0.368 ± 0.01"
    );
}
