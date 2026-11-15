//! Supplied-matrix oracle parity (v1.4c spec §5.5, plan Task 4).
//!
//! Every stem under `fixtures/ref/matrix/` and `fixtures/mega/matrix/`
//! is replayed: both input copies — `inputs/matrix/<stem>.phy` and
//! `<stem>.meg` — must parse to the same names and values, and NJ and
//! UPGMA trees built on that matrix must reproduce each oracle's
//! topology and branch lengths at its printed precision: PHYLIP
//! `neighbor` 3.697 within half a unit of the last printed decimal
//! (`precision` 5), ape within 1e-9, and MEGA-CC 12.1.4 within
//! `len_tol` of each value's own printed decimals.
//!
//! NJ trees are compared as unrooted splits, UPGMA trees as rooted
//! clades, branch lengths per split/clade. All n ≥ 5 NJ runs share
//! the benign four-active complement tie at the last join (owner
//! ruling, decisions.md "v1.4c Task 2"): either choice gives the same
//! split and lengths, so split-based comparison handles it; any other
//! mismatch is a STOP. `nonadditive6`'s negative NJ branch is asserted
//! present and within `neighbor`'s precision.
//!
//! Fixtures are the oracle: a failure here is a bug in the engine,
//! never in the fixture (AGENTS.md rule 1).

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use serde::Deserialize;

use neophylo_core::algos::{build_tree, BuildOptions, Method};
use neophylo_core::matrix_input::DistanceInput;
use neophylo_core::matrix_parse::{parse_meg_matrix, parse_phylip_matrix, PhylipMatrixOptions};
use neophylo_core::newick::write_newick;
use neophylo_core::phylip::NameMode;

#[derive(Deserialize)]
struct RefFixture {
    input: String,
    labels: Vec<String>,
    phylip: PhylipRef,
    ape: Trees,
}

#[derive(Deserialize)]
struct PhylipRef {
    precision: i32,
    nj: String,
    upgma: String,
}

#[derive(Deserialize)]
struct Trees {
    nj: String,
    upgma: String,
}

#[derive(Deserialize)]
struct MegaFixture {
    trees: Trees,
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn read_json<T: for<'de> Deserialize<'de>>(path: &PathBuf) -> T {
    let text = fs::read_to_string(path).unwrap_or_else(|e| panic!("{}: {e}", path.display()));
    serde_json::from_str(&text).unwrap_or_else(|e| panic!("{}: {e}", path.display()))
}

/// A minimal Newick scanner producing (leaf set below the edge,
/// branch length, printed decimals) per edge — as tests/parity_mega.rs.
type Edge = (Vec<String>, f64, usize);

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
/// notes). Copied verbatim from tests/parity_mega.rs.
fn len_tol(value: f64, decimals: usize) -> f64 {
    (0.5 * 10f64.powi(-(decimals as i32))).max(8.0 * f64::EPSILON * value.abs().max(1.0))
}

/// Compare our tree (built on `m`) with the oracle Newick: same
/// split/clade set, then each branch length within `tol(edge value,
/// printed decimals)`. Returns the worst |diff| seen.
fn check_tree(
    ctx: &str,
    oracle_nwk: &str,
    m: &DistanceInput,
    method: Method,
    tol: impl Fn(f64, usize) -> f64,
) -> f64 {
    let rooted = method == Method::Upgma;
    let exp = edge_map(oracle_nwk, rooted);
    let dm = m
        .to_distance_matrix()
        .unwrap_or_else(|e| panic!("{ctx}: {e:?}"));
    let got = build_tree(&dm, method, BuildOptions { trace: false })
        .unwrap_or_else(|e| panic!("{ctx}: {e:?}"));
    let act = edge_map(&write_newick(&got.tree), rooted);
    assert_eq!(
        exp.keys().collect::<Vec<_>>(),
        act.keys().collect::<Vec<_>>(),
        "{ctx}: topology differs from the oracle"
    );
    let mut worst = 0.0f64;
    for (clade, (v, d)) in &exp {
        let t = tol(*v, *d);
        let (g, _) = act[clade];
        let diff = (g - v).abs();
        assert!(
            diff <= t,
            "{ctx}: clade {clade:?} length {g} vs oracle {v} (tol {t})"
        );
        worst = worst.max(diff);
    }
    worst
}

/// Every stem must have both a ref (PHYLIP + ape) and a MEGA oracle
/// plus both input copies; each oracle tree is replayed at its own
/// printed precision.
#[test]
fn matrix_parity_every_stem() {
    let ref_dir = fixtures_dir().join("ref/matrix");
    let mega_dir = fixtures_dir().join("mega/matrix");
    let mut stems: Vec<String> = fs::read_dir(&ref_dir)
        .expect("ref/matrix")
        .map(|e| {
            e.expect("dir entry")
                .file_name()
                .to_string_lossy()
                .trim_end_matches(".json")
                .to_string()
        })
        .collect();
    stems.sort();
    assert!(!stems.is_empty(), "no matrix ref fixtures");

    let opts = PhylipMatrixOptions {
        names: NameMode::Auto,
        use_lower_if_asymmetric: false,
    };
    let mut worst: BTreeMap<&'static str, f64> = BTreeMap::new();

    for stem in &stems {
        let rf: RefFixture = read_json(&ref_dir.join(format!("{stem}.json")));
        let mf: MegaFixture = read_json(&mega_dir.join(format!("{stem}.json")));

        let phy_text = fs::read_to_string(fixtures_dir().join(&rf.input))
            .unwrap_or_else(|e| panic!("{stem} input {}: {e}", rf.input));
        let meg_text = fs::read_to_string(fixtures_dir().join(format!("inputs/matrix/{stem}.meg")))
            .unwrap_or_else(|e| panic!("{stem} .meg: {e}"));

        let phy =
            parse_phylip_matrix(&phy_text, opts).unwrap_or_else(|e| panic!("{stem} .phy: {e:?}"));
        let meg = parse_meg_matrix(&meg_text).unwrap_or_else(|e| panic!("{stem} .meg: {e:?}"));
        // Both input copies carry the same names and values (the
        // inputs are integer/6-dp, so equality is exact).
        assert_eq!(phy.matrix, meg.matrix, "{stem}: .phy vs .meg differ");
        assert_eq!(phy.matrix.names, rf.labels, "{stem}: labels differ");
        let m = &phy.matrix;

        let phy_tol = 0.5 * 10f64.powi(-rf.phylip.precision);
        let const_tol = |t: f64| move |_: f64, _: usize| -> f64 { t };
        let tag = |m: Method| {
            if m == Method::Nj {
                "nj"
            } else {
                "upgma"
            }
        };
        for (key, nwk, method, tol) in [
            (
                "phylip",
                rf.phylip.nj.as_str(),
                Method::Nj,
                const_tol(phy_tol),
            ),
            (
                "phylip",
                rf.phylip.upgma.as_str(),
                Method::Upgma,
                const_tol(phy_tol),
            ),
            ("ape", rf.ape.nj.as_str(), Method::Nj, const_tol(1e-9)),
            ("ape", rf.ape.upgma.as_str(), Method::Upgma, const_tol(1e-9)),
        ] {
            let ctx = format!("{stem}/{key}-{}", tag(method));
            let w = check_tree(&ctx, nwk, m, method, tol);
            let e = worst.entry(key).or_insert(0.0);
            *e = e.max(w);
        }
        for (key, nwk, method) in [
            ("mega-nj", mf.trees.nj.as_str(), Method::Nj),
            ("mega-upgma", mf.trees.upgma.as_str(), Method::Upgma),
        ] {
            let w = check_tree(&format!("{stem}/{key}"), nwk, m, method, len_tol);
            let e = worst.entry("mega").or_insert(0.0);
            *e = e.max(w);
        }
    }
    eprintln!("matrix parity worst |diff| per oracle: {worst:?}");
}

/// `nonadditive6`'s NJ tree keeps the negative internal branch the
/// source programs produced (plan: "the negative branch is present
/// and equal to neighbor's within precision").
#[test]
fn nonadditive6_negative_branch_is_present() {
    let stem = "nonadditive6";
    let rf: RefFixture = read_json(&fixtures_dir().join(format!("ref/matrix/{stem}.json")));
    let phy_text = fs::read_to_string(fixtures_dir().join(&rf.input)).expect("input");
    let m = parse_phylip_matrix(
        &phy_text,
        PhylipMatrixOptions {
            names: NameMode::Auto,
            use_lower_if_asymmetric: false,
        },
    )
    .expect("parse")
    .matrix;
    let phy_tol = 0.5 * 10f64.powi(-rf.phylip.precision);
    let exp = edge_map(&rf.phylip.nj, false);
    assert!(
        exp.values().any(|(v, _)| *v < 0.0),
        "oracle NJ has no negative branch: {}",
        rf.phylip.nj
    );
    let dm = m.to_distance_matrix().expect("dm");
    let got = build_tree(&dm, Method::Nj, BuildOptions { trace: false }).expect("nj");
    let act = edge_map(&write_newick(&got.tree), false);
    let neg: Vec<f64> = act.values().map(|(v, _)| *v).filter(|v| *v < 0.0).collect();
    assert!(!neg.is_empty(), "engine NJ lost the negative branch");
    for (clade, (v, _)) in &exp {
        if *v < 0.0 {
            let (g, _) = act[clade];
            assert!(
                (g - v).abs() <= phy_tol,
                "negative branch {clade:?}: {g} vs neighbor {v} (tol {phy_tol})"
            );
        }
    }
}
