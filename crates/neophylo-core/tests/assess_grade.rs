//! Grading (v1.5 spec §5.5, plan Task 5): a code → score, per-task
//! verdicts and row flags — `First`/`Final`/`Weighted` scoring, the
//! `AssignmentMismatch`/`IdMismatch`/`ContentChanged` flags, and the
//! rule that a bad answer inside a well-formed code is wrong, never
//! an error.

use std::fs;
use std::path::{Path, PathBuf};

use neophylo_core::assess::{
    decode_code, encode_code, fingerprint, grade, normalise_id, pack_answer, AcceptedAnswer,
    Assignment, Attempt, CodePayload, Content, Flag, GradedTask, IdPrompt, IdRule, Mode,
    PackedAnswer, Rule, TaskAnswer, TaskRef, Variant,
};
use neophylo_core::assess::{task_key, PairRole, Quantity};
use neophylo_core::exercise::{load_exercise, Exercise};
use neophylo_core::reading::load_reading_set;
use neophylo_core::reading::{Closer, Question, Response};
use neophylo_core::reading::Accepted;
use neophylo_core::NeoError;

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

fn assignment(content: Content, tasks: Vec<TaskRef>) -> Assignment {
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
        tasks: tasks
            .into_iter()
            .map(|task| GradedTask { task, points: 1.0 })
            .collect(),
    }
}

fn exercise_assignment(tasks: Vec<TaskRef>) -> Assignment {
    assignment(Content::Exercise(lesson("nj-basics")), tasks)
}

fn reading_assignment(items: &[usize]) -> Assignment {
    let text = fs::read_to_string(exercises_dir().join("reading/trees-demo.json")).unwrap();
    let set = load_reading_set(&text).unwrap();
    assignment(
        Content::Reading(set),
        items.iter().map(|&item| TaskRef::Reading { item }).collect(),
    )
}

const STUDENT: &str = "Ada";

/// A response that satisfies the accepted answer for `q` — `None`
/// for `Orders` (constructing one needs the ancestry check).
fn response_for(q: &Question, acc: &Accepted) -> Option<Response> {
    Some(match acc {
        // `is_clade`-style single-select questions answer with one
        // index; multi-selects with the whole set.
        Accepted::Choices(ks) => match q {
            Question::IsClade { .. } => {
                if ks.len() == 1 {
                    Response::Choice { index: ks[0] }
                } else {
                    return None;
                }
            }
            _ => Response::Choices {
                indices: ks.clone(),
            },
        },
        Accepted::Clade(k) => Response::Node { clade: k.clone() },
        Accepted::Point(l) => Response::Point {
            letter: l.clone(),
        },
        Accepted::TipSet(k) | Accepted::AnyTipOf(k) => Response::Tips { tips: k.clone() },
        Accepted::Orders { .. } => return None,
        Accepted::Number(n) => Response::Number { value: *n },
        Accepted::Pairwise(c) => Response::Pairwise { answer: c.clone() },
        Accepted::Statements(vals) => Response::Choices {
            indices: vals
                .iter()
                .enumerate()
                .filter(|(_, v)| **v)
                .map(|(i, _)| i)
                .collect(),
        },
        Accepted::TwoTier { first, reason } => {
            let inner = match q {
                Question::TwoTier { first: qf, .. } => (**qf).clone(),
                _ => return None,
            };
            Response::TwoTier {
                first: Box::new(response_for(&inner, first)?),
                reason: *reason,
            }
        }
    })
}

/// A correct answer to `task` on `variant`, via the engine's key.
fn correct(variant: &Variant, task: &TaskRef) -> TaskAnswer {
    match task_key(variant, task).unwrap() {
        AcceptedAnswer::Pairs(p) => TaskAnswer::Pair(p[0].0, p[0].1),
        AcceptedAnswer::Number(n) => TaskAnswer::Number(n),
        AcceptedAnswer::Branch(c) => TaskAnswer::Branch(c),
        AcceptedAnswer::Reading(acc) => {
            let item = match (task, &variant.content) {
                (TaskRef::Reading { item }, Content::Reading(set)) => &set.items[*item],
                _ => panic!("a reading accepted answer on non-reading content"),
            };
            TaskAnswer::Reading(
                response_for(&item.question, &acc).expect("a constructible accepted answer"),
            )
        }
    }
}

/// A code carrying `answers` (in app form) as each task's `first`,
/// one attempt each.
fn code_for(a: &Assignment, student: &str, answers: &[TaskAnswer]) -> String {
    let nid = normalise_id(student, a.id_prompt.rule).unwrap();
    let variant = a.variant_for(student).unwrap();
    attempts_code(a, &nid, variant.retry, &attempts(&variant, a, answers, &[]))
}

fn attempts(
    variant: &Variant,
    a: &Assignment,
    firsts: &[TaskAnswer],
    lasts: &[Option<TaskAnswer>],
) -> Vec<Attempt> {
    firsts
        .iter()
        .enumerate()
        .map(|(i, first)| Attempt {
            first: pack_answer(variant, &a.tasks[i].task, first)
                .unwrap_or(PackedAnswer::Skipped),
            last: lasts
                .get(i)
                .and_then(|l| l.as_ref())
                .map(|l| pack_answer(variant, &a.tasks[i].task, l).unwrap()),
            attempts: 1,
        })
        .collect()
}

fn attempts_code(a: &Assignment, nid: &str, retry: u8, attempts: &[Attempt]) -> String {
    encode_code(&CodePayload {
        format: 1,
        generator: 1,
        fingerprint: fingerprint(a),
        student_id: nid.to_string(),
        retry,
        attempts: attempts.to_vec(),
        finished_min: 42_000,
    })
    .unwrap()
}

fn exercise_tasks() -> Vec<TaskRef> {
    vec![
        TaskRef::PredictPair { step: 1 },
        TaskRef::Numeric {
            step: 1,
            quantity: Quantity::CorrectedDistance,
            role: PairRole::Chosen,
        },
    ]
}

// --- scores and rules ---------------------------------------------------------------

#[test]
fn a_perfect_code_grades_full_marks() {
    let a = exercise_assignment(exercise_tasks());
    let v = a.variant_for(STUDENT).unwrap();
    let answers: Vec<TaskAnswer> = a.tasks.iter().map(|t| correct(&v, &t.task)).collect();
    let code = code_for(&a, STUDENT, &answers);
    let out = grade(&a, None, &code, Rule::First).unwrap();
    assert_eq!(out.score, out.max);
    assert_eq!(out.max, 2.0);
    assert!(out.flags.is_empty());
    assert!(out.tasks.iter().all(|t| t.first_ok && t.final_ok));
    // The answers came back in app form.
    assert!(matches!(out.tasks[0].first, Some(TaskAnswer::Pair(..))));
}

#[test]
fn first_final_and_weighted_rules() {
    let a = exercise_assignment(exercise_tasks());
    let v = a.variant_for(STUDENT).unwrap();
    let ok0 = correct(&v, &a.tasks[0].task);
    let ok1 = correct(&v, &a.tasks[1].task);
    // A pair that is not in the accepted set is a fitting wrong answer.
    let AcceptedAnswer::Pairs(pairs) = task_key(&v, &a.tasks[0].task).unwrap() else {
        unreachable!()
    };
    let wrong0 = (0..20u16)
        .flat_map(|i| (i + 1..20).map(move |j| (i, j)))
        .find(|p| !pairs.contains(p))
        .map(|(i, j)| TaskAnswer::Pair(i, j))
        .expect("some pair is not accepted");
    let wrong1 = TaskAnswer::Number(match ok1 {
        TaskAnswer::Number(n) => n + 1,
        _ => unreachable!(),
    });
    // Task 0: right first, wrong last. Task 1: wrong first, right last.
    let nid = normalise_id(STUDENT, a.id_prompt.rule).unwrap();
    let at = attempts(
        &v,
        &a,
        &[ok0.clone(), wrong1],
        &[Some(wrong0), Some(ok1.clone())],
    )
    .into_iter()
    .map(|a| Attempt {
        attempts: 2,
        ..a
    })
    .collect::<Vec<_>>();
    let code = attempts_code(&a, &nid, v.retry, &at);
    let first = grade(&a, None, &code, Rule::First).unwrap();
    assert_eq!(first.score, 1.0, "only task 0's first is right");
    assert!(!first.tasks[1].first_ok);
    assert!(first.tasks[1].final_ok);
    let final_ = grade(&a, None, &code, Rule::Final).unwrap();
    assert_eq!(final_.score, 1.0, "only task 1's final is right");
    let weighted = grade(&a, None, &code, Rule::Weighted { partial: 0.5 }).unwrap();
    assert_eq!(weighted.score, 1.5, "full first + half final");
    // TaskResult carries both submissions in app form.
    assert_eq!(weighted.tasks[0].first, Some(ok0));
    assert!(matches!(weighted.tasks[1].last, Some(TaskAnswer::Number(_))));
}

#[test]
fn skipped_and_misfit_answers_score_wrong() {
    let a = exercise_assignment(exercise_tasks());
    let v = a.variant_for(STUDENT).unwrap();
    let nid = normalise_id(STUDENT, a.id_prompt.rule).unwrap();
    let at = vec![
        Attempt {
            first: PackedAnswer::Skipped,
            last: None,
            attempts: 0,
        },
        // A pair answer on a numeric task unpacks fine but cannot
        // fit — wrong, not an error, and the answer is still shown.
        Attempt {
            first: PackedAnswer::Pair(0, 1),
            last: None,
            attempts: 1,
        },
    ];
    let code = attempts_code(&a, &nid, v.retry, &at);
    let out = grade(&a, None, &code, Rule::First).unwrap();
    assert_eq!(out.score, 0.0);
    assert_eq!(out.tasks[0].first, None, "a skip has no answer");
    assert!(!out.tasks[0].first_ok);
    assert_eq!(out.tasks[1].first, Some(TaskAnswer::Pair(0, 1)));
    assert!(!out.tasks[1].first_ok);
}

// --- flags --------------------------------------------------------------------------

#[test]
fn lms_id_mismatch_flags_but_still_grades() {
    let a = exercise_assignment(exercise_tasks());
    let v = a.variant_for(STUDENT).unwrap();
    let answers: Vec<TaskAnswer> = a.tasks.iter().map(|t| correct(&v, &t.task)).collect();
    let code = code_for(&a, STUDENT, &answers);
    // LMS agrees (un-normalised form of the same id).
    let out = grade(&a, Some(" ada "), &code, Rule::First).unwrap();
    assert!(out.flags.is_empty());
    assert_eq!(out.score, out.max);
    // LMS disagrees → flag, still graded on the code's id.
    let out = grade(&a, Some("grace"), &code, Rule::First).unwrap();
    assert_eq!(out.flags, vec![Flag::IdMismatch]);
    assert_eq!(out.score, out.max);
    // An un-normalisable LMS id (blank) → flag, not an error.
    let out = grade(&a, Some("   "), &code, Rule::First).unwrap();
    assert_eq!(out.flags, vec![Flag::IdMismatch]);
}

#[test]
fn fingerprint_and_task_count_mismatch_never_guess() {
    let a = exercise_assignment(exercise_tasks());
    let v = a.variant_for(STUDENT).unwrap();
    let answers: Vec<TaskAnswer> = a.tasks.iter().map(|t| correct(&v, &t.task)).collect();
    // A code built for a *different* assignment.
    let other = exercise_assignment(vec![TaskRef::PredictPair { step: 1 }]);
    let wrong_fp = code_for(&other, STUDENT, &answers[..1]);
    let out = grade(&a, None, &wrong_fp, Rule::First).unwrap();
    assert_eq!(out.score, 0.0);
    assert!(out.tasks.is_empty());
    assert_eq!(out.flags, vec![Flag::AssignmentMismatch]);
    // Same fingerprint, wrong task count: drop a task's attempt.
    let code = code_for(&a, STUDENT, &answers);
    let p = {
        let mut p = decode_code(&code).unwrap();
        p.attempts.pop();
        encode_code(&p).unwrap()
    };
    let out = grade(&a, None, &p, Rule::First).unwrap();
    assert_eq!(out.score, 0.0);
    assert_eq!(out.flags, vec![Flag::AssignmentMismatch]);
}

#[test]
fn retry_mismatch_is_an_assignment_mismatch() {
    let a = exercise_assignment(exercise_tasks());
    let v = a.variant_for(STUDENT).unwrap();
    let answers: Vec<TaskAnswer> = a.tasks.iter().map(|t| correct(&v, &t.task)).collect();
    let other_retry = if v.retry < 50 { v.retry + 1 } else { v.retry - 1 };
    let nid = normalise_id(STUDENT, a.id_prompt.rule).unwrap();
    // A code that claims a different retry than the rebuilt variant
    // (the generator or a premise changed since it was issued).
    let code = attempts_code(&a, &nid, other_retry, &attempts(&v, &a, &answers, &[]));
    let out = grade(&a, None, &code, Rule::First).unwrap();
    assert_eq!(out.score, 0.0);
    assert_eq!(out.flags, vec![Flag::AssignmentMismatch]);
}

#[test]
fn content_changed_flags_when_hashes_differ() {
    let mut a = exercise_assignment(exercise_tasks());
    a.content_hash = Some("0123456789abcdef".to_string());
    a.served_content_hash = Some("fedcba9876543210".to_string());
    let v = a.variant_for(STUDENT).unwrap();
    let answers: Vec<TaskAnswer> = a.tasks.iter().map(|t| correct(&v, &t.task)).collect();
    let code = code_for(&a, STUDENT, &answers);
    let out = grade(&a, None, &code, Rule::First).unwrap();
    assert_eq!(out.flags, vec![Flag::ContentChanged]);
    assert_eq!(out.score, out.max, "grading still proceeds");
    // Matching hashes → no flag.
    a.served_content_hash = a.content_hash.clone();
    let code = code_for(&a, STUDENT, &answers);
    let out = grade(&a, None, &code, Rule::First).unwrap();
    assert!(out.flags.is_empty());
}

// --- error paths -----------------------------------------------------------------------

#[test]
fn an_undecodable_code_is_an_invalid_code_error() {
    let a = exercise_assignment(exercise_tasks());
    match grade(&a, None, "definitely not a code", Rule::First) {
        Err(NeoError::InvalidCode { reason }) => assert_eq!(reason, "prefix"),
        other => panic!("expected InvalidCode, got {other:?}"),
    }
}

#[test]
fn a_bad_weighted_rule_is_an_invalid_assignment() {
    let a = exercise_assignment(exercise_tasks());
    let v = a.variant_for(STUDENT).unwrap();
    let answers: Vec<TaskAnswer> = a.tasks.iter().map(|t| correct(&v, &t.task)).collect();
    let code = code_for(&a, STUDENT, &answers);
    for bad in [1.5, -0.1, f64::NAN, f64::INFINITY] {
        match grade(&a, None, &code, Rule::Weighted { partial: bad }) {
            Err(NeoError::InvalidAssignment { field, .. }) => assert_eq!(field, "rule"),
            other => panic!("partial {bad}: expected InvalidAssignment, got {other:?}"),
        }
    }
    for ok in [0.0, 0.5, 1.0] {
        assert!(grade(&a, None, &code, Rule::Weighted { partial: ok }).is_ok());
    }
}

// --- reading tasks end to end -----------------------------------------------------------

#[test]
fn reading_answers_grade_end_to_end() {
    // Items whose accepted answers are constructible: mrca (3),
    // mrca+options (4), is_clade (6), pairwise (10), count (11),
    // concept (22), two_tier (23).
    let items = [3usize, 4, 6, 10, 11, 22, 23];
    let a = reading_assignment(&items);
    let v = a.variant_for(STUDENT).unwrap();
    let answers: Vec<TaskAnswer> = a.tasks.iter().map(|t| correct(&v, &t.task)).collect();
    let code = code_for(&a, STUDENT, &answers);
    let out = grade(&a, None, &code, Rule::First).unwrap();
    assert_eq!(out.score, out.max);
    assert!(out.tasks.iter().all(|t| t.first_ok));
    // Flip the is_clade single choice (item index 2 = item 6) → wrong.
    let mut wrong = answers.clone();
    wrong[2] = TaskAnswer::Reading(Response::Choice {
        index: match &answers[2] {
            TaskAnswer::Reading(Response::Choice { index }) => index ^ 1,
            _ => 0,
        },
    });
    let code = code_for(&a, STUDENT, &wrong);
    let out = grade(&a, None, &code, Rule::First).unwrap();
    assert!(!out.tasks[2].first_ok);
    assert_eq!(out.score, out.max - 1.0);
}

#[test]
fn pairwise_answers_pack_and_grade() {
    let a = reading_assignment(&[10]);
    let v = a.variant_for(STUDENT).unwrap();
    let ok = correct(&v, &a.tasks[0].task);
    let wrong = TaskAnswer::Reading(Response::Pairwise {
        answer: match &ok {
            TaskAnswer::Reading(Response::Pairwise { answer }) => match answer {
                Closer::B => Closer::C,
                _ => Closer::B,
            },
            _ => Closer::B,
        },
    });
    let code = code_for(&a, STUDENT, &[ok]);
    assert_eq!(grade(&a, None, &code, Rule::First).unwrap().score, 1.0);
    let code = code_for(&a, STUDENT, &[wrong]);
    assert_eq!(grade(&a, None, &code, Rule::First).unwrap().score, 0.0);
}
