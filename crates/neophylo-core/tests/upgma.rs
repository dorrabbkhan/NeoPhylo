//! UPGMA tests (spec §4.5).
//!
//! `wikipedia5_steps` checks every trace field against the hand-verified
//! worked example in `fixtures/worked/upgma_wikipedia5.json`.
//! `ultrametric_recovery` checks that UPGMA reconstructs random ultrametric
//! trees from their path-length matrices.

use std::collections::{BTreeMap, BTreeSet};

use neophylo_core::algos::{build_tree, BuildOptions, Method, Trace, UpgmaStep};
use neophylo_core::dist::DistanceMatrix;
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

fn assert_step(got: &UpgmaStep, want: &UpgmaStep) {
    assert_eq!(got.step, want.step);
    assert_eq!(got.active, want.active);
    assert_matrix_close(&got.distance, &want.distance);
    assert_eq!(got.sizes, want.sizes);
    assert_eq!(got.chosen, want.chosen);
    assert_eq!(got.tie, want.tie);
    assert_close(got.height, want.height);
    assert_close(got.len_i, want.len_i);
    assert_close(got.len_j, want.len_j);
    assert_eq!(got.new_node, want.new_node);
    assert_vec_close(&got.new_row, &want.new_row);
}

#[derive(Deserialize)]
struct WorkedUpgma {
    labels: Vec<String>,
    matrix: Matrix,
    steps: Vec<UpgmaStep>,
}

fn worked() -> WorkedUpgma {
    let json = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/worked/upgma_wikipedia5.json"
    ));
    serde_json::from_str(json).unwrap()
}

#[test]
fn wikipedia5_steps() {
    let worked = worked();
    let input = DistanceMatrix::from_values(worked.labels, &worked.matrix);
    let res = build_tree(&input, Method::Upgma, BuildOptions { trace: true }).unwrap();
    let Some(Trace::Upgma { steps }) = res.trace else {
        panic!("trace missing")
    };
    assert_eq!(steps.len(), worked.steps.len());
    for (got, want) in steps.iter().zip(&worked.steps) {
        assert_step(got, want);
    }
    // The join heights of the worked example are pinned.
    for (got, want) in steps.iter().zip([8.5, 11.0, 14.0, 16.5]) {
        assert_close(got.height, want);
    }
    // Rooted output; the root is the last merge (spec §4.5, Node IDs).
    assert!(res.tree.rooted);
    assert_eq!(res.tree.root, steps.last().unwrap().new_node);
}

#[test]
fn size_weighted() {
    // In the join that merges e with {a,b}, the new row to c is the
    // size-weighted mean (2 * 25.5 + 39) / 3 = 30, not the plain mean.
    let worked = worked();
    let input = DistanceMatrix::from_values(worked.labels, &worked.matrix);
    let res = build_tree(&input, Method::Upgma, BuildOptions { trace: true }).unwrap();
    let Some(Trace::Upgma { steps }) = res.trace else {
        panic!("trace missing")
    };
    assert_close(steps[1].new_row[0], (2.0 * 25.5 + 39.0) / 3.0);
    assert_close(steps[1].new_row[0], 30.0);
}

#[test]
fn tie_rule() {
    // Every off-diagonal distance is 1, so every pair ties and the lowest
    // (i, j) in lexicographic order wins.
    let m = dm(
        &["a", "b", "c", "d"],
        &[
            0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0, 1.0, 1.0, 1.0, 1.0, 0.0,
        ],
    );
    let res = build_tree(&m, Method::Upgma, BuildOptions { trace: true }).unwrap();
    let Some(Trace::Upgma { steps }) = res.trace else {
        panic!("trace missing")
    };
    assert_eq!(steps[0].chosen, (0, 1));
    assert!(steps[0].tie);
}

// --- ultrametric recovery --------------------------------------------------

/// Grow a random rooted ultrametric tree by repeatedly joining two pool
/// members under a new node whose height exceeds both parents'. Merge
/// heights rise with merge index, so all internal heights are distinct and
/// no ties can occur in the distance matrix.
fn grow_ultrametric(n: usize, picks: &[(u32, u32)], jitters: &[f64]) -> Tree {
    let mut tree = Tree::new();
    let mut pool: Vec<NodeId> = (0..n)
        .map(|i| tree.add_node(Some(format!("t{i}"))))
        .collect();
    let mut heights: Vec<f64> = vec![0.0; n];
    for (k, &(p0, p1)) in picks.iter().take(n - 1).enumerate() {
        let h = 2.0 * k as f64 + jitters[k];
        let size = pool.len();
        let i = p0 as usize % size;
        let mut j = p1 as usize % (size - 1);
        if j >= i {
            j += 1;
        }
        let (i, j) = (i.min(j), i.max(j));
        let u = tree.add_node(None);
        tree.attach(u, pool[i], Some(h - heights[i]));
        tree.attach(u, pool[j], Some(h - heights[j]));
        pool.remove(j);
        pool.remove(i);
        pool.push(u);
        heights.remove(j);
        heights.remove(i);
        heights.push(h);
    }
    tree.set_root(pool[0]);
    tree.rooted = true;
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

/// Path-length distance matrix over the leaves of `tree`.
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

/// Height of `id` above its leaves: branch length plus child height along
/// the first child (all children agree on an ultrametric tree).
fn height_of(tree: &Tree, id: NodeId) -> f64 {
    match tree.nodes[id.0 as usize].children.first() {
        None => 0.0,
        Some(&c) => tree.branch_length(c).unwrap_or(0.0) + height_of(tree, c),
    }
}

/// Map each internal node's leaf set to its height above the leaves.
fn cluster_heights(tree: &Tree) -> BTreeMap<Vec<String>, f64> {
    let mut map = BTreeMap::new();
    for i in 0..tree.nodes.len() {
        let id = NodeId(i as u32);
        if tree.is_leaf(id) {
            continue;
        }
        let mut under = BTreeSet::new();
        collect_leaves(tree, id, &mut under);
        map.insert(under.into_iter().collect(), height_of(tree, id));
    }
    map
}

fn arb_ultrametric() -> impl Strategy<Value = (Tree, DistanceMatrix)> {
    (4usize..=20).prop_flat_map(|n| {
        // n-1 merges; at most 19 picks and 19 height jitters for n = 20.
        (
            prop::collection::vec((any::<u32>(), any::<u32>()), 19),
            prop::collection::vec(0.05f64..1.5, 19),
        )
            .prop_map(move |(picks, jitters)| {
                let tree = grow_ultrametric(n, &picks, &jitters);
                let dm = path_matrix(&tree);
                (tree, dm)
            })
    })
}

proptest! {
    #[test]
    fn ultrametric_recovery((truth, m) in arb_ultrametric()) {
        let res = build_tree(&m, Method::Upgma, BuildOptions { trace: false }).unwrap();
        prop_assert!(res.tree.rooted);
        let want = cluster_heights(&truth);
        let got = cluster_heights(&res.tree);
        prop_assert_eq!(
            got.keys().collect::<Vec<_>>(),
            want.keys().collect::<Vec<_>>()
        );
        for (cluster, want_h) in &want {
            let got_h = got[cluster];
            prop_assert!(
                (got_h - want_h).abs() <= 1e-9,
                "cluster {cluster:?}: got {got_h}, want {want_h}"
            );
        }
    }
}
