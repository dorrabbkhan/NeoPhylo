//! The assignment file format (v1.5 spec §4, plan Task 6):
//! `load_assignment` parses and validates `.neophylo-assignment.json`
//! text — `schema_version: 1`, `kind: "assignment"` — into the
//! engine's [`Assignment`]. `content` is an embedded `exercise` or
//! `reading` file, or a `builtin` reference `{builtin: <id>,
//! content_hash: <hash>}` plus the `file` text the link resolver
//! injects from the currently-served bytes; `served_content_hash` is
//! computed here so grading can flag `ContentChanged`. The serde-gap
//! rule applies: `null` and wrong container shapes are refused with
//! `InvalidAssignment` naming the field, never an anonymous serde
//! message.
//!
//! `prose_names_taxa` (owner decision 2026-11-25) reports, per prompt,
//! the taxon names student-facing text fields mention — the builder
//! warns that those names vary across student variants.

use std::fs;
use std::path::{Path, PathBuf};

use neophylo_core::assess::{
    content_hash, fingerprint, load_assignment, prose_names_taxa, Content, IdRule, Mode,
};
use neophylo_core::exercise::{load_exercise, Exercise};
use neophylo_core::NeoError;
use serde_json::{json, Value};

fn exercises_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("exercises")
}

fn file_text(path: &str) -> String {
    fs::read_to_string(exercises_dir().join(path)).unwrap_or_else(|e| panic!("{path}: {e}"))
}

fn lesson(id: &str) -> Exercise {
    let text = file_text(&format!("{id}.json"));
    load_exercise(&text).unwrap_or_else(|e| panic!("{id}: {e}"))
}

/// A valid assignment wrapping the `nj-basics` exercise file, embedded.
fn base() -> Value {
    json!({
        "schema_version": 1,
        "kind": "assignment",
        "id": "hw3",
        "title": "Homework 3",
        "content": { "exercise": serde_json::from_str::<Value>(&file_text("nj-basics.json")).unwrap() },
        "id_prompt": { "label": "Student ID", "rule": "trim_lower" },
        "mode": "practice",
        "variation": true,
        "tasks": [
            { "task": { "kind": "predict_pair", "step": 1 } },
            { "task": { "kind": "predict_pair", "step": 2 }, "points": 2 }
        ],
    })
}

/// A valid assignment referencing built-in content; `file` is the
/// served text the link resolver injects (not part of the saved
/// `.neophylo-assignment.json` — decodeAssignmentLink adds it).
fn builtin() -> Value {
    json!({
        "schema_version": 1,
        "kind": "assignment",
        "id": "hw3",
        "title": "Homework 3",
        "content": {
            "builtin": "nj-basics",
            "content_hash": content_hash(file_text("nj-basics.json").as_bytes()),
            "file": file_text("nj-basics.json")
        },
        "id_prompt": { "label": "Student ID" },
        "mode": "practice",
        "variation": true,
        "tasks": [ { "task": { "kind": "predict_pair", "step": 1 } } ],
    })
}

fn load(v: &Value) -> Result<neophylo_core::assess::Assignment, NeoError> {
    load_assignment(&serde_json::to_string(v).unwrap())
}

/// The `field` of the error, asserting `InvalidAssignment`.
fn field(e: &NeoError) -> &str {
    match e {
        NeoError::InvalidAssignment { field, .. } => field.as_str(),
        other => panic!("expected InvalidAssignment, got {other:?}"),
    }
}

#[test]
fn embedded_exercise_loads() {
    let a = load(&base()).unwrap();
    assert_eq!(a.id, "hw3");
    assert_eq!(a.title, "Homework 3");
    assert_eq!(a.instructions, None);
    assert_eq!(a.mode, Mode::Practice);
    assert!(a.variation);
    assert_eq!(a.id_prompt.label, "Student ID");
    assert_eq!(a.id_prompt.rule, IdRule::TrimLower);
    assert_eq!(a.tasks.len(), 2);
    assert_eq!(a.tasks[0].points, 1.0);
    assert_eq!(a.tasks[1].points, 2.0);
    assert_eq!(a.content_hash, None);
    assert_eq!(a.served_content_hash, None);
    match &a.content {
        Content::Exercise(ex) => assert_eq!(ex.id, "nj-basics"),
        _ => panic!("expected exercise content"),
    }
}

#[test]
fn builtin_exercise_loads_and_records_served_hash() {
    let a = load(&builtin()).unwrap();
    let want = content_hash(file_text("nj-basics.json").as_bytes());
    assert_eq!(a.content_hash.as_deref(), Some(want.as_str()));
    assert_eq!(a.served_content_hash.as_deref(), Some(want.as_str()));
    match &a.content {
        Content::Exercise(ex) => assert_eq!(ex.id, "nj-basics"),
        _ => panic!("expected exercise content"),
    }
}

#[test]
fn builtin_reading_loads() {
    let mut v = builtin();
    let content = v["content"].as_object_mut().unwrap();
    content.insert(
        "builtin".to_string(),
        json!("reading/trees-form-a".replace("reading/", "")),
    );
    content.insert(
        "content_hash".to_string(),
        json!(content_hash(
            file_text("reading/trees-form-a.json").as_bytes()
        )),
    );
    content.insert(
        "file".to_string(),
        json!(file_text("reading/trees-form-a.json")),
    );
    v["tasks"] = json!([{ "task": { "kind": "reading", "item": 0 } }]);
    let a = load(&v).unwrap();
    match &a.content {
        Content::Reading(set) => assert_eq!(set.id, "trees-form-a"),
        _ => panic!("expected reading content"),
    }
    assert!(a.served_content_hash.is_some());
}

#[test]
fn builtin_can_differ_from_served() {
    // A stale recorded hash still loads — `served_content_hash` is the
    // current file's and `grade` flags ContentChanged on the gap.
    let mut v = builtin();
    v["content"]["content_hash"] = json!("0123456789abcdef");
    let a = load(&v).unwrap();
    assert_eq!(a.content_hash.as_deref(), Some("0123456789abcdef"));
    assert_eq!(
        a.served_content_hash.as_deref(),
        Some(content_hash(file_text("nj-basics.json").as_bytes()).as_str())
    );
}

#[test]
fn tasks_cannot_be_empty() {
    let mut v = base();
    v["tasks"] = json!([]);
    assert_eq!(field(&load(&v).unwrap_err()), "tasks");
}

#[test]
fn tasks_capped_at_fifteen() {
    let mut v = base();
    v["tasks"] = json!((1..=16)
        .map(|s| json!({ "task": { "kind": "predict_pair", "step": s } }))
        .collect::<Vec<_>>());
    assert_eq!(field(&load(&v).unwrap_err()), "tasks");
}

#[test]
fn unknown_content_kind_named() {
    let mut v = base();
    v["content"] = json!({ "blob": {} });
    assert_eq!(field(&load(&v).unwrap_err()), "content");
}

#[test]
fn content_names_one_kind() {
    let mut v = base();
    v["content"] = json!({
        "exercise": v["content"]["exercise"].clone(),
        "builtin": "nj-basics",
        "content_hash": "0123456789abcdef",
        "file": file_text("nj-basics.json"),
    });
    assert_eq!(field(&load(&v).unwrap_err()), "content");
}

#[test]
fn null_and_array_values_named() {
    // Every key the file format adds must refuse `null` and report
    // itself by name — the serde gap (plan Task 6, Step 1).
    for key in [
        "schema_version",
        "kind",
        "id",
        "title",
        "instructions",
        "content",
        "id_prompt",
        "mode",
        "variation",
        "tasks",
    ] {
        let mut v = base();
        v[key] = json!(null);
        assert_eq!(field(&load(&v).unwrap_err()), key, "null {key}");
        let mut v = base();
        v[key] = json!([]);
        assert_eq!(field(&load(&v).unwrap_err()), key, "array {key}");
    }
}

#[test]
fn nested_values_named() {
    for (path, key) in [
        (vec!["content", "builtin"], "content.builtin"),
        (vec!["content", "content_hash"], "content.content_hash"),
        (vec!["content", "file"], "content.file"),
        (vec!["id_prompt", "label"], "id_prompt.label"),
        (vec!["id_prompt", "rule"], "id_prompt.rule"),
    ] {
        let mut v = builtin();
        let mut cursor = &mut v;
        for p in &path[..path.len() - 1] {
            cursor = &mut cursor[*p];
        }
        cursor[path[path.len() - 1]] = json!(null);
        assert_eq!(field(&load(&v).unwrap_err()), key, "null {key}");
    }
    let mut v = base();
    v["tasks"][0]["task"] = json!(null);
    assert_eq!(field(&load(&v).unwrap_err()), "tasks.0.task");
    let mut v = base();
    v["tasks"][0]["points"] = json!(null);
    assert_eq!(field(&load(&v).unwrap_err()), "tasks.0.points");
}

#[test]
fn scalar_checks_named() {
    let cases: &[(&str, Value, &str)] = &[
        ("schema_version", json!(2), "schema_version"),
        ("kind", json!("lesson"), "kind"),
        ("id", json!(""), "id"),
        ("title", json!(""), "title"),
        ("mode", json!("exam"), "mode"),
        ("variation", json!("yes"), "variation"),
    ];
    for (key, val, want) in cases {
        let mut v = base();
        v[*key] = val.clone();
        assert_eq!(field(&load(&v).unwrap_err()), *want, "{key}");
    }
}

#[test]
fn builtin_refusals_named() {
    // `file` must be present (the resolver injects it).
    let mut v = builtin();
    v["content"].as_object_mut().unwrap().remove("file");
    assert_eq!(field(&load(&v).unwrap_err()), "content.file");

    // A recorded hash is required, and must be the 16-hex `fnv1a64` form.
    let mut v = builtin();
    v["content"].as_object_mut().unwrap().remove("content_hash");
    assert_eq!(field(&load(&v).unwrap_err()), "content.content_hash");
    let mut v = builtin();
    v["content"]["content_hash"] = json!("nothex");
    assert_eq!(field(&load(&v).unwrap_err()), "content.content_hash");

    // The reference must name the file it resolved to.
    let mut v = builtin();
    v["content"]["builtin"] = json!("upgma-fails");
    assert_eq!(field(&load(&v).unwrap_err()), "content.builtin");
}

#[test]
fn id_prompt_rule_defaults_and_validates() {
    let mut v = base();
    v["id_prompt"].as_object_mut().unwrap().remove("rule");
    let a = load(&v).unwrap();
    assert_eq!(a.id_prompt.rule, IdRule::TrimLower);

    let mut v = base();
    v["id_prompt"]["rule"] = json!("upper");
    assert_eq!(field(&load(&v).unwrap_err()), "id_prompt.rule");
}

#[test]
fn task_shape_checks_named() {
    // `task` must be a known TaskRef.
    let mut v = base();
    v["tasks"][0]["task"] = json!({ "kind": "essay" });
    assert_eq!(field(&load(&v).unwrap_err()), "tasks.0.task");
    // `points` defaults to 1 and must be ≥ 0.
    let mut v = base();
    v["tasks"][0]["points"] = json!(-1.0);
    assert_eq!(field(&load(&v).unwrap_err()), "tasks.0.points");
}

#[test]
fn task_must_apply_to_content() {
    // A reading task on exercise content — and vice versa — is an
    // authoring error the load should refuse.
    let mut v = base();
    v["tasks"] = json!([{ "task": { "kind": "reading", "item": 0 } }]);
    assert_eq!(field(&load(&v).unwrap_err()), "tasks.0.task");

    let mut v = builtin();
    let content = v["content"].as_object_mut().unwrap();
    content.insert("builtin".to_string(), json!("trees-form-a"));
    content.insert(
        "content_hash".to_string(),
        json!(content_hash(
            file_text("reading/trees-form-a.json").as_bytes()
        )),
    );
    content.insert(
        "file".to_string(),
        json!(file_text("reading/trees-form-a.json")),
    );
    let set_tasks = json!([{ "task": { "kind": "predict_pair", "step": 1 } }]);
    v["tasks"] = set_tasks;
    assert_eq!(field(&load(&v).unwrap_err()), "tasks.0.task");
}

#[test]
fn reading_task_item_must_exist() {
    let mut v = builtin();
    let content = v["content"].as_object_mut().unwrap();
    content.insert("builtin".to_string(), json!("trees-form-a"));
    content.insert(
        "content_hash".to_string(),
        json!(content_hash(
            file_text("reading/trees-form-a.json").as_bytes()
        )),
    );
    content.insert(
        "file".to_string(),
        json!(file_text("reading/trees-form-a.json")),
    );
    v["tasks"] = json!([{ "task": { "kind": "reading", "item": 99 } }]);
    assert_eq!(field(&load(&v).unwrap_err()), "tasks.0.task");
}

#[test]
fn fingerprint_covers_recorded_hash_not_content() {
    // The code fingerprint covers `content_hash`, so two assignments
    // whose builtin file texts differ but whose recorded hashes match
    // grade the same way — and a changed hash is a different
    // assignment.
    let mut v = builtin();
    let a = load(&v).unwrap();
    let base_fp = fingerprint(&a);

    v["content"]["content_hash"] = json!("0123456789abcdef");
    let b = load(&v).unwrap();
    assert_ne!(fingerprint(&b), base_fp);

    // An embedded-content assignment has no recorded hash — the
    // fingerprint covers the whole content.
    let embedded = load(&base()).unwrap();
    assert_ne!(fingerprint(&embedded), base_fp);
}

#[test]
fn variant_for_loaded_assignment() {
    // End to end: a loaded assignment makes a seeded variant.
    let a = load(&builtin()).unwrap();
    let v = a.variant_for("alice@example.edu").unwrap();
    assert!(v.retry <= 50);
    assert_ne!(v.seed, 0);
}

#[test]
fn prose_names_taxa_known_answers() {
    // Owner-pinned answers (2026-11-25): only prompts that mention a
    // taxon name appear, whole-word, case-sensitive; `a`/`A` (the
    // article) and a label directly followed by `(` are never names.
    type Case<'a> = (&'a str, &'a [(u32, Vec<String>)]);
    let cases: &[Case] = &[
        ("nj-basics", &[(1, vec!["E".into(), "F".into()])]),
        (
            "protein-models",
            &[
                (0, vec!["C".into(), "D".into(), "F".into()]),
                (
                    1,
                    vec![
                        "B".into(),
                        "C".into(),
                        "D".into(),
                        "E".into(),
                        "F".into(),
                        "G".into(),
                    ],
                ),
                (2, vec!["B".into(), "E".into(), "F".into(), "G".into()]),
            ],
        ),
        (
            "upgma-fails",
            &[
                (0, vec!["B".into()]),
                (1, vec!["B".into()]),
                (2, vec!["B".into()]),
            ],
        ),
        ("bootstrap-basics", &[]),
        ("saturation", &[]),
        ("upgma-vs-nj-matrix", &[]),
        ("cytochrome-c", &[]),
        ("nj-by-hand", &[]),
    ];
    for (id, want) in cases {
        let got = prose_names_taxa(&lesson(id));
        assert_eq!(&got, want, "{id}");
    }
}
