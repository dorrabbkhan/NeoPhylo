//! Grading (v1.5 spec §5.5, plan Task 5): turn one student's
//! completion code into a score, per-task verdicts and row flags.
//! `grade` never guesses — a code that does not match the assignment
//! scores 0 with `AssignmentMismatch` — and never errors on one bad
//! answer: a payload `decode_code` rejects is `Err(InvalidCode)`, but
//! inside a well-formed code a skipped, unpackable or wrong-kind
//! answer is simply wrong.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::assess::assignment::{Assignment, Content, Variant};
use crate::assess::code::{answer_fits, decode_code, fingerprint, item_of, unpack_answer};
use crate::assess::hash::normalise_id;
use crate::assess::task::{check_task, TaskAnswer, TaskRef};
use crate::error::NeoError;

/// How a task's first and final answers combine into points (spec
/// §5.5).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(
    tag = "kind",
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum Rule {
    /// Only the first submission counts.
    First,
    /// Only the final submission counts (the last when it differs,
    /// else the first).
    Final,
    /// Full points when the first is right, `partial` × points when
    /// only the final is. `partial` must be finite and in `0..=1`,
    /// else `InvalidAssignment { field: "rule" }`.
    Weighted { partial: f64 },
}

/// A flag on a graded row (spec §5.5). `grade` only ever sets
/// `IdMismatch`, `AssignmentMismatch` and `ContentChanged`;
/// `Checksum`, `Duplicate` and `Missing` exist for Task 9's
/// class-level checks (a code `decode_code` rejects is an
/// `InvalidCode` error, not a flag).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum Flag {
    /// The LMS id does not match the code's id after normalisation.
    IdMismatch,
    /// The code's fingerprint, task count or retry index does not
    /// match this assignment — never guess; score 0.
    AssignmentMismatch,
    /// The assignment records a `content_hash` and the served
    /// content's hash differs (a built-in file changed since
    /// authoring).
    ContentChanged,
    /// Task 9: the row's code failed its checksum.
    Checksum,
    /// Task 9: the same student submitted more than one code.
    Duplicate,
    /// Task 9: an enrolled student submitted no code.
    Missing,
}

/// One task's graded outcome. `first`/`last` are the student's
/// answers in app form — `None` when the task was skipped or the
/// packed answer could not be unpacked (both score wrong; grading
/// never errors on one bad answer).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct TaskResult {
    /// Index into `assignment.tasks`.
    pub task: usize,
    pub first_ok: bool,
    /// `final_ok` judges the final submission — `last` when present,
    /// else `first`.
    pub final_ok: bool,
    pub first: Option<TaskAnswer>,
    pub last: Option<TaskAnswer>,
}

/// A graded code: the score, the maximum, per-task results and the
/// row flags (spec §5.5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct GradeResult {
    pub score: f64,
    pub max: f64,
    pub tasks: Vec<TaskResult>,
    pub flags: Vec<Flag>,
}

/// Grade `code` against `a` under `rule` (spec §5.5). `lms_id`, when
/// given, is normalised with the assignment's rule and compared to
/// the code's id — a mismatch (or an id that fails normalisation)
/// flags `IdMismatch`; grading still uses the code's id.
///
/// A `decode_code` failure is `Err(InvalidCode)`; a fingerprint or
/// task-count mismatch, or a rebuilt variant whose `retry` differs
/// from the code's (the generator or a premise changed since
/// authoring), is `Ok` with score 0, empty `tasks` and
/// `AssignmentMismatch`. `Weighted` outside `0..=1` or non-finite is
/// `Err(InvalidAssignment { field: "rule" })`. A task that cannot
/// apply to the content (a broken `TaskRef`) propagates
/// `InvalidAssignment` — a task defect, not a bad answer.
pub fn grade(
    a: &Assignment,
    lms_id: Option<&str>,
    code: &str,
    rule: Rule,
) -> Result<GradeResult, NeoError> {
    if let Rule::Weighted { partial } = rule {
        if !partial.is_finite() || !(0.0..=1.0).contains(&partial) {
            return Err(NeoError::InvalidAssignment {
                field: "rule".to_string(),
                msg: "weighted partial must be finite and in 0..=1".to_string(),
            });
        }
    }
    let payload = decode_code(code)?;
    let max: f64 = a.tasks.iter().map(|t| t.points).sum();
    let mut flags = Vec::new();
    if let Some(raw) = lms_id {
        match normalise_id(raw, a.id_prompt.rule) {
            Ok(n) if n == payload.student_id => {}
            _ => flags.push(Flag::IdMismatch),
        }
    }
    if let (Some(want), Some(served)) = (&a.content_hash, &a.served_content_hash) {
        if want != served {
            flags.push(Flag::ContentChanged);
        }
    }
    let mismatch = |flags: Vec<Flag>| GradeResult {
        score: 0.0,
        max,
        tasks: Vec::new(),
        flags: {
            let mut f = flags;
            f.push(Flag::AssignmentMismatch);
            f
        },
    };
    if payload.fingerprint != fingerprint(a) || payload.attempts.len() != a.tasks.len() {
        return Ok(mismatch(flags));
    }
    let variant = a.variant_for(&payload.student_id)?;
    if payload.retry != variant.retry {
        return Ok(mismatch(flags));
    }
    let mut score = 0.0;
    let mut tasks = Vec::with_capacity(a.tasks.len());
    for (i, gt) in a.tasks.iter().enumerate() {
        ensure_applicable(&variant, &gt.task)?;
        let at = &payload.attempts[i];
        let item = item_of(&variant, &gt.task)?.map(|(_, it)| it);
        let first = unpack_answer(&variant, &gt.task, &at.first).ok();
        let last = at
            .last
            .as_ref()
            .and_then(|l| unpack_answer(&variant, &gt.task, l).ok());
        // A well-formed answer that still fails `check_task` marks a
        // task/content defect (a bad step, a saturated matrix) —
        // propagate it; the bad-answer cases were filtered by unpack
        // and the kind-fit check.
        let score_answer = |ta: &Option<TaskAnswer>| -> Result<bool, NeoError> {
            match ta {
                Some(ta) if answer_fits(&gt.task, ta, item) => {
                    check_task(&variant, &gt.task, ta)
                }
                _ => Ok(false),
            }
        };
        let first_ok = score_answer(&first)?;
        // The final submission is `last` when present, else `first`.
        let final_ok = if at.last.is_some() {
            score_answer(&last)?
        } else {
            first_ok
        };
        score += match rule {
            Rule::First if first_ok => gt.points,
            Rule::Final if final_ok => gt.points,
            Rule::Weighted { .. } if first_ok => gt.points,
            Rule::Weighted { partial } if final_ok => partial * gt.points,
            _ => 0.0,
        };
        tasks.push(TaskResult {
            task: i,
            first_ok,
            final_ok,
            first,
            last,
        });
    }
    Ok(GradeResult {
        score,
        max,
        tasks,
        flags,
    })
}

/// Cheap task applicability — the task's kind must fit the content
/// and a reading item must exist. A violation is a defect of the
/// assignment's own task list: `InvalidAssignment`, never a 0.
fn ensure_applicable(variant: &Variant, task: &TaskRef) -> Result<(), NeoError> {
    let invalid = |msg: &str| NeoError::InvalidAssignment {
        field: "task".to_string(),
        msg: msg.to_string(),
    };
    match (task, &variant.content) {
        (TaskRef::PredictPair { .. } | TaskRef::PredictBranch | TaskRef::Numeric { .. },
         Content::Exercise(_)) => Ok(()),
        (TaskRef::PredictPair { .. } | TaskRef::PredictBranch | TaskRef::Numeric { .. },
         Content::Reading(_)) => Err(invalid("an exercise task needs exercise content")),
        (TaskRef::Reading { .. }, Content::Exercise(_)) => {
            Err(invalid("a reading task needs reading content"))
        }
        (TaskRef::Reading { item }, Content::Reading(set)) => {
            if *item >= set.items.len() {
                return Err(invalid("the reading item does not exist"));
            }
            Ok(())
        }
    }
}
