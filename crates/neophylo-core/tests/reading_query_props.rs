//! Property tests for the tree-reading queries (v1.4d spec §5.5, plan
//! Task 3): `mrca`, `is_clade` and `same_relationships` agree with
//! brute-force versions on random rooted trees with polytomies (3–12
//! tips); every answer is unchanged after shuffling every node's
//! children; and the set of orders `order_consistent` accepts equals all
//! linear extensions of the ancestry order (brute force, ≤ 7 internal
//! nodes). New functions and strategies only.

use std::collections::BTreeSet;

use neophylo_core::reading::query::{
    clade_key, count_clades, is_clade, mrca, order_consistent, rooted_clades, same_relationships,
};
use neophylo_core::tree::{NodeId, Tree};
use proptest::prelude::*;

/// Grow a random rooted tree from a two-tip root: each further tip either
/// attaches to a random internal node (possibly widening a polytomy) or a
/// new internal node is inserted on a random edge and the tip hangs there.
/// Every internal node keeps ≥ 2 children, so no unary nodes appear.
fn grow(n: usize, picks: &[u32]) -> Tree {
    let mut t = Tree::new();
    let mut pi = 0usize;
    let mut pick = |m: usize| -> usize {
        let v = picks[pi % picks.len()] as usize % m;
        pi += 1;
        v
    };
    let root = t.add_node(None);
    for i in 0..2 {
        let leaf = t.add_node(Some(format!("t{}", i + 1)));
        t.attach(root, leaf, None);
    }
    for i in 2..n {
        let leaf = t.add_node(Some(format!("t{}", i + 1)));
        if pick(2) == 0 {
            let targets: Vec<NodeId> = (0..t.nodes.len() as u32)
                .map(NodeId)
                .filter(|&id| !t.nodes[id.0 as usize].children.is_empty())
                .collect();
            let target = targets[pick(targets.len())];
            t.attach(target, leaf, None);
        } else {
            let mut edges = Vec::new();
            for (i, node) in t.nodes.iter().enumerate() {
                for &c in &node.children {
                    edges.push((NodeId(i as u32), c));
                }
            }
            let (p, c) = edges[pick(edges.len())];
            let mid = t.add_node(None);
            let pos = t.nodes[p.0 as usize]
                .children
                .iter()
                .position(|&x| x == c)
                .expect("edge listed from children");
            t.nodes[p.0 as usize].children[pos] = mid;
            t.nodes[mid.0 as usize].parent = Some(p);
            t.attach(mid, c, None);
            t.attach(mid, leaf, None);
        }
    }
    t.set_root(root);
    t.rooted = true;
    t
}

fn arb_tree() -> impl Strategy<Value = Tree> {
    (3usize..=12, proptest::collection::vec(any::<u32>(), 64))
        .prop_map(|(n, picks)| grow(n, &picks))
}

/// Smaller trees (≤ 7 internal nodes) for the exhaustive-order check.
fn arb_small_tree() -> impl Strategy<Value = Tree> {
    (3usize..=8, proptest::collection::vec(any::<u32>(), 64)).prop_map(|(n, picks)| grow(n, &picks))
}

/// A random nonempty tip subset of up to 4 labels.
fn tip_subset(tree: &Tree, picks: &[u32]) -> Vec<String> {
    let labels = tree.leaf_labels();
    let k = 1 + picks[0] as usize % labels.len().min(4);
    let mut out: Vec<String> = Vec::new();
    let mut pi = 1usize;
    while out.len() < k && pi < picks.len() {
        let l = labels[picks[pi] as usize % labels.len()].clone();
        if !out.contains(&l) {
            out.push(l);
        }
        pi += 1;
    }
    out.sort();
    out
}

/// Copy of `tree` with every node's children randomly permuted.
fn shuffled(tree: &Tree, picks: &[u32]) -> Tree {
    let mut t = tree.clone();
    let mut pi = 0usize;
    for node in t.nodes.iter_mut() {
        for i in (1..node.children.len()).rev() {
            let j = picks[pi % picks.len()] as usize % (i + 1);
            pi += 1;
            node.children.swap(i, j);
        }
    }
    t
}

/// Tip labels under `id` by plain DFS — independent of the module under
/// test.
fn tips_of(tree: &Tree, id: NodeId) -> BTreeSet<String> {
    let mut out = BTreeSet::new();
    let mut seen = vec![false; tree.nodes.len()];
    let mut stack = vec![id];
    while let Some(nid) = stack.pop() {
        let i = nid.0 as usize;
        if i >= tree.nodes.len() || seen[i] {
            continue;
        }
        seen[i] = true;
        let n = &tree.nodes[i];
        if n.children.is_empty() {
            if let Some(l) = &n.label {
                out.insert(l.clone());
            }
        } else {
            stack.extend(n.children.iter().copied());
        }
    }
    out
}

/// Brute-force MRCA: the node with the smallest tip set containing every
/// requested tip.
fn brute_mrca(tree: &Tree, tips: &[String]) -> BTreeSet<String> {
    let want: BTreeSet<&String> = tips.iter().collect();
    let mut best: Option<BTreeSet<String>> = None;
    for id in tree.preorder() {
        let s = tips_of(tree, id);
        if want.iter().all(|t| s.contains(*t)) && best.as_ref().is_none_or(|b| s.len() < b.len()) {
            best = Some(s);
        }
    }
    best.expect("the root contains every tip")
}

/// Brute-force clade test: S is a clade iff it equals the tip set of the
/// smallest node containing it (the MRCA characterization — a proper
/// subset of a polytomy is not a clade).
fn brute_is_clade(tree: &Tree, tips: &BTreeSet<String>) -> bool {
    if tips.is_empty() {
        return false;
    }
    let mut best: Option<BTreeSet<String>> = None;
    for id in tree.preorder() {
        let s = tips_of(tree, id);
        if s.is_superset(tips) && best.as_ref().is_none_or(|b| s.len() < b.len()) {
            best = Some(s);
        }
    }
    best.is_some_and(|b| b == *tips)
}

/// Canonical bracket form — children canon strings sorted — so two rooted
/// trees are equal iff their canon strings match.
fn canon(tree: &Tree, id: NodeId) -> String {
    let n = &tree.nodes[id.0 as usize];
    if n.children.is_empty() {
        return n.label.clone().unwrap_or_default();
    }
    let mut cs: Vec<String> = n.children.iter().map(|&c| canon(tree, c)).collect();
    cs.sort();
    format!("({})", cs.concat())
}

/// Brute-force order check: `order` is a linear extension of the ancestry
/// order iff every pair is sorted ancestor-first, ancestry read off
/// tip-set containment (proper superset = proper ancestor).
fn is_linear_extension(tree: &Tree, order: &[NodeId]) -> bool {
    let keys: Vec<BTreeSet<String>> = order.iter().map(|&id| tips_of(tree, id)).collect();
    for i in 0..order.len() {
        for j in i + 1..order.len() {
            if keys[i].len() < keys[j].len() && keys[i].is_subset(&keys[j]) {
                return false;
            }
        }
    }
    true
}

fn permutations(nodes: &[NodeId]) -> Vec<Vec<NodeId>> {
    if nodes.len() <= 1 {
        return vec![nodes.to_vec()];
    }
    let mut out = Vec::new();
    for (i, &x) in nodes.iter().enumerate() {
        let mut rest = nodes.to_vec();
        rest.remove(i);
        for mut p in permutations(&rest) {
            p.insert(0, x);
            out.push(p);
        }
    }
    out
}

proptest! {
    #![proptest_config(ProptestConfig::with_cases(64))]

    #[test]
    fn mrca_eq_bruteforce(
        t in arb_tree(),
        picks in proptest::collection::vec(any::<u32>(), 32),
    ) {
        let tips = tip_subset(&t, &picks);
        let got = clade_key(&t, mrca(&t, &tips).unwrap());
        let want: Vec<String> = brute_mrca(&t, &tips).into_iter().collect();
        prop_assert_eq!(got, want);
    }

    #[test]
    fn is_clade_eq_bruteforce(
        t in arb_tree(),
        picks in proptest::collection::vec(any::<u32>(), 32),
    ) {
        let tips = tip_subset(&t, &picks);
        let set: BTreeSet<String> = tips.iter().cloned().collect();
        prop_assert_eq!(is_clade(&t, &tips).unwrap(), brute_is_clade(&t, &set));
    }

    #[test]
    fn same_relationships_eq_canon(a in arb_tree(), b in arb_tree()) {
        let sa: BTreeSet<String> = a.leaf_labels().into_iter().collect();
        let sb: BTreeSet<String> = b.leaf_labels().into_iter().collect();
        let res = same_relationships(&a, &b);
        if sa == sb {
            prop_assert_eq!(res.unwrap(), canon(&a, a.root) == canon(&b, b.root));
        } else {
            prop_assert!(res.is_err(), "different tip sets must be refused");
        }
    }

    #[test]
    fn answers_rotation_invariant(
        t in arb_tree(),
        picks in proptest::collection::vec(any::<u32>(), 64),
    ) {
        let s = shuffled(&t, &picks);
        let tips = tip_subset(&t, &picks);
        prop_assert_eq!(rooted_clades(&t), rooted_clades(&s));
        prop_assert_eq!(count_clades(&t), count_clades(&s));
        prop_assert_eq!(
            clade_key(&t, mrca(&t, &tips).unwrap()),
            clade_key(&s, mrca(&s, &tips).unwrap())
        );
        prop_assert_eq!(is_clade(&t, &tips).unwrap(), is_clade(&s, &tips).unwrap());
        prop_assert!(same_relationships(&t, &s).unwrap());
    }

    #[test]
    fn order_accepted_set_eq_linear_extensions(t in arb_small_tree()) {
        let internals: Vec<NodeId> = t
            .preorder()
            .into_iter()
            .filter(|&id| !t.nodes[id.0 as usize].children.is_empty())
            .collect();
        prop_assume!(internals.len() <= 7);
        for perm in permutations(&internals) {
            prop_assert_eq!(
                order_consistent(&t, &perm, None),
                is_linear_extension(&t, &perm),
                "order {:?} disagrees",
                perm
            );
        }
    }
}
