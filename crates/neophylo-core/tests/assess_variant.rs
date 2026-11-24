//! Assignment variants (v1.5 spec §5.2, plan Task 4): student-id
//! normalisation, seeded content transforms, premise retry with
//! `fell_back`, and the `premises` key wiring on exercise and reading
//! files (presence-aware like `meta`, v5-only on exercises).

use std::fs;
use std::path::{Path, PathBuf};

use neophylo_core::assess::{
    make_variant, normalise_id, premises_hold, variant_seed, Assignment, Content, IdPrompt, IdRule,
    Mode, Premise, Variant,
};
use neophylo_core::exercise::{load_exercise, Exercise, ExerciseData};
use neophylo_core::reading::load_reading_set;
use neophylo_core::NeoError;

fn exercises_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("exercises")
}

fn lesson_text(id: &str) -> String {
    fs::read_to_string(exercises_dir().join(format!("{id}.json")))
        .unwrap_or_else(|e| panic!("{id}: {e}"))
}

fn lesson(id: &str) -> Exercise {
    load_exercise(&lesson_text(id)).unwrap_or_else(|e| panic!("{id}: {e}"))
}

fn lesson_content(id: &str) -> Content {
    Content::Exercise(lesson(id))
}

fn reading_content(file: &str) -> Content {
    let text = fs::read_to_string(exercises_dir().join("reading").join(file))
        .unwrap_or_else(|e| panic!("{file}: {e}"));
    Content::Reading(load_reading_set(&text).unwrap_or_else(|e| panic!("{file}: {e}")))
}

fn assignment(content: Content, variation: bool) -> Assignment {
    Assignment {
        id: "asst-1".to_string(),
        title: "t".to_string(),
        instructions: None,
        content,
        id_prompt: IdPrompt {
            label: "Student ID".to_string(),
            rule: IdRule::TrimLower,
        },
        mode: Mode::Practice,
        variation,
        tasks: Vec::new(),
    }
}

// --- student-id normalisation -------------------------------------------------

#[test]
fn normalisation_is_stable() {
    // Review Focus 2: the same person typing their ID differently
    // lands on the same variant.
    let a = normalise_id(" Ana.Lopez@Uni.edu ", IdRule::TrimLower).unwrap();
    let b = normalise_id("ana.lopez@uni.edu", IdRule::TrimLower).unwrap();
    assert_eq!(a, "ana.lopez@uni.edu");
    assert_eq!(a, b);
    assert_eq!(
        variant_seed("asst-1", &a),
        variant_seed("asst-1", &b),
        "id spellings that differ only by case or padding must share a variant",
    );
    // Unicode letters are valid ids — only empty-after-trim is refused.
    assert_eq!(normalise_id("  josé ", IdRule::TrimLower).unwrap(), "josé");
    match normalise_id("   ", IdRule::TrimLower) {
        Err(NeoError::InvalidAssignment { field, .. }) => assert_eq!(field, "student_id"),
        other => panic!("expected InvalidAssignment, got {other:?}"),
    }
}

// --- determinism --------------------------------------------------------------

#[test]
fn same_assignment_and_id_gives_identical_variant() {
    for id in [
        "bootstrap-basics",
        "nj-basics",
        "nj-by-hand",
        "upgma-vs-nj-matrix",
    ] {
        let a = assignment(lesson_content(id), true);
        let v1 = a.variant_for("student-7").unwrap();
        let v2 = a.variant_for("student-7").unwrap();
        assert_eq!(v1, v2, "{id}: the same id must reproduce its variant");
    }
}

#[test]
fn different_ids_differ_on_every_simulated_lesson() {
    for id in [
        "bootstrap-basics",
        "nj-basics",
        "protein-models",
        "saturation",
        "upgma-fails",
    ] {
        let a = assignment(lesson_content(id), true);
        let v1 = a.variant_for("student-1").unwrap();
        let v2 = a.variant_for("student-2").unwrap();
        assert_ne!(
            v1.content, v2.content,
            "{id}: two ids must not share simulated content"
        );
    }
}

#[test]
fn simulated_variant_relabels_within_the_exercise_taxa() {
    use neophylo_core::newick::parse_newick;
    let base = lesson("nj-basics");
    let ExerciseData::Simulated {
        true_tree: base_tree,
        ..
    } = &base.data
    else {
        panic!("nj-basics is simulated")
    };
    let base_labels = parse_newick(base_tree).unwrap().leaf_labels();
    let mut found = false;
    for k in 0..40 {
        let seed = variant_seed("asst-1", &format!("student-{k}"));
        let Variant {
            content: Content::Exercise(v),
            ..
        } = make_variant(&Content::Exercise(base.clone()), &base.premises, seed, true).unwrap()
        else {
            panic!("exercise content");
        };
        let ExerciseData::Simulated { true_tree, .. } = &v.data else {
            panic!("nj-basics stays simulated");
        };
        let labels = parse_newick(true_tree).unwrap().leaf_labels();
        // A permutation of the exercise's own taxon names — no new
        // names, none lost.
        let mut sorted = labels.clone();
        sorted.sort();
        let mut base_sorted = base_labels.clone();
        base_sorted.sort();
        assert_eq!(sorted, base_sorted);
        if labels != base_labels {
            found = true;
        }
    }
    assert!(found, "40 seeds must produce at least one real relabel");
}

// --- retry and fallback -------------------------------------------------------

#[test]
fn impossible_premise_falls_back_to_base() {
    // upgma-fails runs UPGMA — the chosen pair is always the raw
    // closest, so `closest_pair_not_first` can never hold.
    let base = lesson_content("upgma-fails");
    let v = make_variant(
        &base,
        &[Premise::ClosestPairNotFirst],
        variant_seed("asst-1", "student-1"),
        true,
    )
    .unwrap();
    assert!(v.fell_back);
    assert_eq!(v.retry, 0);
    assert_eq!(v.content, base);
}

#[test]
fn inapplicable_premise_is_invalid_not_false() {
    // A premise that cannot apply to the content kind is
    // `InvalidAssignment`, never silently "not held".
    let tie_free = premises_hold(&reading_content("trees-demo.json"), &[Premise::TieFree]);
    assert!(matches!(tie_free, Err(NeoError::InvalidAssignment { .. })));
    let reading_valid = premises_hold(&lesson_content("nj-basics"), &[Premise::ReadingValid]);
    assert!(matches!(
        reading_valid,
        Err(NeoError::InvalidAssignment { .. })
    ));
    // `nj_recovers_true_tree` on a matrix without a true reference.
    let nj_recovers = premises_hold(
        &lesson_content("nj-by-hand"),
        &[Premise::NjRecoversTrueTree],
    );
    assert!(matches!(
        nj_recovers,
        Err(NeoError::InvalidAssignment { .. })
    ));
}

#[test]
fn declared_premises_hold_on_base_variants() {
    // Every built-in premise declaration is already true of its own
    // base content — retry 0 for every attempt-0 seed.
    assert!(premises_hold(
        &lesson_content("nj-by-hand"),
        &[Premise::TieFree, Premise::ClosestPairNotFirst],
    )
    .unwrap());
    assert!(premises_hold(
        &lesson_content("upgma-vs-nj-matrix"),
        &[Premise::NjRecoversTrueTree, Premise::UpgmaDiffersFromNj],
    )
    .unwrap());
    for f in [
        "trees-clades-traits.json",
        "trees-closest-relatives.json",
        "trees-demo.json",
        "trees-form-a.json",
        "trees-form-b.json",
        "trees-reading-a-tree.json",
        "trees-rotation.json",
    ] {
        assert!(
            premises_hold(&reading_content(f), &[Premise::ReadingValid]).unwrap(),
            "{f}: the base reading set validates",
        );
    }
}

#[test]
fn vary_false_returns_base_with_seed() {
    let base = lesson_content("nj-basics");
    let seed = variant_seed("asst-1", "student-1");
    let v = make_variant(&base, &[], seed, false).unwrap();
    assert_eq!(v.content, base);
    assert!(!v.fell_back);
    assert_eq!(v.retry, 0);
    assert_eq!(v.seed, seed, "vary=false still carries the bootstrap seed");
}

// --- premises wiring on the exercise file ------------------------------------

#[test]
fn premises_parse_on_v5_exercises() {
    assert_eq!(
        lesson("nj-by-hand").premises,
        vec![Premise::TieFree, Premise::ClosestPairNotFirst]
    );
    assert_eq!(
        lesson("upgma-vs-nj-matrix").premises,
        vec![Premise::NjRecoversTrueTree, Premise::UpgmaDiffersFromNj]
    );
    // Lessons without the key default to empty.
    assert_eq!(lesson("nj-basics").premises, Vec::new());
}

#[test]
fn premises_is_presence_aware_on_exercises() {
    let base = lesson_text("nj-by-hand");
    let swap = |from: &str, to: &str| base.replacen(from, to, 1);

    for (case, want) in [
        (
            swap(
                "\"premises\": [\"tie_free\", \"closest_pair_not_first\"]",
                "\"premises\": null",
            ),
            "premises must be an array, not null",
        ),
        (
            swap(
                "\"premises\": [\"tie_free\", \"closest_pair_not_first\"]",
                "\"premises\": \"tie_free\"",
            ),
            "premises must be an array",
        ),
        (
            swap("\"tie_free\"", "5"),
            "premises element must be a string",
        ),
        (
            swap("\"tie_free\"", "\"no_such_premise\""),
            "unknown premise",
        ),
        (
            swap("\"closest_pair_not_first\"", "\"tie_free\""),
            "duplicate premise",
        ),
    ] {
        match load_exercise(&case) {
            Err(NeoError::InvalidExercise { field, msg }) => {
                assert_eq!(field, "premises", "{case}: wrong field");
                assert!(msg.contains(want), "{case}: '{want}' not in '{msg}'");
            }
            other => panic!("{case}: expected InvalidExercise, got {other:?}"),
        }
    }
}

#[test]
fn premises_is_v5_only_on_exercises() {
    // A `premises` key in a schema_version < 5 file is the version
    // error, like `meta`.
    let v2 = r#"{
        "schema_version": 2, "id": "x", "title": "x", "alphabet": "dna",
        "data": {"kind": "embedded", "fasta": ">a\nACGT\n>b\nACGT\n>c\nAGGT\n",
                 "source": {"citation": "c", "license": "l", "accessions": []}},
        "analysis": {"correction": "p-distance", "method": "nj"},
        "premises": ["tie_free"]
    }"#;
    match load_exercise(v2) {
        Err(NeoError::InvalidExercise { field, msg }) => {
            assert_eq!(field, "premises");
            assert!(msg.contains("schema_version 5"), "{msg}");
        }
        other => panic!("expected the v5-only error, got {other:?}"),
    }
    // And in a v1 file.
    let v1 = r#"{
        "schema_version": 1, "id": "x", "title": "x",
        "true_tree": "(a:1,b:1,c:1);",
        "sim": {"model": "Jc69", "length": 100, "seed": 1},
        "analysis": {"correction": "p-distance", "method": "nj"},
        "premises": ["tie_free"]
    }"#;
    match load_exercise(v1) {
        Err(NeoError::InvalidExercise { field, msg }) => {
            assert_eq!(field, "premises");
            assert!(msg.contains("schema_version 5"), "{msg}");
        }
        other => panic!("expected the v5-only error, got {other:?}"),
    }
}

#[test]
fn exercises_without_premises_serialize_unchanged() {
    // `skip_serializing_if = "Vec::is_empty"`: a lesson that never
    // declared premises must not gain a `premises` key on export.
    for id in ["nj-basics", "cytochrome-c", "saturation"] {
        let json = serde_json::to_string(&lesson(id)).unwrap();
        assert!(
            !json.contains("\"premises\""),
            "{id}: an absent key must stay absent"
        );
    }
    // And one that declares them round-trips.
    let json = serde_json::to_string(&lesson("nj-by-hand")).unwrap();
    assert!(json.contains("\"premises\":[\"tie_free\",\"closest_pair_not_first\"]"));
}

// --- premises wiring on reading sets ------------------------------------------

#[test]
fn premises_parse_on_reading_sets() {
    for f in [
        "trees-clades-traits.json",
        "trees-closest-relatives.json",
        "trees-demo.json",
        "trees-form-a.json",
        "trees-form-b.json",
        "trees-reading-a-tree.json",
        "trees-rotation.json",
    ] {
        let Content::Reading(set) = reading_content(f) else {
            panic!("reading content")
        };
        assert_eq!(set.premises, vec![Premise::ReadingValid], "{f}");
    }
}

#[test]
fn premises_is_presence_aware_on_reading_sets() {
    let text = fs::read_to_string(exercises_dir().join("reading/trees-demo.json")).unwrap();
    // serde does not treat a missing key and a null alike here: `take`
    // keeps the file's shape, so a present null is refused by the
    // loader's own rule.
    for (case, want) in [
        (text.replacen("\"reading_valid\"", "5", 1), "premises"),
        (
            text.replacen("[\"reading_valid\"]", "\"reading_valid\"", 1),
            "premises",
        ),
        (
            text.replacen("\"reading_valid\"", "\"bogus\"", 1),
            "premises",
        ),
        (
            text.replacen("\"premises\": [\"reading_valid\"]", "\"premises\": null", 1),
            "premises",
        ),
        (
            text.replacen(
                "[\"reading_valid\"]",
                "[\"reading_valid\", \"reading_valid\"]",
                1,
            ),
            "premises",
        ),
    ] {
        match load_reading_set(&case) {
            Err(NeoError::InvalidReading { field, msg, .. }) => {
                assert_eq!(field, want, "{case}: wrong field");
                assert!(!msg.is_empty());
            }
            other => panic!("{case}: expected InvalidReading, got {other:?}"),
        }
    }
}
