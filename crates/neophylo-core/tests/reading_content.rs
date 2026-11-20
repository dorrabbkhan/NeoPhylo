//! Content checks for the shipped reading lessons (v1.4d plan Task 11,
//! spec §8.1). The lessons live in `exercises/reading/`; this test is
//! their oracle — every expectation below was written by hand against
//! the trees, never copied out of the content files.
//!
//! - every built-in set in `exercises/reading/*.json` loads;
//! - each item of the four lessons computes to the stored answer
//!   (matched by item id);
//! - every tree name in the four lessons appears in `SOURCES.md`;
//! - no `taxa_pool` taxon appears literally in student-facing text
//!   (the Task-12 rule, applied now so v1.5 relabelling stays
//!   correct);
//! - no digits in student-facing text — the v1.4c numbers-in-text
//!   rule (`web/src/lessons/content.test.ts`) applied to reading
//!   sets: every number a student sees must come from the engine.

use std::fs;
use std::path::PathBuf;

use neophylo_core::reading::{
    answer, check, load_reading_set, Accepted, AnswerKey, Closer, ReadingSet, Response,
};

fn reading_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../exercises/reading")
}

fn read(name: &str) -> String {
    fs::read_to_string(reading_dir().join(name)).unwrap_or_else(|e| panic!("{name}: {e}"))
}

fn set(name: &str) -> ReadingSet {
    load_reading_set(&read(&format!("{name}.json"))).unwrap_or_else(|e| panic!("{name}: {e}"))
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
    // The demo set plus the four lessons; the pin keeps the scan from
    // quietly shrinking (Task 12 adds forms and coverage, which this
    // bound still covers).
    assert!(
        files.len() >= 5,
        "expected at least the demo set and four lessons, found {files:?}"
    );
    for p in files {
        let text = fs::read_to_string(&p).unwrap();
        load_reading_set(&text).unwrap_or_else(|e| panic!("{}: {e}", p.display()));
    }
}

// --- computed answers match the stored expectations -----------------------------

/// (set id, [(item id, accepted answer)]) — every item of each lesson
/// must be listed; an unlisted item fails the completeness pass.
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

use neophylo_core::reading::{Item, Question, Statement};

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

/// Every student-facing string of an item: `text`, `note_after`, and
/// the authored strings inside the question (`select_true` statement
/// text, `concept` options, `two_tier` reasons).
fn item_texts(item: &Item) -> Vec<String> {
    let mut out = vec![item.text.clone()];
    if let Some(n) = &item.note_after {
        out.push(n.clone());
    }
    fn question_texts(q: &Question, out: &mut Vec<String>) {
        match q {
            Question::SelectTrue { statements } => {
                out.extend(statements.iter().map(|s| statement_text(s).to_string()));
            }
            Question::Concept { options, .. } => out.extend(options.iter().cloned()),
            Question::TwoTier { first, reasons, .. } => {
                question_texts(first, out);
                out.extend(reasons.iter().cloned());
            }
            _ => {}
        }
    }
    question_texts(&item.question, &mut out);
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
            for text in item_texts(item) {
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
    // engine supplies every number a student sees).
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
            for t in item_texts(item) {
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
