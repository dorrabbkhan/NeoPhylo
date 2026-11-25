//! Assignment variants (v1.5 spec §5.2, plan Task 4): student-id
//! normalisation, seeded content transforms, premise retry with
//! `fell_back`, and the `premises` key wiring on exercise and reading
//! files (presence-aware like `meta`, v5-only on exercises).

use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use neophylo_core::assess::{
    make_variant, name_table, normalise_id, premises_hold, task_key, variant_seed, AcceptedAnswer,
    Assignment, Content, IdPrompt, IdRule, Mode, Premise, TaskRef, Variant,
};
use neophylo_core::exercise::{load_exercise, Exercise, ExerciseBootstrap, ExerciseData};
use neophylo_core::matrix_input::additive_matrix;
use neophylo_core::newick::parse_newick;
use neophylo_core::reading::load_reading_set;
use neophylo_core::seq::Alignment;
use neophylo_core::sim::{simulate, MAX_SEED};
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

fn lab_content(id: &str) -> Content {
    let text = fs::read_to_string(exercises_dir().join("labs").join(format!("{id}.json")))
        .unwrap_or_else(|e| panic!("{id}: {e}"));
    Content::Exercise(load_exercise(&text).unwrap_or_else(|e| panic!("{id}: {e}")))
}

/// The premises declared on a loaded content file.
fn declared(content: &Content) -> &[Premise] {
    match content {
        Content::Exercise(ex) => &ex.premises,
        Content::Reading(set) => &set.premises,
    }
}

/// Strip the injected `bootstrap` block so a served variant compares
/// equal to the base it grew from.
fn without_bootstrap(content: &Content) -> Content {
    let mut c = content.clone();
    if let Content::Exercise(ex) = &mut c {
        ex.bootstrap = None;
    }
    c
}

fn assignment(content: Content, variation: bool) -> Assignment {
    Assignment {
        id: "asst-1".to_string(),
        title: "t".to_string(),
        instructions: None,
        content,
        content_hash: None,
        served_content_hash: None,
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
    let seed = variant_seed("asst-1", "student-1");
    let v = make_variant(&base, &[Premise::ClosestPairNotFirst], seed, true).unwrap();
    assert!(v.fell_back);
    assert_eq!(v.retry, 0);
    assert_eq!(v.seed, seed & MAX_SEED);
    // The base content is served — apart from the injected
    // per-student bootstrap block (upgma-fails is simulated).
    let Content::Exercise(served) = &v.content else {
        panic!("exercise")
    };
    assert_eq!(
        served.bootstrap,
        Some(ExerciseBootstrap {
            replicates: 100,
            seed: seed & MAX_SEED,
        }),
    );
    assert_eq!(without_bootstrap(&v.content), base);
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
    assert!(!v.fell_back);
    assert_eq!(v.retry, 0);
    assert_eq!(
        v.seed,
        seed & MAX_SEED,
        "vary=false still carries the (JS-safe) bootstrap seed"
    );
    // "The base with the bootstrap seed only" (plan): nj-basics is
    // simulated, so the injected block is the single change.
    let Content::Exercise(served) = &v.content else {
        panic!("exercise")
    };
    assert_eq!(
        served.bootstrap,
        Some(ExerciseBootstrap {
            replicates: 100,
            seed: seed & MAX_SEED,
        }),
    );
    assert_eq!(without_bootstrap(&v.content), base);
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

// --- derived-matrix variants are exactly additive ------------------------------

#[test]
fn derived_matrix_variants_are_exactly_additive() {
    // Fix round 1: a derived variant's `lower` is the exact
    // path-length matrix of its own reference tree — the branch
    // lengths are rounded to the author's decimals at generation, so
    // the lesson note "every distance in the cells is the exact path
    // between two tips of that tree" stays true and the reference
    // panel shows the author's decimals, not long binary tails.
    let base = lesson_content("upgma-vs-nj-matrix");
    let Content::Exercise(base_ex) = &base else {
        panic!("exercise")
    };
    let ExerciseData::Matrix {
        lower: base_lower, ..
    } = &base_ex.data
    else {
        panic!("matrix exercise")
    };
    // The author's decimals for this file: the smallest d in 0..=6
    // that leaves every base `lower` value unchanged — 0 (integers).
    let d = (0..=6u8)
        .find(|d| {
            let p = 10f64.powi(i32::from(*d));
            base_lower.iter().all(|v| (v * p).round() / p == *v)
        })
        .unwrap_or(6);
    assert_eq!(d, 0, "the base file's decimals are integers");
    let p = 10f64.powi(i32::from(d));
    for k in 0..200 {
        let seed = variant_seed("asst-1", &format!("student-{k}"));
        let v = make_variant(&base, declared(&base), seed, true)
            .unwrap_or_else(|e| panic!("student-{k}: {e}"));
        let Content::Exercise(ex) = &v.content else {
            panic!("exercise")
        };
        let ExerciseData::Matrix { names, lower, .. } = &ex.data else {
            panic!("matrix exercise")
        };
        let reference = ex
            .reference
            .as_ref()
            .expect("a derived matrix variant keeps a true reference");
        let tree = parse_newick(&reference.newick).unwrap();
        // Exact additivity: the stored matrix IS the reference tree's
        // path-length matrix — `additive_matrix(_, None)` computed
        // over the serialised reference, compared with `==`. The
        // served rows sit in the seeded `names` order (owner decision
        // 2026-11-25), so `exact` is reindexed onto it first.
        let exact = additive_matrix(&tree, None).unwrap();
        let pos: Vec<usize> = names
            .iter()
            .map(|n| exact.names.iter().position(|e| e == n).unwrap())
            .collect();
        let mut want = Vec::with_capacity(lower.len());
        for j in 1..names.len() {
            for i in 0..j {
                let (a, b) = (pos[i].min(pos[j]), pos[i].max(pos[j]));
                want.push(exact.lower[b * (b - 1) / 2 + a]);
            }
        }
        assert_eq!(
            *lower, want,
            "student-{k}: the matrix must equal the reference's exact path lengths",
        );
        // Every branch length is at the author's decimals — here d ==
        // 0, so all integers; had another `d` been used, a run of 200
        // trees would show a non-integer length.
        for (i, b) in tree.branches.iter().enumerate() {
            if let Some(len) = b.length {
                assert_eq!(
                    (len * p).round() / p,
                    len,
                    "student-{k} branch {i}: {len} is not at the author's {d} decimals",
                );
            }
        }
    }
}

#[test]
fn derived_matrix_variant_serves_author_decimals() {
    // Owner decision 2026-11-25 (moved from Task 6): the variant
    // matrix is `additive_matrix(&tree, Some(d))` — the author's
    // decimals, so a path sum shows e.g. 0.3, not its binary tail.
    // An authored matrix with two-decimal values (`d = 2`): every
    // served `lower` value has at most 2 decimals and equals the
    // exact decimal path sum of the variant's reference tree.
    let ex = Exercise {
        schema_version: 5,
        id: "two-dec".to_string(),
        title: "two-dec".to_string(),
        alphabet: neophylo_core::Alphabet::Dna,
        data: ExerciseData::Matrix {
            names: vec!["a".into(), "b".into(), "c".into(), "d".into()],
            // (b,a) (c,a) (c,b) (d,a) (d,b) (d,c) — all 2-decimal.
            lower: vec![0.50, 1.25, 0.75, 2.20, 1.90, 1.10],
            source: neophylo_core::exercise::Source {
                citation: "c".into(),
                license: "l".into(),
                accessions: vec![],
            },
        },
        reference: Some(neophylo_core::exercise::Reference {
            newick: "((a:0.25,b:0.25):0.5,c:0.75,d:1.0);".to_string(),
            kind: neophylo_core::exercise::ReferenceKind::True,
        }),
        analysis: neophylo_core::exercise::Analysis {
            correction: neophylo_core::dist::DistModel::Supplied,
            method: neophylo_core::algos::Method::Nj,
            kappa: None,
            site_filter: None,
        },
        locked: vec![],
        prompts: vec![],
        bootstrap: None,
        meta: None,
        premises: vec![],
    };
    // sanity: the authored values are really at d = 2
    let base = Content::Exercise(ex.clone());
    for k in 0..40 {
        let seed = variant_seed("asst-1", &format!("student-{k}"));
        let v = make_variant(&base, &[], seed, true).unwrap_or_else(|e| panic!("student-{k}: {e}"));
        let Content::Exercise(vex) = &v.content else {
            panic!("exercise")
        };
        let ExerciseData::Matrix { names, lower, .. } = &vex.data else {
            panic!("matrix exercise")
        };
        let reference = vex
            .reference
            .as_ref()
            .expect("a derived matrix variant keeps a true reference");
        let tree = parse_newick(&reference.newick).unwrap();
        // `exact` is the reference's path matrix in the tree's leaf
        // order; the served `lower` sits in the seeded `names` order
        // (owner decision 2026-11-25), so reindex before comparing.
        let exact = additive_matrix(&tree, None).unwrap();
        let pos: Vec<usize> = names
            .iter()
            .map(|n| exact.names.iter().position(|e| e == n).unwrap())
            .collect();
        let mut exact_in_served_order = Vec::with_capacity(lower.len());
        for j in 1..names.len() {
            for i in 0..j {
                let (a, b) = (pos[i].min(pos[j]), pos[i].max(pos[j]));
                exact_in_served_order.push(exact.lower[b * (b - 1) / 2 + a]);
            }
        }
        assert_eq!(lower.len(), exact_in_served_order.len());
        for (i, (&served, &raw)) in lower.iter().zip(&exact_in_served_order).enumerate() {
            // At most 2 decimals …
            assert_eq!(
                (served * 100.0).round() / 100.0,
                served,
                "student-{k} cell {i}: {served} has more than 2 decimals",
            );
            // … and equal to the exact decimal path sum — the binary
            // path sum's `0.30000000000000004`-style noise is gone.
            assert_eq!(
                (raw * 100.0).round() / 100.0,
                served,
                "student-{k} cell {i}: {served} is not the rounded path sum of {raw}",
            );
        }
    }
}

// --- served row order is shuffled (owner decision 2026-11-25, option A) --------

#[test]
fn step1_pair_positions_vary_across_students() {
    // The bug this round fixes: `rotate` alone left the pair joined
    // at step 1 at the same matrix positions for nearly every id —
    // `nj-basics`' true tree `((A,B),(C,D),(E,F))` keeps the middle
    // cherry at positions (2,3) under any child reversal, so
    // students could share "join rows 3 and 4". The served row order
    // is now a seeded shuffle — `sim.tip_order` for simulated data,
    // a permuted `names`/`lower` for a derived matrix — so the modal
    // index pair may cover at most 40 % of 200 generated ids.
    for id in ["nj-basics", "upgma-vs-nj-matrix"] {
        let a = assignment(lesson_content(id), true);
        let mut counts: BTreeMap<(u16, u16), usize> = BTreeMap::new();
        for k in 0..200 {
            let v = a
                .variant_for(&format!("student-{k}"))
                .unwrap_or_else(|e| panic!("{id} student-{k}: {e}"));
            let AcceptedAnswer::Pairs(pairs) = task_key(&v, &TaskRef::PredictPair { step: 1 })
                .unwrap_or_else(|e| panic!("{id} student-{k}: {e}"))
            else {
                panic!("predict_pair yields pairs")
            };
            let first = *pairs.first().expect("a step-1 accepted pair");
            *counts.entry(first).or_default() += 1;
        }
        let (pair, share) = counts
            .iter()
            .max_by_key(|(_, c)| *c)
            .map(|(p, c)| (*p, *c))
            .unwrap();
        eprintln!("{id}: step-1 modal index pair {pair:?} covers {share}/200 ids");
        assert!(
            share <= 80,
            "{id}: the step-1 pair sits at {pair:?} for {share}/200 ids (> 40%) — \
             the row order is not shuffling",
        );
    }
}

#[test]
fn tip_order_reorders_rows_only() {
    // A simulated variant carries `sim.tip_order` — a permutation of
    // the variant tree's leaf labels — and the served alignment is
    // the unshuffled simulation's rows in exactly that order: the
    // (name, sequence) multiset is unchanged, the RNG stream is
    // untouched. `simulate` applies the order; the grader's name
    // table (the served matrix's label order) follows it.
    let a = assignment(lesson_content("nj-basics"), true);
    let v = a.variant_for("student-7").unwrap();
    let Content::Exercise(ex) = &v.content else {
        panic!("exercise")
    };
    let ExerciseData::Simulated { true_tree, sim } = &ex.data else {
        panic!("simulated")
    };
    let order = sim
        .tip_order
        .as_ref()
        .expect("a simulated variant carries tip_order");
    let tree = parse_newick(true_tree).unwrap();
    let mut sorted = order.clone();
    sorted.sort();
    let mut want = tree.leaf_labels();
    want.sort();
    assert_eq!(sorted, want, "tip_order must permute the leaf labels");

    let shuffled = simulate(&tree, sim).unwrap();
    let mut plain_spec = sim.clone();
    plain_spec.tip_order = None;
    let plain = simulate(&tree, &plain_spec).unwrap();
    assert_eq!(shuffled.labels, *order, "rows come out in tip_order");
    let keyed = |aln: &Alignment| {
        aln.labels
            .iter()
            .cloned()
            .zip(aln.seqs.iter().cloned())
            .collect::<Vec<_>>()
    };
    let mut a = keyed(&shuffled);
    let mut b = keyed(&plain);
    a.sort();
    b.sort();
    assert_eq!(a, b, "the same (name, sequence) rows, reordered");
    // The grader's view — the distance-matrix label order the code
    // packs against — is the same shuffled order.
    assert_eq!(name_table(&v).unwrap(), shuffled.labels);
}

// --- the per-student bootstrap block --------------------------------------------

const LAB_FILES: [&str; 7] = [
    "dnadist-neighbor",
    "mega-bootstrap-100",
    "mega-interpreting-support",
    "mega-jc69-vs-k2p",
    "mega-nj-vs-upgma",
    "protdist-neighbor",
    "seqboot-consense",
];

const READING_IDS: [&str; 7] = [
    "trees-clades-traits",
    "trees-closest-relatives",
    "trees-demo",
    "trees-form-a",
    "trees-form-b",
    "trees-reading-a-tree",
    "trees-rotation",
];

#[test]
fn every_built_in_variant_seed_survives_javascript() {
    // The seed a student sees is a TS `number`: `Variant.seed` and the
    // carried `content.bootstrap.seed` stay ≤ MAX_SEED over 1,000
    // generated ids for every assignable built-in. Alignment
    // exercises (simulated, embedded — labs included) carry the
    // block with ≤ 200 replicates; matrix exercises keep
    // `bootstrap: None`; reading sets have no block.
    let mut contents: Vec<(String, Content)> = Vec::new();
    for id in [
        "bootstrap-basics",
        "cytochrome-c",
        "nj-basics",
        "nj-by-hand",
        "protein-models",
        "saturation",
        "upgma-fails",
        "upgma-vs-nj-matrix",
    ] {
        contents.push((id.to_string(), lesson_content(id)));
    }
    for id in LAB_FILES {
        contents.push((format!("labs/{id}"), lab_content(id)));
    }
    for f in READING_IDS {
        contents.push((
            format!("reading/{f}"),
            reading_content(&format!("{f}.json")),
        ));
    }
    for (id, base) in &contents {
        for k in 0..1_000 {
            let nid = normalise_id(&format!("student-{k}"), IdRule::TrimLower).unwrap();
            let seed = variant_seed(id, &nid);
            let v = make_variant(base, declared(base), seed, true)
                .unwrap_or_else(|e| panic!("{id} student-{k}: {e}"));
            assert!(
                v.seed <= MAX_SEED,
                "{id} student-{k}: variant seed {} exceeds MAX_SEED",
                v.seed,
            );
            if let Content::Exercise(ex) = &v.content {
                match &ex.data {
                    ExerciseData::Simulated { .. } | ExerciseData::Embedded { .. } => {
                        let b = ex.bootstrap.unwrap_or_else(|| {
                            panic!("{id}: an alignment exercise carries its bootstrap block")
                        });
                        assert_eq!(
                            b.seed, v.seed,
                            "{id}: content.bootstrap.seed is the variant seed — one source",
                        );
                        assert!(
                            b.replicates <= 200,
                            "{id}: replicates {} > 200",
                            b.replicates
                        );
                    }
                    ExerciseData::Matrix { .. } => {
                        assert_eq!(
                            ex.bootstrap, None,
                            "{id}: a matrix exercise keeps bootstrap unset"
                        );
                    }
                }
            }
        }
    }
}

#[test]
fn bootstrap_basics_variant_carries_the_masked_seed() {
    // Pinned: fnv1a64("asst-1" ++ "\u{1f}" ++ "student-7") masked to
    // 53 bits — the same seed the app's bootstrap panel would read
    // from the served content.
    let a = assignment(lesson_content("bootstrap-basics"), true);
    let v = a.variant_for("student-7").unwrap();
    let Content::Exercise(ex) = &v.content else {
        panic!("exercise")
    };
    let b = ex
        .bootstrap
        .expect("an alignment exercise carries its bootstrap block");
    assert_eq!(b.seed, 7_870_652_415_814_316);
    assert_eq!(
        b.replicates, 100,
        "the base block's replicates, capped at 200"
    );
    assert_eq!(v.seed, b.seed, "Variant.seed is the same masked value");
}
