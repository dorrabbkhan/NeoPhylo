//! Reading-set file format: the file types, limits, error helpers and
//! clade-key serde (v1.4d spec §4, §5.1, plan Task 4).
//!
//! A reading set is `kind: "reading"`, `schema_version: 1`. Nodes and
//! branches are named by [`CladeKey`] — the sorted tip labels below them —
//! or by the string `"root"` in files, which resolves to the full tip
//! set. `load_reading_set` (in `load`) parses, resolves every clade
//! identifier, enforces the plan's limits (3–40 tips per tree, 1–4
//! trees per item, tips-up trees ≤ 12 tips, 1–60 items, ≤ 20 traits
//! per tree) and checks that [`crate::reading::answer`] succeeds for
//! every item. Every refusal is `NeoError::InvalidReading` naming the
//! item id (empty for set- and tree-level problems) and the field; the
//! engine never panics. Question kinds live in `question`, resolution
//! in `resolve`, loading in `load`, validation in `validate` and
//! `validate_statement`.

use std::collections::BTreeMap;

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;
use ts_rs::TS;

use crate::error::NeoError;
use crate::exercise::ExerciseMeta;
use crate::reading::query::CladeKey;
use crate::reading::question::Question;
use crate::reading::traits::Mark;

// --- limits (plan "Decided in this plan") -----------------------------------

pub(crate) const MIN_TIPS: usize = 3;
pub(crate) const MAX_TIPS: usize = 40;
pub(crate) const MAX_ITEM_TREES: usize = 4;
pub(crate) const MAX_TIPS_UP: usize = 12;
pub(crate) const MAX_ITEMS: usize = 60;
pub(crate) const MAX_TRAITS: usize = 20;

// --- error helpers -----------------------------------------------------------

pub(crate) fn invalid(field: impl Into<String>, msg: impl Into<String>) -> NeoError {
    NeoError::InvalidReading {
        item: String::new(),
        field: field.into(),
        msg: msg.into(),
    }
}

pub(crate) fn invalid_item(
    item: &str,
    field: impl Into<String>,
    msg: impl Into<String>,
) -> NeoError {
    NeoError::InvalidReading {
        item: item.to_string(),
        field: field.into(),
        msg: msg.into(),
    }
}

// --- clade-key serde -----------------------------------------------------------

/// Deserialize a `CladeKey` from either `"root"` or an array of tip
/// labels. `"root"` is kept as the sentinel `["root"]` until
/// [`load_reading_set`] resolves it against each tree.
pub(crate) fn clade_ref<'de, D: Deserializer<'de>>(d: D) -> Result<CladeKey, D::Error> {
    #[derive(Deserialize)]
    #[serde(untagged)]
    enum Raw {
        Name(String),
        Tips(Vec<String>),
    }
    match Raw::deserialize(d)? {
        Raw::Name(s) if s == "root" => Ok(vec!["root".to_string()]),
        Raw::Name(s) => Err(serde::de::Error::custom(format!(
            "'{s}' is not a tip list; use an array or \"root\""
        ))),
        Raw::Tips(v) => Ok(v),
    }
}

fn true_default() -> bool {
    true
}

// --- file types ----------------------------------------------------------------

/// A whole reading set (`kind: "reading"`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct ReadingSet {
    pub schema_version: u32,
    pub kind: String,
    pub id: String,
    pub title: String,
    pub summary: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub meta: Option<ExerciseMeta>,
    #[serde(default)]
    pub mode: ReadingMode,
    #[serde(default)]
    pub taxa_pool: BTreeMap<String, Vec<String>>,
    pub trees: BTreeMap<String, ReadingTree>,
    pub items: Vec<Item>,
}

/// Practice shows feedback per item; test reveals nothing until the
/// summary (spec §4.4).
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(
    rename_all = "lowercase",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum ReadingMode {
    #[default]
    Practice,
    Test,
}

/// A named tree of the set: Newick plus display and trait extras.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct ReadingTree {
    pub newick: String,
    #[serde(default)]
    pub node_letters: Vec<NodeLetter>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(
        optional,
        type = "\"schematic\" | { unit: string; source?: string; ages: { on: string[]; age: number }[] }"
    )]
    pub times: Option<Times>,
    #[serde(default)]
    #[ts(type = "{ on: string[]; trait: string; change: \"gain\" | \"loss\" }[]")]
    pub marks: Vec<Mark>,
    #[serde(default)]
    pub traits: Vec<TraitDef>,
    #[serde(default)]
    pub points: Vec<Point>,
}

/// A display letter attached to the node named by `on`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct NodeLetter {
    #[serde(deserialize_with = "clade_ref")]
    pub on: CladeKey,
    pub letter: String,
}

/// Node ages for a time axis: `"schematic"` (direction only) or an
/// object with `unit`, optional `source` and per-node `ages`
/// (spec §4.1, §4.5). Serde is manual so the bare string and the object
/// both decode.
#[derive(Debug, Clone, PartialEq)]
pub enum Times {
    Schematic,
    Ages {
        unit: String,
        source: Option<String>,
        ages: Vec<NodeAge>,
    },
}

impl Serialize for Times {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Self::Schematic => s.serialize_str("schematic"),
            Self::Ages { unit, source, ages } => {
                #[derive(Serialize)]
                struct Body<'a> {
                    unit: &'a str,
                    #[serde(skip_serializing_if = "Option::is_none")]
                    source: &'a Option<String>,
                    ages: &'a [NodeAge],
                }
                Body { unit, source, ages }.serialize(s)
            }
        }
    }
}

impl<'de> Deserialize<'de> for Times {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let v = Value::deserialize(d)?;
        if v == Value::String("schematic".into()) {
            return Ok(Self::Schematic);
        }
        #[derive(Deserialize)]
        struct Body {
            unit: String,
            source: Option<String>,
            ages: Vec<NodeAge>,
        }
        serde_json::from_value::<Body>(v)
            .map(|b| Self::Ages {
                unit: b.unit,
                source: b.source,
                ages: b.ages,
            })
            .map_err(|e| serde::de::Error::custom(format!("times: {e}")))
    }
}

/// A node's age; `on` names the node (a tip's age makes it a fossil).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct NodeAge {
    #[serde(deserialize_with = "clade_ref")]
    pub on: CladeKey,
    pub age: f64,
}

/// Display names for a trait's ancestral and derived states
/// (spec §4.1); without one, states show as "lacks T" / "has T".
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct TraitDef {
    pub name: String,
    pub ancestral: String,
    pub derived: String,
}

/// A lettered point on a node (`at: "node"`, a tip when the clade is a
/// leaf) or on the branch leading to the clade (`at: "branch"`).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Point {
    pub letter: String,
    #[serde(deserialize_with = "clade_ref")]
    pub on: CladeKey,
    pub at: PointAt,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "lowercase")]
#[ts(
    rename_all = "lowercase",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum PointAt {
    Node,
    Branch,
}

/// One question of a reading set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Item {
    pub id: String,
    pub text: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub note_after: Option<String>,
    pub trees: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub style: Option<Style>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub a: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub b: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    #[ts(optional)]
    pub c: Option<String>,
    #[serde(default)]
    pub tips: Vec<String>,
    pub question: Question,
    #[serde(default = "true_default")]
    pub rotate_tool: bool,
}

/// Drawing style: shape plus tip side; `per_tree[i]` overrides the base
/// style for `trees[i]` (used by `which_differs`, Review Focus 2).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Style {
    pub shape: Shape,
    pub tips: TipSide,
    #[serde(default)]
    pub per_tree: Vec<Style>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum Shape {
    Rectangular,
    Diagonal,
    Circular,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum TipSide {
    Right,
    Up,
    Left,
    Down,
}
