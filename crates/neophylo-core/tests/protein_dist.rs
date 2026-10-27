//! Protein distances: Kimura, JTT maximum likelihood and the pair
//! detail (v1.1 spec §3.4, plan Task 6).
//!
//! `fixtures/ref/protein/*.json` replay the `protdist` outputs recorded
//! in Task 2: JTT and Kimura at printed precision plus the `neighbor`
//! Newick for the JTT matrix. `second_opinion.JTT` (phangorn `dist.ml`)
//! is measured and printed for `docs/decisions.md`, not gated.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::Deserialize;

use neophylo_core::algos::{build_tree, BuildOptions, Method};
use neophylo_core::alphabet::{protein_index, with_alphabet, Alphabet};
use neophylo_core::compare::rf;
use neophylo_core::dist::{compute, Cell, DistModel, DistanceMatrix};
use neophylo_core::error::NeoError;
use neophylo_core::matrix::Matrix;
use neophylo_core::model::JTT;
use neophylo_core::newick::parse_newick;
use neophylo_core::protein_dist::{
    jtt_ml, jtt_pair_detail, kimura_from_p, optimizer_estimates, pair_counts,
};
use neophylo_core::seq::{parse_fasta, Alignment};
use neophylo_core::tree::Tree;
use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};

#[derive(Deserialize)]
struct ProteinFixture {
    name: String,
    alphabet: String,
    labels: Vec<String>,
    /// Path to the FASTA input, relative to `fixtures/`.
    input: String,
    /// model name -> n×n matrix. PHYLIP prints `-1` for saturated cells.
    distances: BTreeMap<String, Vec<Vec<f64>>>,
    /// model name -> reference Newick.
    #[serde(default)]
    nj: BTreeMap<String, String>,
    /// Decimals protdist printed in the matrix outfile (6).
    dist_precision: u32,
    /// Decimals `neighbor` printed in the outtree (5).
    tree_precision: u32,
    second_opinion: SecondOpinion,
}

#[derive(Deserialize)]
struct SecondOpinion {
    #[serde(rename = "JTT")]
    jtt: Vec<Vec<f64>>,
}

#[derive(Deserialize)]
struct DocFixture {
    labels: Vec<String>,
    sequences: Vec<String>,
    jtt: Vec<Vec<f64>>,
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

/// Half a unit of the matrix's last printed decimal — the spec §8.1
/// rule for PHYLIP distances (`dist_precision`, 6 for protdist).
fn dist_tol(fx: &ProteinFixture) -> f64 {
    0.5 * 10f64.powi(-(fx.dist_precision as i32))
}

/// Half a unit of the outtree's last printed decimal (`tree_precision`,
/// 5 for neighbor).
fn tree_tol(fx: &ProteinFixture) -> f64 {
    0.5 * 10f64.powi(-(fx.tree_precision as i32))
}

fn load_protein_fixtures() -> Vec<ProteinFixture> {
    let mut paths: Vec<PathBuf> = fs::read_dir(fixtures_dir().join("ref/protein"))
        .expect("fixtures/ref/protein must exist")
        .map(|e| e.expect("readable dir entry").path())
        .filter(|p| p.extension().is_some_and(|x| x == "json"))
        .collect();
    paths.sort();
    assert!(!paths.is_empty(), "no protein reference fixtures found");
    paths
        .iter()
        .map(|p| {
            serde_json::from_str(&fs::read_to_string(p).expect("readable fixture"))
                .unwrap_or_else(|e| panic!("{}: {e}", p.display()))
        })
        .collect()
}

fn load_doc() -> DocFixture {
    let p = fixtures_dir().join("worked/protdist_doc_jtt.json");
    serde_json::from_str(&fs::read_to_string(&p).expect("readable fixture"))
        .unwrap_or_else(|e| panic!("{}: {e}", p.display()))
}

/// The protdist documentation sequences are DNA-lookalikes: parsing the
/// fixture exercises the protein override end to end (spec §6.2).
fn doc_alignment() -> Alignment {
    let fx = load_doc();
    let fasta: String = fx
        .labels
        .iter()
        .zip(&fx.sequences)
        .map(|(l, s)| format!(">{l}\n{s}\n"))
        .collect();
    let aln = parse_fasta(&fasta).expect("doc FASTA must parse");
    assert_eq!(aln.alphabet, Alphabet::Dna);
    assert_eq!(aln.labels, fx.labels);
    with_alphabet(aln, Alphabet::Protein).expect("protein override must accept the doc data")
}

fn protein_alignment(fx: &ProteinFixture) -> Alignment {
    let text = fs::read_to_string(fixtures_dir().join(&fx.input))
        .unwrap_or_else(|e| panic!("{}: cannot read {}: {e}", fx.name, fx.input));
    let aln = parse_fasta(&text).unwrap_or_else(|e| panic!("{}: {e:?}", fx.name));
    assert_eq!(
        aln.labels, fx.labels,
        "{}: labels differ from input",
        fx.name
    );
    assert_eq!(fx.alphabet, "protein", "{}: fixture alphabet", fx.name);
    with_alphabet(aln, Alphabet::Protein).expect("protein corpus input")
}

fn model_of(name: &str) -> DistModel {
    match name {
        "JTT" => DistModel::Jtt,
        "Kimura" => DistModel::Kimura,
        other => panic!("unknown protein distance model {other:?}"),
    }
}

/// Compare a computed matrix against a printed PHYLIP matrix: a `want`
/// cell below zero is PHYLIP's `-1` saturated marker and must map to
/// `Cell::Saturated`; every other cell is a finite distance compared at
/// the fixture's printed tolerance.
fn check_distances(fx: &ProteinFixture, aln: &Alignment, model: &str, want: &[Vec<f64>]) {
    let tag = format!("{}/{model}", fx.name);
    let got = compute(aln, model_of(model)).unwrap_or_else(|e| panic!("{tag}: {e:?}"));
    let n = got.n();
    assert_eq!(want.len(), n, "{tag}: matrix row count");
    let t = dist_tol(fx);
    for (i, row) in want.iter().enumerate() {
        assert_eq!(row.len(), n, "{tag}: row {i} width");
        for (j, &w) in row.iter().enumerate() {
            let cell = got.cells[i * n + j];
            if w < 0.0 {
                assert_eq!(cell, Cell::Saturated, "{tag}: cell ({i},{j})",);
            } else {
                match cell {
                    Cell::Value(g) => assert!(
                        (g - w).abs() <= t,
                        "{tag}: cell ({i},{j}) got {g}, want {w} (tol {t})"
                    ),
                    Cell::Saturated => {
                        panic!("{tag}: cell ({i},{j}) saturated, fixture has {w}")
                    }
                }
            }
        }
    }
}

/// Every edge length in the tree, sorted (v1 §8.1 method).
fn branch_lengths(tree: &Tree) -> Vec<f64> {
    let mut v: Vec<f64> = tree.branches.iter().filter_map(|b| b.length).collect();
    v.sort_by(f64::total_cmp);
    v
}

/// NJ parity: rebuild the tree from the fixture's own matrix — exactly
/// the input `neighbor` consumed — and require unrooted RF = 0 plus
/// elementwise branch-length agreement at the printed tolerance.
fn check_nj(fx: &ProteinFixture, model: &str, newick: &str) {
    let tag = format!("{}/{model}/nj", fx.name);
    let want = &fx.distances[model];
    let n = fx.labels.len();
    let mut data = Vec::with_capacity(n * n);
    for row in want {
        for &w in row {
            // A `-1` in the tree reference's matrix would mean the
            // reference tool read a saturated cell — a fixture bug.
            assert!(w >= 0.0, "{tag}: negative distance in fixture matrix");
            data.push(w);
        }
    }
    let m = DistanceMatrix::from_values(fx.labels.clone(), &Matrix { n, data });
    let t = tree_tol(fx);
    let got = build_tree(&m, Method::Nj, BuildOptions { trace: false })
        .unwrap_or_else(|e| panic!("{tag}: build failed: {e:?}"))
        .tree;
    let want = parse_newick(newick).unwrap_or_else(|e| panic!("{tag}: {e:?}"));
    let r = rf(&want, &got).unwrap_or_else(|e| panic!("{tag}: {e:?}"));
    assert_eq!(r.rf, 0, "{tag}: unrooted RF must be 0");
    let (gl, wl) = (branch_lengths(&got), branch_lengths(&want));
    assert_eq!(gl.len(), wl.len(), "{tag}: edge count");
    for (k, (g, w)) in gl.iter().zip(&wl).enumerate() {
        assert!(
            (g - w).abs() <= t,
            "{tag}: branch length {k} got {g}, want {w} (tol {t})"
        );
    }
}

/// The spec §3.4 log-likelihood, rebuilt from the public `transition_probs`
/// API so the test stays an independent oracle for `jtt_ml`'s internals.
fn jtt_logl(counts: &[[u32; 20]; 20], d: f64) -> f64 {
    let p = JTT.transition_probs(d);
    let mut l = 0.0;
    for (x, row) in counts.iter().enumerate() {
        for (y, &n) in row.iter().enumerate() {
            if n > 0 {
                l += f64::from(n) * libm::log(JTT.freqs[x] * p[x][y]);
            }
        }
    }
    l
}

#[test]
fn kimura_values() {
    // x = 1 - p - 0.2p²; d = -ln x. Saturated at x <= 0 (p > ~0.854).
    let cases = [
        (0.2, 0.23319388716771114),
        (0.5, 0.7985076962177716),
        (0.85, 5.203007186743711),
    ];
    for (p, want) in cases {
        match kimura_from_p(p) {
            Cell::Value(d) => {
                assert!((d - want).abs() < 1e-12, "kimura({p}) = {d}, want {want}")
            }
            Cell::Saturated => panic!("kimura({p}) unexpectedly saturated"),
        }
    }
    assert_eq!(kimura_from_p(0.86), Cell::Saturated);
}

#[test]
fn jtt_doc_parity() {
    // The published protdist doc matrix, to 5e-7 (spec §6.2).
    let fx = load_doc();
    let aln = doc_alignment();
    let dm = compute(&aln, DistModel::Jtt).expect("JTT on doc data");
    let n = dm.n();
    for (i, row) in fx.jtt.iter().enumerate() {
        for (j, &w) in row.iter().enumerate() {
            match dm.cells[i * n + j] {
                Cell::Value(g) => assert!(
                    (g - w).abs() <= 5e-7,
                    "doc JTT cell ({i},{j}) got {g}, want {w}"
                ),
                Cell::Saturated => panic!("doc JTT cell ({i},{j}) saturated, want {w}"),
            }
        }
    }
}

#[test]
fn protdist_corpus() {
    for fx in load_protein_fixtures() {
        let aln = protein_alignment(&fx);
        for (model, want) in &fx.distances {
            check_distances(&fx, &aln, model, want);
        }
        for (model, newick) in &fx.nj {
            check_nj(&fx, model, newick);
        }
    }
}

#[test]
fn identical_is_zero() {
    // Spec §3.4: d̂ = 0 exactly for sequences identical over their
    // comparable sites.
    let aln = parse_fasta(">a\nMKVLACDEFG\n>b\nMKVLACDEFG\n").unwrap();
    let dm = compute(&aln, DistModel::Jtt).unwrap();
    assert_eq!(dm.cells[1], Cell::Value(0.0));
    let (counts, _, _) = pair_counts(&aln.seqs[0], &aln.seqs[1]);
    assert_eq!(jtt_ml(&counts), Cell::Value(0.0));
}

#[test]
fn slope_at_peak() {
    // Central-difference slope of logL at the ML estimate must be under
    // 1e-6 (h = 1e-5) on every corpus pair that found a finite d̂ > 0.01.
    let h = 1e-5;
    let mut checked = 0u32;
    for fx in load_protein_fixtures() {
        let aln = protein_alignment(&fx);
        let dm = compute(&aln, DistModel::Jtt).unwrap_or_else(|e| panic!("{}: {e:?}", fx.name));
        let n = dm.n();
        for i in 0..n {
            for j in (i + 1)..n {
                let Cell::Value(d) = dm.cells[i * n + j] else {
                    continue;
                };
                if d <= 0.01 {
                    continue;
                }
                let (counts, _, _) = pair_counts(&aln.seqs[i], &aln.seqs[j]);
                let slope = (jtt_logl(&counts, d + h) - jtt_logl(&counts, d - h)) / (2.0 * h);
                assert!(
                    slope.abs() < 1e-6,
                    "{}/{i},{j}: slope {slope} at d\u{0302}={d}",
                    fx.name
                );
                checked += 1;
            }
        }
    }
    assert!(checked > 0, "no corpus pairs exercised the slope check");
}

#[test]
fn saturated_pair() {
    // 50 sites of A vs 50 of W: the likelihood is still rising at the
    // search boundary (d = 10), so the pair is Saturated — the case
    // where protdist writes -1.
    let a = "A".repeat(50);
    let w = "W".repeat(50);
    let aln = parse_fasta(&format!(">a\n{a}\n>b\n{w}\n")).unwrap();
    let dm = compute(&aln, DistModel::Jtt).unwrap();
    assert_eq!(dm.cells[1], Cell::Saturated);
}

#[test]
fn pair_detail_shape() {
    let aln = doc_alignment();
    let jtt = compute(&aln, DistModel::Jtt).expect("JTT on doc data");
    let kimura = compute(&aln, DistModel::Kimura).expect("Kimura on doc data");
    let detail = jtt_pair_detail(&aln, 0, 1).expect("pair detail");
    assert_eq!((detail.a, detail.b), (0, 1));

    // d_hat equals the matrix cell; p/Kimura match compute().
    let Cell::Value(d) = jtt.cells[1] else {
        panic!("doc pair 0-1 must have a finite JTT estimate")
    };
    assert_eq!(detail.jtt, jtt.cells[1]);
    assert_eq!(detail.kimura, kimura.cells[1]);
    assert_eq!(detail.d_hat, Some(d));

    // 60 curve points spanning [0, max(2·d̂, 0.5)], all finite.
    assert_eq!(detail.curve.len(), 60);
    assert_eq!(detail.curve[0].0, 0.0);
    assert_eq!(detail.curve[59].0, (2.0 * d).max(0.5));
    for &(x, l) in &detail.curve {
        assert!(x.is_finite() && l.is_finite(), "curve point ({x}, {l})");
    }

    // The sparse table sums to the comparable-site count, and p is the
    // plain difference fraction.
    let sum: u32 = detail.counts.iter().map(|&(_, _, c)| c).sum();
    assert_eq!(sum, detail.comparable);
    assert_eq!(
        detail.p,
        detail.differences as f64 / detail.comparable as f64
    );
    assert!(detail.differences > 0, "doc pair 0-1 has differences");
}

#[test]
fn pair_detail_identical() {
    // Review Focus 5: an identical pair reports d̂ = 0 exactly and a
    // curve on [0, 0.5] (never a NaN range or empty panel).
    let aln = parse_fasta(">a\nMKVLAIDE\n>b\nMKVLAIDE\n").unwrap();
    let detail = jtt_pair_detail(&aln, 0, 1).expect("identical pair detail");
    assert_eq!(detail.jtt, Cell::Value(0.0));
    assert_eq!(detail.d_hat, Some(0.0));
    assert_eq!(detail.differences, 0);
    assert_eq!(detail.curve.len(), 60);
    assert_eq!(detail.curve[0].0, 0.0);
    assert_eq!(detail.curve[59].0, 0.5);
}

#[test]
fn pair_detail_no_overlap() {
    // Review Focus 5: a pair with no comparable sites errors, never
    // panics — the panel turns this into "no comparable sites" text.
    let aln = parse_fasta(">a\nM--AA\n>b\nXX-XX\n").unwrap();
    assert_eq!(
        jtt_pair_detail(&aln, 0, 1).unwrap_err(),
        NeoError::InsufficientOverlap {
            a: "a".to_string(),
            b: "b".to_string(),
        }
    );
}

#[test]
fn dna_mismatch() {
    // Kimura and JTT are protein-only (spec §3.4 compatibility table).
    let aln = parse_fasta(">a\nACGTAC\n>b\nACGAAC\n").unwrap();
    assert_eq!(aln.alphabet, Alphabet::Dna);
    assert_eq!(
        compute(&aln, DistModel::Kimura).unwrap_err(),
        NeoError::ModelAlphabetMismatch {
            model: "Kimura".to_string(),
            alphabet: Alphabet::Dna,
        }
    );
    assert_eq!(
        compute(&aln, DistModel::Jtt).unwrap_err(),
        NeoError::ModelAlphabetMismatch {
            model: "JTT".to_string(),
            alphabet: Alphabet::Dna,
        }
    );
    assert_eq!(
        jtt_pair_detail(&aln, 0, 1).unwrap_err(),
        NeoError::ModelAlphabetMismatch {
            model: "JTT".to_string(),
            alphabet: Alphabet::Dna,
        }
    );
}

/// Draw one amino acid from `probs` (a distribution over the 20 states)
/// using one uniform draw, `next_u64 / 2^64` as in `sim.rs`.
fn draw_aa(rng: &mut ChaCha8Rng, probs: &[f64; 20]) -> usize {
    let u = rng.next_u64() as f64 / 18446744073709551616.0;
    let mut cum = 0.0;
    for (i, &p) in probs.iter().enumerate() {
        cum += p;
        if u < cum {
            return i;
        }
    }
    19
}

/// A seeded JTT pair: parent drawn from `JTT.freqs`, child evolved over
/// distance `t` via `transition_probs`. Returned as the pair count table.
fn simulated_pair(rng: &mut ChaCha8Rng, len: usize, t: f64) -> [[u32; 20]; 20] {
    let p = JTT.transition_probs(t);
    let mut table = [[0u32; 20]; 20];
    for _ in 0..len {
        let x = draw_aa(rng, &JTT.freqs);
        let y = draw_aa(rng, &p[x]);
        table[x][y] += 1;
    }
    table
}

#[test]
fn newton_never_worse() {
    // Optimizer safety (Task 6 review): wherever the protdist Newton
    // trajectory converges, its estimate must be at least as good a
    // maximizer as the bounded Brent fallback (up to f64 noise).
    let mut rng = ChaCha8Rng::seed_from_u64(0x6a09e667f3bcc909);
    let mut checked = 0u32;
    let mut fell_back = 0u32;
    for k in 0..500 {
        // Lengths 20–400; divergence from identical to near-saturated.
        let len = 20 + (rng.next_u64() % 381) as usize;
        let u = rng.next_u64() as f64 / 18446744073709551616.0;
        let t = if k % 10 == 0 {
            u * 0.05 // near-identical
        } else {
            u * 9.0 // up to the bound
        };
        let counts = simulated_pair(&mut rng, len, t);
        let (newton, brent) = optimizer_estimates(&counts);
        let Some(d_newton) = newton else {
            fell_back += 1;
            continue;
        };
        let l_newton = jtt_logl(&counts, d_newton);
        let l_brent = jtt_logl(&counts, brent);
        assert!(
            l_newton >= l_brent - 1e-9,
            "pair {k} (len {len}, t {t}): logL(newton {d_newton}) = {l_newton} \
             < logL(brent {brent}) = {l_brent}"
        );
        checked += 1;
    }
    assert!(checked > 0, "no converged Newton pairs exercised");
    eprintln!("newton_never_worse: {checked} compared, {fell_back} fell back to Brent");
}

#[test]
fn optimizer_edge_cases() {
    // Identical over comparable sites: exactly 0.0.
    let mut identical = [[0u32; 20]; 20];
    for (s, row) in identical.iter_mut().enumerate() {
        row[s] = 20;
    }
    assert_eq!(jtt_ml(&identical), Cell::Value(0.0));

    // One difference in 400 sites: small finite estimate, Newton and
    // Brent agree closely.
    let aln = parse_fasta(&format!(
        ">a\n{}\n>b\n{}W\n",
        "M".repeat(400),
        "M".repeat(399)
    ))
    .unwrap();
    let (counts, comparable, differences) = pair_counts(&aln.seqs[0], &aln.seqs[1]);
    assert_eq!((comparable, differences), (400, 1));
    let Cell::Value(d) = jtt_ml(&counts) else {
        panic!("one difference in 400 sites must be finite")
    };
    assert!(d > 0.0 && d < 0.1, "one-diff-in-400 d̂ = {d}");
    let (newton, brent) = optimizer_estimates(&counts);
    let d_newton = newton.expect("one-diff pair must converge");
    assert!(
        (d_newton - brent).abs() < 1e-6,
        "newton {d_newton} vs brent {brent}"
    );

    // Saturated: 50 A vs 50 W — likelihood still climbing at the bound.
    let mut sat = [[0u32; 20]; 20];
    sat[protein_index(b'A').unwrap() as usize][protein_index(b'W').unwrap() as usize] = 50;
    assert_eq!(jtt_ml(&sat), Cell::Saturated);

    // d̂ inside (5, 10): expected counts at t = 6 keep the bounded
    // maximum interior.
    let p = JTT.transition_probs(6.0);
    let mut deep = [[0u32; 20]; 20];
    for (x, row) in deep.iter_mut().enumerate() {
        for (y, cell) in row.iter_mut().enumerate() {
            *cell = (JTT.freqs[x] * p[x][y] * 4000.0).round() as u32;
        }
    }
    match jtt_ml(&deep) {
        Cell::Value(d) => assert!((5.0..10.0).contains(&d), "deep pair d̂ = {d}"),
        Cell::Saturated => panic!("deep pair unexpectedly saturated"),
    }

    // Zero overlap at the matrix level: InsufficientOverlap, not a panic.
    let aln = parse_fasta(">a\nM--AA\n>b\nXX-XX\n").unwrap();
    assert_eq!(
        compute(&aln, DistModel::Jtt).unwrap_err(),
        NeoError::InsufficientOverlap {
            a: "a".to_string(),
            b: "b".to_string(),
        }
    );
}

#[test]
fn phangorn_second_opinion() {
    // Spec §6.2: measure max |NeoPhylo − phangorn `dist.ml` JTT| over
    // the corpus and record it in docs/decisions.md. Asserted finite,
    // not gated — a Saturated engine cell makes the residual infinite.
    // Printed grouped by NeoPhylo distance band for the Task 6 report.
    let bands = [0.5, 1.0, 2.0, f64::INFINITY];
    let band_names = ["d < 0.5", "0.5 <= d < 1", "1 <= d < 2", "d >= 2"];
    let mut max_abs = [0.0f64; 4];
    let mut max_rel = [0.0f64; 4];
    let mut worst = 0.0f64;
    let mut worst_pair = String::new();
    for fx in load_protein_fixtures() {
        let aln = protein_alignment(&fx);
        let got = compute(&aln, DistModel::Jtt).unwrap_or_else(|e| panic!("{}: {e:?}", fx.name));
        let n = got.n();
        for i in 0..n {
            for j in (i + 1)..n {
                match got.cells[i * n + j] {
                    Cell::Value(g) => {
                        let want = fx.second_opinion.jtt[i][j];
                        let abs = (g - want).abs();
                        let rel = abs / want.abs().max(1e-12);
                        let b = bands.iter().position(|&hi| g < hi).unwrap();
                        max_abs[b] = max_abs[b].max(abs);
                        max_rel[b] = max_rel[b].max(rel);
                        if abs > worst {
                            worst = abs;
                            worst_pair = format!(
                                "{} {}-{} (NeoPhylo {g}, phangorn {want})",
                                fx.name, fx.labels[i], fx.labels[j]
                            );
                        }
                    }
                    Cell::Saturated => worst = f64::INFINITY,
                }
            }
        }
    }
    eprintln!("phangorn JTT residuals by NeoPhylo distance band:");
    eprintln!("  {:>14}  {:>10}  {:>10}", "band", "max |abs|", "max rel");
    for (b, name) in band_names.iter().enumerate() {
        eprintln!("  {name:>14}  {:>10.6}  {:>10.6}", max_abs[b], max_rel[b]);
    }
    eprintln!("max |NeoPhylo - phangorn| JTT residual: {worst} at {worst_pair}");
    assert!(worst.is_finite(), "phangorn residual is not finite");
}
