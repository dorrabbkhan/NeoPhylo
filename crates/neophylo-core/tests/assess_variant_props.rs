//! Variant-generation sweep (v1.5 spec §5.2, plan Task 4): every
//! assignable built-in, 1,000 generated student ids each — the
//! variant satisfies its declared premises or reports `fell_back`,
//! and generation never panics. The sweep is a plain loop (the ids
//! are fixed, not sampled), plus a capped proptest for arbitrary id
//! strings.

use std::fs;
use std::path::{Path, PathBuf};

use neophylo_core::assess::{
    make_variant, normalise_id, premises_hold, variant_seed, Content, IdRule,
};
use neophylo_core::exercise::load_exercise;
use neophylo_core::reading::load_reading_set;
use proptest::prelude::*;

const LESSON_FILES: [&str; 8] = [
    "bootstrap-basics",
    "cytochrome-c",
    "nj-basics",
    "nj-by-hand",
    "protein-models",
    "saturation",
    "upgma-fails",
    "upgma-vs-nj-matrix",
];

const READING_FILES: [&str; 7] = [
    "trees-clades-traits",
    "trees-closest-relatives",
    "trees-demo",
    "trees-form-a",
    "trees-form-b",
    "trees-reading-a-tree",
    "trees-rotation",
];

fn exercises_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("exercises")
}

fn built_ins() -> Vec<(String, Content)> {
    let mut out = Vec::new();
    for id in LESSON_FILES {
        let text = fs::read_to_string(exercises_dir().join(format!("{id}.json")))
            .unwrap_or_else(|e| panic!("{id}: {e}"));
        out.push((
            id.to_string(),
            Content::Exercise(load_exercise(&text).unwrap_or_else(|e| panic!("{id}: {e}"))),
        ));
    }
    for id in READING_FILES {
        let text = fs::read_to_string(exercises_dir().join("reading").join(format!("{id}.json")))
            .unwrap_or_else(|e| panic!("{id}: {e}"));
        out.push((
            id.to_string(),
            Content::Reading(load_reading_set(&text).unwrap_or_else(|e| panic!("{id}: {e}"))),
        ));
    }
    out
}

/// The declared premises of a loaded content file.
fn declared(content: &Content) -> &[neophylo_core::assess::Premise] {
    match content {
        Content::Exercise(ex) => &ex.premises,
        Content::Reading(set) => &set.premises,
    }
}

#[test]
fn every_built_in_satisfies_its_premises_or_falls_back() {
    for (id, base) in built_ins() {
        let premises = declared(&base);
        let mut fell_back = 0usize;
        let mut retries = 0usize;
        for k in 0..1_000 {
            let nid = normalise_id(&format!("student-{k}"), IdRule::TrimLower).unwrap();
            let seed = variant_seed(&id, &nid);
            let v = make_variant(&base, premises, seed, true)
                .unwrap_or_else(|e| panic!("{id} student-{k}: {e}"));
            if v.fell_back {
                fell_back += 1;
                assert_eq!(v.content, base, "{id}: fell_back returns the base");
            } else {
                assert!(
                    premises_hold(&v.content, premises).unwrap(),
                    "{id} student-{k} retry {}: a non-fallback variant must hold",
                    v.retry,
                );
                if v.retry > 0 {
                    retries += 1;
                }
            }
        }
        // Conductor's fallback budget: 50 per 1,000 generated ids.
        eprintln!("{id}: {fell_back}/1000 fell back, {retries} retried");
        assert!(
            fell_back <= 50,
            "{id}: {fell_back}/1000 fell back (budget 50) — report STOP, do not loosen a premise",
        );
    }
}

#[test]
fn built_in_variants_differ_across_ids() {
    // Varying content must actually vary: at least one of 20 seeds
    // yields content different from the base for every varying kind.
    for (id, base) in built_ins() {
        let fixed = matches!(&base, Content::Exercise(ex) if {
            use neophylo_core::exercise::ExerciseData::*;
            match &ex.data {
                Embedded { .. } => true,
                Matrix { .. } => ex
                    .reference
                    .as_ref()
                    .map(|r| r.kind != neophylo_core::exercise::ReferenceKind::True)
                    .unwrap_or(true),
                Simulated { .. } => false,
            }
        });
        let mut differs = false;
        for k in 0..20 {
            let seed = variant_seed(&id, &format!("student-{k}"));
            let v = make_variant(&base, declared(&base), seed, true)
                .unwrap_or_else(|e| panic!("{id} student-{k}: {e}"));
            if v.content != base {
                differs = true;
            }
        }
        if !fixed {
            assert!(differs, "{id}: varying content must differ across ids");
        }
    }
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    /// Arbitrary id strings: normalisation either errors (empty after
    /// trim) or yields a string the seed recipe accepts — never a panic.
    #[test]
    fn normalise_id_never_panics(raw in "\\PC{0,64}") {
        match normalise_id(&raw, IdRule::TrimLower) {
            Ok(nid) => {
                prop_assert!(!nid.is_empty());
                prop_assert_eq!(&nid, &nid.to_lowercase());
                let _ = variant_seed("asst-1", &nid);
            }
            Err(neophylo_core::NeoError::InvalidAssignment { field, .. }) => {
                prop_assert_eq!(field, "student_id");
            }
            Err(e) => return Err(TestCaseError::fail(format!("unexpected {e:?}"))),
        }
    }

    /// make_variant on any seed never panics and always reports a
    /// retry index in 0..=50.
    #[test]
    fn make_variant_never_panics(seed in any::<u64>()) {
        let text = fs::read_to_string(exercises_dir().join("nj-by-hand.json")).unwrap();
        let base = Content::Exercise(load_exercise(&text).unwrap());
        let v = make_variant(&base, declared(&base), seed, true).unwrap();
        prop_assert!(v.retry <= 50);
    }
}
