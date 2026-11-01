//! Filtered pair detail (v1.4b spec §3.1, §6.2 — owner decision
//! 2026-10-30: the pair panel's numbers follow the gap treatment).
//! `SiteFilter::Pairwise` is `jtt_pair_detail` bit for bit; under
//! `Complete`/`Partial` the detail's p, Kimura and JTT equal the
//! filtered distance-matrix cells exactly, and its counts drop the
//! removed columns. A pair with no comparable kept site is
//! `InsufficientOverlap`, never a NaN.

use std::fs;
use std::path::PathBuf;

use neophylo_core::alphabet::{protein_index, Alphabet};
use neophylo_core::dist::{compute_filtered, Cell, DistModel, DistanceMatrix};
use neophylo_core::error::NeoError;
use neophylo_core::protein_dist::{jtt_pair_detail, jtt_pair_detail_filtered, PairDetail};
use neophylo_core::seq::{parse_fasta, Alignment};
use neophylo_core::site_filter::SiteFilter;
use proptest::prelude::*;

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

fn cell_bitwise(a: &Cell, b: &Cell, ctx: &str) {
    match (a, b) {
        (Cell::Value(x), Cell::Value(y)) => assert_eq!(x.to_bits(), y.to_bits(), "{ctx}"),
        _ => assert_eq!(a, b, "{ctx}"),
    }
}

/// Every `PairDetail` field bitwise equal (`f64::to_bits`) — the same
/// rule `tests/site_filter.rs` uses for the filtered matrix.
fn assert_detail_bitwise(a: &PairDetail, b: &PairDetail, ctx: &str) {
    assert_eq!((a.a, a.b), (b.a, b.b), "{ctx}: pair indices");
    assert_eq!(a.comparable, b.comparable, "{ctx}: comparable");
    assert_eq!(a.differences, b.differences, "{ctx}: differences");
    assert_eq!(a.p.to_bits(), b.p.to_bits(), "{ctx}: p");
    cell_bitwise(&a.kimura, &b.kimura, &format!("{ctx}: kimura"));
    cell_bitwise(&a.jtt, &b.jtt, &format!("{ctx}: jtt"));
    assert_eq!(a.counts, b.counts, "{ctx}: counts");
    assert_eq!(a.curve.len(), b.curve.len(), "{ctx}: curve length");
    for (k, (x, y)) in a.curve.iter().zip(b.curve.iter()).enumerate() {
        assert_eq!(x.0.to_bits(), y.0.to_bits(), "{ctx}: curve[{k}].d");
        assert_eq!(x.1.to_bits(), y.1.to_bits(), "{ctx}: curve[{k}].logl");
    }
    assert_eq!(
        a.d_hat.map(f64::to_bits),
        b.d_hat.map(f64::to_bits),
        "{ctx}: d_hat"
    );
    assert_eq!(
        a.logl_hat.map(f64::to_bits),
        b.logl_hat.map(f64::to_bits),
        "{ctx}: logl_hat"
    );
}

/// Same bitwise rule for the `Result`: equal errors, identical details.
fn assert_result_bitwise(
    a: &Result<PairDetail, NeoError>,
    b: &Result<PairDetail, NeoError>,
    ctx: &str,
) {
    match (a, b) {
        (Ok(x), Ok(y)) => assert_detail_bitwise(x, y, ctx),
        (Err(x), Err(y)) => assert_eq!(x, y, "{ctx}: error"),
        _ => panic!("{ctx}: result shape differs: {a:?} vs {b:?}"),
    }
}

fn matrix_cell(m: &DistanceMatrix, i: usize, j: usize) -> &Cell {
    &m.cells[i * m.labels.len() + j]
}

#[test]
fn pairwise_is_bit_identical() {
    // The four protein fixture inputs (gap-free) plus inline alignments
    // with gaps and non-standard residues — including one pair with no
    // comparable sites at all, which must error identically.
    let alignments = vec![
        fixture_aln("inputs/protein/p6_150.fasta"),
        fixture_aln("inputs/protein/p8_250.fasta"),
        fixture_aln("inputs/protein/p10_400.fasta"),
        fixture_aln("inputs/protein/p12_100.fasta"),
        aln(&[
            ("a", "M-VLGELAKV"),
            ("b", "MKVLGRLAKV"),
            ("c", "MQVLGELTK-"),
            ("d", "MKALGELAKV"),
        ]),
        aln(&[("x", "XXXX"), ("y", "MKVL"), ("z", "MKVL")]),
    ];
    for aln in &alignments {
        let n = aln.seqs.len();
        for i in 0..n {
            for j in i + 1..n {
                let ctx = format!("pair {i},{j} of {:?}", aln.labels);
                assert_result_bitwise(
                    &jtt_pair_detail_filtered(aln, i, j, SiteFilter::Pairwise),
                    &jtt_pair_detail(aln, i, j),
                    &ctx,
                );
            }
        }
    }
}

/// A gapped protein alignment for the matrix-consistency pins.
/// Column 9 is 3/4 present, column 10 is 1/4, column 11 is 2/4 — so
/// `Complete` removes {9, 10, 11}, `Partial { 50 }` removes {10} only,
/// and column 11 stays comparable for (c,d) but not for pairs with a/b.
fn gapped_protein() -> Alignment {
    aln(&[
        ("a", "MKVLGELAKVK-"),
        ("b", "MKVLGRLAKV--"),
        ("c", "MQVLGELTK--M"),
        ("d", "MKALGELAKV-K"),
    ])
}

#[test]
fn filtered_p_matches_filtered_matrix() {
    let aln = gapped_protein();
    let n = aln.seqs.len();
    for filter in [SiteFilter::Complete, SiteFilter::Partial { cutoff_pct: 50 }] {
        let mp = compute_filtered(&aln, DistModel::P, filter).unwrap();
        let mk = compute_filtered(&aln, DistModel::Kimura, filter).unwrap();
        let mj = compute_filtered(&aln, DistModel::Jtt, filter).unwrap();
        for i in 0..n {
            for j in i + 1..n {
                let ctx = format!("{filter:?} pair {i},{j}");
                let detail = jtt_pair_detail_filtered(&aln, i, j, filter).unwrap();
                cell_bitwise(
                    &Cell::Value(detail.p),
                    matrix_cell(&mp, i, j),
                    &format!("{ctx}: p"),
                );
                cell_bitwise(
                    &detail.kimura,
                    matrix_cell(&mk, i, j),
                    &format!("{ctx}: kimura"),
                );
                cell_bitwise(&detail.jtt, matrix_cell(&mj, i, j), &format!("{ctx}: jtt"));
            }
        }
    }
}

#[test]
fn filtered_counts_exclude_removed_columns() {
    // Column 0 has a gap in c: complete deletion drops it. For the
    // (a,b) pair that removes one comparable M/M column.
    let aln = aln(&[("a", "MKVLG"), ("b", "MIVLG"), ("c", "-KVLG")]);

    let unfiltered = jtt_pair_detail(&aln, 0, 1).unwrap();
    assert_eq!(unfiltered.comparable, 5);
    assert_eq!(unfiltered.differences, 1);
    assert_eq!(unfiltered.p, 0.2);

    let filtered = jtt_pair_detail_filtered(&aln, 0, 1, SiteFilter::Complete).unwrap();
    assert_eq!(filtered.comparable, 4);
    assert_eq!(filtered.differences, 1);
    assert_eq!(filtered.p, 0.25);

    // The sparse table is ordered pairs (a's state first): (G,G),
    // (L,L), (K,I) at the one difference, (V,V) — each once, in
    // PROTEIN_STATES order — and no (M,M) cell from the removed column.
    let idx = |c: u8| protein_index(c).unwrap();
    assert_eq!(
        filtered.counts,
        vec![
            (idx(b'G'), idx(b'G'), 1),
            (idx(b'L'), idx(b'L'), 1),
            (idx(b'K'), idx(b'I'), 1),
            (idx(b'V'), idx(b'V'), 1),
        ]
    );
    assert!(unfiltered.counts.contains(&(idx(b'M'), idx(b'M'), 1)));
}

#[test]
fn no_sites_kept_is_an_error() {
    // Every column has a gap in one of the two sequences: complete
    // deletion removes all sites.
    let two = aln(&[("a", "-M"), ("b", "M-")]);
    match jtt_pair_detail_filtered(&two, 0, 1, SiteFilter::Complete) {
        Err(NeoError::NoSitesKept { filter }) => assert_eq!(filter, "complete"),
        other => panic!("expected NoSitesKept, got {other:?}"),
    }

    // Error order is the unfiltered function's first — alphabet, then
    // index — before the filter's own errors.
    let dna = Alignment {
        alphabet: Alphabet::Dna,
        ..aln(&[("a", "ACGT"), ("b", "ACGA")])
    };
    match jtt_pair_detail_filtered(&dna, 0, 1, SiteFilter::Partial { cutoff_pct: 101 }) {
        Err(NeoError::ModelAlphabetMismatch { .. }) => {}
        other => panic!("expected ModelAlphabetMismatch first, got {other:?}"),
    }
    match jtt_pair_detail_filtered(&two, 9, 0, SiteFilter::Complete) {
        Err(NeoError::InvalidExercise { field, .. }) => assert_eq!(field, "pair"),
        other => panic!("expected the index error before NoSitesKept, got {other:?}"),
    }
}

#[test]
fn pair_without_kept_overlap_is_insufficient_overlap() {
    // Partial { 50 }: every column is 2/4 present, so all are kept —
    // but pair (a,b) is all gaps and shares no comparable kept site.
    let aln = aln(&[("a", "----"), ("b", "----"), ("c", "MKVL"), ("d", "MKVL")]);
    match jtt_pair_detail_filtered(&aln, 0, 1, SiteFilter::Partial { cutoff_pct: 50 }) {
        Err(NeoError::InsufficientOverlap { a, b }) => {
            assert_eq!((a.as_str(), b.as_str()), ("a", "b"));
        }
        other => panic!("expected InsufficientOverlap, got {other:?}"),
    }
    // Pair (a,c) is the same, and the unfiltered path already reports
    // it — the filtered call must not produce a NaN detail.
    match jtt_pair_detail_filtered(&aln, 0, 2, SiteFilter::Partial { cutoff_pct: 50 }) {
        Err(NeoError::InsufficientOverlap { .. }) => {}
        other => panic!("expected InsufficientOverlap, got {other:?}"),
    }
}

fn protein_chars() -> BoxedStrategy<u8> {
    prop_oneof![
        30 => proptest::sample::select(neophylo_core::alphabet::PROTEIN_STATES),
        1 => Just(b'X'),
        1 => Just(b'-'),
        1 => Just(b'?'),
    ]
    .boxed()
}

fn arb_protein_alignment() -> impl Strategy<Value = Alignment> {
    (1usize..=8, 1usize..=40).prop_flat_map(|(n, l)| {
        proptest::collection::vec(proptest::collection::vec(protein_chars(), l), n).prop_map(
            move |seqs| Alignment {
                labels: (0..n).map(|i| format!("t{i}")).collect(),
                seqs,
                alphabet: Alphabet::Protein,
            },
        )
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// v1.4b §3.6: `Pairwise` detail is the unfiltered detail bit for
    /// bit on random protein alignments — gaps, `X`s and zero-overlap
    /// pairs included. New strategy and function: saved `cc` seeds in
    /// other prop files stay valid.
    #[test]
    fn pairwise_detail_eq_unfiltered(aln in arb_protein_alignment()) {
        let n = aln.seqs.len();
        for i in 0..n {
            for j in i + 1..n {
                let ctx = format!("pair {i},{j} of {:?}", aln.labels);
                match (
                    jtt_pair_detail_filtered(&aln, i, j, SiteFilter::Pairwise),
                    jtt_pair_detail(&aln, i, j),
                ) {
                    (Ok(a), Ok(b)) => assert_detail_bitwise(&a, &b, &ctx),
                    (Err(a), Err(b)) => prop_assert_eq!(a, b),
                    (a, b) => prop_assert!(false, "{}: {:?} vs {:?}", ctx, a, b),
                }
            }
        }
    }
}
