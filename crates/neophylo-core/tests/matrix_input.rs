//! `DistanceInput` tests (v1.4c spec §5): validation refusals, the
//! `Supplied` model, `additive_matrix` on a known tree, and the worked
//! NJ/UPGMA examples replayed through the matrix-input path.

use neophylo_core::algos::{build_tree, BuildOptions, Method, NjFinal, NjStep, Trace, UpgmaStep};
use neophylo_core::alphabet::Alphabet;
use neophylo_core::dist::{compute, compute_filtered, DistModel};
use neophylo_core::error::NeoError;
use neophylo_core::exercise::load_exercise;
use neophylo_core::matrix::Matrix;
use neophylo_core::matrix_input::{additive_matrix, validate_input, DistanceInput};
use neophylo_core::seq::{parse_fasta, MAX_TAXA};
use neophylo_core::site_filter::SiteFilter;
use neophylo_core::tree::{NodeId, Tree};
use serde::Deserialize;

const TOL: f64 = 1e-12;

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

fn assert_nj_step(got: &NjStep, want: &NjStep) {
    assert_eq!(got.step, want.step);
    assert_eq!(got.active, want.active);
    assert_matrix_close(&got.distance, &want.distance);
    assert_vec_close(&got.r, &want.r);
    assert_matrix_close(&got.q, &want.q);
    assert_eq!(got.chosen, want.chosen);
    assert_eq!(got.tie, want.tie);
    assert_close(got.len_i, want.len_i);
    assert_close(got.len_j, want.len_j);
    assert_eq!(got.new_node, want.new_node);
    assert_vec_close(&got.new_row, &want.new_row);
}

fn assert_upgma_step(got: &UpgmaStep, want: &UpgmaStep) {
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
struct WorkedNj {
    labels: Vec<String>,
    matrix: Matrix,
    steps: Vec<NjStep>,
    final_join: NjFinal,
}

#[derive(Deserialize)]
struct WorkedUpgma {
    labels: Vec<String>,
    matrix: Matrix,
    steps: Vec<UpgmaStep>,
}

/// Leaf labels sorted — `leaf_labels()` is preorder from the root, so
/// it does not preserve input order on an unrooted tree.
fn sorted_leaves(t: &Tree) -> Vec<String> {
    let mut labels = t.leaf_labels();
    labels.sort();
    labels
}

/// The worked example's square matrix as a `DistanceInput`: labels in
/// order, strict lower triangle in row order.
fn input_of(labels: &[String], m: &Matrix) -> DistanceInput {
    assert_eq!(m.data.len(), m.n * m.n);
    let mut lower = Vec::with_capacity(m.n * (m.n - 1) / 2);
    for i in 0..m.n {
        for j in 0..i {
            lower.push(m.data[i * m.n + j]);
        }
    }
    DistanceInput {
        names: labels.to_vec(),
        lower,
    }
}

#[test]
fn wiki5_builds_same_tree_as_worked_example() {
    let json = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/worked/nj_wikipedia5.json"
    ));
    let worked: WorkedNj = serde_json::from_str(json).unwrap();
    let input = input_of(&worked.labels, &worked.matrix);
    let m = input.to_distance_matrix().unwrap();
    assert_eq!(m.model, DistModel::Supplied);
    let res = build_tree(&m, Method::Nj, BuildOptions { trace: true }).unwrap();
    let Some(Trace::Nj { steps, final_join }) = res.trace else {
        panic!("trace missing")
    };
    assert_eq!(steps.len(), worked.steps.len());
    for (got, want) in steps.iter().zip(&worked.steps) {
        assert_nj_step(got, want);
    }
    let want = &worked.final_join;
    assert_eq!(final_join.a, want.a);
    assert_eq!(final_join.b, want.b);
    assert_eq!(final_join.c, want.c);
    assert_close(final_join.la, want.la);
    assert_close(final_join.lb, want.lb);
    assert_close(final_join.lc, want.lc);
    assert!(!res.tree.rooted);
    assert_eq!(sorted_leaves(&res.tree), worked.labels);
}

#[test]
fn by_hand_builds_same_tree_as_worked_example() {
    let json = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/worked/nj_by_hand.json"
    ));
    let worked: WorkedNj = serde_json::from_str(json).unwrap();
    let input = input_of(&worked.labels, &worked.matrix);
    let m = input.to_distance_matrix().unwrap();
    let res = build_tree(&m, Method::Nj, BuildOptions { trace: true }).unwrap();
    let Some(Trace::Nj { steps, final_join }) = res.trace else {
        panic!("trace missing")
    };
    assert_eq!(steps.len(), worked.steps.len());
    for (got, want) in steps.iter().zip(&worked.steps) {
        assert_nj_step(got, want);
    }
    let want = &worked.final_join;
    assert_eq!(final_join.a, want.a);
    assert_eq!(final_join.b, want.b);
    assert_eq!(final_join.c, want.c);
    assert_close(final_join.la, want.la);
    assert_close(final_join.lb, want.lb);
    assert_close(final_join.lc, want.lc);
    assert!(!res.tree.rooted);
    assert_eq!(sorted_leaves(&res.tree), worked.labels);
}

#[test]
fn upgma5_builds_same_tree_as_worked_example() {
    let json = include_str!(concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../fixtures/worked/upgma_wikipedia5.json"
    ));
    let worked: WorkedUpgma = serde_json::from_str(json).unwrap();
    let input = input_of(&worked.labels, &worked.matrix);
    let m = input.to_distance_matrix().unwrap();
    let res = build_tree(&m, Method::Upgma, BuildOptions { trace: true }).unwrap();
    let Some(Trace::Upgma { steps }) = res.trace else {
        panic!("trace missing")
    };
    assert_eq!(steps.len(), worked.steps.len());
    for (got, want) in steps.iter().zip(&worked.steps) {
        assert_upgma_step(got, want);
    }
    assert!(res.tree.rooted);
    assert_eq!(sorted_leaves(&res.tree), worked.labels);
}

#[test]
fn negative_value_names_cell() {
    // lower[1] is d(c, a): the error names that cell.
    let input = DistanceInput {
        names: vec!["a".into(), "b".into(), "c".into()],
        lower: vec![1.0, -2.5, 3.0],
    };
    let err = validate_input(&input).unwrap_err();
    match err {
        NeoError::InvalidMatrix { row, col, msg } => {
            assert_eq!(row, "c");
            assert_eq!(col, "a");
            assert!(!msg.is_empty());
        }
        other => panic!("expected InvalidMatrix, got {other:?}"),
    }
}

#[test]
fn nan_and_infinity_refused() {
    for bad in [f64::NAN, f64::INFINITY, f64::NEG_INFINITY] {
        let input = DistanceInput {
            names: vec!["a".into(), "b".into(), "c".into()],
            lower: vec![1.0, bad, 3.0],
        };
        match validate_input(&input) {
            Err(NeoError::InvalidMatrix { row, col, .. }) => {
                assert_eq!(row, "c");
                assert_eq!(col, "a");
            }
            other => panic!("value {bad}: expected InvalidMatrix, got {other:?}"),
        }
    }
}

#[test]
fn wrong_length_refused() {
    // 3 taxa need 3 lower-triangle values; 2 is InvalidMatrix with no
    // cell (row and col both empty).
    let input = DistanceInput {
        names: vec!["a".into(), "b".into(), "c".into()],
        lower: vec![1.0, 2.0],
    };
    let err = validate_input(&input).unwrap_err();
    match err {
        NeoError::InvalidMatrix { row, col, msg } => {
            assert!(row.is_empty() && col.is_empty());
            assert!(msg.contains('3'), "msg should name the count: {msg}");
        }
        other => panic!("expected InvalidMatrix, got {other:?}"),
    }
    // Too many is refused the same way.
    let input = DistanceInput {
        names: vec!["a".into(), "b".into(), "c".into()],
        lower: vec![1.0, 2.0, 3.0, 4.0],
    };
    assert!(matches!(
        validate_input(&input),
        Err(NeoError::InvalidMatrix { .. })
    ));
}

#[test]
fn two_taxa_too_few() {
    let input = DistanceInput {
        names: vec!["a".into(), "b".into()],
        lower: vec![1.0],
    };
    let err = validate_input(&input).unwrap_err();
    assert_eq!(err, NeoError::TooFewTaxa { min: 3, got: 2 });
}

#[test]
fn too_many_taxa_refused() {
    let n = MAX_TAXA + 1;
    let input = DistanceInput {
        names: (0..n).map(|i| format!("t{i}")).collect(),
        lower: vec![1.0; n * (n - 1) / 2],
    };
    let err = validate_input(&input).unwrap_err();
    assert_eq!(
        err,
        NeoError::TooManyTaxa {
            max: MAX_TAXA,
            got: n
        }
    );
}

#[test]
fn duplicate_names_refused_naming_both() {
    let input = DistanceInput {
        names: vec!["Human".into(), "Mouse".into(), "Human".into()],
        lower: vec![1.0, 2.0, 3.0],
    };
    let err = validate_input(&input).unwrap_err();
    match err {
        NeoError::InvalidMatrix { row, col, msg } => {
            assert_eq!(row, "Human");
            assert_eq!(col, "Human");
            assert!(
                msg.contains('1') && msg.contains('3') && msg.contains("Human"),
                "msg should name both positions: {msg}"
            );
        }
        other => panic!("expected InvalidMatrix, got {other:?}"),
    }
}

#[test]
fn empty_name_refused() {
    // Empty and whitespace-only names are refused; the message names
    // the position, not a cell.
    for name in ["", "   "] {
        let input = DistanceInput {
            names: vec!["a".into(), name.into(), "c".into()],
            lower: vec![1.0, 2.0, 3.0],
        };
        match validate_input(&input) {
            Err(NeoError::InvalidMatrix { row, col, msg }) => {
                assert!(row.is_empty() && col.is_empty());
                assert!(msg.contains('2'), "msg should name position 2: {msg}");
            }
            other => panic!("name {name:?}: expected InvalidMatrix, got {other:?}"),
        }
    }
}

#[test]
fn zero_off_diagonal_allowed() {
    // Identical taxa are legal (v1.4c spec §4.1).
    let input = DistanceInput {
        names: vec!["a".into(), "b".into(), "c".into()],
        lower: vec![0.0, 0.0, 0.0],
    };
    validate_input(&input).unwrap();
    input.to_distance_matrix().unwrap();
    // -0.0 reads as 0 too.
    let input = DistanceInput {
        names: vec!["a".into(), "b".into(), "c".into()],
        lower: vec![-0.0, 0.0, 0.0],
    };
    validate_input(&input).unwrap();
}

#[test]
fn compute_refuses_supplied() {
    // `supports` is false for both alphabets, so `compute` and
    // `compute_filtered` refuse through the existing
    // `ModelAlphabetMismatch` path with the model name "supplied".
    let dna = parse_fasta(">a\nACGT\n>b\nACGA\n>c\nACGC\n").unwrap();
    let protein = parse_fasta(">a\nMKLV\n>b\nMKLW\n>c\nMKLY\n").unwrap();
    for (aln, alphabet) in [
        (dna.clone(), Alphabet::Dna),
        (protein.clone(), Alphabet::Protein),
    ] {
        for res in [
            compute(&aln, DistModel::Supplied),
            compute_filtered(&aln, DistModel::Supplied, SiteFilter::Pairwise),
        ] {
            assert_eq!(
                res.unwrap_err(),
                NeoError::ModelAlphabetMismatch {
                    model: "supplied".to_string(),
                    alphabet,
                }
            );
        }
    }
}

#[test]
fn supplied_serializes_as_plain_string() {
    // The exercise-file spelling check pins the serde name too.
    assert_eq!(
        serde_json::to_string(&DistModel::Supplied).unwrap(),
        "\"Supplied\""
    );
    assert_eq!(DistModel::Supplied.name(), "supplied");
}

/// The unrooted 4-taxon tree ((a,b),(c,d)) stored with the degree-3
/// root between a, b and the (c,d) cherry:
/// d(a,b)=3, d(a,c)=8, d(a,d)=9, d(b,c)=9, d(b,d)=10, d(c,d)=9.
fn known_tree() -> Tree {
    let mut t = Tree::new();
    let a = t.add_node(Some("a".into()));
    let b = t.add_node(Some("b".into()));
    let c = t.add_node(Some("c".into()));
    let d = t.add_node(Some("d".into()));
    let u = t.add_node(None);
    let r = t.add_node(None);
    t.attach(u, c, Some(4.0));
    t.attach(u, d, Some(5.0));
    t.attach(r, a, Some(1.0));
    t.attach(r, b, Some(2.0));
    t.attach(r, u, Some(3.0));
    t.set_root(r);
    t
}

#[test]
fn additive_matrix_of_known_tree() {
    let t = known_tree();
    let input = additive_matrix(&t, None).unwrap();
    assert_eq!(input.names, vec!["a", "b", "c", "d"]);
    // Strict lower triangle, row order: d(b,a), d(c,a), d(c,b),
    // d(d,a), d(d,b), d(d,c).
    assert_eq!(input.lower, vec![3.0, 8.0, 9.0, 9.0, 10.0, 9.0]);
    // `get` is symmetric and the diagonal is zero.
    assert_eq!(input.get(0, 2), 8.0);
    assert_eq!(input.get(2, 0), 8.0);
    assert_eq!(input.get(1, 1), 0.0);
    // Rounding to two decimals is applied to each value.
    let rounded = additive_matrix(&t, Some(2)).unwrap();
    assert_eq!(rounded.lower, input.lower);
}

#[test]
fn additive_matrix_missing_length_names_leaf() {
    let mut t = known_tree();
    t.branches[4].length = None; // the edge above internal node u
    let err = additive_matrix(&t, None).unwrap_err();
    match err {
        NeoError::InvalidMatrix { row, msg, .. } => {
            assert!(!row.is_empty(), "the error names a leaf");
            assert!(msg.contains("length"), "msg: {msg}");
        }
        other => panic!("expected InvalidMatrix, got {other:?}"),
    }
}

#[test]
fn additive_matrix_disconnected_tree_refused() {
    // A hand-built tree with an out-of-range parent or child link must
    // error, not panic and not fabricate a zero distance between
    // disconnected taxa. b stays reachable downward (it is in the
    // root's children, so it is still a preorder leaf) but its own
    // upward path is a dead end.
    let mut t = known_tree();
    t.nodes[1].parent = Some(NodeId(99)); // leaf b's parent points nowhere
    t.nodes[4].children.push(NodeId(98)); // and u lists a child that does not exist
    match additive_matrix(&t, None) {
        Err(NeoError::InvalidMatrix { row, col, .. }) => {
            assert_eq!(row, "b");
            assert_eq!(col, "a");
        }
        other => panic!("expected InvalidMatrix, got {other:?}"),
    }
}

#[test]
fn additive_matrix_duplicate_leaf_labels_refused() {
    let mut t = known_tree();
    t.nodes[1].label = Some("a".into()); // b becomes a second "a"
    let err = additive_matrix(&t, None).unwrap_err();
    match err {
        NeoError::InvalidMatrix { row, col, .. } => {
            assert_eq!(row, "a");
            assert_eq!(col, "a");
        }
        other => panic!("expected InvalidMatrix, got {other:?}"),
    }
}

#[test]
fn additive_matrix_too_few_leaves() {
    let mut t = Tree::new();
    let a = t.add_node(Some("a".into()));
    let b = t.add_node(Some("b".into()));
    let r = t.add_node(None);
    t.attach(r, a, Some(1.0));
    t.attach(r, b, Some(1.0));
    t.set_root(r);
    let err = additive_matrix(&t, None).unwrap_err();
    assert_eq!(err, NeoError::TooFewTaxa { min: 3, got: 2 });
}

#[test]
fn round_decimals_over_6_refused() {
    let t = known_tree();
    for d in [7u8, 255] {
        match additive_matrix(&t, Some(d)) {
            Err(NeoError::InvalidMatrix { row, col, .. }) => {
                assert!(row.is_empty() && col.is_empty());
            }
            other => panic!("round {d}: expected InvalidMatrix, got {other:?}"),
        }
    }
    additive_matrix(&t, Some(6)).unwrap();
}

#[test]
fn supplied_correction_still_refused_in_exercises() {
    // The exercise loader maps correction names explicitly; neither
    // casing reaches `DistModel::Supplied` through a file. Task 5 gives
    // matrix exercises `data.kind` + `method` only.
    for spelling in ["supplied", "Supplied"] {
        let json = format!(
            r#"{{
  "schema_version": 1,
  "id": "x",
  "title": "x",
  "true_tree": "(A:0.1,B:0.2,C:0.3);",
  "sim": {{ "model": "JC69", "length": 100, "seed": 1 }},
  "analysis": {{ "correction": "{spelling}", "method": "NJ" }}
}}"#
        );
        let err = load_exercise(&json).unwrap_err();
        match err {
            NeoError::InvalidExercise { field, msg } => {
                assert_eq!(field, "analysis.correction");
                assert_eq!(msg, format!("unknown correction '{spelling}'"));
            }
            other => panic!("spelling {spelling:?}: expected InvalidExercise, got {other:?}"),
        }
    }
}
