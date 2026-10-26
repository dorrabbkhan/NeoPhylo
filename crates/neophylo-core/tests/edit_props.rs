//! Property test for tree editing (v1.4 plan Task 5, spec §5.1): random
//! sequences of edit operations on random valid binary trees. After every
//! `Ok`, `validate_editable` holds and the leaf-label multiset equals the
//! leaf set of `parse_newick(write_newick(tree))`; after every `Err`, the
//! tree is bit-for-bit unchanged.

use neophylo_core::edit::{detach, join, move_subtree, rename_leaf, set_length, validate_editable};
use neophylo_core::newick::{parse_newick, write_newick};
use neophylo_core::tree::{NodeId, Tree};
use neophylo_core::NeoError;
use proptest::prelude::*;

/// Grow a random rooted binary tree by repeatedly joining two pool
/// members under a new internal node; the last node is the root. Leaves
/// are `NodeId(0..n)` labelled `t0..t{n-1}`; every edge has a `Some`
/// length from `lens` (all ≥ 0 by construction of the strategy).
fn grow_tree(n: usize, picks: &[u32], lens: &[f64]) -> Tree {
    let mut tree = Tree::new();
    let mut pool: Vec<NodeId> = (0..n)
        .map(|i| tree.add_node(Some(format!("t{i}"))))
        .collect();
    let mut li = 0usize;
    let mut pi = 0usize;
    while pool.len() > 1 {
        let size = pool.len();
        let i = picks[pi % picks.len()] as usize % size;
        pi += 1;
        let mut j = picks[pi % picks.len()] as usize % (size - 1);
        pi += 1;
        if j >= i {
            j += 1;
        }
        let (i, j) = (i.min(j), i.max(j));
        // Some internal nodes carry a label: a spliced-out labelled
        // parent must not keep it, or the husk could graft back as a
        // phantom taxon.
        let u = tree.add_node(None);
        if picks[pi % picks.len()].is_multiple_of(3) {
            tree.nodes[u.0 as usize].label = Some(format!("i{}", u.0));
        }
        pi += 1;
        tree.attach(u, pool[i], Some(lens[li % lens.len()]));
        li += 1;
        tree.attach(u, pool[j], Some(lens[li % lens.len()]));
        li += 1;
        pool.remove(j);
        pool.remove(i);
        pool.push(u);
    }
    tree.set_root(pool[0]);
    tree.rooted = true;
    tree
}

/// Leaf labels of the component reachable from `tree.root`, sorted.
fn leaf_labels_sorted(tree: &Tree) -> Vec<String> {
    let mut v: Vec<String> = tree
        .preorder()
        .into_iter()
        .filter(|&id| tree.is_leaf(id))
        .map(|id| tree.nodes[id.0 as usize].label.clone().unwrap_or_default())
        .collect();
    v.sort();
    v
}

/// All leaves in the arena (any component).
fn all_leaves(tree: &Tree) -> Vec<NodeId> {
    (0..tree.nodes.len())
        .filter(|&i| tree.nodes[i].children.is_empty())
        .map(|i| NodeId(i as u32))
        .collect()
}

/// All parentless nodes in the arena (component roots).
fn component_roots(tree: &Tree) -> Vec<NodeId> {
    (0..tree.nodes.len())
        .filter(|&i| tree.nodes[i].parent.is_none())
        .map(|i| NodeId(i as u32))
        .collect()
}

proptest! {
    /// Random op sequences on random valid trees (4-12 leaves). Op kinds:
    /// 0,6 detach; 1,7 move; 2 join two component roots; 3 join a fresh
    /// leaf; 4 set_length; 5 rename (a third of renames reuse an existing
    /// leaf label to hit the duplicate refusal). Length arguments range
    /// over -1..3 so invalid values occur.
    #[test]
    fn op_sequence_preserves_validity(
        n in 4usize..=12,
        picks in proptest::collection::vec(any::<u32>(), 24),
        lens in proptest::collection::vec(0.0f64..2.0, 40),
        ops in proptest::collection::vec(
            (0u8..8, any::<u32>(), any::<u32>(), -1.0f64..3.0, -1.0f64..3.0),
            0..24,
        ),
    ) {
        let mut tree = grow_tree(n, &picks, &lens);
        let mut join_seq = 0usize;
        let mut rename_seq = 0usize;

        for (kind, a, b, l0, l1) in ops {
            let len = tree.nodes.len();
            let pick = |v: u32| NodeId((v as usize % len) as u32);

            let (before, res): (Tree, Result<(), NeoError>) = match kind {
                0 | 6 => {
                    let node = pick(a);
                    let before = tree.clone();
                    (before, detach(&mut tree, node))
                }
                1 | 7 => {
                    let (node, x) = (pick(a), pick(b));
                    let before = tree.clone();
                    (before, move_subtree(&mut tree, node, x, (l0, l1)))
                }
                2 => {
                    let roots = component_roots(&tree);
                    let (x, y) = if roots.len() >= 2 {
                        let i = a as usize % roots.len();
                        let mut j = b as usize % (roots.len() - 1);
                        if j >= i {
                            j += 1;
                        }
                        (roots[i], roots[j])
                    } else {
                        (pick(a), pick(b))
                    };
                    let before = tree.clone();
                    (before, join(&mut tree, x, y, (l0, l1)).map(|_| ()))
                }
                3 => {
                    let leaf = tree.add_node(Some(format!("j{join_seq}")));
                    join_seq += 1;
                    let roots = component_roots(&tree);
                    let others: Vec<NodeId> =
                        roots.into_iter().filter(|&r| r != leaf).collect();
                    let other = if others.is_empty() {
                        pick(b)
                    } else {
                        others[b as usize % others.len()]
                    };
                    let before = tree.clone();
                    (before, join(&mut tree, leaf, other, (l0, l1)).map(|_| ()))
                }
                4 => {
                    let node = pick(a);
                    let before = tree.clone();
                    (before, set_length(&mut tree, node, l0))
                }
                _ => {
                    let leaves = all_leaves(&tree);
                    let leaf = leaves[a as usize % leaves.len()];
                    let name = if b % 3 == 0 {
                        let other = leaves[b as usize % leaves.len()];
                        tree.nodes[other.0 as usize]
                            .label
                            .clone()
                            .unwrap_or_default()
                    } else {
                        rename_seq += 1;
                        format!("r{rename_seq}")
                    };
                    let before = tree.clone();
                    (before, rename_leaf(&mut tree, leaf, &name))
                }
            };

            match res {
                Ok(()) => {
                    prop_assert!(
                        validate_editable(&tree).is_ok(),
                        "validate_editable failed after Ok op {kind}: {:?}; newick: {}",
                        validate_editable(&tree).unwrap_err(),
                        write_newick(&tree),
                    );
                    let mut via_newick = parse_newick(&write_newick(&tree))
                        .unwrap()
                        .leaf_labels();
                    via_newick.sort();
                    prop_assert_eq!(
                        leaf_labels_sorted(&tree),
                        via_newick,
                        "leaf multiset mismatch after Ok op {}",
                        kind
                    );
                }
                Err(_) => {
                    prop_assert_eq!(
                        &tree, &before,
                        "tree changed on refused op {}",
                        kind
                    );
                }
            }
        }
    }
}
