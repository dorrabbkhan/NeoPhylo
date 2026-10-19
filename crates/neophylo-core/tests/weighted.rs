//! Weighted distances (v1.2 spec §3.1): `compute_weighted` reproduces
//! `compute` bit for bit at all-ones weights and equals `compute` on the
//! column-expanded alignment for arbitrary weights.

use neophylo_core::alphabet::{Alphabet, PROTEIN_STATES};
use neophylo_core::dist::{compute, compute_weighted, Cell, DistModel, DistanceMatrix};
use neophylo_core::error::NeoError;
use neophylo_core::seq::{parse_fasta, Alignment};
use proptest::prelude::*;
use std::fs;
use std::path::PathBuf;

fn fixture_aln(rel: &str) -> Alignment {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../fixtures")
        .join(rel);
    parse_fasta(&fs::read_to_string(&path).unwrap()).unwrap()
}

fn aln(records: &[(&str, &str)]) -> Alignment {
    let text: String = records
        .iter()
        .map(|(name, seq)| format!(">{name}\n{seq}\n"))
        .collect();
    parse_fasta(&text).unwrap()
}

/// Every cell bitwise equal (`f64::to_bits`), including Saturated.
fn assert_bitwise(
    a: &Result<DistanceMatrix, NeoError>,
    b: &Result<DistanceMatrix, NeoError>,
    ctx: &str,
) {
    match (a, b) {
        (Ok(x), Ok(y)) => {
            assert_eq!(x.labels, y.labels, "{ctx}: labels");
            assert_eq!(x.model, y.model, "{ctx}: model");
            assert_eq!(x.cells.len(), y.cells.len(), "{ctx}: cell count");
            for (i, (c1, c2)) in x.cells.iter().zip(y.cells.iter()).enumerate() {
                match (c1, c2) {
                    (Cell::Value(v1), Cell::Value(v2)) => {
                        assert_eq!(v1.to_bits(), v2.to_bits(), "{ctx}: cell {i}")
                    }
                    _ => assert_eq!(c1, c2, "{ctx}: cell {i}"),
                }
            }
        }
        _ => assert_eq!(a, b, "{ctx}: result shape"),
    }
}

/// `aln'` with column j repeated exactly `w[j]` times, in column order.
fn expand(aln: &Alignment, w: &[u32]) -> Alignment {
    let seqs = aln
        .seqs
        .iter()
        .map(|s| {
            let mut out = Vec::new();
            for (k, &b) in s.iter().enumerate() {
                if let Some(&wt) = w.get(k) {
                    out.extend(std::iter::repeat_n(b, wt as usize));
                }
            }
            out
        })
        .collect();
    Alignment {
        labels: aln.labels.clone(),
        seqs,
        alphabet: aln.alphabet,
    }
}

/// The equivalence rule: `compute_weighted(aln, m, w)` has the same
/// Ok/Err shape as `compute(expand(aln, w), m)`, the same errors, the
/// same Saturated cells, and Value cells within `tol`.
fn assert_equivalent(
    aln: &Alignment,
    w: &[u32],
    model: DistModel,
    tol: f64,
) -> Result<(), TestCaseError> {
    let weighted = compute_weighted(aln, model, w);
    let direct = compute(&expand(aln, w), model);
    match (weighted, direct) {
        (Ok(a), Ok(b)) => {
            prop_assert_eq!(a.labels, b.labels);
            prop_assert_eq!(a.cells.len(), b.cells.len());
            for (i, (x, y)) in a.cells.iter().zip(b.cells.iter()).enumerate() {
                match (x, y) {
                    (Cell::Value(x), Cell::Value(y)) => {
                        prop_assert!((x - y).abs() <= tol, "cell {i}: {x} vs {y}");
                    }
                    _ => prop_assert_eq!(x, y, "cell {}", i),
                }
            }
        }
        (Err(x), Err(y)) => prop_assert_eq!(x, y),
        (x, y) => prop_assert!(false, "shape mismatch: {x:?} vs {y:?}"),
    }
    Ok(())
}

#[test]
fn identity_bit_for_bit() {
    let dna = [
        "inputs/jc6.fasta",
        "inputs/jc7_long.fasta",
        "inputs/jc8_gaps.fasta",
        "inputs/jc12.fasta",
        "inputs/k80_10.fasta",
    ];
    let protein = [
        "inputs/protein/p6_150.fasta",
        "inputs/protein/p8_250.fasta",
        "inputs/protein/p10_400.fasta",
        "inputs/protein/p12_100.fasta",
    ];
    for rel in dna.iter().chain(protein.iter()) {
        let aln = fixture_aln(rel);
        let models: &[DistModel] = match aln.alphabet {
            Alphabet::Dna => &[DistModel::P, DistModel::Jc69, DistModel::K80],
            Alphabet::Protein => &[DistModel::P, DistModel::Kimura, DistModel::Jtt],
        };
        let w = vec![1u32; aln.seqs[0].len()];
        for &model in models {
            let plain = compute(&aln, model);
            let weighted = compute_weighted(&aln, model, &w);
            assert_bitwise(&plain, &weighted, &format!("{rel} {}", model.name()));
        }
    }
}

#[test]
fn zero_weights_drop_columns() {
    // Columns 0-2 are the only ones a and b share (column 3 is T vs N);
    // zeroing them leaves no weighted comparable sites.
    let pair = aln(&[("a", "ACGT"), ("b", "ACGN")]);
    let err = compute_weighted(&pair, DistModel::P, &[0, 0, 0, 1]).unwrap_err();
    assert!(
        matches!(err, NeoError::InsufficientOverlap { .. }),
        "expected InsufficientOverlap, got {err:?}"
    );
    // Sanity: with all columns drawn the same pair computes fine.
    assert!(compute_weighted(&pair, DistModel::P, &[1, 1, 1, 1]).is_ok());
}

#[test]
fn length_mismatch() {
    let pair = aln(&[("a", "ACGT"), ("b", "ACGT")]);
    for w in [&[1u32; 3][..], &[1u32; 5][..]] {
        let err = compute_weighted(&pair, DistModel::P, w).unwrap_err();
        match err {
            NeoError::InvalidExercise { field, .. } => assert_eq!(field, "weights"),
            other => panic!("expected InvalidExercise.weights, got {other:?}"),
        }
    }
}

fn arb_dna() -> impl Strategy<Value = Alignment> {
    (3usize..=8, 10usize..=60).prop_flat_map(|(n, l)| {
        let base = prop_oneof![
            8 => Just(b'A'),
            8 => Just(b'C'),
            8 => Just(b'G'),
            8 => Just(b'T'),
            1 => Just(b'-'),
            1 => Just(b'N'),
        ];
        proptest::collection::vec(proptest::collection::vec(base, l), n).prop_map(move |seqs| {
            Alignment {
                labels: (0..n).map(|i| format!("t{i}")).collect(),
                seqs,
                alphabet: Alphabet::Dna,
            }
        })
    })
}

fn arb_protein() -> impl Strategy<Value = Alignment> {
    (3usize..=8, 10usize..=60).prop_flat_map(|(n, l)| {
        let base = prop_oneof![
            30 => proptest::sample::select(&PROTEIN_STATES[..]),
            1 => Just(b'X'),
            1 => Just(b'-'),
            1 => Just(b'?'),
        ];
        proptest::collection::vec(proptest::collection::vec(base, l), n).prop_map(move |seqs| {
            Alignment {
                labels: (0..n).map(|i| format!("t{i}")).collect(),
                seqs,
                alphabet: Alphabet::Protein,
            }
        })
    })
}

fn weighted(
    aln_strat: impl Strategy<Value = Alignment>,
) -> impl Strategy<Value = (Alignment, Vec<u32>)> {
    aln_strat.prop_flat_map(|aln| {
        let l = aln.seqs.iter().map(Vec::len).max().unwrap_or(0);
        (Just(aln), proptest::collection::vec(0u32..=3, l))
    })
}

proptest! {
    #[test]
    fn equivalence_property_dna((aln, w) in weighted(arb_dna())) {
        for model in [DistModel::P, DistModel::Jc69, DistModel::K80] {
            assert_equivalent(&aln, &w, model, 1e-12)?;
        }
    }

    #[test]
    fn equivalence_property_protein((aln, w) in weighted(arb_protein())) {
        for model in [DistModel::P, DistModel::Kimura] {
            assert_equivalent(&aln, &w, model, 1e-12)?;
        }
    }
}

proptest! {
    // The JTT optimizer is the expensive path; fewer cases keep the
    // suite fast while still covering weighted vs expanded count tables.
    #![proptest_config(ProptestConfig::with_cases(32))]
    #[test]
    fn equivalence_property_jtt((aln, w) in weighted(arb_protein())) {
        assert_equivalent(&aln, &w, DistModel::Jtt, 1e-9)?;
    }
}
