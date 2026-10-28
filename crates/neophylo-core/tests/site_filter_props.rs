//! Site-filter property tests (v1.4b spec §3.6): `Complete` equals
//! `Pairwise` on gap-free alignments, `Partial { 100 }` equals
//! `Complete`, `Partial { 0 }` equals `Pairwise`, and raising the cutoff
//! never keeps a column a lower cutoff removed. New strategies and
//! functions only — saved `cc` seeds elsewhere stay valid.

use neophylo_core::alphabet::{Alphabet, PROTEIN_STATES};
use neophylo_core::error::NeoError;
use neophylo_core::seq::Alignment;
use neophylo_core::site_filter::{site_mask, SiteFilter, SiteMask};
use proptest::prelude::*;

fn dna_chars(gap_free: bool) -> BoxedStrategy<u8> {
    if gap_free {
        prop_oneof![Just(b'A'), Just(b'C'), Just(b'G'), Just(b'T')].boxed()
    } else {
        prop_oneof![
            8 => Just(b'A'),
            8 => Just(b'C'),
            8 => Just(b'G'),
            8 => Just(b'T'),
            1 => Just(b'-'),
            1 => Just(b'?'),
            1 => Just(b'N'),
            1 => Just(b'R'),
        ]
        .boxed()
    }
}

fn protein_chars(gap_free: bool) -> BoxedStrategy<u8> {
    if gap_free {
        proptest::sample::select(&PROTEIN_STATES[..]).boxed()
    } else {
        prop_oneof![
            30 => proptest::sample::select(&PROTEIN_STATES[..]),
            1 => Just(b'X'),
            1 => Just(b'-'),
            1 => Just(b'?'),
        ]
        .boxed()
    }
}

fn arb_alignment(
    chars: impl Fn(bool) -> BoxedStrategy<u8>,
    gap_free: bool,
    alphabet: Alphabet,
) -> impl Strategy<Value = Alignment> {
    (1usize..=8, 1usize..=40).prop_flat_map(move |(n, l)| {
        proptest::collection::vec(proptest::collection::vec(chars(gap_free), l), n).prop_map(
            move |seqs| Alignment {
                labels: (0..n).map(|i| format!("t{i}")).collect(),
                seqs,
                alphabet,
            },
        )
    })
}

fn kept(mask: &SiteMask) -> Vec<usize> {
    mask.weights
        .iter()
        .enumerate()
        .filter(|(_, &w)| w == 1)
        .map(|(k, _)| k)
        .collect()
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn complete_eq_pairwise_on_gap_free(
        aln in prop_oneof![
            arb_alignment(dna_chars, true, Alphabet::Dna),
            arb_alignment(protein_chars, true, Alphabet::Protein),
        ]
    ) {
        let mask = site_mask(&aln, SiteFilter::Complete).unwrap();
        prop_assert!(mask.removed.is_empty());
        prop_assert!(mask.weights.iter().all(|&w| w == 1));
    }

    #[test]
    fn partial_100_eq_complete(
        aln in prop_oneof![
            arb_alignment(dna_chars, false, Alphabet::Dna),
            arb_alignment(protein_chars, false, Alphabet::Protein),
        ]
    ) {
        let complete = site_mask(&aln, SiteFilter::Complete);
        let p100 = site_mask(&aln, SiteFilter::Partial { cutoff_pct: 100 });
        match (complete, p100) {
            (Ok(a), Ok(b)) => {
                prop_assert_eq!(a.weights, b.weights);
                prop_assert_eq!(a.removed, b.removed);
            }
            // Both fail the same way; the `filter` strings legitimately
            // differ — each names its own treatment.
            (
                Err(NeoError::NoSitesKept { .. }),
                Err(NeoError::NoSitesKept { .. }),
            ) => {}
            (a, b) => prop_assert!(false, "shape mismatch: {a:?} vs {b:?}"),
        }
    }

    #[test]
    fn partial_0_eq_pairwise(
        aln in prop_oneof![
            arb_alignment(dna_chars, false, Alphabet::Dna),
            arb_alignment(protein_chars, false, Alphabet::Protein),
        ]
    ) {
        let mask = site_mask(&aln, SiteFilter::Partial { cutoff_pct: 0 }).unwrap();
        prop_assert!(mask.removed.is_empty());
        prop_assert!(mask.weights.iter().all(|&w| w == 1));
    }

    #[test]
    fn raising_cutoff_never_unremoves(
        (aln, lo, hi) in (
            prop_oneof![
                arb_alignment(dna_chars, false, Alphabet::Dna),
                arb_alignment(protein_chars, false, Alphabet::Protein),
            ],
            0u8..=100,
            0u8..=100,
        )
            .prop_map(|(a, x, y)| (a, x.min(y), x.max(y)))
    ) {
        let lo_mask = site_mask(&aln, SiteFilter::Partial { cutoff_pct: lo });
        let hi_mask = site_mask(&aln, SiteFilter::Partial { cutoff_pct: hi });
        match (lo_mask, hi_mask) {
            (Ok(lo_m), Ok(hi_m)) => {
                let lo_kept: std::collections::BTreeSet<usize> =
                    kept(&lo_m).into_iter().collect();
                for k in kept(&hi_m) {
                    prop_assert!(lo_kept.contains(&k), "column {k} kept at {hi} but not at {lo}");
                }
            }
            (Err(_), Ok(hi_m)) => {
                // `lo` removed everything; `hi` cannot keep more.
                prop_assert!(hi_m.weights.iter().all(|&w| w == 0));
            }
            // `hi` removed everything `lo` kept: still monotone.
            (Ok(_), Err(NeoError::NoSitesKept { .. })) => {}
            (Err(NeoError::NoSitesKept { .. }), Err(NeoError::NoSitesKept { .. })) => {}
            (a, b) => prop_assert!(false, "shape mismatch: {a:?} vs {b:?}"),
        }
    }

    #[test]
    fn out_of_range_cutoff_is_error_not_panic(
        aln in arb_alignment(dna_chars, false, Alphabet::Dna),
        cutoff_pct in 101u8..=255,
    ) {
        match site_mask(&aln, SiteFilter::Partial { cutoff_pct }) {
            Err(NeoError::InvalidExercise { field, .. }) => {
                prop_assert_eq!(field, "site_filter.cutoff_pct");
            }
            other => prop_assert!(false, "cutoff {cutoff_pct}: {other:?}"),
        }
    }
}
