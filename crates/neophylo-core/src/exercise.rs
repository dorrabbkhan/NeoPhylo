//! Exercise files (spec §7).
//!
//! `load_exercise` parses the lesson JSON through a serde mirror — the
//! file spells `"model": "JC69"` / `"K80"` with a sibling `kappa`, and
//! `"method": "NJ"` / `"UPGMA"` — then validates each field, so a broken
//! exercise reports `NeoError::InvalidExercise` with the failing field
//! instead of a bare serde message. The engine range for `sim.length` is
//! `10..=100_000`; exercise files are additionally capped at `10_000`
//! (spec §4.2). The true tree is parsed and checked for complete branch
//! lengths at load time so `InvalidExercise { field: "true_tree" }`
//! surfaces before any simulation runs.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::algos::Method;
use crate::dist::DistModel;
use crate::error::NeoError;
use crate::newick::parse_newick;
use crate::sim::{check_branch_lengths, check_spec, SimModel, SimSpec};

/// Exercise-level site cap (spec §4.2): files allow `10..=10_000`.
const MAX_EXERCISE_LEN: u32 = 10_000;

/// A parsed, validated exercise (spec §7).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Exercise {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    /// Newick string for the true tree; parsed and validated at load.
    pub true_tree: String,
    pub sim: SimSpec,
    pub analysis: Analysis,
    pub locked: Vec<String>,
    pub prompts: Vec<Prompt>,
}

/// The analysis an exercise prescribes.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Analysis {
    pub correction: DistModel,
    pub method: Method,
}

/// What a prompt asks for at a join step.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum PromptType {
    PredictPair,
    Note,
}

/// A step-triggered teaching prompt (spec §7).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Prompt {
    /// 1-based join step at which the prompt appears.
    pub at_step: u32,
    #[serde(rename = "type")]
    #[ts(rename = "type")]
    pub r#type: PromptType,
    pub concept: String,
    pub math: Option<String>,
    /// Optional explanation shown on a predict_pair card only after the
    /// student picks — used for "the closest pair is not the answer"
    /// reveals (checkpoint 7); a lesson must not spoil the question.
    pub reveal: Option<String>,
}

/// Parse and validate an exercise file (spec §7). `schema_version` must
/// be 1 and `sim.length` at most `10_000`, on top of the engine-level
/// `SimSpec` and true-tree checks.
pub fn load_exercise(json: &str) -> Result<Exercise, NeoError> {
    let f: ExerciseFile = serde_json::from_str(json).map_err(|e| NeoError::InvalidExercise {
        field: missing_field(&e).unwrap_or_else(|| "json".to_string()),
        msg: e.to_string(),
    })?;

    if f.schema_version != 1 {
        return Err(bad("schema_version", "schema_version must be 1"));
    }

    let sim = sim_spec(&f.sim)?;
    check_spec(&sim)?;
    if sim.length > MAX_EXERCISE_LEN {
        return Err(bad("sim.length", "length must be at most 10000"));
    }

    let analysis = Analysis {
        correction: match f.analysis.correction.as_str() {
            "p" => DistModel::P,
            "JC69" => DistModel::Jc69,
            "K80" => DistModel::K80,
            other => {
                return Err(bad(
                    "analysis.correction",
                    &format!("unknown correction '{other}'"),
                ))
            }
        },
        method: match f.analysis.method.as_str() {
            "NJ" => Method::Nj,
            "UPGMA" => Method::Upgma,
            other => return Err(bad("analysis.method", &format!("unknown method '{other}'"))),
        },
    };

    let mut prompts = Vec::with_capacity(f.prompts.len());
    for (i, p) in f.prompts.iter().enumerate() {
        let r#type = match p.kind.as_str() {
            "predict_pair" => PromptType::PredictPair,
            "note" => PromptType::Note,
            other => {
                return Err(bad(
                    &format!("prompts.{i}.type"),
                    &format!("unknown prompt type '{other}'"),
                ))
            }
        };
        prompts.push(Prompt {
            at_step: p.at_step,
            r#type,
            concept: p.concept.clone(),
            math: p.math.clone(),
            reveal: p.reveal.clone(),
        });
    }

    let tree = parse_newick(&f.true_tree).map_err(|e| NeoError::InvalidExercise {
        field: "true_tree".to_string(),
        msg: e.to_string(),
    })?;
    check_branch_lengths(&tree)?;

    Ok(Exercise {
        schema_version: f.schema_version,
        id: f.id,
        title: f.title,
        true_tree: f.true_tree,
        sim,
        analysis,
        locked: f.locked,
        prompts,
    })
}

/// The serde mirror of the `sim` object (spec §7): `model` is a string
/// and `kappa` rides along only for `"K80"`.
fn sim_spec(f: &SimFile) -> Result<SimSpec, NeoError> {
    let length = u32::try_from(f.length)
        .map_err(|_| bad("sim.length", "length must be a non-negative integer"))?;
    let model = match f.model.as_str() {
        "JC69" => SimModel::Jc69,
        "K80" => SimModel::K80 {
            kappa: f
                .kappa
                .ok_or_else(|| bad("sim.kappa", "kappa is required for K80"))?,
        },
        other => return Err(bad("sim.model", &format!("unknown model '{other}'"))),
    };
    Ok(SimSpec {
        model,
        length,
        seed: f.seed,
    })
}

fn bad(field: &str, msg: &str) -> NeoError {
    NeoError::InvalidExercise {
        field: field.to_string(),
        msg: msg.to_string(),
    }
}

/// serde_json reports missing fields as "missing field `x`"; lift `x`
/// into `field` when the message has that shape.
fn missing_field(e: &serde_json::Error) -> Option<String> {
    let s = e.to_string();
    let key = "missing field `";
    let start = s.find(key)? + key.len();
    let end = start + s[start..].find('`')?;
    Some(s[start..end].to_string())
}

// --- serde mirror of the §7 JSON ----------------------------------------------

#[derive(Deserialize)]
struct ExerciseFile {
    schema_version: u32,
    id: String,
    title: String,
    true_tree: String,
    sim: SimFile,
    analysis: AnalysisFile,
    #[serde(default)]
    locked: Vec<String>,
    #[serde(default)]
    prompts: Vec<PromptFile>,
}

#[derive(Deserialize)]
struct SimFile {
    model: String,
    #[serde(default)]
    kappa: Option<f64>,
    /// `i64` so negative or oversized values reach the range check and
    /// report `field: "sim.length"` instead of a generic JSON error.
    length: i64,
    seed: u64,
}

#[derive(Deserialize)]
struct AnalysisFile {
    correction: String,
    method: String,
}

#[derive(Deserialize)]
struct PromptFile {
    at_step: u32,
    #[serde(rename = "type")]
    kind: String,
    concept: String,
    #[serde(default)]
    math: Option<String>,
    #[serde(default)]
    reveal: Option<String>,
}
