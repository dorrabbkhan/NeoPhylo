//! Exercise file loading (spec §7): schema mirror, per-field validation
//! and the exercise-level length cap.

use neophylo_core::algos::Method;
use neophylo_core::dist::DistModel;
use neophylo_core::error::NeoError;
use neophylo_core::exercise::{load_exercise, PromptType};
use neophylo_core::sim::SimModel;

/// The spec §7 example.
const VALID: &str = r#"{
  "schema_version": 1,
  "id": "nj-basics",
  "title": "How Neighbor-Joining works",
  "true_tree": "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
  "sim": { "model": "JC69", "length": 1000, "seed": 42 },
  "analysis": { "correction": "JC69", "method": "NJ" },
  "locked": ["sim.model", "analysis.method"],
  "prompts": [
    { "at_step": 1, "type": "predict_pair",
      "concept": "Which two taxa will join first?",
      "math": "Find the minimum Q(i,j)." },
    { "at_step": 3, "type": "note", "concept": "…", "math": "…" }
  ]
}"#;

fn field_of(err: &NeoError) -> &str {
    match err {
        NeoError::InvalidExercise { field, .. } => field,
        other => panic!("expected InvalidExercise, got {other:?}"),
    }
}

#[test]
fn valid_loads() {
    let ex = load_exercise(VALID).unwrap();
    assert_eq!(ex.schema_version, 1);
    assert_eq!(ex.id, "nj-basics");
    assert_eq!(ex.title, "How Neighbor-Joining works");
    assert_eq!(
        ex.true_tree,
        "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);"
    );
    assert_eq!(ex.sim.model, SimModel::Jc69);
    assert_eq!(ex.sim.length, 1000);
    assert_eq!(ex.sim.seed, 42);
    assert_eq!(ex.analysis.correction, DistModel::Jc69);
    assert_eq!(ex.analysis.method, Method::Nj);
    assert_eq!(ex.locked, vec!["sim.model", "analysis.method"]);
    assert_eq!(ex.prompts.len(), 2);
    assert_eq!(ex.prompts[0].at_step, 1);
    assert_eq!(ex.prompts[0].r#type, PromptType::PredictPair);
    assert_eq!(
        ex.prompts[0].math.as_deref(),
        Some("Find the minimum Q(i,j).")
    );
    assert_eq!(ex.prompts[1].r#type, PromptType::Note);
}

#[test]
fn k80_sim_loads() {
    let json = VALID.replace(
        r#""sim": { "model": "JC69", "length": 1000, "seed": 42 }"#,
        r#""sim": { "model": "K80", "kappa": 2.0, "length": 1000, "seed": 42 }"#,
    );
    let ex = load_exercise(&json).unwrap();
    assert_eq!(ex.sim.model, SimModel::K80 { kappa: 2.0 });
}

#[test]
fn bad_schema_version() {
    let json = VALID.replace(r#""schema_version": 1"#, r#""schema_version": 2"#);
    let err = load_exercise(&json).unwrap_err();
    assert_eq!(field_of(&err), "schema_version");
}

#[test]
fn length_cap() {
    // The exercise-level cap is 10,000 even though the engine accepts
    // up to 100,000.
    let json = VALID.replace(r#""length": 1000"#, r#""length": 20000"#);
    let err = load_exercise(&json).unwrap_err();
    assert_eq!(field_of(&err), "sim.length");
}

#[test]
fn unknown_method() {
    let json = VALID.replace(r#""method": "NJ""#, r#""method": "WPGMA""#);
    let err = load_exercise(&json).unwrap_err();
    assert_eq!(field_of(&err), "analysis.method");
}

#[test]
fn true_tree_missing_length() {
    // Review Focus 5: rejected at load time, before any simulation runs.
    let json = VALID.replace(
        r#""true_tree": "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);""#,
        r#""true_tree": "(A:0.1,B,C:0.2);""#,
    );
    let err = load_exercise(&json).unwrap_err();
    assert_eq!(field_of(&err), "true_tree");
}

#[test]
fn malformed_json() {
    let err = load_exercise("{ not json").unwrap_err();
    assert!(matches!(err, NeoError::InvalidExercise { .. }));
}
