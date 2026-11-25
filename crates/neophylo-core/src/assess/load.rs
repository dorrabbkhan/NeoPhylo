//! `load_assignment` and its structural pre-scan (v1.5 spec §4, plan
//! Task 6): parse and validate a `.neophylo-assignment.json` file —
//! `schema_version: 1`, `kind: "assignment"` — into the engine's
//! [`Assignment`]. Like `load_reading_set`, the scan refuses `null`
//! and wrong container shapes before serde reports them anonymously,
//! so every refusal is `NeoError::InvalidAssignment` naming the
//! field.
//!
//! `content` names exactly one source:
//!
//! - `{ "exercise": <exercise file> }` or `{ "reading": <reading-set
//!   file> }` — the file JSON, parsed by `load_exercise` /
//!   `load_reading_set`;
//! - `{ "builtin": "<lesson, lab or reading-set id>", "content_hash":
//!   "<hash>", "file": "<file text>" }` — a built-in reference
//!   (spec §5.7). `file` is the currently-served file's exact bytes,
//!   injected by the link/file resolver (`decodeAssignmentLink`); it
//!   is not part of the saved `.neophylo-assignment.json`. The
//!   reference's `builtin` id must equal the file's own `id`, the
//!   recorded `content_hash` is kept as authored, and
//!   `served_content_hash` is computed from `file` so grading flags
//!   `ContentChanged` when the two differ.

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::assess::assignment::{Assignment, Content, GradedTask, IdPrompt, Mode};
use crate::assess::code::MAX_TASKS;
use crate::assess::hash::{content_hash, IdRule};
use crate::assess::task::TaskRef;
use crate::error::NeoError;
use crate::exercise::load_exercise;
use crate::reading::load_reading_set;

fn invalid(field: impl Into<String>, msg: impl Into<String>) -> NeoError {
    NeoError::InvalidAssignment {
        field: field.into(),
        msg: msg.into(),
    }
}

/// A builtin's served `file` that fails its own loader refuses as
/// `content.file` — the field the resolver injected — not the inner
/// loader's own error kind, per this module's "every refusal is
/// `InvalidAssignment` naming the field" contract (the `exercise`/
/// `reading` branches wrap to `content.*` fields the same way).
fn served_err(e: NeoError) -> NeoError {
    match e {
        NeoError::InvalidExercise { msg, .. } | NeoError::InvalidReading { msg, .. } => {
            invalid("content.file", msg)
        }
        e => e,
    }
}

// --- structural pre-scan --------------------------------------------------------

/// Refuse `null` where the types do not allow it and wrong container
/// shapes where the pinned refusals need a field name — before serde
/// reports them anonymously (the "serde gap" of Global Constraints).
fn scan(value: &Value) -> Result<(), NeoError> {
    let obj = value
        .as_object()
        .ok_or_else(|| invalid("json", "an assignment is a JSON object"))?;
    let no_nulls = |o: &Map<String, Value>, where_: &str| {
        for (k, v) in o {
            if v.is_null() {
                return Err(invalid(
                    if where_.is_empty() {
                        k.clone()
                    } else {
                        format!("{where_}.{k}")
                    },
                    "must not be null",
                ));
            }
        }
        Ok(())
    };
    for k in [
        "schema_version",
        "kind",
        "id",
        "title",
        "content",
        "id_prompt",
        "mode",
        "variation",
        "tasks",
    ] {
        if !obj.contains_key(k) {
            return Err(invalid(k, "is required"));
        }
    }
    no_nulls(obj, "")?;

    let content = obj["content"]
        .as_object()
        .ok_or_else(|| invalid("content", "must be an object"))?;
    no_nulls(content, "content")?;

    let prompt = obj["id_prompt"]
        .as_object()
        .ok_or_else(|| invalid("id_prompt", "must be an object"))?;
    if !prompt.contains_key("label") {
        return Err(invalid("id_prompt.label", "is required"));
    }
    no_nulls(prompt, "id_prompt")?;

    let tasks = obj["tasks"]
        .as_array()
        .ok_or_else(|| invalid("tasks", "must be an array"))?;
    for (i, t) in tasks.iter().enumerate() {
        let to = t
            .as_object()
            .ok_or_else(|| invalid("tasks", format!("task {i} must be an object")))?;
        if !to.contains_key("task") {
            return Err(invalid(format!("tasks.{i}.task"), "is required"));
        }
        no_nulls(to, &format!("tasks.{i}"))?;
    }
    Ok(())
}

/// Deserialize one required field of an object, naming `field` on
/// failure.
fn take<T: for<'a> Deserialize<'a>>(
    obj: &mut Map<String, Value>,
    key: &str,
    field: &str,
) -> Result<T, NeoError> {
    let v = obj
        .remove(key)
        .ok_or_else(|| invalid(field, format!("'{key}' is required")))?;
    serde_json::from_value(v).map_err(|e| invalid(field, e.to_string()))
}

/// Deserialize an optional field (absent → `None`), naming `field`.
fn take_opt<T: for<'a> Deserialize<'a>>(
    obj: &mut Map<String, Value>,
    key: &str,
    field: &str,
) -> Result<Option<T>, NeoError> {
    match obj.remove(key) {
        None => Ok(None),
        Some(v) => serde_json::from_value(v)
            .map(Some)
            .map_err(|e| invalid(field, e.to_string())),
    }
}

/// Refuse keys the content source cannot carry — `builtin` extras
/// would silently change semantics (a stray `content_hash` on an
/// embedded exercise must not be dropped unnoticed).
fn only_keys(obj: &Map<String, Value>, allowed: &[&str]) -> Result<(), NeoError> {
    for k in obj.keys() {
        if !allowed.contains(&k.as_str()) {
            return Err(invalid("content", format!("'{k}' is not a content source")));
        }
    }
    Ok(())
}

/// Resolve `content` to `(Content, recorded_hash, served_hash)`.
/// `recorded`/`served` are `Some` only for a `builtin` reference.
fn parse_content(v: &Value) -> Result<(Content, Option<String>, Option<String>), NeoError> {
    let obj = v
        .as_object()
        .ok_or_else(|| invalid("content", "must be an object"))?;
    let kinds: Vec<&str> = ["exercise", "reading", "builtin"]
        .into_iter()
        .filter(|k| obj.contains_key(*k))
        .collect();
    if kinds.len() != 1 {
        return Err(invalid(
            "content",
            "must name exactly one of 'exercise', 'reading' or 'builtin'",
        ));
    }
    match kinds[0] {
        "exercise" => {
            only_keys(obj, &["exercise"])?;
            let text = serde_json::to_string(&obj["exercise"])
                .map_err(|e| invalid("content.exercise", e.to_string()))?;
            Ok((
                Content::Exercise(load_exercise(&text).map_err(|e| match e {
                    NeoError::InvalidExercise { field, msg } => {
                        invalid(format!("content.exercise.{field}"), msg)
                    }
                    e => e,
                })?),
                None,
                None,
            ))
        }
        "reading" => {
            only_keys(obj, &["reading"])?;
            let text = serde_json::to_string(&obj["reading"])
                .map_err(|e| invalid("content.reading", e.to_string()))?;
            Ok((
                Content::Reading(load_reading_set(&text).map_err(|e| match e {
                    NeoError::InvalidReading { field, msg, .. } => {
                        invalid(format!("content.reading.{field}"), msg)
                    }
                    e => e,
                })?),
                None,
                None,
            ))
        }
        _ => {
            only_keys(obj, &["builtin", "content_hash", "file"])?;
            let id = obj
                .get("builtin")
                .and_then(Value::as_str)
                .filter(|s| !s.is_empty())
                .ok_or_else(|| invalid("content.builtin", "must be a non-empty id string"))?;
            let recorded = obj
                .get("content_hash")
                .and_then(Value::as_str)
                .ok_or_else(|| invalid("content.content_hash", "is required"))?;
            if recorded.len() != 16
                || !recorded
                    .chars()
                    .all(|c| c.is_ascii_hexdigit() && !c.is_ascii_uppercase())
            {
                return Err(invalid(
                    "content.content_hash",
                    "must be a 16-digit lowercase hex content hash",
                ));
            }
            let file = obj.get("file").and_then(Value::as_str).ok_or_else(|| {
                invalid(
                    "content.file",
                    "is required — the link resolver injects the served file",
                )
            })?;
            // A reading set's file declares `kind: "reading"`; every
            // other file goes through the exercise loader.
            let served: Value = serde_json::from_str(file).unwrap_or(Value::Null);
            let content = if served.get("kind").and_then(Value::as_str) == Some("reading") {
                Content::Reading(load_reading_set(file).map_err(served_err)?)
            } else {
                Content::Exercise(load_exercise(file).map_err(served_err)?)
            };
            let inner_id = match &content {
                Content::Exercise(ex) => ex.id.as_str(),
                Content::Reading(set) => set.id.as_str(),
            };
            if inner_id != id {
                return Err(invalid(
                    "content.builtin",
                    format!("'{id}' resolved to content '{inner_id}'"),
                ));
            }
            Ok((
                content,
                Some(recorded.to_string()),
                Some(content_hash(file.as_bytes())),
            ))
        }
    }
}

/// Parse and validate an assignment file (spec §4). Any text in,
/// `Ok` or `NeoError` out — never a panic.
pub fn load_assignment(json: &str) -> Result<Assignment, NeoError> {
    let value: Value = serde_json::from_str(json).map_err(|e| invalid("json", e.to_string()))?;
    scan(&value)?;
    let mut obj = value
        .as_object()
        .cloned()
        .ok_or_else(|| invalid("json", "an assignment is a JSON object"))?;

    let schema_version: u32 = take(&mut obj, "schema_version", "schema_version")?;
    if schema_version != 1 {
        return Err(invalid(
            "schema_version",
            format!("expected 1, got {schema_version}"),
        ));
    }
    let kind: String = take(&mut obj, "kind", "kind")?;
    if kind != "assignment" {
        return Err(invalid("kind", "expected \"assignment\""));
    }
    let id: String = take(&mut obj, "id", "id")?;
    if id.is_empty() {
        return Err(invalid("id", "must not be empty"));
    }
    let title: String = take(&mut obj, "title", "title")?;
    if title.is_empty() {
        return Err(invalid("title", "must not be empty"));
    }
    let instructions: Option<String> = take_opt(&mut obj, "instructions", "instructions")?;
    let (content, content_hash, served_content_hash) = parse_content(&obj["content"])?;

    let mut prompt = obj["id_prompt"]
        .as_object()
        .cloned()
        .ok_or_else(|| invalid("id_prompt", "must be an object"))?;
    let id_prompt = IdPrompt {
        label: take(&mut prompt, "label", "id_prompt.label")?,
        rule: take_opt(&mut prompt, "rule", "id_prompt.rule")?.unwrap_or(IdRule::TrimLower),
    };
    if id_prompt.label.is_empty() {
        return Err(invalid("id_prompt.label", "must not be empty"));
    }

    let mode: Mode = take(&mut obj, "mode", "mode")?;
    let variation: bool = take(&mut obj, "variation", "variation")?;

    // `tasks[].task`/`points` errors name the entry, so each entry is
    // deserialized member by member rather than via `take` on the
    // array.
    let raw = obj["tasks"].as_array().cloned().unwrap_or_default();
    if raw.is_empty() || raw.len() > MAX_TASKS {
        return Err(invalid(
            "tasks",
            format!(
                "an assignment needs 1–{MAX_TASKS} graded tasks, has {}",
                raw.len()
            ),
        ));
    }
    let mut tasks: Vec<GradedTask> = Vec::with_capacity(raw.len());
    for (i, entry) in raw.iter().enumerate() {
        let eo = entry.as_object().cloned().unwrap_or_default();
        let task =
            serde_json::from_value::<TaskRef>(eo.get("task").cloned().unwrap_or(Value::Null))
                .map_err(|e| invalid(format!("tasks.{i}.task"), e.to_string()))?;
        let points = match eo.get("points") {
            None => 1.0,
            Some(v) => {
                let p = serde_json::from_value::<f64>(v.clone())
                    .map_err(|e| invalid(format!("tasks.{i}.points"), e.to_string()))?;
                if !p.is_finite() || p < 0.0 {
                    return Err(invalid(
                        format!("tasks.{i}.points"),
                        "must be a finite number ≥ 0",
                    ));
                }
                p
            }
        };
        // A reading task needs reading content — and exercise tasks
        // exercise content — or the file is an authoring error.
        let applies = match (&task, &content) {
            (TaskRef::Reading { item }, Content::Reading(set)) => *item < set.items.len(),
            (TaskRef::Reading { .. }, _) => false,
            (_, Content::Exercise(_)) => true,
            (_, _) => false,
        };
        if !applies {
            return Err(invalid(
                format!("tasks.{i}.task"),
                "the task does not apply to the content",
            ));
        }
        tasks.push(GradedTask { task, points });
    }

    Ok(Assignment {
        id,
        title,
        instructions,
        content,
        content_hash,
        served_content_hash,
        id_prompt,
        mode,
        variation,
        tasks,
    })
}
