//! Parity of `Poisson` (and the existing models under every site
//! filter) against the frozen MEGA-CC oracle (v1.4b spec §3.5, plan
//! Task 4).
//!
//! Every `fixtures/mega/*.json` is replayed: for every `distances` key
//! `"<model>/<filter>"` over p, JC69, K80 or Poisson,
//! `compute_filtered` must equal MEGA's printed matrix within half a
//! unit of the last printed decimal (`precision.distances`, 8). MEGA
//! prints `n/c` for cells it cannot compute — stored as JSON `null` —
//! which asserts `Cell::Saturated` or the `InsufficientOverlap` error,
//! never a skip.
//!
//! MEGA's `"JTT"` keys are compared for divergence, not parity: MEGA's
//! JTT is a different estimator NeoPhylo does not ship (owner decision
//! on #117, 2026-10-28 — docs/decisions.md). `jtt_diverges_from_mega`
//! pins the measured gap between our `Jtt` (PHYLIP 3.697 spectral
//! data) and MEGA's printed JTT matrices, and
//! `every_fixture_key_is_handled` makes sure no fixture key is ever
//! silently ignored.
//!
//! For every `trees` key `"<method>/<model>/<filter>"` the tree built
//! on MEGA's printed matrix must reproduce MEGA's topology and labels
//! (branch lengths are not compared on the rounded matrix — the
//! fixture trees were generated at full precision, so rounding
//! propagates ~1e-9; see `check_tree`), and for the parity models the
//! tree built on our own matrix — which equals MEGA's unrounded one to
//! ~1e-15 — must match topology and every branch length within
//! `len_tol` of that value's own printed decimals. NJ trees are
//! compared as unrooted topologies (basal trifurcation); UPGMA trees
//! as rooted.
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

/// The engine model a fixture distance key is parity-compared with.
/// `"JTT"` never reaches this: MEGA's JTT estimator is not our `Jtt`
/// (owner decision on #117 — docs/decisions.md), so JTT keys are
/// routed to `jtt_diverges_from_mega` and the printed-matrix topology
/// check, never to an equality comparison.
fn model_of(name: &str) -> DistModel {
    match name {
        "p" => DistModel::P,
        "JC69" => DistModel::Jc69,
        "K80" => DistModel::K80,
        "Poisson" => DistModel::Poisson,
        other => panic!("unknown parity model key {other:?}"),
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
            // MEGA's JTT is a different estimator (docs/decisions.md):
            // `jtt_diverges_from_mega` pins the gap, never an equality.
            if mname == "JTT" {
                continue;
            }
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
            if mname == "JTT" {
                // No branch-length (or engine-matrix) check for JTT
                // trees: the fixture tree was built on MEGA's own JTT
                // matrix, whose estimator differs from our `Jtt` by
                // up to ~0.18 on the most divergent pairs
                // (`jtt_diverges_from_mega`), so no MEGA JTT branch
                // length is reproducible by the engine. Topology and
                // labels are still asserted on the printed matrix —
                // the tree algorithm is ours either way.
                continue;
            }
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

/// Owner decision on #117 (2026-10-28, option D): NeoPhylo does not
/// ship MEGA's JTT estimator — neither MEGA's binary nor an
/// independent JTT92 derivation is an acceptable or working source
/// for its table (docs/decisions.md, v1.4b Task 4). Our `Jtt` follows
/// PHYLIP 3.697's spectral data, so it must DIFFER from MEGA's
/// printed `JTT/<filter>` matrices: this test pins the gap so a
/// silent drift toward or away from MEGA cannot slip in. On every
/// protein fixture and every filter, at least one cell must differ
/// by more than 1e-3 — or MEGA's `n/c` state must mismatch.
///
/// Measured per-input max |diff| (identical under every filter —
/// these protein inputs carry no gaps, so `complete` and `partial95`
/// coincide with `pairwise`):
///
/// | input   | max |diff| |
/// |---------|------------|
/// | p6_150  | 0.029497   |
/// | p8_250  | 0.003641   |
/// | p10_400 | 0.048638   |
/// | p12_100 | 0.177891   |
#[test]
fn jtt_diverges_from_mega() {
    for (stem, fx) in load_fixtures() {
        if fx.alphabet != "protein" {
            continue;
        }
        let aln = load_alignment(&fx.input);
        for (key, run) in &fx.distances {
            let (mname, fname) = key.split_once('/').expect("model/filter key");
            if mname != "JTT" {
                continue;
            }
            let ctx = format!("{stem} {key}");
            let dm = compute_filtered(&aln, DistModel::Jtt, filter_of(fname))
                .unwrap_or_else(|e| panic!("{ctx}: {e:?}"));
            let n = run.labels.len();
            assert_eq!(dm.labels, run.labels, "{ctx}: labels");
            let mut max_diff = 0.0f64;
            let mut state_mismatch = false;
            for (i, row) in run.matrix.iter().enumerate() {
                for (j, exp) in row.iter().enumerate() {
                    match (exp, dm.cells[i * n + j]) {
                        (Some(v), Cell::Value(g)) => max_diff = max_diff.max((g - v).abs()),
                        (None, Cell::Saturated) => {}
                        // MEGA printed a value where ours saturates,
                        // or n/c where ours returns a distance: a
                        // divergence of state, not of magnitude.
                        _ => state_mismatch = true,
                    }
                }
            }
            assert!(
                max_diff > 1e-3 || state_mismatch,
                "{ctx}: Jtt matches MEGA's JTT (max |diff| {max_diff}) — \
                 the recorded divergence is gone"
            );
        }
    }
}

/// Coverage guard: every key in every `fixtures/mega/*.json` must be
/// either parity-compared above (p, JC69, K80, Poisson) or a JTT key,
/// which `jtt_diverges_from_mega` covers for distances and the
/// printed-matrix topology check covers for trees. Any other model,
/// filter or method name fails here, so a fixture key added later can
/// never be silently ignored.
#[test]
fn every_fixture_key_is_handled() {
    fn check_model(stem: &str, key: &str, mname: &str, protein: bool) {
        match mname {
            "p" | "JC69" | "K80" | "Poisson" => {}
            // JTT keys are covered only on protein fixtures — the
            // divergence test skips DNA alignments.
            "JTT" => assert!(protein, "{stem} {key}: JTT on a non-protein fixture"),
            other => panic!(
                "{stem} {key}: model {other:?} has no comparison — \
                 add a parity arm or a divergence test"
            ),
        }
    }
    for (stem, fx) in load_fixtures() {
        let protein = fx.alphabet == "protein";
        for key in fx.distances.keys() {
            let (mname, fname) = key
                .split_once('/')
                .unwrap_or_else(|| panic!("{stem} {key}: not a <model>/<filter> key"));
            filter_of(fname);
            check_model(&stem, key, mname, protein);
        }
        for key in fx.trees.keys() {
            let mut it = key.split('/');
            match it.next() {
                Some("nj") | Some("upgma") => {}
                other => panic!("{stem} {key}: unknown method {other:?}"),
            }
            let (mname, fname) = (
                it.next()
                    .unwrap_or_else(|| panic!("{stem} {key}: missing model")),
                it.next()
                    .unwrap_or_else(|| panic!("{stem} {key}: missing filter")),
            );
            assert!(it.next().is_none(), "{stem} {key}: trailing segment");
            filter_of(fname);
            check_model(&stem, key, mname, protein);
        }
    }
}
