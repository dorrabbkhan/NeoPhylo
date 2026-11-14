//! `DistanceInput` property tests (v1.4c spec §5.6): NJ recovers the
//! splits and branch lengths of a random binary tree from its
//! `additive_matrix`, UPGMA recovers a random ultrametric tree's
//! clusters and heights, and `to_distance_matrix` is symmetric with a
//! zero diagonal. New file, new functions — saved `cc` seeds of the
//! existing strategies stay valid.

use std::collections::{BTreeMap, BTreeSet};

use neophylo_core::algos::{build_tree, BuildOptions, Method, Trace};
use neophylo_core::dist::{Cell, DistModel};
use neophylo_core::matrix_input::{additive_matrix, DistanceInput};
use neophylo_core::tree::{NodeId, Tree};
use proptest::prelude::*;

// --- random binary trees (as tests/nj.rs, but through additive_matrix) ---

/// Grow a random unrooted binary tree by repeatedly joining two pool
/// members under a new internal node, then joining the last three under
/// a central root. Leaves are `NodeId(0..n)` with labels `t0..t{n-1}`.
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

fn arb_binary_input() -> impl Strategy<Value = (Tree, DistanceInput)> {
    (4usize..=12).prop_flat_map(|n| {
        // n-3 pair joins (2 picks + 2 lengths each) plus 3 root
        // lengths: at most 9 joins and 21 lengths for n = 12.
        (
            prop::collection::vec((any::<u32>(), any::<u32>()), 9),
            prop::collection::vec(0.01f64..1.0, 21),
        )
            .prop_map(move |(picks, lens)| {
                let tree = grow_tree(n, &picks, &lens);
                let input = additive_matrix(&tree, None).unwrap();
                (tree, input)
            })
    })
}

// --- random ultrametric trees (as tests/upgma.rs) -----------------------

/// Grow a random rooted ultrametric tree by repeatedly joining two pool
/// members under a new node whose height exceeds both parents'.
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

/// Height of `id` above its leaves: branch length plus child height
/// along the first child (all children agree on an ultrametric tree).
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

fn arb_ultrametric_input() -> impl Strategy<Value = (Tree, DistanceInput)> {
    (4usize..=12).prop_flat_map(|n| {
        // n-1 merges: at most 11 picks and 11 height jitters for n = 12.
        (
            prop::collection::vec((any::<u32>(), any::<u32>()), 11),
            prop::collection::vec(0.05f64..1.5, 11),
        )
            .prop_map(move |(picks, jitters)| {
                let tree = grow_ultrametric(n, &picks, &jitters);
                let input = additive_matrix(&tree, None).unwrap();
                (tree, input)
            })
    })
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn nj_recovers_splits_and_lengths((truth, input) in arb_binary_input()) {
        let m = input.to_distance_matrix().unwrap();
        prop_assert_eq!(m.model, DistModel::Supplied);
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

    #[test]
    fn upgma_recovers_ultrametric((truth, input) in arb_ultrametric_input()) {
        let m = input.to_distance_matrix().unwrap();
        let res = build_tree(&m, Method::Upgma, BuildOptions { trace: true }).unwrap();
        // A random tree whose additive matrix has an exact UPGMA tie
        // (two pairs at equal distance) is filtered out: either choice
        // is correct, so only the tie-free cases are asserted.
        let Some(Trace::Upgma { steps }) = &res.trace else {
            panic!("trace missing")
        };
        prop_assume!(steps.iter().all(|s| !s.tie));
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

    #[test]
    fn to_distance_matrix_symmetric_zero_diagonal(
        (n, lower) in (3usize..=12).prop_flat_map(|n| {
            (Just(n), prop::collection::vec(0.0f64..100.0, n * (n - 1) / 2))
        })
    ) {
        let input = DistanceInput {
            names: (0..n).map(|i| format!("t{i}")).collect(),
            lower,
        };
        let m = input.to_distance_matrix().unwrap();
        prop_assert_eq!(m.model, DistModel::Supplied);
        prop_assert_eq!(&m.labels, &input.names);
        for i in 0..n {
            prop_assert_eq!(m.cells[i * n + i], Cell::Value(0.0));
            prop_assert_eq!(input.get(i, i), 0.0);
            for j in 0..n {
                prop_assert_eq!(m.cells[i * n + j], m.cells[j * n + i]);
                if i != j {
                    let Cell::Value(v) = m.cells[i * n + j] else {
                        panic!("matrix input produces only Cell::Value")
                    };
                    prop_assert_eq!(v, input.get(i, j));
                    prop_assert_eq!(input.get(i, j), input.get(j, i));
                }
            }
        }
    }
}
