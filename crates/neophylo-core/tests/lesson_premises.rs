//! Lesson premises (v1.4c plan Task 10, spec §7.4): the facts every
//! built-in lesson teaches from, proven against the engine itself —
//! never hand-copied numbers. `nj-by-hand` needs "the closest pair is
//! not joined first" and no ambiguous tie; `upgma-vs-nj-matrix` needs
//! "NJ recovers the reference tree, UPGMA does not". `meta` is also
//! pinned: `prepares_for` ids must exist, and adding `meta` to a v5
//! file must change nothing else (§4.2 — "adding `meta` changes no
//! step, prompt or number").

use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use neophylo_core::algos::{build_tree, BuildOptions, Method, Trace};
use neophylo_core::compare::rf;
use neophylo_core::dist::compute;
use neophylo_core::exercise::{load_exercise, Exercise, ExerciseData, PromptType};
use neophylo_core::matrix_input::DistanceInput;
use neophylo_core::newick::parse_newick;
use neophylo_core::seq::parse_fasta;
use neophylo_core::sim::simulate;
use neophylo_core::with_alphabet;
use neophylo_core::worksheet::{worksheet_facts, JoinFacts};

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

fn load(id: &str) -> Exercise {
    load_exercise(&lesson_text(id)).unwrap_or_else(|e| panic!("{id}: {e}"))
}

/// The distance matrix the lesson's pipeline builds: simulated and
/// embedded data go through the alignment path, matrix data straight
/// through `DistanceInput` — the same split `analysisInitial` makes.
/// A `Result` because a lesson may start broken on purpose
/// (`saturation` computes into a SaturatedMatrix until the student
/// applies a fix).
fn distance_matrix(
    ex: &Exercise,
) -> Result<neophylo_core::dist::DistanceMatrix, neophylo_core::NeoError> {
    match &ex.data {
        ExerciseData::Simulated { true_tree, sim } => {
            let tree = parse_newick(true_tree)?;
            let aln = simulate(&tree, sim)?;
            let aln = with_alphabet(aln, ex.alphabet)?;
            compute(&aln, ex.analysis.correction)
        }
        ExerciseData::Embedded { fasta, .. } => {
            let aln = parse_fasta(fasta)?;
            let aln = with_alphabet(aln, ex.alphabet)?;
            compute(&aln, ex.analysis.correction)
        }
        ExerciseData::Matrix { names, lower, .. } => DistanceInput {
            names: names.clone(),
            lower: lower.clone(),
        }
        .to_distance_matrix(),
    }
}

fn facts(id: &str, method: Method) -> (Exercise, Vec<JoinFacts>) {
    let ex = load(id);
    let m = distance_matrix(&ex).unwrap_or_else(|e| panic!("{id}: {e}"));
    (
        ex,
        worksheet_facts(&m, method).unwrap_or_else(|e| panic!("{id}: {e}")),
    )
}

/// The lesson's trace, or the error its pipeline produces — lessons
/// that start broken compare equal on the error.
fn trace_of(ex: &Exercise) -> Result<Trace, neophylo_core::NeoError> {
    Ok(build_tree(
        &distance_matrix(ex)?,
        ex.analysis.method,
        BuildOptions { trace: true },
    )?
    .trace
    .unwrap())
}

// --- nj-by-hand (§7.4): predict each join; the first join is not the
// closest pair; no ambiguous tie anywhere -----------------------------

#[test]
fn nj_by_hand_first_join_is_not_the_closest_pair() {
    let (_, facts) = facts("nj-by-hand", Method::Nj);
    let first = &facts[0];
    assert!(
        !first.chosen_is_closest,
        "the lesson's premise needs the first join {:?} to lose the raw-distance race to {:?}",
        first.chosen, first.closest
    );
    // The tempting answer students must learn to doubt is d–e, the
    // matrix's smallest cell.
    assert_eq!(first.closest, [("d".to_string(), "e".to_string())]);
}

#[test]
fn nj_by_hand_has_no_ambiguous_tie() {
    // Every join is either unique or the benign four-active complement
    // tie (either choice gives the same split) — a predict_pair answer
    // is never unfair.
    let (_, facts) = facts("nj-by-hand", Method::Nj);
    for f in &facts {
        assert!(
            f.tied.len() == 1 || f.tie_same_split,
            "join {} ties {:?} without yielding the same split",
            f.step,
            f.tied
        );
    }
    // …and the one tie it does have is exactly that complement tie at
    // four active nodes.
    assert!(facts.iter().any(|f| f.tie_same_split));
}

#[test]
fn predict_pair_prompts_target_tie_free_non_final_joins() {
    // The predict_pair grader accepts only the engine's chosen pair, so
    // a lesson may only ask at a join with a unique answer — the tied
    // join and the final three-way join are off limits.
    for (id, method) in [
        ("nj-by-hand", Method::Nj),
        ("upgma-vs-nj-matrix", Method::Nj),
    ] {
        let (ex, facts) = facts(id, method);
        for p in &ex.prompts {
            if p.r#type != PromptType::PredictPair {
                continue;
            }
            let f = facts
                .get((p.at_step - 1) as usize)
                .unwrap_or_else(|| panic!("{id}: predict_pair at step {}", p.at_step));
            assert!(!f.final_join, "{id}: predict_pair at the final join");
            assert_eq!(
                f.tied.len(),
                1,
                "{id}: predict_pair at step {} asks a tied join {:?}",
                p.at_step,
                f.tied
            );
        }
    }
}

// --- upgma-vs-nj-matrix (§7.4): additive matrix of a non-ultrametric
// tree — NJ recovers it, UPGMA does not --------------------------------

#[test]
fn upgma_vs_nj_nj_recovers_the_reference_upgma_does_not() {
    let ex = load("upgma-vs-nj-matrix");
    let reference = ex.reference.as_ref().expect("reference tree");
    let truth = parse_newick(&reference.newick).unwrap();
    let m = distance_matrix(&ex).unwrap();

    let nj = build_tree(&m, Method::Nj, BuildOptions { trace: false })
        .unwrap()
        .tree;
    let upgma = build_tree(&m, Method::Upgma, BuildOptions { trace: false })
        .unwrap()
        .tree;

    assert_eq!(
        rf(&truth, &nj).unwrap().rf,
        0,
        "NJ must recover the reference tree"
    );
    assert!(
        rf(&truth, &upgma).unwrap().rf > 0,
        "UPGMA must get the reference tree wrong — that is the lesson"
    );
}

// --- meta (§4.2) -------------------------------------------------------

#[test]
fn every_prepares_for_id_exists() {
    // Every lesson/lab file's declared id, then every meta.prepares_for
    // across them must land on one. ids are file stems (loadLesson and
    // the lab pages fetch by stem), so collect them from the files.
    let mut ids = BTreeSet::new();
    let mut files: Vec<(String, serde_json::Value)> = Vec::new();
    for dir in [exercises_dir(), exercises_dir().join("labs")] {
        for entry in fs::read_dir(&dir).unwrap() {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("json")
                || path.file_name().unwrap() == "schema.json"
            {
                continue;
            }
            let doc: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
            let id = doc["id"].as_str().unwrap().to_string();
            ids.insert(id.clone());
            files.push((id, doc));
        }
    }
    for (id, doc) in &files {
        let Some(meta) = doc.get("meta") else {
            continue;
        };
        for target in meta["prepares_for"].as_array().unwrap() {
            let target = target.as_str().unwrap();
            assert!(
                ids.contains(target),
                "{id}: meta.prepares_for names missing lesson/lab \"{target}\""
            );
        }
    }
}

#[test]
fn adding_meta_changes_nothing_else() {
    // §4.2: "adding meta changes no step, prompt or number." Strip
    // `meta` and reset the file to the version each lesson declared
    // before this task (2 — all six were v2): the load must equal the
    // v5 load on every other field, and the trace the student steps
    // through must be identical.
    for name in LESSON_FILES
        .iter()
        .copied()
        .filter(|n| *n != "nj-by-hand" && *n != "upgma-vs-nj-matrix")
    {
        let text = lesson_text(name);
        let full = load_exercise(&text).unwrap_or_else(|e| panic!("{name}: {e}"));
        assert!(full.meta.is_some(), "{name}: meta missing");
        let mut doc: serde_json::Value = serde_json::from_str(&text).unwrap();
        doc.as_object_mut().unwrap().remove("meta");
        doc["schema_version"] = serde_json::json!(2);
        let stripped =
            load_exercise(&doc.to_string()).unwrap_or_else(|e| panic!("{name} stripped: {e}"));
        let mut want = full.clone();
        want.meta = None;
        want.schema_version = 2;
        assert_eq!(
            want, stripped,
            "{name}: more than meta/schema_version changed"
        );
        assert_eq!(
            trace_of(&full),
            trace_of(&stripped),
            "{name}: the trace changed"
        );
    }
}
