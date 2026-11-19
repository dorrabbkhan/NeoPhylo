//! Item validation for a reading set: placeholders, the tips-up style
//! limit and per-question requirements (v1.4d spec §5.1, plan Task 4).
//! Statement and trait-ask validation lives in `validate_statement`.

use std::collections::HashSet;

use crate::error::NeoError;
use crate::newick::parse_newick;
use crate::reading::query::mrca;
use crate::reading::question::{Question, RelForm};
use crate::reading::resolve::{item_trees, resolve, resolve_tips, ResolvedTree};
use crate::reading::set::{
    invalid_item, Item, ReadingSet, Shape, Style, TipSide, MAX_ITEM_TREES, MAX_TIPS_UP,
};
use crate::reading::validate_statement::{refield, validate_ask, validate_statement};
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

pub(crate) fn validate_item(set: &mut ReadingSet, i: usize) -> Result<(), NeoError> {
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
