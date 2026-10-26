//! v1.4 distances: `F84` and `K2pPhylip { ratio }` (v1.4 spec §3.1, §3.4).
//!
//! The reference values are the printed output of PHYLIP 3.697 `dnadist`
//! on the two-sequence alignment in `pair()` (58 comparable sites;
//! 8 transitions, 5 transversions; empirical base frequencies
//! A 0.3017, C 0.1983, G 0.2241, T 0.2759). The plan's worked example
//! lives in `fixtures/worked/` once Task 3 adds it; until then the values
//! below are the oracle, copied from that `dnadist` run:
//!
//! ```text
//! F84 run, all default settings (D=F84, G=No, T=2.0, C=Yes, F=Yes):
//!     SeqA       0.000000 0.273375
//!     SeqB       0.273375 0.000000
//!
//! Kimura run, 'D' toggled once to "Kimura 2-parameter", T set to 2.0
//! (empirical base frequencies are refused for Kimura, so it uses
//! equal frequencies and the ML solve in dnadist's makev, not the K80
//! closed form):
//!     SeqA       0.000000 0.273342
//!     SeqB       0.273342 0.000000
//! ```
//!
//! dnadist prints six decimals, so each assertion allows half a unit in
//! the last printed decimal (0.5e-6).

use neophylo_core::alphabet::Alphabet;
use neophylo_core::dist::{compute, Cell, DistModel};
use neophylo_core::error::NeoError;
use neophylo_core::seq::{parse_fasta, Alignment};

/// The alignment the dnadist runs above used.
fn pair() -> Alignment {
    parse_fasta(
        ">SeqA\nATGCCATGACTGGATCGATTCGGAATCGATCGATTGCATCGATCGGATCCTAGCTAAT\n\
         >SeqB\nATGTCAAGATTGTATTGAATCAGAATCAATGGACTGCATCGAACGAATCCTGGCTAAT\n",
    )
    .unwrap()
}

fn cell(m: &neophylo_core::dist::DistanceMatrix, i: usize, j: usize) -> Cell {
    m.cells[i * m.n() + j]
}

fn value(c: Cell) -> f64 {
    match c {
        Cell::Value(v) => v,
        Cell::Saturated => panic!("expected a finite distance, got Saturated"),
    }
}

#[test]
fn f84_matches_dnadist_worked_example() {
    let m = compute(&pair(), DistModel::F84).unwrap();
    assert!((value(cell(&m, 0, 1)) - 0.273375).abs() <= 0.5e-6);
}

#[test]
fn k2p_phylip_matches_dnadist_worked_example() {
    let m = compute(&pair(), DistModel::K2pPhylip { ratio: 2.0 }).unwrap();
    assert!((value(cell(&m, 0, 1)) - 0.273342).abs() <= 0.5e-6);
}

#[test]
fn f84_matches_dnadist_when_a_base_is_missing() {
    // 4-taxon alignment with no G at all: dnadist's empirical-frequency
    // path feeds `makev` the raw frequencies (the `getinput` floor is
    // `!freqsfrom` only). dnadist 3.697, all default settings (D=F84,
    // G=No, T=2.0, C=Yes, F=Yes), printed:
    //     Taxon1     0.000000 0.256408 0.274450 0.890129
    //     Taxon2     0.256408 0.000000 0.539643 0.327208
    //     Taxon3     0.274450 0.539643 0.000000 0.826500
    //     Taxon4     0.890129 0.327208 0.826500 0.000000
    let aln = parse_fasta(
        ">Taxon1\nATCCCATCACTCCATCCATTCCCAATCCATCCATTCCATCCATCCCATCCTACCTAAT\n\
         >Taxon2\nATCTCAACATTCTATTCAATCACAATCAATCCACTCCATCCAACCAATCCTCCCTAAT\n\
         >Taxon3\nATTCCATTACTTTATCTATTCTTAATCTATCTATTTCATCTATCTTATCCTATCTAAT\n\
         >Taxon4\nATATCAAAATTATATTAAATCAAAATCAATAAACTACATCAAACAAATCCTAACTAAT\n",
    )
    .unwrap();
    let expected = [
        [0.000000, 0.256408, 0.274450, 0.890129],
        [0.256408, 0.000000, 0.539643, 0.327208],
        [0.274450, 0.539643, 0.000000, 0.826500],
        [0.890129, 0.327208, 0.826500, 0.000000],
    ];
    let m = compute(&aln, DistModel::F84).unwrap();
    for (i, row) in expected.iter().enumerate() {
        for (j, &exp) in row.iter().enumerate() {
            if i != j {
                assert!(
                    (value(cell(&m, i, j)) - exp).abs() <= 0.5e-6,
                    "cell ({i}, {j}): engine {} vs dnadist {exp}",
                    value(cell(&m, i, j)),
                );
            }
        }
    }
}

#[test]
fn new_model_names_and_alphabet_support() {
    assert_eq!(DistModel::F84.name(), "F84");
    assert_eq!(DistModel::K2pPhylip { ratio: 2.0 }.name(), "K2P_PHYLIP");

    // Protein input refuses both DNA-only models (v1.1 spec §3.4).
    let prot = parse_fasta(">a\nMKVL\n>b\nMKVA\n").unwrap();
    assert_eq!(prot.alphabet, Alphabet::Protein);
    for model in [DistModel::F84, DistModel::K2pPhylip { ratio: 2.0 }] {
        match compute(&prot, model) {
            Err(NeoError::ModelAlphabetMismatch { .. }) => {}
            other => panic!("expected ModelAlphabetMismatch, got {other:?}"),
        }
    }
}

#[test]
fn k2p_phylip_rejects_invalid_ratio() {
    for ratio in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        match compute(&pair(), DistModel::K2pPhylip { ratio }) {
            Err(NeoError::InvalidExercise { field, .. }) => assert_eq!(field, "ratio"),
            other => panic!("ratio {ratio}: expected InvalidExercise, got {other:?}"),
        }
    }
}

#[test]
fn new_models_saturate_on_divergent_pair() {
    // Nothing but transversions: the likelihood keeps rising with tt, so
    // dnadist writes -1.0 ("DIFFERENCE ... TOO LARGE TO ESTIMATE
    // DISTANCE") and the engine reports Saturated.
    let aln = parse_fasta(">a\nAAAAAAAAAAAAAAAA\n>b\nCCCCCCCCCCCCCCCC\n").unwrap();
    for model in [DistModel::F84, DistModel::K2pPhylip { ratio: 2.0 }] {
        let m = compute(&aln, model).unwrap();
        assert_eq!(cell(&m, 0, 1), Cell::Saturated, "{model:?}");
        assert_eq!(m.saturated_cells(), vec![(0, 1)]);
    }
}

#[test]
fn new_models_symmetric_zero_diagonal_nonnegative() {
    let aln = parse_fasta(
        ">a\nATGCCATGACTGGATCGATTCGGAATCGATCG\n\
         >b\nATGTCAAGATTGTATTGAATCAGAATCAATGG\n\
         >c\nATGCCATGACTGGATCGATTCGGAATCGATCG\n",
    )
    .unwrap();
    for model in [DistModel::F84, DistModel::K2pPhylip { ratio: 2.0 }] {
        let m = compute(&aln, model).unwrap();
        for i in 0..m.n() {
            assert_eq!(cell(&m, i, i), Cell::Value(0.0), "{model:?} diagonal");
            for j in 0..m.n() {
                assert_eq!(cell(&m, i, j), cell(&m, j, i), "{model:?} symmetry");
                assert!(value(cell(&m, i, j)) >= 0.0, "{model:?} non-negative");
            }
        }
    }
}

#[test]
fn identical_sequences_give_zero_distance() {
    // dnadist's F84 climb starts at tt = 0.1 and halves down, so the
    // optimum lands a hair above 0 and prints as 0.000000; K2P's
    // p-distance gate returns exactly 0. Compare at printed precision.
    let aln = parse_fasta(">a\nACGTACGTACGT\n>b\nACGTACGTACGT\n").unwrap();
    for model in [DistModel::F84, DistModel::K2pPhylip { ratio: 2.0 }] {
        let m = compute(&aln, model).unwrap();
        assert!(value(cell(&m, 0, 1)).abs() <= 0.5e-6, "{model:?}");
    }
}
