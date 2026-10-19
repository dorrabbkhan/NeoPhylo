//! Support values on the original tree (v1.2 spec §3.4): exact
//! agreement with the fixture `prop_clades` counts, `None` on terminal
//! branches, `0.0` for groupings absent from the tally, serde
//! backward compatibility for the new `BranchAttrs.support` field, and
//! spec §3.7's shown-once rule at an unrooted degree-2 root.

use neophylo_core::algos::Method;
use neophylo_core::bootstrap::{support_on_tree, tree_splits, BootstrapTally, Split};
use neophylo_core::newick::parse_newick;
use neophylo_core::tree::{BranchAttrs, Tree};
use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::PathBuf;

fn fixtures_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../fixtures/consensus")
}

#[derive(Deserialize)]
struct PropClade {
    labels: Vec<String>,
    count: u32,
}

#[derive(Deserialize)]
struct ConsensusFixture {
    name: String,
    rooted: bool,
    labels: Vec<String>,
    trees: Vec<String>,
    reference: String,
    prop_clades: Vec<PropClade>,
}

fn load(rel: &std::path::Path) -> ConsensusFixture {
    serde_json::from_str(&fs::read_to_string(rel).unwrap()).unwrap()
}

/// Tally a fixed list of trees the way a bootstrap run would: each
/// tree contributes each grouping once (spec §3.3 dedup rule), and
/// every tree counts as a successful replicate.
fn tally_of(fix: &ConsensusFixture) -> BootstrapTally {
    let method = if fix.rooted {
        Method::Upgma
    } else {
        Method::Nj
    };
    let mut counts: BTreeMap<Split, u32> = BTreeMap::new();
    for text in &fix.trees {
        let t = parse_newick(text).unwrap();
        let seen: BTreeSet<Split> = tree_splits(&t, &fix.labels, fix.rooted)
            .into_iter()
            .map(|(_, s)| s)
            .collect();
        for s in seen {
            *counts.entry(s).or_insert(0) += 1;
        }
    }
    BootstrapTally {
        method,
        labels: fix.labels.clone(),
        successful: fix.trees.len() as u32,
        failed: 0,
        counts,
    }
}

/// The grouping a `prop_clades` entry names, as a canonical `Split`.
/// Unrooted entries name one side of a bipartition; canonical form is
/// the side not containing taxon 0, so complement when needed.
fn prop_split(fix: &ConsensusFixture, pc: &PropClade) -> Split {
    let ix_of = |l: &str| {
        fix.labels
            .iter()
            .position(|x| x == l)
            .unwrap_or_else(|| panic!("{}: prop_clades names unknown label '{l}'", fix.name))
    };
    let mut ix: Vec<usize> = pc.labels.iter().map(|l| ix_of(l)).collect();
    if !fix.rooted && ix.contains(&0) {
        ix = (0..fix.labels.len()).filter(|i| !ix.contains(i)).collect();
    }
    Split::from_indices(&ix)
}

#[test]
fn prop_clades_exact() {
    let mut files: Vec<PathBuf> = fs::read_dir(fixtures_dir())
        .unwrap()
        .map(|e| e.unwrap().path())
        .filter(|p| p.extension().is_some_and(|e| e == "json"))
        .collect();
    files.sort();
    assert!(!files.is_empty(), "no consensus fixtures found");

    for path in files {
        let fix = load(&path);
        let tally = tally_of(&fix);
        let reference = parse_newick(&fix.reference).unwrap();
        let with_support = support_on_tree(&reference, &tally);

        // prop.clades lists every grouping of the reference tree.
        let expected: BTreeMap<Split, u32> = fix
            .prop_clades
            .iter()
            .map(|pc| (prop_split(&fix, pc), pc.count))
            .collect();
        let branches = tree_splits(&with_support, &fix.labels, fix.rooted);
        assert_eq!(
            expected.len(),
            branches.len(),
            "{}: prop_clades has {} groupings but the reference has {}",
            fix.name,
            expected.len(),
            branches.len()
        );

        for (id, split) in &branches {
            let count = expected
                .get(split)
                .unwrap_or_else(|| panic!("{}: reference grouping not in prop_clades", fix.name));
            let support = with_support.branches[id.0 as usize].support;
            // Exact: support is count / successful computed in f64.
            assert_eq!(
                support,
                Some(*count as f64 / tally.successful as f64),
                "{}: grouping {:?} support",
                fix.name,
                split.labels(&fix.labels)
            );
            assert!(
                (support.unwrap() * tally.successful as f64 - *count as f64).abs() < 1e-9,
                "{}: support x successful != count",
                fix.name
            );
        }
    }
}

/// Leaf node indices under `id`, sorted (DFS).
fn leaves_under(tree: &Tree, id: usize) -> Vec<usize> {
    let mut out = Vec::new();
    let mut stack = vec![id];
    while let Some(i) = stack.pop() {
        let n = &tree.nodes[i];
        if n.children.is_empty() {
            out.push(i);
        } else {
            stack.extend(n.children.iter().map(|c| c.0 as usize));
        }
    }
    out.sort_unstable();
    out
}

/// The internal node index whose subtree's leaf set is exactly
/// `leaf_ix`.
fn node_with_leaves(tree: &Tree, leaf_ix: &[usize]) -> usize {
    let mut want = leaf_ix.to_vec();
    want.sort_unstable();
    (0..tree.nodes.len())
        .find(|&i| !tree.nodes[i].children.is_empty() && leaves_under(tree, i) == want)
        .expect("no internal node with that leaf set")
}

#[test]
fn degree2_root_support_once() {
    // ((a,b),(c,d)) unrooted: both root edges induce the same canonical
    // split {c,d}, but spec §3.7 shows it once — the edge whose subtree
    // is the canonical side {c,d} carries the value, the {a,b} edge
    // stays None, and so do all leaves and the root itself.
    let tree = parse_newick("((a,b),(c,d));").unwrap();
    let labels: Vec<String> = ["a", "b", "c", "d"].iter().map(|s| s.to_string()).collect();
    let mut counts = BTreeMap::new();
    counts.insert(Split::from_indices(&[2, 3]), 7u32);
    let tally = BootstrapTally {
        method: Method::Nj,
        labels,
        successful: 10,
        failed: 0,
        counts,
    };
    let with = support_on_tree(&tree, &tally);
    for (i, node) in with.nodes.iter().enumerate() {
        let support = with.branches[i].support;
        if node.children.is_empty() {
            assert_eq!(support, None, "leaf {i} must not carry support");
        }
        if node.parent.is_none() {
            assert_eq!(support, None, "the root has no branch above it");
        }
    }
    let canonical_edge = node_with_leaves(&with, &[2, 3]);
    let other_edge = node_with_leaves(&with, &[0, 1]);
    assert_eq!(
        with.branches[canonical_edge].support,
        Some(0.7),
        "the canonical-side root edge carries the split's support"
    );
    assert_eq!(
        with.branches[other_edge].support, None,
        "the complementary root edge is None (split shown once)"
    );
    // Exactly one internal branch carries a value.
    let set: Vec<f64> = with
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| n.parent.is_some() && !n.children.is_empty())
        .filter_map(|(i, _)| with.branches[i].support)
        .collect();
    assert_eq!(set, vec![0.7]);
}

#[test]
fn absent_is_zero() {
    // ((a,b),c,d) unrooted: the (a,b) edge is the only branch inducing
    // split {c,d} — its subtree holds taxon 0, yet it keeps the value
    // because no second edge shows the split. That grouping is absent
    // from the tally: the branch reports 0.0, not None and not an error.
    let tree = parse_newick("((a,b),c,d);").unwrap();
    let labels: Vec<String> = ["a", "b", "c", "d"].iter().map(|s| s.to_string()).collect();
    let mut counts = BTreeMap::new();
    counts.insert(Split::from_indices(&[1, 3]), 9u32); // {b,d}, not the reference split
    let tally = BootstrapTally {
        method: Method::Nj,
        labels,
        successful: 10,
        failed: 0,
        counts,
    };
    let with = support_on_tree(&tree, &tally);
    let only_edge = node_with_leaves(&with, &[0, 1]);
    assert_eq!(
        with.branches[only_edge].support,
        Some(0.0),
        "internal branch absent from the tally"
    );
    for (i, node) in with.nodes.iter().enumerate() {
        if node.children.is_empty() || node.parent.is_none() {
            assert_eq!(with.branches[i].support, None, "no branch above node {i}");
        }
    }
}

#[test]
fn serde_default() {
    // A v1.1 BranchAttrs JSON without `support` deserializes to None.
    let b: BranchAttrs = serde_json::from_str(r#"{"length": 0.5}"#).unwrap();
    assert_eq!(b.length, Some(0.5));
    assert_eq!(b.support, None);

    // A whole v1.1 Tree JSON round-trips with every support None.
    let json = r#"{
        "nodes": [
            {"parent": 1, "children": [], "label": "a"},
            {"parent": null, "children": [0], "label": null}
        ],
        "branches": [{"length": 0.1}, {"length": null}],
        "root": 1,
        "rooted": true
    }"#;
    let tree: Tree = serde_json::from_str(json).unwrap();
    assert!(tree.branches.iter().all(|b| b.support.is_none()));

    // ... and support_on_tree leaves the original untouched.
    let labels = vec!["a".to_string()];
    let tally = BootstrapTally {
        method: Method::Nj,
        labels,
        successful: 4,
        failed: 0,
        counts: BTreeMap::new(),
    };
    let with = support_on_tree(&tree, &tally);
    assert!(with.branches.iter().all(|b| b.support.is_none()));
    assert!(tree.branches.iter().all(|b| b.support.is_none()));
}
