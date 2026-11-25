//! The built-in content hash guard (v1.5 spec §2.1 changelog rule,
//! plan Task 6): `exercises/content-hashes.json` records the
//! `content_hash` of every built-in content file — the lessons,
//! labs and reading sets an assignment's `builtin` reference can
//! name. A release that changes a file's answers without a
//! `CHANGELOG.md` `[Unreleased]` entry naming it breaks instructors'
//! recorded hashes, so this test fails unless the file's id appears
//! in `[Unreleased]` — then it prints the command that regenerates
//! `content-hashes.json`.
//!
//! Regenerate after a deliberate content change:
//!
//! ```text
//! UPDATE_CONTENT_HASHES=1 cargo test -p neophylo-core --test changelog_guard
//! ```

use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::{Path, PathBuf};

use neophylo_core::assess::content_hash;

fn exercises_dir() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("..")
        .join("..")
        .join("exercises")
}

fn hashes_path() -> PathBuf {
    exercises_dir().join("content-hashes.json")
}

/// Every file a `builtin` reference can resolve: `*.json` under the
/// content directories whose own `id` field equals its stem. Schemas
/// and this file's own `content-hashes.json` carry no `id` and drop
/// out on their own.
fn builtin_files() -> BTreeMap<String, PathBuf> {
    let mut out = BTreeMap::new();
    for dir in ["", "labs", "reading", "reading/coverage"] {
        let dir_path = exercises_dir().join(dir);
        for entry in fs::read_dir(&dir_path).unwrap_or_else(|e| panic!("{dir_path:?}: {e}")) {
            let path = entry.unwrap().path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let stem = path.file_stem().unwrap().to_string_lossy().to_string();
            let text = fs::read_to_string(&path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
            let Ok(json) = serde_json::from_str::<serde_json::Value>(&text) else {
                panic!("{path:?}: not JSON")
            };
            let id = json.get("id").and_then(|v| v.as_str());
            match id {
                // A file a `builtin` id can name must carry that same
                // id inside — the resolver binds `<stem>.json`, so the
                // stem and the inner id must agree.
                Some(inner) => assert_eq!(
                    inner, stem,
                    "{path:?}: a built-in's `id` must equal its file stem"
                ),
                None => continue,
            }
            assert!(
                out.insert(stem.clone(), path.clone()).is_none(),
                "{stem}: two built-in content files share an id"
            );
        }
    }
    out
}

fn recorded() -> BTreeMap<String, String> {
    let text =
        fs::read_to_string(hashes_path()).unwrap_or_else(|e| panic!("content-hashes.json: {e}"));
    serde_json::from_str::<BTreeMap<String, String>>(&text)
        .unwrap_or_else(|e| panic!("content-hashes.json must map id → hash: {e}"))
}

fn compute(files: &BTreeMap<String, PathBuf>) -> BTreeMap<String, String> {
    files
        .iter()
        .map(|(id, path)| {
            let bytes = fs::read(path).unwrap_or_else(|e| panic!("{path:?}: {e}"));
            (id.clone(), content_hash(&bytes))
        })
        .collect()
}

/// The text of CHANGELOG.md's `[Unreleased]` section — where the
/// §2.1 rule requires a changed built-in's id to be named.
fn unreleased() -> String {
    let text = fs::read_to_string(
        Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("..")
            .join("..")
            .join("CHANGELOG.md"),
    )
    .unwrap_or_else(|e| panic!("CHANGELOG.md: {e}"));
    let start = text
        .find("## [Unreleased]")
        .unwrap_or_else(|| panic!("CHANGELOG.md has no `## [Unreleased]` section"));
    let rest = &text[start..];
    let end = rest[3..].find("\n## ").map(|i| i + 3).unwrap_or(rest.len());
    rest[..end].to_string()
}

#[test]
fn builtin_content_hashes_are_current() {
    let files = builtin_files();
    let current = compute(&files);

    if env::var_os("UPDATE_CONTENT_HASHES").is_some() {
        let out = serde_json::to_string_pretty(&current).unwrap() + "\n";
        fs::write(hashes_path(), out).unwrap();
        eprintln!(
            "content-hashes.json regenerated for {} files",
            current.len()
        );
        return;
    }

    let recorded = recorded();
    let changelog = unreleased();
    // A stale id (file removed) is a change like any other.
    let mut changed: Vec<String> = recorded
        .keys()
        .filter(|id| !current.contains_key(*id))
        .cloned()
        .collect();
    changed.extend(
        current
            .iter()
            .filter(|(id, hash)| recorded.get(*id) != Some(*hash))
            .map(|(id, _)| id.clone()),
    );
    for id in &changed {
        eprintln!(
            "{id}: built-in content changed — regenerate \
             content-hashes.json with `UPDATE_CONTENT_HASHES=1 cargo test \
             -p neophylo-core --test changelog_guard`"
        );
    }
    for id in &changed {
        assert!(
            changelog.contains(id.as_str()),
            "{id}: a built-in content file's hash changed (or the file is \
             new/removed) but CHANGELOG.md's `[Unreleased]` does not name \
             it — spec §2.1 requires the entry, then regenerate \
             content-hashes.json"
        );
    }
}
