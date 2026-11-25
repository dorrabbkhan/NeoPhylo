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
use neophylo_core::newick::parse_newick;
use neophylo_core::reading::load_reading_set;
use neophylo_core::reading::{Item, Question, ReadingSet, RelForm, Response, TraitAsk};

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
    let text =
        fs::read_to_string(exercises_dir().join("reading").join(format!("{file}.json"))).unwrap();
    load_reading_set(&text).unwrap()
}

// --- decode properties -------------------------------------------------------

/// Packed answers encodable on a `n`-name table — tip indices stay
/// under `n`, order positions under the count the wire writes.
fn arb_packed(n: usize) -> impl Strategy<Value = PackedAnswer> {
    let n16 = n.max(1).min(u16::MAX as usize) as u16;
    let n8 = n.min(255) as u8;
    let small = prop_oneof![
        (0u8..=62).prop_map(PackedAnswer::Letter),
        any::<u8>().prop_map(PackedAnswer::Choice),
        any::<u32>().prop_map(PackedAnswer::Number),
        (0u8..=2).prop_map(PackedAnswer::Pairwise),
        (i32::MIN + 1..=i32::MAX).prop_map(PackedAnswer::Numeric),
    ];
    prop_oneof![
        (0..n16, 0..n16).prop_map(|(a, b)| PackedAnswer::Pair(a.min(b), a.max(b))),
        prop::collection::vec(0..n8, 0..10).prop_map(|mut v| {
            v.sort_unstable();
            v.dedup();
            PackedAnswer::Tips(v)
        }),
        (0..=127usize)
            .prop_flat_map(|k| prop::collection::vec(0..k as u8, k..=k))
            .prop_map(PackedAnswer::Order),
        small.clone(),
        prop::collection::vec(0u8..=254, 0..10).prop_map(|mut v| {
            v.sort_unstable();
            v.dedup();
            PackedAnswer::Choices(v)
        }),
        (small, any::<u8>()).prop_map(|(first, reason)| PackedAnswer::TwoTier {
            first: Box::new(first),
            reason,
        }),
    ]
}

fn arb_attempt(n: usize) -> impl Strategy<Value = Attempt> {
    (arb_packed(n), arb_packed(n), 0u8..=15).prop_map(|(first, other, attempts)| {
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
    (1usize..=200).prop_flat_map(|n| {
        (
            prop::collection::vec(0x20u8..0x7f, 1..=MAX_ID_BYTES)
                .prop_map(|b| String::from_utf8(b).unwrap()),
            0u32..=0xF_FFFF,
            0u8..=50,
            prop::collection::vec(arb_attempt(n), 1..=MAX_TASKS),
            0u32..=0xFF_FFFF,
        )
            .prop_map(
                move |(student_id, fingerprint, retry, attempts, finished_min)| CodePayload {
                    format: 1,
                    generator: 1,
                    fingerprint,
                    student_id,
                    retry,
                    names: n as u8,
                    attempts,
                    finished_min,
                },
            )
    })
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

    /// Plan Step 1's property: changing any single symbol of a valid
    /// code — any position after `NP1-`, CRC and padded tail included —
    /// is always caught: `length` when the change lands in the last
    /// symbol's nonzero pad bits (the pad check fires first), else
    /// `checksum` — a ≤5-bit change to the payload or its stored CRC
    /// can never coincide. Never `Ok`.
    #[test]
    fn a_single_symbol_change_is_always_caught(
        p in arb_payload(),
        pos in any::<usize>(),
        delta in 1u8..=31,
    ) {
        const ALPHA: &[u8; 32] = b"0123456789ABCDEFGHJKMNPQRSTVWXYZ";
        let code = encode_code(&p).unwrap();
        // Symbol positions = base32 chars after the `NP1-` prefix.
        let at: Vec<usize> = code
            .char_indices()
            .skip(4)
            .filter(|(_, c)| ALPHA.contains(&(*c as u8)))
            .map(|(i, _)| i)
            .collect();
        let s = at.len();
        let i = at[pos % s];
        let old = code.as_bytes()[i];
        let old_v = ALPHA.iter().position(|&x| x == old).unwrap();
        let new_v = (old_v + usize::from(delta)) % 32;
        prop_assert_ne!(old_v, new_v);
        let mut broken = code.clone().into_bytes();
        broken[i] = ALPHA[new_v];
        let broken = String::from_utf8(broken).unwrap();
        // Expected reason: the last symbol pads the bit count; a flip
        // inside its pad bits reads "length" before the CRC is seen.
        let pad = (5 * s) % 8;
        let in_pad = i == *at.last().unwrap()
            && pad > 0
            && (new_v & ((1 << pad) - 1)) != 0;
        let want = if in_pad { "length" } else { "checksum" };
        match decode_code(&broken) {
            Err(neophylo_core::NeoError::InvalidCode { reason }) => {
                prop_assert_eq!(reason.as_str(), want, "symbol {}/{}", pos % s, s)
            }
            Ok(out) => prop_assert!(false, "mutated code decoded: {out:?}"),
            Err(e) => prop_assert!(false, "unexpected error kind {e:?}"),
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
                let Response::Tips { tips } = r else {
                    unreachable!()
                };
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
        Question::ClosestRelative { .. } => pick(1).into_iter().chain(pick(3)).collect(),
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
        Question::TwoTier { first, reasons, .. } => {
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
        Response::Tips { tips } => Response::Tips { tips: sorted(tips) },
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
            let packed =
                pack_answer(&v, &task, &a).unwrap_or_else(|e| panic!("{id} pack {a:?}: {e}"));
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
        if let Some(r) = canonical_responses(&set, item).into_iter().next() {
            attempts.push(Attempt {
                first: pack_answer(&v, &task, &TaskAnswer::Reading(r)).unwrap(),
                last: None,
                attempts: 2,
            });
        }
    }
    let p = CodePayload {
        format: 1,
        generator: 1,
        fingerprint: 42,
        student_id: "josé".to_string(),
        retry: 0,
        names: name_table(&v).unwrap().len() as u8,
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
                    task: *task,
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
            names: name_table(&v).unwrap().len() as u8,
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
        PackedAnswer::Order(..) => PackedAnswer::Order(vec![0]),
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
/// fields `max_code_len` prices, at the content's own counts: an
/// `N`-bit tip mask, `k` order positions, `m`-wide option masks and
/// the top index of each single-pick domain.
fn widest_packed(v: &Variant, task: &TaskRef) -> PackedAnswer {
    let n = name_table(v).map(|t| t.len()).unwrap_or(0);
    fn domain(set: &ReadingSet, item: &Item, q: &Question) -> usize {
        match q {
            Question::WhichDiffers { .. } => item.trees.len() + 1,
            Question::WhichFits { .. } => item.trees.len().max(1),
            Question::IsClade { by_trait } => 2 + usize::from(by_trait.is_some()),
            Question::Concept { options, .. } => options.len(),
            Question::SelectTrue { statements } => statements.len(),
            Question::OrderNodes { nodes } => nodes.len(),
            Question::Trait {
                ask: TraitAsk::Profile { .. },
            } => {
                let rt = &set.trees[&item.trees[0]];
                let mut names: std::collections::BTreeSet<&str> =
                    rt.traits.iter().map(|t| t.name.as_str()).collect();
                for m in &rt.marks {
                    names.insert(m.trait_name.as_str());
                }
                names.len().max(1)
            }
            Question::Trait { .. } => 2,
            Question::TwoTier { first, .. } => domain(set, item, first),
            _ => 2,
        }
    }
    fn w(set: &ReadingSet, item: &Item, q: &Question, n: usize) -> PackedAnswer {
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
            Question::OrderNodes { nodes } => PackedAnswer::Order((0..nodes.len() as u8).collect()),
            Question::Concept { .. }
            | Question::SelectTrue { .. }
            | Question::Trait {
                ask: TraitAsk::Profile { .. },
            } => PackedAnswer::Choices((0..domain(set, item, q) as u8).collect()),
            Question::WhichDiffers { .. }
            | Question::WhichFits { .. }
            | Question::IsClade { .. }
            | Question::Trait {
                ask:
                    TraitAsk::WhichShared { .. }
                    | TraitAsk::AncestralOrDerived { .. }
                    | TraitAsk::Homologous { .. },
            } => PackedAnswer::Choice(domain(set, item, q).saturating_sub(1) as u8),
            Question::TwoTier { first, reasons, .. } => PackedAnswer::TwoTier {
                first: Box::new(w(set, item, first, n)),
                reason: reasons.len().saturating_sub(1) as u8,
            },
            // Tip-set widgets: the whole table's indices.
            _ => PackedAnswer::Tips((0..n as u8).collect()),
        }
    }
    match (task, &v.content) {
        (TaskRef::PredictPair { .. }, _) => PackedAnswer::Pair(0, n.saturating_sub(1) as u16),
        (TaskRef::PredictBranch, _) => PackedAnswer::Tips((0..n as u8).collect()),
        (TaskRef::Numeric { .. }, _) => PackedAnswer::Numeric(i32::MAX),
        (TaskRef::Reading { item }, Content::Reading(set)) => {
            w(set, &set.items[*item], &set.items[*item].question, n)
        }
        (TaskRef::Reading { .. }, _) => PackedAnswer::Tips((0..n as u8).collect()),
    }
}
