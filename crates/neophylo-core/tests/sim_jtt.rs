//! JTT protein simulation tests (v1.1 spec §3.5, §6.2): determinism,
//! the JTT golden hash, convergence to the true path length, root
//! composition against `JTT.freqs`, and the JTT-beats-p sanity check.
//! The three v1 DNA golden hashes are re-asserted here so this file
//! also fails if the JTT changes regress the DNA code paths.
//!
//! `fixtures/sim_golden_jtt.json` is written by the ignored
//! `regen_golden` test in `tests/sim.rs`; it must not be edited by
//! hand.

use neophylo_core::alphabet::{protein_index, Alphabet};
use neophylo_core::dist::Cell;
use neophylo_core::model::JTT;
use neophylo_core::newick::parse_newick;
use neophylo_core::protein_dist::{jtt_ml, pair_counts};
use neophylo_core::seq::Alignment;
use neophylo_core::sim::{simulate, SimModel, SimSpec};
use serde::Deserialize;

/// The `true_tree` of the `nj-basics` exercise (spec §7), shared with
/// the DNA goldens.
const NJ_BASICS_TREE: &str = "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);";

fn spec(model: SimModel, length: u32, seed: u64) -> SimSpec {
    SimSpec {
        model,
        length,
        seed,
    }
}

#[test]
fn jtt_deterministic() {
    let tree = parse_newick(NJ_BASICS_TREE).unwrap();
    let s = spec(SimModel::Jtt, 200, 42);
    let a = simulate(&tree, &s).unwrap();
    let b = simulate(&tree, &s).unwrap();
    assert_eq!(a, b);
    assert_eq!(a.alphabet, Alphabet::Protein);
    let c = simulate(&tree, &spec(SimModel::Jtt, 200, 43)).unwrap();
    assert_ne!(a.seqs, c.seqs);
}

// --- golden hashes -----------------------------------------------------------

/// FNV-1a, 64-bit, over the concatenated sequences of an alignment —
/// the same hash `tests/sim.rs` uses for the DNA goldens.
fn fnv1a64(aln: &Alignment) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    for seq in &aln.seqs {
        for &b in seq {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    h
}

#[test]
fn dna_goldens_unchanged() {
    // The three committed v1 hashes (fixtures/sim_golden.json), asserted
    // against their literal values so a regression in the shared RNG or
    // DNA sampling code is caught here even before the fixture file is
    // consulted.
    let cases = [
        (
            "jc69_seed1",
            spec(SimModel::Jc69, 1_000, 1),
            "5a41626080d0973c",
        ),
        (
            "k80_k2_seed2",
            spec(SimModel::K80 { kappa: 2.0 }, 1_000, 2),
            "596d15e509289285",
        ),
        (
            "jc69_seed3_len10000",
            spec(SimModel::Jc69, 10_000, 3),
            "67b045ba5fcdad28",
        ),
    ];
    let tree = parse_newick(NJ_BASICS_TREE).unwrap();
    for (name, s, want) in cases {
        let aln = simulate(&tree, &s).unwrap();
        assert_eq!(
            aln.alphabet,
            Alphabet::Dna,
            "{name}: DNA simulation must stay Dna"
        );
        assert_eq!(
            format!("{:016x}", fnv1a64(&aln)),
            want,
            "golden hash mismatch in case {name}"
        );
    }
}

fn golden_jtt_path() -> String {
    concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/sim_golden_jtt.json"
    )
    .to_string()
}

#[derive(Deserialize)]
struct GoldenFile {
    cases: Vec<GoldenCase>,
}

#[derive(Deserialize)]
struct GoldenCase {
    name: String,
    tree: String,
    model: String,
    length: u32,
    seed: u64,
    fnv1a64: String,
}

#[test]
fn jtt_golden() {
    let text = std::fs::read_to_string(golden_jtt_path())
        .expect("run `cargo test -- --ignored regen_golden` first");
    let golden: GoldenFile = serde_json::from_str(&text).unwrap();
    assert_eq!(golden.cases.len(), 1);
    let case = &golden.cases[0];
    assert_eq!(case.name, "jtt_seed4");
    assert_eq!(case.model, "JTT");
    let tree = parse_newick(&case.tree).unwrap();
    let aln = simulate(&tree, &spec(SimModel::Jtt, case.length, case.seed)).unwrap();
    assert_eq!(
        format!("{:016x}", fnv1a64(&aln)),
        case.fnv1a64,
        "golden hash mismatch in case {}",
        case.name
    );
}

// --- convergence -------------------------------------------------------------

/// The JTT estimate for one simulated two-leaf alignment.
fn jtt_between_leaves(aln: &Alignment) -> (f64, f64) {
    let (table, comparable, differences) = pair_counts(&aln.seqs[0], &aln.seqs[1]);
    assert!(comparable > 0, "no comparable sites");
    let p = differences as f64 / f64::from(comparable);
    let d = match jtt_ml(&table) {
        Cell::Value(d) => d,
        Cell::Saturated => panic!("saturated pair"),
    };
    (p, d)
}

#[test]
fn jtt_convergence() {
    // v1.1 spec §6.2: two leaves at 0.15 each (path length 0.3),
    // 100,000 sites, seed 7 — the JTT estimate lands within 2% of 0.3.
    let tree = parse_newick("(A:0.15,B:0.15);").unwrap();
    let aln = simulate(&tree, &spec(SimModel::Jtt, 100_000, 7)).unwrap();
    let (_, d) = jtt_between_leaves(&aln);
    assert!((d - 0.3).abs() <= 0.02 * 0.3, "got {d}, want 0.3 ± 2%");
}

#[test]
fn root_composition() {
    // v1.1 spec §6.2: the root draws from `JTT.freqs`. Zero-length
    // branches keep the tip sequence equal to the root (up to the
    // ~1e-6 noise of the stored spectral data at t = 0, far below the
    // 0.01 tolerance), so a tip's composition is the draw distribution.
    let tree = parse_newick("(A:0,B:0);").unwrap();
    let aln = simulate(&tree, &spec(SimModel::Jtt, 100_000, 5)).unwrap();
    let mut counts = [0u64; 20];
    for &b in &aln.seqs[0] {
        counts[usize::from(protein_index(b).expect("non-standard state produced"))] += 1;
    }
    for (i, &pi) in JTT.freqs.iter().enumerate() {
        let got = counts[i] as f64 / 100_000.0;
        assert!(
            (got - pi).abs() <= 0.01,
            "state {i}: got {got}, want {pi} ± 0.01"
        );
    }
}

#[test]
fn jtt_beats_p_in_aggregate() {
    // v1.1 spec §6.2 sanity check: on JTT-simulated data the ML
    // estimate is closer to the true path length than p in aggregate.
    // Not asserted per pair — an ML estimate is not guaranteed to beat
    // p for every pair.
    let mut jtt_err = 0.0;
    let mut p_err = 0.0;
    let pairs = 20u64;
    for k in 0..pairs {
        let path = 0.5 + k as f64 / 19.0; // spread over [0.5, 1.5]
        let half = path / 2.0;
        let tree = parse_newick(&format!("(A:{half},B:{half});")).unwrap();
        let aln = simulate(&tree, &spec(SimModel::Jtt, 1_000, 100 + k)).unwrap();
        let (p, d) = jtt_between_leaves(&aln);
        jtt_err += (d - path).abs();
        p_err += (p - path).abs();
    }
    let (jtt_mean, p_mean) = (
        jtt_err / f64::from(pairs as u32),
        p_err / f64::from(pairs as u32),
    );
    assert!(
        jtt_mean < p_mean,
        "mean |JTT - true| = {jtt_mean} not less than mean |p - true| = {p_mean}"
    );
}

/// `P(t)` rows are probability rows only to the embedded-constants
/// precision (~5e-6, Task 6's `DATA_TOL`), so a uniform draw can land
/// past a row's cumulative sum. `sample_aa` must then assign the last
/// state — never index past the row — for the root draw and every
/// `mutate_protein` site. This test pins both the row tolerance and the
/// no-panic simulation at t = 10, where the row-sum drift is worst.
#[test]
fn jtt_rows_and_sampling() {
    for t in [0.01, 1.0, 10.0] {
        let p = JTT.transition_probs(t);
        for (x, row) in p.iter().enumerate() {
            let sum: f64 = row.iter().sum();
            assert!(
                (sum - 1.0).abs() <= 5e-6,
                "P({t}) row {x} sums to {sum}, not 1 ± 5e-6"
            );
        }
    }

    let tree = parse_newick("(A:10.0,B:10.0);").unwrap();
    let aln = simulate(&tree, &spec(SimModel::Jtt, 10_000, 5)).unwrap();
    assert_eq!(aln.alphabet, Alphabet::Protein);
    for seq in &aln.seqs {
        assert_eq!(seq.len(), 10_000);
        assert!(seq.iter().all(|&b| protein_index(b).is_some()));
    }
}
