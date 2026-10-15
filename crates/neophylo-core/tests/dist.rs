use neophylo_core::dist::{compute, Cell, DistModel, DistanceMatrix};
use neophylo_core::error::NeoError;
use neophylo_core::seq::{parse_fasta, Alignment};
use proptest::prelude::*;

fn aln(records: &[(&str, &str)]) -> Alignment {
    let text: String = records
        .iter()
        .map(|(name, seq)| format!(">{name}\n{seq}\n"))
        .collect();
    parse_fasta(&text).unwrap()
}

fn value(dm: &DistanceMatrix, i: usize, j: usize) -> f64 {
    match dm.cells[i * dm.n() + j] {
        Cell::Value(v) => v,
        Cell::Saturated => panic!("cell ({i},{j}) is saturated"),
    }
}

#[test]
fn p_distance() {
    let dm = compute(
        &aln(&[("a", "ACGTACGTAC"), ("b", "ACGTACGTAA")]),
        DistModel::P,
    )
    .unwrap();
    assert_eq!(dm.n(), 2);
    assert_eq!(value(&dm, 0, 1), 0.1);
    assert_eq!(value(&dm, 0, 0), 0.0);
}

#[test]
fn jc69_value() {
    // p = 0.1 -> d = -0.75 ln(1 - 4p/3) = -0.75 ln(1 - 0.4/3)
    let dm = compute(
        &aln(&[("a", "ACGTACGTAC"), ("b", "ACGTACGTAA")]),
        DistModel::Jc69,
    )
    .unwrap();
    assert!((value(&dm, 0, 1) - 0.107326).abs() < 1e-6);
}

#[test]
fn k80_value() {
    // 100 sites: 10 transitions (A->G) and 5 transversions (A->C),
    // so P = 0.1 and Q = 0.05 and d = -0.5 ln(0.75) - 0.25 ln(0.9).
    let b: String = "G".repeat(10) + &"C".repeat(5) + &"A".repeat(85);
    let a: String = "A".repeat(100);
    let dm = compute(&aln(&[("a", &a), ("b", &b)]), DistModel::K80).unwrap();
    assert!((value(&dm, 0, 1) - 0.170181).abs() < 1e-6);
}

#[test]
fn jc69_saturates_at_075() {
    let dm = compute(&aln(&[("a", "AAAA"), ("b", "AGGG")]), DistModel::Jc69).unwrap();
    assert_eq!(dm.saturated_cells(), vec![(0, 1)]);
}

#[test]
fn k80_saturates() {
    // P = 0.4, Q = 0.2 -> 1 - 2P - Q = 0
    let b = "GGGGCCAAAA";
    let a = "AAAAAAAAAA";
    let dm = compute(&aln(&[("a", a), ("b", b)]), DistModel::K80).unwrap();
    assert_eq!(dm.saturated_cells(), vec![(0, 1)]);
}

#[test]
fn pairwise_deletion() {
    // Positions 1 and 2 are excluded (N and -), so only positions 0 and 3
    // are compared and both match.
    let dm = compute(&aln(&[("a", "AC-T"), ("b", "ANGT")]), DistModel::P).unwrap();
    assert_eq!(value(&dm, 0, 1), 0.0);
}

#[test]
fn no_overlap() {
    let err = compute(&aln(&[("a", "----"), ("b", "ACGT")]), DistModel::P).unwrap_err();
    assert_eq!(
        err,
        NeoError::InsufficientOverlap {
            a: "a".to_string(),
            b: "b".to_string(),
        }
    );
}

#[test]
fn to_matrix_blocks_saturation() {
    // a vs b differ at 6/8 sites (p = 0.75, saturated); a vs c and b vs c
    // differ at 3/8.
    let dm = compute(
        &aln(&[("a", "AAAAAAAA"), ("b", "GGGGGGAA"), ("c", "AAAGGGAA")]),
        DistModel::Jc69,
    )
    .unwrap();
    assert_eq!(dm.saturated_cells(), vec![(0, 1)]);
    let err = dm.to_matrix().unwrap_err();
    assert_eq!(
        err,
        NeoError::SaturatedMatrix {
            cells: vec![(0, 1)]
        }
    );
}

fn arb_alignment() -> impl Strategy<Value = Alignment> {
    (3usize..=10, 20usize..=200).prop_flat_map(|(n_taxa, n_sites)| {
        let base = prop_oneof![
            8 => Just(b'A'),
            8 => Just(b'C'),
            8 => Just(b'G'),
            8 => Just(b'T'),
            1 => Just(b'-'),
            1 => Just(b'N'),
        ];
        proptest::collection::vec(proptest::collection::vec(base, n_sites), n_taxa).prop_map(
            move |seqs| Alignment {
                labels: (0..n_taxa).map(|i| format!("t{i}")).collect(),
                seqs,
            },
        )
    })
}

proptest! {
    #[test]
    fn prop_properties(aln in arb_alignment()) {
        let p = compute(&aln, DistModel::P);
        prop_assume!(p.is_ok());
        let p = p.unwrap();
        // If p computed, every pair has comparable sites, so JC69 cannot
        // fail with InsufficientOverlap either.
        let jc = compute(&aln, DistModel::Jc69).unwrap();
        let n = p.n();
        prop_assert_eq!(jc.n(), n);
        for i in 0..n {
            prop_assert_eq!(p.cells[i * n + i], Cell::Value(0.0));
            prop_assert_eq!(jc.cells[i * n + i], Cell::Value(0.0));
            for j in 0..n {
                let pc = p.cells[i * n + j];
                let jcc = jc.cells[i * n + j];
                prop_assert_eq!(pc, p.cells[j * n + i]);
                prop_assert_eq!(jcc, jc.cells[j * n + i]);
                if let Cell::Value(v) = pc {
                    prop_assert!(v >= 0.0 && v.is_finite());
                }
                if let Cell::Value(v) = jcc {
                    prop_assert!(v >= 0.0 && v.is_finite());
                }
                if let (Cell::Value(pv), Cell::Value(jv)) = (pc, jcc) {
                    prop_assert!(jv + 1e-12 >= pv, "JC69 {jv} < p {pv} at ({i},{j})");
                }
            }
        }
    }
}
