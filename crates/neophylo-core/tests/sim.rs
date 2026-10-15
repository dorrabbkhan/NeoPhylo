//! Simulation tests (spec §4.2, §8.4): determinism, committed golden
//! hashes, convergence to true path lengths and validation errors.
//!
//! `fixtures/sim_golden.json` is written by the ignored `regen_golden`
//! test and is reviewed by the fixtures owner; it must not be edited by
//! hand.

use neophylo_core::dist::{compute, Cell, DistModel};
use neophylo_core::error::NeoError;
use neophylo_core::newick::parse_newick;
use neophylo_core::seq::Alignment;
use neophylo_core::sim::{simulate, SimModel, SimSpec};
use neophylo_core::tree::{NodeId, Tree};
use serde::Deserialize;

/// The `true_tree` of the `nj-basics` exercise (spec §7).
const NJ_BASICS_TREE: &str = "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);";

fn spec(model: SimModel, length: u32, seed: u64) -> SimSpec {
    SimSpec {
        model,
        length,
        seed,
    }
}

#[test]
fn deterministic() {
    let tree = parse_newick(NJ_BASICS_TREE).unwrap();
    let s = spec(SimModel::Jc69, 200, 42);
    let a = simulate(&tree, &s).unwrap();
    let b = simulate(&tree, &s).unwrap();
    assert_eq!(a, b);
    let c = simulate(&tree, &spec(SimModel::Jc69, 200, 43)).unwrap();
    assert_ne!(a.seqs, c.seqs);
}

// --- golden hashes -----------------------------------------------------------

fn golden_path() -> String {
    concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/sim_golden.json"
    )
    .to_string()
}

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

/// FNV-1a, 64-bit, over the concatenated sequences of an alignment.
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

#[test]
fn golden_hashes() {
    let text = std::fs::read_to_string(golden_path())
        .expect("run `cargo test -- --ignored regen_golden` first");
    let golden: GoldenFile = serde_json::from_str(&text).unwrap();
    assert_eq!(golden.cases.len(), 3);
    for case in &golden.cases {
        let model = match (case.model.as_str(), case.kappa) {
            ("JC69", _) => SimModel::Jc69,
            ("K80", Some(kappa)) => SimModel::K80 { kappa },
            (m, k) => panic!("bad golden case model {m} kappa {k:?}"),
        };
        let tree = parse_newick(&case.tree).unwrap();
        let aln = simulate(&tree, &spec(model, case.length, case.seed)).unwrap();
        assert_eq!(
            format!("{:016x}", fnv1a64(&aln)),
            case.fnv1a64,
            "golden hash mismatch in case {}",
            case.name
        );
    }
}

/// Regenerate `fixtures/sim_golden.json`. Ignored by default:
/// `cargo test -p neophylo-core --test sim -- --ignored regen_golden`.
#[test]
#[ignore]
fn regen_golden() {
    let cases = [
        ("jc69_seed1", "JC69", None, 1000, 1u64),
        ("k80_k2_seed2", "K80", Some(2.0), 1000, 2u64),
        ("jc69_seed3_len10000", "JC69", None, 10_000, 3u64),
    ];
    let mut out = String::from("{\n  \"cases\": [\n");
    for (i, (name, model, kappa, length, seed)) in cases.iter().enumerate() {
        let sim = match kappa {
            Some(k) => spec(SimModel::K80 { kappa: *k }, *length, *seed),
            None => spec(SimModel::Jc69, *length, *seed),
        };
        let tree = parse_newick(NJ_BASICS_TREE).unwrap();
        let aln = simulate(&tree, &sim).unwrap();
        let kappa_json = match kappa {
            Some(k) => format!(", \"kappa\": {k}"),
            None => String::new(),
        };
        out.push_str(&format!(
            "    {{ \"name\": \"{name}\", \"tree\": \"{NJ_BASICS_TREE}\", \
             \"model\": \"{model}\"{kappa_json}, \"length\": {length}, \
             \"seed\": {seed}, \"fnv1a64\": \"{:016x}\" }}{}\n",
            fnv1a64(&aln),
            if i + 1 == cases.len() { "" } else { "," }
        ));
    }
    out.push_str("  ]\n}\n");
    let path = golden_path();
    std::fs::write(&path, out).unwrap();
    eprintln!("wrote {path}");
}

// --- convergence -------------------------------------------------------------

/// Path length between two labelled tips (sum of edge lengths through the
/// lowest common ancestor), computed from the tree itself.
fn path_length(tree: &Tree, a: &str, b: &str) -> f64 {
    let find = |label: &str| -> NodeId {
        tree.nodes
            .iter()
            .position(|n| n.label.as_deref() == Some(label))
            .map(|i| NodeId(i as u32))
            .unwrap()
    };
    // Ancestor trail from a tip up to and including the root, so the LCA
    // search finds the root when it is the common ancestor.
    let trail = |mut id: NodeId| -> Vec<NodeId> {
        let mut t = vec![id];
        while id != tree.root {
            id = tree.nodes[id.0 as usize].parent.unwrap();
            t.push(id);
        }
        t
    };
    let (ta, tb) = (trail(find(a)), trail(find(b)));
    let lca = ta.iter().copied().find(|id| tb.contains(id)).unwrap();
    let sum_to = |trail: &[NodeId]| -> f64 {
        trail
            .iter()
            .take_while(|&&id| id != lca)
            .map(|&id| tree.branch_length(id).unwrap())
            .sum()
    };
    sum_to(&ta) + sum_to(&tb)
}

#[test]
fn jc69_convergence() {
    // spec §8.4: 100,000 sites, JC69 correction, distances within 2% of
    // the true path length.
    let tree = parse_newick("((A:0.1,B:0.2):0.15,(C:0.25,D:0.3):0.2);").unwrap();
    let aln = simulate(&tree, &spec(SimModel::Jc69, 100_000, 7)).unwrap();
    let dm = compute(&aln, DistModel::Jc69).unwrap();
    let n = dm.n();
    for i in 0..n {
        for j in (i + 1)..n {
            let want = path_length(&tree, &dm.labels[i], &dm.labels[j]);
            let got = match dm.cells[i * n + j] {
                Cell::Value(v) => v,
                Cell::Saturated => panic!("saturated cell ({i},{j})"),
            };
            assert!(
                (got - want).abs() <= 0.02 * want,
                "pair ({},{}) got {got}, want {want} ± 2%",
                dm.labels[i],
                dm.labels[j]
            );
        }
    }
}

#[test]
fn k80_convergence() {
    // spec §8.4: same tree and seed as jc69_convergence, K80 kappa = 2,
    // 100,000 sites, K80 correction, distances within 2% of the true
    // path length.
    let tree = parse_newick("((A:0.1,B:0.2):0.15,(C:0.25,D:0.3):0.2);").unwrap();
    let aln = simulate(&tree, &spec(SimModel::K80 { kappa: 2.0 }, 100_000, 7)).unwrap();
    let dm = compute(&aln, DistModel::K80).unwrap();
    let n = dm.n();
    for i in 0..n {
        for j in (i + 1)..n {
            let want = path_length(&tree, &dm.labels[i], &dm.labels[j]);
            let got = match dm.cells[i * n + j] {
                Cell::Value(v) => v,
                Cell::Saturated => panic!("saturated cell ({i},{j})"),
            };
            assert!(
                (got - want).abs() <= 0.02 * want,
                "pair ({},{}) got {got}, want {want} ± 2%",
                dm.labels[i],
                dm.labels[j]
            );
        }
    }
}

#[test]
fn k80_kappa1_matches_jc_stats() {
    // With kappa = 1 the K80 transition rate equals each transversion
    // rate, so about 1/3 of changes are transitions. B's zero-length
    // branch keeps it equal to the root sequence, so A-vs-B differences
    // are the changes on A's branch.
    let tree = parse_newick("(A:0.5,B:0,C:0);").unwrap();
    let aln = simulate(&tree, &spec(SimModel::K80 { kappa: 1.0 }, 100_000, 11)).unwrap();
    let (a, b) = (&aln.seqs[0], &aln.seqs[1]);
    let (mut changes, mut transitions) = (0u64, 0u64);
    for k in 0..a.len() {
        let (x, y) = (a[k], b[k]);
        if x != y {
            changes += 1;
            if matches!(
                (x, y),
                (b'A', b'G') | (b'G', b'A') | (b'C', b'T') | (b'T', b'C')
            ) {
                transitions += 1;
            }
        }
    }
    let frac = transitions as f64 / changes as f64;
    assert!(
        (frac - 1.0 / 3.0).abs() <= 0.02,
        "transition fraction {frac} not within 0.02 of 1/3 ({transitions}/{changes})"
    );
}

// --- validation --------------------------------------------------------------

#[test]
fn missing_length() {
    // Review Focus 5: a missing non-root branch length must fail before
    // any simulation runs.
    let tree = parse_newick("(A:0.1,B,C:0.2);").unwrap();
    let err = simulate(&tree, &spec(SimModel::Jc69, 100, 1)).unwrap_err();
    assert_eq!(
        err,
        NeoError::InvalidExercise {
            field: "true_tree".to_string(),
            msg: "branch length missing".to_string(),
        }
    );
}

#[test]
fn length_out_of_range() {
    let tree = parse_newick("(A:0.1,B:0.2,C:0.3);").unwrap();
    for length in [0u32, 9, 100_001] {
        let err = simulate(&tree, &spec(SimModel::Jc69, length, 1)).unwrap_err();
        assert!(
            matches!(
                err,
                NeoError::InvalidExercise { ref field, .. } if field == "sim.length"
            ),
            "length {length} gave {err:?}"
        );
    }
    let aln = simulate(&tree, &spec(SimModel::Jc69, 10, 1)).unwrap();
    assert_eq!(aln.seqs[0].len(), 10);
}

#[test]
fn kappa_nonpositive() {
    let tree = parse_newick("(A:0.1,B:0.2,C:0.3);").unwrap();
    let err = simulate(&tree, &spec(SimModel::K80 { kappa: 0.0 }, 100, 1)).unwrap_err();
    assert!(
        matches!(
            err,
            NeoError::InvalidExercise { ref field, .. } if field == "sim.kappa"
        ),
        "kappa 0 gave {err:?}"
    );
}

#[test]
fn seed_limit() {
    // Seeds arrive from JS as `number`, so anything above 2^53 - 1 is
    // rejected; the boundary value itself is accepted.
    let tree = parse_newick("(A:0.1,B:0.2,C:0.3);").unwrap();
    let err = simulate(&tree, &spec(SimModel::Jc69, 100, 1 << 53)).unwrap_err();
    assert_eq!(
        err,
        NeoError::InvalidExercise {
            field: "sim.seed".to_string(),
            msg: "seed must be at most 2^53 - 1".to_string(),
        }
    );
    simulate(&tree, &spec(SimModel::Jc69, 100, (1 << 53) - 1)).unwrap();
}
