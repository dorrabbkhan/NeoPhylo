use neophylo_core::compare::{rf, Split};
use neophylo_core::error::NeoError;
use neophylo_core::newick::parse_newick;
use neophylo_core::tree::{NodeId, Tree};
use proptest::prelude::*;

fn split(side: &[&str]) -> Split {
    Split {
        side: side.iter().map(|s| s.to_string()).collect(),
    }
}

#[test]
fn identical() {
    let a = parse_newick("((A,B),C,(D,E));").unwrap();
    let b = parse_newick("((A,B),C,(D,E));").unwrap();
    let res = rf(&a, &b).unwrap();
    assert_eq!(res.rf, 0);
    assert_eq!(res.max_rf, 4);
    assert_eq!(res.normalized, 0.0);
    assert!(res.missing_in_inferred.is_empty());
    assert!(res.extra_in_inferred.is_empty());
}

#[test]
fn one_nni() {
    // Truth splits {A,B}|{C,D,E} and {D,E}|{A,B,C}; inferred has
    // {A,C}|{B,D,E} and {D,E}|{A,B,C}. Canonical sides contain the
    // smallest label "A".
    let truth = parse_newick("((A,B),C,(D,E));").unwrap();
    let inferred = parse_newick("((A,C),B,(D,E));").unwrap();
    let res = rf(&truth, &inferred).unwrap();
    assert_eq!(res.rf, 2);
    assert_eq!(res.max_rf, 4);
    assert_eq!(res.normalized, 0.5);
    assert_eq!(res.missing_in_inferred, vec![split(&["A", "B"])]);
    assert_eq!(res.extra_in_inferred, vec![split(&["A", "C"])]);
}

#[test]
fn rooted_vs_unrooted_same() {
    // A rooted tree is treated as unrooted: the degree-2 root of
    // ((A,B),(C,D)) is suppressed, giving the same bipartition
    // {A,B}|{C,D} as (A,B,(C,D)).
    let rooted = parse_newick("((A,B),(C,D));").unwrap();
    let unrooted = parse_newick("(A,B,(C,D));").unwrap();
    let res = rf(&rooted, &unrooted).unwrap();
    assert!(rooted.rooted);
    assert!(!unrooted.rooted);
    assert_eq!(res.rf, 0);
    assert_eq!(res.max_rf, 2);
    assert!(res.missing_in_inferred.is_empty());
    assert!(res.extra_in_inferred.is_empty());
}

#[test]
fn label_mismatch() {
    let truth = parse_newick("((A,B),C,(D,E));").unwrap();
    let inferred = parse_newick("((A,B),C,(D,F));").unwrap();
    let err = rf(&truth, &inferred).unwrap_err();
    assert_eq!(
        err,
        NeoError::LabelMismatch {
            only_in_a: vec!["E".to_string()],
            only_in_b: vec!["F".to_string()],
        }
    );
}

// --- random trees -----------------------------------------------------------

/// Grow a random binary tree over leaves t0..t{n-1}. `rooted_form` joins
/// the last two pool members under a degree-2 root (the rooted shape);
/// otherwise the last three join under a central unrooted root.
fn grow_tree(n: usize, picks: &[(u32, u32)], rooted_form: bool) -> Tree {
    let mut tree = Tree::new();
    let mut pool: Vec<NodeId> = (0..n)
        .map(|i| tree.add_node(Some(format!("t{i}"))))
        .collect();
    let joins = if rooted_form { n - 2 } else { n - 3 };
    for &(p0, p1) in picks.iter().take(joins) {
        let size = pool.len();
        let i = p0 as usize % size;
        let mut j = p1 as usize % (size - 1);
        if j >= i {
            j += 1;
        }
        let (i, j) = (i.min(j), i.max(j));
        let u = tree.add_node(None);
        tree.attach(u, pool[i], Some(0.1));
        tree.attach(u, pool[j], Some(0.1));
        pool.remove(j);
        pool.remove(i);
        pool.push(u);
    }
    let root = tree.add_node(None);
    for &c in &pool {
        tree.attach(root, c, Some(0.1));
    }
    tree.set_root(root);
    tree.rooted = rooted_form;
    tree
}

fn arb_pair() -> impl Strategy<Value = (Tree, Tree)> {
    (3usize..=12).prop_flat_map(|n| {
        (
            prop::collection::vec((any::<u32>(), any::<u32>()), n - 2),
            prop::collection::vec((any::<u32>(), any::<u32>()), n - 2),
            any::<bool>(),
            any::<bool>(),
        )
            .prop_map(move |(p1, p2, r1, r2)| (grow_tree(n, &p1, r1), grow_tree(n, &p2, r2)))
    })
}

proptest! {
    #[test]
    fn prop_symmetric((a, b) in arb_pair()) {
        let ab = rf(&a, &b).unwrap();
        let ba = rf(&b, &a).unwrap();
        prop_assert_eq!(ab.rf, ba.rf);
        prop_assert_eq!(ab.missing_in_inferred, ba.extra_in_inferred);
        prop_assert_eq!(ab.extra_in_inferred, ba.missing_in_inferred);
        let aa = rf(&a, &a).unwrap();
        prop_assert_eq!(aa.rf, 0);
        prop_assert_eq!(aa.normalized, 0.0);
        prop_assert!(aa.missing_in_inferred.is_empty());
        prop_assert!(aa.extra_in_inferred.is_empty());
        let n = aa.max_rf as usize / 2 + 3;
        prop_assert!(aa.rf <= aa.max_rf, "rf {} > max_rf {}", aa.rf, aa.max_rf);
        prop_assert_eq!(n >= 3, true);
    }
}
