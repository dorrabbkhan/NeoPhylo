use neophylo_core::error::NeoError;
use neophylo_core::newick::{parse_newick, write_newick, write_newick_with_support};
use neophylo_core::tree::{NodeId, Tree};
use proptest::prelude::*;

#[test]
fn roundtrip_simple() {
    let s = "((A:0.1,B:0.2):0.05,C:0.3,D:0.4);";
    let t = parse_newick(s).unwrap();
    assert_eq!(write_newick(&t), s);
}

#[test]
fn quoted_labels() {
    let s = "('Homo sapiens':1,'O''Brien':2,'<b>x</b>':3);";
    let t = parse_newick(s).unwrap();
    assert_eq!(t.leaf_labels(), ["Homo sapiens", "O'Brien", "<b>x</b>"]);
    assert_eq!(write_newick(&t), s);
}

#[test]
fn comments_ignored() {
    let t = parse_newick("(A[&x=1]:1,B:2,C:3);").unwrap();
    assert_eq!(t.leaf_labels(), ["A", "B", "C"]);
}

#[test]
fn rooted_flag() {
    assert!(parse_newick("(A,B);").unwrap().rooted);
    assert!(!parse_newick("(A,B,C);").unwrap().rooted);
}

#[test]
fn malformed() {
    match parse_newick("(A,B").unwrap_err() {
        NeoError::Parse { line, col, .. } => {
            assert_eq!((line, col), (1, 5));
        }
        other => panic!("expected Parse, got {other:?}"),
    }
    match parse_newick("(A,B));").unwrap_err() {
        NeoError::Parse { .. } => {}
        other => panic!("expected Parse, got {other:?}"),
    }
}

/// Structural equality of two trees: same rooted flag, and matching
/// labels/children/lengths along the rooted topology. Lengths are compared
/// after Rust's `{}` f64 formatting, which is what `write_newick` emits.
fn trees_equal(a: &Tree, b: &Tree) -> bool {
    if a.rooted != b.rooted {
        return false;
    }
    fn cmp(a: &Tree, b: &Tree, x: NodeId, y: NodeId) -> bool {
        let (nx, ny) = (&a.nodes[x.0 as usize], &b.nodes[y.0 as usize]);
        if nx.label != ny.label || nx.children.len() != ny.children.len() {
            return false;
        }
        let len_ok = match (a.branch_length(x), b.branch_length(y)) {
            (None, None) => true,
            (Some(v), Some(w)) => format!("{v}").parse::<f64>() == Ok(w),
            _ => false,
        };
        len_ok
            && nx
                .children
                .iter()
                .zip(ny.children.iter())
                .all(|(&c, &d)| cmp(a, b, c, d))
    }
    cmp(a, b, a.root, b.root)
}

/// A random binary tree: `n` leaves (ids 0..n in input order) joined by
/// randomly paired internal nodes until 2 (rooted) or 3 (unrooted) subtrees
/// remain under a final root.
fn arb_tree() -> impl Strategy<Value = Tree> {
    (3usize..=30, any::<bool>()).prop_flat_map(|(n, rooted)| {
        (
            prop::collection::vec(
                prop::string::string_regex("[A-Za-z0-9 _']{1,12}").unwrap(),
                n,
            ),
            prop::collection::vec(0.0f64..=2.0, 2 * n),
            prop::collection::vec(0usize..1024, n),
        )
            .prop_map(move |(labels, lengths, draws)| {
                let mut t = Tree::new();
                let mut pending: Vec<NodeId> =
                    labels.into_iter().map(|l| t.add_node(Some(l))).collect();
                let (mut li, mut di) = (0usize, 0usize);
                let stop = if rooted { 2 } else { 3 };
                while pending.len() > stop {
                    let a = pending.remove(draws[di % draws.len()] % pending.len());
                    di += 1;
                    let b = pending.remove(draws[di % draws.len()] % pending.len());
                    di += 1;
                    let u = t.add_node(None);
                    t.attach(u, a, Some(lengths[li % lengths.len()]));
                    li += 1;
                    t.attach(u, b, Some(lengths[li % lengths.len()]));
                    li += 1;
                    pending.push(u);
                }
                let root = t.add_node(None);
                for c in pending {
                    t.attach(root, c, Some(lengths[li % lengths.len()]));
                    li += 1;
                }
                t.set_root(root);
                t.rooted = rooted;
                t
            })
    })
}

proptest! {
    #[test]
    fn prop_roundtrip(t in arb_tree()) {
        let s = write_newick(&t);
        let t2 = parse_newick(&s).unwrap_or_else(|e| panic!("parse of {s} failed: {e}"));
        prop_assert!(trees_equal(&t, &t2), "round-trip mismatch for {s}");
    }
}

/// The Review Focus 4 tree: quoted taxa plus support on both internal
/// branches (the root carries none). Internal non-root ids follow the
/// document order of their `(`.
fn support_tree() -> Tree {
    let mut t = parse_newick(
        "(('Homo sapiens':0.1,'O''Brien':0.15):0.05,\
         ('Rattus norvegicus':0.1,'Gallus gallus':0.3):0.04,\
         'Triticum aestivum':0.4);",
    )
    .unwrap();
    let internal: Vec<usize> = (0..t.nodes.len())
        .filter(|&i| !t.nodes[i].children.is_empty() && t.nodes[i].parent.is_some())
        .collect();
    assert_eq!(internal.len(), 2);
    t.branches[internal[0]].support = Some(0.87);
    t.branches[internal[1]].support = Some(0.425);
    t
}

#[test]
fn write_support_labels() {
    let t = support_tree();
    assert_eq!(
        write_newick_with_support(&t),
        "(('Homo sapiens':0.1,'O''Brien':0.15)87:0.05,\
('Rattus norvegicus':0.1,'Gallus gallus':0.3)43:0.04,\
'Triticum aestivum':0.4);"
    );
}

#[test]
fn write_newick_ignores_support() {
    // The plain writer is unchanged (v1.2 spec §6.8): support never
    // appears, so existing exports and fixtures keep their bytes.
    assert_eq!(
        write_newick(&support_tree()),
        "(('Homo sapiens':0.1,'O''Brien':0.15):0.05,\
('Rattus norvegicus':0.1,'Gallus gallus':0.3):0.04,\
'Triticum aestivum':0.4);"
    );
}

#[test]
fn support_labels_reparse() {
    // Review Focus 4: labels and integer supports survive a round
    // trip through our own parser (they come back as node labels).
    let t = support_tree();
    let t2 = parse_newick(&write_newick_with_support(&t)).unwrap();
    assert_eq!(
        t2.leaf_labels(),
        [
            "Homo sapiens",
            "O'Brien",
            "Rattus norvegicus",
            "Gallus gallus",
            "Triticum aestivum"
        ]
    );
    let mut labels: Vec<&str> = t2
        .nodes
        .iter()
        .enumerate()
        .filter(|(i, n)| !n.children.is_empty() && n.parent.is_some() && *i != t2.root.0 as usize)
        .map(|(_, n)| n.label.as_deref().unwrap())
        .collect();
    labels.sort();
    assert_eq!(labels, ["43", "87"]);
}

#[test]
fn support_overrides_internal_label() {
    // spec §6.8: the internal node label IS the integer percent, so
    // ape/figtree read it as the bootstrap value. Nodes without
    // support keep their existing label.
    let mut t = parse_newick("((A:1,B:1)u1:0.5,(C:1,D:1)u2:0.5,E:1);").unwrap();
    let internal: Vec<usize> = (0..t.nodes.len())
        .filter(|&i| !t.nodes[i].children.is_empty() && t.nodes[i].parent.is_some())
        .collect();
    assert_eq!(internal.len(), 2);
    t.branches[internal[0]].support = Some(0.5);
    // A leaf carrying support (which the engine never produces) keeps
    // its taxon name — support labels mark internal groupings only.
    let leaf_e = t
        .nodes
        .iter()
        .position(|n| n.label.as_deref() == Some("E"))
        .unwrap();
    t.branches[leaf_e].support = Some(0.5);
    assert_eq!(
        write_newick_with_support(&t),
        "((A:1,B:1)50:0.5,(C:1,D:1)u2:0.5,E:1);"
    );
}
