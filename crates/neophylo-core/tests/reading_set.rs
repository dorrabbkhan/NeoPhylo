//! Reading-set format and validation tests (v1.4d spec §4, §5.1, plan
//! Task 4). Every refusal must come back as `NeoError::InvalidReading`
//! naming the item (empty for set- and tree-level problems) and the
//! field at fault.

use neophylo_core::reading::{load_reading_set, ReadingMode, ReadingSet};
use neophylo_core::NeoError;

fn input(f: &str) -> String {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/tests/reading_inputs/");
    std::fs::read_to_string(format!("{path}{f}")).expect("reading input exists")
}

const VALID: &[&str] = &[
    "valid-rel.json",
    "valid-traits.json",
    "valid-times.json",
    "valid-pool.json",
];

fn err_of(json: &str) -> (String, String) {
    match load_reading_set(json) {
        Err(NeoError::InvalidReading {
            item,
            field,
            msg: _,
        }) => (item, field),
        Err(other) => panic!("expected InvalidReading, got {other:?}"),
        Ok(_) => panic!("expected InvalidReading, got a parsed set"),
    }
}

#[test]
fn valid_sets_load() {
    for &f in VALID {
        let set =
            load_reading_set(&input(f)).unwrap_or_else(|e| panic!("{f} should load, got {e}"));
        assert_eq!(set.kind, "reading");
        assert_eq!(set.schema_version, 1);
    }
}

#[test]
fn defaults_applied() {
    let set = load_reading_set(&input("valid-traits.json")).unwrap();
    assert_eq!(set.mode, ReadingMode::Practice);
    assert!(set.items.iter().all(|i| i.rotate_tool));
    let item = &set.items[0];
    assert!(item.style.is_none());
}

#[test]
fn set_level_fields() {
    let set: ReadingSet = load_reading_set(&input("valid-rel.json")).unwrap();
    assert_eq!(set.trees.len(), 10);
    assert_eq!(set.items.len(), 16);
    let times = &set.trees["t1"].times;
    assert!(times.is_none());
    // `"root"` resolves to the full tip set.
    let r = &set.trees["t1"].node_letters[2];
    assert_eq!(r.letter, "R");
    assert_eq!(r.on, vec!["a", "b", "c", "d"]);
}

#[test]
fn unknown_tip_in_clade_key() {
    assert_eq!(
        err_of(&input("sem-clade-tip.json")),
        ("".into(), "trees.t1.node_letters".into())
    );
}

#[test]
fn times_not_decreasing() {
    assert_eq!(
        err_of(&input("sem-times-order.json")),
        ("".into(), "trees.tx.times".into())
    );
}

#[test]
fn tied_ages_in_order_nodes() {
    assert_eq!(
        err_of(&input("sem-tied-ages.json")),
        ("q-order".into(), "nodes".into())
    );
}

#[test]
fn two_differing_trees_in_which_differs() {
    assert_eq!(
        err_of(&input("sem-two-differs.json")),
        ("q-differs".into(), "trees".into())
    );
}

#[test]
fn forty_one_tips_refused() {
    assert_eq!(
        err_of(&input("sem-tips-41.json")),
        ("".into(), "trees.big.newick".into())
    );
}

#[test]
fn thirteen_tip_tips_up_refused() {
    assert_eq!(
        err_of(&input("sem-tipsup.json")),
        ("q1".into(), "style".into())
    );
}

#[test]
fn unbound_placeholder() {
    assert_eq!(
        err_of(&input("sem-unbound.json")),
        ("q1".into(), "text".into())
    );
}

#[test]
fn null_item_in_items() {
    assert_eq!(
        err_of(&input("shape-items-null.json")),
        ("".into(), "items".into())
    );
}

#[test]
fn items_as_object() {
    assert_eq!(
        err_of(&input("shape-items-obj.json")),
        ("".into(), "items".into())
    );
}

#[test]
fn marks_null() {
    assert_eq!(
        err_of(&input("shape-marks-null.json")),
        ("".into(), "trees.t.marks".into())
    );
}

#[test]
fn wrong_schema_version() {
    assert_eq!(
        err_of(&input("shape-version.json")),
        ("".into(), "schema_version".into())
    );
}

#[test]
fn mark_on_missing_branch() {
    assert_eq!(
        err_of(&input("sem-mark-branch.json")),
        ("".into(), "trees.t.marks".into())
    );
}

#[test]
fn mark_on_root_has_no_branch() {
    assert_eq!(
        err_of(&input("sem-root-mark.json")),
        ("".into(), "trees.t.marks".into())
    );
}

#[test]
fn duplicate_point_letters() {
    assert_eq!(
        err_of(&input("sem-point-letter.json")),
        ("".into(), "trees.t.points".into())
    );
}

#[test]
fn duplicate_node_letters() {
    assert_eq!(
        err_of(&input("sem-letter-dup.json")),
        ("".into(), "trees.t.node_letters".into())
    );
}

#[test]
fn duplicated_tip_labels() {
    assert_eq!(
        err_of(&input("sem-dup-tip.json")),
        ("".into(), "trees.t.newick".into())
    );
}

#[test]
fn which_fits_without_fit() {
    assert_eq!(
        err_of(&input("sem-fits-none.json")),
        ("q-fits".into(), "trees".into())
    );
}

#[test]
fn garbage_is_invalid_reading() {
    let (item, field) = err_of("this is not json");
    assert_eq!(item, "");
    assert_eq!(field, "json");
}
