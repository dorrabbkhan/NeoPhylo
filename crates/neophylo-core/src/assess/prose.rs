//! `prose_names_taxa` (owner decision 2026-11-25, carried into plan
//! Task 6): report, per prompt index, the taxon names the prompt's
//! student-facing text fields mention. The assignment builder warns
//! on these — a student's variant relabels or resamples the data, so
//! prose that says "E and F join" is wrong for the student sitting
//! next to them.
//!
//! Only content whose variant can change names or data counts is
//! scanned: `Simulated` (names = the true tree's tip labels) and a
//! `Matrix` with a `true` reference (names = the matrix labels).
//! Fixed content — embedded alignments, typed matrices, lab files —
//! returns `[]`.
//!
//! A match is whole-word and case-sensitive, with two exceptions
//! because single-letter labels collide with English and maths:
//! the labels `a` and `A` are always ignored (the article), and a
//! label directly followed by `(` is ignored (notation such as
//! `d(i,j)`).

use crate::exercise::{Exercise, ExerciseData, ReferenceKind};
use crate::newick::parse_newick;

/// Word characters a label may not abut — letters, digits and `_`
/// (so `R_i` never matches label `i`).
fn word_char(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// True when `name` occurs in `text` as a whole word, not directly
/// followed by `(` (function notation like `d(i,j)`).
fn mentions(text: &str, name: &str) -> bool {
    text.match_indices(name).any(|(p, _)| {
        let before = text[..p].chars().next_back();
        let after = text[p + name.len()..].chars().next();
        before.is_none_or(|c| !word_char(c))
            && after.is_none_or(|c| !word_char(c))
            && after != Some('(')
    })
}

/// Per prompt index, the sorted taxon names the prompt's
/// `concept`/`math`/`reveal`/`reveal_pair` fields mention — only
/// prompts with at least one match appear.
pub fn prose_names_taxa(ex: &Exercise) -> Vec<(u32, Vec<String>)> {
    let names: Vec<String> = match &ex.data {
        ExerciseData::Simulated { true_tree, .. } => parse_newick(true_tree)
            .map(|t| t.leaf_labels())
            .unwrap_or_default(),
        ExerciseData::Matrix { names, .. }
            if ex
                .reference
                .as_ref()
                .is_some_and(|r| r.kind == ReferenceKind::True) =>
        {
            names.clone()
        }
        _ => return Vec::new(),
    };
    let names: Vec<String> = names.into_iter().filter(|n| n != "a" && n != "A").collect();
    ex.prompts
        .iter()
        .enumerate()
        .filter_map(|(i, p)| {
            let mut fields: Vec<&str> = vec![p.concept.as_str()];
            if let Some(m) = &p.math {
                fields.push(m);
            }
            if let Some(r) = &p.reveal {
                fields.push(r);
            }
            if let Some(rp) = &p.reveal_pair {
                fields.extend(rp.iter().map(|s| s.as_str()));
            }
            let mut hit: Vec<String> = names
                .iter()
                .filter(|n| fields.iter().any(|f| mentions(f, n)))
                .cloned()
                .collect();
            hit.sort();
            hit.dedup();
            (!hit.is_empty()).then_some((i as u32, hit))
        })
        .collect()
}
