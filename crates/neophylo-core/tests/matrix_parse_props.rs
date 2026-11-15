//! Matrix parser/writer round-trip property tests (v1.4c spec §5.1,
//! plan Task 4): `parse_meg_matrix(write_meg_matrix(m))` preserves a
//! valid `DistanceInput` exactly, and
//! `parse_phylip_matrix(write_phylip_matrix(to_distance_matrix(m)))`
//! preserves names and values within the writer's printed precision.
//! New functions in the new file only — existing strategies are
//! untouched.

use neophylo_core::matrix_input::DistanceInput;
use neophylo_core::matrix_parse::{
    parse_meg_matrix, parse_phylip_matrix, write_meg_matrix, PhylipMatrixOptions,
};
use neophylo_core::phylip::{write_phylip_matrix, NameMode};
use proptest::prelude::*;

/// A valid `DistanceInput`: 3–12 taxa, names `[A-Za-z0-9_]{1,10}`
/// unique, values in `[0, 10]` (plan Task 4 Produces).
fn arb_distance_input() -> impl Strategy<Value = DistanceInput> {
    (3usize..=12)
        .prop_flat_map(|n| {
            (
                proptest::collection::vec("[A-Za-z0-9_]{1,10}", n..=n),
                proptest::collection::vec(0.0f64..=10.0, n * (n - 1) / 2),
            )
                .prop_map(move |(names, lower)| DistanceInput { names, lower })
        })
        .prop_filter("names must be unique", |m| {
            let mut seen = std::collections::BTreeSet::new();
            m.names.iter().all(|n| seen.insert(n))
        })
}

proptest! {
    /// MEGA writer → parser round-trips exactly (full-precision `{}`
    /// output, so the reparsed values equal bit for bit).
    #[test]
    fn meg_round_trip(m in arb_distance_input()) {
        let text = write_meg_matrix(&m, "prop").expect("write_meg_matrix");
        let back = parse_meg_matrix(&text).expect("parse_meg_matrix");
        prop_assert_eq!(back.matrix, m);
    }

    /// PHYLIP writer → parser round-trips within printed precision
    /// (`write_phylip_matrix` prints 6 decimals; half an ulp is
    /// 0.5e-6).
    #[test]
    fn phylip_round_trip(m in arb_distance_input()) {
        let dm = m.to_distance_matrix().expect("to_distance_matrix");
        let text = write_phylip_matrix(&dm, NameMode::Strict).expect("write_phylip_matrix");
        let back = parse_phylip_matrix(
            &text,
            PhylipMatrixOptions {
                names: NameMode::Strict,
                use_lower_if_asymmetric: false,
            },
        )
        .expect("parse_phylip_matrix");
        prop_assert_eq!(back.matrix.names, m.names);
        prop_assert_eq!(back.matrix.lower.len(), m.lower.len());
        for (got, want) in back.matrix.lower.iter().zip(&m.lower) {
            prop_assert!(
                (got - want).abs() <= 0.5e-6,
                "{got} vs {want} exceeds printed precision"
            );
        }
    }
}
