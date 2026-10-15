//! Native vs. wasm parity (plan Task 12, spec §8.5).
//!
//! The simulator golden hashes and a subset of the reference corpus are
//! replayed through the wasm-bindgen boundary. Simulator output must be
//! bit-identical between native and wasm builds; distances must match
//! the fixture's native results to 1e-12. Errors cross the boundary as
//! values (`{ ok: false, error }`), never as thrown exceptions.
#![cfg(target_arch = "wasm32")]

use std::collections::BTreeMap;

use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_wasm_bindgen as swb;
use wasm_bindgen::JsValue;
use wasm_bindgen_test::*;

use neophylo_core::dist::{Cell, DistModel, DistanceMatrix};
use neophylo_core::error::NeoError;
use neophylo_core::seq::Alignment;
use neophylo_core::sim::{SimModel, SimSpec};

// --- WasmResult unpacking -------------------------------------------------

#[derive(Deserialize)]
struct WasmResult<T> {
    ok: bool,
    value: Option<T>,
    error: Option<NeoError>,
}

fn unpack<T: DeserializeOwned>(res: JsValue) -> WasmResult<T> {
    swb::from_value(res).expect("wasm result must deserialize")
}

fn ok_value<T: DeserializeOwned>(res: JsValue) -> T {
    let w: WasmResult<T> = unpack(res);
    assert!(w.ok, "expected ok:true, got error {:?}", w.error);
    w.value.expect("ok:true must carry a value")
}

fn to_js<T: Serialize>(v: &T) -> JsValue {
    swb::to_value(v).expect("test input must serialize")
}

// --- golden hashes ----------------------------------------------------------

#[derive(Deserialize)]
struct GoldenFile {
    cases: Vec<GoldenCase>,
}

#[derive(Deserialize)]
struct GoldenCase {
    name: String,
    tree: String,
    model: String,
    #[serde(default)]
    kappa: Option<f64>,
    length: u32,
    seed: u64,
    fnv1a64: String,
}

/// FNV-1a, 64-bit, over the concatenated sequences — the same hash the
/// native golden tests compute (`neophylo-core/tests/sim.rs`).
fn fnv1a64(aln: &Alignment) -> u64 {
    let mut h = 0xcbf2_9ce4_8422_2325u64;
    for seq in &aln.seqs {
        for &b in seq {
            h ^= b as u64;
            h = h.wrapping_mul(0x0000_0100_0000_01b3);
        }
    }
    h
}

#[wasm_bindgen_test]
fn golden_hashes_match_native() {
    let text = include_str!("../../../fixtures/sim_golden.json");
    let golden: GoldenFile = serde_json::from_str(text).unwrap();
    assert_eq!(golden.cases.len(), 3);
    for case in &golden.cases {
        let model = match (case.model.as_str(), case.kappa) {
            ("JC69", _) => SimModel::Jc69,
            ("K80", Some(kappa)) => SimModel::K80 { kappa },
            (m, k) => panic!("bad golden case model {m} kappa {k:?}"),
        };
        let tree: neophylo_core::tree::Tree = ok_value(neophylo_wasm::parse_newick(&case.tree));
        let spec = SimSpec {
            model,
            length: case.length,
            seed: case.seed,
        };
        let aln: Alignment = ok_value(neophylo_wasm::simulate(to_js(&tree), to_js(&spec)));
        assert_eq!(
            format!("{:016x}", fnv1a64(&aln)),
            case.fnv1a64,
            "golden hash mismatch in case {}",
            case.name
        );
    }
}

// --- corpus subset ----------------------------------------------------------

#[derive(Deserialize)]
struct RefFixture {
    name: String,
    /// model name -> full n×n matrix.
    distances: BTreeMap<String, Vec<Vec<f64>>>,
}

fn model_of(name: &str) -> DistModel {
    match name {
        "raw" => DistModel::P,
        "JC69" => DistModel::Jc69,
        "K80" => DistModel::K80,
        other => panic!("unknown distance model {other:?}"),
    }
}

/// Largest absolute difference between the matrix returned through wasm
/// and the fixture's stored matrix.
fn max_diff(got: &DistanceMatrix, want: &[Vec<f64>]) -> f64 {
    let n = got.n();
    let mut worst = 0.0f64;
    for (i, row) in want.iter().enumerate() {
        for (j, &w) in row.iter().enumerate() {
            match got.cells[i * n + j] {
                Cell::Value(g) => worst = worst.max((g - w).abs()),
                Cell::Saturated => return f64::INFINITY,
            }
        }
    }
    worst
}

#[wasm_bindgen_test]
fn corpus_subset() {
    // The first two ape fixtures (alphabetical order in fixtures/ref/).
    let pairs = [
        (
            include_str!("../../../fixtures/ref/jc12.json"),
            include_str!("../../../fixtures/inputs/jc12.fasta"),
        ),
        (
            include_str!("../../../fixtures/ref/jc6.json"),
            include_str!("../../../fixtures/inputs/jc6.fasta"),
        ),
    ];
    for (fixture_json, fasta) in pairs {
        let fx: RefFixture = serde_json::from_str(fixture_json).unwrap();
        let aln: Alignment = ok_value(neophylo_wasm::parse_fasta(fasta));
        let aln_js = to_js(&aln);
        for (model, want) in &fx.distances {
            let tag = format!("{}/{model}", fx.name);
            let got: DistanceMatrix = ok_value(neophylo_wasm::distances(
                aln_js.clone(),
                to_js(&model_of(model)),
            ));
            let diff = max_diff(&got, want);
            assert!(
                diff <= 1e-12,
                "{tag}: wasm distance error {diff} exceeds 1e-12"
            );
        }
    }
}

// --- errors are values -------------------------------------------------------

#[wasm_bindgen_test]
fn errors_are_values() {
    let res: WasmResult<Alignment> = unpack(neophylo_wasm::parse_fasta("x"));
    assert!(!res.ok, "expected ok:false for unparseable FASTA");
    let err = res.error.expect("ok:false must carry an error");
    match err {
        NeoError::Parse { .. } => {}
        other => panic!("expected Parse, got {other:?}"),
    }
}
