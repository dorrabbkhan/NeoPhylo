//! neophylo-wasm: wasm-bindgen bindings over neophylo-core (spec §5).
//!
//! This crate contains no logic; it only converts types at the boundary
//! (serde types via `serde-wasm-bindgen`). TypeScript types are generated
//! with `ts-rs` into `web/src/engine/generated/`.
//!
//! Every export returns a `WasmResult<T>` serialized as
//! `{ ok: true, value } | { ok: false, error }`; nothing throws on error.
//! A malformed `JsValue` argument is reported as
//! `InvalidExercise { field: "<arg name>", msg }`.

use std::collections::BTreeSet;

use serde::{de::DeserializeOwned, Serialize};
use serde_wasm_bindgen as swb;
use ts_rs::TS;
use wasm_bindgen::prelude::*;

use neophylo_core::algos::{BuildOptions, Method};
use neophylo_core::alphabet::Alphabet;
use neophylo_core::bootstrap::{BootstrapTally, ConsensusKind, DroppedGroup, ReplicateDetail};
use neophylo_core::dist::{DistModel, DistanceMatrix};
use neophylo_core::error::NeoError;
use neophylo_core::exercise::Exercise;
use neophylo_core::phylip::NameMode;
use neophylo_core::protein_dist::PairDetail;
use neophylo_core::reroot::RerootResult;
use neophylo_core::seq::Alignment;
use neophylo_core::sim::SimSpec;
use neophylo_core::tree::{NodeId, Tree};

/// The single envelope every export returns (spec §5, plan gap 3).
/// Errors are values: a failure is `ok: false` with the `NeoError`,
/// never a thrown exception. Untagged, so the wire shape is exactly
/// `{ ok: true, value } | { ok: false, error }`.
#[derive(Debug, Clone, Serialize, TS)]
#[serde(untagged)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum WasmResult<T> {
    Ok {
        #[ts(type = "true")]
        ok: bool,
        value: T,
    },
    Err {
        #[ts(type = "false")]
        ok: bool,
        error: NeoError,
    },
}

impl<T> From<Result<T, NeoError>> for WasmResult<T> {
    fn from(r: Result<T, NeoError>) -> Self {
        match r {
            Ok(value) => Self::Ok { ok: true, value },
            Err(error) => Self::Err { ok: false, error },
        }
    }
}

/// The single serializer shared by every export.
/// `serialize_missing_as_null` sends every `Option::None` to JS as
/// `null`, matching the generated `T | null` types; `json_compatible`
/// keeps the usual `to_value` wire shape otherwise (plain objects,
/// byte arrays).
const SERIALIZER: swb::Serializer =
    swb::Serializer::json_compatible().serialize_missing_as_null(true);

/// Serialize a `WasmResult`. `serde-wasm-bindgen` only fails on types
/// JS cannot represent, which ours never are; null is returned rather
/// than panicking if that ever changes.
fn to_js<T: Serialize>(r: Result<T, NeoError>) -> JsValue {
    WasmResult::from(r)
        .serialize(&SERIALIZER)
        .unwrap_or(JsValue::NULL)
}

/// Deserialize one `JsValue` argument. A malformed argument is reported
/// as `InvalidExercise { field: "<arg name>" }` (plan Task 12).
fn arg<T: DeserializeOwned>(v: JsValue, name: &str) -> Result<T, NeoError> {
    swb::from_value(v).map_err(|e| NeoError::InvalidExercise {
        field: name.to_string(),
        msg: e.to_string(),
    })
}

/// Install the panic hook in development builds only (spec §4.7).
#[cfg(all(target_arch = "wasm32", debug_assertions))]
#[wasm_bindgen(start)]
pub fn init_panic_hook() {
    console_error_panic_hook::set_once();
}

/// Parse FASTA text into an `Alignment` (spec §4.1).
#[wasm_bindgen]
pub fn parse_fasta(text: &str) -> JsValue {
    to_js(neophylo_core::parse_fasta(text))
}

/// Parse Newick text into a `Tree` (spec §4.4).
#[wasm_bindgen]
pub fn parse_newick(text: &str) -> JsValue {
    to_js(neophylo_core::parse_newick(text))
}

/// Serialize a `Tree` back to Newick (spec §4.4).
#[wasm_bindgen]
pub fn write_newick(tree: JsValue) -> JsValue {
    to_js(arg::<Tree>(tree, "tree").map(|t| neophylo_core::write_newick(&t)))
}

/// Serialize a `Tree` to Newick with bootstrap support as internal
/// node labels — integer percent (v1.2 spec §6.8).
#[wasm_bindgen]
pub fn write_newick_with_support(tree: JsValue) -> JsValue {
    to_js(arg::<Tree>(tree, "tree").map(|t| neophylo_core::write_newick_with_support(&t)))
}

/// Serialize a `Tree` to Newick with tool-compatible names — every
/// character outside `[A-Za-z0-9._-]` becomes `_` (runs collapsed),
/// collisions get `_2`/`_3`, no quotes (checkpoint-15 fix:
/// ape/FigTree/iTOL mishandle quoted labels). `support` selects
/// integer-percent internal labels.
#[wasm_bindgen]
pub fn write_newick_compatible(tree: JsValue, support: bool) -> JsValue {
    to_js(arg::<Tree>(tree, "tree").map(|t| neophylo_core::write_newick_compatible(&t, support)))
}

/// The `(original, exported)` renames a compatible Newick write
/// applies, in node order; empty when every label is already safe.
#[wasm_bindgen]
pub fn compatible_names(tree: JsValue) -> JsValue {
    to_js(arg::<Tree>(tree, "tree").map(|t| neophylo_core::compatible_names(&t)))
}

/// True when a verbatim Newick write would quote at least one label —
/// the signal that switches the export's default name mode.
#[wasm_bindgen]
pub fn labels_need_quotes(tree: JsValue) -> JsValue {
    to_js(arg::<Tree>(tree, "tree").map(|t| neophylo_core::labels_need_quotes(&t)))
}

/// Compute pairwise distances under `model` (spec §4.3).
#[wasm_bindgen]
pub fn distances(aln: JsValue, model: JsValue) -> JsValue {
    to_js(arg::<Alignment>(aln, "aln").and_then(|a| {
        arg::<DistModel>(model, "model").and_then(|m| neophylo_core::dist::compute(&a, m))
    }))
}

/// Build a tree from a distance matrix (spec §4.5).
#[wasm_bindgen]
pub fn build_tree(m: JsValue, method: JsValue, opts: JsValue) -> JsValue {
    to_js(arg::<DistanceMatrix>(m, "m").and_then(|m| {
        arg::<Method>(method, "method").and_then(|method| {
            arg::<BuildOptions>(opts, "opts")
                .and_then(|opts| neophylo_core::build_tree(&m, method, opts))
        })
    }))
}

/// Robinson–Foulds comparison of two trees (spec §4.6).
#[wasm_bindgen]
pub fn compare(truth: JsValue, inferred: JsValue) -> JsValue {
    to_js(arg::<Tree>(truth, "truth").and_then(|t| {
        arg::<Tree>(inferred, "inferred").and_then(|i| neophylo_core::compare::rf(&t, &i))
    }))
}

/// Simulate an alignment along `tree` (spec §4.2).
#[wasm_bindgen]
pub fn simulate(tree: JsValue, spec: JsValue) -> JsValue {
    to_js(
        arg::<Tree>(tree, "tree").and_then(|t| {
            arg::<SimSpec>(spec, "spec").and_then(|s| neophylo_core::simulate(&t, &s))
        }),
    )
}

/// Parse and validate a lesson JSON file (plan gap 3, v1.1 spec §3.6).
#[wasm_bindgen]
pub fn load_exercise(json: &str) -> JsValue {
    to_js::<Exercise>(neophylo_core::load_exercise(json))
}

/// The `parse_phylip` result: the alignment plus the name mode Auto
/// actually used, so the UI can show it (v1.1 spec §3.2).
#[derive(Serialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct PhylipParseResult {
    pub alignment: Alignment,
    pub names_used: NameMode,
}

/// Parse PHYLIP text (sequential or interleaved) into an `Alignment`
/// (v1.1 spec §3.2).
#[wasm_bindgen]
pub fn parse_phylip(text: &str, names: JsValue) -> JsValue {
    to_js(arg::<NameMode>(names, "names").and_then(|names| {
        neophylo_core::parse_phylip(text, names).map(|(alignment, names_used)| PhylipParseResult {
            alignment,
            names_used,
        })
    }))
}

/// Auto-detect an alignment's alphabet from its sequence data
/// (v1.1 spec §3.1).
#[wasm_bindgen]
pub fn detect_alphabet(aln: JsValue) -> JsValue {
    to_js(arg::<Alignment>(aln, "aln").map(|a| neophylo_core::detect_alphabet(&a.seqs)))
}

/// Re-validate an alignment under a chosen alphabet; the override path
/// (v1.1 spec §3.1).
#[wasm_bindgen]
pub fn with_alphabet(aln: JsValue, alphabet: JsValue) -> JsValue {
    to_js(arg::<Alignment>(aln, "aln").and_then(|a| {
        arg::<Alphabet>(alphabet, "alphabet")
            .and_then(|alphabet| neophylo_core::with_alphabet(a, alphabet))
    }))
}

/// The pair-panel detail for sequences `i` and `j` of a protein
/// alignment (v1.1 spec §3.4).
#[wasm_bindgen]
pub fn jtt_pair_detail(aln: JsValue, i: usize, j: usize) -> JsValue {
    to_js::<PairDetail>(
        arg::<Alignment>(aln, "aln").and_then(|a| neophylo_core::jtt_pair_detail(&a, i, j)),
    )
}

/// Serialize a `DistanceMatrix` as PHYLIP `neighbor` input
/// (v1.1 spec §3.2).
#[wasm_bindgen]
pub fn write_phylip_matrix(m: JsValue, names: JsValue) -> JsValue {
    to_js(arg::<DistanceMatrix>(m, "m").and_then(|m| {
        arg::<NameMode>(names, "names")
            .and_then(|names| neophylo_core::write_phylip_matrix(&m, names))
    }))
}

// --- v1.2 bootstrap exports (v1.2 spec §4) -----------------------------------
//
// `seed` is `u64` in the engine but `number` in JS, so it crosses as a
// `JsValue` deserialized via `arg` — a `u64` function parameter would
// appear as `bigint` in the generated `.d.ts`, which spec §4 forbids.

/// Run replicates `start .. start + count` and tally their groupings
/// (v1.2 spec §3.3, §4).
#[wasm_bindgen]
pub fn bootstrap_batch(
    aln: JsValue,
    model: JsValue,
    method: JsValue,
    seed: JsValue,
    start: u32,
    count: u32,
) -> JsValue {
    to_js(arg::<Alignment>(aln, "aln").and_then(|a| {
        arg::<DistModel>(model, "model").and_then(|m| {
            arg::<Method>(method, "method").and_then(|method| {
                arg::<u64>(seed, "seed").and_then(|seed| {
                    neophylo_core::bootstrap_batch(&a, m, method, seed, start, count)
                })
            })
        })
    }))
}

/// Merge two tallies over the same alignment, method and run
/// (v1.2 spec §3.3, §4).
#[wasm_bindgen]
pub fn merge_tallies(a: JsValue, b: JsValue) -> JsValue {
    to_js(arg::<BootstrapTally>(a, "a").and_then(|a| {
        arg::<BootstrapTally>(b, "b").and_then(|b| neophylo_core::merge_tallies(&a, &b))
    }))
}

/// Copy the tree with bootstrap support set on every in-scope internal
/// branch (v1.2 spec §3.4, §4).
#[wasm_bindgen]
pub fn support_on_tree(tree: JsValue, tally: JsValue) -> JsValue {
    to_js::<Tree>(arg::<Tree>(tree, "tree").and_then(|t| {
        arg::<BootstrapTally>(tally, "tally")
            .map(|tally| neophylo_core::support_on_tree(&t, &tally))
    }))
}

/// The `labels` argument of spec §4's `consensus(tally, kind, labels)`
/// is redundant since the tally carries them (Task 4 deviation in
/// docs/decisions.md), so the boundary validates it instead: a
/// mismatch is a `LabelMismatch` error value rather than a silently
/// wrong tree.
fn check_consensus_labels(tally: &[String], given: &[String]) -> Result<(), NeoError> {
    if tally == given {
        return Ok(());
    }
    let t: BTreeSet<&String> = tally.iter().collect();
    let g: BTreeSet<&String> = given.iter().collect();
    Err(NeoError::LabelMismatch {
        only_in_a: g.difference(&t).map(|s| (*s).clone()).collect(),
        only_in_b: t.difference(&g).map(|s| (*s).clone()).collect(),
    })
}

/// The consensus tree of a tally under `kind` (v1.2 spec §3.5, §4).
#[wasm_bindgen]
pub fn consensus(tally: JsValue, kind: JsValue, labels: JsValue) -> JsValue {
    to_js::<Tree>(arg::<BootstrapTally>(tally, "tally").and_then(|t| {
        arg::<ConsensusKind>(kind, "kind").and_then(|kind| {
            arg::<Vec<String>>(labels, "labels").and_then(|labels| {
                check_consensus_labels(&t.labels, &labels)
                    .map(|()| neophylo_core::consensus(&t, kind))
            })
        })
    }))
}

/// The original-tree groupings a consensus dropped, with their
/// support (v1.2 spec §3.5, §4).
#[wasm_bindgen]
pub fn consensus_dropped(tree: JsValue, tally: JsValue, kind: JsValue) -> JsValue {
    to_js::<Vec<DroppedGroup>>(arg::<Tree>(tree, "tree").and_then(|t| {
        arg::<BootstrapTally>(tally, "tally").and_then(|tally| {
            arg::<ConsensusKind>(kind, "kind")
                .map(|kind| neophylo_core::consensus_dropped(&t, &tally, kind))
        })
    }))
}

/// The teaching detail of one replicate: weights, its tree, and how it
/// differs from the original (v1.2 spec §3.6, §4).
#[wasm_bindgen]
pub fn replicate_detail(
    aln: JsValue,
    model: JsValue,
    method: JsValue,
    seed: JsValue,
    i: u32,
) -> JsValue {
    to_js::<ReplicateDetail>(arg::<Alignment>(aln, "aln").and_then(|a| {
        arg::<DistModel>(model, "model").and_then(|m| {
            arg::<Method>(method, "method").and_then(|method| {
                arg::<u64>(seed, "seed")
                    .and_then(|seed| neophylo_core::replicate_detail(&a, m, method, seed, i))
            })
        })
    }))
}

/// The outgroup a rooted reference names: the smaller child subtree of
/// its root (v1.2 spec §3.7, §4).
#[wasm_bindgen]
pub fn reference_outgroup(reference: JsValue) -> JsValue {
    to_js::<Vec<String>>(
        arg::<Tree>(reference, "reference").map(|t| neophylo_core::reference_outgroup(&t)),
    )
}

/// Reroot an unrooted tree at the outgroup's split edge, for display
/// only (v1.2 spec §3.7, §4).
#[wasm_bindgen]
pub fn reroot_on_outgroup(tree: JsValue, outgroup: JsValue) -> JsValue {
    to_js::<RerootResult>(arg::<Tree>(tree, "tree").and_then(|t| {
        arg::<Vec<String>>(outgroup, "outgroup")
            .and_then(|og| neophylo_core::reroot_on_outgroup(&t, &og))
    }))
}

// --- v1.4 editor exports (v1.4 spec §5.1) -----------------------------------
//
// Type conversion only — the operations live in neophylo_core::edit.
// Each export works on a deserialized copy of the tree and returns the
// NEW tree in the envelope, so a refused op leaves the caller's object
// untouched and the editor can snapshot previous values for undo.

/// Join component roots `a` and `b` under a new internal node; `lengths`
/// is `[len_to_a, len_to_b]`. Returns the edited tree.
#[wasm_bindgen]
pub fn edit_join(tree: JsValue, a: JsValue, b: JsValue, lengths: JsValue) -> JsValue {
    to_js::<Tree>(arg::<Tree>(tree, "tree").and_then(|mut t| {
        arg::<NodeId>(a, "a").and_then(|a| {
            arg::<NodeId>(b, "b").and_then(|b| {
                arg::<(f64, f64)>(lengths, "lengths").and_then(|lengths| {
                    neophylo_core::edit::join(&mut t, a, b, lengths).map(|_new| t)
                })
            })
        })
    }))
}

/// Detach `node`'s subtree from its parent. Returns the edited tree.
#[wasm_bindgen]
pub fn edit_detach(tree: JsValue, node: JsValue) -> JsValue {
    to_js::<Tree>(arg::<Tree>(tree, "tree").and_then(|mut t| {
        arg::<NodeId>(node, "node")
            .and_then(|node| neophylo_core::edit::detach(&mut t, node).map(|()| t))
    }))
}

/// SPR: move `node` onto the edge above `new_parent_edge`; `lengths` is
/// `[split_position, len_to_node]`. Returns the edited tree.
#[wasm_bindgen]
pub fn edit_move_subtree(
    tree: JsValue,
    node: JsValue,
    new_parent_edge: JsValue,
    lengths: JsValue,
) -> JsValue {
    to_js::<Tree>(arg::<Tree>(tree, "tree").and_then(|mut t| {
        arg::<NodeId>(node, "node").and_then(|node| {
            arg::<NodeId>(new_parent_edge, "new_parent_edge").and_then(|x| {
                arg::<(f64, f64)>(lengths, "lengths").and_then(|lengths| {
                    neophylo_core::edit::move_subtree(&mut t, node, x, lengths).map(|()| t)
                })
            })
        })
    }))
}

/// Set the length of the edge above `child`. Returns the edited tree.
#[wasm_bindgen]
pub fn edit_set_length(tree: JsValue, child: JsValue, length: JsValue) -> JsValue {
    to_js::<Tree>(arg::<Tree>(tree, "tree").and_then(|mut t| {
        arg::<NodeId>(child, "child").and_then(|child| {
            arg::<f64>(length, "length").and_then(|length| {
                neophylo_core::edit::set_length(&mut t, child, length).map(|()| t)
            })
        })
    }))
}

/// Rename a leaf; duplicates and empty names are refused. Returns the
/// edited tree.
#[wasm_bindgen]
pub fn edit_rename_leaf(tree: JsValue, leaf: JsValue, name: JsValue) -> JsValue {
    to_js::<Tree>(arg::<Tree>(tree, "tree").and_then(|mut t| {
        arg::<NodeId>(leaf, "leaf").and_then(|leaf| {
            arg::<String>(name, "name")
                .and_then(|name| neophylo_core::edit::rename_leaf(&mut t, leaf, &name).map(|()| t))
        })
    }))
}

/// Check that the root component is an exercise-saveable tree
/// (`edit::validate_editable`). Returns `()` — only `ok` matters.
#[wasm_bindgen]
pub fn edit_validate(tree: JsValue) -> JsValue {
    to_js::<()>(arg::<Tree>(tree, "tree").and_then(|t| neophylo_core::edit::validate_editable(&t)))
}
