//! Parity of `Poisson` and `JttMega` (and the existing models under
//! every site filter) against the frozen MEGA-CC oracle (v1.4b spec
//! §3.5, plan Task 4).
//!
//! Every `fixtures/mega/*.json` is replayed: for every `distances` key
//! `"<model>/<filter>"`, `compute_filtered` must equal MEGA's printed
//! matrix within half a unit of the last printed decimal
//! (`precision.distances`, 8). MEGA prints `n/c` for cells it cannot
//! compute — stored as JSON `null` — which asserts `Cell::Saturated`
//! or the `InsufficientOverlap` error, never a skip.
//!
//! For every `trees` key `"<method>/<model>/<filter>"` two checks run:
//! the tree built on MEGA's printed matrix must reproduce MEGA's
//! topology and labels (branch lengths are not compared on the rounded
//! matrix — the fixture trees were generated at full precision, so
//! rounding propagates ~1e-9; see `check_tree`), and the tree built on
//! our own matrix — which equals MEGA's unrounded one to ~1e-15 — must
//! match topology and every branch length within `len_tol` of that
//! value's own printed decimals. NJ trees are compared as unrooted
//! topologies (basal trifurcation); UPGMA trees as rooted.
//!
//! Fixtures are the oracle: a failure here is a bug in the engine,
//! never in the fixture (AGENTS.md rule 1).

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::Deserialize;

use neophylo_core::algos::{build_tree, BuildOptions, Method};
use neophylo_core::dist::{compute_filtered, Cell, DistModel, DistanceMatrix};
use neophylo_core::error::NeoError;
use neophylo_core::matrix::Matrix;
use neophylo_core::seq::{parse_fasta, Alignment};
use neophylo_core::site_filter::SiteFilter;
use neophylo_core::Alphabet;

#[derive(Deserialize)]
struct Precision {
    distances: u32,
    #[allow(dead_code)]
    branch_lengths: u32,
}

#[derive(Deserialize)]
struct MegaFixture {
    input: String,
    alphabet: String,
    precision: Precision,
    distances: BTreeMap<String, DistRun>,
    trees: BTreeMap<String, String>,
}

#[derive(Deserialize)]
struct DistRun {
    labels: Vec<String>,
    matrix: Vec<Vec<Option<f64>>>,
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn load_fixtures() -> Vec<(String, MegaFixture)> {
    let dir = fixtures_dir().join("mega");
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
            let stem = p.file_stem().unwrap().to_string_lossy().to_string();
            let fx = serde_json::from_str(&fs::read_to_string(p).expect("readable fixture"))
                .unwrap_or_else(|e| panic!("{}: {e}", p.display()));
            (stem, fx)
        })
        .collect()
}

fn load_alignment(rel: &str) -> Alignment {
    let text = fs::read_to_string(fixtures_dir().join(rel))
        .unwrap_or_else(|e| panic!("{rel}: cannot read: {e}"));
    parse_fasta(&text).unwrap_or_else(|e| panic!("{rel}: {e:?}"))
}

fn model_of(name: &str) -> DistModel {
    match name {
        "p" => DistModel::P,
        "JC69" => DistModel::Jc69,
        "K80" => DistModel::K80,
        "Poisson" => DistModel::Poisson,
        // The fixture's "JTT" is MEGA's JTT estimator: our JttMega
        // (MEGA's own spectral data + its raw Newton iterate), not the
        // PHYLIP-3.697 Jtt (fixtures/worked/mega-notes.md).
        "JTT" => DistModel::JttMega,
        other => panic!("unknown model key {other:?}"),
    }
}

fn filter_of(name: &str) -> SiteFilter {
    match name {
        "pairwise" => SiteFilter::Pairwise,
        "complete" => SiteFilter::Complete,
        "partial95" => SiteFilter::Partial { cutoff_pct: 95 },
        other => panic!("unknown filter key {other:?}"),
    }
}

fn dist_tol(fx: &MegaFixture) -> f64 {
    0.5 * 10f64.powi(-(fx.precision.distances as i32))
}

/// Replay one fixture matrix; returns the engine matrix (or a marker
/// matrix when a legit `InsufficientOverlap` occurs — asserted below).
fn check_distances(
    ctx: &str,
    fx: &MegaFixture,
    aln: &Alignment,
    run: &DistRun,
    model: DistModel,
    filter: SiteFilter,
) -> DistanceMatrix {
    let n = run.labels.len();
    let has_null = run.matrix.iter().flatten().any(|c| c.is_none());
    match compute_filtered(aln, model, filter) {
        Err(NeoError::InsufficientOverlap { .. }) => {
            assert!(
                has_null,
                "{ctx}: engine reports InsufficientOverlap but MEGA printed \
                 every cell"
            );
            DistanceMatrix {
                labels: run.labels.clone(),
                model,
                cells: vec![Cell::Saturated; n * n],
            }
        }
        Err(e) => panic!("{ctx}: {e:?}"),
        Ok(dm) => {
            assert_eq!(dm.labels, run.labels, "{ctx}: labels");
            for (i, row) in run.matrix.iter().enumerate() {
                for (j, exp) in row.iter().enumerate() {
                    match (exp, dm.cells[i * n + j]) {
                        (Some(v), Cell::Value(g)) => assert!(
                            (g - v).abs() <= dist_tol(fx),
                            "{ctx}: cell ({i},{j}): engine {g} vs MEGA {v} \
                             (tol {})",
                            dist_tol(fx)
                        ),
                        (Some(v), Cell::Saturated) => {
                            panic!("{ctx}: cell ({i},{j}) saturated, MEGA has {v}")
                        }
                        (None, Cell::Saturated) => {}
                        (None, Cell::Value(g)) => panic!(
                            "{ctx}: cell ({i},{j}): MEGA reports n/c but \
                             engine gave {g}"
                        ),
                    }
                }
            }
            dm
        }
    }
}

// ---- newick edge extraction ----------------------------------------

/// One edge of a newick: the sorted leaf labels below it, the printed
/// length, and the number of decimals it was printed with.
type Edge = (Vec<String>, f64, usize);

/// Recursive-descent scan of the fixture's newick text, keeping each
/// value's own decimal count (MEGA trims trailing zeros, so the
/// tolerance has to come from the string, not a global precision).
struct NwkScan<'a> {
    s: &'a [u8],
    pos: usize,
    edges: Vec<Edge>,
}

impl<'a> NwkScan<'a> {
    fn ws(&mut self) {
        while self.pos < self.s.len() && self.s[self.pos].is_ascii_whitespace() {
            self.pos += 1;
        }
    }
    /// Parse one subtree; returns its leaf-label list.
    fn subtree(&mut self) -> Vec<String> {
        self.ws();
        let mut leaves;
        if self.s[self.pos] == b'(' {
            self.pos += 1;
            leaves = Vec::new();
            loop {
                leaves.extend(self.subtree());
                self.ws();
                match self.s[self.pos] {
                    b',' => {
                        self.pos += 1;
                    }
                    b')' => {
                        self.pos += 1;
                        break;
                    }
                    c => panic!("expected ',' or ')' got {}", c as char),
                }
            }
            // Optional internal label (ignored): skip to ':' or ',' or ')'.
            while self.pos < self.s.len() && !matches!(self.s[self.pos], b':' | b',' | b')' | b';')
            {
                self.pos += 1;
            }
        } else {
            // Leaf name up to ':' ',' ')' ';'.
            let start = self.pos;
            while self.pos < self.s.len() && !matches!(self.s[self.pos], b':' | b',' | b')' | b';')
            {
                self.pos += 1;
            }
            leaves = vec![String::from_utf8_lossy(&self.s[start..self.pos])
                .trim()
                .to_string()];
        }
        // Optional :length.
        if self.pos < self.s.len() && self.s[self.pos] == b':' {
            self.pos += 1;
            let start = self.pos;
            while self.pos < self.s.len()
                && (self.s[self.pos].is_ascii_digit()
                    || matches!(self.s[self.pos], b'.' | b'-' | b'+' | b'e' | b'E'))
            {
                self.pos += 1;
            }
            let tok = String::from_utf8_lossy(&self.s[start..self.pos]).to_string();
            let decimals = tok
                .find('.')
                .map(|d| {
                    tok[d + 1..]
                        .chars()
                        .take_while(|c| c.is_ascii_digit())
                        .count()
                })
                .unwrap_or(0);
            leaves.sort();
            self.edges
                .push((leaves.clone(), tok.parse().unwrap(), decimals));
        }
        leaves
    }
}

fn nwk_edges(text: &str) -> Vec<Edge> {
    let mut sc = NwkScan {
        s: text.as_bytes(),
        pos: 0,
        edges: Vec::new(),
    };
    sc.subtree();
    sc.edges
}

/// Canonical split key: for unrooted comparison (`rooted=false`) the
/// side not containing the alphabetically-smallest leaf label.
fn canon(mut clade: Vec<String>, all: &[String], rooted: bool) -> Vec<String> {
    if !rooted && clade.contains(&all[0]) {
        clade = all.iter().filter(|l| !clade.contains(l)).cloned().collect();
    }
    clade
}

fn edge_map(nwk: &str, rooted: bool) -> BTreeMap<Vec<String>, (f64, usize)> {
    let edges = nwk_edges(nwk);
    let mut all: Vec<String> = edges.iter().flat_map(|(c, _, _)| c.clone()).collect();
    all.sort();
    all.dedup();
    edges
        .into_iter()
        .map(|(c, v, d)| (canon(c, &all, rooted), (v, d)))
        .collect()
}

/// Per-value branch-length tolerance (README rule + floating-point
/// floor): `max(0.5·10^-d, 8·f64::EPSILON·max(1, |value|))`.
///
/// The README rule alone (half an ulp of the value's own decimals)
/// asks for f64 resolution at 17–18 printed digits, so the
/// accumulated-rounding floor guards against noise (v1.4b Task 4
/// notes). Measured worst |diff| across all fixtures when the tree is
/// built on the engine matrix: 4.5e-15, always within this floor.
fn len_tol(value: f64, decimals: usize) -> f64 {
    (0.5 * 10f64.powi(-(decimals as i32))).max(8.0 * f64::EPSILON * value.abs().max(1.0))
}

/// Tree topology + branch lengths against the fixture's newick.
/// `rooted` selects rooted (UPGMA) vs unrooted (NJ) split keys.
/// Returns the engine tree's edge map for the topology-only reuse.
fn check_tree(
    ctx: &str,
    nwk: &str,
    dm: &DistanceMatrix,
    method: Method,
) -> BTreeMap<Vec<String>, (f64, usize)> {
    let rooted = method == Method::Upgma;
    let exp = edge_map(nwk, rooted);
    let got = build_tree(dm, method, BuildOptions { trace: false })
        .unwrap_or_else(|e| panic!("{ctx}: {e:?}"));
    let got_nwk = neophylo_core::newick::write_newick(&got.tree);
    let act = edge_map(&got_nwk, rooted);
    assert_eq!(
        exp.keys().collect::<Vec<_>>(),
        act.keys().collect::<Vec<_>>(),
        "{ctx}: topology differs from MEGA"
    );
    for (clade, (v, d)) in &exp {
        let tol = len_tol(*v, *d);
        let (g, _) = act[clade];
        assert!(
            (g - v).abs() <= tol,
            "{ctx}: clade {clade:?} length {g} vs MEGA {v} (tol {tol})"
        );
    }
    act
}

#[test]
fn mega_distances_match_at_printed_precision() {
    for (stem, fx) in load_fixtures() {
        let aln = load_alignment(&fx.input);
        for (key, run) in &fx.distances {
            let (mname, fname) = key.split_once('/').expect("model/filter key");
            let ctx = format!("{stem} {key}");
            assert_eq!(
                fx.alphabet == "protein",
                aln.alphabet == Alphabet::Protein,
                "{ctx}: alphabet"
            );
            check_distances(&ctx, &fx, &aln, run, model_of(mname), filter_of(fname));
        }
    }
}

#[test]
fn mega_trees_match_topology_and_lengths() {
    for (stem, fx) in load_fixtures() {
        let aln = load_alignment(&fx.input);
        for (key, nwk) in &fx.trees {
            let mut it = key.split('/');
            let method = match it.next().unwrap() {
                "nj" => Method::Nj,
                "upgma" => Method::Upgma,
                other => panic!("{stem} {key}: bad method {other}"),
            };
            let (mname, fname) = (it.next().unwrap(), it.next().unwrap());
            let run = &fx.distances[&format!("{mname}/{fname}")];
            // NJ/UPGMA built on MEGA's printed matrix.
            let n = run.labels.len();
            let mut data = Vec::with_capacity(n * n);
            for row in &run.matrix {
                for cell in row {
                    data.push(cell.unwrap_or_else(|| {
                        panic!("{stem} {key}: tree over a matrix with n/c cells")
                    }));
                }
            }
            let mega_dm = DistanceMatrix::from_values(run.labels.clone(), &Matrix { n, data });
            let ctx = format!("{stem} {key}");
            // NJ/UPGMA on MEGA's printed matrix must reproduce MEGA's
            // topology and labels exactly. Branch lengths are NOT
            // compared on this input: the fixture trees were computed
            // on MEGA's full-precision internal matrix (verified — the
            // engine matrix reproduces MEGA's branch lengths to
            // <=4.5e-15 on every fixture), so the ±5e-9 rounding error
            // of the 8-decimal printed matrix propagates ~1e-9 into
            // branch lengths and no implementation could meet a
            // half-ulp bound here (docs/decisions.md, v1.4b Task 4).
            let exp = {
                let rooted = method == Method::Upgma;
                let e = edge_map(nwk, rooted);
                let got = build_tree(&mega_dm, method, BuildOptions { trace: false })
                    .unwrap_or_else(|err| panic!("{ctx} printed-matrix: {err:?}"));
                let act = edge_map(&neophylo_core::newick::write_newick(&got.tree), rooted);
                assert_eq!(
                    e.keys().collect::<Vec<_>>(),
                    act.keys().collect::<Vec<_>>(),
                    "{ctx}: printed-matrix topology differs"
                );
                e
            };
            // Full parity on the engine's own matrix: topology and
            // every branch length at per-value precision.
            let ours = compute_filtered(&aln, model_of(mname), filter_of(fname))
                .unwrap_or_else(|e| panic!("{ctx} ours: {e:?}"));
            let act = check_tree(&ctx, nwk, &ours, method);
            assert_eq!(
                exp.keys().collect::<Vec<_>>(),
                act.keys().collect::<Vec<_>>(),
                "{ctx}: engine-matrix topology differs"
            );
        }
    }
}

/// spec §3.3: `JTT_MEGA` is a different estimator from `JTT` — MEGA's
/// JTT uses the PHYLIP-3.6 spectral decomposition and reports its raw
/// Newton iterate, ours uses the 3.697 data with a bounded global
/// check. The divergence must be visible on `p12_100`, where the notes
/// record the largest difference (0.177891 on one cell).
#[test]
fn jtt_mega_differs_from_jtt() {
    let aln = load_alignment("inputs/protein/p12_100.fasta");
    let jtt = compute_filtered(&aln, DistModel::Jtt, SiteFilter::Pairwise).unwrap();
    let mega = compute_filtered(&aln, DistModel::JttMega, SiteFilter::Pairwise).unwrap();
    let mut max_diff = 0.0f64;
    for (a, b) in jtt.cells.iter().zip(mega.cells.iter()) {
        if let (Cell::Value(x), Cell::Value(y)) = (a, b) {
            max_diff = max_diff.max((x - y).abs());
        }
    }
    assert!(
        max_diff > 0.17,
        "JTT and JTT_MEGA agree within {max_diff} on p12_100 — the \
         mega-notes divergence (0.177891) is missing"
    );
}
