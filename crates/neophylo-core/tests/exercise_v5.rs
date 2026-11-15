//! Exercise schema v5 (v1.4c spec §4): `data.kind = "matrix"` — a
//! supplied distance matrix — and optional lesson metadata `meta`,
//! both valid only in `schema_version` 5 files. On a matrix exercise
//! `analysis` holds `method` only: the loader sets `correction` to
//! `DistModel::Supplied`, and a file `correction` (any spelling),
//! `kappa`, `site_filter`, a top-level `bootstrap` and any
//! `predict_branch` prompt are refused at their own paths. Schema 1–4
//! files load unchanged and serialize without the new keys.
//!
//! `meta` and the matrix branch's fields are parsed presence-aware
//! (the serde null/array gap, same rule as the v3/v4 keys): a
//! `"meta": null` in a v4 file is the version error, and in a v5 file
//! a null or non-object `meta`/`names`/`lower`/`source` is refused at
//! its own field.

use neophylo_core::dist::DistModel;
use neophylo_core::error::NeoError;
use neophylo_core::exercise::{
    load_exercise, Exercise, ExerciseData, ExerciseMeta, Level, CURRENT_SCHEMA_VERSION,
};

/// A v5 shell: `{0}` the data object, `{1}` the analysis object, `{2}`
/// the prompts array, `{3}` extra top-level keys.
fn v5(data: &str, analysis: &str, prompts: &str, extra: &str) -> String {
    format!(
        r#"{{
  "schema_version": 5,
  "id": "v5",
  "title": "Schema 5",
  "alphabet": "dna",
  "data": {data},
  "analysis": {analysis},
  "locked": [],
  "prompts": {prompts}{extra}
}}"#
    )
}

/// A matrix `data` object: `{0}` the `names` array, `{1}` the `lower`
/// array.
fn matrix(names: &str, lower: &str) -> String {
    format!(
        r#"{{ "kind": "matrix", "names": {names}, "lower": {lower},
             "source": {{ "citation": "test", "license": "CC0", "accessions": [] }} }}"#
    )
}

const NAMES4: &str = r#"["A","B","C","D"]"#;
const LOWER4: &str = "[0.2,0.3,0.4,0.5,0.6,0.7]";
const NJ_ONLY: &str = r#"{ "method": "NJ" }"#;
const NJ_JC69: &str = r#"{ "correction": "JC69", "method": "NJ" }"#;
const SIM_DATA: &str = r#"{
  "kind": "simulated",
  "true_tree": "((A:0.1,B:0.2):0.05,C:0.3);",
  "sim": { "model": "JC69", "length": 100, "seed": 7 }
}"#;

/// `(field, msg)` of an `InvalidExercise`; panics on anything else.
fn invalid(err: &NeoError) -> (String, String) {
    match err {
        NeoError::InvalidExercise { field, msg } => (field.clone(), msg.clone()),
        other => panic!("expected InvalidExercise, got {other:?}"),
    }
}

/// Rewrite the shell's declared version, for the older-version gates.
fn as_version(json: &str, v: u32) -> String {
    json.replacen(
        r#""schema_version": 5"#,
        &format!(r#""schema_version": {v}"#),
        1,
    )
}

// --- data.kind = "matrix" loads -----------------------------------------

#[test]
fn matrix_exercise_loads_with_supplied_correction() {
    // The file omits `correction` entirely — analysis holds only
    // `method` — and the loader supplies `DistModel::Supplied` (plan:
    // "the loader sets correction to Supplied").
    for method in ["NJ", "UPGMA"] {
        let json = v5(
            &matrix(NAMES4, LOWER4),
            &format!(r#"{{ "method": "{method}" }}"#),
            "[]",
            "",
        );
        let ex = load_exercise(&json).unwrap();
        assert_eq!(ex.schema_version, 5);
        assert_eq!(ex.analysis.correction, DistModel::Supplied);
        assert_eq!(ex.analysis.kappa, None);
        assert_eq!(ex.analysis.site_filter, None);
        match &ex.data {
            ExerciseData::Matrix {
                names,
                lower,
                source,
            } => {
                assert_eq!(names, &["A", "B", "C", "D"]);
                assert_eq!(lower.len(), 6);
                assert_eq!(source.license, "CC0");
            }
            other => panic!("expected Matrix data, got {other:?}"),
        }
    }
}

#[test]
fn matrix_names_are_the_labels_for_reference_and_prompts() {
    // A reference whose leaves match `names` loads; one that does not
    // is the same LabelMismatch an alignment mismatch gives. A
    // reveal_pair may name matrix taxa.
    let json = v5(
        &matrix(NAMES4, LOWER4),
        NJ_ONLY,
        r#"[{ "type": "predict_pair", "at_step": 1, "concept": "c",
              "reveal_pair": ["A", "B"] }]"#,
        r#", "reference": { "newick": "((A,B),(C,D));", "kind": "true" }"#,
    );
    load_exercise(&json).unwrap();

    let bad = json.replace(
        r#""newick": "((A,B),(C,D));""#,
        r#""newick": "((A,B),(C,Z));""#,
    );
    match load_exercise(&bad).unwrap_err() {
        NeoError::LabelMismatch { .. } => {}
        other => panic!("expected LabelMismatch, got {other:?}"),
    }

    let bad_pair = json.replace(
        r#""reveal_pair": ["A", "B"]"#,
        r#""reveal_pair": ["A", "Z"]"#,
    );
    let (field, _) = invalid(&load_exercise(&bad_pair).unwrap_err());
    assert_eq!(field, "prompts.0.reveal_pair");
}

// --- keys a matrix exercise refuses -------------------------------------

#[test]
fn matrix_refuses_any_correction_key() {
    // Any correction spelling — including the wire spellings
    // "Supplied"/"supplied" — is refused at analysis.correction: the
    // matrix IS the correction (plan + Task 3 pin). A null key is a
    // present key.
    for c in [r#""JC69""#, r#""Supplied""#, r#""supplied""#, "null"] {
        let json = v5(
            &matrix(NAMES4, LOWER4),
            &format!(r#"{{ "correction": {c}, "method": "NJ" }}"#),
            "[]",
            "",
        );
        let (field, _) = invalid(&load_exercise(&json).unwrap_err());
        assert_eq!(field, "analysis.correction", "correction {c}");
    }
}

#[test]
fn matrix_refuses_kappa_site_filter_and_bootstrap() {
    let json = v5(
        &matrix(NAMES4, LOWER4),
        r#"{ "method": "NJ", "kappa": 2.0 }"#,
        "[]",
        "",
    );
    let (field, _) = invalid(&load_exercise(&json).unwrap_err());
    assert_eq!(field, "analysis.kappa");

    let json = v5(
        &matrix(NAMES4, LOWER4),
        r#"{ "method": "NJ", "site_filter": { "kind": "complete" } }"#,
        "[]",
        "",
    );
    let (field, _) = invalid(&load_exercise(&json).unwrap_err());
    assert_eq!(field, "analysis.site_filter");

    let json = v5(
        &matrix(NAMES4, LOWER4),
        NJ_ONLY,
        "[]",
        r#", "bootstrap": { "replicates": 100, "seed": 1 }"#,
    );
    let (field, _) = invalid(&load_exercise(&json).unwrap_err());
    assert_eq!(field, "bootstrap");
}

#[test]
fn matrix_refuses_predict_branch_prompts() {
    // There is no bootstrap stage on a matrix exercise (spec §4.1).
    let json = v5(
        &matrix(NAMES4, LOWER4),
        NJ_ONLY,
        r#"[{ "type": "predict_branch", "at": "bootstrap", "concept": "c" }]"#,
        "",
    );
    let (field, _) = invalid(&load_exercise(&json).unwrap_err());
    assert_eq!(field, "prompts.0.type");
}

// --- the matrix branch requires schema_version 5 -------------------------

#[test]
fn matrix_data_requires_schema_version_5() {
    let json = v5(&matrix(NAMES4, LOWER4), NJ_ONLY, "[]", "");
    for v in [2, 3, 4] {
        let (field, msg) = invalid(&load_exercise(&as_version(&json, v)).unwrap_err());
        assert_eq!(field, "data.kind", "v{v}");
        assert!(msg.contains("requires schema_version 5"), "v{v}: {msg}");
    }
}

// --- data.names / data.lower validation ---------------------------------

#[test]
fn matrix_lower_shape_refusals_name_data_lower() {
    // Wrong length, a negative value, a null element, a null `lower`
    // and a non-array `lower` are all refused at data.lower — the path
    // schema.json reports (plan Step 1).
    for lower in [
        "[0.2,0.3,0.4,0.5,0.6]",         // one short of n·(n−1)/2 = 6
        "[0.2,0.3,0.4,0.5,0.6,0.7,0.8]", // one long
        "[0.2,-0.1,0.4,0.5,0.6,0.7]",    // negative cell
        "[0.2,null,0.4,0.5,0.6,0.7]",    // null element
        "null",
        "{}",
        "\"abc\"",
    ] {
        let json = v5(&matrix(NAMES4, lower), NJ_ONLY, "[]", "");
        let (field, _) = invalid(&load_exercise(&json).unwrap_err());
        assert_eq!(field, "data.lower", "lower {lower}");
    }
}

#[test]
fn matrix_name_refusals_name_data_names() {
    // Duplicate, empty and non-string names, a null `names` and a
    // two-taxon file all report data.names.
    for (names, lower) in [
        (r#"["A","B","A","D"]"#, LOWER4),
        (r#"["A","B","","D"]"#, LOWER4),
        (r#"["A","B",3,"D"]"#, LOWER4),
        ("null", LOWER4),
        ("{}", LOWER4),
        (r#"["A","B"]"#, "[0.2]"),
    ] {
        let json = v5(&matrix(names, lower), NJ_ONLY, "[]", "");
        let (field, _) = invalid(&load_exercise(&json).unwrap_err());
        assert_eq!(field, "data.names", "names {names}");
    }
}

#[test]
fn matrix_source_must_be_an_object() {
    // The serde struct-from-seq gap: `source: ["t","CC0",[]]` would
    // deserialize a derived struct; schema.json types it object.
    for source in ["[]", r#"["t","CC0",[]]"#, "null", "\"x\""] {
        let data = format!(
            r#"{{ "kind": "matrix", "names": {NAMES4}, "lower": {LOWER4},
                 "source": {source} }}"#
        );
        let json = v5(&data, NJ_ONLY, "[]", "");
        let (field, _) = invalid(&load_exercise(&json).unwrap_err());
        assert_eq!(field, "data.source", "source {source}");
    }
}

#[test]
fn supplied_is_not_a_file_correction_on_alignment_data() {
    // On non-matrix data a file `correction` of "Supplied" is refused
    // (plan); the Task 3 pin covers the v1 path, this covers v5.
    for spelling in ["Supplied", "supplied"] {
        let json = v5(
            SIM_DATA,
            &format!(r#"{{ "correction": "{spelling}", "method": "NJ" }}"#),
            "[]",
            "",
        );
        let (field, _) = invalid(&load_exercise(&json).unwrap_err());
        assert_eq!(field, "analysis.correction", "spelling {spelling}");
    }
}

// --- meta loads ----------------------------------------------------------

#[test]
fn meta_loads_on_matrix_and_alignment_exercises() {
    let meta = r#", "meta": {
      "objectives": ["join by hand", "read Q"],
      "minutes": 20,
      "level": "intro",
      "prepares_for": ["nj-basics", "dnadist-neighbor"],
      "hand_steps": 2
    }"#;
    for (data, analysis) in [
        (matrix(NAMES4, LOWER4), NJ_ONLY),
        (SIM_DATA.to_string(), NJ_JC69),
    ] {
        let json = v5(&data, analysis, "[]", meta);
        let ex = load_exercise(&json).unwrap();
        assert_eq!(
            ex.meta,
            Some(ExerciseMeta {
                objectives: vec!["join by hand".to_string(), "read Q".to_string()],
                minutes: 20,
                level: Level::Intro,
                prepares_for: vec!["nj-basics".to_string(), "dnadist-neighbor".to_string()],
                hand_steps: Some(2),
            })
        );
    }
}

#[test]
fn meta_levels_load() {
    for (spelling, want) in [
        ("intro", Level::Intro),
        ("intermediate", Level::Intermediate),
        ("advanced", Level::Advanced),
    ] {
        let meta = format!(
            r#", "meta": {{ "objectives": [], "minutes": 5,
                  "level": "{spelling}", "prepares_for": [] }}"#
        );
        let json = v5(SIM_DATA, NJ_JC69, "[]", &meta);
        let ex = load_exercise(&json).unwrap();
        assert_eq!(ex.meta.unwrap().level, want, "level {spelling}");
    }
}

#[test]
fn meta_hand_steps_is_optional() {
    let meta = r#", "meta": { "objectives": [], "minutes": 5,
      "level": "advanced", "prepares_for": [] }"#;
    let json = v5(SIM_DATA, NJ_JC69, "[]", meta);
    let ex = load_exercise(&json).unwrap();
    assert_eq!(ex.meta.as_ref().unwrap().hand_steps, None);
}

#[test]
fn prepares_for_ids_are_not_validated_by_the_loader() {
    // Id existence is a repo test's job (Task 10), not the loader's.
    let meta = r#", "meta": { "objectives": [], "minutes": 5,
      "level": "intro", "prepares_for": ["no-such-lesson", "no-such-lab"] }"#;
    let json = v5(SIM_DATA, NJ_JC69, "[]", meta);
    let ex = load_exercise(&json).unwrap();
    assert_eq!(
        ex.meta.unwrap().prepares_for,
        ["no-such-lesson", "no-such-lab"]
    );
}

// --- meta requires schema_version 5 ---------------------------------------

#[test]
fn meta_requires_schema_version_5() {
    // Presence alone trips the gate — an explicit null in an old file
    // is the version error, never "absent" (schema.json counts a null
    // key as present).
    for v in [2, 3, 4] {
        for meta in [
            r#", "meta": { "objectives": [], "minutes": 5, "level": "intro", "prepares_for": [] }"#,
            r#", "meta": null"#,
        ] {
            let json = as_version(&v5(SIM_DATA, NJ_JC69, "[]", meta), v);
            let (field, msg) = invalid(&load_exercise(&json).unwrap_err());
            assert_eq!(field, "meta", "v{v} meta {meta}");
            assert!(
                msg.contains("requires schema_version 5"),
                "v{v} meta {meta}: msg {msg}"
            );
        }
    }
}

// --- meta field refusals --------------------------------------------------

#[test]
fn meta_must_be_an_object() {
    // `null` and `[]` in a v5 file: serde's struct-from-seq would
    // otherwise read an array into the derived struct; schema.json
    // types meta `object`.
    for meta in ["null", "[]", "\"intro\"", "20"] {
        let json = v5(SIM_DATA, NJ_JC69, "[]", &format!(r#", "meta": {meta}"#));
        let (field, _) = invalid(&load_exercise(&json).unwrap_err());
        assert_eq!(field, "meta", "meta {meta}");
    }
}

#[test]
fn meta_field_refusals_name_the_field() {
    let base = |key: &str, value: &str| -> String {
        let meta = format!(
            r#", "meta": {{ "objectives": [], "minutes": 5, "level": "intro",
                  "prepares_for": [], {key}: {value} }}"#
        );
        v5(SIM_DATA, NJ_JC69, "[]", &meta)
    };
    for (json, field) in [
        (base(r#""minutes""#, "0"), "meta.minutes"),
        (base(r#""minutes""#, "1.5"), "meta.minutes"),
        (base(r#""minutes""#, "\"20\""), "meta.minutes"),
        (base(r#""minutes""#, "null"), "meta.minutes"),
        (base(r#""level""#, "\"expert\""), "meta.level"),
        (base(r#""level""#, "\"Intro\""), "meta.level"),
        (base(r#""level""#, "null"), "meta.level"),
        (base(r#""objectives""#, "null"), "meta.objectives"),
        (base(r#""objectives""#, "\"x\""), "meta.objectives"),
        (base(r#""objectives""#, "[1,2]"), "meta.objectives"),
        (base(r#""prepares_for""#, "null"), "meta.prepares_for"),
        (base(r#""prepares_for""#, "\"x\""), "meta.prepares_for"),
        (base(r#""prepares_for""#, "[1,2]"), "meta.prepares_for"),
        (base(r#""hand_steps""#, "0"), "meta.hand_steps"),
        (base(r#""hand_steps""#, "null"), "meta.hand_steps"),
        (base(r#""hand_steps""#, "\"2\""), "meta.hand_steps"),
        (base(r#""hand_steps""#, "2.5"), "meta.hand_steps"),
    ] {
        let (f, _) = invalid(&load_exercise(&json).unwrap_err());
        assert_eq!(f, field, "{json}");
    }
}

#[test]
fn meta_missing_required_keys_name_the_key() {
    for (meta, field) in [
        (
            r#"{ "minutes": 5, "level": "intro", "prepares_for": [] }"#,
            "meta.objectives",
        ),
        (
            r#"{ "objectives": [], "level": "intro", "prepares_for": [] }"#,
            "meta.minutes",
        ),
        (
            r#"{ "objectives": [], "minutes": 5, "prepares_for": [] }"#,
            "meta.level",
        ),
        (
            r#"{ "objectives": [], "minutes": 5, "level": "intro" }"#,
            "meta.prepares_for",
        ),
    ] {
        let json = v5(SIM_DATA, NJ_JC69, "[]", &format!(r#", "meta": {meta}"#));
        let (f, _) = invalid(&load_exercise(&json).unwrap_err());
        assert_eq!(f, field, "meta {meta}");
    }
}

// --- versions and round trips --------------------------------------------

#[test]
fn v5_matrix_and_meta_serde_round_trip() {
    let json = v5(
        &matrix(NAMES4, LOWER4),
        NJ_ONLY,
        "[]",
        r#", "meta": { "objectives": ["a"], "minutes": 10,
              "level": "intermediate", "prepares_for": ["nj-basics"],
              "hand_steps": 1 }"#,
    );
    let ex: Exercise = load_exercise(&json).unwrap();
    let s = serde_json::to_string(&ex).unwrap();
    assert!(s.contains(r#""kind":"matrix""#), "serialized exercise: {s}");
    assert!(
        s.contains(r#""meta":{"objectives":["a"]"#),
        "serialized: {s}"
    );
    let back: Exercise = serde_json::from_str(&s).unwrap();
    assert_eq!(ex, back);
}

#[test]
fn current_schema_version_is_5() {
    assert_eq!(CURRENT_SCHEMA_VERSION, 5);
}

#[test]
fn repo_exercises_load_and_reserialize_unchanged() {
    // Every committed exercise (v2 lessons, v3 and v4 labs) loads and
    // re-serializes as before — no meta key appears when none was
    // declared.
    for (name, text) in [
        (
            "bootstrap-basics",
            include_str!("../../../exercises/bootstrap-basics.json"),
        ),
        (
            "cytochrome-c",
            include_str!("../../../exercises/cytochrome-c.json"),
        ),
        (
            "nj-basics",
            include_str!("../../../exercises/nj-basics.json"),
        ),
        (
            "protein-models",
            include_str!("../../../exercises/protein-models.json"),
        ),
        (
            "saturation",
            include_str!("../../../exercises/saturation.json"),
        ),
        (
            "upgma-fails",
            include_str!("../../../exercises/upgma-fails.json"),
        ),
        (
            "labs/dnadist-neighbor",
            include_str!("../../../exercises/labs/dnadist-neighbor.json"),
        ),
        (
            "labs/mega-bootstrap-100",
            include_str!("../../../exercises/labs/mega-bootstrap-100.json"),
        ),
        (
            "labs/mega-interpreting-support",
            include_str!("../../../exercises/labs/mega-interpreting-support.json"),
        ),
        (
            "labs/mega-jc69-vs-k2p",
            include_str!("../../../exercises/labs/mega-jc69-vs-k2p.json"),
        ),
        (
            "labs/mega-nj-vs-upgma",
            include_str!("../../../exercises/labs/mega-nj-vs-upgma.json"),
        ),
        (
            "labs/protdist-neighbor",
            include_str!("../../../exercises/labs/protdist-neighbor.json"),
        ),
        (
            "labs/seqboot-consense",
            include_str!("../../../exercises/labs/seqboot-consense.json"),
        ),
    ] {
        let ex = load_exercise(text).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(ex.meta.is_none(), "{name}");
        let s = serde_json::to_string(&ex).unwrap();
        let doc: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert!(
            doc.get("meta").is_none(),
            "{name}: serialized exercise carries meta: {s}"
        );
        let back: Exercise = serde_json::from_str(&s).unwrap();
        assert_eq!(ex, back, "{name}");
    }
}
