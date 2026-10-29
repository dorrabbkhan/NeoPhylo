//! Exercise schema v3 (v1.4 spec §4): `analysis.kappa` for
//! `K2P_PHYLIP`, `sim.model: "F84"` with `sim.base_freqs`, and the rule
//! that the new identifiers exist only in `schema_version` 3 files.
//! Schema 1 and 2 files load unchanged.

use neophylo_core::algos::Method;
use neophylo_core::alphabet::Alphabet;
use neophylo_core::dist::DistModel;
use neophylo_core::error::NeoError;
use neophylo_core::exercise::{load_exercise, Exercise, ExerciseData, CURRENT_SCHEMA_VERSION};
use neophylo_core::newick::parse_newick;
use neophylo_core::sim::{simulate, SimModel};

/// A v3 simulated-data shell: `{0}` is the analysis JSON, `{1}` the sim
/// JSON, `{2}` the alphabet.
fn simulated(alphabet: &str, sim: &str, analysis: &str) -> String {
    format!(
        r#"{{
  "schema_version": 3,
  "id": "v3",
  "title": "Schema 3",
  "alphabet": "{alphabet}",
  "data": {{
    "kind": "simulated",
    "true_tree": "((A:0.1,B:0.2):0.05,C:0.3);",
    "sim": {sim}
  }},
  "analysis": {analysis},
  "locked": [],
  "prompts": []
}}"#
    )
}

/// The v1 spec §7 example, verbatim (same as exercise_v2.rs).
const V1_SPEC_EXAMPLE: &str = r#"{
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
    { "at_step": 3, "type": "note",
      "concept": "Only one join is left; it finishes the tree.",
      "math": "With three clusters the Q values rank all three pairs the same way." }
  ]
}"#;

/// The same exercise as a v2 file.
const V2_EQUIVALENT: &str = r#"{
  "schema_version": 2,
  "id": "nj-basics",
  "title": "How Neighbor-Joining works",
  "alphabet": "dna",
  "data": {
    "kind": "simulated",
    "true_tree": "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
    "sim": { "model": "JC69", "length": 1000, "seed": 42 }
  },
  "reference": { "newick": "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);", "kind": "true" },
  "analysis": { "correction": "JC69", "method": "NJ" },
  "locked": ["sim.model", "analysis.method"],
  "prompts": [
    { "at_step": 1, "type": "predict_pair",
      "concept": "Which two taxa will join first?",
      "math": "Find the minimum Q(i,j)." },
    { "at_step": 3, "type": "note",
      "concept": "Only one join is left; it finishes the tree.",
      "math": "With three clusters the Q values rank all three pairs the same way." }
  ]
}"#;

const JC69_SIM: &str = r#"{ "model": "JC69", "length": 100, "seed": 7 }"#;
const F84_SIM: &str = r#"{ "model": "F84", "kappa": 3.0, "base_freqs": { "A": 0.3, "C": 0.2, "G": 0.2, "T": 0.3 }, "length": 200, "seed": 11 }"#;

/// `(field, msg)` of an `InvalidExercise`; panics on anything else.
fn invalid(err: &NeoError) -> (String, String) {
    match err {
        NeoError::InvalidExercise { field, msg } => (field.clone(), msg.clone()),
        other => panic!("expected InvalidExercise, got {other:?}"),
    }
}

fn sim_model(ex: &Exercise) -> SimModel {
    match &ex.data {
        ExerciseData::Simulated { sim, .. } => sim.model,
        other => panic!("expected Simulated, got {other:?}"),
    }
}

// --- analysis.kappa and the new corrections (v1.4 spec §4) -------------

#[test]
fn current_schema_version_is_4() {
    // The version writers emit once they support the v1.4b fields
    // (v1.4b Task 6; the editor still writes 3 — its v4 fields are a
    // later task).
    assert_eq!(CURRENT_SCHEMA_VERSION, 4);
}

#[test]
fn v3_k2p_with_kappa_loads() {
    let json = simulated(
        "dna",
        JC69_SIM,
        r#"{ "correction": "K2P_PHYLIP", "method": "NJ", "kappa": 4.0 }"#,
    );
    let ex = load_exercise(&json).unwrap();
    assert_eq!(ex.schema_version, 3);
    assert_eq!(ex.analysis.correction, DistModel::K2pPhylip { ratio: 4.0 });
    assert_eq!(ex.analysis.kappa, Some(4.0));
    assert_eq!(ex.analysis.method, Method::Nj);
}

#[test]
fn v3_k2p_without_kappa_defaults_to_2() {
    let json = simulated(
        "dna",
        JC69_SIM,
        r#"{ "correction": "K2P_PHYLIP", "method": "NJ" }"#,
    );
    let ex = load_exercise(&json).unwrap();
    assert_eq!(ex.analysis.correction, DistModel::K2pPhylip { ratio: 2.0 });
    assert_eq!(ex.analysis.kappa, Some(2.0));
}

#[test]
fn v3_kappa_must_be_positive_and_finite() {
    for bad in ["0", "-1"] {
        let json = simulated(
            "dna",
            JC69_SIM,
            &format!(r#"{{ "correction": "K2P_PHYLIP", "method": "NJ", "kappa": {bad} }}"#),
        );
        let err = load_exercise(&json).unwrap_err();
        let (field, _) = invalid(&err);
        assert_eq!(field, "analysis.kappa", "kappa {bad}");
    }
}

#[test]
fn v3_huge_kappa_loads() {
    // dnadist clamps nothing above; a large finite kappa is valid.
    let json = simulated(
        "dna",
        JC69_SIM,
        r#"{ "correction": "K2P_PHYLIP", "method": "NJ", "kappa": 1e308 }"#,
    );
    let ex = load_exercise(&json).unwrap();
    assert_eq!(ex.analysis.kappa, Some(1e308));
}

#[test]
fn v3_kappa_applies_only_to_k2p_phylip() {
    // A silently ignored kappa would mislead: F84 uses dnadist's fixed
    // 2.0, and the other corrections take no ratio at all.
    for correction in ["p", "JC69", "K80", "F84"] {
        let json = simulated(
            "dna",
            JC69_SIM,
            &format!(r#"{{ "correction": "{correction}", "method": "NJ", "kappa": 2.0 }}"#),
        );
        let err = load_exercise(&json).unwrap_err();
        let (field, msg) = invalid(&err);
        assert_eq!(field, "analysis.kappa", "correction {correction}");
        assert_eq!(
            msg, "kappa applies only to K2P_PHYLIP",
            "correction {correction}"
        );
    }
}

#[test]
fn v3_f84_correction_loads() {
    let json = simulated(
        "dna",
        JC69_SIM,
        r#"{ "correction": "F84", "method": "NJ" }"#,
    );
    let ex = load_exercise(&json).unwrap();
    assert_eq!(ex.analysis.correction, DistModel::F84);
    assert_eq!(ex.analysis.kappa, None);
}

#[test]
fn kimura_is_still_the_protein_correction() {
    // "Kimura" names the protein model; it refuses DNA data even though
    // K2P_PHYLIP now exists (the names must not be conflated, spec §3.3).
    let json = simulated(
        "dna",
        JC69_SIM,
        r#"{ "correction": "Kimura", "method": "NJ" }"#,
    );
    let err = load_exercise(&json).unwrap_err();
    match err {
        NeoError::ModelAlphabetMismatch { model, alphabet } => {
            assert_eq!(model, "Kimura");
            assert_eq!(alphabet, Alphabet::Dna);
        }
        other => panic!("expected ModelAlphabetMismatch, got {other:?}"),
    }
}

// --- sim.model F84 and sim.base_freqs ----------------------------------

#[test]
fn v3_f84_sim_loads() {
    let json = simulated("dna", F84_SIM, r#"{ "correction": "F84", "method": "NJ" }"#);
    let ex = load_exercise(&json).unwrap();
    assert_eq!(
        sim_model(&ex),
        SimModel::F84 {
            kappa: 3.0,
            base_freqs: [0.3, 0.2, 0.2, 0.3],
        }
    );
}

#[test]
fn v3_f84_sim_default_freqs_are_equal() {
    let json = simulated(
        "dna",
        r#"{ "model": "F84", "kappa": 2.0, "length": 100, "seed": 1 }"#,
        r#"{ "correction": "JC69", "method": "NJ" }"#,
    );
    let ex = load_exercise(&json).unwrap();
    assert_eq!(
        sim_model(&ex),
        SimModel::F84 {
            kappa: 2.0,
            base_freqs: [0.25; 4],
        }
    );
}

#[test]
fn v3_f84_sim_requires_kappa() {
    let json = simulated(
        "dna",
        r#"{ "model": "F84", "length": 100, "seed": 1 }"#,
        r#"{ "correction": "JC69", "method": "NJ" }"#,
    );
    let err = load_exercise(&json).unwrap_err();
    let (field, _) = invalid(&err);
    assert_eq!(field, "sim.kappa");
}

#[test]
fn v3_base_freqs_apply_only_to_f84() {
    for model in ["JC69", "K80"] {
        let sim = if model == "K80" {
            r#"{ "model": "K80", "kappa": 2.0, "base_freqs": { "A": 0.3, "C": 0.2, "G": 0.2, "T": 0.3 }, "length": 100, "seed": 1 }"#
        } else {
            r#"{ "model": "JC69", "base_freqs": { "A": 0.3, "C": 0.2, "G": 0.2, "T": 0.3 }, "length": 100, "seed": 1 }"#
        };
        let json = simulated("dna", sim, r#"{ "correction": "JC69", "method": "NJ" }"#);
        let err = load_exercise(&json).unwrap_err();
        let (field, _) = invalid(&err);
        assert_eq!(field, "sim.base_freqs", "model {model}");
    }
}

#[test]
fn v3_base_freqs_require_all_four() {
    // `T` missing: the object is all-or-nothing (default only when the
    // whole key is absent).
    let json = simulated(
        "dna",
        r#"{ "model": "F84", "kappa": 2.0, "base_freqs": { "A": 0.4, "C": 0.2, "G": 0.2 }, "length": 100, "seed": 1 }"#,
        r#"{ "correction": "JC69", "method": "NJ" }"#,
    );
    let err = load_exercise(&json).unwrap_err();
    let (field, _) = invalid(&err);
    assert_eq!(field, "sim.base_freqs");
}

#[test]
fn v3_base_freqs_must_sum_to_one() {
    let json = simulated(
        "dna",
        r#"{ "model": "F84", "kappa": 2.0, "base_freqs": { "A": 0.3, "C": 0.2, "G": 0.2, "T": 0.2 }, "length": 100, "seed": 1 }"#,
        r#"{ "correction": "JC69", "method": "NJ" }"#,
    );
    let err = load_exercise(&json).unwrap_err();
    let (field, _) = invalid(&err);
    assert_eq!(field, "sim.base_freqs");
}

#[test]
fn v3_base_freqs_must_be_positive() {
    let json = simulated(
        "dna",
        r#"{ "model": "F84", "kappa": 2.0, "base_freqs": { "A": 0.5, "C": 0.5, "G": 0.0, "T": 0.0 }, "length": 100, "seed": 1 }"#,
        r#"{ "correction": "JC69", "method": "NJ" }"#,
    );
    let err = load_exercise(&json).unwrap_err();
    let (field, _) = invalid(&err);
    assert_eq!(field, "sim.base_freqs");
}

#[test]
fn v3_f84_sim_is_dna_only() {
    let json = simulated(
        "protein",
        F84_SIM,
        r#"{ "correction": "JTT", "method": "NJ" }"#,
    );
    let err = load_exercise(&json).unwrap_err();
    match err {
        NeoError::ModelAlphabetMismatch { model, alphabet } => {
            assert_eq!(model, "F84");
            assert_eq!(alphabet, Alphabet::Protein);
        }
        other => panic!("expected ModelAlphabetMismatch, got {other:?}"),
    }
}

#[test]
fn f84_sim_exercise_simulates() {
    // The loaded spec runs end to end, not just parses.
    let json = simulated("dna", F84_SIM, r#"{ "correction": "F84", "method": "NJ" }"#);
    let ex = load_exercise(&json).unwrap();
    let ExerciseData::Simulated { true_tree, sim } = &ex.data else {
        panic!("expected Simulated")
    };
    let tree = parse_newick(true_tree).unwrap();
    let aln = simulate(&tree, sim).unwrap();
    assert_eq!(aln.labels.len(), 3);
    assert_eq!(aln.seqs[0].len(), 200);
}

// --- the new identifiers are schema 3 only -----------------------------

#[test]
fn v2_rejects_new_identifiers() {
    // In a v2 file every new identifier is refused at the field that
    // would carry it, naming the version it requires.
    let cases: &[(&str, &str, &str)] = &[
        (
            r#"{ "correction": "F84", "method": "NJ" }"#,
            JC69_SIM,
            "analysis.correction",
        ),
        (
            r#"{ "correction": "K2P_PHYLIP", "method": "NJ", "kappa": 2.0 }"#,
            JC69_SIM,
            "analysis.kappa",
        ),
        (
            r#"{ "correction": "JC69", "method": "NJ", "kappa": 2.0 }"#,
            JC69_SIM,
            "analysis.kappa",
        ),
        (
            r#"{ "correction": "JC69", "method": "NJ" }"#,
            r#"{ "model": "F84", "kappa": 2.0, "length": 100, "seed": 1 }"#,
            "sim.model",
        ),
        (
            r#"{ "correction": "JC69", "method": "NJ" }"#,
            r#"{ "model": "JC69", "base_freqs": { "A": 0.25, "C": 0.25, "G": 0.25, "T": 0.25 }, "length": 100, "seed": 1 }"#,
            "sim.base_freqs",
        ),
    ];
    for (analysis, sim, want_field) in cases {
        let json = simulated("dna", sim, analysis).replacen(
            r#""schema_version": 3"#,
            r#""schema_version": 2"#,
            1,
        );
        let err = load_exercise(&json).unwrap_err();
        let (field, msg) = invalid(&err);
        assert_eq!(&field, want_field, "case {analysis} {sim}");
        assert!(
            msg.contains("requires schema_version 3"),
            "case {analysis} {sim}: msg {msg}"
        );
    }
}

#[test]
fn v1_rejects_new_identifiers() {
    // The same gate applies to flat v1 files.
    let k2p = V1_SPEC_EXAMPLE.replace(
        r#""correction": "JC69""#,
        r#""correction": "K2P_PHYLIP", "kappa": 2.0"#,
    );
    let err = load_exercise(&k2p).unwrap_err();
    let (field, msg) = invalid(&err);
    assert_eq!(field, "analysis.kappa");
    assert!(msg.contains("requires schema_version 3"), "msg {msg}");

    let f84_sim = V1_SPEC_EXAMPLE.replace(
        r#""sim": { "model": "JC69", "length": 1000, "seed": 42 }"#,
        r#""sim": { "model": "F84", "kappa": 2.0, "length": 1000, "seed": 42 }"#,
    );
    let err = load_exercise(&f84_sim).unwrap_err();
    let (field, msg) = invalid(&err);
    assert_eq!(field, "sim.model");
    assert!(msg.contains("requires schema_version 3"), "msg {msg}");
}

// --- versions and round trips ------------------------------------------

#[test]
fn v1_loads_identically_to_v2_equivalent() {
    // Migration is unchanged: a v1 file and its v2 twin normalize to the
    // identical Exercise, schema_version 2 included.
    let a = load_exercise(V1_SPEC_EXAMPLE).unwrap();
    let b = load_exercise(V2_EQUIVALENT).unwrap();
    assert_eq!(a.schema_version, 2);
    assert_eq!(a, b);
}

#[test]
fn loaded_exercise_serde_round_trips() {
    // A loaded Exercise serializes and deserializes to itself.
    for text in [V1_SPEC_EXAMPLE, V2_EQUIVALENT] {
        let ex = load_exercise(text).unwrap();
        let s = serde_json::to_string(&ex).unwrap();
        let back: Exercise = serde_json::from_str(&s).unwrap();
        assert_eq!(ex, back);
    }
}

#[test]
fn repo_exercises_v3_twins_load_identically() {
    // Every committed v2 exercise must load identically when its only
    // change is "schema_version": 3 — and the v2-loaded value must
    // serialize without an analysis.kappa key (v2 bytes unchanged).
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
    ] {
        let v2 = load_exercise(text).unwrap_or_else(|e| panic!("{name}: {e}"));
        let mut doc: serde_json::Value = serde_json::from_str(text).unwrap();
        doc["schema_version"] = serde_json::json!(3);
        let mut v3 =
            load_exercise(&doc.to_string()).unwrap_or_else(|e| panic!("{name} as v3: {e}"));
        assert_eq!(v2.schema_version, 2, "{name}");
        assert_eq!(v3.schema_version, 3, "{name}");
        v3.schema_version = 2;
        assert_eq!(v2, v3, "{name}: v2 and v3 loads differ");

        let s = serde_json::to_string(&v2).unwrap();
        let doc: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert!(
            doc["analysis"].get("kappa").is_none(),
            "{name}: serialized analysis carries kappa: {s}"
        );
    }
}

#[test]
fn unknown_schema_version_reports_all_four() {
    let json = V2_EQUIVALENT.replace(r#""schema_version": 2"#, r#""schema_version": 5"#);
    let err = load_exercise(&json).unwrap_err();
    let (field, msg) = invalid(&err);
    assert_eq!(field, "schema_version");
    assert_eq!(msg, "schema_version must be 1, 2, 3 or 4, got 5");
}

// --- an explicit null is not "absent" on the v3 keys --------------------
// schema.json types them `number` / `object`, never nullable, so the
// engine must refuse `key: null` in every schema version instead of
// reading it as a missing key.

#[test]
fn v2_analysis_kappa_null_is_refused() {
    // A v2 file carrying `"kappa": null` would otherwise read the key as
    // absent and slip past the schema_version 3 gate.
    let json = simulated(
        "dna",
        JC69_SIM,
        r#"{ "correction": "JC69", "method": "NJ", "kappa": null }"#,
    )
    .replacen(r#""schema_version": 3"#, r#""schema_version": 2"#, 1);
    let err = load_exercise(&json).unwrap_err();
    let (field, _) = invalid(&err);
    assert_eq!(field, "analysis.kappa");
}

#[test]
fn v2_base_freqs_null_is_refused() {
    let json = simulated(
        "dna",
        r#"{ "model": "JC69", "base_freqs": null, "length": 100, "seed": 1 }"#,
        r#"{ "correction": "JC69", "method": "NJ" }"#,
    )
    .replacen(r#""schema_version": 3"#, r#""schema_version": 2"#, 1);
    let err = load_exercise(&json).unwrap_err();
    let (field, _) = invalid(&err);
    assert_eq!(field, "sim.base_freqs");
}

#[test]
fn v3_analysis_kappa_null_is_refused() {
    let json = simulated(
        "dna",
        JC69_SIM,
        r#"{ "correction": "K2P_PHYLIP", "method": "NJ", "kappa": null }"#,
    );
    let err = load_exercise(&json).unwrap_err();
    let (field, _) = invalid(&err);
    assert_eq!(field, "analysis.kappa");
}

#[test]
fn v3_base_freqs_null_is_refused() {
    let json = simulated(
        "dna",
        r#"{ "model": "F84", "kappa": 3.0, "base_freqs": null, "length": 100, "seed": 1 }"#,
        r#"{ "correction": "F84", "method": "NJ" }"#,
    );
    let err = load_exercise(&json).unwrap_err();
    let (field, _) = invalid(&err);
    assert_eq!(field, "sim.base_freqs");
}

#[test]
fn v3_base_freqs_array_is_refused() {
    // serde would happily read a 4-element array into the struct, but
    // schema.json accepts only the { "A", "C", "G", "T" } object.
    let json = simulated(
        "dna",
        r#"{ "model": "F84", "kappa": 3.0, "base_freqs": [0.25, 0.25, 0.25, 0.25], "length": 100, "seed": 1 }"#,
        r#"{ "correction": "F84", "method": "NJ" }"#,
    );
    let err = load_exercise(&json).unwrap_err();
    let (field, _) = invalid(&err);
    assert_eq!(field, "sim.base_freqs");
}

#[test]
fn v3_k2p_exercise_serde_round_trips() {
    let json = simulated(
        "dna",
        JC69_SIM,
        r#"{ "correction": "K2P_PHYLIP", "method": "NJ", "kappa": 3.5 }"#,
    );
    let ex = load_exercise(&json).unwrap();
    let s = serde_json::to_string(&ex).unwrap();
    assert!(s.contains(r#""kappa":3.5"#), "serialized exercise: {s}");
    let back: Exercise = serde_json::from_str(&s).unwrap();
    assert_eq!(ex, back);
}
