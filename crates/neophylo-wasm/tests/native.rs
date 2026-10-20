//! Native half of the wasm-boundary parity check (v1.2 plan Task 8).
//!
//! Produces and pins the committed tally fixture that the wasm test
//! `parity.rs::bootstrap_batch_matches_native_fixture` compares
//! against: `write_fixture` rewrites it (run deliberately with
//! `cargo test -p neophylo-wasm -- --ignored`), and
//! `native_tally_matches_fixture` fails if engine behaviour ever
//! drifts from it. Also scans the generated TypeScript types for
//! `bigint` (spec §4: counts are u32; nothing may serialize as
//! bigint).
//!
//! Native-only: there is no filesystem under wasm-pack test.

#![cfg(not(target_arch = "wasm32"))]

use std::fs;
use std::path::PathBuf;

use serde::{Deserialize, Serialize};

use neophylo_core::algos::Method;
use neophylo_core::bootstrap::BootstrapTally;
use neophylo_core::dist::DistModel;
use neophylo_core::error::NeoError;
use neophylo_core::seq::Alignment;

/// The committed fixture envelope: the exact inputs, so the wasm test
/// replays the same run, plus the native tally it must equal.
#[derive(Debug, Serialize, Deserialize)]
struct TallyFixture {
    input: String,
    model: DistModel,
    method: Method,
    seed: u64,
    start: u32,
    count: u32,
    tally: BootstrapTally,
}

const FIXTURE_JSON: &str = include_str!("data/bootstrap_tally_jc6.json");
const INPUT: &str = include_str!("../../../fixtures/inputs/jc6.fasta");
const FIXTURE_PATH: &str = "tests/data/bootstrap_tally_jc6.json";

fn run(fx: &TallyFixture) -> Result<BootstrapTally, NeoError> {
    let aln: Alignment = neophylo_core::parse_fasta(INPUT)?;
    neophylo_core::bootstrap_batch(&aln, fx.model, fx.method, fx.seed, fx.start, fx.count)
}

#[test]
fn native_tally_matches_fixture() {
    let fx: TallyFixture = serde_json::from_str(FIXTURE_JSON).unwrap();
    assert_eq!(fx.input, "fixtures/inputs/jc6.fasta");
    let tally = run(&fx).expect("native bootstrap_batch must succeed");
    assert_eq!(tally, fx.tally);
}

/// Regenerate the fixture. Deliberately `#[ignore]`d: it is the oracle
/// producer, not a check.
#[test]
#[ignore = "rewrites the committed fixture; run deliberately"]
fn write_fixture() {
    let fx = TallyFixture {
        input: "fixtures/inputs/jc6.fasta".to_string(),
        model: DistModel::Jc69,
        method: Method::Nj,
        seed: 7,
        start: 0,
        count: 50,
        tally: neophylo_core::bootstrap_batch(
            &neophylo_core::parse_fasta(INPUT).unwrap(),
            DistModel::Jc69,
            Method::Nj,
            7,
            0,
            50,
        )
        .unwrap(),
    };
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(FIXTURE_PATH);
    fs::write(
        &path,
        format!("{}\n", serde_json::to_string_pretty(&fx).unwrap()),
    )
    .unwrap();
    eprintln!("wrote {}", path.display());
}

#[test]
fn generated_types_have_no_bigint() {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../web/src/engine/generated");
    let mut scanned = 0usize;
    for entry in fs::read_dir(&dir).expect("generated types dir must exist") {
        let path = entry.unwrap().path();
        if path.extension().and_then(|e| e.to_str()) != Some("ts") {
            continue;
        }
        let text = fs::read_to_string(&path).unwrap();
        assert!(
            !text.contains("bigint"),
            "{}: generated type contains bigint (spec §4: counts are u32)",
            path.display()
        );
        scanned += 1;
    }
    assert!(scanned > 0, "no .ts files found under {}", dir.display());
}
