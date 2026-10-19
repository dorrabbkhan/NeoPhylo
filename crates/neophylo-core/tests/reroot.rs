//! Display rerooting on the reference outgroup (v1.2 spec §3.7):
//! outgroup choice, midpoint placement, support shown once on the
//! ingroup-side edge, the not-a-group fallback, negative lengths and a
//! property test over random unrooted trees.

use neophylo_core::bootstrap::{tree_splits, Split};
use neophylo_core::newick::parse_newick;
use neophylo_core::reroot::{reference_outgroup, reroot_on_outgroup};
use neophylo_core::tree::{NodeId, Tree};
use neophylo_core::{load_exercise, NeoError};
use proptest::prelude::*;
use std::collections::{BTreeMap, BTreeSet};

/// Leaf node indices under `id` (DFS, cycle-guarded).
fn leaf_set(tree: &Tree, id: usize) -> BTreeSet<usize> {
    let mut out = BTreeSet::new();
    let mut seen = vec![false; tree.nodes.len()];
    let mut stack = vec![id];
    while let Some(i) = stack.pop() {
        if i >= tree.nodes.len() || seen[i] {
            continue;
        }
        seen[i] = true;
        let n = &tree.nodes[i];
        if n.children.is_empty() {
            out.insert(i);
        } else {
            stack.extend(n.children.iter().map(|c| c.0 as usize));
        }
    }
    out
}

/// Grow a random unrooted binary tree by repeatedly joining two pool
/// members under a new internal node, then joining the last three under
/// a central root. Leaves are `NodeId(0..n)` with labels `t0..t{n-1}`.
/// (Same generator shape as tests/nj.rs.)
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

/// Sum of `Some` branch lengths.
fn total_length(tree: &Tree) -> f64 {
    tree.branches.iter().filter_map(|b| b.length).sum()
}

/// Canonical unrooted groupings of `tree` (leaf-index sets over the
/// `t0..t{n-1}` label order).
fn groupings(tree: &Tree, labels: &[String]) -> BTreeSet<Split> {
    tree_splits(tree, labels, false)
        .into_iter()
        .map(|(_, s)| s)
        .collect()
}

#[test]
fn cytochrome_outgroup() {
    let ex = load_exercise(include_str!("../../../exercises/cytochrome-c.json")).unwrap();
    let reference = parse_newick(&ex.reference.unwrap().newick).unwrap();
    assert_eq!(
        reference_outgroup(&reference),
        vec!["wheat".to_string()],
        "the smaller root child subtree is the outgroup"
    );
}

#[test]
fn midpoint() {
    // The outgroup split's branch (length 0.4) becomes two edges of 0.2.
    let tree = parse_newick("((a,b):0.4,(c,d):0.4,(e,f):0.4);").unwrap();
    let res = reroot_on_outgroup(&tree, &["a".to_string(), "b".to_string()]).unwrap();
    assert!(res.outgroup_is_group);
    let root = res.tree.root.0 as usize;
    let children = &res.tree.nodes[root].children;
    assert_eq!(children.len(), 2, "a display root is binary");
    for &c in children {
        assert_eq!(
            res.tree.branches[c.0 as usize].length,
            Some(0.2),
            "each new root edge is half of the split branch"
        );
    }
    // One side is the outgroup {a,b}; the other holds the rest.
    let sides: Vec<BTreeSet<usize>> = children
        .iter()
        .map(|c| leaf_set(&res.tree, c.0 as usize))
        .collect();
    assert!(sides.iter().any(|s| *s == BTreeSet::from([0, 1])));
    assert!(sides.iter().any(|s| *s == BTreeSet::from([2, 3, 4, 5])));
}

#[test]
fn not_a_group() {
    // Outgroup {a,c} is no edge's bipartition: root falls back to the
    // midpoint of the alphabetically first outgroup taxon's terminal
    // branch (a's, length 0.4 -> two halves of 0.2).
    let tree = parse_newick("((a:0.4,b:0.3):0.2,(c:0.1,d:0.2):0.2);").unwrap();
    let res = reroot_on_outgroup(&tree, &["a".to_string(), "c".to_string()]).unwrap();
    assert!(!res.outgroup_is_group);
    let root = res.tree.root.0 as usize;
    let children = &res.tree.nodes[root].children;
    assert_eq!(children.len(), 2);
    assert_eq!(children[0], NodeId(0), "rooted next to 'a'");
    assert_eq!(res.tree.branches[0].length, Some(0.2));
    assert_eq!(res.tree.branches[children[1].0 as usize].length, Some(0.2));
    assert!(res.tree.is_leaf(children[0]));
}

#[test]
fn negative_branch() {
    // A negative-length outgroup branch splits into two halves of the
    // same sign; nothing panics.
    let tree = parse_newick("((a,b):-0.4,(c,d):0.1,(e,f):0.1);").unwrap();
    let res = reroot_on_outgroup(&tree, &["a".to_string(), "b".to_string()]).unwrap();
    assert!(res.outgroup_is_group);
    let root = res.tree.root.0 as usize;
    for &c in &res.tree.nodes[root].children {
        assert_eq!(res.tree.branches[c.0 as usize].length, Some(-0.2));
    }
}

#[test]
fn unknown_labels() {
    let tree = parse_newick("((a,b),(c,d));").unwrap();
    let err = reroot_on_outgroup(&tree, &["a".to_string(), "zz".to_string()]).unwrap_err();
    assert_eq!(
        err,
        NeoError::LabelMismatch {
            only_in_a: Vec::new(),
            only_in_b: vec!["zz".to_string()]
        }
    );
}

proptest! {
    /// Random unrooted trees (5-20 leaves) with random lengths and
    /// supports, rerooted on a random leaf or on a random split's side:
    /// the grouping set is unchanged, each grouping's support appears
    /// exactly once with the same value, and total length is preserved.
    #[test]
    fn property_support_follows_grouping(
        n in 5usize..=20,
        picks in proptest::collection::vec((any::<u32>(), any::<u32>()), 17),
        lens in proptest::collection::vec(-1.0f64..2.0, 40),
        sups in proptest::collection::vec(0.0f64..=1.0, 20),
        pick_leaf in any::<bool>(),
        complement in any::<bool>(),
        which in any::<usize>(),
    ) {
        let labels: Vec<String> = (0..n).map(|i| format!("t{i}")).collect();
        let mut tree = grow_tree(n, &picks, &lens);
        // Random support on every internal branch (grouping edges only).
        let mut si = 0usize;
        for i in 0..tree.nodes.len() {
            if i == tree.root.0 as usize || tree.nodes[i].children.is_empty() {
                continue;
            }
            tree.branches[i].support = Some(sups[si % sups.len()]);
            si += 1;
        }

        let outgroup: Vec<String> = if pick_leaf {
            vec![labels[which % n].clone()]
        } else {
            let splits = tree_splits(&tree, &labels, false);
            let (_, s) = &splits[which % splits.len()];
            if complement {
                // The side containing taxon 0.
                (0..n)
                    .filter(|i| !s.contains(*i))
                    .map(|i| labels[i].clone())
                    .collect()
            } else {
                s.labels(&labels)
            }
        };
        let res = reroot_on_outgroup(&tree, &outgroup).unwrap();
        prop_assert!(res.outgroup_is_group, "leaf and split-side outgroups are groups");

        // The set of unrooted groupings is unchanged.
        let before = groupings(&tree, &labels);
        let after = groupings(&res.tree, &labels);
        prop_assert_eq!(&before, &after, "rerooting changed the groupings");

        // Each grouping's support appears exactly once, unchanged: the
        // split edge is halved but only the ingroup-side root edge keeps
        // the value (spec §3.7).
        let want: BTreeMap<Split, f64> = tree_splits(&tree, &labels, false)
            .into_iter()
            .map(|(id, s)| (s, tree.branches[id.0 as usize].support.unwrap()))
            .collect();
        let mut got: BTreeMap<Split, Vec<Option<f64>>> = BTreeMap::new();
        for (id, s) in tree_splits(&res.tree, &labels, false) {
            got.entry(s)
                .or_default()
                .push(res.tree.branches[id.0 as usize].support);
        }
        for (s, vals) in &got {
            let somes: Vec<f64> = vals.iter().flatten().copied().collect();
            prop_assert!(
                somes == vec![want[s]],
                "support for {:?} moved or duplicated",
                s
            );
        }

        // Total branch length is unchanged.
        prop_assert!((total_length(&res.tree) - total_length(&tree)).abs() < 1e-12);
    }
}
