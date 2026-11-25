//! Golden variants (v1.5 spec §5.8, plan Task 5): pinned per-student
//! variant output — seed, retry, `fell_back`, a content digest, a
//! readable excerpt and every task's accepted answer — for six
//! assignments (one per content kind) × five ids.
//!
//! Files live in `tests/assess_golden/` next to this test (not
//! `fixtures/`, so code PRs can carry them); changing one is an owner
//! gate like a fixture. They are written by the ignored
//! `regen_assess_golden` test — never edited by hand:
//! `cargo test -p neophylo-core --test assess_golden -- --ignored regen_assess_golden`.

use std::fs;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use neophylo_core::assess::{
    content_hash, name_table, normalise_id, task_key, AcceptedAnswer, Assignment, Content,
    GradedTask, IdPrompt, IdRule, Mode, TaskRef, Variant, GENERATOR_VERSION,
};
use neophylo_core::assess::{PairRole, Quantity};
use neophylo_core::exercise::{load_exercise, Exercise, ExerciseData};
use neophylo_core::reading::load_reading_set;

/// The five reviewed ids: a plain login, an id with surrounding
/// space and mixed case, a non-ASCII name, a hyphenated id, and a
/// 64-byte id at `MAX_ID_BYTES`.
const IDS: [&str; 5] = [
    "ada",
    " Ana.Lopez@Uni.edu ",
    "josé",
    "student-42",
    "student-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
];

const REGEN: &str =
    "cargo test -p neophylo-core --test assess_golden -- --ignored regen_assess_golden";

fn exercises_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("exercises")
}

fn golden_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("tests")
        .join("assess_golden")
}

fn lesson(id: &str) -> Exercise {
    let text = fs::read_to_string(exercises_dir().join(format!("{id}.json"))).unwrap();
    load_exercise(&text).unwrap()
}

fn assignment(id: &str, content: Content, tasks: Vec<TaskRef>) -> Assignment {
    Assignment {
        id: id.to_string(),
        title: id.to_string(),
        instructions: None,
        content,
        content_hash: None,
        served_content_hash: None,
        id_prompt: IdPrompt {
            label: "Student ID".to_string(),
            rule: IdRule::TrimLower,
        },
        mode: Mode::Practice,
        variation: true,
        tasks: tasks
            .into_iter()
            .map(|task| GradedTask { task, points: 1.0 })
            .collect(),
    }
}

fn reading_set() -> Content {
    let text = fs::read_to_string(exercises_dir().join("reading/trees-demo.json")).unwrap();
    Content::Reading(load_reading_set(&text).unwrap())
}

/// The six golden assignments, one per content kind.
fn cases() -> Vec<(&'static str, Assignment)> {
    vec![
        (
            "simulated-lesson",
            assignment(
                "golden-simulated",
                Content::Exercise(lesson("nj-basics")),
                vec![
                    TaskRef::PredictPair { step: 1 },
                    TaskRef::PredictPair { step: 2 },
                ],
            ),
        ),
        (
            "derived-matrix",
            assignment(
                "golden-derived",
                Content::Exercise(lesson("upgma-vs-nj-matrix")),
                vec![
                    TaskRef::PredictPair { step: 1 },
                    TaskRef::PredictPair { step: 2 },
                ],
            ),
        ),
        (
            "fixed-data-lab",
            assignment(
                "golden-fixed-data",
                Content::Exercise(lesson("cytochrome-c")),
                vec![TaskRef::PredictPair { step: 1 }],
            ),
        ),
        (
            "reading-set",
            assignment(
                "golden-reading",
                reading_set(),
                vec![
                    TaskRef::Reading { item: 3 },
                    TaskRef::Reading { item: 4 },
                    TaskRef::Reading { item: 6 },
                    TaskRef::Reading { item: 10 },
                    TaskRef::Reading { item: 11 },
                    TaskRef::Reading { item: 22 },
                    TaskRef::Reading { item: 23 },
                ],
            ),
        ),
        (
            "bootstrap-predict-branch",
            assignment(
                "golden-bootstrap",
                Content::Exercise(lesson("bootstrap-basics")),
                vec![TaskRef::PredictBranch],
            ),
        ),
        (
            "numeric-tasks",
            assignment(
                "golden-numeric",
                Content::Exercise(lesson("nj-basics")),
                vec![
                    TaskRef::Numeric {
                        step: 1,
                        quantity: Quantity::CorrectedDistance,
                        role: PairRole::Chosen,
                    },
                    TaskRef::Numeric {
                        step: 1,
                        quantity: Quantity::QValue,
                        role: PairRole::Chosen,
                    },
                    TaskRef::Numeric {
                        step: 2,
                        quantity: Quantity::CorrectedDistance,
                        role: PairRole::Chosen,
                    },
                ],
            ),
        ),
    ]
}

#[derive(Serialize, Deserialize, PartialEq, Debug)]
struct Golden {
    /// The code layout this variant data was pinned under
    /// (`GENERATOR_VERSION`).
    generator: u8,
    /// The assignment, inline.
    assignment: serde_json::Value,
    ids: Vec<GoldenId>,
}

#[derive(Serialize, Deserialize, PartialEq, Debug)]
struct GoldenId {
    /// The id as the student typed it.
    id: String,
    /// `normalise_id` under the assignment's rule.
    normalised: String,
    /// The variant's bootstrap seed, as a decimal string.
    seed: String,
    retry: u8,
    fell_back: bool,
    /// `content_hash` of `serde_json::to_vec(&variant.content)`.
    data_digest: String,
    /// What a reviewer can eyeball: the variant's taxon order, and
    /// for a matrix exercise the first row of its served matrix.
    excerpt: Excerpt,
    /// Every graded task's accepted answer on this variant.
    answers: Vec<GoldenAnswer>,
}

#[derive(Serialize, Deserialize, PartialEq, Debug)]
struct Excerpt {
    taxa: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    first_row: Option<Vec<f64>>,
}

#[derive(Serialize, Deserialize, PartialEq, Debug)]
struct GoldenAnswer {
    task: TaskRef,
    accepted: AcceptedAnswer,
}

/// The full first row of a served matrix — `d(taxon 0, taxon j)` for
/// every `j`, read back out of the packed lower triangle.
fn first_row(ex: &Exercise) -> Option<Vec<f64>> {
    let ExerciseData::Matrix { names, lower, .. } = &ex.data else {
        return None;
    };
    let n = names.len();
    Some(
        (0..n)
            .map(|j| if j == 0 { 0.0 } else { lower[j * (j - 1) / 2] })
            .collect(),
    )
}

fn golden_id(a: &Assignment, id: &str) -> GoldenId {
    let variant: Variant = a.variant_for(id).unwrap();
    let normalised = normalise_id(id, a.id_prompt.rule).unwrap();
    let taxa = name_table(&variant).unwrap();
    let row = match &variant.content {
        Content::Exercise(ex) => first_row(ex),
        Content::Reading(_) => None,
    };
    let answers = a
        .tasks
        .iter()
        .map(|gt| GoldenAnswer {
            task: gt.task,
            accepted: task_key(&variant, &gt.task).unwrap(),
        })
        .collect();
    GoldenId {
        id: id.to_string(),
        normalised,
        seed: variant.seed.to_string(),
        retry: variant.retry,
        fell_back: variant.fell_back,
        data_digest: content_hash(&serde_json::to_vec(&variant.content).unwrap()),
        excerpt: Excerpt {
            taxa,
            first_row: row,
        },
        answers,
    }
}

fn golden_for(a: &Assignment) -> Golden {
    Golden {
        generator: GENERATOR_VERSION,
        assignment: serde_json::to_value(a).unwrap(),
        ids: IDS.iter().map(|id| golden_id(a, id)).collect(),
    }
}

#[test]
fn golden_variants_recompute_exactly() {
    for (stem, a) in cases() {
        let path = golden_dir().join(format!("{stem}.json"));
        let text = fs::read_to_string(&path).unwrap_or_else(|_| {
            panic!(
                "missing golden file {} — regenerate with `{REGEN}`",
                path.display()
            )
        });
        let golden: Golden = serde_json::from_str(&text)
            .unwrap_or_else(|e| panic!("bad golden file {}: {e}", path.display()));
        assert_eq!(
            golden,
            golden_for(&a),
            "golden file {} is stale — regenerate with `{REGEN}`",
            path.display()
        );
    }
    // No stray files: the directory holds exactly the cases.
    let mut files: Vec<String> = fs::read_dir(golden_dir())
        .unwrap()
        .filter_map(|e| {
            let name = e.unwrap().file_name().to_string_lossy().into_owned();
            name.ends_with(".json")
                .then(|| name.trim_end_matches(".json").to_string())
        })
        .collect();
    files.sort();
    let mut expected: Vec<String> = cases().iter().map(|(s, _)| s.to_string()).collect();
    expected.sort();
    assert_eq!(
        files, expected,
        "unexpected golden files — regenerate with `{REGEN}`"
    );
}

/// Regenerate every file under `tests/assess_golden/`. Ignored by
/// default (the only allowed ignore besides `regen_golden`):
/// `cargo test -p neophylo-core --test assess_golden -- --ignored regen_assess_golden`.
#[test]
#[ignore]
fn regen_assess_golden() {
    fs::create_dir_all(golden_dir()).unwrap();
    for (stem, a) in cases() {
        let path = golden_dir().join(format!("{stem}.json"));
        let mut text = serde_json::to_string_pretty(&golden_for(&a)).unwrap();
        text.push('\n');
        fs::write(&path, text).unwrap();
        eprintln!("wrote {}", path.display());
    }
}
