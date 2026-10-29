//! Exercise schema v4 (v1.4b spec §4): `analysis.site_filter` — MEGA's
//! three gap treatments — and the `"Poisson"` correction identifier,
//! both valid only in `schema_version` 4 files. Schema 1–3 files load
//! unchanged and serialize without the new keys.
//!
//! `site_filter` is parsed presence-aware (same serde null/array gap as
//! the v3 keys): an explicit `null` or a non-object is refused at
//! `analysis.site_filter`, a bad `kind` at `analysis.site_filter.kind`
//! and a bad `cutoff_pct` at `analysis.site_filter.cutoff_pct`, so the
//! field names match exercises/schema.json's structure.

use neophylo_core::alphabet::Alphabet;
use neophylo_core::dist::{compute, compute_filtered, DistModel};
use neophylo_core::error::NeoError;
use neophylo_core::exercise::{load_exercise, Exercise, ExerciseData};
use neophylo_core::seq::parse_fasta;
use neophylo_core::site_filter::SiteFilter;
use neophylo_core::with_alphabet;

/// A v4 simulated-data shell: `{0}` the alphabet, `{1}` the sim JSON,
/// `{2}` the analysis JSON.
fn simulated(alphabet: &str, sim: &str, analysis: &str) -> String {
    format!(
        r#"{{
  "schema_version": 4,
  "id": "v4",
  "title": "Schema 4",
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

/// A v4 embedded-data shell for the "analyses identically" test.
fn embedded(fasta: &str, alphabet: &str, analysis: &str) -> String {
    format!(
        r#"{{
  "schema_version": 4,
  "id": "emb",
  "title": "Embedded",
  "alphabet": "{alphabet}",
  "data": {{
    "kind": "embedded",
    "fasta": "{fasta}",
    "source": {{ "citation": "test", "license": "CC BY 4.0", "accessions": ["P00000"] }}
  }},
  "analysis": {analysis},
  "locked": [],
  "prompts": []
}}"#
    )
}

const JC69_SIM: &str = r#"{ "model": "JC69", "length": 100, "seed": 7 }"#;
const JTT_SIM: &str = r#"{ "model": "JTT", "length": 100, "seed": 7 }"#;
const NJ_JC69: &str = r#"{ "correction": "JC69", "method": "NJ" }"#;

/// `(field, msg)` of an `InvalidExercise`; panics on anything else.
fn invalid(err: &NeoError) -> (String, String) {
    match err {
        NeoError::InvalidExercise { field, msg } => (field.clone(), msg.clone()),
        other => panic!("expected InvalidExercise, got {other:?}"),
    }
}

/// Downgrade the shell's declared version, for the older-version gates.
fn as_version(json: &str, v: u32) -> String {
    json.replacen(
        r#""schema_version": 4"#,
        &format!(r#""schema_version": {v}"#),
        1,
    )
}

// --- analysis.site_filter loads ----------------------------------------

#[test]
fn v4_partial_site_filter_loads() {
    let json = simulated(
        "dna",
        JC69_SIM,
        r#"{ "correction": "JC69", "method": "NJ",
             "site_filter": { "kind": "partial", "cutoff_pct": 95 } }"#,
    );
    let ex = load_exercise(&json).unwrap();
    assert_eq!(ex.schema_version, 4);
    assert_eq!(
        ex.analysis.site_filter,
        Some(SiteFilter::Partial { cutoff_pct: 95 })
    );
}

#[test]
fn v4_complete_and_pairwise_filters_load() {
    for (kind, want) in [
        ("complete", SiteFilter::Complete),
        ("pairwise", SiteFilter::Pairwise),
    ] {
        let json = simulated(
            "dna",
            JC69_SIM,
            &format!(
                r#"{{ "correction": "JC69", "method": "NJ",
                     "site_filter": {{ "kind": "{kind}" }} }}"#
            ),
        );
        let ex = load_exercise(&json).unwrap();
        assert_eq!(ex.analysis.site_filter, Some(want), "kind {kind}");
    }
}

#[test]
fn cutoff_pct_boundary_values_load() {
    // 0 and 100 are the inclusive ends of MEGA's site-coverage cutoff.
    for cutoff in [0, 100] {
        let json = simulated(
            "dna",
            JC69_SIM,
            &format!(
                r#"{{ "correction": "JC69", "method": "NJ",
                     "site_filter": {{ "kind": "partial", "cutoff_pct": {cutoff} }} }}"#
            ),
        );
        let ex = load_exercise(&json).unwrap();
        assert_eq!(
            ex.analysis.site_filter,
            Some(SiteFilter::Partial { cutoff_pct: cutoff })
        );
    }
}

#[test]
fn absent_and_explicit_pairwise_analyse_identically() {
    // A file may write `{ "kind": "pairwise" }` explicitly: it loads to
    // `Some(Pairwise)` so the file round-trips, and `None` (the absent
    // key) means the same thing — both analyse with pairwise deletion.
    let fasta = ">a\\nACGTACGT\\n>b\\nAC-TACGA";
    let none = load_exercise(&embedded(fasta, "dna", NJ_JC69)).unwrap();
    let some = load_exercise(&embedded(
        fasta,
        "dna",
        r#"{ "correction": "JC69", "method": "NJ",
             "site_filter": { "kind": "pairwise" } }"#,
    ))
    .unwrap();
    assert_eq!(none.analysis.site_filter, None);
    assert_eq!(some.analysis.site_filter, Some(SiteFilter::Pairwise));

    let ExerciseData::Embedded { fasta, .. } = &none.data else {
        panic!("expected Embedded")
    };
    let aln = with_alphabet(parse_fasta(fasta).unwrap(), Alphabet::Dna).unwrap();
    for ex in [&none, &some] {
        let filtered = compute_filtered(
            &aln,
            ex.analysis.correction,
            ex.analysis.site_filter.unwrap_or_default(),
        )
        .unwrap();
        assert_eq!(filtered, compute(&aln, ex.analysis.correction).unwrap());
    }
}

// --- site_filter refusals (Review Focus 2) ------------------------------

#[test]
fn partial_without_cutoff_is_refused() {
    let json = simulated(
        "dna",
        JC69_SIM,
        r#"{ "correction": "JC69", "method": "NJ",
             "site_filter": { "kind": "partial" } }"#,
    );
    let (field, _) = invalid(&load_exercise(&json).unwrap_err());
    assert_eq!(field, "analysis.site_filter.cutoff_pct");
}

#[test]
fn cutoff_must_be_an_integer_0_to_100() {
    // u8 would silently accept 101–255 and serde_json would accept 2.5
    // into f64 — both refused at the field, as schema.json refuses
    // non-integers and out-of-range values.
    for cutoff in ["101", "-1", "2.5", "\"95\"", "null", "[]"] {
        let json = simulated(
            "dna",
            JC69_SIM,
            &format!(
                r#"{{ "correction": "JC69", "method": "NJ",
                     "site_filter": {{ "kind": "partial", "cutoff_pct": {cutoff} }} }}"#
            ),
        );
        let (field, _) = invalid(&load_exercise(&json).unwrap_err());
        assert_eq!(field, "analysis.site_filter.cutoff_pct", "cutoff {cutoff}");
    }
}

#[test]
fn cutoff_only_applies_to_partial() {
    for kind in ["pairwise", "complete"] {
        let json = simulated(
            "dna",
            JC69_SIM,
            &format!(
                r#"{{ "correction": "JC69", "method": "NJ",
                     "site_filter": {{ "kind": "{kind}", "cutoff_pct": 95 }} }}"#
            ),
        );
        let (field, _) = invalid(&load_exercise(&json).unwrap_err());
        assert_eq!(field, "analysis.site_filter.cutoff_pct", "kind {kind}");
    }
}

#[test]
fn site_filter_must_be_an_object() {
    // Presence-aware parsing: serde would read `null` as absent, and a
    // non-object (array, string, number) would confuse a typed field —
    // schema.json types site_filter `object` and refuses all of these.
    for sf in ["null", "[]", "\"complete\"", "95"] {
        let json = simulated(
            "dna",
            JC69_SIM,
            &format!(
                r#"{{ "correction": "JC69", "method": "NJ",
                     "site_filter": {sf} }}"#
            ),
        );
        let (field, _) = invalid(&load_exercise(&json).unwrap_err());
        assert_eq!(field, "analysis.site_filter", "site_filter {sf}");
    }
}

#[test]
fn site_filter_kind_must_be_known() {
    // Unknown spellings, wrong case, a non-string kind and a missing
    // kind all fail at analysis.site_filter.kind.
    for sf in [
        r#"{ "kind": "d" }"#,
        r#"{ "kind": "Pairwise" }"#,
        r#"{ "kind": 3 }"#,
        r#"{ "kind": null }"#,
        r#"{ }"#,
    ] {
        let json = simulated(
            "dna",
            JC69_SIM,
            &format!(
                r#"{{ "correction": "JC69", "method": "NJ",
                     "site_filter": {sf} }}"#
            ),
        );
        let (field, _) = invalid(&load_exercise(&json).unwrap_err());
        assert_eq!(field, "analysis.site_filter.kind", "site_filter {sf}");
    }
}

// --- the new identifiers require schema_version 4 -----------------------

#[test]
fn v2_and_v3_refuse_site_filter() {
    // Presence alone trips the gate — an explicit null in an old file is
    // the version error, never "absent" (schema.json counts a null key
    // as present).
    for v in [2, 3] {
        for sf in [r#"{ "kind": "complete" }"#, "null"] {
            let json = as_version(
                &simulated(
                    "dna",
                    JC69_SIM,
                    &format!(
                        r#"{{ "correction": "JC69", "method": "NJ",
                             "site_filter": {sf} }}"#
                    ),
                ),
                v,
            );
            let (field, msg) = invalid(&load_exercise(&json).unwrap_err());
            assert_eq!(field, "analysis.site_filter", "v{v} site_filter {sf}");
            assert!(
                msg.contains("requires schema_version 4"),
                "v{v} site_filter {sf}: msg {msg}"
            );
        }
    }
}

#[test]
fn v2_and_v3_refuse_poisson() {
    for v in [2, 3] {
        let json = as_version(
            &simulated(
                "protein",
                JTT_SIM,
                r#"{ "correction": "Poisson", "method": "NJ" }"#,
            ),
            v,
        );
        let (field, msg) = invalid(&load_exercise(&json).unwrap_err());
        assert_eq!(field, "analysis.correction", "v{v}");
        assert!(msg.contains("requires schema_version 4"), "v{v}: msg {msg}");
    }
}

// --- the Poisson identifier --------------------------------------------

#[test]
fn v4_poisson_loads_on_protein() {
    let json = simulated(
        "protein",
        JTT_SIM,
        r#"{ "correction": "Poisson", "method": "NJ" }"#,
    );
    let ex = load_exercise(&json).unwrap();
    assert_eq!(ex.analysis.correction, DistModel::Poisson);
    assert_eq!(ex.analysis.kappa, None);
}

#[test]
fn poisson_on_dna_is_a_model_alphabet_mismatch() {
    // The same refusal "Kimura" and "JTT" get on DNA today (exercise_v3
    // `kimura_is_still_the_protein_correction`): the identifier is
    // known, the alphabet does not support it.
    let json = simulated(
        "dna",
        JC69_SIM,
        r#"{ "correction": "Poisson", "method": "NJ" }"#,
    );
    match load_exercise(&json).unwrap_err() {
        NeoError::ModelAlphabetMismatch { model, alphabet } => {
            assert_eq!(model, "Poisson");
            assert_eq!(alphabet, Alphabet::Dna);
        }
        other => panic!("expected ModelAlphabetMismatch, got {other:?}"),
    }
}

// --- versions and round trips ------------------------------------------

#[test]
fn v4_exercise_serde_round_trips() {
    let json = simulated(
        "dna",
        JC69_SIM,
        r#"{ "correction": "JC69", "method": "NJ",
             "site_filter": { "kind": "partial", "cutoff_pct": 95 } }"#,
    );
    let ex: Exercise = load_exercise(&json).unwrap();
    let s = serde_json::to_string(&ex).unwrap();
    assert!(
        s.contains(r#""site_filter":{"kind":"partial","cutoff_pct":95}"#),
        "serialized exercise: {s}"
    );
    let back: Exercise = serde_json::from_str(&s).unwrap();
    assert_eq!(ex, back);
}

#[test]
fn repo_exercises_load_as_v4_unchanged() {
    // Every committed exercise (v2 lessons and v3 labs) must load
    // identically when its only change is "schema_version": 4 — and the
    // loaded value must serialize without an analysis.site_filter key
    // (v2/v3 bytes unchanged).
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
            "labs/protdist-neighbor",
            include_str!("../../../exercises/labs/protdist-neighbor.json"),
        ),
        (
            "labs/seqboot-consense",
            include_str!("../../../exercises/labs/seqboot-consense.json"),
        ),
    ] {
        let orig = load_exercise(text).unwrap_or_else(|e| panic!("{name}: {e}"));
        let mut doc: serde_json::Value = serde_json::from_str(text).unwrap();
        doc["schema_version"] = serde_json::json!(4);
        let mut v4 =
            load_exercise(&doc.to_string()).unwrap_or_else(|e| panic!("{name} as v4: {e}"));
        assert_eq!(v4.schema_version, 4, "{name}");
        v4.schema_version = orig.schema_version;
        assert_eq!(orig, v4, "{name}: the v4 load differs");

        let s = serde_json::to_string(&orig).unwrap();
        let doc: serde_json::Value = serde_json::from_str(&s).unwrap();
        assert!(
            doc["analysis"].get("site_filter").is_none(),
            "{name}: serialized analysis carries site_filter: {s}"
        );
    }
}
