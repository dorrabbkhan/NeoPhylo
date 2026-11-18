//! Reading-set file format: types, `load_reading_set` and validation
//! (v1.4d spec §4, §5.1, plan Task 4).
//!
//! A reading set is `kind: "reading"`, `schema_version: 1`. Nodes and
//! branches are named by [`CladeKey`] — the sorted tip labels below them —
//! or by the string `"root"` in files, which resolves to the full tip
//! set. `load_reading_set` parses, resolves every clade identifier,
//! enforces the plan's limits (3–40 tips per tree, 1–4 trees per item,
//! tips-up trees ≤ 12 tips, 1–60 items, ≤ 20 traits per tree) and checks
//! that [`crate::reading::answer`] succeeds for every item. Every refusal
//! is `NeoError::InvalidReading` naming the item id (empty for set- and
//! tree-level problems) and the field; the engine never panics.

use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use serde::{Deserialize, Deserializer, Serialize};
use serde_json::{Map, Value};
use ts_rs::TS;

use crate::error::NeoError;
use crate::exercise::ExerciseMeta;
use crate::newick::parse_newick;
use crate::reading::answer;
use crate::reading::query::{clade_key, find_clade, mrca, CladeKey};
use crate::reading::traits::Mark;
use crate::tree::{NodeId, Tree};

// --- limits (plan "Decided in this plan") -----------------------------------

const MIN_TIPS: usize = 3;
const MAX_TIPS: usize = 40;
const MAX_ITEM_TREES: usize = 4;
const MAX_TIPS_UP: usize = 12;
const MAX_ITEMS: usize = 60;
const MAX_TRAITS: usize = 20;

// --- error helpers -----------------------------------------------------------

fn invalid(field: impl Into<String>, msg: impl Into<String>) -> NeoError {
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
fn clade_ref<'de, D: Deserializer<'de>>(d: D) -> Result<CladeKey, D::Error> {
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

// --- resolved trees ------------------------------------------------------------

/// A `ReadingTree` parsed and resolved: the `Tree` plus lookup maps the
/// answers need. Built by [`resolve`]; every entry point re-derives it
/// from the stored file shape.
pub(crate) struct ResolvedTree {
    pub tree: Tree,
    pub tips: BTreeSet<String>,
    /// Node letter → node.
    pub letters: BTreeMap<String, NodeId>,
    /// Clade key → node letter (for explanations).
    pub letter_by_clade: BTreeMap<CladeKey, String>,
    /// Point letter → point.
    pub points: BTreeMap<String, Point>,
    /// `Times::Ages`: clade key (incl. singleton tip keys) → age.
    pub ages: Option<BTreeMap<CladeKey, f64>>,
    /// Trait names in option order: authored `traits` first, then
    /// mark-only names in mark order.
    pub trait_names: Vec<String>,
}

impl ResolvedTree {
    pub fn age_of(&self, key: &[String]) -> Option<f64> {
        self.ages.as_ref().and_then(|m| m.get(key).copied())
    }

    /// A tip's age (`0` when unlisted — the present).
    pub fn tip_age(&self, tip: &str) -> f64 {
        self.age_of(&[tip.to_string()]).unwrap_or(0.0)
    }

    /// "node P" when lettered, "the node joining x and y" otherwise
    /// (spec §5.3), "tip x" for a leaf. The unlettered wording takes
    /// the two child subtrees with the smallest minimum leaf labels,
    /// so it is stable under child rotation — variant transforms do
    /// not change explanations.
    pub fn node_desc(&self, node: NodeId) -> String {
        let n = &self.tree.nodes[node.0 as usize];
        if n.children.is_empty() {
            return format!("tip {}", n.label.clone().unwrap_or_default());
        }
        let key = clade_key(&self.tree, node);
        if let Some(l) = self.letter_by_clade.get(&key) {
            return format!("node {l}");
        }
        let mut mins: Vec<String> = n.children.iter().map(|&c| self.min_leaf(c)).collect();
        mins.sort();
        match mins.as_slice() {
            [x, y, ..] => format!("the node joining {x} and {y}"),
            [x] => format!("the node joining {x} and {x}"),
            [] => "the node".to_string(),
        }
    }

    /// The smallest leaf label below `id`.
    fn min_leaf(&self, id: NodeId) -> String {
        let mut stack = vec![id];
        let mut best = String::new();
        while let Some(cur) = stack.pop() {
            let Some(n) = self.tree.nodes.get(cur.0 as usize) else {
                continue;
            };
            if n.children.is_empty() {
                if let Some(l) = &n.label {
                    if best.is_empty() || l.as_str() < best.as_str() {
                        best = l.clone();
                    }
                }
            }
            for &c in &n.children {
                stack.push(c);
            }
        }
        best
    }
}

/// `key` names tips of `rt` (the sentinel `["root"]` resolves to every
/// tip); returns the sorted, deduplicated tip set. `field` names the
/// JSON field for the error; `loc` is a dotted location like
/// `trees.main.node_letters` or an item id's field.
fn resolve_tips(
    rt: &ResolvedTree,
    key: &[String],
    item: &str,
    field: &str,
) -> Result<CladeKey, NeoError> {
    if key.len() == 1 && key[0] == "root" {
        return Ok(rt.tips.iter().cloned().collect());
    }
    for t in key {
        if !rt.tips.contains(t) {
            return Err(invalid_item(item, field, format!("unknown tip '{t}'")));
        }
    }
    let mut out = key.to_vec();
    out.sort();
    out.dedup();
    Ok(out)
}

/// Parse and resolve `name`'s tree, validating the tree-level file
/// fields (newick, node_letters, times, marks, points, traits).
pub(crate) fn resolve(name: &str, rt: &ReadingTree) -> Result<ResolvedTree, NeoError> {
    let tf = |key: &str| format!("trees.{name}.{key}");
    let tree = parse_newick(&rt.newick).map_err(|e| invalid(tf("newick"), e.to_string()))?;
    let labels = tree.leaf_labels();
    if labels.len() < MIN_TIPS || labels.len() > MAX_TIPS {
        return Err(invalid(
            tf("newick"),
            format!(
                "tree needs {MIN_TIPS}–{MAX_TIPS} tips, has {}",
                labels.len()
            ),
        ));
    }
    let tips: BTreeSet<String> = labels.iter().cloned().collect();
    if tips.len() != labels.len() {
        return Err(invalid(tf("newick"), "tip labels must be unique"));
    }
    if tips.iter().any(|t| t.is_empty()) {
        return Err(invalid(tf("newick"), "every tip needs a label"));
    }
    if tips.contains("root") {
        return Err(invalid(
            tf("newick"),
            "'root' is reserved for the root node",
        ));
    }
    if rt.traits.len() > MAX_TRAITS {
        return Err(invalid(
            tf("traits"),
            format!("at most {MAX_TRAITS} traits per tree"),
        ));
    }

    let mut letters = BTreeMap::new();
    let mut letter_by_clade = BTreeMap::new();
    for nl in &rt.node_letters {
        let node = resolve_raw(&tree, &tips, &nl.on, "", &tf("node_letters"))?;
        let key = crate::reading::query::clade_key(&tree, node);
        if nl.letter.is_empty() {
            return Err(invalid(tf("node_letters"), "letters must not be empty"));
        }
        if letters.insert(nl.letter.clone(), node).is_some() {
            return Err(invalid(
                tf("node_letters"),
                format!("letter '{}' names two nodes", nl.letter),
            ));
        }
        letter_by_clade.insert(key, nl.letter.clone());
    }

    let ages = match &rt.times {
        None => None,
        Some(Times::Schematic) => None,
        Some(Times::Ages { unit, ages, .. }) => {
            if unit.is_empty() {
                return Err(invalid(tf("times"), "unit must not be empty"));
            }
            let mut map = BTreeMap::new();
            for na in ages {
                let node = resolve_raw(&tree, &tips, &na.on, "", &tf("times"))?;
                let key = crate::reading::query::clade_key(&tree, node);
                if !na.age.is_finite() || na.age < 0.0 {
                    return Err(invalid(tf("times"), "ages must be finite numbers ≥ 0"));
                }
                map.insert(key, na.age);
            }
            // Every internal node needs an age; ages must strictly
            // decrease toward the tips (spec §4.1).
            for id in tree.preorder() {
                if !tree.is_leaf(id) {
                    let key = crate::reading::query::clade_key(&tree, id);
                    if !map.contains_key(&key) {
                        return Err(invalid(
                            tf("times"),
                            format!(
                                "every internal node needs an age; {{{}}} has none",
                                key.join(", ")
                            ),
                        ));
                    }
                }
            }
            let listed: Vec<(NodeId, f64)> = tree
                .preorder()
                .into_iter()
                .filter_map(|id| {
                    map.get(&crate::reading::query::clade_key(&tree, id))
                        .map(|&a| (id, a))
                })
                .collect();
            for &(n, a_n) in &listed {
                for &(m, a_m) in &listed {
                    if crate::reading::query::is_ancestor(&tree, m, n) && a_n >= a_m {
                        return Err(invalid(
                            tf("times"),
                            "ages must strictly decrease from root to tips",
                        ));
                    }
                }
            }
            Some(map)
        }
    };

    let mut points = BTreeMap::new();
    for p in &rt.points {
        let node = resolve_raw(&tree, &tips, &p.on, "", &tf("points"))?;
        if p.at == PointAt::Branch && node == tree.root {
            return Err(invalid(
                tf("points"),
                format!("point '{}' sits on a branch above the root", p.letter),
            ));
        }
        if p.letter.is_empty() {
            return Err(invalid(tf("points"), "letters must not be empty"));
        }
        if points.insert(p.letter.clone(), p.clone()).is_some() || letters.contains_key(&p.letter) {
            return Err(invalid(
                tf("points"),
                format!("letter '{}' names two things", p.letter),
            ));
        }
    }

    for m in &rt.marks {
        let node = resolve_raw(&tree, &tips, &m.on, "", &tf("marks"))?;
        if node == tree.root {
            return Err(invalid(
                tf("marks"),
                "the root has no branch above it; a mark cannot sit there",
            ));
        }
    }

    let mut trait_names: Vec<String> = rt.traits.iter().map(|t| t.name.clone()).collect();
    for m in &rt.marks {
        if !trait_names.contains(&m.trait_name) {
            trait_names.push(m.trait_name.clone());
        }
    }

    Ok(ResolvedTree {
        tree,
        tips,
        letters,
        letter_by_clade,
        points,
        ages,
        trait_names,
    })
}

/// `resolve_tips`/`resolve_node` on the un-resolved pieces (`key` still
/// raw from the file, `tips` just collected).
fn resolve_raw(
    tree: &Tree,
    tips: &BTreeSet<String>,
    key: &[String],
    item: &str,
    field: &str,
) -> Result<NodeId, NeoError> {
    let resolved = if key.len() == 1 && key[0] == "root" {
        tips.iter().cloned().collect::<Vec<_>>()
    } else {
        for t in key {
            if !tips.contains(t) {
                return Err(invalid_item(item, field, format!("unknown tip '{t}'")));
            }
        }
        key.to_vec()
    };
    find_clade(tree, &resolved).ok_or_else(|| {
        invalid_item(
            item,
            field,
            format!("no node has exactly the tips {{{}}}", resolved.join(", ")),
        )
    })
}

/// After `resolve` has validated a tree, rewrite every `on` key to the
/// node's canonical tip set — the form `tip_states`, point lookup and
/// `relabel` work in (`"root"` becomes the full tip set, unsorted or
/// duplicated lists sort and dedup).
fn normalize(name: &str, rt: &mut ReadingTree) -> Result<(), NeoError> {
    let tree = parse_newick(&rt.newick)
        .map_err(|e| invalid(format!("trees.{name}.newick"), e.to_string()))?;
    let tips: BTreeSet<String> = tree.leaf_labels().into_iter().collect();
    let canon = |key: &[String], field: String| -> Result<CladeKey, NeoError> {
        let n = resolve_raw(&tree, &tips, key, "", &field)?;
        Ok(clade_key(&tree, n))
    };
    for nl in &mut rt.node_letters {
        nl.on = canon(&nl.on, format!("trees.{name}.node_letters"))?;
    }
    if let Some(Times::Ages { ages, .. }) = &mut rt.times {
        for na in ages {
            na.on = canon(&na.on, format!("trees.{name}.times"))?;
        }
    }
    for m in &mut rt.marks {
        m.on = canon(&m.on, format!("trees.{name}.marks"))?;
    }
    for p in &mut rt.points {
        p.on = canon(&p.on, format!("trees.{name}.points"))?;
    }
    Ok(())
}

// --- structural pre-scan --------------------------------------------------------

/// Refuse `null` where the types do not allow it and wrong container
/// shapes where the pinned refusals need a field name — before serde
/// reports them anonymously (the "serde gap" of Global Constraints).
fn scan(value: &Value) -> Result<(), NeoError> {
    let obj = value
        .as_object()
        .ok_or_else(|| invalid("json", "a reading set is a JSON object"))?;
    let obj_nullable = |o: &Map<String, Value>, nullable: &[&str], where_: &str| {
        for (k, v) in o {
            if v.is_null() && !nullable.contains(&k.as_str()) {
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
        "summary",
        "trees",
        "items",
    ] {
        if !obj.contains_key(k) {
            return Err(invalid(k, "is required"));
        }
    }
    obj_nullable(obj, &["meta"], "")?;

    let trees = obj["trees"]
        .as_object()
        .ok_or_else(|| invalid("trees", "must be an object of named trees"))?;
    for (name, tv) in trees {
        let to = tv
            .as_object()
            .ok_or_else(|| invalid(format!("trees.{name}"), "must be an object"))?;
        if !to.contains_key("newick") {
            return Err(invalid(format!("trees.{name}.newick"), "is required"));
        }
        obj_nullable(to, &["times"], &format!("trees.{name}"))?;
        // Nested objects that carry null-forbidden fields.
        if let Some(Value::Object(times)) = to.get("times") {
            obj_nullable(times, &["source"], &format!("trees.{name}.times"))?;
        }
        for key in ["node_letters", "marks", "traits", "points"] {
            if let Some(arr) = to.get(key) {
                let arr = arr
                    .as_array()
                    .ok_or_else(|| invalid(format!("trees.{name}.{key}"), "must be an array"))?;
                for (i, el) in arr.iter().enumerate() {
                    let eobj = el.as_object().ok_or_else(|| {
                        invalid(
                            format!("trees.{name}.{key}"),
                            format!("entry {i} must be an object"),
                        )
                    })?;
                    obj_nullable(eobj, &[], &format!("trees.{name}.{key}"))?;
                }
            }
        }
    }

    let items = obj["items"]
        .as_array()
        .ok_or_else(|| invalid("items", "must be an array"))?;
    for (i, it) in items.iter().enumerate() {
        let io = it
            .as_object()
            .ok_or_else(|| invalid("items", format!("item {i} must be an object")))?;
        obj_nullable(io, &["note_after", "style", "a", "b", "c"], "")?;
        if let Some(q) = io.get("question") {
            scan_question(q)?;
        }
        if let Some(Value::Object(style)) = io.get("style") {
            scan_style(style)?;
        }
    }
    Ok(())
}

fn scan_style(s: &Map<String, Value>) -> Result<(), NeoError> {
    for (k, v) in s {
        if v.is_null() && k != "per_tree" {
            return Err(invalid(format!("style.{k}"), "must not be null"));
        }
    }
    if let Some(arr) = s.get("per_tree") {
        for el in arr.as_array().into_iter().flatten() {
            if let Some(o) = el.as_object() {
                scan_style(o)?;
            }
        }
    }
    Ok(())
}

fn scan_question(q: &Value) -> Result<(), NeoError> {
    let qo = q
        .as_object()
        .ok_or_else(|| invalid("question", "must be an object"))?;
    let ty = qo.get("type").and_then(Value::as_str).unwrap_or("");
    // `options` is required for `concept` but optional for `mrca`.
    let mut nullable = vec!["reference", "by_trait"];
    if ty == "mrca" {
        nullable.push("options");
    }
    for (k, v) in qo {
        if v.is_null() && !nullable.contains(&k.as_str()) {
            return Err(invalid(format!("question.{k}"), "must not be null"));
        }
    }
    if let Some(Value::Array(stmts)) = qo.get("statements") {
        for (i, s) in stmts.iter().enumerate() {
            let so = s.as_object().ok_or_else(|| {
                invalid(
                    "question.statements",
                    format!("statement {i} must be an object"),
                )
            })?;
            for (k, v) in so {
                if v.is_null() {
                    return Err(invalid(
                        format!("question.statements.{k}"),
                        "must not be null",
                    ));
                }
            }
        }
    }
    if let Some(ask) = qo.get("ask") {
        if let Some(ao) = ask.as_object() {
            for (k, v) in ao {
                if v.is_null() {
                    return Err(invalid(format!("question.ask.{k}"), "must not be null"));
                }
            }
        }
    }
    if let Some(first) = qo.get("first") {
        scan_question(first)?;
    }
    Ok(())
}

// --- loading --------------------------------------------------------------------

/// Deserialize one field of an object, naming `field` on failure.
fn take<T: for<'a> Deserialize<'a>>(
    obj: &mut Map<String, Value>,
    key: &str,
    required: bool,
    item: &str,
    field: &str,
) -> Result<Option<T>, NeoError> {
    match obj.remove(key) {
        None if required => Err(invalid_item(item, field, format!("'{key}' is required"))),
        None => Ok(None),
        Some(v) => serde_json::from_value(v)
            .map(Some)
            .map_err(|e| invalid_item(item, field, e.to_string())),
    }
}

/// Parse and validate a reading set (spec §5.1). Any text in, `Ok` or
/// `NeoError` out — never a panic.
pub fn load_reading_set(json: &str) -> Result<ReadingSet, NeoError> {
    let value: Value = serde_json::from_str(json).map_err(|e| invalid("json", e.to_string()))?;
    scan(&value)?;

    let mut obj = value
        .as_object()
        .cloned()
        .ok_or_else(|| invalid("json", "a reading set is a JSON object"))?;
    let mut set = ReadingSet {
        schema_version: take(&mut obj, "schema_version", true, "", "schema_version")?
            .unwrap_or_default(),
        kind: take(&mut obj, "kind", true, "", "kind")?.unwrap_or_default(),
        id: take(&mut obj, "id", true, "", "id")?.unwrap_or_default(),
        title: take(&mut obj, "title", true, "", "title")?.unwrap_or_default(),
        summary: take(&mut obj, "summary", true, "", "summary")?.unwrap_or_default(),
        meta: take(&mut obj, "meta", false, "", "meta")?,
        mode: take(&mut obj, "mode", false, "", "mode")?.unwrap_or_default(),
        taxa_pool: take(&mut obj, "taxa_pool", false, "", "taxa_pool")?.unwrap_or_default(),
        trees: BTreeMap::new(),
        items: Vec::new(),
    };
    if set.schema_version != 1 {
        return Err(invalid(
            "schema_version",
            format!("expected 1, got {}", set.schema_version),
        ));
    }
    if set.kind != "reading" {
        return Err(invalid("kind", "expected \"reading\""));
    }
    // Pools must be disjoint and duplicate-free: relabelling maps each
    // pool's names through a permutation of the pool, so a name in two
    // pools or twice in one would merge taxa.
    let mut pool_member: HashMap<&str, &str> = HashMap::new(); // taxon → pool
    for (name, list) in &set.taxa_pool {
        if list.is_empty() {
            return Err(invalid(
                format!("taxa_pool.{name}"),
                "a pool needs at least one name",
            ));
        }
        let mut seen = HashSet::new();
        for taxon in list {
            if !seen.insert(taxon) {
                return Err(invalid(
                    format!("taxa_pool.{name}"),
                    format!("'{taxon}' appears twice in this pool"),
                ));
            }
            if let Some(other) = pool_member.insert(taxon.as_str(), name.as_str()) {
                return Err(invalid(
                    format!("taxa_pool.{name}"),
                    format!("'{taxon}' is also in pool '{other}'; pools must be disjoint"),
                ));
            }
        }
    }

    // Trees, field by field so errors name the key.
    let trees_obj = obj["trees"]
        .as_object()
        .cloned()
        .ok_or_else(|| invalid("trees", "must be an object of named trees"))?;
    for (name, tv) in trees_obj {
        let mut to = tv
            .as_object()
            .cloned()
            .ok_or_else(|| invalid(format!("trees.{name}"), "must be an object"))?;
        let tf = |k: &str| format!("trees.{name}.{k}");
        let tree = ReadingTree {
            newick: take(&mut to, "newick", true, "", &tf("newick"))?.unwrap_or_default(),
            node_letters: take(&mut to, "node_letters", false, "", &tf("node_letters"))?
                .unwrap_or_default(),
            times: take(&mut to, "times", false, "", &tf("times"))?,
            marks: take(&mut to, "marks", false, "", &tf("marks"))?.unwrap_or_default(),
            traits: take(&mut to, "traits", false, "", &tf("traits"))?.unwrap_or_default(),
            points: take(&mut to, "points", false, "", &tf("points"))?.unwrap_or_default(),
        };
        set.trees.insert(name.clone(), tree);
    }
    for (name, rt) in &mut set.trees {
        resolve(name, rt)?;
        normalize(name, rt)?;
    }

    // Items, field by field so errors name item id and key.
    let items_arr = obj["items"]
        .as_array()
        .cloned()
        .ok_or_else(|| invalid("items", "must be an array"))?;
    if items_arr.is_empty() || items_arr.len() > MAX_ITEMS {
        return Err(invalid(
            "items",
            format!("a set needs 1–{MAX_ITEMS} items, has {}", items_arr.len()),
        ));
    }
    for (i, iv) in items_arr.into_iter().enumerate() {
        let mut io = iv
            .as_object()
            .cloned()
            .ok_or_else(|| invalid("items", format!("item {i} must be an object")))?;
        let id: String = take(&mut io, "id", true, "", "id")?.unwrap_or_default();
        let item = Item {
            id: id.clone(),
            text: take(&mut io, "text", true, &id, "text")?.unwrap_or_default(),
            note_after: take(&mut io, "note_after", false, &id, "note_after")?,
            trees: take(&mut io, "trees", true, &id, "trees")?.unwrap_or_default(),
            style: take(&mut io, "style", false, &id, "style")?,
            a: take(&mut io, "a", false, &id, "a")?,
            b: take(&mut io, "b", false, &id, "b")?,
            c: take(&mut io, "c", false, &id, "c")?,
            tips: take(&mut io, "tips", false, &id, "tips")?.unwrap_or_default(),
            question: take(&mut io, "question", true, &id, "question")?
                .ok_or_else(|| invalid_item(&id, "question", "is required"))?,
            rotate_tool: take(&mut io, "rotate_tool", false, &id, "rotate_tool")?.unwrap_or(true),
        };
        set.items.push(item);
    }

    let mut ids = HashSet::new();
    for item in &set.items {
        if !ids.insert(item.id.clone()) {
            return Err(invalid_item(&item.id, "id", "item ids must be unique"));
        }
    }
    if let Some(m) = &set.meta {
        if m.minutes == 0 || m.hand_steps == Some(0) {
            return Err(invalid("meta", "minutes and hand_steps are ≥ 1"));
        }
    }

    for i in 0..set.items.len() {
        validate_item(&mut set, i)?;
        // Every item's answer must be computable at load (spec §5.1).
        answer::answer(&set, i)?;
    }
    Ok(set)
}

/// Resolve the item's named trees in order; `ResolvedTree`s for the
/// answer functions.
pub(crate) fn item_trees(set: &ReadingSet, item: &Item) -> Result<Vec<ResolvedTree>, NeoError> {
    item.trees
        .iter()
        .map(|name| {
            let rt = set
                .trees
                .get(name)
                .ok_or_else(|| invalid_item(&item.id, "trees", format!("unknown tree '{name}'")))?;
            resolve(name, rt)
        })
        .collect()
}

// --- item validation -------------------------------------------------------------

/// The placeholders allowed in item text: `{a}`/`{b}`/`{c}` bind the
/// item's fields, `{set}` its `tips` (plan "Decided in this plan").
fn check_placeholders(text: &str, item: &Item, field: &str) -> Result<(), NeoError> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'{' {
            if let Some(end) = text[i..].find('}') {
                let name = &text[i + 1..i + end];
                let bound = match name {
                    "a" => item.a.is_some(),
                    "b" => item.b.is_some(),
                    "c" => item.c.is_some(),
                    "set" => !item.tips.is_empty(),
                    _ => {
                        return Err(invalid_item(
                            &item.id,
                            field,
                            format!("unknown placeholder '{{{name}}}'"),
                        ))
                    }
                };
                if !bound {
                    return Err(invalid_item(
                        &item.id,
                        field,
                        format!("placeholder '{{{name}}}' is not bound"),
                    ));
                }
                i += end + 1;
                continue;
            }
        }
        i += 1;
    }
    Ok(())
}

/// `style.per_tree[i]` overrides the base style for tree `i`.
pub(crate) fn effective_style(style: Option<&Style>, i: usize) -> (Shape, TipSide) {
    let base = style;
    let s = base.and_then(|b| b.per_tree.get(i)).or(base);
    s.map(|s| (s.shape, s.tips))
        .unwrap_or((Shape::Rectangular, TipSide::Right))
}

/// Trait name exists in the tree's defs or marks.
pub(crate) fn known_trait(rt: &ResolvedTree, name: &str) -> bool {
    rt.trait_names.iter().any(|t| t == name)
}

fn validate_item(set: &mut ReadingSet, i: usize) -> Result<(), NeoError> {
    // Work on a clone: validation needs `&set` (tree lookups) while the
    // resolved clade keys are written back into the item.
    let mut item = set.items[i].clone();
    let id = item.id.clone();
    if item.trees.is_empty() || item.trees.len() > MAX_ITEM_TREES {
        return Err(invalid_item(
            &id,
            "trees",
            format!("an item shows 1–{MAX_ITEM_TREES} trees"),
        ));
    }
    for t in &item.trees {
        if !set.trees.contains_key(t) {
            return Err(invalid_item(&id, "trees", format!("unknown tree '{t}'")));
        }
    }
    // The tips-up limit applies to every tree the item draws.
    for (ti, name) in item.trees.iter().enumerate() {
        let (_, side) = effective_style(item.style.as_ref(), ti);
        let rt = &set.trees[name];
        if let Ok(tree) = parse_newick(&rt.newick) {
            if side == TipSide::Up && tree.leaf_labels().len() > MAX_TIPS_UP {
                return Err(invalid_item(
                    &id,
                    "style",
                    format!("tips-up trees show at most {MAX_TIPS_UP} tips"),
                ));
            }
        }
    }
    check_placeholders(&item.text, &item, "text")?;
    if let Some(n) = item.note_after.clone() {
        check_placeholders(&n, &item, "note_after")?;
    }
    let trees = item_trees(set, &item)?;
    let t0 = &trees[0];
    for (f, v) in [("a", &item.a), ("b", &item.b), ("c", &item.c)] {
        if let Some(x) = v {
            if !t0.tips.contains(x) {
                return Err(invalid_item(&id, f, format!("unknown tip '{x}'")));
            }
        }
    }
    if !item.tips.is_empty() {
        let resolved = resolve_tips(t0, &item.tips, &id, "tips")?;
        item.tips = resolved;
    }
    validate_question(set, &mut item, &trees)?;
    set.items[i] = item;
    Ok(())
}

/// Per-question requirements; `trees` are the item's resolved trees.
fn validate_question(
    set: &ReadingSet,
    item: &mut Item,
    trees: &[ResolvedTree],
) -> Result<(), NeoError> {
    let id = item.id.clone();
    let t0 = &trees[0];
    let need_tip = |v: &Option<String>, f: &str| -> Result<String, NeoError> {
        v.clone()
            .ok_or_else(|| invalid_item(&id, f, "the question needs this field"))
            .and_then(|x| {
                if t0.tips.contains(&x) {
                    Ok(x)
                } else {
                    Err(invalid_item(&id, f, format!("unknown tip '{x}'")))
                }
            })
    };
    match &mut item.question {
        Question::WhichDiffers { reference } => {
            if item.trees.len() < 2 {
                return Err(invalid_item(&id, "trees", "which_differs needs 2–4 trees"));
            }
            if let Some(r) = reference {
                let rt = set
                    .trees
                    .get(r)
                    .ok_or_else(|| invalid_item(&id, "reference", format!("unknown tree '{r}'")))?;
                let reft = resolve(r, rt)?;
                for cand in trees {
                    if !cand.tips.is_subset(&reft.tips) {
                        return Err(invalid_item(
                            &id,
                            "trees",
                            "every candidate's tips must be in the reference tree",
                        ));
                    }
                }
            }
        }
        Question::WhichFits { small } => {
            if item.trees.len() < 2 {
                return Err(invalid_item(&id, "trees", "which_fits needs 2–4 trees"));
            }
            if small.len() < 2 || small.len() > MAX_ITEM_TREES {
                return Err(invalid_item(&id, "small", "needs 2–4 small trees"));
            }
            for s in small {
                if !set.trees.contains_key(s) {
                    return Err(invalid_item(&id, "small", format!("unknown tree '{s}'")));
                }
            }
        }
        Question::Mrca { options } => {
            if item.tips.is_empty() {
                return Err(invalid_item(&id, "tips", "mrca needs highlighted tips"));
            }
            if let Some(opts) = options {
                for l in opts {
                    if !t0.points.contains_key(l) {
                        return Err(invalid_item(
                            &id,
                            "options",
                            format!("unknown point letter '{l}'"),
                        ));
                    }
                }
            }
        }
        Question::PlaceTaxon { sister, .. } => {
            let s = resolve_tips(t0, sister, &id, "sister")?;
            *sister = s.clone();
            let m = mrca(&t0.tree, &s).map_err(|e| refield(&id, "sister", e))?;
            if m == t0.tree.root {
                return Err(invalid_item(
                    &id,
                    "sister",
                    "a sister of the whole tree has no stem branch",
                ));
            }
        }
        Question::IsClade { by_trait } => {
            if let Some(t) = by_trait {
                if !known_trait(t0, t) {
                    return Err(invalid_item(
                        &id,
                        "by_trait",
                        format!("unknown trait '{t}'"),
                    ));
                }
            } else if item.tips.is_empty() {
                return Err(invalid_item(&id, "tips", "is_clade needs highlighted tips"));
            }
        }
        Question::SmallestClade => {
            if item.tips.is_empty() {
                return Err(invalid_item(&id, "tips", "smallest_clade needs tips"));
            }
        }
        Question::ClosestRelative { form } => {
            need_tip(&item.a, "a")?;
            if *form == RelForm::Pairwise {
                need_tip(&item.b, "b")?;
                need_tip(&item.c, "c")?;
            }
        }
        Question::CountClades => {}
        Question::OrderNodes { nodes } => {
            if nodes.len() < 2 {
                return Err(invalid_item(&id, "nodes", "order_nodes needs ≥ 2 letters"));
            }
            let mut seen = HashSet::new();
            for l in nodes.iter() {
                if !seen.insert(l.clone()) {
                    return Err(invalid_item(&id, "nodes", format!("letter '{l}' twice")));
                }
                if !t0.letters.contains_key(l) {
                    return Err(invalid_item(
                        &id,
                        "nodes",
                        format!("unknown node letter '{l}'"),
                    ));
                }
            }
            if t0.ages.is_some() {
                // With times the order is unique: every listed node needs
                // an age and no two may tie (spec §4.3, §5.1).
                let mut ages = Vec::new();
                for l in nodes.iter() {
                    let node = t0.letters[l];
                    let key = crate::reading::query::clade_key(&t0.tree, node);
                    let Some(a) = t0.age_of(&key) else {
                        return Err(invalid_item(&id, "nodes", format!("node '{l}' has no age")));
                    };
                    if ages.contains(&a) {
                        return Err(invalid_item(&id, "nodes", "tied ages give no unique order"));
                    }
                    ages.push(a);
                }
            }
        }
        Question::SelectTrue { statements } => {
            if statements.is_empty() {
                return Err(invalid_item(
                    &id,
                    "statements",
                    "select_true needs statements",
                ));
            }
            for s in statements.iter_mut() {
                validate_statement(&id, trees, s)?;
            }
        }
        Question::Trait { ask } => validate_ask(t0, &id, ask)?,
        Question::Concept { options, correct } => {
            if options.len() < 2 {
                return Err(invalid_item(&id, "options", "concept needs ≥ 2 options"));
            }
            if correct.is_empty() || correct.iter().any(|&i| i >= options.len()) {
                return Err(invalid_item(
                    &id,
                    "correct",
                    "indexes an option that exists",
                ));
            }
        }
        Question::TwoTier {
            first,
            reasons,
            correct_reason,
        } => {
            if matches!(**first, Question::Concept { .. } | Question::TwoTier { .. }) {
                return Err(invalid_item(
                    &id,
                    "first",
                    "needs a computed question, not concept or two_tier",
                ));
            }
            if reasons.is_empty() || *correct_reason >= reasons.len() {
                return Err(invalid_item(&id, "correct_reason", "indexes a reason"));
            }
        }
    }
    Ok(())
}

/// Map a query error (item already empty) onto this item and field.
fn refield(item: &str, field: &str, e: NeoError) -> NeoError {
    match e {
        NeoError::InvalidReading { msg, .. } => invalid_item(item, field, msg),
        other => other,
    }
}

fn validate_ask(t0: &ResolvedTree, id: &str, ask: &mut TraitAsk) -> Result<(), NeoError> {
    let need_trait = |t: &str, f: &str| {
        if known_trait(t0, t) {
            Ok(())
        } else {
            Err(invalid_item(id, f, format!("unknown trait '{t}'")))
        }
    };
    let need_tip2 = |t: &str, f: &str| {
        if t0.tips.contains(t) {
            Ok(())
        } else {
            Err(invalid_item(id, f, format!("unknown tip '{t}'")))
        }
    };
    match ask {
        TraitAsk::WhichHave { trait_name } | TraitAsk::HowManyChanges { trait_name } => {
            need_trait(trait_name, "trait_name")?
        }
        TraitAsk::WhichShared { tips } => {
            *tips = resolve_tips(t0, tips, id, "tips")?;
            if tips.is_empty() {
                return Err(invalid_item(id, "tips", "which_shared needs tips"));
            }
        }
        TraitAsk::Profile { tip } => need_tip2(tip, "tip")?,
        TraitAsk::AncestralOrDerived { trait_name, tip } => {
            need_trait(trait_name, "trait_name")?;
            need_tip2(tip, "tip")?;
        }
        TraitAsk::HasNot { has, lacks } => {
            need_trait(has, "has")?;
            need_trait(lacks, "lacks")?;
        }
        TraitAsk::Homologous { trait_name, x, y } => {
            need_trait(trait_name, "trait_name")?;
            need_tip2(x, "x")?;
            need_tip2(y, "y")?;
        }
    }
    Ok(())
}

fn validate_statement(id: &str, trees: &[ResolvedTree], s: &mut Statement) -> Result<(), NeoError> {
    let t0 = &trees[0];
    let tree_at = |i: usize| -> Result<&ResolvedTree, NeoError> {
        trees
            .get(i)
            .ok_or_else(|| invalid_item(id, "statements", format!("no tree at index {i}")))
    };
    let need_letter = |l: &str| -> Result<(), NeoError> {
        if t0.letters.contains_key(l) {
            Ok(())
        } else {
            Err(invalid_item(
                id,
                "statements",
                format!("unknown node letter '{l}'"),
            ))
        }
    };
    match s {
        Statement::CloserThan { x, y, z, .. } => {
            for t in [x, y, z] {
                if !t0.tips.contains(t) {
                    return Err(invalid_item(id, "statements", format!("unknown tip '{t}'")));
                }
            }
        }
        Statement::IsClade { tips, .. } => {
            *tips = resolve_tips(t0, tips, id, "statements")?;
        }
        Statement::CladeInNotIn {
            tips,
            tree_i,
            tree_j,
            ..
        } => {
            let ti = tree_at(*tree_i)?;
            let tj = tree_at(*tree_j)?;
            *tips = resolve_tips(ti, tips, id, "statements")?;
            resolve_tips(tj, tips, id, "statements")?;
        }
        Statement::SameRelationships { tree_i, tree_j, .. } => {
            tree_at(*tree_i)?;
            tree_at(*tree_j)?;
        }
        Statement::OlderThan { p, q, .. } => {
            need_letter(p)?;
            need_letter(q)?;
        }
        Statement::OlderThanAge { p, .. } => {
            if t0.ages.is_none() {
                return Err(invalid_item(
                    id,
                    "statements",
                    "this statement needs times ages",
                ));
            }
            need_letter(p)?;
            let node = t0.letters[p.as_str()];
            let key = crate::reading::query::clade_key(&t0.tree, node);
            if t0.age_of(&key).is_none() {
                return Err(invalid_item(
                    id,
                    "statements",
                    format!("node '{p}' has no age"),
                ));
            }
        }
        Statement::LineageAtLeast { tip, .. } => {
            if t0.ages.is_none() {
                return Err(invalid_item(
                    id,
                    "statements",
                    "this statement needs times ages",
                ));
            }
            if !t0.tips.contains(tip) {
                return Err(invalid_item(
                    id,
                    "statements",
                    format!("unknown tip '{tip}'"),
                ));
            }
        }
        Statement::HasTrait {
            tip, trait_name, ..
        } => {
            if !t0.tips.contains(tip) {
                return Err(invalid_item(
                    id,
                    "statements",
                    format!("unknown tip '{tip}'"),
                ));
            }
            if !known_trait(t0, trait_name) {
                return Err(invalid_item(
                    id,
                    "statements",
                    format!("unknown trait '{trait_name}'"),
                ));
            }
        }
        Statement::SharedDerived {
            trait_name, tips, ..
        } => {
            if !known_trait(t0, trait_name) {
                return Err(invalid_item(
                    id,
                    "statements",
                    format!("unknown trait '{trait_name}'"),
                ));
            }
            *tips = resolve_tips(t0, tips, id, "statements")?;
        }
        Statement::GainedWithin { inner, outer, .. } => {
            for t in [inner, outer] {
                if !known_trait(t0, t) {
                    return Err(invalid_item(
                        id,
                        "statements",
                        format!("unknown trait '{t}'"),
                    ));
                }
            }
        }
    }
    Ok(())
}
