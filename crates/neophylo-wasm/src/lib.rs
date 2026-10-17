//! neophylo-wasm: wasm-bindgen bindings over neophylo-core (spec §5).
//!
//! This crate contains no logic; it only converts types at the boundary
//! (serde types via `serde-wasm-bindgen`). TypeScript types are generated
//! with `ts-rs` into `web/src/engine/generated/`.
//!
//! Every export returns a `WasmResult<T>` serialized as
//! `{ ok: true, value } | { ok: false, error }`; nothing throws on error.
//! A malformed `JsValue` argument is reported as
//! `InvalidExercise { field: "<arg name>", msg }`.

use serde::{de::DeserializeOwned, Serialize};
use serde_wasm_bindgen as swb;
use ts_rs::TS;
use wasm_bindgen::prelude::*;

use neophylo_core::algos::{BuildOptions, Method};
use neophylo_core::alphabet::Alphabet;
use neophylo_core::dist::{DistModel, DistanceMatrix};
use neophylo_core::error::NeoError;
use neophylo_core::exercise::Exercise;
use neophylo_core::phylip::NameMode;
use neophylo_core::protein_dist::PairDetail;
use neophylo_core::seq::Alignment;
use neophylo_core::sim::SimSpec;
use neophylo_core::tree::Tree;

/// The single envelope every export returns (spec §5, plan gap 3).
/// Errors are values: a failure is `ok: false` with the `NeoError`,
/// never a thrown exception. Untagged, so the wire shape is exactly
/// `{ ok: true, value } | { ok: false, error }`.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum WasmResult<T> {
    Ok {
        #[ts(type = "true")]
        ok: bool,
        value: T,
    },
    Err {
        #[ts(type = "false")]
        ok: bool,
        error: NeoError,
    },
}

impl<T> From<Result<T, NeoError>> for WasmResult<T> {
    fn from(r: Result<T, NeoError>) -> Self {
        match r {
            Ok(value) => Self::Ok { ok: true, value },
            Err(error) => Self::Err { ok: false, error },
        }
    }
}

/// The single serializer shared by every export.
/// `serialize_missing_as_null` sends every `Option::None` to JS as
/// `null`, matching the generated `T | null` types; `json_compatible`
/// keeps the usual `to_value` wire shape otherwise (plain objects,
/// byte arrays).
const SERIALIZER: swb::Serializer =
    swb::Serializer::json_compatible().serialize_missing_as_null(true);

/// Serialize a `WasmResult`. `serde-wasm-bindgen` only fails on types
/// JS cannot represent, which ours never are; null is returned rather
/// than panicking if that ever changes.
fn to_js<T: Serialize>(r: Result<T, NeoError>) -> JsValue {
    WasmResult::from(r)
        .serialize(&SERIALIZER)
        .unwrap_or(JsValue::NULL)
}

/// Deserialize one `JsValue` argument. A malformed argument is reported
/// as `InvalidExercise { field: "<arg name>" }` (plan Task 12).
fn arg<T: DeserializeOwned>(v: JsValue, name: &str) -> Result<T, NeoError> {
    swb::from_value(v).map_err(|e| NeoError::InvalidExercise {
        field: name.to_string(),
        msg: e.to_string(),
    })
}

/// Install the panic hook in development builds only (spec §4.7).
#[cfg(all(target_arch = "wasm32", debug_assertions))]
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

/// Parse FASTA text into an `Alignment` (spec §4.1).
#[wasm_bindgen]
pub fn parse_fasta(text: &str) -> JsValue {
    to_js(neophylo_core::parse_fasta(text))
}

/// Parse Newick text into a `Tree` (spec §4.4).
#[wasm_bindgen]
pub fn parse_newick(text: &str) -> JsValue {
    to_js(neophylo_core::parse_newick(text))
}

/// Serialize a `Tree` back to Newick (spec §4.4).
#[wasm_bindgen]
pub fn write_newick(tree: JsValue) -> JsValue {
    to_js(arg::<Tree>(tree, "tree").map(|t| neophylo_core::write_newick(&t)))
}

/// Compute pairwise distances under `model` (spec §4.3).
#[wasm_bindgen]
pub fn distances(aln: JsValue, model: JsValue) -> JsValue {
    to_js(arg::<Alignment>(aln, "aln").and_then(|a| {
        arg::<DistModel>(model, "model").and_then(|m| neophylo_core::dist::compute(&a, m))
    }))
}

/// Build a tree from a distance matrix (spec §4.5).
#[wasm_bindgen]
pub fn build_tree(m: JsValue, method: JsValue, opts: JsValue) -> JsValue {
    to_js(arg::<DistanceMatrix>(m, "m").and_then(|m| {
        arg::<Method>(method, "method").and_then(|method| {
            arg::<BuildOptions>(opts, "opts")
                .and_then(|opts| neophylo_core::build_tree(&m, method, opts))
        })
    }))
}

/// Robinson–Foulds comparison of two trees (spec §4.6).
#[wasm_bindgen]
pub fn compare(truth: JsValue, inferred: JsValue) -> JsValue {
    to_js(arg::<Tree>(truth, "truth").and_then(|t| {
        arg::<Tree>(inferred, "inferred").and_then(|i| neophylo_core::compare::rf(&t, &i))
    }))
}

/// Simulate an alignment along `tree` (spec §4.2).
#[wasm_bindgen]
pub fn simulate(tree: JsValue, spec: JsValue) -> JsValue {
    to_js(
        arg::<Tree>(tree, "tree").and_then(|t| {
            arg::<SimSpec>(spec, "spec").and_then(|s| neophylo_core::simulate(&t, &s))
        }),
    )
}

/// Parse and validate a lesson JSON file (plan gap 3, v1.1 spec §3.6).
#[wasm_bindgen]
pub fn load_exercise(json: &str) -> JsValue {
    to_js::<Exercise>(neophylo_core::load_exercise(json))
}

/// The `parse_phylip` result: the alignment plus the name mode Auto
/// actually used, so the UI can show it (v1.1 spec §3.2).
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct PhylipParseResult {
    pub alignment: Alignment,
    pub names_used: NameMode,
}

/// Parse PHYLIP text (sequential or interleaved) into an `Alignment`
/// (v1.1 spec §3.2).
#[wasm_bindgen]
pub fn parse_phylip(text: &str, names: JsValue) -> JsValue {
    to_js(arg::<NameMode>(names, "names").and_then(|names| {
        neophylo_core::parse_phylip(text, names).map(|(alignment, names_used)| PhylipParseResult {
            alignment,
            names_used,
        })
    }))
}

/// Auto-detect an alignment's alphabet from its sequence data
/// (v1.1 spec §3.1).
#[wasm_bindgen]
pub fn detect_alphabet(aln: JsValue) -> JsValue {
    to_js(arg::<Alignment>(aln, "aln").map(|a| neophylo_core::detect_alphabet(&a.seqs)))
}

/// Re-validate an alignment under a chosen alphabet; the override path
/// (v1.1 spec §3.1).
#[wasm_bindgen]
pub fn with_alphabet(aln: JsValue, alphabet: JsValue) -> JsValue {
    to_js(arg::<Alignment>(aln, "aln").and_then(|a| {
        arg::<Alphabet>(alphabet, "alphabet")
            .and_then(|alphabet| neophylo_core::with_alphabet(a, alphabet))
    }))
}

/// The pair-panel detail for sequences `i` and `j` of a protein
/// alignment (v1.1 spec §3.4).
#[wasm_bindgen]
pub fn jtt_pair_detail(aln: JsValue, i: usize, j: usize) -> JsValue {
    to_js::<PairDetail>(
        arg::<Alignment>(aln, "aln").and_then(|a| neophylo_core::jtt_pair_detail(&a, i, j)),
    )
}

/// Serialize a `DistanceMatrix` as PHYLIP `neighbor` input
/// (v1.1 spec §3.2).
#[wasm_bindgen]
pub fn write_phylip_matrix(m: JsValue, names: JsValue) -> JsValue {
    to_js(arg::<DistanceMatrix>(m, "m").and_then(|m| {
        arg::<NameMode>(names, "names")
            .and_then(|names| neophylo_core::write_phylip_matrix(&m, names))
    }))
}
