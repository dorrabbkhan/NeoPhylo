//! `.meg` property tests (v1.4b spec §3.6): `write_meg` then `parse_meg`
//! is the identity on every alignment the engine accepts whose labels
//! carry no whitespace (whitespace labels map to `_` by contract — see
//! `tests/meg.rs`). New file, new functions only; saved `cc` seeds of
//! other strategies stay valid.

use neophylo_core::alphabet::{Alphabet, PROTEIN_STATES};
use neophylo_core::meg::{parse_meg, write_meg};
use neophylo_core::seq::Alignment;
use proptest::prelude::*;

fn dna_chars() -> BoxedStrategy<u8> {
    prop_oneof![
        8 => Just(b'A'),
        8 => Just(b'C'),
        8 => Just(b'G'),
        8 => Just(b'T'),
        1 => Just(b'-'),
        1 => Just(b'?'),
        1 => Just(b'N'),
        1 => Just(b'R'),
        1 => Just(b'U'),
    ]
    .boxed()
}

fn protein_chars() -> BoxedStrategy<u8> {
    prop_oneof![
        30 => proptest::sample::select(&PROTEIN_STATES[..]),
        1 => Just(b'X'),
        1 => Just(b'B'),
        1 => Just(b'-'),
        1 => Just(b'?'),
    ]
    .boxed()
}

/// Labels the `.meg` writer can reproduce: unique, non-empty, and free
/// of whitespace and `"` (a quote would open a comment on re-parse).
/// The `t{i}` stem guarantees uniqueness.
fn arb_labels(n: usize) -> impl Strategy<Value = Vec<String>> {
    proptest::collection::vec(
        proptest::string::string_regex("[A-Za-z0-9_.\\-]{0,8}").unwrap(),
        n,
    )
    .prop_map(move |suffixes| {
        suffixes
            .into_iter()
            .enumerate()
            .map(|(i, s)| format!("t{i}{s}"))
            .collect()
    })
}

fn arb_alignment(
    chars: fn() -> BoxedStrategy<u8>,
    alphabet: Alphabet,
) -> impl Strategy<Value = Alignment> {
    (1usize..=8, 1usize..=40).prop_flat_map(move |(n, l)| {
        (
            arb_labels(n),
            proptest::collection::vec(proptest::collection::vec(chars(), l), n),
        )
            .prop_map(move |(labels, seqs)| Alignment {
                labels,
                seqs,
                alphabet,
            })
    })
}

/// `U` is written back as `U` under a declared `DataType=DNA` but the
/// parser normalizes it to `T`: normalize expectations the same way.
fn normalized(aln: &Alignment) -> Alignment {
    let mut aln = aln.clone();
    if aln.alphabet == Alphabet::Dna {
        for seq in &mut aln.seqs {
            for b in seq.iter_mut() {
                *b = b.to_ascii_uppercase();
                if *b == b'U' {
                    *b = b'T';
                }
            }
        }
    } else {
        for seq in &mut aln.seqs {
            for b in seq.iter_mut() {
                *b = b.to_ascii_uppercase();
            }
        }
    }
    aln
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn meg_round_trip(
        aln in prop_oneof![
            arb_alignment(dna_chars, Alphabet::Dna),
            arb_alignment(protein_chars, Alphabet::Protein),
        ]
    ) {
        let expected = normalized(&aln);
        let out = write_meg(&expected, "proptest").unwrap();
        let back = parse_meg(&out).unwrap();
        prop_assert_eq!(back.alignment, expected);
    }
}
