//! The question kinds of a reading item — `Question`, `RelForm`,
//! `Statement`, `TraitAsk` (v1.4d spec §4.3, plan Task 4). Pure file
//! types; evaluation lives in `crate::reading::answer` and validation
//! in `crate::reading::validate`.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::reading::query::CladeKey;
use crate::reading::set::clade_ref;

/// The question kinds of spec §4.3; `type` tags the JSON.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "type", rename_all = "snake_case")]
#[ts(
    tag = "type",
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum Question {
    WhichDiffers {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        reference: Option<String>,
    },
    WhichFits {
        small: Vec<String>,
    },
    Mrca {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        options: Option<Vec<String>>,
    },
    PlaceTaxon {
        name: String,
        #[serde(deserialize_with = "clade_ref")]
        sister: CladeKey,
    },
    IsClade {
        #[serde(default, skip_serializing_if = "Option::is_none")]
        #[ts(optional)]
        by_trait: Option<String>,
    },
    SmallestClade,
    ClosestRelative {
        form: RelForm,
    },
    CountClades,
    OrderNodes {
        nodes: Vec<String>,
    },
    SelectTrue {
        statements: Vec<Statement>,
    },
    Trait {
        ask: TraitAsk,
    },
    /// The only authored answer: `correct` indexes `options`.
    Concept {
        options: Vec<String>,
        correct: Vec<usize>,
    },
    /// A computed question plus an authored "because…" reason.
    TwoTier {
        first: Box<Question>,
        reasons: Vec<String>,
        correct_reason: usize,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum RelForm {
    Closest,
    MostDistant,
    Pairwise,
}

/// An engine-evaluated statement template for `select_true`; `text` is
/// what the student sees, `kind` tags the JSON (spec §4.3).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(
    tag = "kind",
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum Statement {
    CloserThan {
        x: String,
        y: String,
        z: String,
        text: String,
    },
    IsClade {
        #[serde(deserialize_with = "clade_ref")]
        tips: CladeKey,
        text: String,
    },
    CladeInNotIn {
        #[serde(deserialize_with = "clade_ref")]
        tips: CladeKey,
        tree_i: usize,
        tree_j: usize,
        text: String,
    },
    SameRelationships {
        tree_i: usize,
        tree_j: usize,
        text: String,
    },
    /// Node letters; ancestry decides, ages decide when both are known.
    OlderThan { p: String, q: String, text: String },
    /// A node letter versus a literal age; needs `times` ages.
    OlderThanAge { p: String, age: f64, text: String },
    /// "Lineage `tip` is at least `age` old" — bounded by the oldest
    /// fossil tip of its sister group; needs `times` ages.
    LineageAtLeast { tip: String, age: f64, text: String },
    HasTrait {
        tip: String,
        trait_name: String,
        text: String,
    },
    SharedDerived {
        trait_name: String,
        #[serde(deserialize_with = "clade_ref")]
        tips: CladeKey,
        text: String,
    },
    /// "`inner` arose within a lineage that already had `outer`".
    GainedWithin {
        inner: String,
        outer: String,
        text: String,
    },
}

/// The `trait` question's sub-asks (spec §4.3); `kind` tags the JSON.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "snake_case")]
#[ts(
    tag = "kind",
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum TraitAsk {
    /// Which taxa have `trait_name`? (select all)
    WhichHave { trait_name: String },
    /// Which trait is shared by exactly `tips`?
    WhichShared {
        #[serde(deserialize_with = "clade_ref")]
        tips: CladeKey,
    },
    /// How many times did `trait_name` change?
    HowManyChanges { trait_name: String },
    /// `tip`'s full trait profile (derived states).
    Profile { tip: String },
    /// Is `trait_name` ancestral or derived in `tip`?
    AncestralOrDerived { trait_name: String, tip: String },
    /// Which taxa have `has` but lack `lacks`?
    HasNot { has: String, lacks: String },
    /// Is `trait_name` in `x` and `y` homologous or independent?
    Homologous {
        trait_name: String,
        x: String,
        y: String,
    },
}
