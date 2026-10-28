//! Property tests for the `Poisson` protein model (v1.4b spec §3.6,
//! plan Task 4): `d = −ln(1 − p)` is symmetric, has a zero diagonal, is
//! non-negative and is monotone in the observed difference proportion
//! p; `p = 1` is `Saturated`. Protein-only like JTT: a DNA alignment
//! under `Poisson` or `JttMega` is `ModelAlphabetMismatch`.

use neophylo_core::dist::{compute, compute_filtered, Cell, DistModel};
use neophylo_core::error::NeoError;
use neophylo_core::protein_dist::poisson_from_p;
use neophylo_core::seq::parse_fasta;
use neophylo_core::site_filter::SiteFilter;
use proptest::prelude::*;

fn protein_aln(records: &[&str]) -> neophylo_core::seq::Alignment {
    let text: String = records
        .iter()
        .enumerate()
        .map(|(i, s)| format!(">s{i}\n{s}\n"))
        .collect();
    parse_fasta(&text).unwrap()
}

fn cell(m: &neophylo_core::dist::DistanceMatrix, i: usize, j: usize) -> Cell {
    m.cells[i * m.n() + j]
}

#[test]
fn poisson_formula() {
    // d = -ln(1-p): p=0 -> 0, p=0.5 -> ln 2, p -> 1 diverges.
    assert_eq!(poisson_from_p(0.0), Cell::Value(0.0));
    match poisson_from_p(0.5) {
        Cell::Value(d) => assert!((d - libm::log(2.0)).abs() < 1e-15),
        other => panic!("expected value, got {other:?}"),
    }
    assert_eq!(poisson_from_p(1.0), Cell::Saturated);
}

proptest! {
    /// Symmetric, zero diagonal, non-negative, monotone in p.
    #[test]
    fn poisson_symmetric_zero_nonneg_monotone(
        diffs in 0usize..40,
        len in 40usize..80,
    ) {
        let diffs = diffs.min(len - 1);
        let a: String = "E".repeat(len);
        let mut b: String = "E".repeat(len);
        // First `diffs` sites become L (a single-residue difference).
        b.replace_range(..diffs, &"L".repeat(diffs));
        let aln = protein_aln(&[&a, &b]);
        let m = compute(&aln, DistModel::Poisson).unwrap();
        prop_assert_eq!(cell(&m, 0, 0), Cell::Value(0.0));
        prop_assert_eq!(cell(&m, 1, 1), Cell::Value(0.0));
        let fwd = cell(&m, 0, 1);
        let rev = cell(&m, 1, 0);
        prop_assert_eq!(fwd, rev);
        // Monotone in p: a strictly more divergent pair is no closer.
        let mut b2: String = "E".repeat(len);
        let more = (diffs + 1).min(len - 1);
        b2.replace_range(..more, &"L".repeat(more));
        let aln2 = protein_aln(&[&a, &b2]);
        let m2 = compute(&aln2, DistModel::Poisson).unwrap();
        if let (Cell::Value(d1), Cell::Value(d2)) = (cell(&m, 0, 1), cell(&m2, 0, 1)) {
            prop_assert!(d2 >= d1, "not monotone: {d1} -> {d2}");
        }
        if let Cell::Value(d) = fwd {
            prop_assert!(d >= 0.0);
        }
    }
}

#[test]
fn poisson_saturates_at_p_one() {
    // Every comparable site differs -> p = 1 -> Saturated.
    let aln = protein_aln(&["ARNDCQEGHILKMFPSTWYV", "ARNDCQEGHILKMFPSTWYA"]);
    let m = compute(&aln, DistModel::Poisson).unwrap();
    match cell(&m, 0, 1) {
        Cell::Value(d) => assert!((d - libm::log(20.0 / 19.0)).abs() < 1e-15),
        other => panic!("expected value, got {other:?}"),
    }

    let aln = protein_aln(&["EEEE", "LLLL"]);
    let m = compute(&aln, DistModel::Poisson).unwrap();
    assert_eq!(cell(&m, 0, 1), Cell::Saturated);
}

#[test]
fn poisson_and_jtt_mega_are_protein_only() {
    // supports(): the new corrections reject DNA with
    // ModelAlphabetMismatch, exactly like Kimura/Jtt.
    let dna = parse_fasta(">a\nACGTACGT\n>b\nACGTACGA\n").unwrap();
    for model in [DistModel::Poisson, DistModel::JttMega] {
        match compute(&dna, model) {
            Err(NeoError::ModelAlphabetMismatch { model: m, .. }) => {
                assert_eq!(m, model.name())
            }
            other => panic!(
                "{:?}: expected ModelAlphabetMismatch, got {other:?}",
                model.name()
            ),
        }
        match compute_filtered(&dna, model, SiteFilter::Complete) {
            Err(NeoError::ModelAlphabetMismatch { .. }) => {}
            other => panic!(
                "{:?}: filtered expected ModelAlphabetMismatch, got {other:?}",
                model.name()
            ),
        }
    }
}
