//! Resolution of a reading tree: [`ResolvedTree`] — the parsed `Tree`
//! plus the lookup maps the answers need — built by [`resolve`], plus
//! `resolve_tips`, `resolve_raw`, `normalize` and `item_trees`
//! (v1.4d spec §4.1, plan Task 4).

use std::collections::{BTreeMap, BTreeSet};

use crate::error::NeoError;
use crate::newick::parse_newick;
use crate::reading::query::{clade_key, find_clade, CladeKey};
use crate::reading::set::{
    invalid, invalid_item, Item, Point, PointAt, ReadingSet, ReadingTree, Times, MAX_TIPS,
    MAX_TRAITS, MIN_TIPS,
};
use crate::tree::{NodeId, Tree};
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
pub(crate) fn resolve_tips(
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
pub(crate) fn normalize(name: &str, rt: &mut ReadingTree) -> Result<(), NeoError> {
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

// --- item trees --------------------------------------------------------------------

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
