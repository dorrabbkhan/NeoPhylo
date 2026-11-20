//! Content checks for the shipped reading sets (v1.4d plan Tasks 11
//! and 12, spec §8.1–8.3). The sets live in `exercises/reading/`
//! (lessons and forms A/B) and `exercises/reading/coverage/` (the
//! format-coverage sets plus `manifest.json`); this test is their
//! oracle — every expectation below was written by hand against the
//! trees, never copied out of the content files.
//!
//! - every built-in set in `exercises/reading/*.json` and every set in
//!   `exercises/reading/coverage/` (except the manifest) loads;
//! - each item of each listed set computes to the stored answer
//!   (matched by item id);
//! - forms A and B are `test` mode, hold 10–12 items each, cover the
//!   same misconception-category list and each contain a trait-loss
//!   item;
//! - the coverage manifest maps every entry to real files and items,
//!   covers every §8.3 format, style and feature bullet and lists the
//!   deferred format gaps;
//! - every tree name in the listed sets appears in `SOURCES.md`;
//! - no `taxa_pool` taxon appears literally in student-facing text
//!   (the Task-12 rule, applied now so v1.5 relabelling stays
//!   correct);
//! - no digits in student-facing text — the v1.4c numbers-in-text
//!   rule (`web/src/lessons/content.test.ts`) applied to reading
//!   sets: every number a student sees must come from the engine.
//!   Age-bearing statements (`older_than_age`, `lineage_at_least`)
//!   name their threshold in text by design; that one authored
//!   number is stripped before the digit check.

use std::collections::BTreeSet;
use std::fs;
use std::path::PathBuf;

use neophylo_core::newick::parse_newick;
use neophylo_core::reading::{
    answer, check, clade_key, find_clade, load_reading_set, sister_tips, Accepted, AnswerKey,
    Change, Closer, Item, PointAt, Question, ReadingMode, ReadingSet, Response, Shape, Statement,
    Times, TipSide, TraitAsk,
};

fn reading_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../exercises/reading")
}

fn read(name: &str) -> String {
    fs::read_to_string(reading_dir().join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

fn set(name: &str) -> ReadingSet {
    for path in [format!("{name}.json"), format!("coverage/{name}.json")] {
        if let Ok(text) = fs::read_to_string(reading_dir().join(&path)) {
            return load_reading_set(&text).unwrap_or_else(|e| panic!("{path}: {e}"));
        }
    }
    panic!("no reading set file for {name}");
}

fn idx(set: &ReadingSet, item_id: &str) -> usize {
    set.items
        .iter()
        .position(|i| i.id == item_id)
        .unwrap_or_else(|| panic!("no item {item_id}"))
}

fn key(set: &ReadingSet, item_id: &str) -> AnswerKey {
    answer(set, idx(set, item_id)).unwrap_or_else(|e| panic!("{item_id}: {e}"))
}

fn clade(tips: &[&str]) -> Vec<String> {
    let mut k: Vec<String> = tips.iter().map(|s| s.to_string()).collect();
    k.sort();
    k
}

// --- every built-in set loads --------------------------------------------------

#[test]
fn every_builtin_reading_set_loads() {
    let mut files: Vec<PathBuf> = fs::read_dir(reading_dir())
        .unwrap()
        .filter_map(|e| {
            let p = e.unwrap().path();
            (p.extension().and_then(|x| x.to_str()) == Some("json")).then_some(p)
        })
        .collect();
    files.sort();
    // The demo set plus the four lessons and forms A/B.
    assert!(
        files.len() >= 7,
        "expected the demo set, four lessons and forms A/B, found {files:?}"
    );
    // Coverage sets (every file except the manifest).
    let mut coverage: Vec<PathBuf> = fs::read_dir(reading_dir().join("coverage"))
        .unwrap()
        .filter_map(|e| {
            let p = e.unwrap().path();
            (p.extension().and_then(|x| x.to_str()) == Some("json")
                && p.file_name().and_then(|x| x.to_str()) != Some("manifest.json"))
            .then_some(p)
        })
        .collect();
    coverage.sort();
    assert!(!coverage.is_empty(), "no coverage sets found");
    files.extend(coverage);
    for p in files {
        let text = fs::read_to_string(&p).unwrap();
        load_reading_set(&text).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
    }
}

// --- computed answers match the stored expectations ----------------------------

/// (set id, [(item id, accepted answer)]) — every item of each listed
/// set must appear; an unlisted item fails the completeness pass.
fn expected() -> Vec<(&'static str, Vec<(&'static str, Accepted)>)> {
    vec![
        (
            "trees-reading-a-tree",
            vec![
                ("q-tips", Accepted::Choices(vec![0])),
                ("q-nodes", Accepted::Choices(vec![0])),
                ("q-branches", Accepted::Choices(vec![0])),
                (
                    "q-root",
                    Accepted::Clade(clade(&[
                        "cat", "chimp", "dog", "frog", "human", "salmon", "shark",
                    ])),
                ),
                ("q-mrca", Accepted::Clade(clade(&["chimp", "human"]))),
                ("q-time", Accepted::Choices(vec![0])),
                (
                    "q-order",
                    Accepted::Orders {
                        rule: "ancestry".into(),
                    },
                ),
            ],
        ),
        (
            "trees-rotation",
            vec![
                ("q-two-same", Accepted::Choices(vec![2])),
                ("q-three-diff", Accepted::Choices(vec![2])),
                (
                    "q-select",
                    Accepted::Statements(vec![true, false, true, false]),
                ),
                (
                    "q-two",
                    Accepted::TwoTier {
                        first: Box::new(Accepted::Choices(vec![2])),
                        reason: 0,
                    },
                ),
                ("q-evolved", Accepted::Choices(vec![0])),
            ],
        ),
        (
            "trees-closest-relatives",
            vec![
                ("q-closest", Accepted::AnyTipOf(clade(&["tiger"]))),
                ("q-distant", Accepted::AnyTipOf(clade(&["fox", "wolf"]))),
                ("q-pair", Accepted::Pairwise(Closer::B)),
                (
                    "q-sister",
                    Accepted::AnyTipOf(clade(&["guinea pig", "mouse", "rat", "squirrel"])),
                ),
                ("q-pair-poly", Accepted::Pairwise(Closer::Equal)),
                (
                    "q-sea-closest",
                    Accepted::AnyTipOf(clade(&["chicken", "penguin"])),
                ),
                (
                    "q-two",
                    Accepted::TwoTier {
                        first: Box::new(Accepted::Pairwise(Closer::B)),
                        reason: 0,
                    },
                ),
            ],
        ),
        (
            "trees-clades-traits",
            vec![
                ("q-clade-yes", Accepted::Choices(vec![0])),
                ("q-clade-no", Accepted::Choices(vec![1])),
                ("q-mono", Accepted::Choices(vec![0])),
                ("q-para", Accepted::Choices(vec![1])),
                ("q-poly", Accepted::Choices(vec![2])),
                ("q-have", Accepted::TipSet(clade(&["human", "mouse"]))),
                ("q-shared", Accepted::Choices(vec![3])),
                ("q-homo", Accepted::Choices(vec![1])),
                ("q-synap", Accepted::Statements(vec![true, false, false])),
                (
                    "q-two",
                    Accepted::TwoTier {
                        first: Box::new(Accepted::Choices(vec![0])),
                        reason: 0,
                    },
                ),
            ],
        ),
        (
            "trees-form-a",
            vec![
                ("q-parts", Accepted::Choices(vec![0])),
                ("q-rot", Accepted::Choices(vec![2])),
                (
                    "q-select",
                    Accepted::Statements(vec![true, false, true, false]),
                ),
                ("q-closest", Accepted::AnyTipOf(clade(&["puma"]))),
                ("q-pair", Accepted::Pairwise(Closer::B)),
                ("q-sea", Accepted::Pairwise(Closer::B)),
                ("q-clade", Accepted::Choices(vec![1])),
                (
                    "q-smallest",
                    Accepted::Clade(clade(&["crab", "horseshoe crab", "lobster", "spider"])),
                ),
                ("q-mono", Accepted::Choices(vec![0])),
                ("q-para", Accepted::Choices(vec![1])),
                (
                    "q-have",
                    Accepted::TipSet(clade(&["camel", "frog", "hippo", "pig"])),
                ),
                (
                    "q-order",
                    Accepted::Orders {
                        rule: "ancestry".into(),
                    },
                ),
            ],
        ),
        (
            "trees-form-b",
            vec![
                ("q-evolved", Accepted::Choices(vec![0])),
                ("q-rot", Accepted::Choices(vec![2])),
                (
                    "q-select",
                    Accepted::Statements(vec![true, true, false, false]),
                ),
                (
                    "q-closest",
                    Accepted::AnyTipOf(clade(&["albatross", "chicken", "duck", "penguin"])),
                ),
                ("q-pair", Accepted::Pairwise(Closer::B)),
                ("q-equal", Accepted::Pairwise(Closer::Equal)),
                ("q-clade", Accepted::Choices(vec![1])),
                (
                    "q-smallest",
                    Accepted::Clade(clade(&["kangaroo", "koala", "wombat"])),
                ),
                ("q-fly", Accepted::Choices(vec![1])),
                (
                    "q-feathered",
                    Accepted::TipSet(clade(&["ostrich", "penguin"])),
                ),
                ("q-count", Accepted::Number(4)),
                (
                    "q-order",
                    Accepted::Orders {
                        rule: "ancestry".into(),
                    },
                ),
            ],
        ),
        (
            "cov-styles",
            vec![
                ("q-diff-rect", Accepted::Choices(vec![2])),
                ("q-diff-circ", Accepted::Choices(vec![2])),
                ("q-diff-diag", Accepted::Choices(vec![2])),
                ("q-all-same", Accepted::Choices(vec![2])),
            ],
        ),
        (
            "cov-relatedness",
            vec![
                ("q-closest", Accepted::AnyTipOf(clade(&["cow"]))),
                ("q-distant", Accepted::AnyTipOf(clade(&["earthworm"]))),
                ("q-pair", Accepted::Pairwise(Closer::B)),
                ("q-pair-poly", Accepted::Pairwise(Closer::Equal)),
                (
                    "q-similar",
                    Accepted::TwoTier {
                        first: Box::new(Accepted::AnyTipOf(clade(&["cow"]))),
                        reason: 0,
                    },
                ),
                ("q-parts", Accepted::Choices(vec![0])),
                ("q-lines", Accepted::Choices(vec![0])),
                ("q-progress", Accepted::Choices(vec![0])),
                ("q-still", Accepted::Choices(vec![0])),
            ],
        ),
        (
            "cov-structural",
            vec![
                ("q-mrca-points", Accepted::Point("W".into())),
                ("q-place", Accepted::Point("V".into())),
                (
                    "q-mrca",
                    Accepted::Clade(clade(&["A", "B", "C", "D", "E", "F", "G", "H"])),
                ),
                ("q-clade", Accepted::Choices(vec![1])),
                ("q-smallest", Accepted::Clade(clade(&["A", "B", "C", "D"]))),
                ("q-count", Accepted::Number(7)),
                ("q-fits", Accepted::Choices(vec![0])),
                ("q-conflict", Accepted::Choices(vec![1])),
                (
                    "q-order-letters",
                    Accepted::Orders {
                        rule: "ancestry".into(),
                    },
                ),
            ],
        ),
        (
            "cov-traits",
            vec![
                ("q-have", Accepted::TipSet(clade(&["a", "b", "c"]))),
                ("q-hasnot", Accepted::TipSet(clade(&["c"]))),
                ("q-profile", Accepted::Choices(vec![2, 3])),
                ("q-changes", Accepted::Number(2)),
                ("q-ancder", Accepted::Choices(vec![0])),
                ("q-homo", Accepted::Choices(vec![1])),
                ("q-mono", Accepted::Choices(vec![0])),
                ("q-para", Accepted::Choices(vec![1])),
                ("q-poly", Accepted::Choices(vec![2])),
                ("q-shared", Accepted::Choices(vec![0])),
                (
                    "q-marks-select",
                    Accepted::Statements(vec![true, false, true, false, true, false]),
                ),
            ],
        ),
        (
            "cov-statements",
            vec![
                (
                    "q-two-trees",
                    Accepted::Statements(vec![true, true, false, false, true]),
                ),
                (
                    "q-order-free",
                    Accepted::Orders {
                        rule: "ancestry".into(),
                    },
                ),
                (
                    "q-order-ages",
                    Accepted::Orders {
                        rule: "ages".into(),
                    },
                ),
                (
                    "q-ages",
                    Accepted::Statements(vec![true, false, true, false]),
                ),
                ("q-no-time", Accepted::Choices(vec![0])),
                ("q-poly-meaning", Accepted::Choices(vec![0])),
                ("q-dendro", Accepted::Choices(vec![0])),
                ("q-coev", Accepted::Choices(vec![0])),
            ],
        ),
    ]
}

#[test]
fn every_listed_item_computes_the_stored_answer() {
    for (set_name, items) in expected() {
        let s = set(set_name);
        for (item_id, want) in &items {
            assert_eq!(key(&s, item_id).accepted, *want, "{set_name}/{item_id}");
        }
    }
}

#[test]
fn every_lesson_item_is_listed() {
    // The expectation table must cover every item — a new item that is
    // never asserted would slip through the per-item test above.
    for (set_name, items) in expected() {
        let s = set(set_name);
        for item in &s.items {
            assert!(
                items.iter().any(|(id, _)| *id == item.id),
                "{set_name}/{} has no stored expectation",
                item.id
            );
        }
    }
}

#[test]
fn order_nodes_accepts_every_ancestry_consistent_order() {
    // q-order letters a chain R ⊃ T ⊃ A ⊃ {C, P}: R, T, A fix the
    // first three places; C and P (different lineages) swap freely.
    let s = set("trees-reading-a-tree");
    let i = idx(&s, "q-order");
    let verdict = |letters: &[&str]| {
        check(
            &s,
            i,
            &Response::Order {
                letters: letters.iter().map(|x| x.to_string()).collect(),
            },
        )
        .unwrap()
        .correct
    };
    assert!(verdict(&["R", "T", "A", "C", "P"]));
    assert!(verdict(&["R", "T", "A", "P", "C"]));
    assert!(!verdict(&["T", "R", "A", "C", "P"])); // root must come first
    assert!(!verdict(&["R", "T", "A", "P"])); // not a permutation
}

#[test]
fn order_nodes_ages_rule_gives_the_unique_order() {
    // cov-statements/q-order-ages letters C(45) ⊂ W(60) ⊂ R(70) chain
    // and N(35) below C: every age is distinct, so exactly one order
    // is accepted.
    let s = set("cov-statements");
    let i = idx(&s, "q-order-ages");
    let verdict = |letters: &[&str]| {
        check(
            &s,
            i,
            &Response::Order {
                letters: letters.iter().map(|x| x.to_string()).collect(),
            },
        )
        .unwrap()
        .correct
    };
    assert!(verdict(&["R", "W", "C", "N"]));
    assert!(!verdict(&["W", "R", "C", "N"]));
}

#[test]
fn order_nodes_free_order_accepts_lineage_swaps() {
    // cov-structural/q-order-letters: R first; P and Q are separate
    // lineages and swap freely.
    let s = set("cov-structural");
    let i = idx(&s, "q-order-letters");
    let verdict = |letters: &[&str]| {
        check(
            &s,
            i,
            &Response::Order {
                letters: letters.iter().map(|x| x.to_string()).collect(),
            },
        )
        .unwrap()
        .correct
    };
    assert!(verdict(&["R", "P", "Q"]));
    assert!(verdict(&["R", "Q", "P"]));
    assert!(!verdict(&["P", "R", "Q"]));
}

/// The `select_true` statements an item asks, including inside a
/// `two_tier` first question.
fn statements_of(q: &Question) -> Vec<&Statement> {
    match q {
        Question::SelectTrue { statements } => statements.iter().collect(),
        Question::TwoTier { first, .. } => statements_of(first),
        _ => vec![],
    }
}

#[test]
fn lineage_at_least_statements_agree_with_the_drawn_split_age() {
    // `lineage_at_least` bounds the lineage's age by the oldest fossil
    // tip of the tip's sister group (spec §4.3). On a dated tree a
    // student instead reads the drawn age of the node joining `tip` to
    // that sister — the node drawn where the lineage splits. Both
    // readings must give the same truth value, so thresholds must sit
    // at or below the fossil bound or above the drawn node age.
    for (set_name, _) in &expected() {
        let s = set(set_name);
        for item in &s.items {
            let rt = &s.trees[&item.trees[0]];
            let tree = parse_newick(&rt.newick).unwrap();
            let age_of = |key: &[String]| -> Option<f64> {
                match &rt.times {
                    Some(Times::Ages { ages, .. }) => {
                        ages.iter().find(|a| a.on.as_slice() == key).map(|a| a.age)
                    }
                    _ => None,
                }
            };
            for st in statements_of(&item.question) {
                let Statement::LineageAtLeast { tip, age, .. } = st else {
                    continue;
                };
                let fossil_bound = sister_tips(&tree, tip)
                    .unwrap()
                    .iter()
                    .map(|t| age_of(std::slice::from_ref(t)).unwrap_or(0.0))
                    .fold(0.0_f64, f64::max);
                let tip_node = find_clade(&tree, std::slice::from_ref(tip)).unwrap();
                let Some(parent) = tree.nodes[tip_node.0 as usize].parent else {
                    continue;
                };
                let Some(drawn_age) = age_of(&clade_key(&tree, parent)) else {
                    continue;
                };
                assert_eq!(
                    fossil_bound >= *age,
                    drawn_age >= *age,
                    "{set_name}/{}: lineage_at_least tip '{tip}' age {age} \
                     disagrees between the fossil bound ({fossil_bound}) \
                     and the drawn split age ({drawn_age})",
                    item.id
                );
            }
        }
    }
}

#[test]
fn mrca_point_options_cover_tip_branch_and_node() {
    // cov-structural/q-mrca-points mirrors the Baum et al. 2005
    // "MRCA among lettered points on tips, branches and nodes" format
    // (spec §8.3): its options must offer at least one point of each
    // kind — a point on a tip, on a branch and on an internal node.
    let s = set("cov-structural");
    let item = &s.items[idx(&s, "q-mrca-points")];
    let rt = &s.trees[&item.trees[0]];
    let tree = parse_newick(&rt.newick).unwrap();
    let Question::Mrca {
        options: Some(opts),
    } = &item.question
    else {
        panic!("q-mrca-points needs lettered options");
    };
    let mut tip_point = false;
    let mut branch_point = false;
    let mut node_point = false;
    for l in opts {
        let p = rt
            .points
            .iter()
            .find(|p| p.letter == *l)
            .unwrap_or_else(|| panic!("option '{l}' is not a point"));
        match p.at {
            PointAt::Branch => branch_point = true,
            PointAt::Node => {
                let n = find_clade(&tree, &p.on).unwrap();
                if tree.nodes[n.0 as usize].children.is_empty() {
                    tip_point = true;
                } else {
                    node_point = true;
                }
            }
        }
    }
    assert!(tip_point, "q-mrca-points offers no point on a tip");
    assert!(branch_point, "q-mrca-points offers no point on a branch");
    assert!(
        node_point,
        "q-mrca-points offers no point on an internal node"
    );
}

// --- forms A and B (spec §8.2) ---------------------------------------------------

/// The misconception category each form item exercises. The two forms
/// must cover the same category list (parallel forms).
///
/// Unfamiliar taxa per form (the plan's "mixing familiar and
/// unfamiliar taxa"): form A carries them on `arthropods` (horseshoe
/// crab, lobster, spider — the `q-sea` and `q-smallest` items) and
/// ginkgo on `plants` (`q-clade`); form B carries them on
/// `marsupials` (quoll, wombat — `q-clade`, `q-smallest`, `q-count`)
/// and the albatross on `birds`.
fn form_categories() -> Vec<(&'static str, Vec<(&'static str, &'static str)>)> {
    vec![
        (
            "trees-form-a",
            vec![
                ("q-parts", "structure"),
                ("q-rot", "rotation"),
                ("q-select", "rotation"),
                ("q-closest", "relatedness"),
                ("q-pair", "relatedness"),
                ("q-sea", "relatedness"),
                ("q-clade", "clades"),
                ("q-smallest", "clades"),
                ("q-mono", "traits"),
                ("q-para", "traits"),
                ("q-have", "traits"),
                ("q-order", "order"),
            ],
        ),
        (
            "trees-form-b",
            vec![
                ("q-evolved", "structure"),
                ("q-rot", "rotation"),
                ("q-select", "rotation"),
                ("q-closest", "relatedness"),
                ("q-pair", "relatedness"),
                ("q-equal", "relatedness"),
                ("q-clade", "clades"),
                ("q-smallest", "clades"),
                ("q-fly", "traits"),
                ("q-feathered", "traits"),
                ("q-count", "clades"),
                ("q-order", "order"),
            ],
        ),
    ]
}

#[test]
fn forms_are_test_mode_and_hold_ten_to_twelve_items() {
    for (set_name, cats) in form_categories() {
        let s = set(set_name);
        assert_eq!(s.mode, ReadingMode::Test, "{set_name} must be test mode");
        let n = s.items.len();
        assert!((10..=12).contains(&n), "{set_name} has {n} items");
        // The category table must cover every item.
        for item in &s.items {
            assert!(
                cats.iter().any(|(id, _)| *id == item.id),
                "{set_name}/{} has no category",
                item.id
            );
        }
    }
}

#[test]
fn forms_cover_the_same_category_list() {
    let mut lists: Vec<BTreeSet<&str>> = form_categories()
        .iter()
        .map(|(_, cats)| cats.iter().map(|(_, c)| *c).collect())
        .collect();
    let first = lists.remove(0);
    for (i, other) in lists.iter().enumerate() {
        assert_eq!(
            &first,
            other,
            "form {} categories differ from form A",
            i + 2
        );
    }
}

#[test]
fn each_form_has_a_trait_loss_item() {
    // Each form must contain at least one item whose question asks
    // about a trait that a `loss` mark removes on the item's tree.
    for (set_name, _) in form_categories() {
        let s = set(set_name);
        let found = s.items.iter().any(|item| {
            let loss_traits: BTreeSet<&str> = item
                .trees
                .iter()
                .flat_map(|t| s.trees[t].marks.iter())
                .filter(|m| m.change == Change::Loss)
                .map(|m| m.trait_name.as_str())
                .collect();
            item_traits(&item.question)
                .iter()
                .any(|t| loss_traits.contains(t.as_str()))
        });
        assert!(found, "{set_name} has no trait-loss item");
    }
}

/// Trait names an item's question (or its statements) asks about.
fn item_traits(q: &Question) -> Vec<String> {
    fn ask_traits(a: &TraitAsk) -> Vec<String> {
        match a {
            TraitAsk::WhichHave { trait_name }
            | TraitAsk::HowManyChanges { trait_name }
            | TraitAsk::Homologous { trait_name, .. } => vec![trait_name.clone()],
            TraitAsk::AncestralOrDerived { trait_name, .. } => vec![trait_name.clone()],
            TraitAsk::HasNot { has, lacks } => vec![has.clone(), lacks.clone()],
            _ => vec![],
        }
    }
    match q {
        Question::IsClade { by_trait: Some(t) } => vec![t.clone()],
        Question::Trait { ask } => ask_traits(ask),
        Question::SelectTrue { statements } => statements
            .iter()
            .flat_map(|s| match s {
                Statement::HasTrait { trait_name, .. }
                | Statement::SharedDerived { trait_name, .. } => vec![trait_name.clone()],
                Statement::GainedWithin { inner, outer, .. } => {
                    vec![inner.clone(), outer.clone()]
                }
                _ => vec![],
            })
            .collect(),
        Question::TwoTier { first, .. } => item_traits(first),
        _ => vec![],
    }
}

// --- the coverage manifest (spec §8.3) -------------------------------------------

/// Every format name §8.3's bullets require the coverage set to carry.
fn required_formats() -> Vec<&'static str> {
    vec![
        "which-differs",
        "restyled-differs",
        "order-nodes",
        "order-nodes-times",
        "no-time-component",
        "closest-relative",
        "most-distant",
        "pairwise-equally",
        "relatedness-vs-resemblance",
        "meaning-lines",
        "meaning-nodes",
        "select-true",
        "select-true-across-trees",
        "clade-in-not-in",
        "two-tier",
        "mrca",
        "mrca-lettered-points",
        "place-taxon",
        "reference-conflict",
        "clade-membership",
        "smallest-clade",
        "count-clades",
        "which-fits",
        "trait-which-have",
        "trait-has-not",
        "trait-profile",
        "trait-gain-order",
        "ancestral-vs-derived",
        "homologous-vs-independent",
        "trait-group-phyly",
        "shared-derived",
        "ages-vs-date",
        "rotation-vs-different",
        "concept-progress",
        "concept-still-evolving",
        "soft-polytomy",
        "dendrogram-vs-phylogeny",
        "co-evolution-trees",
    ]
}

/// Every shape × tip-side combination §8.3's style bullet requires.
fn required_styles() -> Vec<&'static str> {
    let mut out = vec![];
    for shape in ["rectangular", "diagonal", "circular"] {
        for tips in ["right", "up", "left", "down"] {
            out.push(format!("{shape}:{tips}").leak() as &'static str);
        }
    }
    out
}

/// Every drawing feature §8.3's style bullet requires.
fn required_features() -> Vec<&'static str> {
    vec![
        "letters",
        "points",
        "branch-points",
        "time-axis",
        "marks",
        "polytomy",
        "fossil-tips",
    ]
}

/// Deferred formats the manifest must list as known gaps.
fn required_gaps() -> Vec<&'static str> {
    vec![
        "character-matrix fit / most-parsimonious placement",
        "branch lengths drawn to a scale bar / V-shaped unrooted trees",
        "colour-mapped ancestral-state reconstructions / counting migrations on a map",
        "support values on branches",
        "error bars on node ages / external event lines on the axis",
    ]
}

/// The effective (shape, tips) for `item`'s `trees[i]`, mirroring
/// `effective_style` in the loader (default rectangular/right).
fn item_style_pair(item: &Item, tree_index: usize) -> (&'static str, &'static str) {
    fn pair(shape: Option<Shape>, tips: Option<TipSide>) -> (&'static str, &'static str) {
        let s = match shape {
            Some(Shape::Diagonal) => "diagonal",
            Some(Shape::Circular) => "circular",
            _ => "rectangular",
        };
        let t = match tips {
            Some(TipSide::Up) => "up",
            Some(TipSide::Left) => "left",
            Some(TipSide::Down) => "down",
            _ => "right",
        };
        (s, t)
    }
    let base = item.style.as_ref();
    if let Some(per) = base.and_then(|s| s.per_tree.get(tree_index)) {
        return pair(Some(per.shape), Some(per.tips));
    }
    pair(base.map(|s| s.shape), base.map(|s| s.tips))
}

/// True when the tree named `name` in `set` has a node with three or
/// more children.
fn tree_has_polytomy(set: &ReadingSet, name: &str) -> bool {
    let tree = parse_newick(&set.trees[name].newick).unwrap();
    tree.nodes.iter().any(|n| n.children.len() > 2)
}

/// True when the tree has a tip with a positive recorded age.
fn tree_has_fossil_tip(set: &ReadingSet, name: &str) -> bool {
    match &set.trees[name].times {
        Some(Times::Ages { ages, .. }) => ages.iter().any(|a| a.on.len() == 1 && a.age > 0.0),
        _ => false,
    }
}

#[test]
fn manifest_entries_map_to_real_items_and_cover_the_spec() {
    let manifest: serde_json::Value =
        serde_json::from_str(&read("coverage/manifest.json")).unwrap();
    let entries = manifest["entries"].as_array().unwrap();
    let mut seen_formats: BTreeSet<String> = BTreeSet::new();
    let mut seen_styles: BTreeSet<String> = BTreeSet::new();
    let mut seen_features: BTreeSet<String> = BTreeSet::new();
    for entry in entries {
        let id = entry["id"].as_str().unwrap();
        let s = set(id);
        seen_formats.insert(entry["format"].as_str().unwrap().to_string());
        let listed_items: Vec<&str> = entry["items"]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap())
            .collect();
        // Every listed item exists; collect the styles it renders in.
        let mut item_styles: BTreeSet<String> = BTreeSet::new();
        for item_id in &listed_items {
            let i = idx(&s, item_id);
            let item = &s.items[i];
            for t in 0..item.trees.len() {
                let (shape, tips) = item_style_pair(item, t);
                item_styles.insert(format!("{shape}:{tips}"));
            }
        }
        for style in entry["styles"].as_array().unwrap() {
            let st = style.as_str().unwrap();
            assert!(
                item_styles.contains(st),
                "{id} entry lists style {st} none of {listed_items:?} renders in"
            );
            seen_styles.insert(st.to_string());
        }
        // Features named in the entry must really be on the items' trees.
        for feature in entry["features"].as_array().unwrap() {
            let f = feature.as_str().unwrap();
            let ok = listed_items.iter().any(|item_id| {
                let item = &s.items[idx(&s, item_id)];
                item.trees.iter().any(|t| {
                    let tree = &s.trees[t];
                    match f {
                        "letters" => !tree.node_letters.is_empty(),
                        "points" => !tree.points.is_empty(),
                        "branch-points" => tree.points.iter().any(|p| p.at == PointAt::Branch),
                        "time-axis" => tree.times.is_some(),
                        "marks" => !tree.marks.is_empty(),
                        "polytomy" => tree_has_polytomy(&s, t),
                        "fossil-tips" => tree_has_fossil_tip(&s, t),
                        other => panic!("unknown manifest feature {other}"),
                    }
                })
            });
            assert!(ok, "{id} entry lists feature {f} no listed item has");
            seen_features.insert(f.to_string());
        }
    }
    for f in required_formats() {
        assert!(
            seen_formats.contains(f),
            "manifest has no entry for required format '{f}'"
        );
    }
    for st in required_styles() {
        assert!(
            seen_styles.contains(st),
            "no manifest entry renders in '{st}'"
        );
    }
    for f in required_features() {
        assert!(
            seen_features.contains(f),
            "no manifest entry covers feature '{f}'"
        );
    }
    // Deferred gaps: every required gap is listed with a deferred_to and reason.
    let gaps = manifest["gaps"].as_array().unwrap();
    for want in required_gaps() {
        let gap = gaps
            .iter()
            .find(|g| g["format"].as_str() == Some(want))
            .unwrap_or_else(|| panic!("manifest lists no gap '{want}'"));
        assert!(
            gap["deferred_to"].is_string(),
            "gap '{want}' has no deferred_to"
        );
        assert!(gap["reason"].is_string(), "gap '{want}' has no reason");
    }
}

// --- provenance -----------------------------------------------------------------

#[test]
fn every_lesson_tree_is_named_in_sources() {
    let sources = read("SOURCES.md");
    for (set_name, _) in &expected() {
        let s = set(set_name);
        for name in s.trees.keys() {
            assert!(
                sources.contains(name.as_str()),
                "{set_name} tree '{name}' has no SOURCES.md entry"
            );
        }
    }
}

// --- the Task-12 rules, applied now ----------------------------------------------

/// The authored `text` of one statement (every variant carries one).
fn statement_text(s: &Statement) -> &str {
    match s {
        Statement::CloserThan { text, .. }
        | Statement::IsClade { text, .. }
        | Statement::CladeInNotIn { text, .. }
        | Statement::SameRelationships { text, .. }
        | Statement::OlderThan { text, .. }
        | Statement::OlderThanAge { text, .. }
        | Statement::LineageAtLeast { text, .. }
        | Statement::HasTrait { text, .. }
        | Statement::SharedDerived { text, .. }
        | Statement::GainedWithin { text, .. } => text,
    }
}

/// Statement text with the one authored number of an age statement
/// removed — the digit check strips it (see the file header).
fn statement_text_for_digit_check(s: &Statement) -> String {
    let text = statement_text(s).to_string();
    match s {
        Statement::OlderThanAge { age, .. } | Statement::LineageAtLeast { age, .. } => {
            text.replace(&format!("{}", age), "")
        }
        _ => text,
    }
}

/// Every student-facing string of an item: `text`, `note_after`, and
/// the authored strings inside the question (`select_true` statement
/// text, `concept` options, `two_tier` reasons). `for_digit_check`
/// strips the authored age out of age statements.
fn item_texts(item: &Item, for_digit_check: bool) -> Vec<String> {
    let mut out = vec![item.text.clone()];
    if let Some(n) = &item.note_after {
        out.push(n.clone());
    }
    fn question_texts(q: &Question, out: &mut Vec<String>, digits: bool) {
        match q {
            Question::SelectTrue { statements } => {
                out.extend(statements.iter().map(|s| {
                    if digits {
                        statement_text_for_digit_check(s)
                    } else {
                        statement_text(s).to_string()
                    }
                }));
            }
            Question::Concept { options, .. } => out.extend(options.iter().cloned()),
            Question::TwoTier { first, reasons, .. } => {
                question_texts(first, out, digits);
                out.extend(reasons.iter().cloned());
            }
            _ => {}
        }
    }
    question_texts(&item.question, &mut out, for_digit_check);
    out
}

/// Whole-word search: `needle` may not appear bounded by ASCII
/// letters (so "cat" is not caught inside "locate").
fn contains_word(haystack: &str, needle: &str) -> bool {
    let is_edge = |c: Option<char>| c.is_none_or(|c| !c.is_ascii_alphanumeric());
    haystack.match_indices(needle).any(|(i, _)| {
        let before = haystack[..i].chars().next_back();
        let after = haystack[i + needle.len()..].chars().next();
        is_edge(before) && is_edge(after)
    })
}

#[test]
fn no_literal_pool_taxon_in_item_text() {
    // The Task-12 placeholder rule, applied to the lessons now (the
    // task instruction): when a tree's taxa are in `taxa_pool`, item
    // text may name them only through {a}/{b}/{c}/{set}, so a v1.5
    // relabel can never desync wording from the tree.
    for (set_name, _) in &expected() {
        let s = set(set_name);
        let pool: Vec<&String> = s.taxa_pool.values().flatten().collect();
        for item in &s.items {
            for text in item_texts(item, false) {
                // The placeholders themselves contain no taxon names.
                let stripped = ["{a}", "{b}", "{c}", "{set}"]
                    .iter()
                    .fold(text.clone(), |t, ph| t.replace(ph, ""));
                for taxon in &pool {
                    assert!(
                        !contains_word(&stripped, taxon),
                        "{set_name}/{} mentions pool taxon '{taxon}': {stripped}",
                        item.id
                    );
                }
            }
        }
    }
}

#[test]
fn no_digits_in_student_facing_text() {
    // The v1.4c numbers-in-text rule for reading sets: title, summary,
    // objectives and every authored item string are digit-free (the
    // engine supplies every number a student sees). Age statements get
    // their authored threshold stripped first.
    for (set_name, _) in &expected() {
        let s = set(set_name);
        let mut fields: Vec<(String, String)> = vec![
            ("title".into(), s.title.clone()),
            ("summary".into(), s.summary.clone()),
        ];
        if let Some(m) = &s.meta {
            for o in &m.objectives {
                fields.push(("objectives".into(), o.clone()));
            }
        }
        for item in &s.items {
            for t in item_texts(item, true) {
                fields.push((item.id.clone(), t));
            }
        }
        for (field, text) in fields {
            let found = text.chars().find(|c| c.is_ascii_digit());
            assert!(
                found.is_none(),
                "{set_name} {field}: digit '{found:?}' in {text:?}"
            );
        }
    }
}
