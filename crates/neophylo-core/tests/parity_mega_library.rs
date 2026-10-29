//! Parity against the frozen MEGA-CC oracle on the **library datasets**
//! and the exported `.meg` round trip (v1.4b plan Task 9 Step 3).
//!
//! `fixtures/mega/library/*.json` is the same fixture shape as
//! `fixtures/mega/*.json`, run on the datasets the MEGA handouts use
//! (`web/public/library/*.fasta`, referenced as
//! `../web/public/library/<id>.fasta`). Distance and tree assertions
//! are exactly `parity_mega.rs`'s: `compute_filtered` within half an
//! ulp of `precision.distances` (8); topology and labels on MEGA's
//! printed matrix; topology plus per-value branch lengths on ours —
//! except that UPGMA is tie-aware where a real tie exists (below).
//! The same JTT handling applies: MEGA's JTT is a different estimator
//! NeoPhylo does not ship (owner decision on #117 — docs/decisions.md),
//! so JTT distances and JTT branch lengths are never compared; the
//! printed-matrix topology check still runs because the tree algorithm
//! is ours either way.
//!
//! `fixtures/mega/roundtrip/<name>.meg` is `fixtures/inputs/<name>.fasta`
//! written by `write_meg` (title = the file stem, what
//! `fixtures/generate_mega.sh`'s `export_meg` passes) and
//! `roundtrip/<name>.json` is MEGA's distance output on that `.meg`.
//! `parse_meg` must recover the FASTA's labels and sequences, and
//! `compute_filtered` on the parsed `.meg` must match MEGA's matrix at
//! the same printed precision.
//!
//! Name rule (fixtures/worked/mega-notes.md, "Underscored names in
//! MEGA's outputs"): MEGA prints names literally and the library
//! labels contain no whitespace, so labels compare as-is — no
//! normalization helper.
//!
//! Bootstrap support: MEGA's `library/boot1000/*.json` block (1,000
//! replicates, read from its original NJ tree's BCL labels — owner
//! ruling on #126, option A) is compared under the same rule as the
//! existing R `ape::boot.phylo` statistical parity check (v1.2 spec
//! §8.3; implemented in `web/scripts/r-parity.mjs`'s
//! `compareBootstrap`, wired by `scripts/ci/r-parity.sh`): every split
//! within **5 percentage points**, our side at **1,000 replicates**
//! from one fixed seed — the RNGs differ (megacc has no seed option;
//! see `fixtures/mega/README.md` "Not byte-reproducible"), so this is
//! a sampling-noise bound, never an equality. Our support comes from
//! `support_on_tree` on our own NJ tree via the engine tally — the
//! computed tree, never a consensus or rendered view — after first
//! asserting our NJ tree's splits equal MEGA's. The 100-replicate
//! `bootstrap` blocks in `library/*.json` are the handout values:
//! their split sets are asserted equal to ours, their support numbers
//! are never compared.
//!
//! Two rulings from #126 shape the comparisons below:
//!
//! - **Identical-sequence splits are excluded** from the support
//!   comparison, computed from the data, never a hard-coded name list:
//!   a split is excluded iff one of its sides is a set of ≥ 2 taxa
//!   whose sequences are all pairwise identical over the sites the
//!   run's filter keeps (every join order among duplicates is a tie,
//!   so replicate support there is arbitrary).
//!   `identical_sequence_exclusions_are_exactly` pins the excluded
//!   set: `globins` `Chimp_HBB|Human_HBB` under both filters and
//!   nothing else.
//! - **UPGMA is tie-aware** where a genuine tie exists (`globins` HBA
//!   pairs tie at 17/142 under pairwise, at 16/138 under
//!   complete/partial95 — `fixtures/worked/mega-notes.md` "Ties in
//!   globins"): first the same exact comparison runs; only if it fails
//!   is MEGA's tree replayed on the engine's full-precision matrix,
//!   checking every merge was a minimum-distance pair (exact `==` on
//!   the engine's f64 cells — the ties are exact rationals, so no
//!   epsilon) and every cluster height is half that distance within
//!   `len_tol`, and requiring the replay saw at least one step with
//!   more than one minimal pair (a mismatch without a tie stays a
//!   failure). `upgma_tie_resolutions_are_exactly` pins the keys
//!   needing the replay: exactly the six
//!   `globins upgma/{p,Poisson}/{pairwise,complete,partial95}`. NJ
//!   stays exact everywhere.
//!
//! Fixtures are the oracle: a failure here is a bug in the engine,
//! never in the fixture (AGENTS.md rule 1).

use std::collections::BTreeMap;
use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use serde::de::DeserializeOwned;
use serde::Deserialize;

use neophylo_core::algos::{build_tree, BuildOptions, Method};
use neophylo_core::alphabet::protein_index;
use neophylo_core::bootstrap::{bootstrap_batch_filtered, support_on_tree, tree_splits};
use neophylo_core::dist::{compute_filtered, Cell, DistModel, DistanceMatrix};
use neophylo_core::error::NeoError;
use neophylo_core::matrix::Matrix;
use neophylo_core::meg::{parse_meg, write_meg};
use neophylo_core::seq::{parse_fasta, Alignment};
use neophylo_core::site_filter::{site_mask, SiteFilter};
use neophylo_core::Alphabet;

#[derive(Deserialize)]
struct Precision {
    distances: u32,
    #[allow(dead_code)]
    branch_lengths: Option<u32>,
}

#[derive(Deserialize)]
struct MegaFixture {
    input: String,
    alphabet: String,
    precision: Precision,
    distances: BTreeMap<String, DistRun>,
    #[serde(default)]
    trees: BTreeMap<String, String>,
    #[serde(default)]
    bootstrap: BTreeMap<String, BootRun>,
}

#[derive(Deserialize)]
struct DistRun {
    labels: Vec<String>,
    matrix: Vec<Vec<Option<f64>>>,
}

#[derive(Deserialize)]
struct BootRun {
    replicates: u32,
    support: BTreeMap<String, f64>,
}

/// The `library/boot1000/*.json` shape (README: only `generator`,
/// `input`, `alphabet` and `bootstrap` — no distances or trees).
#[derive(Deserialize)]
struct BootFixture {
    input: String,
    alphabet: String,
    #[serde(default)]
    bootstrap: BTreeMap<String, BootRun>,
}

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures")
}

fn load_fixtures<T: DeserializeOwned>(dir: &str) -> Vec<(String, T)> {
    let dir = fixtures_dir().join(dir);
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
/// skipped for distances and routed to the printed-matrix topology
/// check for trees, never to an equality comparison.
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

/// `DistanceMatrix` over MEGA's printed values (panics on `n/c`
/// cells — tree fixtures only exist for complete matrices).
fn printed_dm(ctx: &str, run: &DistRun) -> DistanceMatrix {
    let n = run.labels.len();
    let mut data = Vec::with_capacity(n * n);
    for row in &run.matrix {
        for cell in row {
            data.push(cell.unwrap_or_else(|| panic!("{ctx}: tree over a matrix with n/c cells")));
        }
    }
    DistanceMatrix::from_values(run.labels.clone(), &Matrix { n, data })
}

/// Topology + labels of `method` built on MEGA's printed matrix
/// against the fixture's newick; `Err` carries the failure message so
/// the UPGMA arm can fall back to the tie-aware replay.
fn check_printed_topology(
    ctx: &str,
    nwk: &str,
    mega_dm: &DistanceMatrix,
    method: Method,
) -> Result<BTreeMap<Vec<String>, (f64, usize)>, String> {
    let rooted = method == Method::Upgma;
    let exp = edge_map(nwk, rooted);
    let got = build_tree(mega_dm, method, BuildOptions { trace: false })
        .map_err(|e| format!("{ctx} printed-matrix: {e:?}"))?;
    let act = edge_map(&neophylo_core::newick::write_newick(&got.tree), rooted);
    if exp.keys().collect::<Vec<_>>() != act.keys().collect::<Vec<_>>() {
        return Err(format!("{ctx}: printed-matrix topology differs"));
    }
    Ok(exp)
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
    check_tree_e(ctx, nwk, dm, method).unwrap_or_else(|e| panic!("{e}"))
}

/// `check_tree` as a `Result` so the UPGMA arm can distinguish an
/// exact-match failure (possible tie) from success.
fn check_tree_e(
    ctx: &str,
    nwk: &str,
    dm: &DistanceMatrix,
    method: Method,
) -> Result<BTreeMap<Vec<String>, (f64, usize)>, String> {
    let rooted = method == Method::Upgma;
    let exp = edge_map(nwk, rooted);
    let got = build_tree(dm, method, BuildOptions { trace: false })
        .map_err(|e| format!("{ctx}: {e:?}"))?;
    let got_nwk = neophylo_core::newick::write_newick(&got.tree);
    let act = edge_map(&got_nwk, rooted);
    if exp.keys().collect::<Vec<_>>() != act.keys().collect::<Vec<_>>() {
        return Err(format!("{ctx}: topology differs from MEGA"));
    }
    for (clade, (v, d)) in &exp {
        let tol = len_tol(*v, *d);
        let (g, _) = act[clade];
        if (g - v).abs() > tol {
            return Err(format!(
                "{ctx}: clade {clade:?} length {g} vs MEGA {v} (tol {tol})"
            ));
        }
    }
    Ok(act)
}

#[test]
fn library_distances_match_at_printed_precision() {
    for (stem, fx) in load_fixtures::<MegaFixture>("mega/library") {
        let aln = load_alignment(&fx.input);
        for (key, run) in &fx.distances {
            let (mname, fname) = key.split_once('/').expect("model/filter key");
            // MEGA's JTT is a different estimator (docs/decisions.md,
            // #117): never an equality comparison.
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

/// How an `upgma/<model>/<filter>` key compared (owner ruling on #126,
/// item 3): the exact comparison passes, or MEGA's tree replays as a
/// valid UPGMA resolution of the engine's matrix through a real tie.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum UpgmaMatch {
    Exact,
    TieAware,
}

/// One merge in the fixture's rooted UPGMA newick: the clade it forms,
/// its two child clades with their printed edges (length, decimals),
/// and the node's height above the leaves as MEGA printed it (the mean
/// of the two child derivations — the per-child checks at replay time
/// verify each one).
struct MegaMerge {
    clade: Vec<String>,
    children: [(Vec<String>, f64, usize); 2],
    height: f64,
}

/// Decompose a rooted UPGMA newick into its merge sequence, ordered by
/// increasing height (children first — UPGMA heights are
/// non-decreasing, and equal-height parents are strictly larger).
fn mega_merges(ctx: &str, nwk: &str, all_labels: &[String]) -> Vec<MegaMerge> {
    let edges = edge_map(nwk, true);
    let mut root = all_labels.to_vec();
    root.sort();
    let mut internals: Vec<Vec<String>> = edges.keys().filter(|c| c.len() >= 2).cloned().collect();
    internals.push(root);
    internals.sort();
    internals.dedup();
    internals.sort_by_key(|c| c.len());
    let subset = |a: &[String], b: &[String]| a.iter().all(|x| b.contains(x));
    let mut height_of: BTreeMap<Vec<String>, f64> = BTreeMap::new();
    let mut merges = Vec::new();
    for s in &internals {
        // Children = the maximal proper sub-clades among the edge
        // clades (a child may be a single leaf).
        let children: Vec<Vec<String>> = edges
            .keys()
            .filter(|c| {
                c.len() < s.len()
                    && subset(c, s)
                    && !edges.keys().any(|o| {
                        o.len() < s.len() && c.len() < o.len() && subset(c, o) && subset(o, s)
                    })
            })
            .cloned()
            .collect();
        assert_eq!(
            children.len(),
            2,
            "{ctx}: clade {s:?} has {} children (want a binary rooted tree)",
            children.len()
        );
        let mut deriv = Vec::with_capacity(2);
        let mut ch = Vec::with_capacity(2);
        for c in &children {
            let (len, dec) = edges[c];
            deriv.push(height_of.get(c).copied().unwrap_or(0.0) + len);
            ch.push((c.clone(), len, dec));
        }
        // The node's printed height, the mean of the two child
        // derivations; the replay re-derives each side for the
        // per-child height check.
        let height = (deriv[0] + deriv[1]) / 2.0;
        height_of.insert(s.clone(), height);
        merges.push(MegaMerge {
            clade: s.clone(),
            children: [ch.remove(0), ch.remove(0)],
            height,
        });
    }
    merges.sort_by(|a, b| {
        a.height
            .partial_cmp(&b.height)
            .unwrap()
            .then(a.clade.len().cmp(&b.clade.len()))
    });
    merges
}

/// Replay MEGA's printed UPGMA tree on the engine's full-precision
/// matrix (owner ruling on #126, item 3): at every merge step MEGA's
/// chosen pair must be *a* minimum-distance pair — exact `==` on the
/// engine's f64 values, the ties are exact rationals such as 17/142
/// and 16/138 so no epsilon — and each new cluster's height must equal
/// half that distance within `len_tol`. `Err` reports the first broken
/// step; `Ok(false)` a clean replay that saw no tied step (the exact
/// mismatch was then not a tie and stays a failure).
fn replay_mega_upgma(ctx: &str, nwk: &str, ours: &DistanceMatrix) -> Result<bool, String> {
    let merges = mega_merges(ctx, nwk, &ours.labels);
    let n = ours.n();
    let mut d = ours.to_matrix().map_err(|e| format!("{ctx}: {e:?}"))?.data;
    let mut members: Vec<Vec<String>> = ours.labels.iter().map(|l| vec![l.clone()]).collect();
    let mut sizes = vec![1u64; n];
    let mut heights: BTreeMap<Vec<String>, f64> = BTreeMap::new();
    let mut saw_tie = false;
    for m in &merges {
        let k = members.len();
        let find = |c: &[String]| {
            members
                .iter()
                .position(|x| x == c)
                .unwrap_or_else(|| panic!("{ctx}: {c:?} is not an active cluster"))
        };
        let (ci, cj) = (find(&m.children[0].0), find(&m.children[1].0));
        assert_ne!(ci, cj, "{ctx}: child clades coincide");
        let mut best = f64::INFINITY;
        let mut minimal = 0usize;
        for i in 0..k {
            for j in (i + 1)..k {
                let v = d[i * k + j];
                if v < best {
                    best = v;
                    minimal = 1;
                } else if v == best {
                    minimal += 1;
                }
            }
        }
        let dij = d[ci * k + cj];
        if dij != best {
            return Err(format!(
                "{ctx}: MEGA merges {:?} + {:?} at distance {dij} but the \
                 step minimum is {best} — not a tie resolution",
                m.children[0].0, m.children[1].0
            ));
        }
        saw_tie |= minimal > 1;
        let h = best / 2.0;
        for (child, len, dec) in &m.children {
            let h_via = heights.get(child).copied().unwrap_or(0.0) + len;
            let tol = len_tol(h_via, *dec);
            if (h_via - h).abs() > tol {
                return Err(format!(
                    "{ctx}: cluster {:?} height {h_via} vs half the merge \
                     distance {h} (tol {tol})",
                    m.clade
                ));
            }
        }
        heights.insert(m.clade.clone(), m.height);
        // Agglomerate exactly like `algos/upgma.rs` (size-weighted
        // means, remaining clusters keep their order, new one last).
        let remaining: Vec<usize> = (0..k).filter(|&x| x != ci && x != cj).collect();
        let (si, sj) = (sizes[ci] as f64, sizes[cj] as f64);
        let new_row: Vec<f64> = remaining
            .iter()
            .map(|&x| (si * d[ci * k + x] + sj * d[cj * k + x]) / (si + sj))
            .collect();
        let nk = k - 1;
        let mut nd = vec![0.0; nk * nk];
        for (x, &a) in remaining.iter().enumerate() {
            for (y, &b) in remaining.iter().enumerate() {
                nd[x * nk + y] = d[a * k + b];
            }
            nd[x * nk + nk - 1] = new_row[x];
            nd[(nk - 1) * nk + x] = new_row[x];
        }
        d = nd;
        let mut union = members[ci].clone();
        union.extend(members[cj].iter().cloned());
        union.sort();
        if union != m.clade {
            return Err(format!(
                "{ctx}: MEGA clade {:?} is not the union of its children",
                m.clade
            ));
        }
        let mut nm: Vec<Vec<String>> = remaining.iter().map(|&x| members[x].clone()).collect();
        nm.push(union);
        members = nm;
        let mut ns: Vec<u64> = remaining.iter().map(|&x| sizes[x]).collect();
        ns.push(sizes[ci] + sizes[cj]);
        sizes = ns;
    }
    if members.len() != 1 {
        return Err(format!(
            "{ctx}: replay left {} clusters after all merges",
            members.len()
        ));
    }
    Ok(saw_tie)
}

/// The UPGMA comparison for one `upgma/<model>/<filter>` key: exact
/// first (printed-matrix topology, then topology and branch lengths on
/// the engine's full-precision matrix); only on failure, MEGA's tree
/// is replayed — and the replay must have seen a real tie, so an exact
/// mismatch without one stays a failure.
fn upgma_match_kind(
    ctx: &str,
    nwk: &str,
    mega_dm: &DistanceMatrix,
    ours: &DistanceMatrix,
) -> Result<UpgmaMatch, String> {
    let exact = check_printed_topology(ctx, nwk, mega_dm, Method::Upgma)
        .and_then(|_| check_tree_e(ctx, nwk, ours, Method::Upgma))
        .map(|_| ());
    match exact {
        Ok(()) => Ok(UpgmaMatch::Exact),
        Err(first) => match replay_mega_upgma(ctx, nwk, ours) {
            Ok(true) => Ok(UpgmaMatch::TieAware),
            Ok(false) => Err(format!(
                "{ctx}: exact comparison failed ({first}) and the replay \
                 saw no tied step — not a tie resolution"
            )),
            Err(second) => Err(format!(
                "{ctx}: exact comparison failed ({first}); tie-aware \
                 replay failed: {second}"
            )),
        },
    }
}

#[test]
fn library_trees_match_topology_and_lengths() {
    for (stem, fx) in load_fixtures::<MegaFixture>("mega/library") {
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
            let ctx = format!("{stem} {key}");
            // Topology and labels on MEGA's printed matrix (branch
            // lengths are not compared on it: the fixture trees were
            // computed at full precision, so the 8-decimal rounding
            // propagates ~1e-9 — same rule as parity_mega.rs).
            let mega_dm = printed_dm(&ctx, run);
            if mname == "JTT" {
                // JTT: no branch-length or engine-matrix check —
                // MEGA's JTT matrix comes from an estimator we do not
                // ship (#117), so there is nothing to replay on. The
                // printed-matrix topology assertion still runs, exact.
                check_printed_topology(&ctx, nwk, &mega_dm, method)
                    .unwrap_or_else(|e| panic!("{e}"));
                continue;
            }
            let ours = compute_filtered(&aln, model_of(mname), filter_of(fname))
                .unwrap_or_else(|e| panic!("{ctx} ours: {e:?}"));
            match method {
                Method::Nj => {
                    // NJ stays exact everywhere: printed-matrix
                    // topology, then full parity on the engine's own
                    // matrix (topology + every branch length).
                    check_printed_topology(&ctx, nwk, &mega_dm, Method::Nj)
                        .unwrap_or_else(|e| panic!("{e}"));
                    check_tree(&ctx, nwk, &ours, Method::Nj);
                }
                Method::Upgma => {
                    // Exact first; on failure, the tie-aware replay on
                    // the engine's matrix (owner ruling on #126).
                    upgma_match_kind(&ctx, nwk, &mega_dm, &ours).unwrap_or_else(|e| panic!("{e}"));
                }
            }
        }
    }
}

/// The tie-aware UPGMA path (owner ruling on #126, item 3) must engage
/// for exactly the six `globins upgma/{p,Poisson}/{pairwise,complete,
/// partial95}` keys — the HBA ties under every gap treatment — and no
/// other key.
#[test]
fn upgma_tie_resolutions_are_exactly() {
    let mut tie_aware: BTreeSet<(String, String)> = BTreeSet::new();
    for (stem, fx) in load_fixtures::<MegaFixture>("mega/library") {
        let aln = load_alignment(&fx.input);
        for (key, nwk) in &fx.trees {
            let mut it = key.split('/');
            if it.next() != Some("upgma") {
                continue;
            }
            let (mname, fname) = (it.next().unwrap(), it.next().unwrap());
            if mname == "JTT" {
                continue; // no engine matrix to replay on (#117)
            }
            let ctx = format!("{stem} {key}");
            let run = &fx.distances[&format!("{mname}/{fname}")];
            let mega_dm = printed_dm(&ctx, run);
            let ours = compute_filtered(&aln, model_of(mname), filter_of(fname))
                .unwrap_or_else(|e| panic!("{ctx} ours: {e:?}"));
            match upgma_match_kind(&ctx, nwk, &mega_dm, &ours) {
                Ok(UpgmaMatch::TieAware) => {
                    tie_aware.insert((stem.clone(), key.clone()));
                }
                Ok(UpgmaMatch::Exact) => {}
                Err(e) => panic!("{e}"),
            }
        }
    }
    let expected: BTreeSet<(String, String)> = ["pairwise", "complete", "partial95"]
        .iter()
        .flat_map(|f| {
            ["p", "Poisson"].map(move |m| ("globins".to_string(), format!("upgma/{m}/{f}")))
        })
        .collect();
    assert_eq!(tie_aware, expected, "tie-aware UPGMA keys differ");
}

/// The `.meg` `write_meg` produced for `fixtures/inputs/<name>.fasta`
/// must reproduce the committed `roundtrip/<name>.meg` byte for byte
/// (the generator passes the file stem as the title —
/// `fixtures/generate_mega.sh` `export_meg`), and `parse_meg` must
/// recover the FASTA's labels and sequences exactly.
#[test]
fn meg_roundtrip_exports_and_parses() {
    for (stem, fx) in load_fixtures::<MegaFixture>("mega/roundtrip") {
        let fasta_rel = format!("inputs/{stem}.fasta");
        let aln = load_alignment(&fasta_rel);
        let meg_path = fixtures_dir().join(&fx.input);
        let committed = fs::read_to_string(&meg_path)
            .unwrap_or_else(|e| panic!("{stem}: cannot read {}: {e}", meg_path.display()));
        assert_eq!(
            fx.input,
            format!("mega/roundtrip/{stem}.meg"),
            "{stem}: roundtrip fixture input must name the committed .meg"
        );
        let written = write_meg(&aln, &stem).unwrap_or_else(|e| panic!("{stem}: write_meg: {e:?}"));
        assert_eq!(written, committed, "{stem}: write_meg output drifted");
        let parsed = parse_meg(&committed)
            .unwrap_or_else(|e| panic!("{stem}: parse_meg: {e:?}"))
            .alignment;
        assert_eq!(parsed.labels, aln.labels, "{stem}: .meg labels");
        assert_eq!(parsed.seqs, aln.seqs, "{stem}: .meg sequences");
        assert_eq!(parsed.alphabet, aln.alphabet, "{stem}: .meg alphabet");
    }
}

/// MEGA's distances computed on the exported `.meg`
/// (`roundtrip/<name>.json`) must equal `compute_filtered` on our own
/// parse of that `.meg`, at the same half-ulp-of-printed-precision
/// tolerance as the FASTA fixtures (success criterion 4).
#[test]
fn meg_roundtrip_distances_match_at_printed_precision() {
    for (stem, fx) in load_fixtures::<MegaFixture>("mega/roundtrip") {
        let meg_text = fs::read_to_string(fixtures_dir().join(&fx.input))
            .unwrap_or_else(|e| panic!("{stem}: cannot read .meg: {e}"));
        let aln = parse_meg(&meg_text)
            .unwrap_or_else(|e| panic!("{stem}: parse_meg: {e:?}"))
            .alignment;
        for (key, run) in &fx.distances {
            let (mname, fname) = key.split_once('/').expect("model/filter key");
            if mname == "JTT" {
                continue; // never an equality target (#117)
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

// ---- bootstrap support parity ---------------------------------------

/// The existing R `ape::boot.phylo` statistical-parity rule (v1.2 spec
/// §8.3, `web/scripts/r-parity.mjs` `compareBootstrap` /
/// `scripts/ci/r-parity.sh`): every split's support within 5
/// percentage points, our side at 1,000 replicates from one fixed
/// seed. The MEGA side is `library/boot1000/*.json` — 1,000 unseeded
/// megacc replicates (owner ruling on #126, option A), so both sides
/// are samples and a failure means a real divergence; the bound is
/// never loosened to hide one. The seed and replicate count are fixed
/// — never scan for a seed that passes.
const BOOT_SEED: u64 = 1;
const BOOT_REPS: u32 = 1_000;
const SUPPORT_TOL_PP: f64 = 5.0;

/// Mirror of `dist::is_base` (pub(crate)) and `alphabet::protein_index`:
/// the engine's "present character" rule that `site_mask` applies
/// (fixtures/worked/mega-notes.md "Missing characters").
fn is_present(aln: &Alignment, b: u8) -> bool {
    match aln.alphabet {
        Alphabet::Dna => matches!(b, b'A' | b'C' | b'G' | b'T'),
        Alphabet::Protein => protein_index(b).is_some(),
    }
}

/// The taxon pairs that are pairwise identical over the sites `filter`
/// keeps: at least one kept site where both sequences carry a standard
/// state, and every such site equal. Under `Pairwise` the kept sites
/// are all columns and comparability is per pair — exactly the engine's
/// own rule.
fn identical_pairs(aln: &Alignment, filter: SiteFilter) -> BTreeSet<(usize, usize)> {
    let mask = site_mask(aln, filter).unwrap_or_else(|e| panic!("site_mask: {e:?}"));
    let n = aln.seqs.len();
    let mut out = BTreeSet::new();
    for i in 0..n {
        for j in (i + 1)..n {
            let mut comparable = false;
            let mut identical = true;
            for (k, &w) in mask.weights.iter().enumerate() {
                if w == 0 {
                    continue;
                }
                let (Some(&a), Some(&b)) = (aln.seqs[i].get(k), aln.seqs[j].get(k)) else {
                    continue;
                };
                if !is_present(aln, a) || !is_present(aln, b) {
                    continue;
                }
                comparable = true;
                if a != b {
                    identical = false;
                    break;
                }
            }
            if comparable && identical {
                out.insert((i, j));
            }
        }
    }
    out
}

/// A support split is excluded iff one of its sides is a set of ≥ 2
/// taxa that are all pairwise identical over the kept comparable sites
/// (every join order among duplicates is a tie, so replicate support
/// there is arbitrary — owner ruling on #126, item 2). `key` is the
/// canonical side joined by `|`; the other side is its complement over
/// `all_labels`.
fn split_is_excluded(
    key: &str,
    all_labels: &[String],
    identical: &BTreeSet<(usize, usize)>,
) -> bool {
    let side: Vec<usize> = key
        .split('|')
        .map(|l| {
            all_labels
                .iter()
                .position(|x| x == l)
                .unwrap_or_else(|| panic!("split label {l:?} not in the alignment"))
        })
        .collect();
    let complement: Vec<usize> = (0..all_labels.len())
        .filter(|i| !side.contains(i))
        .collect();
    let all_identical = |s: &[usize]| {
        s.len() >= 2
            && (0..s.len()).all(|a| {
                ((a + 1)..s.len()).all(|b| identical.contains(&(s[a].min(s[b]), s[a].max(s[b]))))
            })
    };
    all_identical(&side) || all_identical(&complement)
}

/// The excluded split keys of one compared bootstrap run: our NJ
/// splits (asserted equal to MEGA's before this is called) filtered by
/// `split_is_excluded` under the run's filter.
fn excluded_splits(
    aln: &Alignment,
    labels: &[String],
    keys: &BTreeSet<String>,
    filter: SiteFilter,
) -> BTreeSet<String> {
    let identical = identical_pairs(aln, filter);
    keys.iter()
        .filter(|k| split_is_excluded(k, labels, &identical))
        .cloned()
        .collect()
}

#[test]
fn bootstrap_support_within_sampling_noise() {
    let library: BTreeMap<String, MegaFixture> = load_fixtures::<MegaFixture>("mega/library")
        .into_iter()
        .collect();
    for (stem, fx) in load_fixtures::<BootFixture>("mega/library/boot1000") {
        let aln = load_alignment(&fx.input);
        let lib = library
            .get(&stem)
            .unwrap_or_else(|| panic!("{stem}: boot1000 fixture without a library fixture"));
        for (key, run) in &fx.bootstrap {
            let mut it = key.split('/');
            assert_eq!(it.next(), Some("nj"), "{stem} {key}: not an NJ key");
            let (mname, fname) = (it.next().unwrap(), it.next().unwrap());
            if mname == "JTT" {
                // MEGA's JTT estimator is not shipped (#117), so
                // `nj/JTT/*` support is not a parity target. The
                // key-coverage test below still counts it as handled.
                continue;
            }
            let ctx = format!("{stem} {key}");
            let (model, filter) = (model_of(mname), filter_of(fname));
            assert_eq!(
                run.replicates, BOOT_REPS,
                "{ctx}: MEGA side is not {BOOT_REPS} replicates"
            );

            // Our NJ tree on the same model + filter must carry the
            // same splits MEGA labelled — support cannot be compared
            // on different topologies. The same must hold for the
            // 100-replicate handout block in `library/*.json` (its
            // support numbers are never compared — the ruling compares
            // at 1,000 replicates only).
            let dm =
                compute_filtered(&aln, model, filter).unwrap_or_else(|e| panic!("{ctx}: {e:?}"));
            let built = build_tree(&dm, Method::Nj, BuildOptions { trace: false })
                .unwrap_or_else(|e| panic!("{ctx}: {e:?}"));
            let splits = tree_splits(&built.tree, &dm.labels, false);
            let our_keys: BTreeSet<String> = splits
                .iter()
                .map(|(_, s)| s.labels(&dm.labels).join("|"))
                .collect();
            let mega_keys: BTreeSet<String> = run.support.keys().cloned().collect();
            assert_eq!(
                our_keys, mega_keys,
                "{ctx}: NJ splits differ from MEGA's labelled splits"
            );
            let run100 = lib
                .bootstrap
                .get(key)
                .unwrap_or_else(|| panic!("{ctx}: no 100-replicate block in library/{stem}.json"));
            assert_eq!(
                run100.replicates, 100,
                "{ctx}: handout block is not 100 replicates"
            );
            let keys100: BTreeSet<String> = run100.support.keys().cloned().collect();
            assert_eq!(
                our_keys, keys100,
                "{ctx}: NJ splits differ from the 100-replicate handout block"
            );

            // Splits whose one side is all-identical sequences are
            // excluded (owner ruling on #126, item 2); the set is
            // computed from the data and pinned by
            // `identical_sequence_exclusions_are_exactly`.
            let excluded = excluded_splits(&aln, &dm.labels, &our_keys, filter);

            // Support on our own NJ tree via the engine tally — the
            // same `bootstrap_batch` + `support_on_tree` path the §8.3
            // R check uses — never a consensus or rendered view.
            let tally =
                bootstrap_batch_filtered(&aln, model, Method::Nj, filter, BOOT_SEED, 0, BOOT_REPS)
                    .unwrap_or_else(|e| panic!("{ctx}: {e:?}"));
            let with_support = support_on_tree(&built.tree, &tally);
            for (id, split) in &splits {
                let key = split.labels(&dm.labels).join("|");
                let Some(frac) = with_support.branches[id.0 as usize].support else {
                    // The duplicated unrooted root edge keeps `None`;
                    // its canonical-side twin carries the support.
                    continue;
                };
                if excluded.contains(&key) {
                    continue;
                }
                let mega_pct = run.support[&key];
                let diff = (frac * 100.0 - mega_pct).abs();
                assert!(
                    diff <= SUPPORT_TOL_PP,
                    "{ctx}: split {key:?} support {ours:.1}% vs MEGA \
                     {mega_pct}% (|diff| {diff:.1} pp > {SUPPORT_TOL_PP})",
                    ours = frac * 100.0
                );
            }
        }
    }
}

/// The excluded-split computation is pinned, never widened silently
/// (owner ruling on #126, item 2): across every compared run the only
/// exclusion is `globins`' `Chimp_HBB|Human_HBB`, under both filters.
/// A new exclusion here means the computation found another
/// all-identical side — that is a STOP, not a reason to edit this set.
#[test]
fn identical_sequence_exclusions_are_exactly() {
    let mut found: BTreeMap<(String, String), BTreeSet<String>> = BTreeMap::new();
    for (stem, fx) in load_fixtures::<BootFixture>("mega/library/boot1000") {
        let aln = load_alignment(&fx.input);
        for key in fx.bootstrap.keys() {
            let mut it = key.split('/');
            assert_eq!(it.next(), Some("nj"), "{stem} {key}: not an NJ key");
            let (mname, fname) = (it.next().unwrap(), it.next().unwrap());
            if mname == "JTT" {
                continue; // never a parity comparison (#117)
            }
            let ctx = format!("{stem} {key}");
            let (model, filter) = (model_of(mname), filter_of(fname));
            let dm =
                compute_filtered(&aln, model, filter).unwrap_or_else(|e| panic!("{ctx}: {e:?}"));
            let built = build_tree(&dm, Method::Nj, BuildOptions { trace: false })
                .unwrap_or_else(|e| panic!("{ctx}: {e:?}"));
            let our_keys: BTreeSet<String> = tree_splits(&built.tree, &dm.labels, false)
                .iter()
                .map(|(_, s)| s.labels(&dm.labels).join("|"))
                .collect();
            let excluded = excluded_splits(&aln, &dm.labels, &our_keys, filter);
            if !excluded.is_empty() {
                found.insert((stem.clone(), key.clone()), excluded);
            }
        }
    }
    let expected: BTreeMap<(String, String), BTreeSet<String>> = ["pairwise", "complete"]
        .iter()
        .map(|f| {
            (
                ("globins".to_string(), format!("nj/Poisson/{f}")),
                BTreeSet::from(["Chimp_HBB|Human_HBB".to_string()]),
            )
        })
        .collect();
    assert_eq!(found, expected, "excluded identical-sequence splits differ");
}

/// Coverage guard: every key in every `fixtures/mega/library/*.json`,
/// `fixtures/mega/library/boot1000/*.json` and
/// `fixtures/mega/roundtrip/*.json` is either parity-compared
/// above (p, JC69, K80, Poisson) or a JTT key, which is handled by the
/// printed-matrix topology check (trees) and the explicit skips
/// (distances, bootstrap). Any other model, filter or method name
/// fails here, so a fixture key added later can never be silently
/// ignored.
#[test]
fn every_library_fixture_key_is_handled() {
    fn check_model(stem: &str, key: &str, mname: &str, protein: bool) {
        match mname {
            "p" | "JC69" | "K80" | "Poisson" => {}
            // JTT keys are covered only on protein fixtures.
            "JTT" => assert!(protein, "{stem} {key}: JTT on a non-protein fixture"),
            other => panic!(
                "{stem} {key}: model {other:?} has no comparison — \
                 add a parity arm or a divergence test"
            ),
        }
    }
    for (stem, fx) in load_fixtures::<MegaFixture>("mega/library") {
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
        for (key, run) in &fx.bootstrap {
            let mut it = key.split('/');
            assert_eq!(
                it.next(),
                Some("nj"),
                "{stem} {key}: bootstrap is NJ only (fixtures/mega/README.md)"
            );
            let (mname, fname) = (
                it.next()
                    .unwrap_or_else(|| panic!("{stem} {key}: missing model")),
                it.next()
                    .unwrap_or_else(|| panic!("{stem} {key}: missing filter")),
            );
            assert!(it.next().is_none(), "{stem} {key}: trailing segment");
            assert!(
                matches!(fname, "pairwise" | "complete"),
                "{stem} {key}: bootstrap runs pairwise and complete only"
            );
            filter_of(fname);
            check_model(&stem, key, mname, protein);
            assert_eq!(run.replicates, 100, "{stem} {key}: replicates");
            assert!(
                !run.support.is_empty(),
                "{stem} {key}: a bootstrap run with no labelled splits"
            );
        }
    }
    for (stem, fx) in load_fixtures::<BootFixture>("mega/library/boot1000") {
        let protein = fx.alphabet == "protein";
        for (key, run) in &fx.bootstrap {
            let mut it = key.split('/');
            assert_eq!(
                it.next(),
                Some("nj"),
                "{stem} {key}: bootstrap is NJ only (fixtures/mega/README.md)"
            );
            let (mname, fname) = (
                it.next()
                    .unwrap_or_else(|| panic!("{stem} {key}: missing model")),
                it.next()
                    .unwrap_or_else(|| panic!("{stem} {key}: missing filter")),
            );
            assert!(it.next().is_none(), "{stem} {key}: trailing segment");
            assert!(
                matches!(fname, "pairwise" | "complete"),
                "{stem} {key}: bootstrap runs pairwise and complete only"
            );
            filter_of(fname);
            check_model(&stem, key, mname, protein);
            assert_eq!(run.replicates, 1000, "{stem} {key}: replicates");
            assert!(
                !run.support.is_empty(),
                "{stem} {key}: a bootstrap run with no labelled splits"
            );
        }
    }
    for (stem, fx) in load_fixtures::<MegaFixture>("mega/roundtrip") {
        let protein = fx.alphabet == "protein";
        assert!(fx.trees.is_empty(), "{stem}: roundtrip has no trees");
        assert!(
            fx.bootstrap.is_empty(),
            "{stem}: roundtrip has no bootstrap"
        );
        for key in fx.distances.keys() {
            let (mname, fname) = key
                .split_once('/')
                .unwrap_or_else(|| panic!("{stem} {key}: not a <model>/<filter> key"));
            filter_of(fname);
            check_model(&stem, key, mname, protein);
        }
    }
}
