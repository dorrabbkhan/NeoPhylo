//! Exercise schema v2 (v1.1 spec §3.6): the `data`/`reference`/`alphabet`
//! shapes, migration of v1 files, and alphabet-aware validation.

use neophylo_core::algos::Method;
use neophylo_core::alphabet::Alphabet;
use neophylo_core::dist::DistModel;
use neophylo_core::error::NeoError;
use neophylo_core::exercise::{
    load_exercise, ExerciseBootstrap, ExerciseData, NoteAfter, PromptType, Reference, ReferenceKind,
};
use neophylo_core::seq::parse_fasta;
use neophylo_core::sim::SimModel;

/// The v1 spec §7 example, verbatim.
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

// The three v1 lesson files as they were before the schema-v2
// conversion. The converted files are read from exercises/ and must load
// to the identical `Exercise` value.
const V1_NJ_BASICS: &str = r#"{
  "schema_version": 1,
  "id": "nj-basics",
  "title": "How Neighbor-Joining works",
  "true_tree": "((A:0.1,B:0.15):0.1,(C:0.12,D:0.08):0.15,(E:0.1,F:0.2):0.05);",
  "sim": { "model": "JC69", "length": 1000, "seed": 42 },
  "analysis": { "correction": "JC69", "method": "NJ" },
  "locked": ["sim.model", "analysis.correction", "analysis.method"],
  "prompts": [
    {
      "at_step": 1,
      "type": "predict_pair",
      "concept": "Neighbor-Joining starts from the distance matrix. Which two taxa join first? Pick a cell in the matrix, or click two leaves in a tree.",
      "math": "NJ joins the pair minimizing Q(i,j) = (n−2)·d(i,j) − R_i − R_j. Use the Distance/Q switch to see Q directly — the smallest off-diagonal value wins."
    },
    {
      "at_step": 3,
      "type": "predict_pair",
      "concept": "Four clusters remain: u1, u2, E and F. Which pair joins next? The tempting answer is the closest pair — is it?",
      "math": "Q(i,j) = (n−2)·d(i,j) − R_i − R_j subtracts each cluster's average divergence. A pair close to each other can still lose to a pair whose members are far from everything else.",
      "reveal": "u1 and u2 are closest, but NJ joins E and F: they are close relative to how far each is from everything else."
    },
    {
      "at_step": 5,
      "type": "note",
      "concept": "The tree is complete: RF = 0, so every grouping in the true tree was recovered.",
      "math": "RF counts splits present in one tree but not the other. Two unrooted 6-taxon trees can differ on at most 2·(6−3) = 6 splits."
    }
  ]
}
"#;

const V1_SATURATION: &str = r#"{
  "schema_version": 1,
  "id": "saturation",
  "title": "Saturation and distance correction",
  "true_tree": "((A:0.8,B:0.7):0.5,(C:0.5,D:0.8):0.5,(E:0.6,F:0.5):0.5);",
  "sim": { "model": "JC69", "length": 50, "seed": 42 },
  "analysis": { "correction": "JC69", "method": "NJ" },
  "locked": ["sim.model"],
  "prompts": [
    {
      "at_step": 1,
      "type": "note",
      "concept": "This example starts broken: at just 50 sites, JC69 pushes several pairs past its p < 0.75 limit, so no tree can be built until one of the fixes below is applied. Once a fix works, the tree appears and you can step on.",
      "math": "JC69 needs p < 3/4. Once observed differences reach 0.75 the correction's logarithm has no finite answer."
    },
    {
      "at_step": 2,
      "type": "note",
      "concept": "With a tree on screen, compare it with the true one. More sites sharpen the distance estimates; shorter branches or the p-distance are the other escapes from saturation.",
      "math": "p-distance always has a value, but it underestimates long branches because it ignores multiple hits."
    },
    {
      "at_step": 5,
      "type": "note",
      "concept": "The corrected distance between two sequences diverges once their observed difference p nears 0.75 — under JC69 the estimate runs off to infinity, which is exactly what blocked the build at 50 sites.",
      "math": "d = −3/4·ln(1 − 4p/3): as p → 0.75 the logarithm's argument reaches 0, so the distance estimate has no finite value."
    }
  ]
}
"#;

const V1_UPGMA_FAILS: &str = r#"{
  "schema_version": 1,
  "id": "upgma-fails",
  "title": "When UPGMA fails: the molecular clock",
  "true_tree": "((A:0.02,B:0.5):0.02,(C:0.05,D:0.05):0.05,E:0.02);",
  "sim": { "model": "JC69", "length": 1000, "seed": 42 },
  "analysis": { "correction": "JC69", "method": "UPGMA" },
  "locked": ["sim.model", "analysis.correction"],
  "prompts": [
    {
      "at_step": 1,
      "type": "note",
      "concept": "This true tree is not clock-like: the branch to B is ten times the others, so B has drifted far from every other taxon. Watch where UPGMA goes wrong.",
      "math": "UPGMA joins the closest pair and sets each branch to d/2 — correct only when all tips are equally distant from the root (ultrametric)."
    },
    {
      "at_step": 3,
      "type": "note",
      "concept": "Because B races ahead, UPGMA's plain averages pull the wrong pair together first and the split it builds is not in the true tree.",
      "math": "Averaging distances assumes the cluster means stay comparable; a fast branch breaks that assumption."
    },
    {
      "at_step": 5,
      "type": "note",
      "concept": "UPGMA assumed every lineage evolves at the same rate — the long branch to B broke that assumption and misled the join order, so RF > 0. Now switch the Method control to Neighbor-Joining, which corrects for unequal rates and reaches RF = 0 here.",
      "math": "NJ subtracts each cluster's average divergence (the r values) before joining, so an accelerated branch no longer misleads the search."
    }
  ]
}
"#;

/// A minimal valid v2 lesson shell; tests patch fields on the string.
const V2_SIMULATED: &str = r#"{
  "schema_version": 2,
  "id": "prot",
  "title": "Protein distances",
  "alphabet": "protein",
  "data": {
    "kind": "simulated",
    "true_tree": "(A:0.1,B:0.2,C:0.3);",
    "sim": { "model": "JTT", "length": 300, "seed": 7 }
  },
  "reference": { "newick": "(A:0.1,B:0.2,C:0.3);", "kind": "true" },
  "analysis": { "correction": "JTT", "method": "NJ" },
  "locked": [],
  "prompts": []
}"#;

#[test]
fn v1_migrates() {
    let ex = load_exercise(V1_SPEC_EXAMPLE).unwrap();
    assert_eq!(ex.schema_version, 2);
    assert_eq!(ex.alphabet, Alphabet::Dna);
    match &ex.data {
        ExerciseData::Simulated { true_tree, sim } => {
            assert_eq!(true_tree, "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);");
            assert_eq!(sim.model, SimModel::Jc69);
            assert_eq!(sim.length, 1000);
            assert_eq!(sim.seed, 42);
        }
        other => panic!("expected Simulated, got {other:?}"),
    }
    assert_eq!(
        ex.reference,
        Some(Reference {
            newick: "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);".to_string(),
            kind: ReferenceKind::True,
        })
    );
    assert_eq!(ex.analysis.correction, DistModel::Jc69);
    assert_eq!(ex.analysis.method, Method::Nj);
    assert_eq!(ex.locked, vec!["sim.model", "analysis.method"]);
    assert_eq!(ex.prompts.len(), 2);
    assert_eq!(ex.prompts[0].r#type, PromptType::PredictPair);
}

#[test]
fn v1_lessons_identical() {
    // Each pre-conversion v1 file and the converted v2 file on disk must
    // load to the identical Exercise.
    for (v1, v2_path) in [
        (V1_NJ_BASICS, "nj-basics.json"),
        (V1_SATURATION, "saturation.json"),
        (V1_UPGMA_FAILS, "upgma-fails.json"),
    ] {
        let v2 = match v2_path {
            "nj-basics.json" => include_str!("../../../exercises/nj-basics.json"),
            "saturation.json" => include_str!("../../../exercises/saturation.json"),
            _ => include_str!("../../../exercises/upgma-fails.json"),
        };
        let a = load_exercise(v1).unwrap_or_else(|e| panic!("v1 {v2_path}: {e}"));
        let b = load_exercise(v2).unwrap_or_else(|e| panic!("v2 {v2_path}: {e}"));
        assert_eq!(a, b, "v1 and v2 {v2_path} load differently");
    }
}

#[test]
fn protein_correction_mismatch() {
    // A protein exercise whose correction is a DNA model.
    let json = V2_SIMULATED.replace(r#""correction": "JTT""#, r#""correction": "JC69""#);
    let err = load_exercise(&json).unwrap_err();
    assert!(
        matches!(err, NeoError::ModelAlphabetMismatch { .. }),
        "expected ModelAlphabetMismatch, got {err:?}"
    );

    // And a JTT simulation under a declared DNA alphabet.
    let json = V2_SIMULATED.replace(r#""alphabet": "protein""#, r#""alphabet": "dna""#);
    let err = load_exercise(&json).unwrap_err();
    assert!(
        matches!(err, NeoError::ModelAlphabetMismatch { .. }),
        "expected ModelAlphabetMismatch, got {err:?}"
    );
}

/// An embedded-data exercise body; `{0}` is the FASTA text, `{1}` the
/// declared alphabet, `{2}` the correction, `{3}` the reference JSON
/// (or `null`).
fn embedded(fasta: &str, alphabet: &str, correction: &str, reference: &str) -> String {
    format!(
        r#"{{
  "schema_version": 2,
  "id": "emb",
  "title": "Embedded",
  "alphabet": "{alphabet}",
  "data": {{
    "kind": "embedded",
    "fasta": "{fasta}",
    "source": {{ "citation": "test", "license": "CC BY 4.0", "accessions": ["P00000"] }}
  }},
  "reference": {reference},
  "analysis": {{ "correction": "{correction}", "method": "NJ" }},
  "locked": [],
  "prompts": []
}}"#
    )
}

/// The PHYLIP protdist documentation sequences (v1.1 spec §3.5): all
/// A/C/G/T, so they detect as DNA, yet every character is also a valid
/// amino acid.
const PROTDIST_DOC: &str =
    ">Alpha\\nAACGTGGCCACAT\\n>Beta\\nAAGGTCGCCACAC\\n>Gamma\\nCAGTTCGCCACAA\\n>Delta\\nGAGATTTCCGCCT\\n>Epsilon\\nGAGATCTCCGCCC";

#[test]
fn embedded_dna_looking_protein_loads() {
    // The declared alphabet is authoritative; detection is only a
    // default. DNA-looking protein data declared "protein" loads, and
    // the exercise's alphabet is Protein.
    let json = embedded(PROTDIST_DOC, "protein", "JTT", "null");
    let ex = load_exercise(&json).unwrap();
    assert_eq!(ex.alphabet, Alphabet::Protein);
    match &ex.data {
        ExerciseData::Embedded { fasta, .. } => {
            // The embedded FASTA really does detect as DNA — the
            // declared-vs-detected mismatch is not an error.
            let aln = parse_fasta(fasta).unwrap();
            assert_eq!(aln.alphabet, Alphabet::Dna);
            // …and the declared alphabet is what tags it downstream.
            let aln = neophylo_core::with_alphabet(aln, ex.alphabet).unwrap();
            assert_eq!(aln.alphabet, Alphabet::Protein);
        }
        other => panic!("expected Embedded, got {other:?}"),
    }
}

#[test]
fn embedded_protein_declared_dna_rejected() {
    // A real protein sequence declared "dna": 'E' (position 1, after
    // the valid IUPAC char 'M') is not a DNA character.
    let json = embedded(">a\\nMEVQLGLGR\\n>b\\nMEVQLGLGA", "dna", "JC69", "null");
    let err = load_exercise(&json).unwrap_err();
    match err {
        NeoError::UnsupportedCharacter { ch, .. } => assert_eq!(ch, 'E'),
        other => panic!("expected UnsupportedCharacter, got {other:?}"),
    }
}

#[test]
fn reference_label_mismatch() {
    // The reference names a leaf absent from the embedded alignment.
    let json = embedded(
        ">a\\nARNDCQEGHILK\\n>b\\nARNDCQEGHILM",
        "protein",
        "JTT",
        r#"{ "newick": "(a:0.1,q:0.2);", "kind": "classification" }"#,
    );
    let err = load_exercise(&json).unwrap_err();
    match err {
        NeoError::LabelMismatch { only_in_a, .. } => {
            assert_eq!(only_in_a, vec!["q".to_string()])
        }
        other => panic!("expected LabelMismatch, got {other:?}"),
    }
}

#[test]
fn embedded_protein_loads() {
    let json = embedded(
        ">Human\\nMGHFTEED\\n>Mouse\\nMGHFTEEN",
        "protein",
        "JTT",
        r#"{ "newick": "(Human:0.1,Mouse:0.2);", "kind": "classification" }"#,
    );
    let ex = load_exercise(&json).unwrap();
    assert_eq!(ex.schema_version, 2);
    assert_eq!(ex.alphabet, Alphabet::Protein);
    match &ex.data {
        ExerciseData::Embedded { fasta, source } => {
            assert!(fasta.contains("MGHFTEED"));
            assert_eq!(source.license, "CC BY 4.0");
            assert_eq!(source.accessions, vec!["P00000".to_string()]);
        }
        other => panic!("expected Embedded, got {other:?}"),
    }
    assert_eq!(
        ex.reference,
        Some(Reference {
            newick: "(Human:0.1,Mouse:0.2);".to_string(),
            kind: ReferenceKind::Classification,
        })
    );
    assert_eq!(ex.analysis.correction, DistModel::Jtt);
}

#[test]
fn reveal_pair_labels_checked_against_alignment() {
    // Checkpoint 12: a prompt's `reveal_pair` names two alignment taxa;
    // a label absent from the alignment fails at load with the field
    // named — for simulated data the labels are the true tree's leaves.
    let good = V2_SIMULATED.replace(
        r#""prompts": []"#,
        r#""prompts": [{ "at_step": 1, "type": "predict_pair", "concept": "?",
          "reveal_pair": ["A", "B"] }]"#,
    );
    let ex = load_exercise(&good).unwrap();
    assert_eq!(
        ex.prompts[0].reveal_pair,
        Some(["A".to_string(), "B".to_string()])
    );

    // Absent label → InvalidExercise on prompts.0.reveal_pair.
    let bad = V2_SIMULATED.replace(
        r#""prompts": []"#,
        r#""prompts": [{ "at_step": 1, "type": "predict_pair", "concept": "?",
          "reveal_pair": ["A", "Zz"] }]"#,
    );
    let err = load_exercise(&bad).unwrap_err();
    match err {
        NeoError::InvalidExercise { field, .. } => {
            assert_eq!(field, "prompts.0.reveal_pair")
        }
        other => panic!("expected InvalidExercise, got {other:?}"),
    }

    // Same check for embedded data — labels come from the FASTA.
    let json = embedded(
        ">a\\nARNDCQEGHILK\\n>b\\nARNDCQEGHILM",
        "protein",
        "JTT",
        "null",
    )
    .replace(
        r#""prompts": []"#,
        r#""prompts": [{ "at_step": 1, "type": "note", "concept": "n",
          "reveal_pair": ["a", "q"] }]"#,
    );
    let err = load_exercise(&json).unwrap_err();
    match err {
        NeoError::InvalidExercise { field, .. } => {
            assert_eq!(field, "prompts.0.reveal_pair")
        }
        other => panic!("expected InvalidExercise, got {other:?}"),
    }
}

#[test]
fn v1_rejects_protein_correction() {
    // v1 exercises are always DNA; protein-only corrections are
    // rejected at load, not left to fail downstream.
    for correction in ["JTT", "Kimura"] {
        let json = V1_SPEC_EXAMPLE.replace(
            r#""correction": "JC69""#,
            &format!(r#""correction": "{correction}""#),
        );
        let err = load_exercise(&json).unwrap_err();
        match err {
            NeoError::ModelAlphabetMismatch { model, alphabet } => {
                assert_eq!(model, correction);
                assert_eq!(alphabet, Alphabet::Dna);
            }
            other => panic!("expected ModelAlphabetMismatch, got {other:?}"),
        }
    }
}

#[test]
fn v1_rejects_protein_sim() {
    // A JTT sim spec in a v1 (always DNA) exercise mismatches too.
    let json = V1_SPEC_EXAMPLE.replace(r#""sim": { "model": "JC69""#, r#""sim": { "model": "JTT""#);
    let err = load_exercise(&json).unwrap_err();
    match err {
        NeoError::ModelAlphabetMismatch { model, alphabet } => {
            assert_eq!(model, "JTT");
            assert_eq!(alphabet, Alphabet::Dna);
        }
        other => panic!("expected ModelAlphabetMismatch, got {other:?}"),
    }
}

// --- v1.2 spec §7.1: predict_branch and the bootstrap block -----------

/// A v2 exercise with a `predict_branch` prompt and a bootstrap block.
/// NJ on 5 taxa has 2 pair joins plus the final three-way join —
/// 4 stepper positions — so `at: "bootstrap"` resolves to at_step 4.
const PREDICT_BRANCH_EXERCISE: &str = r#"{
  "schema_version": 2,
  "id": "boot",
  "title": "Bootstrap",
  "alphabet": "dna",
  "data": {
    "kind": "simulated",
    "true_tree": "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
    "sim": { "model": "JC69", "length": 300, "seed": 42 }
  },
  "analysis": { "correction": "JC69", "method": "NJ" },
  "bootstrap": { "replicates": 100, "seed": 7 },
  "prompts": [
    { "type": "predict_branch", "at": "bootstrap",
      "concept": "Click the internal branch you expect to be weakest." }
  ]
}"#;

#[test]
fn predict_branch_loads_and_anchors_to_the_final_position() {
    let ex = load_exercise(PREDICT_BRANCH_EXERCISE).unwrap();
    assert_eq!(ex.prompts.len(), 1);
    assert_eq!(ex.prompts[0].r#type, PromptType::PredictBranch);
    // NJ on 5 taxa: 4 positions (0..=3); the bootstrap panel shows at
    // the last one, so the resolved step is positions.
    assert_eq!(ex.prompts[0].at_step, 4);
    assert_eq!(
        ex.bootstrap,
        Some(ExerciseBootstrap {
            replicates: 100,
            seed: 7
        })
    );
}

#[test]
fn predict_branch_anchors_final_position_for_upgma_too() {
    // UPGMA on 5 taxa has 5 positions (0..=4) — resolved step is 5.
    let json = PREDICT_BRANCH_EXERCISE.replace(r#""method": "NJ""#, r#""method": "UPGMA""#);
    let ex = load_exercise(&json).unwrap();
    assert_eq!(ex.prompts[0].r#type, PromptType::PredictBranch);
    assert_eq!(ex.prompts[0].at_step, 5);
}

#[test]
fn predict_branch_requires_the_bootstrap_anchor() {
    // A wrong anchor value is rejected.
    let bad = PREDICT_BRANCH_EXERCISE.replace(r#""at": "bootstrap""#, r#""at": "final""#);
    match load_exercise(&bad).unwrap_err() {
        NeoError::InvalidExercise { field, .. } => assert_eq!(field, "prompts.0.at"),
        other => panic!("expected InvalidExercise, got {other:?}"),
    }
    // A missing anchor is rejected.
    let missing = PREDICT_BRANCH_EXERCISE.replace(r#", "at": "bootstrap""#, "");
    match load_exercise(&missing).unwrap_err() {
        NeoError::InvalidExercise { field, .. } => assert_eq!(field, "prompts.0.at"),
        other => panic!("expected InvalidExercise, got {other:?}"),
    }
}

#[test]
fn note_after_loads_and_defaults_to_none() {
    // bootstrap-basics round 3: a bootstrap-stage note can carry an
    // `after` trigger; absent means "show with the step" as before.
    for after in ["first_run", "continue_or_second_run", "longer_run"] {
        let json = PREDICT_BRANCH_EXERCISE.replace(
            r#""concept": "Click the internal branch you expect to be weakest." }"#,
            &format!(
                r#""concept": "Click the internal branch you expect to be weakest." }},
    {{ "at_step": 4, "type": "note", "after": "{after}", "concept": "A note." }}"#
            ),
        );
        let ex = load_exercise(&json).unwrap();
        assert_eq!(ex.prompts.len(), 2);
        assert_eq!(
            ex.prompts[1].after,
            Some(match after {
                "first_run" => NoteAfter::FirstRun,
                "continue_or_second_run" => NoteAfter::ContinueOrSecondRun,
                _ => NoteAfter::LongerRun,
            }),
            "after {after}"
        );
    }
    // Absent `after` stays None.
    let ex = load_exercise(PREDICT_BRANCH_EXERCISE).unwrap();
    assert_eq!(ex.prompts[0].after, None);
}

#[test]
fn note_after_rejects_unknown_values() {
    // Invalid `after` values report prompts.{i}.after — on a note at
    // index 1 the field is "prompts.1.after".
    for bad in ["second_run", "first-run", "done", ""] {
        let json = PREDICT_BRANCH_EXERCISE.replace(
            r#""concept": "Click the internal branch you expect to be weakest." }"#,
            &format!(
                r#""concept": "Click the internal branch you expect to be weakest." }},
    {{ "at_step": 4, "type": "note", "after": "{bad}", "concept": "A note." }}"#
            ),
        );
        match load_exercise(&json).unwrap_err() {
            NeoError::InvalidExercise { field, .. } => {
                assert_eq!(field, "prompts.1.after", "after {bad}")
            }
            other => panic!("expected InvalidExercise, got {other:?}"),
        }
    }
}

#[test]
fn step_prompts_still_require_at_step() {
    // `at` does not substitute for `at_step` on step-anchored types.
    for kind in ["predict_pair", "note"] {
        let json = PREDICT_BRANCH_EXERCISE.replace(
            r#""type": "predict_branch", "at": "bootstrap""#,
            &format!(r#""type": "{kind}", "at": "bootstrap""#),
        );
        match load_exercise(&json).unwrap_err() {
            NeoError::InvalidExercise { field, .. } => {
                assert_eq!(field, "prompts.0.at_step", "type {kind}")
            }
            other => panic!("expected InvalidExercise, got {other:?}"),
        }
    }
}

#[test]
fn bootstrap_replicates_bounded() {
    // spec §3.8/§7.1: exercise replicates are 10..=1,000 and report
    // field "bootstrap.replicates".
    for bad in ["5", "9", "1001", "2000", "-4", "1.5"] {
        let json = PREDICT_BRANCH_EXERCISE
            .replace(r#""replicates": 100"#, &format!(r#""replicates": {bad}"#));
        let err = load_exercise(&json).unwrap_err();
        match err {
            NeoError::InvalidExercise { field, .. } => {
                assert_eq!(field, "bootstrap.replicates", "replicates {bad}")
            }
            other => panic!("expected InvalidExercise, got {other:?}"),
        }
    }
    for ok in ["10", "1000"] {
        let json = PREDICT_BRANCH_EXERCISE
            .replace(r#""replicates": 100"#, &format!(r#""replicates": {ok}"#));
        assert!(load_exercise(&json).is_ok(), "replicates {ok}");
    }
}

#[test]
fn bootstrap_seed_must_be_nonnegative() {
    let json = PREDICT_BRANCH_EXERCISE.replace(r#""seed": 7"#, r#""seed": -1"#);
    match load_exercise(&json).unwrap_err() {
        NeoError::InvalidExercise { field, .. } => assert_eq!(field, "bootstrap.seed"),
        other => panic!("expected InvalidExercise, got {other:?}"),
    }
}
