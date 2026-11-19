//! Wire types for reading answers: the student [`Response`], the
//! [`Accepted`] answer, the [`AnswerKey`] and the [`Verdict`]
//! (v1.4d spec §5.3, plan Task 4).

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::reading::query::{CladeKey, Closer};

// --- wire types ------------------------------------------------------------------

/// A student's response; `kind` tags the JSON.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(
    tag = "kind",
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum Response {
    Choice {
        index: usize,
    },
    Choices {
        indices: Vec<usize>,
    },
    Node {
        clade: CladeKey,
    },
    Point {
        letter: String,
    },
    Tips {
        tips: Vec<String>,
    },
    Order {
        letters: Vec<String>,
    },
    Number {
        value: u32,
    },
    Pairwise {
        #[ts(type = "\"B\" | \"C\" | \"Equal\"")]
        answer: Closer,
    },
    TwoTier {
        first: Box<Response>,
        reason: usize,
    },
}

/// The accepted answer of an item; adjacently tagged
/// (`{"kind": "clade", "value": [...]}`) because several variants carry
/// a bare tip set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", content = "value", rename_all = "snake_case")]
#[ts(
    tag = "kind",
    content = "value",
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum Accepted {
    /// Accepted option indices (`which_differs` may name the
    /// "all show the same" index `trees.len()`).
    Choices(Vec<usize>),
    /// A node named by its tip set (`mrca`, `smallest_clade`).
    Clade(CladeKey),
    /// A point letter (`mrca` with options, `place_taxon`).
    Point(String),
    /// Exactly this tip set (select-all questions).
    TipSet(CladeKey),
    /// Any one tip of the set, or the whole set — `closest_relative`
    /// accepts both the single-answer and the select-all response.
    AnyTipOf(CladeKey),
    /// `order_nodes` acceptance rule: "ancestry" (every linear
    /// extension) or "ages" (the unique order by age).
    Orders {
        rule: String,
    },
    Number(u32),
    Pairwise(#[ts(type = "\"B\" | \"C\" | \"Equal\"")] Closer),
    /// Per-statement truth values for `select_true`.
    Statements(Vec<bool>),
    TwoTier {
        first: Box<Accepted>,
        reason: usize,
    },
}

/// The engine key for one item. `authored` marks the parts the file
/// wrote itself (concept answers and `two_tier` reasons — labelled
/// "authored answer" wherever shown, spec §4.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct AnswerKey {
    pub accepted: Accepted,
    pub explanation: String,
    pub authored: bool,
}

/// `check`'s verdict: correctness plus the explanation.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Verdict {
    pub correct: bool,
    pub explanation: String,
}
