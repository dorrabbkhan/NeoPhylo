//! Variant-transform property tests (v1.4d spec §5.4–5.5, plan Task 4):
//! `rotate` and `shuffle_tip_order` never change an answer; `relabel`
//! maps tip-bearing accepted sets through the same permutation;
//! every transform is deterministic for a seed.

use std::collections::BTreeMap;

use neophylo_core::reading::{
    answer, load_reading_set, relabel, relabel_map, rotate, shuffle_tip_order, Accepted, ReadingSet,
};
use proptest::prelude::*;

fn input(f: &str) -> String {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/reading_inputs/");
    std::fs::read_to_string(format!("{path}{f}")).expect("reading input exists")
}

const VALID: &[&str] = &[
    "valid-rel.json",
    "valid-traits.json",
    "valid-times.json",
    "valid-pool.json",
];

fn all_sets() -> Vec<ReadingSet> {
    VALID
        .iter()
        .map(|&f| load_reading_set(&input(f)).unwrap_or_else(|e| panic!("{f}: {e}")))
        .collect()
}

/// Map every tip name inside an accepted value through `m`.
fn map_accepted(a: &Accepted, m: &BTreeMap<String, String>) -> Accepted {
    let map_key = |k: &[String]| {
        let mut v: Vec<String> = k
            .iter()
            .map(|t| m.get(t).cloned().unwrap_or_else(|| t.clone()))
            .collect();
        v.sort();
        v.dedup();
        v
    };
    match a {
        Accepted::Clade(k) => Accepted::Clade(map_key(k)),
        Accepted::TipSet(k) => Accepted::TipSet(map_key(k)),
        Accepted::AnyTipOf(k) => Accepted::AnyTipOf(map_key(k)),
        Accepted::TwoTier { first, reason } => Accepted::TwoTier {
            first: Box::new(map_accepted(first, m)),
            reason: *reason,
        },
        other => other.clone(),
    }
}

fn answers_equal(s1: &ReadingSet, s2: &ReadingSet) -> bool {
    (0..s1.items.len()).all(|i| answer(s1, i) == answer(s2, i))
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(32))]

    #[test]
    fn answers_invariant_under_rotate(seed in any::<u64>()) {
        for s in all_sets() {
            let r = rotate(&s, seed);
            prop_assert!(
                answers_equal(&s, &r),
                "rotate changed an answer (seed {seed})"
            );
        }
    }

    #[test]
    fn answers_invariant_under_shuffle_tip_order(seed in any::<u64>()) {
        for s in all_sets() {
            let r = shuffle_tip_order(&s, seed);
            prop_assert!(
                answers_equal(&s, &r),
                "shuffle_tip_order changed an answer (seed {seed})"
            );
        }
    }

    #[test]
    fn relabel_maps_accepted_tip_sets(seed in any::<u64>()) {
        for s in all_sets() {
            let m = relabel_map(&s, seed).unwrap();
            let r = relabel(&s, seed).unwrap();
            for i in 0..s.items.len() {
                let a1 = answer(&s, i).unwrap();
                let a2 = answer(&r, i).unwrap();
                prop_assert_eq!(
                    map_accepted(&a1.accepted, &m),
                    a2.accepted,
                    "item {} answer did not map through the permutation",
                    s.items[i].id
                );
            }
        }
    }

    #[test]
    fn transforms_deterministic_for_a_seed(seed in any::<u64>()) {
        for s in all_sets() {
            prop_assert_eq!(rotate(&s, seed), rotate(&s, seed));
            prop_assert_eq!(shuffle_tip_order(&s, seed), shuffle_tip_order(&s, seed));
            prop_assert_eq!(relabel(&s, seed), relabel(&s, seed));
        }
    }
}
