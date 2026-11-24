//! The assignment model (v1.5 spec §5.1, plan Task 4): what the
//! instructor shares and what a student's variant is made of. The
//! file wire shape (packaging, links) is Task 6's surface; these are
//! the engine-side types `variant_for` composes — content, the
//! assignment's own fields, and the produced [`Variant`].

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::assess::hash::{normalise_id, variant_seed, IdRule};
use crate::assess::premise::Premise;
use crate::assess::task::TaskRef;
use crate::assess::variant::make_variant;
use crate::error::NeoError;
use crate::exercise::Exercise;
use crate::reading::ReadingSet;

/// The content an assignment wraps — a lesson/lab exercise or a
/// reading set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
#[ts(
    tag = "kind",
    content = "value",
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum Content {
    Exercise(Exercise),
    Reading(ReadingSet),
}

impl Content {
    /// The premises declared on the content itself — absent means
    /// `[]` on both kinds.
    pub fn premises(&self) -> &[Premise] {
        match self {
            Content::Exercise(ex) => &ex.premises,
            Content::Reading(set) => &set.premises,
        }
    }
}

/// The variant one student works (spec §5.2): the transformed
/// content, the attempt seed it grew from — also the bootstrap seed
/// `predict_branch` tasks rerun — the retry attempt that satisfied
/// every premise (0 = the seed itself), and whether all retries
/// failed so the base is served. `retry` is always in `0..=50`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Variant {
    pub content: Content,
    /// The attempt seed used — the variant's bootstrap seed. `seed`
    /// itself on retry 0, a `retry_seed` otherwise, the student seed
    /// again when `fell_back`.
    #[ts(type = "number")]
    pub seed: u64,
    pub retry: u8,
    pub fell_back: bool,
}

/// How the assignment asks for the student id (spec §5.1): the prompt
/// label and the normalisation rule applied before hashing.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct IdPrompt {
    pub label: String,
    pub rule: IdRule,
}

/// Practice gives feedback after each task and allows retries; test
/// gives none until Finish (spec §5.1).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum Mode {
    Practice,
    Test,
}

fn one() -> f64 {
    1.0
}

/// A gradable task in the assignment's list (spec §5.1–5.3): the task
/// reference and its points (default 1).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct GradedTask {
    pub task: TaskRef,
    #[serde(default = "one")]
    pub points: f64,
}

/// An assignment (spec §5.1): content, the id prompt, mode, whether
/// variation is on, and the graded tasks.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Assignment {
    pub id: String,
    pub title: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub instructions: Option<String>,
    pub content: Content,
    pub id_prompt: IdPrompt,
    pub mode: Mode,
    /// Variation on/off (spec §4): off serves every student the base
    /// content — still seeded, so bootstrap tasks stay per-student.
    pub variation: bool,
    pub tasks: Vec<GradedTask>,
}

impl Assignment {
    /// The variant `student_id` works: normalise under the prompt's
    /// rule, seed from `(id, normalised)`, then `make_variant` with
    /// the content's declared premises and `variation`.
    pub fn variant_for(&self, student_id: &str) -> Result<Variant, NeoError> {
        let nid = normalise_id(student_id, self.id_prompt.rule)?;
        let seed = variant_seed(&self.id, &nid);
        make_variant(&self.content, self.content.premises(), seed, self.variation)
    }
}
