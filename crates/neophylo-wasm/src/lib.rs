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
use neophylo_core::dist::{DistModel, DistanceMatrix};
use neophylo_core::error::NeoError;
use neophylo_core::exercise::Exercise;
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

/// Serialize a `WasmResult`. `serde-wasm-bindgen` only fails on types
/// JS cannot represent, which ours never are; null is returned rather
/// than panicking if that ever changes.
fn to_js<T: Serialize>(r: Result<T, NeoError>) -> JsValue {
    swb::to_value(&WasmResult::from(r)).unwrap_or(JsValue::NULL)
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

/// Parse and validate a lesson JSON file (plan gap 3).
#[wasm_bindgen]
pub fn load_exercise(json: &str) -> JsValue {
    to_js::<Exercise>(neophylo_core::load_exercise(json))
}
