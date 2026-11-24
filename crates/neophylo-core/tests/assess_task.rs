//! Gradable tasks (v1.5 spec §5.3, plan Task 4): `task_key` computes
//! the accepted answer from the variant, `check_task` scores a
//! student's `TaskAnswer` against it — tie-aware `predict_pair`,
//! numeric tasks at display precision, `predict_branch` and reading
//! items. A correct student scores 100 % on every built-in; changing
//! one answer flips exactly that task.

use std::fs;
use std::path::{Path, PathBuf};

use neophylo_core::algos::Method;
use neophylo_core::assess::{
    check_task, make_variant, scaled, task_key, AcceptedAnswer, Content, PairRole, Premise,
    Quantity, TaskAnswer, TaskRef, Variant,
};
use neophylo_core::dist::DistModel;
use neophylo_core::exercise::{
    load_exercise, Analysis, Exercise, ExerciseData, PromptType, Source,
};
use neophylo_core::reading::{answer, check, load_reading_set, Accepted, Question, Response};
use neophylo_core::worksheet::worksheet_facts;
use neophylo_core::{Alphabet, NeoError};

fn exercises_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("exercises")
}

fn lesson(id: &str) -> Exercise {
    let text = fs::read_to_string(exercises_dir().join(format!("{id}.json")))
        .unwrap_or_else(|e| panic!("{id}: {e}"));
    load_exercise(&text).unwrap_or_else(|e| panic!("{id}: {e}"))
}

fn variant(content: Content) -> Variant {
    make_variant(&content, declared(&content), 42, true).unwrap()
}

fn declared(content: &Content) -> &[Premise] {
    match content {
        Content::Exercise(ex) => &ex.premises,
        Content::Reading(set) => &set.premises,
    }
}

/// Heap's-algorithm permutation enumeration — calls `f` on each
/// ordering of `xs`.
fn permute<T: Clone>(xs: &mut [T], k: usize, f: &mut impl FnMut(&[T])) {
    if k >= xs.len() {
        f(xs);
        return;
    }
    permute(xs, k + 1, f);
    for i in 0..k {
        if k.is_multiple_of(2) {
            xs.swap(i, k);
        } else {
            xs.swap(0, k);
        }
        permute(xs, k + 1, f);
    }
}

/// A 4-taxon hand matrix whose first (only) NJ join has a
/// complementary tie: `Q(a,b) == Q(c,d)` strictly minimal.
fn tie_exercise() -> Exercise {
    Exercise {
        schema_version: 5,
        id: "tie".to_string(),
        title: "tie".to_string(),
        alphabet: Alphabet::Dna,
        data: ExerciseData::Matrix {
            names: vec!["a".into(), "b".into(), "c".into(), "d".into()],
            // (b,a) (c,a) (c,b) (d,a) (d,b) (d,c)
            lower: vec![2.0, 6.0, 6.0, 6.0, 6.0, 2.0],
            source: Source {
                citation: "c".into(),
                license: "l".into(),
                accessions: vec![],
            },
        },
        reference: None,
        analysis: Analysis {
            correction: DistModel::Supplied,
            method: Method::Nj,
            kappa: None,
            site_filter: None,
        },
        locked: vec![],
        prompts: vec![],
        bootstrap: None,
        meta: None,
        premises: vec![],
    }
}

fn correct_response(set: &neophylo_core::reading::ReadingSet, item: usize) -> Response {
    fn of(set: &neophylo_core::reading::ReadingSet, item: usize, acc: &Accepted) -> Response {
        match acc {
            Accepted::Choices(v) => Response::Choices { indices: v.clone() },
            Accepted::Clade(k) => Response::Node { clade: k.clone() },
            Accepted::Point(l) => Response::Point { letter: l.clone() },
            Accepted::TipSet(k) | Accepted::AnyTipOf(k) => Response::Tips { tips: k.clone() },
            Accepted::Orders { .. } => {
                let Question::OrderNodes { nodes, .. } = &set.items[item].question else {
                    panic!("orders accepted without order_nodes")
                };
                // The declared node order isn't necessarily a valid
                // answer — find the permutation `check` accepts.
                let mut letters = nodes.clone();
                let mut found = None;
                permute(&mut letters, 0, &mut |l| {
                    if found.is_none()
                        && check(
                            set,
                            item,
                            &Response::Order {
                                letters: l.to_vec(),
                            },
                        )
                        .map(|v| v.correct)
                        .unwrap_or(false)
                    {
                        found = Some(l.to_vec());
                    }
                });
                Response::Order {
                    letters: found.expect("an orders item has an accepted order"),
                }
            }
            Accepted::Number(n) => Response::Number { value: *n },
            Accepted::Pairwise(c) => Response::Pairwise { answer: *c },
            Accepted::Statements(v) => Response::Choices {
                indices: v
                    .iter()
                    .enumerate()
                    .filter(|(_, t)| **t)
                    .map(|(i, _)| i)
                    .collect(),
            },
            Accepted::TwoTier { first, reason } => Response::TwoTier {
                first: Box::new(of(set, item, first)),
                reason: *reason,
            },
        }
    }
    of(set, item, &answer(set, item).unwrap().accepted)
}

// --- predict_pair -----------------------------------------------------------

#[test]
fn predict_pair_accepts_every_pair_of_a_same_split_tie() {
    let v = variant(Content::Exercise(tie_exercise()));
    let facts = {
        let Content::Exercise(ex) = &v.content else {
            panic!("exercise")
        };
        let m = match &ex.data {
            ExerciseData::Matrix { names, lower, .. } => {
                neophylo_core::matrix_input::DistanceInput {
                    names: names.clone(),
                    lower: lower.clone(),
                }
                .to_distance_matrix()
                .unwrap()
            }
            _ => panic!("matrix data"),
        };
        worksheet_facts(&m, ex.analysis.method).unwrap()
    };
    assert!(
        facts[0].tie_same_split,
        "the fixture must tie complementary pairs"
    );

    let task = TaskRef::PredictPair { step: 1 };
    // Both tied pairs are accepted …
    assert!(check_task(&v, &task, &TaskAnswer::Pair(0, 1)).unwrap());
    assert!(check_task(&v, &task, &TaskAnswer::Pair(2, 3)).unwrap());
    // … unordered …
    assert!(check_task(&v, &task, &TaskAnswer::Pair(1, 0)).unwrap());
    // … and anything else is wrong.
    assert!(!check_task(&v, &task, &TaskAnswer::Pair(0, 2)).unwrap());
    assert!(!check_task(&v, &task, &TaskAnswer::Pair(1, 3)).unwrap());
}

#[test]
fn predict_pair_on_ambiguous_tie_accepts_tied_pairs() {
    // A tie that is NOT the same split still accepts every tied pair —
    // documented behaviour; `tie_free` is what keeps built-ins fair.
    // 5 taxa: d(a,b)=d(c,d)=2, all else 6 → Q(a,b)=Q(c,d)=-34 minimal;
    // at five active nodes the tied pairs can't be complementary.
    let mut ex = tie_exercise();
    ex.data = ExerciseData::Matrix {
        names: vec!["a".into(), "b".into(), "c".into(), "d".into(), "e".into()],
        lower: vec![2.0, 6.0, 6.0, 6.0, 6.0, 2.0, 6.0, 6.0, 6.0, 6.0],
        source: Source {
            citation: "c".into(),
            license: "l".into(),
            accessions: vec![],
        },
    };
    let v = variant(Content::Exercise(ex));
    let task = TaskRef::PredictPair { step: 1 };
    let AcceptedAnswer::Pairs(pairs) = task_key(&v, &task).unwrap() else {
        panic!("predict_pair yields pairs")
    };
    assert_eq!(pairs, vec![(0, 1), (2, 3)]);
    assert!(check_task(&v, &task, &TaskAnswer::Pair(0, 1)).unwrap());
    assert!(check_task(&v, &task, &TaskAnswer::Pair(2, 3)).unwrap());
    assert!(!check_task(&v, &task, &TaskAnswer::Pair(0, 2)).unwrap());
}

// --- numeric tasks -----------------------------------------------------------

#[test]
fn precision_rounds_half_away_on_the_exact_decimal() {
    // JS `toFixed` semantics pinned as scaled integers (conductor's
    // known-answer list): `x @ d` means `scaled(x, d)`.
    assert_eq!(scaled(0.125, 2).unwrap(), 13);
    assert_eq!(scaled(-0.125, 2).unwrap(), -13);
    assert_eq!(scaled(2.5, 0).unwrap(), 3);
    assert_eq!(scaled(-2.5, 0).unwrap(), -3);
    // The binary-neighbor cases: these f64s are just *below* the
    // decimal they print as, so exact-decimal rounding rounds down.
    assert_eq!(scaled(1.005, 2).unwrap(), 100);
    assert_eq!(scaled(1.115, 2).unwrap(), 111);
    assert_eq!(scaled(2.675, 2).unwrap(), 267);
    assert_eq!(scaled(0.0005, 3).unwrap(), 1);
    // Non-finite values are InvalidAssignment, never a panic.
    assert!(matches!(
        scaled(f64::NAN, 3),
        Err(NeoError::InvalidAssignment { .. })
    ));
    assert!(matches!(
        scaled(f64::INFINITY, 3),
        Err(NeoError::InvalidAssignment { .. })
    ));
}

#[test]
fn numeric_task_checks_at_display_precision() {
    let v = variant(Content::Exercise(lesson("nj-by-hand")));
    for (quantity, role) in [
        (Quantity::QValue, PairRole::Chosen),
        (Quantity::CorrectedDistance, PairRole::Chosen),
        (Quantity::CorrectedDistance, PairRole::ClosestRaw),
        (Quantity::BranchLength, PairRole::ChosenFirstToNew),
        (Quantity::BranchLength, PairRole::ChosenSecondToNew),
        (Quantity::NewDistance, PairRole::ClosestRaw),
    ] {
        let task = TaskRef::Numeric {
            step: 1,
            quantity,
            role,
        };
        let AcceptedAnswer::Number(key) = task_key(&v, &task).unwrap() else {
            panic!("numeric task yields a number")
        };
        assert!(check_task(&v, &task, &TaskAnswer::Number(key)).unwrap());
        assert!(!check_task(&v, &task, &TaskAnswer::Number(key + 1)).unwrap());
        assert!(!check_task(&v, &task, &TaskAnswer::Number(key - 1)).unwrap());
    }
}

#[test]
fn closest_raw_refuses_an_ambiguous_closest() {
    // The tie fixture's first join has two raw-closest pairs — a
    // `closest_raw` numeric task cannot name "the" closest pair.
    let v = variant(Content::Exercise(tie_exercise()));
    let task = TaskRef::Numeric {
        step: 1,
        quantity: Quantity::CorrectedDistance,
        role: PairRole::ClosestRaw,
    };
    match task_key(&v, &task) {
        Err(NeoError::InvalidAssignment { field, .. }) => assert_eq!(field, "role"),
        other => panic!("expected InvalidAssignment, got {other:?}"),
    }
}

#[test]
fn q_value_is_nj_only() {
    // upgma-fails runs UPGMA — joins have no Q matrix.
    let v = variant(Content::Exercise(lesson("upgma-fails")));
    let task = TaskRef::Numeric {
        step: 1,
        quantity: Quantity::QValue,
        role: PairRole::Chosen,
    };
    assert!(matches!(
        task_key(&v, &task),
        Err(NeoError::InvalidAssignment { .. })
    ));
}

#[test]
fn tasks_on_the_wrong_content_kind_are_invalid() {
    let text = fs::read_to_string(exercises_dir().join("reading/trees-demo.json")).unwrap();
    let v = variant(Content::Reading(load_reading_set(&text).unwrap()));
    for task in [
        TaskRef::PredictPair { step: 1 },
        TaskRef::PredictBranch,
        TaskRef::Numeric {
            step: 1,
            quantity: Quantity::QValue,
            role: PairRole::Chosen,
        },
    ] {
        assert!(matches!(
            task_key(&v, &task),
            Err(NeoError::InvalidAssignment { .. })
        ));
    }
    let ev = variant(Content::Exercise(lesson("nj-by-hand")));
    assert!(matches!(
        task_key(&ev, &TaskRef::Reading { item: 0 }),
        Err(NeoError::InvalidAssignment { .. })
    ));
}

// --- the correct student scores 100 % ----------------------------------------

fn exercise_tasks(ex: &Exercise) -> Vec<TaskRef> {
    let mut tasks: Vec<TaskRef> = ex
        .prompts
        .iter()
        .filter_map(|p| match p.r#type {
            PromptType::PredictPair => Some(TaskRef::PredictPair { step: p.at_step }),
            PromptType::PredictBranch => Some(TaskRef::PredictBranch),
            PromptType::Note => None,
        })
        .collect();
    // A numeric spot-check per join-stepping lesson — same values the
    // stepper shows.
    tasks.push(TaskRef::Numeric {
        step: 1,
        quantity: Quantity::CorrectedDistance,
        role: PairRole::Chosen,
    });
    tasks
}

#[test]
fn correct_student_scores_every_task_on_built_in_lessons() {
    for id in [
        "bootstrap-basics",
        "cytochrome-c",
        "nj-basics",
        "nj-by-hand",
        "protein-models",
        "saturation",
        "upgma-fails",
        "upgma-vs-nj-matrix",
    ] {
        let ex = lesson(id);
        let v = variant(Content::Exercise(ex.clone()));
        for task in exercise_tasks(&ex) {
            // A variant whose pipeline can't produce the task's data
            // (e.g. a still-saturated `saturation` alignment) is
            // ungradeable — the builder never offers it — but it must
            // error, never panic.
            let Ok(key) = task_key(&v, &task) else {
                continue;
            };
            let answer = match key {
                AcceptedAnswer::Pairs(p) => {
                    let (a, b) = p[0];
                    TaskAnswer::Pair(a, b)
                }
                AcceptedAnswer::Branch(k) => TaskAnswer::Branch(k),
                AcceptedAnswer::Number(n) => TaskAnswer::Number(n),
                AcceptedAnswer::Reading(_) => panic!("exercise content yields no reading"),
            };
            assert!(
                check_task(&v, &task, &answer).unwrap_or_else(|e| panic!("{id} {task:?}: {e}")),
                "{id} {task:?}: the engine's own key must check correct",
            );
        }
    }
}

#[test]
fn changing_one_answer_flips_exactly_that_task() {
    // nj-basics has two predict_pair prompts (steps 1 and 3); a wrong
    // answer on one leaves the other correct.
    let ex = lesson("nj-basics");
    let v = variant(Content::Exercise(ex));
    let task = TaskRef::PredictPair { step: 1 };
    let AcceptedAnswer::Pairs(pairs) = task_key(&v, &task).unwrap() else {
        panic!("pairs")
    };
    // Any tip pair not in the accepted set is wrong on this task …
    let wrong = (0..6u16)
        .flat_map(|i| (i + 1..6).map(move |j| (i, j)))
        .find(|(i, j)| !pairs.contains(&(*i, *j)) && !pairs.contains(&(*j, *i)))
        .map(|(i, j)| TaskAnswer::Pair(i, j))
        .expect("6 taxa always offer a non-accepted pair");
    assert!(!check_task(&v, &task, &wrong).unwrap());
    // … while the sibling task at step 3 still scores its own key.
    let other = TaskRef::PredictPair { step: 3 };
    let AcceptedAnswer::Pairs(p3) = task_key(&v, &other).unwrap() else {
        panic!("pairs")
    };
    assert!(check_task(&v, &other, &TaskAnswer::Pair(p3[0].0, p3[0].1)).unwrap());
}

#[test]
fn predict_branch_scores_the_weakest_grouping() {
    let v = variant(Content::Exercise(lesson("bootstrap-basics")));
    let task = TaskRef::PredictBranch;
    let AcceptedAnswer::Branch(key) = task_key(&v, &task).unwrap() else {
        panic!("predict_branch yields a clade key")
    };
    assert!(check_task(&v, &task, &TaskAnswer::Branch(key.clone())).unwrap());
    // A grouping that isn't a split of the inferred tree is wrong.
    let mut bogus = key.clone();
    bogus.pop();
    if !bogus.is_empty() {
        assert!(!check_task(&v, &task, &TaskAnswer::Branch(bogus)).unwrap());
    }
}

#[test]
fn correct_student_scores_every_reading_item() {
    for f in [
        "trees-clades-traits",
        "trees-closest-relatives",
        "trees-demo",
        "trees-form-a",
        "trees-form-b",
        "trees-reading-a-tree",
        "trees-rotation",
    ] {
        let text =
            fs::read_to_string(exercises_dir().join("reading").join(format!("{f}.json"))).unwrap();
        let set = load_reading_set(&text).unwrap();
        let v = variant(Content::Reading(set.clone()));
        for i in 0..set.items.len() {
            let task = TaskRef::Reading { item: i };
            let AcceptedAnswer::Reading(key) =
                task_key(&v, &task).unwrap_or_else(|e| panic!("{f} item {i}: {e}"))
            else {
                panic!("reading task yields the accepted answer")
            };
            // The key matches the transformed set's own answer.
            let Content::Reading(vset) = &v.content else {
                panic!("reading")
            };
            assert_eq!(key, answer(vset, i).unwrap().accepted);
            let resp = correct_response(vset, i);
            assert!(
                check_task(&v, &task, &TaskAnswer::Reading(resp))
                    .unwrap_or_else(|e| panic!("{f} item {i}: {e}")),
                "{f} item {i}: the accepted response must check correct",
            );
        }
    }
}

#[test]
fn predict_pair_step_out_of_range_is_invalid() {
    let v = variant(Content::Exercise(lesson("nj-by-hand")));
    assert!(matches!(
        task_key(&v, &TaskRef::PredictPair { step: 99 }),
        Err(NeoError::InvalidAssignment { .. })
    ));
    assert!(matches!(
        task_key(
            &v,
            &TaskRef::Numeric {
                step: 99,
                quantity: Quantity::CorrectedDistance,
                role: PairRole::Chosen,
            }
        ),
        Err(NeoError::InvalidAssignment { .. })
    ));
}
