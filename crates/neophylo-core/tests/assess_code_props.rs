//! Code properties (v1.5 spec §5.4, plan Task 5): `decode ∘ encode`
//! is the identity over canonical payloads, `decode_code` never
//! panics, `unpack ∘ pack` is the identity over every well-formed
//! answer on built-in content, and real codes stay under
//! `max_code_len`.

use std::fs;
use std::path::{Path, PathBuf};

use proptest::prelude::*;

use neophylo_core::assess::{
    decode_code, encode_code, fingerprint, max_code_len, name_table, pack_answer, unpack_answer,
    Assignment, Attempt, CodePayload, Content, GradedTask, IdPrompt, IdRule, Mode, PackedAnswer,
    TaskAnswer, TaskRef, Variant, MAX_ID_BYTES, MAX_TASKS,
};
use neophylo_core::assess::{PairRole, Quantity};
use neophylo_core::exercise::{load_exercise, Exercise};
use neophylo_core::reading::load_reading_set;
use neophylo_core::reading::{Item, Question, ReadingSet, RelForm, Response, TraitAsk};
use neophylo_core::newick::parse_newick;

const LESSON_FILES: [&str; 8] = [
    "bootstrap-basics",
    "cytochrome-c",
    "nj-basics",
    "nj-by-hand",
    "protein-models",
    "saturation",
    "upgma-fails",
    "upgma-vs-nj-matrix",
];

const READING_FILES: [&str; 7] = [
    "trees-clades-traits",
    "trees-closest-relatives",
    "trees-demo",
    "trees-form-a",
    "trees-form-b",
    "trees-reading-a-tree",
    "trees-rotation",
];

fn exercises_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("exercises")
}

fn lesson(id: &str) -> Exercise {
    let text = fs::read_to_string(exercises_dir().join(format!("{id}.json"))).unwrap();
    load_exercise(&text).unwrap()
}

fn reading(file: &str) -> ReadingSet {
    let text = fs::read_to_string(exercises_dir().join("reading").join(format!("{file}.json")))
        .unwrap();
    load_reading_set(&text).unwrap()
}

// --- decode properties -------------------------------------------------------

fn arb_packed() -> impl Strategy<Value = PackedAnswer> {
    let small = prop_oneof![
        (0u8..=62).prop_map(PackedAnswer::Letter),
        any::<u8>().prop_map(PackedAnswer::Choice),
        any::<u32>().prop_map(PackedAnswer::Number),
        (0u8..=2).prop_map(PackedAnswer::Pairwise),
        (i32::MIN + 1..=i32::MAX).prop_map(PackedAnswer::Numeric),
    ];
    prop_oneof![
        (any::<u16>(), any::<u16>())
            .prop_map(|(a, b)| PackedAnswer::Pair(a.min(b), a.max(b))),
        prop::collection::vec(0u8..64, 0..10)
            .prop_map(|mut v| {
                v.sort_unstable();
                v.dedup();
                PackedAnswer::Tips(v)
            }),
        any::<u64>().prop_map(PackedAnswer::Order),
        small.clone(),
        prop::collection::vec(0u8..64, 0..10)
            .prop_map(|mut v| {
                v.sort_unstable();
                v.dedup();
                PackedAnswer::Choices(v)
            }),
        (small, any::<u8>())
            .prop_map(|(first, reason)| PackedAnswer::TwoTier {
                first: Box::new(first),
                reason,
            }),
    ]
}

fn arb_attempt() -> impl Strategy<Value = Attempt> {
    (arb_packed(), arb_packed(), 0u8..=15).prop_map(|(first, other, attempts)| {
        // Canonical: `last` differs from `first` and shares its tag;
        // a Skipped first never carries one.
        let same_kind = std::mem::discriminant(&first) == std::mem::discriminant(&other);
        let last = if same_kind && other != first && first != PackedAnswer::Skipped {
            Some(other)
        } else {
            None
        };
        Attempt {
            first,
            last,
            attempts,
        }
    })
}

fn arb_payload() -> impl Strategy<Value = CodePayload> {
    (
        prop::collection::vec(0x20u8..0x7f, 0..=MAX_ID_BYTES)
            .prop_map(|b| String::from_utf8(b).unwrap()),
        0u32..=0xF_FFFF,
        0u8..=50,
        prop::collection::vec(arb_attempt(), 1..=MAX_TASKS),
        0u32..=0xFF_FFFF,
    )
        .prop_map(
            |(student_id, fingerprint, retry, attempts, finished_min)| CodePayload {
                format: 1,
                generator: 1,
                fingerprint,
                student_id,
                retry,
                attempts,
                finished_min,
            },
        )
}

proptest! {
    #[test]
    fn decode_of_encode_is_the_payload(p in arb_payload()) {
        let code = encode_code(&p).unwrap();
        prop_assert_eq!(decode_code(&code).unwrap(), p);
    }

    /// The decoder never panics and never yields an error kind other
    /// than InvalidCode, on arbitrary text.
    #[test]
    fn decode_never_panics(s in "\\PC*") {
        match decode_code(&s) {
            Err(neophylo_core::NeoError::InvalidCode { .. }) | Ok(_) => {}
            Err(e) => prop_assert!(false, "unexpected error {e:?}"),
        }
    }
}

// --- pack/unpack over built-in content -----------------------------------------

/// The item's first tree's tip labels — the tree the app shows it on.
fn item_tips(set: &ReadingSet, item: &Item) -> Vec<String> {
    let rt = &set.trees[&item.trees[0]];
    parse_newick(&rt.newick).unwrap().leaf_labels()
}

/// Every well-formed response a question's widget can produce — a
/// small canonical set per kind (the property test sweeps these).
fn canonical_responses(set: &ReadingSet, item: &Item) -> Vec<Response> {
    let tips = item_tips(set, item);
    let pick = |n: usize| -> Vec<Response> {
        vec![Response::Tips {
            tips: tips.iter().take(n).cloned().collect(),
        }]
    };
    match &item.question {
        Question::WhichDiffers { .. } | Question::WhichFits { .. } => (0..item.trees.len() + 1)
            .map(|index| Response::Choice { index })
            .collect(),
        Question::IsClade { .. } => vec![Response::Choice { index: 0 }],
        Question::Concept { options, .. } => vec![
            Response::Choices { indices: vec![] },
            Response::Choices {
                indices: vec![options.len().saturating_sub(1)],
            },
        ],
        Question::SelectTrue { statements } => vec![
            Response::Choices {
                indices: (0..statements.len()).collect(),
            },
            Response::Choices { indices: vec![1] },
        ],
        Question::Mrca { options: Some(o) } => o
            .iter()
            .map(|letter| Response::Point {
                letter: letter.clone(),
            })
            .collect(),
        Question::Mrca { options: None } | Question::SmallestClade => pick(2)
            .into_iter()
            .map(|r| {
                let Response::Tips { tips } = r else { unreachable!() };
                Response::Node { clade: tips }
            })
            .collect(),
        Question::PlaceTaxon { .. } => set.trees[&item.trees[0]]
            .points
            .iter()
            .map(|p| Response::Point {
                letter: p.letter.clone(),
            })
            .collect(),
        Question::ClosestRelative {
            form: RelForm::Pairwise,
            ..
        } => vec![
            Response::Pairwise {
                answer: neophylo_core::reading::Closer::B,
            },
            Response::Pairwise {
                answer: neophylo_core::reading::Closer::Equal,
            },
        ],
        Question::ClosestRelative { .. } => pick(1)
            .into_iter()
            .chain(pick(3))
            .collect(),
        Question::CountClades => vec![Response::Number { value: 0 }, Response::Number { value: 5 }],
        Question::OrderNodes { nodes } => {
            let mut rev = nodes.clone();
            rev.reverse();
            vec![
                Response::Order {
                    letters: nodes.clone(),
                },
                Response::Order { letters: rev },
            ]
        }
        Question::Trait { ask } => match ask {
            TraitAsk::WhichHave { .. } | TraitAsk::HasNot { .. } => pick(2),
            TraitAsk::WhichShared { .. }
            | TraitAsk::AncestralOrDerived { .. }
            | TraitAsk::Homologous { .. } => vec![Response::Choice { index: 0 }],
            TraitAsk::HowManyChanges { .. } => vec![Response::Number { value: 1 }],
            TraitAsk::Profile { .. } => vec![Response::Choices { indices: vec![0] }],
        },
        Question::TwoTier {
            first, reasons, ..
        } => {
            let inner_item = Item {
                question: (**first).clone(),
                ..item.clone()
            };
            let inners = canonical_responses(set, &inner_item);
            let mut out = Vec::new();
            for inner in inners.iter().cloned() {
                out.push(Response::TwoTier {
                    first: Box::new(inner),
                    reason: 0,
                });
            }
            if let (Some(inner), true) = (inners.into_iter().next(), !reasons.is_empty()) {
                out.push(Response::TwoTier {
                    first: Box::new(inner),
                    reason: reasons.len() - 1,
                });
            }
            out
        }
    }
}

/// The canonical wire form of a response: tips/choices sorted and
/// deduplicated — what a round trip returns.
fn canon(r: &Response) -> Response {
    let sorted = |v: &[String]| -> Vec<String> {
        let mut v = v.to_vec();
        v.sort();
        v.dedup();
        v
    };
    match r {
        Response::Choices { indices } => Response::Choices {
            indices: {
                let mut v = indices.clone();
                v.sort_unstable();
                v.dedup();
                v
            },
        },
        Response::Tips { tips } => Response::Tips {
            tips: sorted(tips),
        },
        Response::Node { clade } => Response::Node {
            clade: sorted(clade),
        },
        Response::TwoTier { first, reason } => Response::TwoTier {
            first: Box::new(canon(first)),
            reason: *reason,
        },
        other => other.clone(),
    }
}

/// `unpack(pack(x)) == x` for every well-formed answer of every
/// reading item on every built-in reading set.
#[test]
fn unpack_of_pack_is_the_answer_on_reading_items() {
    for file in READING_FILES {
        let set = reading(file);
        let v = Variant {
            content: Content::Reading(set.clone()),
            seed: 7,
            retry: 0,
            fell_back: false,
        };
        for (i, item) in set.items.iter().enumerate() {
            let task = TaskRef::Reading { item: i };
            for r in canonical_responses(&set, item) {
                let packed = pack_answer(&v, &task, &TaskAnswer::Reading(r.clone()))
                    .unwrap_or_else(|e| panic!("{file} item {} pack {r:?}: {e}", item.id));
                let back = unpack_answer(&v, &task, &packed)
                    .unwrap_or_else(|e| panic!("{file} item {} unpack {packed:?}: {e}", item.id));
                // Canonical forms come back identical (tips/choices
                // may reorder to the sorted wire form).
                assert_eq!(
                    back,
                    TaskAnswer::Reading(canon(&r)),
                    "{file} item {}",
                    item.id
                );
            }
        }
    }
}

/// The same property on exercise tasks: pairs, branches, numbers.
#[test]
fn unpack_of_pack_is_the_answer_on_exercise_tasks() {
    for id in LESSON_FILES {
        let v = Variant {
            content: Content::Exercise(lesson(id)),
            seed: 3,
            retry: 0,
            fell_back: false,
        };
        let table = name_table(&v).unwrap();
        let mut clade: Vec<String> = table.iter().take(2).cloned().collect();
        clade.sort();
        let answers = [
            (
                TaskRef::PredictPair { step: 1 },
                TaskAnswer::Pair(0, (table.len() - 1) as u16),
            ),
            (TaskRef::PredictBranch, TaskAnswer::Branch(clade)),
            (
                TaskRef::Numeric {
                    step: 1,
                    quantity: Quantity::CorrectedDistance,
                    role: PairRole::Chosen,
                },
                TaskAnswer::Number(-1_234_567),
            ),
        ];
        for (task, a) in answers {
            let packed = pack_answer(&v, &task, &a)
                .unwrap_or_else(|e| panic!("{id} pack {a:?}: {e}"));
            assert_eq!(
                unpack_answer(&v, &task, &packed).unwrap(),
                a,
                "{id} {task:?}"
            );
        }
    }
}

/// A full round trip: answers packed into a real code decode back to
/// the same packed answers.
#[test]
fn a_code_of_packed_answers_decodes_back() {
    let set = reading("trees-demo");
    let content = Content::Reading(set.clone());
    let v = Variant {
        content,
        seed: 11,
        retry: 0,
        fell_back: false,
    };
    let mut attempts = Vec::new();
    for (i, item) in set.items.iter().enumerate().take(10) {
        let task = TaskRef::Reading { item: i };
        for r in canonical_responses(&set, item).into_iter().take(1) {
            attempts.push(Attempt {
                first: pack_answer(&v, &task, &TaskAnswer::Reading(r)).unwrap(),
                last: None,
                attempts: 2,
            });
            break;
        }
    }
    let p = CodePayload {
        format: 1,
        generator: 1,
        fingerprint: 42,
        student_id: "josé".to_string(),
        retry: 0,
        attempts,
        finished_min: 9_999,
    };
    assert_eq!(decode_code(&encode_code(&p).unwrap()).unwrap(), p);
}

// --- the bound -------------------------------------------------------------------

fn assignment(content: Content, tasks: Vec<GradedTask>) -> Assignment {
    Assignment {
        id: "asst-1".to_string(),
        title: "t".to_string(),
        instructions: None,
        content,
        content_hash: None,
        served_content_hash: None,
        id_prompt: IdPrompt {
            label: "Student ID".to_string(),
            rule: IdRule::TrimLower,
        },
        mode: Mode::Practice,
        variation: true,
        tasks,
    }
}

/// Every task's worst payload encodes within the assignment's bound.
#[test]
fn encoded_payloads_stay_under_the_bound() {
    let cases: Vec<(Content, Vec<TaskRef>)> = vec![
        (
            Content::Exercise(lesson("nj-basics")),
            vec![
                TaskRef::PredictPair { step: 1 },
                TaskRef::PredictBranch,
                TaskRef::Numeric {
                    step: 1,
                    quantity: Quantity::CorrectedDistance,
                    role: PairRole::Chosen,
                },
            ],
        ),
        (
            Content::Reading(reading("trees-demo")),
            (0..15).map(|item| TaskRef::Reading { item }).collect(),
        ),
    ];
    for (which, (content, tasks)) in cases.iter().enumerate() {
        let a = assignment(
            content.clone(),
            tasks
                .iter()
                .map(|task| GradedTask {
                    task: task.clone(),
                    points: 1.0,
                })
                .collect(),
        );
        let bound = max_code_len(&a);
        let v = Variant {
            content: content.clone(),
            seed: 1,
            retry: 0,
            fell_back: false,
        };
        // The widest packed answer per task, encoded with a max id —
        // must fit the bound.
        let attempts = tasks
            .iter()
            .map(|task| {
                let widest = widest_packed(&v, task);
                Attempt {
                    first: widest.clone(),
                    last: Some(other_of(&widest)),
                    attempts: 15,
                }
            })
            .collect::<Vec<_>>();
        let p = CodePayload {
            format: 1,
            generator: 1,
            fingerprint: fingerprint(&a),
            student_id: "x".repeat(MAX_ID_BYTES),
            retry: 0,
            attempts,
            finished_min: 0xFF_FFFF,
        };
        let code = encode_code(&p).unwrap();
        assert!(
            code.len() <= bound,
            "case {which}: {} chars exceeds bound {bound}",
            code.len()
        );
    }
}

/// A small same-tag value distinct from `widest_packed`'s pick — so
/// `has_last` is exercised in the bound test.
fn other_of(a: &PackedAnswer) -> PackedAnswer {
    match a {
        PackedAnswer::Pair(..) => PackedAnswer::Pair(0, 1),
        PackedAnswer::Tips(..) => PackedAnswer::Tips(vec![0]),
        PackedAnswer::Letter(..) => PackedAnswer::Letter(0),
        PackedAnswer::Order(..) => PackedAnswer::Order(0),
        PackedAnswer::Choice(..) => PackedAnswer::Choice(0),
        PackedAnswer::Choices(..) => PackedAnswer::Choices(vec![0]),
        PackedAnswer::Number(..) => PackedAnswer::Number(0),
        PackedAnswer::Pairwise(..) => PackedAnswer::Pairwise(0),
        PackedAnswer::TwoTier { first, .. } => PackedAnswer::TwoTier {
            first: first.clone(),
            reason: 0,
        },
        PackedAnswer::Numeric(..) => PackedAnswer::Numeric(0),
        PackedAnswer::Skipped => PackedAnswer::Skipped,
    }
}

/// A representative worst-width packed answer for a task — the same
/// kinds `max_code_len` prices (Tips/Order/Choices → 64-bit masks,
/// Letter/Choice → 8, Number → 32, Pairwise → 2).
fn widest_packed(v: &Variant, task: &TaskRef) -> PackedAnswer {
    fn w(q: &Question) -> PackedAnswer {
        match q {
            Question::Mrca { options: Some(_) } | Question::PlaceTaxon { .. } => {
                PackedAnswer::Letter(62)
            }
            Question::ClosestRelative {
                form: RelForm::Pairwise,
            } => PackedAnswer::Pairwise(2),
            Question::CountClades
            | Question::Trait {
                ask: TraitAsk::HowManyChanges { .. },
            } => PackedAnswer::Number(u32::MAX),
            Question::WhichDiffers { .. }
            | Question::WhichFits { .. }
            | Question::IsClade { .. }
            | Question::Trait {
                ask:
                    TraitAsk::WhichShared { .. }
                    | TraitAsk::AncestralOrDerived { .. }
                    | TraitAsk::Homologous { .. },
            } => PackedAnswer::Choice(255),
            Question::TwoTier { first, .. } => PackedAnswer::TwoTier {
                first: Box::new(w(first)),
                reason: 200,
            },
            // Everything else prices at 64 bits: tip sets, orders,
            // multi-option picks.
            _ => PackedAnswer::Tips((0..64).collect()),
        }
    }
    match (task, &v.content) {
        (TaskRef::PredictPair { .. }, _) => PackedAnswer::Pair(0, u16::MAX),
        (TaskRef::PredictBranch, _) => PackedAnswer::Tips((0..64).collect()),
        (TaskRef::Numeric { .. }, _) => PackedAnswer::Numeric(i32::MAX),
        (TaskRef::Reading { item }, Content::Reading(set)) => w(&set.items[*item].question),
        (TaskRef::Reading { .. }, _) => PackedAnswer::Tips((0..64).collect()),
    }
}
