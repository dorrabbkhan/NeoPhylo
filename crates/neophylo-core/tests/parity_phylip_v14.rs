//! Parity of `F84` and `K2pPhylip` against PHYLIP `dnadist`
//! (v1.4 spec §3.2–§3.3).
//!
//! Every `fixtures/phylip/f84/*.json` and `fixtures/phylip/k2p/*.json`
//! is replayed: the engine recomputes the matrix for the fixture's
//! `input` alignment and each cell must equal dnadist's printed value
//! within half a unit of the last printed decimal (`precision`, 6 for
//! dnadist 3.697). dnadist prints `-1.000000` for an inestimable
//! distance ("DIFFERENCE ... TOO LARGE TO ESTIMATE DISTANCE"); a
//! negative fixture cell asserts `Cell::Saturated`.
//!
//! Fixture shape mirrors `fixtures/ref/*_phylip.json`, except
//! `distances` keys are the model run: `"F84"` for the f84 directory
//! and the transition/transversion ratio (`"2.0"`, `"4.0"`) for k2p.
//! Fixtures are the oracle: a failure here is a bug in the engine,
//! never in the fixture (AGENTS.md rule 1).

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::Deserialize;

use neophylo_core::dist::{compute, Cell, DistModel};
use neophylo_core::seq::{parse_fasta, Alignment};

#[derive(Deserialize)]
struct Fixture {
    name: String,
    labels: Vec<String>,
    /// Path to the FASTA input, relative to `fixtures/`.
    input: String,
    /// run name -> full n×n matrix (`"F84"`, or a ratio like `"2.0"`).
    distances: BTreeMap<String, Vec<Vec<f64>>>,
    /// Number of decimals dnadist prints.
    precision: u32,
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn load_dir(sub: &str) -> Vec<Fixture> {
    let dir = fixtures_dir().join("phylip").join(sub);
    let mut paths: Vec<PathBuf> = fs::read_dir(&dir)
        .unwrap_or_else(|e| panic!("{}: {e}", dir.display()))
        .map(|e| e.expect("readable dir entry").path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    paths.sort();
    assert!(!paths.is_empty(), "no fixtures in {}", dir.display());
    paths
        .iter()
        .map(|p| {
            serde_json::from_str(&fs::read_to_string(p).expect("readable fixture"))
                .unwrap_or_else(|e| panic!("{}: {e}", p.display()))
        })
        .collect()
}

fn load_alignment(fx: &Fixture) -> Alignment {
    let text = fs::read_to_string(fixtures_dir().join(&fx.input))
        .unwrap_or_else(|e| panic!("{}: cannot read {}: {e}", fx.name, fx.input));
    let aln = parse_fasta(&text).unwrap_or_else(|e| panic!("{}: {e:?}", fx.name));
    assert_eq!(
        aln.labels, fx.labels,
        "{}: labels differ from input",
        fx.name
    );
    aln
}

fn cell(m: &neophylo_core::dist::DistanceMatrix, i: usize, j: usize) -> Cell {
    m.cells[i * m.n() + j]
}

/// Half a unit of the last printed decimal — the strictest tolerance
/// the printed precision supports (v1.4 spec §3.2).
fn tol(fx: &Fixture) -> f64 {
    0.5 * 10f64.powi(-(fx.precision as i32))
}

/// Replay one fixture matrix against `model`, asserting every printed
/// value matches at printed precision. Returns the recomputed matrix.
fn check_matrix(
    fx: &Fixture,
    aln: &Alignment,
    run: &str,
    model: DistModel,
) -> neophylo_core::dist::DistanceMatrix {
    let expected = &fx.distances[run];
    let m = compute(aln, model).unwrap_or_else(|e| panic!("{}: {e:?}", fx.name));
    assert_eq!(m.n(), expected.len(), "{}: row count", fx.name);
    for (i, row) in expected.iter().enumerate() {
        for (j, &exp) in row.iter().enumerate() {
            let got = cell(&m, i, j);
            if exp < 0.0 {
                assert_eq!(
                    got,
                    Cell::Saturated,
                    "{} {run} cell ({i}, {j}): dnadist printed {exp} \
                     (inestimable), engine gave {got:?}",
                    fx.name
                );
            } else {
                match got {
                    Cell::Value(v) => assert!(
                        (v - exp).abs() <= tol(fx),
                        "{} {run} cell ({i}, {j}): engine {v} vs dnadist {exp} \
                         (tol {})",
                        fx.name,
                        tol(fx)
                    ),
                    Cell::Saturated => panic!(
                        "{} {run} cell ({i}, {j}): engine Saturated, \
                         dnadist printed {exp}",
                        fx.name
                    ),
                }
            }
        }
    }
    m
}

#[test]
fn f84_matches_dnadist_printed_output() {
    for fx in load_dir("f84") {
        let aln = load_alignment(&fx);
        assert!(
            fx.distances.contains_key("F84"),
            "{}: no F84 matrix",
            fx.name
        );
        check_matrix(&fx, &aln, "F84", DistModel::F84);
    }
}

#[test]
fn k2p_phylip_matches_dnadist_printed_output() {
    for fx in load_dir("k2p") {
        let aln = load_alignment(&fx);
        assert!(
            fx.distances.len() >= 2,
            "{}: expected more than one ratio run",
            fx.name
        );
        for ratio in fx.distances.keys() {
            let r: f64 = ratio
                .parse()
                .unwrap_or_else(|_| panic!("{}: bad ratio key {ratio:?}", fx.name));
            check_matrix(&fx, &aln, ratio, DistModel::K2pPhylip { ratio: r });
        }
    }
}

/// Spec §3.3: `K2P_PHYLIP` is a different estimator from spec §4.3's
/// `K80` — dnadist maximizes the likelihood at a *preset* ratio with
/// equal frequencies, K80 is the closed form in observed fractions.
/// They must visibly disagree: at least one committed dnadist K2P cell
/// differs from the engine's K80 on the same data by more than the
/// printed precision.
#[test]
fn k2p_phylip_differs_from_k80_by_design() {
    let mut found = false;
    for fx in load_dir("k2p") {
        let aln = load_alignment(&fx);
        let k80 = compute(&aln, DistModel::K80).unwrap();
        for (run, expected) in &fx.distances {
            for (i, row) in expected.iter().enumerate() {
                for (j, &exp) in row.iter().enumerate() {
                    if exp < 0.0 {
                        continue;
                    }
                    if let Cell::Value(v) = cell(&k80, i, j) {
                        if (v - exp).abs() > tol(&fx) {
                            found = true;
                        }
                    }
                }
            }
            let _ = run;
        }
    }
    assert!(
        found,
        "K2P_PHYLIP and K80 agree at printed precision on every \
         fixture cell — the spec §3.3 divergence is missing"
    );
}
