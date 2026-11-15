//! Worksheet facts tests (v1.4c plan Task 6): per-join row sums, tied
//! pairs, closest-pair flags and the NJ final three-way join entry, all
//! read from the engine trace — never recomputed.
//!
//! `wikipedia5_facts` and `nj_by_hand_facts` check every value against
//! the hand-verified worked fixtures. `integer_matrix_tie_flags` pins the
//! tie invariants on integer-valued matrices where ties actually occur.

use neophylo_core::algos::{build_tree, BuildOptions, Method, NjFinal, NjStep, Trace};
use neophylo_core::dist::DistanceMatrix;
use neophylo_core::error::NeoError;
use neophylo_core::matrix::Matrix;
use neophylo_core::tree::{NodeId, Tree};
use neophylo_core::worksheet::worksheet_facts;
use proptest::prelude::*;
use serde::Deserialize;

const TOL: f64 = 1e-12;

fn dm(labels: &[&str], data: &[f64]) -> DistanceMatrix {
    let n = labels.len();
    assert_eq!(data.len(), n * n);
    DistanceMatrix::from_values(
        labels.iter().map(|s| s.to_string()).collect(),
        &Matrix {
            n,
            data: data.to_vec(),
        },
    )
}

/// The display name `web/src/state/names.ts::nodeName` computes: leaf
/// ids are `0..leafCount` and show their label, internal nodes show
/// `u<creation order>`. Duplicated here on purpose — the contract is
/// that the engine's JoinFacts names equal the stepper's.
fn node_name(tree: &Tree, id: NodeId) -> String {
    let mut leaves = 0usize;
    for node in &tree.nodes {
        if node.children.is_empty() {
            leaves += 1;
        }
    }
    let i = id.0 as usize;
    let label = tree.nodes[i].label.clone();
    if i < leaves {
        return label.unwrap_or_else(|| format!("#{i}"));
    }
    label.unwrap_or_else(|| format!("u{}", i - leaves + 1))
}

fn assert_close(got: f64, want: f64) {
    assert!((got - want).abs() <= TOL, "got {got}, want {want}");
}

fn assert_vec_close(got: &[f64], want: &[f64]) {
    assert_eq!(got.len(), want.len());
    for (g, w) in got.iter().zip(want) {
        assert_close(*g, *w);
    }
}

fn pair(x: &str, y: &str) -> (String, String) {
    (x.to_string(), y.to_string())
}

/// The worked-fixture envelope; `steps`/`final_join` stay in the struct
/// so the fixture's full shape is validated on parse.
#[derive(Deserialize)]
#[allow(dead_code)]
struct WorkedNj {
    labels: Vec<String>,
    matrix: Matrix,
    steps: Vec<NjStep>,
    final_join: NjFinal,
}

fn worked(name: &str) -> DistanceMatrix {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../../fixtures/worked/");
    let text = std::fs::read_to_string(format!("{path}{name}")).unwrap();
    let w: WorkedNj = serde_json::from_str(&text).unwrap();
    DistanceMatrix::from_values(w.labels, &w.matrix)
}

#[test]
fn wikipedia5_facts() {
    let m = worked("nj_wikipedia5.json");
    let facts = worksheet_facts(&m, Method::Nj).unwrap();
    // Two pairwise joins plus the final three-way join entry.
    assert_eq!(facts.len(), 3);

    let s1 = &facts[0];
    assert_eq!(s1.step, 1);
    assert!(!s1.final_join);
    assert_eq!(s1.chosen, pair("a", "b"));
    assert_eq!(s1.tied, vec![pair("a", "b")]);
    assert!(!s1.tie_same_split);
    // d-e is the minimum raw distance (3) — NJ picks a-b on Q instead.
    assert_eq!(s1.closest, vec![pair("d", "e")]);
    assert!(!s1.chosen_is_closest);
    assert_vec_close(
        &s1.row_sums.clone().unwrap(),
        &[31.0, 34.0, 34.0, 30.0, 27.0],
    );
    assert_close(s1.len_i, 2.0);
    assert_close(s1.len_j, 3.0);
    // The new node's distances to the remaining actives c, d, e.
    assert_eq!(
        s1.new_distances,
        vec![
            ("c".to_string(), 7.0),
            ("d".to_string(), 7.0),
            ("e".to_string(), 6.0)
        ]
    );

    let s2 = &facts[1];
    assert_eq!(s2.step, 2);
    assert!(!s2.final_join);
    assert_eq!(s2.chosen, pair("c", "u1"));
    // Two pairs tie at Q = -28: the complements (c,u1) and (d,e), so
    // either choice gives the same four-way split.
    assert_eq!(s2.tied, vec![pair("c", "u1"), pair("d", "e")]);
    assert!(s2.tie_same_split);
    assert_eq!(s2.closest, vec![pair("d", "e")]);
    assert!(!s2.chosen_is_closest);
    assert_vec_close(&s2.row_sums.clone().unwrap(), &[22.0, 18.0, 16.0, 20.0]);

    let fin = &facts[2];
    assert_eq!(fin.step, 3);
    assert!(fin.final_join);
    assert_eq!(fin.chosen, pair("d", "e"));
    // The three-way join has no real choice: tied lists only (a, b).
    assert_eq!(fin.tied, vec![pair("d", "e")]);
    assert!(!fin.tie_same_split);
    // final_join.distance rows are ordered a, b, c.
    assert_vec_close(&fin.row_sums.clone().unwrap(), &[7.0, 6.0, 7.0]);
    assert_close(fin.len_i, 2.0);
    assert_close(fin.len_j, 1.0);
    assert_eq!(fin.new_distances, vec![("u2".to_string(), 2.0)]);
    // d-e and e-u2 both sit at the minimum raw distance of 3.
    assert_eq!(fin.closest, vec![pair("d", "e"), pair("e", "u2")]);
    assert!(fin.chosen_is_closest);
}

#[test]
fn nj_by_hand_facts() {
    let m = worked("nj_by_hand.json");
    let facts = worksheet_facts(&m, Method::Nj).unwrap();
    assert_eq!(facts.len(), 3);
    assert_eq!(facts[0].tied.len(), 1, "step 1 must be untied");
    assert_eq!(
        facts[1].tied,
        vec![pair("c", "u1"), pair("d", "e")],
        "the last pairwise join ties on two complementary pairs"
    );
    assert!(facts[1].tie_same_split);
    assert_eq!(facts[2].tied.len(), 1, "the final entry lists only (a, b)");

    let fin = &facts[2];
    assert!(fin.final_join);
    assert_eq!(fin.chosen, pair("d", "e"));
    assert_vec_close(&fin.row_sums.clone().unwrap(), &[5.5, 4.5, 4.0]);
    assert_close(fin.len_i, 2.0);
    assert_close(fin.len_j, 1.0);
    assert_eq!(fin.new_distances, vec![("u2".to_string(), 0.5)]);
    assert_eq!(fin.closest, vec![pair("e", "u2")]);
    assert!(!fin.chosen_is_closest);
}

#[test]
fn three_taxa_one_join() {
    let m = dm(
        &["a", "b", "c"],
        &[0.0, 1.0, 2.0, 1.0, 0.0, 3.0, 2.0, 3.0, 0.0],
    );
    let facts = worksheet_facts(&m, Method::Nj).unwrap();
    // Three taxa skip the pairwise loop: a single final_join entry.
    assert_eq!(facts.len(), 1);
    assert!(facts[0].final_join);
    assert_eq!(facts[0].step, 1);
    assert_eq!(facts[0].chosen, pair("a", "b"));
    assert_eq!(facts[0].tied, vec![pair("a", "b")]);
    // lc = (d(a,c) + d(b,c) - d(a,b)) / 2 = (2 + 3 - 1) / 2.
    assert_eq!(facts[0].new_distances, vec![("c".to_string(), 2.0)]);
    assert_close(facts[0].len_i, 0.0); // la = (1 + 2 - 3) / 2
    assert_close(facts[0].len_j, 1.0); // lb = (1 + 3 - 2) / 2
    assert!(facts[0].chosen_is_closest);

    // UPGMA still runs n-1 pairwise joins — no final entry.
    let upgma = worksheet_facts(&m, Method::Upgma).unwrap();
    assert_eq!(upgma.len(), 2);
    for f in &upgma {
        assert!(!f.final_join);
        assert!(f.row_sums.is_none(), "UPGMA facts never carry row sums");
    }
}

#[test]
fn zero_distances_allowed() {
    // Identical taxa (d(a,b) = 0) are valid input — Review Focus 5.
    let m = dm(
        &["a", "b", "c", "d"],
        &[
            0.0, 0.0, 1.0, 1.0, 0.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0,
        ],
    );
    let nj = worksheet_facts(&m, Method::Nj).unwrap();
    assert!(!nj.is_empty());
    let upgma = worksheet_facts(&m, Method::Upgma).unwrap();
    assert_eq!(upgma.len(), 3);
    // A zero pair is also the closest pair.
    assert_eq!(upgma[0].chosen, pair("a", "b"));
    assert!(upgma[0].chosen_is_closest);
}

#[test]
fn too_few_taxa() {
    let m = dm(&["a", "b"], &[0.0, 1.0, 1.0, 0.0]);
    let err = worksheet_facts(&m, Method::Nj).unwrap_err();
    assert_eq!(err, NeoError::TooFewTaxa { min: 3, got: 2 });
}

#[test]
fn names_match_stepper() {
    // JoinFacts names must equal what stepMatrix shows for the same
    // steps: leaves by label, internal nodes u1, u2, … by creation order.
    let m = worked("nj_wikipedia5.json");
    let res = build_tree(&m, Method::Nj, BuildOptions { trace: true }).unwrap();
    let facts = worksheet_facts(&m, Method::Nj).unwrap();
    let Some(Trace::Nj { steps, final_join }) = &res.trace else {
        panic!("trace missing")
    };
    for (i, s) in steps.iter().enumerate() {
        let f = &facts[i];
        let names: Vec<String> = s
            .active
            .iter()
            .map(|&id| node_name(&res.tree, id))
            .collect();
        let remaining: Vec<String> = s
            .active
            .iter()
            .enumerate()
            .filter(|(k, _)| *k != s.chosen.0 && *k != s.chosen.1)
            .map(|(_, &id)| node_name(&res.tree, id))
            .collect();
        assert_eq!(
            f.chosen,
            (names[s.chosen.0].clone(), names[s.chosen.1].clone()),
            "step {} chosen names",
            s.step
        );
        let new_names: Vec<String> = f.new_distances.iter().map(|(n, _)| n.clone()).collect();
        assert_eq!(new_names, remaining, "step {} new-distance names", s.step);
    }
    let fin = facts.last().unwrap();
    assert_eq!(
        fin.chosen,
        (
            node_name(&res.tree, final_join.a),
            node_name(&res.tree, final_join.b)
        )
    );
    assert_eq!(
        fin.new_distances,
        vec![(node_name(&res.tree, final_join.c), final_join.lc)]
    );
}

// --- property tests ---------------------------------------------------------

/// Integer-valued matrices, so exact-`==` ties genuinely occur.
fn arb_integer_matrix() -> impl Strategy<Value = DistanceMatrix> {
    (3usize..=7).prop_flat_map(|n| {
        prop::collection::vec(0u32..12, n * (n - 1) / 2).prop_map(move |lower| {
            let mut m = Matrix::zeros(n);
            let mut k = 0usize;
            for i in 0..n {
                for j in 0..i {
                    m.set(i, j, lower[k] as f64);
                    m.set(j, i, lower[k] as f64);
                    k += 1;
                }
            }
            let labels = (0..n).map(|i| format!("t{i}")).collect::<Vec<_>>();
            DistanceMatrix::from_values(labels, &m)
        })
    })
}

proptest! {
    #[test]
    fn integer_matrix_tie_flags(m in arb_integer_matrix()) {
        for method in [Method::Nj, Method::Upgma] {
            let res = build_tree(&m, method, BuildOptions { trace: true }).unwrap();
            let facts = worksheet_facts(&m, method).unwrap();
            match &res.trace {
                Some(Trace::Nj { steps, final_join }) => {
                    prop_assert_eq!(facts.len(), steps.len() + 1);
                    for (i, s) in steps.iter().enumerate() {
                        let f = &facts[i];
                        prop_assert_eq!(f.step, s.step);
                        prop_assert!(!f.final_join);
                        // The engine's `tie` flag is exactly "more than
                        // one pair at the minimum criterion".
                        prop_assert_eq!(f.tied.len() > 1, s.tie,
                            "step {}: tied {} vs trace tie {}", s.step, f.tied.len(), s.tie);
                        // Scan order puts the engine's chosen pair first.
                        prop_assert_eq!(&f.tied[0], &f.chosen);
                        let want = (
                            node_name(&res.tree, s.active[s.chosen.0]),
                            node_name(&res.tree, s.active[s.chosen.1]),
                        );
                        prop_assert_eq!(f.chosen.clone(), want, "step {} chosen", s.step);
                        prop_assert!(f.row_sums.is_some());
                        prop_assert_eq!(f.chosen_is_closest, f.closest.contains(&f.chosen));
                    }
                    let fin = facts.last().unwrap();
                    prop_assert!(fin.final_join);
                    prop_assert_eq!(fin.step, steps.len() as u32 + 1);
                    prop_assert_eq!(&fin.tied, &vec![fin.chosen.clone()]);
                    prop_assert!(!fin.tie_same_split);
                    prop_assert_eq!(fin.new_distances.len(), 1);
                    prop_assert_eq!(fin.new_distances[0].1, final_join.lc);
                }
                Some(Trace::Upgma { steps }) => {
                    prop_assert_eq!(facts.len(), steps.len());
                    for (i, s) in steps.iter().enumerate() {
                        let f = &facts[i];
                        prop_assert_eq!(f.step, s.step);
                        prop_assert!(!f.final_join);
                        prop_assert_eq!(f.tied.len() > 1, s.tie,
                            "step {}: tied {} vs trace tie {}", s.step, f.tied.len(), s.tie);
                        prop_assert_eq!(&f.tied[0], &f.chosen);
                        // UPGMA minimizes raw distance: tied == closest.
                        prop_assert_eq!(f.tied.clone(), f.closest.clone());
                        prop_assert!(f.chosen_is_closest);
                        prop_assert!(f.row_sums.is_none());
                    }
                }
                None => panic!("trace requested but missing"),
            }
        }
    }
}
