//! `load_reading_set` and its structural pre-scan: refuse `null` and
//! wrong container shapes before serde reports them anonymously, then
//! parse field by field so errors name the key (v1.4d spec §5.1, plan
//! Task 4).

use std::collections::{BTreeMap, HashMap, HashSet};

use serde::Deserialize;
use serde_json::{Map, Value};

use crate::error::NeoError;
use crate::reading::answer;
use crate::reading::resolve::{normalize, resolve};
use crate::reading::set::{invalid, invalid_item, Item, ReadingSet, ReadingTree, MAX_ITEMS};
use crate::reading::validate::validate_item;
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
