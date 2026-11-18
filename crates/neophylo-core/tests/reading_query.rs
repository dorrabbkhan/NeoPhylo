//! Unit tests for the tree-reading queries (v1.4d spec §5.2, plan Task 3).
//! Every test is pinned in the plan; the polytomy and cross-lineage cases
//! carry Review Focus lines 1 and 3.

use std::collections::BTreeMap;

use neophylo_core::newick::parse_newick;
use neophylo_core::reading::query::{
    clade_key, closer, count_clades, find_clade, is_ancestor, is_clade, mrca, order_consistent,
    outside_tips, restrict, same_relationships, sister_tips, CladeKey, Closer,
};
use neophylo_core::reading::traits::{change_count, origins_shared, tip_states, Change, Mark};
use neophylo_core::NeoError;

fn tree(newick: &str) -> neophylo_core::Tree {
    parse_newick(newick).expect("test newick parses")
}

fn key(tips: &[&str]) -> CladeKey {
    let mut k: Vec<String> = tips.iter().map(|s| s.to_string()).collect();
    k.sort();
    k
}

fn mark(on: &[&str], trait_name: &str, change: Change) -> Mark {
    Mark {
        on: key(on),
        trait_name: trait_name.to_string(),
        change,
    }
}

#[test]
fn mrca_of_sisters_is_parent() {
    let t = tree("((a,b),(c,d));");
    let m = mrca(&t, &["a".into(), "b".into()]).unwrap();
    assert_eq!(clade_key(&t, m), key(&["a", "b"]));
    // A single tip's MRCA is the tip itself.
    let m = mrca(&t, &["c".into()]).unwrap();
    assert!(t.is_leaf(m));
    assert_eq!(clade_key(&t, m), key(&["c"]));
}

#[test]
fn mrca_unknown_tip_names_field() {
    let t = tree("((a,b),(c,d));");
    let err = mrca(&t, &["a".into(), "zz".into()]).unwrap_err();
    match err {
        NeoError::InvalidReading { item, field, msg } => {
            assert_eq!(item, "");
            assert_eq!(field, "tips");
            assert!(msg.contains("zz"), "msg names the bad tip: {msg}");
        }
        other => panic!("expected InvalidReading, got {other:?}"),
    }
}

#[test]
fn is_clade_true_and_false() {
    let t = tree("((a,b),(c,d));");
    assert!(is_clade(&t, &["a".into(), "b".into()]).unwrap());
    assert!(!is_clade(&t, &["a".into(), "c".into()]).unwrap());
    // The full tip set is a clade (the root); a single tip is one too.
    assert!(is_clade(&t, &["a".into(), "b".into(), "c".into(), "d".into()]).unwrap());
    assert!(is_clade(&t, &["b".into()]).unwrap());
    let err = is_clade(&t, &["a".into(), "zz".into()]).unwrap_err();
    assert!(matches!(err, NeoError::InvalidReading { .. }));
}

#[test]
fn sister_tips_in_polytomy() {
    // Review Focus 1: every other child's tips of the polytomy parent.
    let t = tree("((a,b,c),d);");
    assert_eq!(sister_tips(&t, "a").unwrap(), key(&["b", "c"]));
    assert_eq!(sister_tips(&t, "d").unwrap(), key(&["a", "b", "c"]));
    let t = tree("((a,b),(c,d));");
    assert_eq!(sister_tips(&t, "a").unwrap(), key(&["b"]));
}

#[test]
fn closer_equal_in_polytomy() {
    let t = tree("((a,b,c),d);");
    assert_eq!(closer(&t, "a", "b", "c").unwrap(), Closer::Equal);
    let t = tree("((a,b),(c,d));");
    assert_eq!(closer(&t, "a", "c", "d").unwrap(), Closer::Equal);
}

#[test]
fn closer_trap_adjacent_tip() {
    // Tip adjacency is not relatedness: b's closest relative is a wherever
    // the children are drawn.
    for newick in ["((a,b),(c,d));", "((c,d),(b,a));", "((d,c),(a,b));"] {
        let t = tree(newick);
        assert_eq!(closer(&t, "b", "a", "c").unwrap(), Closer::B, "{newick}");
        assert_eq!(closer(&t, "d", "c", "a").unwrap(), Closer::B, "{newick}");
        assert_eq!(closer(&t, "a", "c", "b").unwrap(), Closer::C, "{newick}");
    }
}

#[test]
fn same_relationships_ignores_rotation() {
    let a = tree("((a,b),(c,d));");
    for newick in ["((d,c),(b,a));", "((b,a),(c,d));", "((a,b),(d,c));"] {
        assert!(same_relationships(&a, &tree(newick)).unwrap(), "{newick}");
    }
    assert!(!same_relationships(&a, &tree("((a,c),(b,d));")).unwrap());
    let err = same_relationships(&a, &tree("((a,b),(c,e));")).unwrap_err();
    assert!(matches!(err, NeoError::InvalidReading { .. }));
}

#[test]
fn polytomy_differs_from_resolved() {
    let poly = tree("(a,(b,c,d),e);");
    for newick in ["(a,((b,c),d),e);", "(a,(b,(c,d)),e);", "(a,((b,d),c),e);"] {
        assert!(
            !same_relationships(&poly, &tree(newick)).unwrap(),
            "{newick}"
        );
    }
}

#[test]
fn restrict_suppresses_unary() {
    let t = tree("(((a,b),c),(d,e));");
    let r = restrict(&t, &["a".into(), "b".into(), "d".into()]).unwrap();
    assert!(same_relationships(&r, &tree("((a,b),d);")).unwrap());
    // Pruning to a pair keeps just the cherry.
    let r = restrict(&t, &["a".into(), "b".into()]).unwrap();
    assert!(same_relationships(&r, &tree("(a,b);")).unwrap());
    let err = restrict(&t, &["a".into(), "zz".into()]).unwrap_err();
    assert!(matches!(err, NeoError::InvalidReading { .. }));
}

#[test]
fn order_without_ages_accepts_cross_lineage() {
    // Review Focus 3: nodes on different lineages order either way.
    let t = tree("((a,b),(c,d));");
    let p = find_clade(&t, &key(&["a", "b"])).unwrap();
    let q = find_clade(&t, &key(&["c", "d"])).unwrap();
    let r = find_clade(&t, &key(&["a", "b", "c", "d"])).unwrap();
    assert!(order_consistent(&t, &[p, q], None));
    assert!(order_consistent(&t, &[q, p], None));
    assert!(order_consistent(&t, &[r, q, p], None));
    assert!(order_consistent(&t, &[r, p, q], None));
}

#[test]
fn order_rejects_descendant_first() {
    let t = tree("((a,b),(c,d));");
    let p = find_clade(&t, &key(&["a", "b"])).unwrap();
    let q = find_clade(&t, &key(&["c", "d"])).unwrap();
    let r = find_clade(&t, &key(&["a", "b", "c", "d"])).unwrap();
    assert!(!order_consistent(&t, &[p, r], None));
    assert!(!order_consistent(&t, &[p, r, q], None));
    assert!(!order_consistent(&t, &[q, p, r], None));
    assert!(is_ancestor(&t, r, p));
    assert!(!is_ancestor(&t, p, r));
    assert!(!is_ancestor(&t, p, p));
}

#[test]
fn order_with_ages_unique() {
    let t = tree("((a,b),(c,d));");
    let p = find_clade(&t, &key(&["a", "b"])).unwrap();
    let q = find_clade(&t, &key(&["c", "d"])).unwrap();
    let r = find_clade(&t, &key(&["a", "b", "c", "d"])).unwrap();
    let ages: BTreeMap<CladeKey, f64> = [
        (key(&["a", "b", "c", "d"]), 10.0),
        (key(&["a", "b"]), 5.0),
        (key(&["c", "d"]), 3.0),
    ]
    .into_iter()
    .collect();
    let mut accepted = 0;
    for perm in [
        [r, p, q],
        [r, q, p],
        [p, r, q],
        [p, q, r],
        [q, r, p],
        [q, p, r],
    ] {
        if order_consistent(&t, &perm, Some(&ages)) {
            accepted += 1;
            assert_eq!(perm, [r, p, q], "only the by-age order is accepted");
        }
    }
    assert_eq!(accepted, 1);
    // A node with no recorded age makes the order unverifiable.
    let partial: BTreeMap<CladeKey, f64> =
        [(key(&["a", "b", "c", "d"]), 10.0)].into_iter().collect();
    assert!(!order_consistent(&t, &[r, p], Some(&partial)));
}

#[test]
fn count_clades_includes_root() {
    assert_eq!(count_clades(&tree("((a,b),(c,d));")), 3);
    assert_eq!(count_clades(&tree("((a,b,c),d);")), 2);
    assert_eq!(count_clades(&tree("(a,b,c);")), 1);
    assert_eq!(count_clades(&tree("((a,(b,(c,(d,e)))),(f,g));")), 6);
}

#[test]
fn outside_tips_of_root_child() {
    let t = tree("((a,b),(c,d));");
    assert_eq!(outside_tips(&t, "a").unwrap(), key(&["c", "d"]));
    assert_eq!(outside_tips(&t, "c").unwrap(), key(&["a", "b"]));
    let t = tree("((a,(b,c)),d);");
    assert_eq!(outside_tips(&t, "b").unwrap(), key(&["d"]));
}

#[test]
fn find_clade_hits_leaves_and_root() {
    let t = tree("((a,b),(c,d));");
    let tip = find_clade(&t, &key(&["a"])).unwrap();
    assert!(t.is_leaf(tip));
    assert_eq!(find_clade(&t, &key(&["a", "b", "c", "d"])), Some(t.root));
    assert_eq!(find_clade(&t, &key(&["a", "c"])), None);
    assert_eq!(find_clade(&t, &key(&["zz"])), None);
}

#[test]
fn tip_states_gain_then_loss() {
    let t = tree("((a,b),(c,d));");
    let marks = [
        mark(&["a", "b"], "T", Change::Gain),
        mark(&["a"], "T", Change::Loss),
    ];
    let st = tip_states(&t, &marks, "T").unwrap();
    let want: BTreeMap<String, bool> = [("a", false), ("b", true), ("c", false), ("d", false)]
        .into_iter()
        .map(|(k, v)| (k.to_string(), v))
        .collect();
    assert_eq!(st, want);
    assert_eq!(change_count(&marks, "T"), 2);
    assert_eq!(change_count(&marks, "U"), 0);
}

#[test]
fn convergent_origins_not_shared() {
    let t = tree("((a,b),(c,d));");
    // Two disjoint gains: a/b share one origin, a and c do not.
    let marks = [
        mark(&["a", "b"], "T", Change::Gain),
        mark(&["c"], "T", Change::Gain),
    ];
    assert!(origins_shared(&t, &marks, "T", "a", "b").unwrap());
    assert!(!origins_shared(&t, &marks, "T", "a", "c").unwrap());
    // A loss covering both tips is not a shared origin.
    let marks = [mark(&["a", "b"], "T", Change::Loss)];
    assert!(!origins_shared(&t, &marks, "T", "a", "b").unwrap());
    let err = origins_shared(&t, &marks, "T", "a", "zz").unwrap_err();
    assert!(matches!(err, NeoError::InvalidReading { .. }));
}
