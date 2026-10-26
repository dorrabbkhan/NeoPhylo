//! Engine tree editing operations (v1.4 plan Task 5, spec §5.1): every
//! refusal returns `NeoError::InvalidEdit` and leaves the tree bit-for-bit
//! unchanged; happy paths are checked by exact Newick output.
//!
//! Node ids in parsed trees: leaves are `NodeId(0..n)` in document order,
//! internal nodes follow in preorder (newick.rs), so in
//! `((a,b),(c,d));` the root is 4, `(a,b)` is 5 and `(c,d)` is 6.

use neophylo_core::edit::{detach, join, move_subtree, rename_leaf, set_length, validate_editable};
use neophylo_core::newick::{parse_newick, write_newick};
use neophylo_core::tree::{NodeId, Tree};
use neophylo_core::NeoError;

/// `(a:0.125,b:0.25):0.5,(c:0.5,d:0.25):0.5` under root 4; `(a,b)` = 5,
/// `(c,d)` = 6. Lengths are powers of two so Newick writes stay exact.
fn four_taxon() -> Tree {
    parse_newick("((a:0.125,b:0.25):0.5,(c:0.5,d:0.25):0.5);").unwrap()
}

// ---- happy paths ---------------------------------------------------------

#[test]
fn join_makes_new_root() {
    let mut tree = parse_newick("(a:0.25,b:0.5);").unwrap(); // root = 2
    let c = tree.add_node(Some("c".to_string())); // 3, parentless
    let u = join(&mut tree, NodeId(2), c, (0.125, 0.375)).unwrap();
    assert_eq!(u, NodeId(4));
    assert_eq!(tree.root, u, "the joined root moves under the new node");
    assert_eq!(write_newick(&tree), "((a:0.25,b:0.5):0.125,c:0.375);");
    assert!(tree.rooted, "a binary join root is a rooted tree");
    validate_editable(&tree).unwrap();
}

#[test]
fn detach_leaves_parentless_component() {
    let mut tree = parse_newick("((a:0.1,b:0.2):0.3,c:0.4,d:0.5);").unwrap();
    // root = 4, (a,b) = 5.
    detach(&mut tree, NodeId(5)).unwrap();
    assert_eq!(write_newick(&tree), "(c:0.4,d:0.5);");
    assert_eq!(tree.nodes[5].parent, None, "the subtree is a component");
    assert_eq!(
        tree.branches[5].length, None,
        "a component root has no edge"
    );
    validate_editable(&tree).unwrap();
}

#[test]
fn detach_clears_edge_support() {
    let mut tree = parse_newick("((a:0.1,b:0.2):0.3,c:0.4,d:0.5);").unwrap();
    tree.branches[5].support = Some(0.9);
    detach(&mut tree, NodeId(5)).unwrap();
    assert_eq!(
        tree.branches[5].support, None,
        "a detached component keeps no stale support"
    );
    assert_eq!(tree.branches[5].length, None);
}

#[test]
fn detach_then_join_back() {
    let mut tree = parse_newick("(a:0.1,b:0.2,c:0.3);").unwrap(); // root = 3
    detach(&mut tree, NodeId(0)).unwrap();
    assert_eq!(write_newick(&tree), "(b:0.2,c:0.3);");
    let u = join(&mut tree, NodeId(3), NodeId(0), (0.4, 0.15)).unwrap();
    assert_eq!(tree.root, u);
    assert_eq!(write_newick(&tree), "((b:0.2,c:0.3):0.4,a:0.15);");
    validate_editable(&tree).unwrap();
}

#[test]
fn move_subtree_splits_target_edge() {
    let mut tree = four_taxon();
    // Drag c (2) onto the edge above a (0): split at 0.0625 from the
    // parent, c hangs off the junction with length 0.125. The old parent
    // (c,d) is left unary and splices out, summing 0.5 + 0.25 = 0.75.
    move_subtree(&mut tree, NodeId(2), NodeId(0), (0.0625, 0.125)).unwrap();
    assert_eq!(
        write_newick(&tree),
        "(((a:0.0625,c:0.125):0.0625,b:0.25):0.5,d:0.75);"
    );
    validate_editable(&tree).unwrap();
}

#[test]
fn move_subtree_onto_own_sibling_edge() {
    let mut tree = parse_newick("(a:0.25,b:0.5);").unwrap();
    // Moving a onto b's edge splices out the root; the junction becomes
    // the new root with children b and a.
    move_subtree(&mut tree, NodeId(0), NodeId(1), (0.25, 0.125)).unwrap();
    assert_eq!(write_newick(&tree), "(b:0.25,a:0.125);");
    assert!(tree.rooted);
    validate_editable(&tree).unwrap();
}

#[test]
fn set_length_updates_edge() {
    let mut tree = parse_newick("(a:0.1,b:0.2);").unwrap();
    set_length(&mut tree, NodeId(0), 0.5).unwrap();
    set_length(&mut tree, NodeId(1), 0.0).unwrap();
    assert_eq!(write_newick(&tree), "(a:0.5,b:0);");
    validate_editable(&tree).unwrap();
}

#[test]
fn rename_leaf_updates_label() {
    let mut tree = parse_newick("(a:0.1,b:0.2);").unwrap();
    rename_leaf(&mut tree, NodeId(0), "zebra").unwrap();
    assert_eq!(write_newick(&tree), "(zebra:0.1,b:0.2);");
    validate_editable(&tree).unwrap();
}

#[test]
fn validate_editable_accepts_parsed_tree() {
    let tree = four_taxon();
    validate_editable(&tree).unwrap();
}

// ---- refusals: each asserts InvalidEdit and an unchanged tree -------------

#[test]
fn rename_leaf_duplicate_name() {
    let mut tree = parse_newick("(a:0.1,b:0.2,c:0.3);").unwrap();
    let before = tree.clone();
    let err = rename_leaf(&mut tree, NodeId(1), "a").unwrap_err();
    assert!(matches!(err, NeoError::InvalidEdit { .. }));
    assert_eq!(tree, before);
}

#[test]
fn rename_leaf_empty_name() {
    let mut tree = parse_newick("(a:0.1,b:0.2);").unwrap();
    for name in ["", "   "] {
        let before = tree.clone();
        let err = rename_leaf(&mut tree, NodeId(1), name).unwrap_err();
        assert!(matches!(err, NeoError::InvalidEdit { .. }));
        assert_eq!(tree, before);
    }
}

#[test]
fn set_length_negative() {
    let mut tree = four_taxon();
    let before = tree.clone();
    let err = set_length(&mut tree, NodeId(0), -0.5).unwrap_err();
    assert!(matches!(err, NeoError::InvalidEdit { .. }));
    assert_eq!(tree, before);
}

#[test]
fn set_length_nan_or_infinite() {
    let mut tree = four_taxon();
    for l in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let before = tree.clone();
        let err = set_length(&mut tree, NodeId(0), l).unwrap_err();
        assert!(matches!(err, NeoError::InvalidEdit { .. }));
        assert_eq!(tree, before);
    }
}

#[test]
fn join_bad_lengths() {
    let mut tree = four_taxon();
    let leaf = tree.add_node(Some("e".to_string())); // 7, parentless
    for lengths in [(-0.1, 0.1), (0.1, f64::NAN), (f64::INFINITY, 0.0)] {
        let before = tree.clone();
        let root = tree.root;
        let err = join(&mut tree, root, leaf, lengths).unwrap_err();
        assert!(matches!(err, NeoError::InvalidEdit { .. }));
        assert_eq!(tree, before);
    }
}

#[test]
fn detach_would_leave_unary() {
    let mut tree = parse_newick("((a:0.1,b:0.2):0.3,c:0.4);").unwrap();
    let before = tree.clone();
    // Detaching a would leave (a,b) = 4 with a single child.
    let err = detach(&mut tree, NodeId(0)).unwrap_err();
    assert!(matches!(err, NeoError::InvalidEdit { .. }));
    assert_eq!(tree, before);
}

#[test]
fn detach_root_refused() {
    let mut tree = four_taxon();
    let before = tree.clone();
    let root = tree.root;
    let err = detach(&mut tree, root).unwrap_err();
    assert!(matches!(err, NeoError::InvalidEdit { .. }));
    assert_eq!(tree, before);
}

#[test]
fn move_under_own_descendant() {
    let mut tree = four_taxon();
    // (a,b) = 5 cannot move under a (0), its own descendant.
    let before = tree.clone();
    let err = move_subtree(&mut tree, NodeId(5), NodeId(0), (0.05, 0.05)).unwrap_err();
    assert!(matches!(err, NeoError::InvalidEdit { .. }));
    assert_eq!(tree, before);

    let err = move_subtree(&mut tree, NodeId(5), NodeId(5), (0.05, 0.05)).unwrap_err();
    assert!(matches!(err, NeoError::InvalidEdit { .. }));
    assert_eq!(tree, before);
}

#[test]
fn move_involving_root_refused() {
    let mut tree = four_taxon();
    let before = tree.clone();
    let root = tree.root;
    // No edge above the root to split.
    let err = move_subtree(&mut tree, NodeId(0), root, (0.05, 0.05)).unwrap_err();
    assert!(matches!(err, NeoError::InvalidEdit { .. }));
    assert_eq!(tree, before);
    // The root itself cannot move.
    let err = move_subtree(&mut tree, root, NodeId(0), (0.05, 0.05)).unwrap_err();
    assert!(matches!(err, NeoError::InvalidEdit { .. }));
    assert_eq!(tree, before);
}

#[test]
fn move_bad_split_position() {
    let mut tree = four_taxon();
    // The edge above c (2) has length 0.5.
    for lengths in [(0.75, 0.1), (-0.1, 0.1), (0.1, -0.1), (f64::NAN, 0.1)] {
        let before = tree.clone();
        let err = move_subtree(&mut tree, NodeId(0), NodeId(2), lengths).unwrap_err();
        assert!(matches!(err, NeoError::InvalidEdit { .. }));
        assert_eq!(tree, before);
    }
}

#[test]
fn move_onto_edge_without_length() {
    // A parsed tree may carry no lengths; there is nothing to split.
    let mut tree = parse_newick("((a,b),(c,d));").unwrap();
    let before = tree.clone();
    let err = move_subtree(&mut tree, NodeId(2), NodeId(0), (0.05, 0.05)).unwrap_err();
    assert!(matches!(err, NeoError::InvalidEdit { .. }));
    assert_eq!(tree, before);
}

#[test]
fn join_of_a_non_root() {
    let mut tree = parse_newick("(a:0.1,b:0.2);").unwrap();
    let before = tree.clone();
    // Both 0 and 1 already have parents.
    let err = join(&mut tree, NodeId(0), NodeId(1), (0.1, 0.1)).unwrap_err();
    assert!(matches!(err, NeoError::InvalidEdit { .. }));
    assert_eq!(tree, before);
    // A node cannot join itself.
    let err = join(&mut tree, NodeId(0), NodeId(0), (0.1, 0.1)).unwrap_err();
    assert!(matches!(err, NeoError::InvalidEdit { .. }));
    assert_eq!(tree, before);
}

#[test]
fn nonexistent_node_ids() {
    let mut tree = four_taxon();
    let gone = NodeId(999);
    let before = tree.clone();
    let root = tree.root;
    assert!(matches!(
        join(&mut tree, gone, root, (0.1, 0.1)).unwrap_err(),
        NeoError::InvalidEdit { .. }
    ));
    assert!(matches!(
        detach(&mut tree, gone).unwrap_err(),
        NeoError::InvalidEdit { .. }
    ));
    assert!(matches!(
        move_subtree(&mut tree, gone, NodeId(0), (0.05, 0.05)).unwrap_err(),
        NeoError::InvalidEdit { .. }
    ));
    assert!(matches!(
        move_subtree(&mut tree, NodeId(0), gone, (0.05, 0.05)).unwrap_err(),
        NeoError::InvalidEdit { .. }
    ));
    assert!(matches!(
        set_length(&mut tree, gone, 0.1).unwrap_err(),
        NeoError::InvalidEdit { .. }
    ));
    assert!(matches!(
        rename_leaf(&mut tree, gone, "x").unwrap_err(),
        NeoError::InvalidEdit { .. }
    ));
    assert_eq!(tree, before);
}

#[test]
fn spliced_husk_is_not_an_edit_target() {
    // The splice in move_subtree leaves the old parent (c,d) = 6 in the
    // arena: parentless, childless and unlabeled. Joining or moving it
    // would put an unnamed leaf in the tree, so both refuse.
    let mut tree = four_taxon();
    move_subtree(&mut tree, NodeId(2), NodeId(0), (0.0625, 0.125)).unwrap();
    assert!(tree.nodes[6].parent.is_none() && tree.nodes[6].children.is_empty());

    let leaf = tree.add_node(Some("e".to_string()));
    let before = tree.clone();
    let err = join(&mut tree, leaf, NodeId(6), (0.1, 0.1)).unwrap_err();
    assert!(matches!(err, NeoError::InvalidEdit { .. }));
    assert_eq!(tree, before);

    let err = move_subtree(&mut tree, NodeId(6), NodeId(3), (0.05, 0.05)).unwrap_err();
    assert!(matches!(err, NeoError::InvalidEdit { .. }));
    assert_eq!(tree, before);

    // Naming the husk resurrects it as an ordinary detached leaf.
    rename_leaf(&mut tree, NodeId(6), "e2").unwrap();
    join(&mut tree, leaf, NodeId(6), (0.1, 0.1)).unwrap();
}

#[test]
fn move_splice_clears_internal_label() {
    // The splice must strip the old parent's label: kept, the husk
    // looks like a named leaf component, and `join` would graft it
    // back as a phantom taxon.
    let mut tree = parse_newick("((A:1,B:1)anc:1,C:1);").unwrap();
    // Leaves A=0,B=1,C=2; internals in preorder: root=3, anc=4.
    move_subtree(&mut tree, NodeId(0), NodeId(2), (0.5, 1.0)).unwrap();
    assert_eq!(tree.nodes[4].label, None, "the spliced husk keeps no label");

    let root = tree.root;
    let before = tree.clone();
    let err = join(&mut tree, NodeId(4), root, (1.0, 1.0)).unwrap_err();
    assert!(matches!(err, NeoError::InvalidEdit { .. }));
    assert_eq!(tree, before);

    // The stale label no longer counts as a duplicate taxon name.
    rename_leaf(&mut tree, NodeId(2), "anc").unwrap();
}

#[test]
fn malformed_arena_is_refused() {
    // nodes.len() != branches.len() can only arrive from outside (a
    // tree across the wasm boundary); every op must refuse with
    // InvalidEdit and leave the tree unchanged rather than index past
    // the shorter array.
    let mut tree = parse_newick("((A:1,B:1):1,C:1,D:1);").unwrap();
    tree.branches.pop();
    let before = tree.clone();
    let root = tree.root;
    let last = NodeId(tree.nodes.len() as u32 - 1);

    for res in [
        set_length(&mut tree, last, 1.0),
        move_subtree(&mut tree, NodeId(0), last, (0.5, 1.0)),
        detach(&mut tree, last),
        join(&mut tree, root, last, (1.0, 1.0)).map(|_| ()),
        rename_leaf(&mut tree, NodeId(0), "z"),
    ] {
        assert!(
            matches!(res, Err(NeoError::InvalidEdit { .. })),
            "expected InvalidEdit, got {res:?}"
        );
    }
    assert!(matches!(
        validate_editable(&tree),
        Err(NeoError::InvalidEdit { .. })
    ));
    assert_eq!(tree, before);
}

#[test]
fn set_length_on_root_refused() {
    let mut tree = four_taxon();
    let before = tree.clone();
    let root = tree.root;
    let err = set_length(&mut tree, root, 0.1).unwrap_err();
    assert!(matches!(err, NeoError::InvalidEdit { .. }));
    assert_eq!(tree, before);
}

// ---- validate_editable refusal cases --------------------------------------

#[test]
fn validate_refuses_too_few_leaves() {
    let tree = parse_newick("(a:0.1);").unwrap();
    assert!(matches!(
        validate_editable(&tree),
        Err(NeoError::InvalidEdit { .. })
    ));
    assert!(matches!(
        validate_editable(&Tree::new()),
        Err(NeoError::InvalidEdit { .. })
    ));
}

#[test]
fn validate_refuses_unary_internal() {
    let tree = parse_newick("((a:0.1,b:0.2):0.3,(c:0.4):0.5);").unwrap();
    assert!(matches!(
        validate_editable(&tree),
        Err(NeoError::InvalidEdit { .. })
    ));
}

#[test]
fn validate_refuses_duplicate_and_empty_names() {
    let dup = parse_newick("(a:0.1,a:0.2);").unwrap();
    assert!(matches!(
        validate_editable(&dup),
        Err(NeoError::InvalidEdit { .. })
    ));
    let empty = parse_newick("(a:0.1,'':0.2);").unwrap();
    assert!(matches!(
        validate_editable(&empty),
        Err(NeoError::InvalidEdit { .. })
    ));
}

#[test]
fn validate_refuses_missing_or_bad_lengths() {
    let missing = parse_newick("(a,b:0.2);").unwrap();
    assert!(matches!(
        validate_editable(&missing),
        Err(NeoError::InvalidEdit { .. })
    ));
    let negative = parse_newick("(a:-0.1,b:0.2);").unwrap();
    assert!(matches!(
        validate_editable(&negative),
        Err(NeoError::InvalidEdit { .. })
    ));
}
