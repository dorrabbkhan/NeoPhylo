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
//!
//! Later versions only add fields: v3 adds `analysis.kappa`,
//! `sim.base_freqs` and the F84/K2P_PHYLIP identifiers (v1.4 spec §4),
//! v4 adds `analysis.site_filter` and the `"Poisson"` identifier
//! (v1.4b spec §4). Fields newer than the declared version are refused
//! at their own path, presence-aware — a `"key": null` counts as
//! present, never as absent.

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
use crate::site_filter::SiteFilter;

/// Exercise-level site cap (spec §4.2): files allow `10..=10_000`.
const MAX_EXERCISE_LEN: u32 = 10_000;

/// The schema version every writer emits once it supports the v1.4b
/// fields (v1.4b spec §4). `load_exercise` accepts 1, 2, 3 and 4.
pub const CURRENT_SCHEMA_VERSION: u32 = 4;

/// A parsed, validated exercise (v1.1 spec §3.6, v1.4 spec §4, v1.4b
/// spec §4). Always normalized to the v2-or-later shape;
/// `schema_version` reports 2 for v1 and v2 files, 3 for v3 files and
/// 4 for v4 files.
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
    /// The lesson's own bootstrap settings (v1.2 spec §7.1); `None`
    /// leaves the app defaults (100 replicates, seed 1).
    #[serde(default)]
    pub bootstrap: Option<ExerciseBootstrap>,
}

/// An exercise file's `bootstrap` block (v1.2 spec §7.1): the panel's
/// initial replicates and seed. `replicates` is validated to the
/// engine's 10–1,000 range (§3.8) at load.
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct ExerciseBootstrap {
    pub replicates: u32,
    #[ts(type = "number")]
    pub seed: u64,
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
    /// v1.4 spec §4: the transition/transversion ratio for
    /// `K2P_PHYLIP`; always `Some` then (default 2.0 when the file
    /// omits it) and `None` for every other correction — F84 uses
    /// dnadist's fixed 2.0, so a stray kappa would mislead. Omitted
    /// from the wire shape so v2 exercises serialize unchanged.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub kappa: Option<f64>,
    /// v1.4b spec §4: MEGA's gap treatment applied to the alignment
    /// before distances. `None` means `SiteFilter::Pairwise` — the
    /// pre-v1.4b path — so v2/v3 files serialize unchanged; a file may
    /// write `{ "kind": "pairwise" }` explicitly and keep `Some(..)` so
    /// the file round-trips. Omitted from the wire shape then, as
    /// `kappa` is.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub site_filter: Option<SiteFilter>,
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
    /// v1.2 spec §7.1: anchored to the bootstrap panel (`at:
    /// "bootstrap"` in the file), not a join step.
    PredictBranch,
}

/// When a bootstrap-stage note becomes visible (bootstrap-basics
/// round 3): a sequenced note stays hidden until its trigger — the
/// first completed run, a second run or a Continue on the previous
/// note, or a completed run on a longer alignment — and never
/// disappears once shown.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum NoteAfter {
    /// After the first completed bootstrap run.
    FirstRun,
    /// After a second completed run, or a Continue on the `first_run`
    /// note.
    ContinueOrSecondRun,
    /// After a completed run on a longer alignment, or a Continue on
    /// the `continue_or_second_run` note.
    LongerRun,
}

/// A step-triggered teaching prompt (spec §7).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Prompt {
    /// 1-based join step at which the prompt appears. For
    /// `predict_branch` (file anchor `at: "bootstrap"`) this is
    /// resolved at load to one past the final join — the stepper
    /// position where the "How sure are we?" panel shows (v1.2 spec
    /// §7.1).
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
    /// Optional pair of taxon labels: the answered card offers a
    /// "Show a vs b" button opening the pair-detail panel, and the next
    /// step's explanation keeps a "Revisit" link (checkpoint 12). Both
    /// labels must be alignment taxon names — checked at load.
    #[serde(default)]
    pub reveal_pair: Option<[String; 2]>,
    /// Optional sequencing trigger on a bootstrap-stage note
    /// (bootstrap-basics round 3): the note stays hidden until the
    /// trigger — a completed run, a second run or a Continue — and
    /// never disappears once shown. `None` shows with the step.
    #[serde(default)]
    pub after: Option<NoteAfter>,
}

/// Parse and validate an exercise file. `schema_version` must be 1, 2,
/// 3 or 4; v1 files are migrated to the v2 `Exercise` shape (v1.1 spec
/// §3.6), v3 files follow the v2 rules plus the v1.4 fields (§4) and v4
/// files add the v1.4b fields (`analysis.site_filter`, the `"Poisson"`
/// correction). `sim.length` is capped at `10_000` on top of the
/// engine-level `SimSpec` checks.
pub fn load_exercise(json: &str) -> Result<Exercise, NeoError> {
    let f: ExerciseFile = serde_json::from_str(json).map_err(|e| NeoError::InvalidExercise {
        field: missing_field(&e).unwrap_or_else(|| "json".to_string()),
        msg: e.to_string(),
    })?;

    match f.schema_version {
        1 => load_v1(f),
        2 => load_v2(f, 2),
        v @ (3 | 4) => {
            // A v3/v4 file uses the v2 shape; a flat v1 body claiming
            // either is a version mismatch, so the refusal names
            // schema_version rather than a missing `alphabet`.
            if f.data.is_none() && (f.true_tree.is_some() || f.sim.is_some()) {
                Err(bad(
                    "schema_version",
                    "a file in the v1 shape must declare schema_version 1",
                ))
            } else {
                load_v2(f, v)
            }
        }
        v => Err(bad(
            "schema_version",
            &format!("schema_version must be 1, 2, 3 or 4, got {v}"),
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
    let sim = checked_sim(&sim, 1)?;
    // v1 exercises are always DNA; reject protein-only models at load
    // rather than leaving them to fail downstream.
    if matches!(sim.model, SimModel::Jtt) {
        return Err(NeoError::ModelAlphabetMismatch {
            model: sim_model_name(&sim.model).to_string(),
            alphabet: Alphabet::Dna,
        });
    }
    let analysis = analysis(&f.analysis, 1)?;
    if !analysis.correction.supports(Alphabet::Dna) {
        return Err(NeoError::ModelAlphabetMismatch {
            model: analysis.correction.name().to_string(),
            alphabet: Alphabet::Dna,
        });
    }
    let tree = parse_newick(&true_tree).map_err(|e| NeoError::InvalidExercise {
        field: "true_tree".to_string(),
        msg: e.to_string(),
    })?;
    check_branch_lengths(&tree)?;
    // Prompts validate against the true tree's leaf labels — v1 data is
    // always simulated along it, so those are the alignment's labels.
    let prompts = prompts(&f.prompts, &tree.leaf_labels(), analysis.method)?;
    let bootstrap = bootstrap(f.bootstrap)?;

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
        bootstrap,
    })
}

/// A v2-or-later file: declared `alphabet`, `data.kind` choosing
/// simulated vs embedded, and an optional `reference`. `v` is the
/// declared version — v3 additionally accepts the v1.4 fields
/// (`analysis.kappa`, `sim.base_freqs`, the F84 and K2P_PHYLIP
/// identifiers) and v4 the v1.4b fields (`analysis.site_filter`, the
/// `"Poisson"` identifier); in an older file those are refused with a
/// message naming the required version.
fn load_v2(f: ExerciseFile, v: u32) -> Result<Exercise, NeoError> {
    let alphabet = match f.alphabet.as_deref() {
        Some("dna") => Alphabet::Dna,
        Some("protein") => Alphabet::Protein,
        Some(other) => {
            return Err(bad("alphabet", &format!("unknown alphabet '{other}'")));
        }
        None => {
            return Err(bad(
                "alphabet",
                &format!("alphabet is required for schema_version {v}"),
            ))
        }
    };
    let data = f
        .data
        .ok_or_else(|| bad("data", &format!("data is required for schema_version {v}")))?;
    let analysis = analysis(&f.analysis, v)?;

    // Per-kind validation; `labels` are the alignment's leaf labels,
    // which the reference tree must match.
    let (data, labels) = match data {
        DataFile::Simulated { true_tree, sim } => {
            let sim = checked_sim(&sim, v)?;
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
    let prompts = prompts(&f.prompts, &labels, analysis.method)?;
    let bootstrap = bootstrap(f.bootstrap)?;

    Ok(Exercise {
        schema_version: v,
        id: f.id,
        title: f.title,
        alphabet,
        data,
        reference,
        analysis,
        locked: f.locked,
        prompts,
        bootstrap,
    })
}

/// Convert and validate a file `sim` block: `SimSpec` checks plus the
/// exercise-level `10_000`-site cap.
fn checked_sim(f: &SimFile, v: u32) -> Result<SimSpec, NeoError> {
    let sim = sim_spec(f, v)?;
    check_spec(&sim)?;
    if sim.length > MAX_EXERCISE_LEN {
        return Err(bad("sim.length", "length must be at most 10000"));
    }
    Ok(sim)
}

/// The serde mirror of the `sim` object: `model` is a string, `kappa`
/// rides along for `"K80"` and `"F84"`, and `base_freqs` is the v3-only
/// `{ "A", "C", "G", "T" }` object for `"F84"` (v1.4 spec §4).
fn sim_spec(f: &SimFile, v: u32) -> Result<SimSpec, NeoError> {
    let length = u32::try_from(f.length)
        .map_err(|_| bad("sim.length", "length must be a non-negative integer"))?;
    // `base_freqs` keeps absent, explicit `null` and a value distinct:
    // presence alone trips the version gate (schema.json counts a null
    // key as present), and a non-null value must be the {A, C, G, T}
    // object — never null, and never the array serde would otherwise
    // read into the struct.
    let base_freqs = match &f.base_freqs {
        None => None,
        Some(_) if v < 3 => {
            return Err(bad(
                "sim.base_freqs",
                "sim.base_freqs requires schema_version 3",
            ));
        }
        Some(None) => {
            return Err(bad(
                "sim.base_freqs",
                "base_freqs must be an object with A, C, G and T, not null",
            ));
        }
        Some(Some(raw)) => Some(base_freqs(raw)?),
    };
    let model = match f.model.as_str() {
        "JC69" => SimModel::Jc69,
        "K80" => SimModel::K80 {
            kappa: f
                .kappa
                .ok_or_else(|| bad("sim.kappa", "kappa is required for K80"))?,
        },
        "JTT" => SimModel::Jtt,
        "F84" => {
            if v < 3 {
                return Err(bad(
                    "sim.model",
                    "sim.model 'F84' requires schema_version 3",
                ));
            }
            SimModel::F84 {
                kappa: f
                    .kappa
                    .ok_or_else(|| bad("sim.kappa", "kappa is required for F84"))?,
                base_freqs: base_freqs.unwrap_or([0.25; 4]),
            }
        }
        other => return Err(bad("sim.model", &format!("unknown model '{other}'"))),
    };
    if base_freqs.is_some() && !matches!(model, SimModel::F84 { .. }) {
        return Err(bad("sim.base_freqs", "base_freqs applies only to F84"));
    }
    Ok(SimSpec {
        model,
        length,
        seed: f.seed,
    })
}

/// The serde mirror of the `analysis` object (v1.1 spec §3.6, v1.4
/// spec §4, v1.4b spec §4): `"correction": "p"|"JC69"|"K80"|"Kimura"|
/// "JTT"|"Poisson"|"F84"|"K2P_PHYLIP"`, the last three version-gated
/// (F84 and K2P_PHYLIP v3-only, Poisson v4-only), with `kappa` the
/// K2P_PHYLIP transition/transversion ratio (default 2.0) and
/// `site_filter` MEGA's gap treatment (v4-only).
fn analysis(f: &AnalysisFile, v: u32) -> Result<Analysis, NeoError> {
    // v3-only and v4-only fields and identifiers are refused at their
    // own path in older files so an editor never silently accepts them.
    // Presence counts even for an explicit `null`: schema.json has no
    // nullable kappa or site_filter, so `null` must not read as
    // "absent".
    if v < 3 {
        if f.kappa.is_some() {
            return Err(bad(
                "analysis.kappa",
                "analysis.kappa requires schema_version 3",
            ));
        }
        if matches!(f.correction.as_str(), "F84" | "K2P_PHYLIP") {
            return Err(bad(
                "analysis.correction",
                &format!("'{}' requires schema_version 3", f.correction),
            ));
        }
    }
    if v < 4 {
        if f.site_filter.is_some() {
            return Err(bad(
                "analysis.site_filter",
                "analysis.site_filter requires schema_version 4",
            ));
        }
        if f.correction.as_str() == "Poisson" {
            return Err(bad(
                "analysis.correction",
                "'Poisson' requires schema_version 4",
            ));
        }
    }
    let file_kappa = match f.kappa {
        Some(None) => {
            return Err(bad("analysis.kappa", "kappa must be a number, not null"));
        }
        Some(Some(k)) => Some(k),
        None => None,
    };
    // Same presence rule as kappa: an explicit `null` or a non-object
    // (serde would otherwise read `null` as absent) is refused, and the
    // object's fields are validated by hand so each bad value names its
    // own path, the way schema.json's `siteFilter` def does.
    let site_filter = match &f.site_filter {
        None => None,
        Some(None) => {
            return Err(bad(
                "analysis.site_filter",
                "site_filter must be an object with a \"kind\", not null",
            ));
        }
        Some(Some(raw)) => Some(site_filter_file(raw)?),
    };
    if let Some(k) = file_kappa {
        if !k.is_finite() || k <= 0.0 {
            return Err(bad("analysis.kappa", "kappa must be positive and finite"));
        }
    }
    let (correction, kappa) = match f.correction.as_str() {
        "p" => (DistModel::P, None),
        "JC69" => (DistModel::Jc69, None),
        "K80" => (DistModel::K80, None),
        "Kimura" => (DistModel::Kimura, None),
        "JTT" => (DistModel::Jtt, None),
        "Poisson" => (DistModel::Poisson, None),
        "F84" => (DistModel::F84, None),
        "K2P_PHYLIP" => {
            let k = file_kappa.unwrap_or(2.0);
            (DistModel::K2pPhylip { ratio: k }, Some(k))
        }
        other => {
            return Err(bad(
                "analysis.correction",
                &format!("unknown correction '{other}'"),
            ))
        }
    };
    if kappa.is_none() && file_kappa.is_some() {
        return Err(bad("analysis.kappa", "kappa applies only to K2P_PHYLIP"));
    }
    Ok(Analysis {
        correction,
        method: match f.method.as_str() {
            "NJ" => Method::Nj,
            "UPGMA" => Method::Upgma,
            other => return Err(bad("analysis.method", &format!("unknown method '{other}'"))),
        },
        kappa,
        site_filter,
    })
}

/// Convert a raw `analysis.site_filter` value to `SiteFilter`
/// (v1.4b spec §4): `{ "kind": "pairwise"|"complete"|"partial",
/// "cutoff_pct": <integer 0–100> }` with `cutoff_pct` present only for
/// `partial`. Kept as a raw value so each bad piece names its own field
/// — a u8 `cutoff_pct` would accept 101–255, an `Option<f64>` a
/// fraction, and serde's untagged fallthroughs a string or array —
/// none of which schema.json allows.
fn site_filter_file(raw: &serde_json::Value) -> Result<SiteFilter, NeoError> {
    if !raw.is_object() {
        return Err(bad(
            "analysis.site_filter",
            "site_filter must be an object with a \"kind\"",
        ));
    }
    let kind = raw.get("kind");
    let cutoff = raw.get("cutoff_pct");
    let stray_cutoff = |kind: &str| -> Result<(), NeoError> {
        if cutoff.is_some() {
            Err(bad(
                "analysis.site_filter.cutoff_pct",
                &format!("cutoff_pct applies only to \"partial\", not \"{kind}\""),
            ))
        } else {
            Ok(())
        }
    };
    match kind.and_then(serde_json::Value::as_str) {
        Some("pairwise") => {
            stray_cutoff("pairwise")?;
            Ok(SiteFilter::Pairwise)
        }
        Some("complete") => {
            stray_cutoff("complete")?;
            Ok(SiteFilter::Complete)
        }
        Some("partial") => {
            let c = cutoff.ok_or_else(|| {
                bad(
                    "analysis.site_filter.cutoff_pct",
                    "cutoff_pct is required for \"partial\"",
                )
            })?;
            // A JSON integer in 0–100: `as_u64` is None for negative,
            // fractional, string, boolean, null, array and object
            // values, so each refusal lands on the field.
            match c
                .as_u64()
                .and_then(|n| u8::try_from(n).ok())
                .filter(|&n| n <= 100)
            {
                Some(cutoff_pct) => Ok(SiteFilter::Partial { cutoff_pct }),
                None => Err(bad(
                    "analysis.site_filter.cutoff_pct",
                    &format!("cutoff_pct must be an integer in 0-100, got {c}"),
                )),
            }
        }
        _ => Err(bad(
            "analysis.site_filter.kind",
            "kind must be \"pairwise\", \"complete\" or \"partial\"",
        )),
    }
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
/// `labels` are the alignment's taxon names: a `reveal_pair` must name
/// two of them (checkpoint 12 — the button opens the pair panel, which
/// resolves the pair by label). `method` resolves the `predict_branch`
/// anchor: `at: "bootstrap"` shows where the bootstrap panel does — the
/// last stepper position, which is step `n−1` for NJ and `n` for UPGMA
/// on `n` taxa (v1.2 spec §7.1).
fn prompts(fs: &[PromptFile], labels: &[String], method: Method) -> Result<Vec<Prompt>, NeoError> {
    let n = labels.len() as u32;
    let bootstrap_step = match method {
        Method::Nj => n.saturating_sub(1).max(1),
        Method::Upgma => n,
    };
    let mut prompts = Vec::with_capacity(fs.len());
    for (i, p) in fs.iter().enumerate() {
        let (r#type, at_step) = match p.kind.as_str() {
            "predict_pair" | "note" => {
                let t = if p.kind == "predict_pair" {
                    PromptType::PredictPair
                } else {
                    PromptType::Note
                };
                let at = p.at_step.ok_or_else(|| {
                    bad(
                        &format!("prompts.{i}.at_step"),
                        "at_step is required for this prompt type",
                    )
                })?;
                (t, at)
            }
            "predict_branch" => {
                match p.at.as_deref() {
                    Some("bootstrap") => {}
                    Some(other) => {
                        return Err(bad(
                            &format!("prompts.{i}.at"),
                            &format!("unknown anchor '{other}'"),
                        ))
                    }
                    None => {
                        return Err(bad(
                            &format!("prompts.{i}.at"),
                            "at is required for predict_branch",
                        ))
                    }
                }
                (PromptType::PredictBranch, bootstrap_step)
            }
            other => {
                return Err(bad(
                    &format!("prompts.{i}.type"),
                    &format!("unknown prompt type '{other}'"),
                ))
            }
        };
        if let Some(pair) = &p.reveal_pair {
            for label in pair {
                if !labels.iter().any(|l| l == label) {
                    return Err(bad(
                        &format!("prompts.{i}.reveal_pair"),
                        &format!("label '{label}' is not in the alignment"),
                    ));
                }
            }
        }
        let after = match p.after.as_deref() {
            None => None,
            Some("first_run") => Some(NoteAfter::FirstRun),
            Some("continue_or_second_run") => Some(NoteAfter::ContinueOrSecondRun),
            Some("longer_run") => Some(NoteAfter::LongerRun),
            Some(other) => {
                return Err(bad(
                    &format!("prompts.{i}.after"),
                    &format!("unknown after trigger '{other}'"),
                ))
            }
        };
        prompts.push(Prompt {
            at_step,
            r#type,
            concept: p.concept.clone(),
            math: p.math.clone(),
            reveal: p.reveal.clone(),
            reveal_pair: p.reveal_pair.clone(),
            after,
        });
    }
    Ok(prompts)
}

/// Validate the file's `bootstrap` block (v1.2 spec §3.8, §7.1):
/// replicates 10–1,000, seed a non-negative integer. The mirror fields
/// are `f64` so non-integer or out-of-range values still report their
/// own field name instead of a bare serde error.
fn bootstrap(f: Option<BootstrapFile>) -> Result<Option<ExerciseBootstrap>, NeoError> {
    let Some(f) = f else { return Ok(None) };
    if f.replicates.fract() != 0.0 || !(10.0..=1000.0).contains(&f.replicates) {
        return Err(bad(
            "bootstrap.replicates",
            "replicates must be an integer in 10..=1000",
        ));
    }
    if f.seed.fract() != 0.0 || f.seed < 0.0 {
        return Err(bad("bootstrap.seed", "seed must be a non-negative integer"));
    }
    Ok(Some(ExerciseBootstrap {
        replicates: f.replicates as u32,
        seed: f.seed as u64,
    }))
}

/// The file's spelling of a `SimModel` name.
fn sim_model_name(m: &SimModel) -> &'static str {
    match m {
        SimModel::Jc69 => "JC69",
        SimModel::K80 { .. } => "K80",
        SimModel::Jtt => "JTT",
        SimModel::F84 { .. } => "F84",
    }
}

fn bad(field: &str, msg: &str) -> NeoError {
    NeoError::InvalidExercise {
        field: field.to_string(),
        msg: msg.to_string(),
    }
}

/// `deserialize_with` for `Option<Option<T>>` fields: absent gives
/// `None` (via `#[serde(default)]`), an explicit `null` gives
/// `Some(None)` and a value `Some(Some(_))` — so the v3-only keys can
/// refuse a present `null` the way schema.json does instead of reading
/// it as absent.
fn present<'de, D, T>(d: D) -> Result<Option<T>, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(d).map(Some)
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
    /// v1.2 spec §7.1: the lesson's bootstrap settings; absent means
    /// the app defaults apply.
    #[serde(default)]
    bootstrap: Option<BootstrapFile>,
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
    /// v1.4 spec §4: F84's instructor-set base frequencies; all four
    /// keys are required when the object is present. Kept as a raw
    /// value so an explicit `null` (`Some(None)`) or a non-object can
    /// be refused the way schema.json refuses them.
    #[serde(default, deserialize_with = "present")]
    base_freqs: Option<Option<serde_json::Value>>,
    /// `i64` so negative or oversized values reach the range check and
    /// report `field: "sim.length"` instead of a generic JSON error.
    length: i64,
    seed: u64,
}

/// Convert a raw `sim.base_freqs` value to `[A, C, G, T]`. Only the
/// JSON object is accepted — serde would also read a 4-element array
/// into `BaseFreqsFile`, which schema.json refuses.
fn base_freqs(raw: &serde_json::Value) -> Result<[f64; 4], NeoError> {
    if !raw.is_object() {
        return Err(bad(
            "sim.base_freqs",
            "base_freqs must be an object with A, C, G and T",
        ));
    }
    let f: BaseFreqsFile =
        serde_json::from_value(raw.clone()).map_err(|e| bad("sim.base_freqs", &e.to_string()))?;
    f.array()
}

/// The serde mirror of `sim.base_freqs` (v1.4 spec §4): Option fields
/// so a missing key reports `sim.base_freqs` instead of a bare serde
/// error. Positivity and the sum-to-1 rule are engine checks in
/// `check_spec`.
#[derive(Deserialize)]
struct BaseFreqsFile {
    #[serde(rename = "A")]
    a: Option<f64>,
    #[serde(rename = "C")]
    c: Option<f64>,
    #[serde(rename = "G")]
    g: Option<f64>,
    #[serde(rename = "T")]
    t: Option<f64>,
}

impl BaseFreqsFile {
    /// The `[A, C, G, T]` array the engine expects; the object is
    /// all-or-nothing (equal frequencies are the absent-key default).
    fn array(&self) -> Result<[f64; 4], NeoError> {
        match (self.a, self.c, self.g, self.t) {
            (Some(a), Some(c), Some(g), Some(t)) => Ok([a, c, g, t]),
            _ => Err(bad("sim.base_freqs", "base_freqs requires A, C, G and T")),
        }
    }
}

#[derive(Deserialize)]
struct AnalysisFile {
    correction: String,
    method: String,
    /// v1.4 spec §4: the K2P_PHYLIP ratio; presence is checked against
    /// `correction` and `schema_version` in `analysis`. `Option<Option>`
    /// keeps an explicit `null` (`Some(None)`) distinct from absent —
    /// a present null is refused, matching schema.json.
    #[serde(default, deserialize_with = "present")]
    kappa: Option<Option<f64>>,
    /// v1.4b spec §4: MEGA's gap treatment; v4-only, presence-checked
    /// in `analysis`. Kept as a raw value (the `Option<Option>` pattern
    /// above) so a present `null` or a non-object is refused rather
    /// than read as absent — serde would otherwise deserialize
    /// `SiteFilter` directly and lose the per-field error paths.
    #[serde(default, deserialize_with = "present")]
    site_filter: Option<Option<serde_json::Value>>,
}

/// The serde mirror of the `bootstrap` block: `f64` so a negative or
/// fractional value reaches the range check and reports
/// `bootstrap.replicates` / `bootstrap.seed` (same pattern as
/// `SimFile.length`).
#[derive(Deserialize)]
struct BootstrapFile {
    replicates: f64,
    seed: f64,
}

#[derive(Deserialize)]
struct PromptFile {
    /// Step-anchored prompts only; `predict_branch` carries `at`
    /// instead (v1.2 spec §7.1).
    #[serde(default)]
    at_step: Option<u32>,
    #[serde(rename = "type")]
    kind: String,
    /// The panel a `predict_branch` prompt anchors to; only
    /// `"bootstrap"` is defined.
    #[serde(default)]
    at: Option<String>,
    concept: String,
    #[serde(default)]
    math: Option<String>,
    #[serde(default)]
    reveal: Option<String>,
    #[serde(default)]
    reveal_pair: Option<[String; 2]>,
    /// Optional sequencing trigger on a bootstrap-stage note
    /// (bootstrap-basics round 3); validated against `NoteAfter`'s
    /// values above.
    #[serde(default)]
    after: Option<String>,
}
