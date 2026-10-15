//! Neighbor-Joining tests (spec §4.5).
//!
//! `wikipedia5_steps` checks every trace field against the hand-verified
//! worked example in `fixtures/worked/nj_wikipedia5.json`.
//! `additive_recovery` checks that NJ reconstructs random binary trees
//! from their path-length matrices.

use std::collections::{BTreeMap, BTreeSet};

use neophylo_core::algos::nj::{NjFinal, NjStep};
use neophylo_core::algos::{build_tree, BuildOptions, Method, Trace};
use neophylo_core::dist::{Cell, DistModel, DistanceMatrix};
use neophylo_core::error::NeoError;
use neophylo_core::matrix::Matrix;
use neophylo_core::tree::{NodeId, Tree};
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

fn assert_close(got: f64, want: f64) {
    assert!((got - want).abs() <= TOL, "got {got}, want {want}");
}

fn assert_matrix_close(got: &Matrix, want: &Matrix) {
    assert_eq!(got.n, want.n);
    assert_eq!(got.data.len(), want.data.len());
    for (g, w) in got.data.iter().zip(&want.data) {
        assert_close(*g, *w);
    }
}

fn assert_vec_close(got: &[f64], want: &[f64]) {
    assert_eq!(got.len(), want.len());
    for (g, w) in got.iter().zip(want) {
        assert_close(*g, *w);
    }
}

fn assert_step(got: &NjStep, want: &NjStep) {
    assert_eq!(got.step, want.step);
    assert_eq!(got.active, want.active);
    assert_matrix_close(&got.distance, &want.distance);
    assert_vec_close(&got.r, &want.r);
    assert_matrix_close(&got.q, &want.q);
    assert_eq!(got.chosen, want.chosen);
    assert_eq!(got.tie, want.tie);
    assert_close(got.len_i, want.len_i);
    assert_close(got.len_j, want.len_j);
    assert_eq!(got.new_node, want.new_node);
    assert_vec_close(&got.new_row, &want.new_row);
}

#[derive(Deserialize)]
struct WorkedNj {
    labels: Vec<String>,
    matrix: Matrix,
    steps: Vec<NjStep>,
    final_join: NjFinal,
}

#[test]
fn wikipedia5_steps() {
    let json = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/worked/nj_wikipedia5.json"
    ));
    let worked: WorkedNj = serde_json::from_str(json).unwrap();
    let input = DistanceMatrix::from_values(worked.labels, &worked.matrix);
    let res = build_tree(&input, Method::Nj, BuildOptions { trace: true }).unwrap();
    let Some(Trace::Nj { steps, final_join }) = res.trace else {
        panic!("trace missing")
    };
    assert_eq!(steps.len(), worked.steps.len());
    for (got, want) in steps.iter().zip(&worked.steps) {
        assert_step(got, want);
    }
    let want = &worked.final_join;
    assert_eq!(final_join.a, want.a);
    assert_eq!(final_join.b, want.b);
    assert_eq!(final_join.c, want.c);
    assert_close(final_join.la, want.la);
    assert_close(final_join.lb, want.lb);
    assert_close(final_join.lc, want.lc);
    assert!(!res.tree.rooted);
}

#[test]
fn tie_rule() {
    // Every off-diagonal distance is 1, so every pair has the same Q and
    // the lowest (i, j) in lexicographic order wins.
    let m = dm(
        &["a", "b", "c", "d"],
        &[
            0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0,
        ],
    );
    let res = build_tree(&m, Method::Nj, BuildOptions { trace: true }).unwrap();
    let Some(Trace::Nj { steps, .. }) = res.trace else {
        panic!("trace missing")
    };
    assert_eq!(steps[0].chosen, (0, 1));
    assert!(steps[0].tie);
}

#[test]
fn identical_sequences() {
    // A zero matrix: every pair ties at every step. Must not panic, must
    // not produce NaN, all lengths are zero and the run is deterministic.
    let m = dm(&["a", "b", "c", "d", "e"], &[0.0; 25]);
    let r1 = build_tree(&m, Method::Nj, BuildOptions { trace: true }).unwrap();
    let r2 = build_tree(&m, Method::Nj, BuildOptions { trace: true }).unwrap();
    assert_eq!(r1.tree, r2.tree);
    assert_eq!(r1.trace, r2.trace);

    let Some(Trace::Nj { steps, final_join }) = &r1.trace else {
        panic!("trace missing")
    };
    for s in steps {
        assert!(s.len_i.is_finite() && s.len_j.is_finite());
        for v in
            s.r.iter()
                .chain(&s.new_row)
                .chain(&s.distance.data)
                .chain(&s.q.data)
        {
            assert!(v.is_finite(), "non-finite value in step {}", s.step);
        }
    }
    for v in [final_join.la, final_join.lb, final_join.lc] {
        assert!(v.is_finite());
    }
    for i in 0..r1.tree.nodes.len() {
        let id = NodeId(i as u32);
        if id != r1.tree.root {
            assert_eq!(r1.tree.branch_length(id), Some(0.0));
        }
    }
}

#[test]
fn too_few() {
    let m = dm(&["a", "b"], &[0.0, 1.0, 1.0, 0.0]);
    let err = build_tree(&m, Method::Nj, BuildOptions { trace: false }).unwrap_err();
    assert_eq!(err, NeoError::TooFewTaxa { min: 3, got: 2 });
}

#[test]
fn saturated_refused() {
    let m = DistanceMatrix {
        labels: vec!["a".into(), "b".into(), "c".into()],
        model: DistModel::Jc69,
        cells: vec![
            Cell::Value(0.0),
            Cell::Saturated,
            Cell::Value(1.0),
            Cell::Saturated,
            Cell::Value(0.0),
            Cell::Value(1.0),
            Cell::Value(1.0),
            Cell::Value(1.0),
            Cell::Value(0.0),
        ],
    };
    let err = build_tree(&m, Method::Nj, BuildOptions { trace: false }).unwrap_err();
    assert_eq!(
        err,
        NeoError::SaturatedMatrix {
            cells: vec![(0, 1)]
        }
    );
}

#[test]
fn no_trace_when_off() {
    let m = dm(
        &["a", "b", "c", "d"],
        &[
            0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0,
        ],
    );
    let res = build_tree(&m, Method::Nj, BuildOptions { trace: false }).unwrap();
    assert!(res.trace.is_none());
    assert_eq!(res.tree.leaf_labels().len(), 4);
}

#[test]
fn negative_lengths_kept() {
    // Triangle-inequality violation: la = (1 + 1 - 5) / 2 = -1.5 is kept,
    // not clamped (spec §4.5 step 6).
    let m = dm(
        &["a", "b", "c"],
        &[0.0, 1.0, 1.0, 1.0, 0.0, 5.0, 1.0, 5.0, 0.0],
    );
    let res = build_tree(&m, Method::Nj, BuildOptions { trace: true }).unwrap();
    let Some(Trace::Nj { final_join, .. }) = res.trace else {
        panic!("trace missing")
    };
    assert_eq!(final_join.a, NodeId(0));
    assert_close(final_join.la, -1.5);
    assert_eq!(res.tree.branch_length(NodeId(0)), Some(-1.5));
}

#[test]
fn step_counts() {
    // Every NJ run records n-3 pairwise joins plus the final three-way
    // join (spec §4.5). Additive matrices come from grown trees via
    // `path_matrix`, so they are additive by construction.
    for n in 3..=6usize {
        let picks = vec![(0u32, 1u32); n];
        let lens = vec![0.5f64; 40];
        let tree = grow_tree(n, &picks, &lens);
        let m = path_matrix(&tree);
        let res = build_tree(&m, Method::Nj, BuildOptions { trace: true }).unwrap();
        let Some(Trace::Nj { steps, final_join }) = res.trace else {
            panic!("n={n}: trace missing")
        };
        assert_eq!(steps.len(), n - 3, "n={n}: expected n-3 join steps");
        assert!(
            final_join.la.is_finite() && final_join.lb.is_finite() && final_join.lc.is_finite(),
            "n={n}: final_join must be present"
        );
    }
}

// --- additive recovery -----------------------------------------------------

/// Grow a random unrooted binary tree by repeatedly joining two pool
/// members under a new internal node, then joining the last three under a
/// central root. Leaves are `NodeId(0..n)` with labels `t0..t{n-1}`.
fn grow_tree(n: usize, picks: &[(u32, u32)], lens: &[f64]) -> Tree {
    let mut tree = Tree::new();
    let mut pool: Vec<NodeId> = (0..n)
        .map(|i| tree.add_node(Some(format!("t{i}"))))
        .collect();
    let mut li = 0usize;
    for &(p0, p1) in picks.iter().take(n - 3) {
        let size = pool.len();
        let i = p0 as usize % size;
        let mut j = p1 as usize % (size - 1);
        if j >= i {
            j += 1;
        }
        let (i, j) = (i.min(j), i.max(j));
        let u = tree.add_node(None);
        tree.attach(u, pool[i], Some(lens[li]));
        li += 1;
        tree.attach(u, pool[j], Some(lens[li]));
        li += 1;
        pool.remove(j);
        pool.remove(i);
        pool.push(u);
    }
    let root = tree.add_node(None);
    for c in pool.iter().take(3) {
        tree.attach(root, *c, Some(lens[li]));
        li += 1;
    }
    tree.set_root(root);
    tree
}

/// Distances from `start` to every node, walking parent and child links.
fn distances_from(tree: &Tree, start: NodeId) -> Vec<f64> {
    let mut dist = vec![f64::NAN; tree.nodes.len()];
    dist[start.0 as usize] = 0.0;
    let mut stack = vec![start];
    while let Some(id) = stack.pop() {
        let i = id.0 as usize;
        let d = dist[i];
        if let Some(p) = tree.nodes[i].parent {
            let pi = p.0 as usize;
            if dist[pi].is_nan() {
                dist[pi] = d + tree.branch_length(id).unwrap_or(0.0);
                stack.push(p);
            }
        }
        for &c in &tree.nodes[i].children {
            let ci = c.0 as usize;
            if dist[ci].is_nan() {
                dist[ci] = d + tree.branch_length(c).unwrap_or(0.0);
                stack.push(c);
            }
        }
    }
    dist
}

/// Path-length distance matrix over the leaves of `tree`, wrapped as a
/// `DistanceMatrix` whose labels are the leaf labels in id order.
fn path_matrix(tree: &Tree) -> DistanceMatrix {
    let leaves: Vec<NodeId> = (0..tree.nodes.len())
        .map(|i| NodeId(i as u32))
        .filter(|&id| tree.is_leaf(id))
        .collect();
    let labels: Vec<String> = leaves
        .iter()
        .map(|id| tree.nodes[id.0 as usize].label.clone().unwrap_or_default())
        .collect();
    let n = leaves.len();
    let mut m = Matrix::zeros(n);
    for (i, &a) in leaves.iter().enumerate() {
        let dist = distances_from(tree, a);
        for (j, &b) in leaves.iter().enumerate().skip(i + 1) {
            let v = dist[b.0 as usize];
            m.set(i, j, v);
            m.set(j, i, v);
        }
    }
    DistanceMatrix::from_values(labels, &m)
}

fn collect_leaves(tree: &Tree, id: NodeId, out: &mut BTreeSet<String>) {
    let i = id.0 as usize;
    if tree.is_leaf(id) {
        if let Some(label) = &tree.nodes[i].label {
            out.insert(label.clone());
        }
        return;
    }
    for &c in &tree.nodes[i].children {
        collect_leaves(tree, c, out);
    }
}

/// Map each edge to its canonical split side (the side that does NOT
/// contain the lexicographically smallest label) and its branch length.
/// The root has no edge, so non-root nodes enumerate the edges.
fn edge_splits(tree: &Tree) -> BTreeMap<Vec<String>, f64> {
    let all: BTreeSet<String> = (0..tree.nodes.len())
        .map(|i| NodeId(i as u32))
        .filter(|&id| tree.is_leaf(id))
        .filter_map(|id| tree.nodes[id.0 as usize].label.clone())
        .collect();
    let min_label = all.iter().next().cloned().unwrap_or_default();
    let mut map = BTreeMap::new();
    for i in 0..tree.nodes.len() {
        let id = NodeId(i as u32);
        if id == tree.root {
            continue;
        }
        let mut under = BTreeSet::new();
        collect_leaves(tree, id, &mut under);
        if under.is_empty() {
            continue;
        }
        let side: Vec<String> = if under.contains(&min_label) {
            all.difference(&under).cloned().collect()
        } else {
            under.into_iter().collect()
        };
        map.insert(side, tree.branch_length(id).unwrap_or(f64::NAN));
    }
    map
}

fn arb_additive() -> impl Strategy<Value = (Tree, DistanceMatrix)> {
    (4usize..=20).prop_flat_map(|n| {
        // n-3 pair joins (2 picks + 2 lengths each) plus 3 root lengths:
        // at most 17 joins and 37 lengths for n = 20.
        (
            prop::collection::vec((any::<u32>(), any::<u32>()), 17),
            prop::collection::vec(0.01f64..1.0, 40),
        )
            .prop_map(move |(picks, lens)| {
                let tree = grow_tree(n, &picks, &lens);
                let dm = path_matrix(&tree);
                (tree, dm)
            })
    })
}

proptest! {
    #[test]
    fn additive_recovery((truth, m) in arb_additive()) {
        let res = build_tree(&m, Method::Nj, BuildOptions { trace: false }).unwrap();
        prop_assert!(!res.tree.rooted);
        let want = edge_splits(&truth);
        let got = edge_splits(&res.tree);
        prop_assert_eq!(
            got.keys().collect::<Vec<_>>(),
            want.keys().collect::<Vec<_>>()
        );
        for (split, want_len) in &want {
            let got_len = got[split];
            prop_assert!(
                (got_len - want_len).abs() <= 1e-9,
                "split {split:?}: got {got_len}, want {want_len}"
            );
        }
    }
}
