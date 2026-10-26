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

use neophylo_core::algos::Method;
use neophylo_core::bootstrap::{BootstrapTally, ConsensusKind, DroppedGroup, ReplicateDetail};
use neophylo_core::dist::{Cell, DistModel, DistanceMatrix};
use neophylo_core::error::NeoError;
use neophylo_core::phylip::NameMode;
use neophylo_core::protein_dist::PairDetail;
use neophylo_core::reroot::RerootResult;
use neophylo_core::seq::Alignment;
use neophylo_core::sim::{SimModel, SimSpec};
use neophylo_core::tree::Tree;

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

// --- Option::None crosses as null -------------------------------------------

/// The shared serializer's `serialize_missing_as_null` contract: an
/// unlabeled internal node's `label` arrives in JS as `null`, never
/// `undefined`, matching the generated `string | null` type.
#[wasm_bindgen_test]
fn none_serializes_as_null() {
    let res = neophylo_wasm::parse_newick("(a:1,b:1);");
    let value = js_sys::Reflect::get(&res, &JsValue::from_str("value")).unwrap();
    let nodes = js_sys::Reflect::get(&value, &JsValue::from_str("nodes")).unwrap();
    let n_nodes = js_sys::Reflect::get(&nodes, &JsValue::from_str("length"))
        .unwrap()
        .as_f64()
        .unwrap() as u32;
    let mut checked = 0;
    for i in 0..n_nodes {
        let node = js_sys::Reflect::get(&nodes, &JsValue::from_f64(i as f64)).unwrap();
        let children = js_sys::Reflect::get(&node, &JsValue::from_str("children")).unwrap();
        let n_children = js_sys::Reflect::get(&children, &JsValue::from_str("length"))
            .unwrap()
            .as_f64()
            .unwrap();
        if n_children == 0.0 {
            continue;
        }
        let label = js_sys::Reflect::get(&node, &JsValue::from_str("label")).unwrap();
        assert!(
            label.is_null() && !label.is_undefined(),
            "internal node label must be null, not undefined"
        );
        checked += 1;
    }
    assert!(checked >= 1, "tree must have at least one internal node");
}

// --- v1.1 exports (plan Task 8) ----------------------------------------------

/// The protdist documentation alignment (plan Task 2), padded names.
const PHYLIP_DOC: &str = "    5   13\n\
    Alpha     AACGTGGCCACAT\n\
    Beta      AAGGTCGCCACAC\n\
    Gamma     CAGTTCGCCACAA\n\
    Delta     GAGATTTCCGCCT\n\
    Epsilon   GAGATCTCCGCCC\n";

#[derive(Deserialize)]
struct PhylipValue {
    alignment: Alignment,
    names_used: NameMode,
}

#[wasm_bindgen_test]
fn parse_phylip_reports_names_used() {
    let v: PhylipValue = ok_value(neophylo_wasm::parse_phylip(
        PHYLIP_DOC,
        to_js(&NameMode::Auto),
    ));
    assert_eq!(v.names_used, NameMode::Relaxed);
    assert_eq!(v.alignment.labels[0], "Alpha");
}

#[wasm_bindgen_test]
fn jtt_pair_detail_crosses() {
    let aln: Alignment = ok_value(neophylo_wasm::parse_fasta(
        ">a\nARNDCQEGHILK\n>b\nARNECQEGHILK\n",
    ));
    let res = neophylo_wasm::jtt_pair_detail(to_js(&aln), 0, 1);
    // `d_hat` arrives as `number | null`, never `undefined`.
    let value = js_sys::Reflect::get(&res, &JsValue::from_str("value")).unwrap();
    let d_hat = js_sys::Reflect::get(&value, &JsValue::from_str("d_hat")).unwrap();
    assert!(!d_hat.is_undefined(), "d_hat must never be undefined");
    assert!(
        d_hat.is_null() || d_hat.as_f64().is_some(),
        "d_hat must be a number or null"
    );
    let detail: PairDetail = ok_value(res);
    assert_eq!((detail.a, detail.b), (0, 1));
    assert_eq!(detail.curve.len(), 60);
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

// --- v1.2 bootstrap exports (v1.2 plan Task 8, spec §4) ------------------------

/// The committed native tally (produced and pinned by
/// `tests/native.rs`): the wasm `bootstrap_batch` must equal it
/// exactly — the serde wire shape is the contract, so the comparison
/// is on the deserialized `BootstrapTally`, not bytes.
#[derive(Deserialize)]
struct TallyFixture {
    input: String,
    model: DistModel,
    method: Method,
    seed: u64,
    start: u32,
    count: u32,
    tally: BootstrapTally,
}

fn tally_fixture() -> (TallyFixture, Alignment) {
    let fx: TallyFixture =
        serde_json::from_str(include_str!("data/bootstrap_tally_jc6.json")).unwrap();
    let aln: Alignment = ok_value(neophylo_wasm::parse_fasta(include_str!(
        "../../../fixtures/inputs/jc6.fasta"
    )));
    (fx, aln)
}

/// The original (unresampled) tree the fixture's run was built against.
fn original_tree(fx: &TallyFixture, aln: &Alignment) -> Tree {
    let dm = neophylo_core::dist::compute(aln, fx.model).unwrap();
    neophylo_core::build_tree(
        &dm,
        fx.method,
        neophylo_core::algos::BuildOptions { trace: false },
    )
    .unwrap()
    .tree
}

#[wasm_bindgen_test]
fn bootstrap_batch_matches_native_fixture() {
    let (fx, aln) = tally_fixture();
    assert_eq!(fx.input, "fixtures/inputs/jc6.fasta");
    let aln_js = to_js(&aln);
    // `seed` crosses as a JS number, the way the web client sends it.
    let seed_js = || JsValue::from_f64(fx.seed as f64);
    let got: BootstrapTally = ok_value(neophylo_wasm::bootstrap_batch(
        aln_js.clone(),
        to_js(&fx.model),
        to_js(&fx.method),
        seed_js(),
        fx.start,
        fx.count,
    ));
    assert_eq!(got, fx.tally, "wasm tally must equal the native fixture");

    // Merged batches cross the boundary identically (spec §3.3).
    let half = fx.count / 2;
    let a: BootstrapTally = ok_value(neophylo_wasm::bootstrap_batch(
        aln_js.clone(),
        to_js(&fx.model),
        to_js(&fx.method),
        seed_js(),
        fx.start,
        half,
    ));
    let b: BootstrapTally = ok_value(neophylo_wasm::bootstrap_batch(
        aln_js,
        to_js(&fx.model),
        to_js(&fx.method),
        seed_js(),
        fx.start + half,
        fx.count - half,
    ));
    let merged: BootstrapTally = ok_value(neophylo_wasm::merge_tallies(to_js(&a), to_js(&b)));
    assert_eq!(merged, fx.tally, "merged batches must equal one batch");
}

#[wasm_bindgen_test]
fn support_crosses_as_number_or_null() {
    let (fx, aln) = tally_fixture();
    let orig = original_tree(&fx, &aln);
    let res = neophylo_wasm::support_on_tree(to_js(&orig), to_js(&fx.tally));

    // Inspect the raw JS value: every branch's `support` is a number
    // or null, never undefined (the `number | null` contract).
    let value = js_sys::Reflect::get(&res, &JsValue::from_str("value")).unwrap();
    let branches = js_sys::Reflect::get(&value, &JsValue::from_str("branches")).unwrap();
    let n = js_sys::Reflect::get(&branches, &JsValue::from_str("length"))
        .unwrap()
        .as_f64()
        .unwrap() as u32;
    let (mut numbers, mut nulls) = (0u32, 0u32);
    for i in 0..n {
        let attrs = js_sys::Reflect::get(&branches, &JsValue::from_f64(f64::from(i))).unwrap();
        let support = js_sys::Reflect::get(&attrs, &JsValue::from_str("support")).unwrap();
        assert!(
            !support.is_undefined(),
            "branch {i}: support must never be undefined"
        );
        if support.is_null() {
            nulls += 1;
        } else {
            assert!(
                support.as_f64().is_some(),
                "branch {i}: support must be a number or null"
            );
            numbers += 1;
        }
    }
    assert!(numbers >= 1, "internal branches must carry numeric support");
    assert!(nulls >= 1, "terminal branches must carry null support");

    // And it deserializes to the same tree the native call produces.
    let via_js: Tree = ok_value(res);
    let want = neophylo_core::bootstrap::support_on_tree(&orig, &fx.tally);
    assert_eq!(via_js, want);
}

/// The remaining Task 8 exports: each returns `WasmResult`, the
/// `consensus` labels argument is validated against the tally, and
/// `ConsensusKind` serializes as `"Strict" | "Majority" | "Extended"`.
#[wasm_bindgen_test]
fn bootstrap_exports_smoke() {
    let (fx, aln) = tally_fixture();
    let orig = original_tree(&fx, &aln);

    // consensus: spec §4 signature carries `labels`; it must match the
    // tally's labels or the call is a LabelMismatch error value.
    for kind in [
        ConsensusKind::Strict,
        ConsensusKind::Majority,
        ConsensusKind::Extended,
    ] {
        let cons: Tree = ok_value(neophylo_wasm::consensus(
            to_js(&fx.tally),
            to_js(&kind),
            to_js(&fx.tally.labels),
        ));
        let want = neophylo_core::bootstrap::consensus(&fx.tally, kind);
        assert_eq!(cons, want, "consensus {kind:?} must match native");
    }
    let bad: WasmResult<Tree> = unpack(neophylo_wasm::consensus(
        to_js(&fx.tally),
        to_js(&ConsensusKind::Majority),
        to_js(&vec!["zz".to_string()]),
    ));
    assert!(!bad.ok, "mismatched labels must be an error value");
    match bad.error.unwrap() {
        NeoError::LabelMismatch { .. } => {}
        other => panic!("expected LabelMismatch, got {other:?}"),
    }

    // consensus_dropped: every kind returns a Vec, Strict's matches
    // the native result.
    for kind in [
        ConsensusKind::Strict,
        ConsensusKind::Majority,
        ConsensusKind::Extended,
    ] {
        let dropped: Vec<DroppedGroup> = ok_value(neophylo_wasm::consensus_dropped(
            to_js(&orig),
            to_js(&fx.tally),
            to_js(&kind),
        ));
        assert_eq!(
            dropped,
            neophylo_core::bootstrap::consensus_dropped(&orig, &fx.tally, kind),
            "dropped {kind:?} must match native"
        );
    }

    // replicate_detail: same replicate as the batch, detail fields
    // consistent (undrawn = zero weights).
    let det: ReplicateDetail = ok_value(neophylo_wasm::replicate_detail(
        to_js(&aln),
        to_js(&fx.model),
        to_js(&fx.method),
        JsValue::from_f64(fx.seed as f64),
        0,
    ));
    assert_eq!(det.index, 0);
    assert_eq!(
        det.undrawn,
        det.weights.iter().filter(|&&w| w == 0).count() as u32
    );

    // reference_outgroup: smaller root-child subtree; (a,b) < (c,d,e).
    let reference: Tree = ok_value(neophylo_wasm::parse_newick(
        "((a:1,b:1):1,(c:1,(d:1,e:1):1):1);",
    ));
    let og: Vec<String> = ok_value(neophylo_wasm::reference_outgroup(to_js(&reference)));
    assert_eq!(og, vec!["a".to_string(), "b".to_string()]);

    // reroot_on_outgroup on the jc6 tree: a single leaf outgroup always
    // roots on that terminal branch.
    let rr: RerootResult = ok_value(neophylo_wasm::reroot_on_outgroup(
        to_js(&orig),
        to_js(&vec!["t3".to_string()]),
    ));
    assert!(rr.tree.rooted);
    let bad_rr: WasmResult<RerootResult> = unpack(neophylo_wasm::reroot_on_outgroup(
        to_js(&orig),
        to_js(&vec!["nosuch".to_string()]),
    ));
    assert!(!bad_rr.ok, "unknown outgroup label must be an error value");
}

// --- v1.4 edit exports (v1.4 plan Task 7, spec §5.1) --------------------

/// Leaf id by label — the arena order is an implementation detail.
fn leaf_id(t: &Tree, label: &str) -> u32 {
    t.nodes
        .iter()
        .position(|n| n.children.is_empty() && n.label.as_deref() == Some(label))
        .unwrap_or_else(|| panic!("no leaf labelled {label}")) as u32
}

fn node_id(v: u32) -> JsValue {
    JsValue::from_f64(f64::from(v))
}

/// Every edit_* export forwards to neophylo_core::edit on a copy and
/// returns the NEW tree in the envelope; a refused op is `ok: false`
/// with the engine's error and malformed arguments are
/// `InvalidExercise`, never a throw.
#[wasm_bindgen_test]
fn edit_exports_smoke() {
    let tree: Tree = ok_value(neophylo_wasm::parse_newick("(a:0.1,b:0.2,c:0.3);"));
    let tree_js = to_js(&tree);
    let a = leaf_id(&tree, "a");

    // set_length: the edge above `a` becomes 0.9 — same as native.
    let mut want = tree.clone();
    neophylo_core::edit::set_length(&mut want, neophylo_core::tree::NodeId(a), 0.9).unwrap();
    let got: Tree = ok_value(neophylo_wasm::edit_set_length(
        tree_js.clone(),
        node_id(a),
        JsValue::from_f64(0.9),
    ));
    assert_eq!(got, want);

    // rename_leaf: duplicates are refused as InvalidEdit values.
    let renamed: Tree = ok_value(neophylo_wasm::edit_rename_leaf(
        tree_js.clone(),
        node_id(a),
        JsValue::from_str("z"),
    ));
    assert_eq!(
        renamed.nodes[a as usize].label.as_deref(),
        Some("z"),
        "leaf label must update"
    );
    let dup: WasmResult<Tree> = unpack(neophylo_wasm::edit_rename_leaf(
        tree_js.clone(),
        node_id(a),
        JsValue::from_str("b"),
    ));
    assert!(!dup.ok, "duplicate name must be an error value");
    match dup.error.unwrap() {
        NeoError::InvalidEdit { .. } => {}
        other => panic!("expected InvalidEdit, got {other:?}"),
    }

    // add_leaf (Task 9a): a fresh parentless leaf under the same name
    // rules; a duplicate is an InvalidEdit value, not a throw.
    let with_leaf: Tree = ok_value(neophylo_wasm::edit_add_leaf(
        tree_js.clone(),
        JsValue::from_str("z"),
    ));
    let z = leaf_id(&with_leaf, "z");
    assert_eq!(
        with_leaf.nodes[z as usize].parent, None,
        "a new leaf is a detached component"
    );
    let dup_leaf: WasmResult<Tree> = unpack(neophylo_wasm::edit_add_leaf(
        tree_js.clone(),
        JsValue::from_str("b"),
    ));
    assert!(
        !dup_leaf.ok,
        "duplicate new-leaf name must be an error value"
    );
    match dup_leaf.error.unwrap() {
        NeoError::InvalidEdit { .. } => {}
        other => panic!("expected InvalidEdit, got {other:?}"),
    }

    // detach + join: detach leaf `a`, then rejoin it with the root —
    // the new node becomes the root and validation still passes.
    let detached: Tree = ok_value(neophylo_wasm::edit_detach(tree_js.clone(), node_id(a)));
    let detached_js = to_js(&detached);
    let joined: Tree = ok_value(neophylo_wasm::edit_join(
        detached_js.clone(),
        node_id(a),
        node_id(detached.root.0),
        to_js(&(0.1_f64, 0.05_f64)),
    ));
    assert!(neophylo_core::edit::validate_editable(&joined).is_ok());

    // move_subtree: move leaf `a` onto the edge above `b` on a tree
    // where `a` hangs deeper than the target edge.
    let tree2: Tree = ok_value(neophylo_wasm::parse_newick("(a:0.4,(b:0.2,c:0.3):0.4);"));
    let (a2, b2) = (leaf_id(&tree2, "a"), leaf_id(&tree2, "b"));
    let moved: Tree = ok_value(neophylo_wasm::edit_move_subtree(
        to_js(&tree2),
        node_id(a2),
        node_id(b2),
        to_js(&(0.05_f64, 0.1_f64)),
    ));
    assert!(neophylo_core::edit::validate_editable(&moved).is_ok());

    // edit_validate: () on a valid tree; ok:false on a malformed arena.
    let valid: WasmResult<()> = unpack(neophylo_wasm::edit_validate(to_js(&joined)));
    assert!(valid.ok, "a valid tree must validate");
    let malformed: WasmResult<()> = unpack(neophylo_wasm::edit_validate(JsValue::from_str(
        "not a tree",
    )));
    assert!(!malformed.ok, "a malformed tree must be an error value");
    match malformed.error.unwrap() {
        NeoError::InvalidExercise { .. } => {}
        other => panic!("expected InvalidExercise, got {other:?}"),
    }
}
