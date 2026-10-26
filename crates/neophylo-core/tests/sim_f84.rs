//! F84 DNA simulation tests (v1.4 spec §3.5): determinism, committed
//! golden hashes, convergence to true path lengths under `DistModel::F84`
//! and validation of `kappa` and `base_freqs`.
//!
//! `fixtures/sim_golden_f84.json` is written by the ignored
//! `regen_golden` test in this file and is reviewed by the fixtures
//! owner; it must not be edited by hand. It is kept in its own file so
//! the fixture guard can distinguish the new F84 golden from the frozen
//! v1/v1.1 hashes (`tests/sim.rs`'s `regen_golden` must NOT be run here).

use neophylo_core::dist::{compute, Cell, DistModel};
use neophylo_core::error::NeoError;
use neophylo_core::newick::parse_newick;
use neophylo_core::seq::Alignment;
use neophylo_core::sim::{simulate, SimModel, SimSpec};
use neophylo_core::tree::{NodeId, Tree};
use serde::Deserialize;

/// The `true_tree` of the `nj-basics` exercise (spec §7), shared with
/// the existing goldens.
const NJ_BASICS_TREE: &str = "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);";
/// The default: equal base frequencies.
const EQUAL: [f64; 4] = [0.25; 4];
/// The non-equal golden case: A 0.3, C 0.2, G 0.2, T 0.3.
const UNEQUAL: [f64; 4] = [0.3, 0.2, 0.2, 0.3];

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
    let s = spec(
        SimModel::F84 {
            kappa: 2.0,
            base_freqs: UNEQUAL,
        },
        200,
        42,
    );
    let a = simulate(&tree, &s).unwrap();
    let b = simulate(&tree, &s).unwrap();
    assert_eq!(a, b);
    let c = simulate(
        &tree,
        &spec(
            SimModel::F84 {
                kappa: 2.0,
                base_freqs: UNEQUAL,
            },
            200,
            43,
        ),
    )
    .unwrap();
    assert_ne!(a.seqs, c.seqs);
}

// --- golden hashes -----------------------------------------------------------

fn golden_path() -> String {
    concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/sim_golden_f84.json"
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
    kappa: f64,
    base_freqs: [f64; 4],
    length: u32,
    seed: u64,
    fnv1a64: String,
}

/// FNV-1a, 64-bit, over the concatenated sequences of an alignment —
/// the same hash `tests/sim.rs` uses for the DNA goldens.
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
    assert_eq!(golden.cases.len(), 2);
    for case in &golden.cases {
        assert_eq!(case.model, "F84", "bad golden case model");
        let model = SimModel::F84 {
            kappa: case.kappa,
            base_freqs: case.base_freqs,
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

/// Regenerate `fixtures/sim_golden_f84.json`. Ignored by default:
/// `cargo test -p neophylo-core --test sim_f84 -- --ignored regen_golden`.
/// Writes ONLY the F84 golden; the v1/v1.1 goldens belong to
/// `tests/sim.rs`'s own `regen_golden`.
#[test]
#[ignore]
fn regen_golden() {
    let cases = [
        ("f84_equal_seed5", 2.0, EQUAL, 1_000u32, 5u64),
        ("f84_unequal_seed6", 2.0, UNEQUAL, 1_000u32, 6u64),
    ];
    let mut out = String::from("{\n  \"cases\": [\n");
    for (i, (name, kappa, freqs, length, seed)) in cases.iter().enumerate() {
        let sim = spec(
            SimModel::F84 {
                kappa: *kappa,
                base_freqs: *freqs,
            },
            *length,
            *seed,
        );
        let tree = parse_newick(NJ_BASICS_TREE).unwrap();
        let aln = simulate(&tree, &sim).unwrap();
        out.push_str(&format!(
            "    {{ \"name\": \"{name}\", \"tree\": \"{NJ_BASICS_TREE}\", \
             \"model\": \"F84\", \"kappa\": {kappa}, \
             \"base_freqs\": [{}, {}, {}, {}], \"length\": {length}, \
             \"seed\": {seed}, \"fnv1a64\": \"{:016x}\" }}{}\n",
            freqs[0],
            freqs[1],
            freqs[2],
            freqs[3],
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
/// lowest common ancestor) — the same computation `tests/sim.rs` uses.
fn path_length(tree: &Tree, a: &str, b: &str) -> f64 {
    let find = |label: &str| -> NodeId {
        tree.nodes
            .iter()
            .position(|n| n.label.as_deref() == Some(label))
            .map(|i| NodeId(i as u32))
            .unwrap()
    };
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
fn f84_convergence() {
    // v1.4 spec §3.5: 100,000 sites at equal frequencies, F84
    // correction, distances within 2% of the true path length. The
    // sim's kappa is dnadist's default ratio 2.0, the ratio
    // `DistModel::F84` estimates under.
    let tree = parse_newick("((A:0.1,B:0.2):0.15,(C:0.25,D:0.3):0.2);").unwrap();
    let aln = simulate(
        &tree,
        &spec(
            SimModel::F84 {
                kappa: 2.0,
                base_freqs: EQUAL,
            },
            100_000,
            7,
        ),
    )
    .unwrap();
    let dm = compute(&aln, DistModel::F84).unwrap();
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

// --- validation --------------------------------------------------------------

#[test]
fn kappa_invalid() {
    let tree = parse_newick("(A:0.1,B:0.2,C:0.3);").unwrap();
    for kappa in [0.0, -1.0, f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let err = simulate(
            &tree,
            &spec(
                SimModel::F84 {
                    kappa,
                    base_freqs: EQUAL,
                },
                100,
                1,
            ),
        )
        .unwrap_err();
        assert!(
            matches!(
                err,
                NeoError::InvalidExercise { ref field, .. } if field == "sim.kappa"
            ),
            "kappa {kappa} gave {err:?}"
        );
    }
}

#[test]
fn kappa_infeasible() {
    // Owner decision 2026-10-26 (PR #90): the simulator refuses a kappa
    // below the feasible floor (a·g + c·t)/(freqR·freqY) with
    // `NeoError`; only the distance path keeps dnadist's reset to F81.
    let tree = parse_newick("(A:0.1,B:0.2,C:0.3);").unwrap();
    let run = |kappa: f64, base_freqs: [f64; 4]| {
        simulate(&tree, &spec(SimModel::F84 { kappa, base_freqs }, 100, 1))
    };
    let assert_kappa_err = |r: Result<Alignment, NeoError>, kappa: f64| {
        let err = r.unwrap_err();
        assert!(
            matches!(
                err,
                NeoError::InvalidExercise { ref field, .. } if field == "sim.kappa"
            ),
            "kappa {kappa} gave {err:?}"
        );
    };

    // Equal frequencies: the floor is exactly 0.5, and kappa = 0.5 is
    // the allowed F81 limit.
    assert_kappa_err(run(0.3, EQUAL), 0.3);
    assert_kappa_err(run(0.4999, EQUAL), 0.4999);
    run(0.5, EQUAL).unwrap();
    run(0.5001, EQUAL).unwrap();

    // Unequal frequencies: the floor is computed from the same formula.
    let freqs = [0.1, 0.4, 0.15, 0.35];
    let (a, c, g, t) = (freqs[0], freqs[1], freqs[2], freqs[3]);
    let min = (a * g + c * t) / ((a + g) * (c + t));
    assert_kappa_err(run(min * 0.999, freqs), min * 0.999);
    run(min * 1.001, freqs).unwrap();

    // A huge kappa still succeeds and yields only A/C/G/T (no NaN can
    // reach the byte output, but the run must not error out either).
    let aln = run(1e300, EQUAL).unwrap();
    assert!(aln
        .seqs
        .iter()
        .all(|s| s.iter().all(|b| b"ACGT".contains(b))));
}

#[test]
fn base_freq_invalid() {
    let tree = parse_newick("(A:0.1,B:0.2,C:0.3);").unwrap();
    for freqs in [
        [0.0, 0.25, 0.25, 0.5],
        [-0.1, 0.4, 0.3, 0.4],
        [f64::NAN, 0.25, 0.25, 0.5],
        [f64::INFINITY, 0.25, 0.25, 0.25],
        [f64::NEG_INFINITY, 0.5, 0.5, 1.0],
    ] {
        let err = simulate(
            &tree,
            &spec(
                SimModel::F84 {
                    kappa: 2.0,
                    base_freqs: freqs,
                },
                100,
                1,
            ),
        )
        .unwrap_err();
        assert!(
            matches!(
                err,
                NeoError::InvalidExercise { ref field, .. } if field == "sim.base_freqs"
            ),
            "freqs {freqs:?} gave {err:?}"
        );
    }
}

#[test]
fn base_freq_sum() {
    // v1.4 spec §3.5: frequencies must sum to 1 within 1e-6.
    let tree = parse_newick("(A:0.1,B:0.2,C:0.3);").unwrap();
    let err = simulate(
        &tree,
        &spec(
            SimModel::F84 {
                kappa: 2.0,
                base_freqs: [0.225, 0.225, 0.225, 0.225],
            },
            100,
            1,
        ),
    )
    .unwrap_err();
    assert!(
        matches!(
            err,
            NeoError::InvalidExercise { ref field, .. } if field == "sim.base_freqs"
        ),
        "sum 0.9 gave {err:?}"
    );
    // Just inside and just outside the 1e-6 band.
    simulate(
        &tree,
        &spec(
            SimModel::F84 {
                kappa: 2.0,
                base_freqs: [0.25, 0.25, 0.25, 0.250_000_5],
            },
            100,
            1,
        ),
    )
    .unwrap();
    let err = simulate(
        &tree,
        &spec(
            SimModel::F84 {
                kappa: 2.0,
                base_freqs: [0.25, 0.25, 0.25, 0.250_01],
            },
            100,
            1,
        ),
    )
    .unwrap_err();
    assert!(
        matches!(
            err,
            NeoError::InvalidExercise { ref field, .. } if field == "sim.base_freqs"
        ),
        "sum 1.00001 gave {err:?}"
    );
}
