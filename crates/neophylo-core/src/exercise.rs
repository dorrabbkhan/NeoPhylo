//! Exercise files (spec §7, v1.1 spec §3.6).
//!
//! `load_exercise` parses the lesson JSON through a serde mirror — the
//! file spells `"model": "JC69"` / `"K80"` / `"JTT"` with a sibling
//! `kappa`, `"method": "NJ"` / `"UPGMA"`, and schema v2 wraps the data in
//! `data.kind` — then validates each field, so a broken exercise reports
//! `NeoError::InvalidExercise` with the failing field instead of a bare
//! serde message. The engine range for `sim.length` is `10..=100_000`;
//! exercise files are additionally capped at `10_000` (spec §4.2).
//!
//! `schema_version` 1 files migrate on load: `data` becomes
//! `Simulated { true_tree, sim }`, `reference` becomes
//! `{ newick: true_tree, kind: "true" }` and `alphabet` is `"dna"`
//! (v1.1 spec §3.6). A loaded `Exercise` is always normalized to the v2
//! shape. The true tree is parsed and checked for complete branch
//! lengths at load time so `InvalidExercise { field: "true_tree" }`
//! surfaces before any simulation runs; an embedded FASTA is parsed and
//! re-validated against the declared `alphabet`.

use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use ts_rs::TS;

use crate::algos::Method;
use crate::alphabet::{with_alphabet, Alphabet};
use crate::dist::DistModel;
use crate::error::NeoError;
use crate::newick::parse_newick;
use crate::seq::parse_fasta;
use crate::sim::{check_branch_lengths, check_spec, SimModel, SimSpec};

/// Exercise-level site cap (spec §4.2): files allow `10..=10_000`.
const MAX_EXERCISE_LEN: u32 = 10_000;

/// A parsed, validated exercise (v1.1 spec §3.6). Always normalized to
/// the v2 shape; `schema_version` reports the current version (2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Exercise {
    pub schema_version: u32,
    pub id: String,
    pub title: String,
    pub alphabet: Alphabet,
    pub data: ExerciseData,
    pub reference: Option<Reference>,
    pub analysis: Analysis,
    pub locked: Vec<String>,
    pub prompts: Vec<Prompt>,
}

/// Where an exercise's alignment comes from (v1.1 spec §3.6): simulated
/// along `true_tree`, or a fixed aligned FASTA with provenance.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[ts(tag = "kind", rename_all = "lowercase")]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum ExerciseData {
    /// Sequences are simulated along `true_tree` under `sim`.
    Simulated { true_tree: String, sim: SimSpec },
    /// A fixed alignment embedded in the lesson file.
    Embedded { fasta: String, source: Source },
}

/// Provenance of an embedded alignment (v1.1 spec §3.6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Source {
    pub citation: String,
    pub license: String,
    pub accessions: Vec<String>,
}

/// What a reference tree represents (v1.1 spec §3.6): a known true tree
/// from simulation, or an accepted classification.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(rename_all = "lowercase")]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum ReferenceKind {
    True,
    Classification,
}

/// The tree the inferred tree is compared against (v1.1 spec §3.6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Reference {
    pub newick: String,
    pub kind: ReferenceKind,
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

/// Parse and validate an exercise file. `schema_version` must be 1 or 2;
/// v1 files are migrated to the v2 `Exercise` shape (v1.1 spec §3.6).
/// `sim.length` is capped at `10_000` on top of the engine-level
/// `SimSpec` checks.
pub fn load_exercise(json: &str) -> Result<Exercise, NeoError> {
    let f: ExerciseFile = serde_json::from_str(json).map_err(|e| NeoError::InvalidExercise {
        field: missing_field(&e).unwrap_or_else(|| "json".to_string()),
        msg: e.to_string(),
    })?;

    match f.schema_version {
        1 => load_v1(f),
        2 => load_v2(f),
        v => Err(bad(
            "schema_version",
            &format!("schema_version must be 1 or 2, got {v}"),
        )),
    }
}

/// A v1 file: flat `true_tree`/`sim`, DNA only. Migrates to v2
/// (`data.kind = "simulated"`, a `kind: "true"` reference on the same
/// Newick) while preserving the v1 validation order.
fn load_v1(f: ExerciseFile) -> Result<Exercise, NeoError> {
    let true_tree = f
        .true_tree
        .ok_or_else(|| bad("true_tree", "required for schema_version 1"))?;
    let sim = f
        .sim
        .ok_or_else(|| bad("sim", "required for schema_version 1"))?;
    let sim = checked_sim(&sim)?;
    // v1 exercises are always DNA; reject protein-only models at load
    // rather than leaving them to fail downstream.
    if matches!(sim.model, SimModel::Jtt) {
        return Err(NeoError::ModelAlphabetMismatch {
            model: sim_model_name(&sim.model).to_string(),
            alphabet: Alphabet::Dna,
        });
    }
    let analysis = analysis(&f.analysis)?;
    if !analysis.correction.supports(Alphabet::Dna) {
        return Err(NeoError::ModelAlphabetMismatch {
            model: analysis.correction.name().to_string(),
            alphabet: Alphabet::Dna,
        });
    }
    let prompts = prompts(&f.prompts)?;

    let tree = parse_newick(&true_tree).map_err(|e| NeoError::InvalidExercise {
        field: "true_tree".to_string(),
        msg: e.to_string(),
    })?;
    check_branch_lengths(&tree)?;

    Ok(Exercise {
        schema_version: 2,
        id: f.id,
        title: f.title,
        alphabet: Alphabet::Dna,
        reference: Some(Reference {
            newick: true_tree.clone(),
            kind: ReferenceKind::True,
        }),
        data: ExerciseData::Simulated { true_tree, sim },
        analysis,
        locked: f.locked,
        prompts,
    })
}

/// A v2 file: declared `alphabet`, `data.kind` choosing simulated vs
/// embedded, and an optional `reference`.
fn load_v2(f: ExerciseFile) -> Result<Exercise, NeoError> {
    let alphabet = match f.alphabet.as_deref() {
        Some("dna") => Alphabet::Dna,
        Some("protein") => Alphabet::Protein,
        Some(other) => {
            return Err(bad("alphabet", &format!("unknown alphabet '{other}'")));
        }
        None => return Err(bad("alphabet", "alphabet is required for schema_version 2")),
    };
    let data = f
        .data
        .ok_or_else(|| bad("data", "data is required for schema_version 2"))?;
    let analysis = analysis(&f.analysis)?;

    // Per-kind validation; `labels` are the alignment's leaf labels,
    // which the reference tree must match.
    let (data, labels) = match data {
        DataFile::Simulated { true_tree, sim } => {
            let sim = checked_sim(&sim)?;
            let sim_alphabet = match sim.model {
                SimModel::Jtt => Alphabet::Protein,
                _ => Alphabet::Dna,
            };
            if sim_alphabet != alphabet {
                return Err(NeoError::ModelAlphabetMismatch {
                    model: sim_model_name(&sim.model).to_string(),
                    alphabet,
                });
            }
            let tree = parse_newick(&true_tree).map_err(|e| bad("true_tree", &e.to_string()))?;
            check_branch_lengths(&tree)?;
            (
                ExerciseData::Simulated { true_tree, sim },
                tree.leaf_labels(),
            )
        }
        DataFile::Embedded { fasta, source } => {
            // The declared alphabet is authoritative: characters must
            // be valid under it (`with_alphabet` gives
            // UnsupportedCharacter). Detection is only a default for
            // interactive imports, so a declared-vs-detected mismatch —
            // e.g. DNA-looking protein data — is not an error.
            let parsed = parse_fasta(&fasta)?;
            let aln = with_alphabet(parsed, alphabet)?;
            (ExerciseData::Embedded { fasta, source }, aln.labels)
        }
    };

    if !analysis.correction.supports(alphabet) {
        return Err(NeoError::ModelAlphabetMismatch {
            model: analysis.correction.name().to_string(),
            alphabet,
        });
    }

    let reference = reference(f.reference, &labels)?;
    let prompts = prompts(&f.prompts)?;

    Ok(Exercise {
        schema_version: 2,
        id: f.id,
        title: f.title,
        alphabet,
        data,
        reference,
        analysis,
        locked: f.locked,
        prompts,
    })
}

/// Convert and validate a file `sim` block: `SimSpec` checks plus the
/// exercise-level `10_000`-site cap.
fn checked_sim(f: &SimFile) -> Result<SimSpec, NeoError> {
    let sim = sim_spec(f)?;
    check_spec(&sim)?;
    if sim.length > MAX_EXERCISE_LEN {
        return Err(bad("sim.length", "length must be at most 10000"));
    }
    Ok(sim)
}

/// The serde mirror of the `sim` object: `model` is a string and `kappa`
/// rides along only for `"K80"`.
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
        "JTT" => SimModel::Jtt,
        other => return Err(bad("sim.model", &format!("unknown model '{other}'"))),
    };
    Ok(SimSpec {
        model,
        length,
        seed: f.seed,
    })
}

/// The serde mirror of the `analysis` object (v1.1 spec §3.6):
/// `"correction": "p"|"JC69"|"K80"|"Kimura"|"JTT"`.
fn analysis(f: &AnalysisFile) -> Result<Analysis, NeoError> {
    Ok(Analysis {
        correction: match f.correction.as_str() {
            "p" => DistModel::P,
            "JC69" => DistModel::Jc69,
            "K80" => DistModel::K80,
            "Kimura" => DistModel::Kimura,
            "JTT" => DistModel::Jtt,
            other => {
                return Err(bad(
                    "analysis.correction",
                    &format!("unknown correction '{other}'"),
                ))
            }
        },
        method: match f.method.as_str() {
            "NJ" => Method::Nj,
            "UPGMA" => Method::Upgma,
            other => return Err(bad("analysis.method", &format!("unknown method '{other}'"))),
        },
    })
}

/// Parse and label-check the `reference` object. The reference's leaf
/// labels must equal the alignment's labels (`LabelMismatch`, v1.1 spec
/// §3.6); branch lengths are not required — the reference is compared
/// topologically, never simulated along.
fn reference(f: Option<ReferenceFile>, labels: &[String]) -> Result<Option<Reference>, NeoError> {
    let Some(f) = f else { return Ok(None) };
    let kind = match f.kind.as_str() {
        "true" => ReferenceKind::True,
        "classification" => ReferenceKind::Classification,
        other => {
            return Err(bad(
                "reference.kind",
                &format!("unknown reference kind '{other}'"),
            ))
        }
    };
    let tree = parse_newick(&f.newick).map_err(|e| bad("reference.newick", &e.to_string()))?;
    let ref_labels: BTreeSet<String> = tree.leaf_labels().into_iter().collect();
    let aln_labels: BTreeSet<String> = labels.iter().cloned().collect();
    if ref_labels != aln_labels {
        return Err(NeoError::LabelMismatch {
            only_in_a: ref_labels.difference(&aln_labels).cloned().collect(),
            only_in_b: aln_labels.difference(&ref_labels).cloned().collect(),
        });
    }
    Ok(Some(Reference {
        newick: f.newick,
        kind,
    }))
}

/// Convert the file's prompt array, reporting the index of a bad `type`.
fn prompts(fs: &[PromptFile]) -> Result<Vec<Prompt>, NeoError> {
    let mut prompts = Vec::with_capacity(fs.len());
    for (i, p) in fs.iter().enumerate() {
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
    Ok(prompts)
}

/// The file's spelling of a `SimModel` name.
fn sim_model_name(m: &SimModel) -> &'static str {
    match m {
        SimModel::Jc69 => "JC69",
        SimModel::K80 { .. } => "K80",
        SimModel::Jtt => "JTT",
    }
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

// --- serde mirror of the exercise file JSON ---------------------------------
// The mirror tracks the *file* shape (both versions); the public types
// serialize in their own field shape, as in v1 (e.g. a `SimSpec` inside
// `data` keeps its `"Jc69"` model spelling on the wire).

#[derive(Deserialize)]
struct ExerciseFile {
    schema_version: u32,
    id: String,
    title: String,
    /// v2: the declared alphabet; absent in v1 files.
    #[serde(default)]
    alphabet: Option<String>,
    /// v2: the tagged data block.
    #[serde(default)]
    data: Option<DataFile>,
    /// v2: the comparison tree; `null` or absent means none.
    #[serde(default)]
    reference: Option<ReferenceFile>,
    /// v1 fields: flat true tree and simulation spec.
    #[serde(default)]
    true_tree: Option<String>,
    #[serde(default)]
    sim: Option<SimFile>,
    analysis: AnalysisFile,
    #[serde(default)]
    locked: Vec<String>,
    #[serde(default)]
    prompts: Vec<PromptFile>,
}

#[derive(Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
enum DataFile {
    Simulated { true_tree: String, sim: SimFile },
    Embedded { fasta: String, source: Source },
}

#[derive(Deserialize)]
struct ReferenceFile {
    newick: String,
    kind: String,
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
