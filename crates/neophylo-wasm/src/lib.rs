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

use std::collections::{BTreeMap, BTreeSet};

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use serde_wasm_bindgen as swb;
use ts_rs::TS;
use wasm_bindgen::prelude::*;

use neophylo_core::algos::{BuildOptions, Method};
use neophylo_core::alphabet::Alphabet;
use neophylo_core::assess::{
    AcceptedAnswer, Assignment, Attempt, CodePayload, GradeResult, PackedAnswer, Quantity, Rule,
    TaskAnswer, TaskRef, Variant, FORMAT_VERSION, GENERATOR_VERSION, PRECISION,
};
use neophylo_core::bootstrap::{BootstrapTally, ConsensusKind, DroppedGroup, ReplicateDetail};
use neophylo_core::dist::{DistModel, DistanceMatrix};
use neophylo_core::error::NeoError;
use neophylo_core::exercise::Exercise;
use neophylo_core::matrix_input::DistanceInput;
use neophylo_core::matrix_parse::{MatrixFile, MatrixFormat, PasteOptions, PhylipMatrixOptions};
use neophylo_core::phylip::NameMode;
use neophylo_core::protein_dist::PairDetail;
use neophylo_core::reading::{
    AnswerKey, CladeKey, Mark, Point, ReadingSet, Response, Times, TraitDef, Verdict,
};
use neophylo_core::reroot::RerootResult;
use neophylo_core::seq::Alignment;
use neophylo_core::sim::SimSpec;
use neophylo_core::site_filter::{SiteFilter, SiteMask};
use neophylo_core::tree::{NodeId, Tree};
use neophylo_core::worksheet::JoinFacts;

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
pub fn parse_fasta(text: JsValue) -> JsValue {
    to_js(arg::<String>(text, "text").and_then(|t| neophylo_core::parse_fasta(&t)))
}

/// Parse Newick text into a `Tree` (spec §4.4).
#[wasm_bindgen]
pub fn parse_newick(text: JsValue) -> JsValue {
    to_js(arg::<String>(text, "text").and_then(|t| neophylo_core::parse_newick(&t)))
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
pub fn write_newick_compatible(tree: JsValue, support: JsValue) -> JsValue {
    to_js(arg::<Tree>(tree, "tree").and_then(|t| {
        arg::<bool>(support, "support").map(|s| neophylo_core::write_newick_compatible(&t, s))
    }))
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

// --- v1.4b MEGA gap treatment and .meg I/O (v1.4b spec §3.1, §3.4) ---

/// Compute pairwise distances under `model` with a site filter
/// (v1.4b spec §3.1). `{ "kind": "pairwise" }` is exactly `distances`.
#[wasm_bindgen]
pub fn distances_filtered(aln: JsValue, model: JsValue, filter: JsValue) -> JsValue {
    to_js(arg::<Alignment>(aln, "aln").and_then(|a| {
        arg::<DistModel>(model, "model").and_then(|m| {
            arg::<SiteFilter>(filter, "filter")
                .and_then(|f| neophylo_core::dist::compute_filtered(&a, m, f))
        })
    }))
}

/// The 0/1 column weights and removed indices a site filter leaves on
/// an alignment (v1.4b spec §3.1) — the data the pair panel marks up.
#[wasm_bindgen]
pub fn site_mask(aln: JsValue, filter: JsValue) -> JsValue {
    to_js::<SiteMask>(arg::<Alignment>(aln, "aln").and_then(|a| {
        arg::<SiteFilter>(filter, "filter").and_then(|f| neophylo_core::site_mask(&a, f))
    }))
}

/// Parse `.meg` text into the alignment plus title and notices
/// (v1.4b spec §3.4). Distance-matrix files are refused.
#[wasm_bindgen]
pub fn parse_meg(text: JsValue) -> JsValue {
    to_js(arg::<String>(text, "text").and_then(|t| neophylo_core::parse_meg(&t)))
}

/// Serialize an `Alignment` as `.meg` text (v1.4b spec §3.4).
#[wasm_bindgen]
pub fn write_meg(aln: JsValue, title: JsValue) -> JsValue {
    to_js(arg::<Alignment>(aln, "aln").and_then(|a| {
        arg::<String>(title, "title").and_then(|title| neophylo_core::write_meg(&a, &title))
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
pub fn load_exercise(json: JsValue) -> JsValue {
    to_js::<Exercise>(arg::<String>(json, "json").and_then(|j| neophylo_core::load_exercise(&j)))
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
pub fn parse_phylip(text: JsValue, names: JsValue) -> JsValue {
    to_js(arg::<String>(text, "text").and_then(|t| {
        arg::<NameMode>(names, "names").and_then(|names| {
            neophylo_core::parse_phylip(&t, names).map(|(alignment, names_used)| {
                PhylipParseResult {
                    alignment,
                    names_used,
                }
            })
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

/// `jtt_pair_detail` under a site filter (v1.4b spec §3.1, §6.2): the
/// pair panel's numbers follow the gap treatment. `{ "kind":
/// "pairwise" }` is bit-identical to `jtt_pair_detail`.
#[wasm_bindgen]
pub fn jtt_pair_detail_filtered(aln: JsValue, i: usize, j: usize, filter: JsValue) -> JsValue {
    to_js::<PairDetail>(arg::<Alignment>(aln, "aln").and_then(|a| {
        arg::<SiteFilter>(filter, "filter")
            .and_then(|f| neophylo_core::jtt_pair_detail_filtered(&a, i, j, f))
    }))
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

/// `bootstrap_batch` under a site filter (v1.4b spec §3.2):
/// replicates draw over the kept columns only. `{ "kind": "pairwise" }`
/// is bit-identical to `bootstrap_batch`.
#[wasm_bindgen]
pub fn bootstrap_batch_filtered(
    aln: JsValue,
    model: JsValue,
    method: JsValue,
    filter: JsValue,
    seed: JsValue,
    start: u32,
    count: u32,
) -> JsValue {
    to_js(arg::<Alignment>(aln, "aln").and_then(|a| {
        arg::<DistModel>(model, "model").and_then(|m| {
            arg::<Method>(method, "method").and_then(|method| {
                arg::<SiteFilter>(filter, "filter").and_then(|f| {
                    arg::<u64>(seed, "seed").and_then(|seed| {
                        neophylo_core::bootstrap_batch_filtered(
                            &a, m, method, f, seed, start, count,
                        )
                    })
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

/// `replicate_detail` under a site filter (v1.4b spec §3.2): the
/// replicate draws over kept columns and the "original" tree is built
/// on filtered distances. `{ "kind": "pairwise" }` is bit-identical to
/// `replicate_detail`.
#[wasm_bindgen]
pub fn replicate_detail_filtered(
    aln: JsValue,
    model: JsValue,
    method: JsValue,
    filter: JsValue,
    seed: JsValue,
    i: u32,
) -> JsValue {
    to_js::<ReplicateDetail>(arg::<Alignment>(aln, "aln").and_then(|a| {
        arg::<DistModel>(model, "model").and_then(|m| {
            arg::<Method>(method, "method").and_then(|method| {
                arg::<SiteFilter>(filter, "filter").and_then(|f| {
                    arg::<u64>(seed, "seed").and_then(|seed| {
                        neophylo_core::replicate_detail_filtered(&a, m, method, f, seed, i)
                    })
                })
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

/// Create a new parentless leaf labelled `name` — a detached component
/// `edit_join`/`edit_move_subtree` can graft (Task 9a). Same name rules
/// as `edit_rename_leaf`. Returns the edited tree.
#[wasm_bindgen]
pub fn edit_add_leaf(tree: JsValue, name: JsValue) -> JsValue {
    to_js::<Tree>(arg::<Tree>(tree, "tree").and_then(|mut t| {
        arg::<String>(name, "name")
            .and_then(|name| neophylo_core::edit::add_leaf(&mut t, &name).map(|_new| t))
    }))
}

/// Check that the root component is an exercise-saveable tree
/// (`edit::validate_editable`). Returns `()` — only `ok` matters.
#[wasm_bindgen]
pub fn edit_validate(tree: JsValue) -> JsValue {
    to_js::<()>(arg::<Tree>(tree, "tree").and_then(|t| neophylo_core::edit::validate_editable(&t)))
}

// --- v1.4c matrix + worksheet exports (v1.4c spec §5, §7.2) -----------
//
// Type conversion only — parsing, validation, format detection and the
// join facts all live in neophylo_core.

/// Validate a `DistanceInput` and return the symmetric `DistanceMatrix`
/// the algorithms consume (`DistModel::Supplied`).
#[wasm_bindgen]
pub fn matrix_to_distances(input: JsValue) -> JsValue {
    to_js::<DistanceMatrix>(
        arg::<DistanceInput>(input, "input").and_then(|i| i.to_distance_matrix()),
    )
}

/// Structural validation of a supplied matrix. Returns `()` — only
/// `ok` matters.
#[wasm_bindgen]
pub fn validate_matrix(input: JsValue) -> JsValue {
    to_js::<()>(
        arg::<DistanceInput>(input, "input").and_then(|i| neophylo_core::validate_input(&i)),
    )
}

/// Which matrix file format the text looks like (`"Phylip"`/`"Meg"`),
/// or null.
#[wasm_bindgen]
pub fn detect_matrix_format(text: JsValue) -> JsValue {
    to_js::<Option<MatrixFormat>>(
        arg::<String>(text, "text").map(|t| neophylo_core::detect_matrix_format(&t)),
    )
}

/// Parse a PHYLIP distance file (`neighbor` layout); `opts` carries the
/// name mode and the asymmetric-triangle choice.
#[wasm_bindgen]
pub fn parse_phylip_matrix(text: JsValue, opts: JsValue) -> JsValue {
    to_js::<MatrixFile>(arg::<String>(text, "text").and_then(|t| {
        arg::<PhylipMatrixOptions>(opts, "opts")
            .and_then(|o| neophylo_core::parse_phylip_matrix(&t, o))
    }))
}

/// Parse a `.meg` distance file (MEGA's `!Format DataType=Distance`).
#[wasm_bindgen]
pub fn parse_meg_matrix(text: JsValue) -> JsValue {
    to_js::<MatrixFile>(
        arg::<String>(text, "text").and_then(|t| neophylo_core::parse_meg_matrix(&t)),
    )
}

/// Parse a pasted table; `PasteOptions` fields left unset are asked as
/// `MatrixAmbiguous` instead of guessed.
#[wasm_bindgen]
pub fn parse_pasted_matrix(text: JsValue, opts: JsValue) -> JsValue {
    to_js::<MatrixFile>(arg::<String>(text, "text").and_then(|t| {
        arg::<PasteOptions>(opts, "opts").and_then(|o| neophylo_core::parse_pasted_matrix(&t, o))
    }))
}

/// Serialize a supplied matrix as `.meg` distance text (lower-left).
#[wasm_bindgen]
pub fn write_meg_matrix(input: JsValue, title: JsValue) -> JsValue {
    to_js::<String>(arg::<DistanceInput>(input, "input").and_then(|i| {
        arg::<String>(title, "title").and_then(|t| neophylo_core::write_meg_matrix(&i, &t))
    }))
}

/// The additive (patristic) matrix of `tree`, for the editor's
/// "derive from tree" route; `round` is an optional decimals count.
#[wasm_bindgen]
pub fn additive_matrix(tree: JsValue, round: JsValue) -> JsValue {
    to_js::<DistanceInput>(arg::<Tree>(tree, "tree").and_then(|t| {
        arg::<Option<u8>>(round, "round").and_then(|r| neophylo_core::additive_matrix(&t, r))
    }))
}

/// One `JoinFacts` per recorded join — worksheet row sums, ties and
/// closest-pair flags straight from the trace (v1.4c spec §7.2).
#[wasm_bindgen]
pub fn worksheet_facts(matrix: JsValue, method: JsValue) -> JsValue {
    to_js::<Vec<JoinFacts>>(arg::<DistanceMatrix>(matrix, "matrix").and_then(|m| {
        arg::<Method>(method, "method")
            .and_then(|method| neophylo_core::worksheet_facts(&m, method))
    }))
}

// --- v1.4d reading exports (v1.4d spec §5, plan Task 5) ---------------
//
// Type conversion only — parsing, validation, answers, checks and the
// seeded transforms all live in `neophylo_core::reading`. Nodes cross
// the boundary as `CladeKey`s (sorted tip sets), never positions
// (spec §4.2).

/// Parse and validate a reading-set JSON file (`kind: "reading"`).
/// Every refusal is `InvalidReading` naming the item and the field.
#[wasm_bindgen]
pub fn load_reading_set(json: JsValue) -> JsValue {
    to_js::<ReadingSet>(
        arg::<String>(json, "json").and_then(|j| neophylo_core::reading::load_reading_set(&j)),
    )
}

/// The engine answer key of the set's item `item` (spec §5.3).
#[wasm_bindgen]
pub fn reading_answer(set: JsValue, item: u32) -> JsValue {
    to_js::<AnswerKey>(
        arg::<ReadingSet>(set, "set")
            .and_then(|s| neophylo_core::reading::answer(&s, item as usize)),
    )
}

/// Check a student `Response` against the engine key (spec §5.3).
#[wasm_bindgen]
pub fn reading_check(set: JsValue, item: u32, response: JsValue) -> JsValue {
    to_js::<Verdict>(arg::<ReadingSet>(set, "set").and_then(|s| {
        arg::<Response>(response, "response")
            .and_then(|r| neophylo_core::reading::check(&s, item as usize, &r))
    }))
}

/// One seeded variant op (spec §5.4); `reading_variant`'s `ops` list.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "snake_case")]
enum VariantOp {
    Rotate,
    Shuffle,
    Relabel,
}

/// Apply the seeded variant transforms in order and return the new
/// set; answers are recomputed on use, never copied (spec §5.4).
#[wasm_bindgen]
pub fn reading_variant(set: JsValue, seed: JsValue, ops: JsValue) -> JsValue {
    to_js::<ReadingSet>(arg::<ReadingSet>(set, "set").and_then(|s| {
        arg::<u64>(seed, "seed").and_then(|seed| {
            arg::<Vec<VariantOp>>(ops, "ops").and_then(|ops| {
                let mut out = s;
                for op in ops {
                    out = match op {
                        VariantOp::Rotate => neophylo_core::reading::rotate(&out, seed),
                        VariantOp::Shuffle => neophylo_core::reading::shuffle_tip_order(&out, seed),
                        VariantOp::Relabel => neophylo_core::reading::relabel(&out, seed)?,
                    };
                }
                Ok(out)
            })
        })
    }))
}

/// The clade key of the node whose tips are exactly `tips` — resolves
/// an editor tap to the stable node identifier (spec §4.2). A tip set
/// no node spans is `InvalidReading` with `field` "tips".
#[wasm_bindgen]
pub fn reading_clade_of(newick: JsValue, tips: JsValue) -> JsValue {
    to_js::<CladeKey>(arg::<String>(newick, "newick").and_then(|nw| {
        neophylo_core::parse_newick(&nw).and_then(|t| {
            arg::<Vec<String>>(tips, "tips").and_then(|tips| {
                neophylo_core::reading::find_clade(&t, &tips)
                    .map(|n| neophylo_core::reading::clade_key(&t, n))
                    .ok_or_else(|| NeoError::InvalidReading {
                        item: String::new(),
                        field: "tips".to_string(),
                        msg: format!("no node has exactly the tips {{{}}}", tips.join(", ")),
                    })
            })
        })
    }))
}

/// The time-axis mode of a `ReadingTreeView` (spec §4.5).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "snake_case")]
#[ts(
    rename_all = "snake_case",
    export,
    export_to = "../../../web/src/engine/generated/"
)]
pub enum ReadingTimes {
    None,
    Schematic,
    Ages,
}

/// One node of a `ReadingTreeView`, named by its clade key.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct ReadingViewNode {
    pub clade: CladeKey,
    pub parent: Option<u32>,
    pub children: Vec<u32>,
    pub label: Option<String>,
    pub letter: Option<String>,
    pub age: Option<f64>,
}

/// A stored reading tree resolved for layout (plan Task 5): nodes in
/// the `Tree` arena order, each named by its `CladeKey`, with letters
/// and ages already resolved and the points, marks and trait defs
/// passed through. This is the input of every `readingLayout` call
/// (plan Task 6).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct ReadingTreeView {
    pub nodes: Vec<ReadingViewNode>,
    pub root: u32,
    pub points: Vec<Point>,
    #[ts(type = "{ on: string[]; trait: string; change: \"gain\" | \"loss\" }[]")]
    pub marks: Vec<Mark>,
    pub traits: Vec<TraitDef>,
    pub times: ReadingTimes,
    pub unit: Option<String>,
}

/// The canonical form of a stored clade key: `"root"` resolves to the
/// full tip set; otherwise sort + dedup. Sets returned by
/// `load_reading_set` are already canonical, so this is a no-op for
/// them and a convenience for editor-built sets.
fn canon_key(key: &[String], all_tips: &BTreeSet<String>) -> CladeKey {
    if key.len() == 1 && key[0] == "root" {
        return all_tips.iter().cloned().collect();
    }
    let mut out = key.to_vec();
    out.sort();
    out.dedup();
    out
}

/// The named tree of a loaded set resolved for layout (plan Task 5).
#[wasm_bindgen]
pub fn reading_tree(set: JsValue, name: JsValue) -> JsValue {
    to_js::<ReadingTreeView>(
        arg::<ReadingSet>(set, "set")
            .and_then(|s| arg::<String>(name, "name").and_then(|name| tree_view(&s, &name))),
    )
}

/// Build the `ReadingTreeView` of `set.trees[name]`.
fn tree_view(set: &ReadingSet, name: &str) -> Result<ReadingTreeView, NeoError> {
    let rt = set
        .trees
        .get(name)
        .ok_or_else(|| NeoError::InvalidReading {
            item: String::new(),
            field: "trees".to_string(),
            msg: format!("unknown tree '{name}'"),
        })?;
    let tree = neophylo_core::parse_newick(&rt.newick).map_err(|e| NeoError::InvalidReading {
        item: String::new(),
        field: format!("trees.{name}.newick"),
        msg: e.to_string(),
    })?;
    let all_tips: BTreeSet<String> = tree.leaf_labels().into_iter().collect();

    let letter_by_clade: BTreeMap<CladeKey, &str> = rt
        .node_letters
        .iter()
        .map(|nl| (canon_key(&nl.on, &all_tips), nl.letter.as_str()))
        .collect();
    let (times, unit, ages) = match &rt.times {
        None => (ReadingTimes::None, None, BTreeMap::new()),
        Some(Times::Schematic) => (ReadingTimes::Schematic, None, BTreeMap::new()),
        Some(Times::Ages { unit, ages, .. }) => (
            ReadingTimes::Ages,
            Some(unit.clone()),
            ages.iter()
                .map(|na| (canon_key(&na.on, &all_tips), na.age))
                .collect(),
        ),
    };
    let nodes = tree
        .nodes
        .iter()
        .enumerate()
        .map(|(i, n)| {
            let clade = neophylo_core::reading::clade_key(&tree, NodeId(i as u32));
            ReadingViewNode {
                letter: letter_by_clade.get(&clade).map(|s| (*s).to_string()),
                age: ages.get(&clade).copied(),
                clade,
                parent: n.parent.map(|p| p.0),
                children: n.children.iter().map(|c| c.0).collect(),
                label: n.label.clone(),
            }
        })
        .collect();
    let canon = |on: &CladeKey| canon_key(on, &all_tips);
    Ok(ReadingTreeView {
        nodes,
        root: tree.root.0,
        points: rt
            .points
            .iter()
            .map(|p| Point {
                on: canon(&p.on),
                ..p.clone()
            })
            .collect(),
        marks: rt
            .marks
            .iter()
            .map(|m| Mark {
                on: canon(&m.on),
                ..m.clone()
            })
            .collect(),
        traits: rt.traits.clone(),
        times,
        unit,
    })
}

// --- v1.5 assess exports (v1.5 spec §4–§5, plan Task 6) ----------------
//
// Type conversion only — parsing, validation, variant seeding, task
// scoring, code packing and grading all live in `neophylo_core::assess`.
// Bindings that take an `assignment_json` expect the resolved file
// shape: a `builtin` reference carries the `file` text its resolver
// injected, so `served_content_hash` is set on every load and grading
// can flag `ContentChanged` for a stale recorded `content_hash`.

/// Parse and validate an assignment file (`kind: "assignment"`).
/// Every refusal is `InvalidAssignment` naming the field.
///
/// The parameter is `JsValue` like every other v1.5 export: the web
/// wrappers call the raw wasm export straight off `init()`'s return,
/// so no per-binding marshal glue reaches the initial bundle (§8.2).
#[wasm_bindgen]
pub fn load_assignment(json: JsValue) -> JsValue {
    to_js::<Assignment>(
        arg::<String>(json, "json").and_then(|j| neophylo_core::assess::load_assignment(&j)),
    )
}

/// The variant `student_id` works (spec §5.2): the resolved
/// assignment file is loaded, then seeded per the id prompt's rule.
#[wasm_bindgen]
pub fn make_variant(assignment_json: JsValue, student_id: JsValue) -> JsValue {
    to_js::<Variant>(
        arg::<String>(assignment_json, "assignment_json").and_then(|j| {
            arg::<String>(student_id, "student_id").and_then(|id| {
                neophylo_core::assess::load_assignment(&j).and_then(|a| a.variant_for(&id))
            })
        }),
    )
}

/// The accepted answer of `task` on `variant` (spec §5.3) —
/// `InvalidAssignment` when the task cannot apply to the content.
#[wasm_bindgen]
pub fn task_key(variant: JsValue, task: JsValue) -> JsValue {
    to_js::<AcceptedAnswer>(arg::<Variant>(variant, "variant").and_then(|v| {
        arg::<TaskRef>(task, "task").and_then(|t| neophylo_core::assess::task_key(&v, &t))
    }))
}

/// Check a student's `TaskAnswer` against the engine key (spec §5.3).
#[wasm_bindgen]
pub fn check_task(variant: JsValue, task: JsValue, answer: JsValue) -> JsValue {
    to_js::<bool>(arg::<Variant>(variant, "variant").and_then(|v| {
        arg::<TaskRef>(task, "task").and_then(|t| {
            arg::<TaskAnswer>(answer, "answer")
                .and_then(|a| neophylo_core::assess::check_task(&v, &t, &a))
        })
    }))
}

/// One graded task's Finish record: `first`/`last` are `TaskAnswer`s —
/// `null` `first` is a skipped task, `null` `last` means the last
/// submission did not differ — and `attempts` is the submit count
/// (the code's 4-bit field clamps it to 15).
#[derive(Debug, Clone, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct EncodeAttempt {
    pub first: Option<TaskAnswer>,
    pub last: Option<TaskAnswer>,
    pub attempts: u8,
}

/// The `NP1-…` completion code a student's Finish produces (spec
/// §5.4): packs every `TaskAnswer` against `variant`'s name table,
/// normalises `student_id` under the assignment's rule and stamps
/// the fingerprint, retry and finish time — packing never happens in
/// TypeScript.
#[wasm_bindgen]
pub fn encode_code(
    assignment_json: JsValue,
    variant: JsValue,
    student_id: JsValue,
    attempts: JsValue,
    finished_min: u32,
) -> JsValue {
    to_js::<String>(
        arg::<String>(assignment_json, "assignment_json").and_then(|j| {
            arg::<String>(student_id, "student_id").and_then(|id| {
                neophylo_core::assess::load_assignment(&j).and_then(|a| {
                    arg::<Variant>(variant, "variant").and_then(|v| {
                        arg::<Vec<EncodeAttempt>>(attempts, "attempts")
                            .and_then(|ats| finish_code(&a, &v, &id, &ats, finished_min))
                    })
                })
            })
        }),
    )
}

/// Assemble the `CodePayload` and encode — one entry per graded
/// task, in the assignment's order.
fn finish_code(
    a: &Assignment,
    v: &Variant,
    student_id: &str,
    attempts: &[EncodeAttempt],
    finished_min: u32,
) -> Result<String, NeoError> {
    if attempts.len() != a.tasks.len() {
        return Err(NeoError::InvalidAssignment {
            field: "attempts".to_string(),
            msg: format!(
                "must carry one entry per graded task — {} expected, {} given",
                a.tasks.len(),
                attempts.len()
            ),
        });
    }
    let mut packed = Vec::with_capacity(attempts.len());
    for (at, gt) in attempts.iter().zip(&a.tasks) {
        let first = match &at.first {
            Some(t) => neophylo_core::assess::pack_answer(v, &gt.task, t)?,
            None => PackedAnswer::Skipped,
        };
        let last = at
            .last
            .as_ref()
            .map(|t| neophylo_core::assess::pack_answer(v, &gt.task, t))
            .transpose()?;
        packed.push(Attempt {
            first,
            last,
            attempts: at.attempts,
        });
    }
    let names = u8::try_from(neophylo_core::assess::name_table(v)?.len()).map_err(|_| {
        NeoError::InvalidAssignment {
            field: "attempts".to_string(),
            msg: "the variant's name table is past the code's cap".to_string(),
        }
    })?;
    neophylo_core::assess::encode_code(&CodePayload {
        format: FORMAT_VERSION,
        generator: GENERATOR_VERSION,
        fingerprint: neophylo_core::assess::fingerprint(a),
        student_id: neophylo_core::assess::normalise_id(student_id, a.id_prompt.rule)?,
        retry: v.retry,
        names,
        attempts: packed,
        finished_min,
    })
}

/// Decode a completion code — `InvalidCode` names the refusal
/// (`"prefix"`, `"version"`, `"length"`, `"malformed"`, `"checksum"`).
#[wasm_bindgen]
pub fn decode_code(text: JsValue) -> JsValue {
    to_js::<CodePayload>(
        arg::<String>(text, "text").and_then(|t| neophylo_core::assess::decode_code(&t)),
    )
}

/// Grade a code against a resolved assignment file (spec §5.5):
/// rebuilds the variant from the id inside the code and flags
/// `ContentChanged` when the recorded `content_hash` is stale.
/// `lms_id` is the roster id or `null`; `rule` is `{"kind": "first" |
/// "final" | "weighted", ...}`.
#[wasm_bindgen]
pub fn grade(assignment_json: JsValue, lms_id: JsValue, code: JsValue, rule: JsValue) -> JsValue {
    to_js::<GradeResult>(
        arg::<String>(assignment_json, "assignment_json").and_then(|j| {
            arg::<String>(code, "code").and_then(|c| {
                neophylo_core::assess::load_assignment(&j).and_then(|a| {
                    arg::<Option<String>>(lms_id, "lms_id").and_then(|lms| {
                        arg::<Rule>(rule, "rule")
                            .and_then(|r| neophylo_core::assess::grade(&a, lms.as_deref(), &c, r))
                    })
                })
            })
        }),
    )
}

/// The completion code's worst-case length for this assignment
/// (spec §5.4) — the builder refuses anything past 250 chars.
#[wasm_bindgen]
pub fn max_code_len(assignment_json: JsValue) -> JsValue {
    to_js::<usize>(
        arg::<String>(assignment_json, "assignment_json")
            .and_then(|j| neophylo_core::assess::load_assignment(&j))
            .map(|a| neophylo_core::assess::max_code_len(&a)),
    )
}

/// The engine's display-precision table (spec §5.3):
/// `[quantity, decimals]` pairs the web formatters agree with.
#[wasm_bindgen]
pub fn precision() -> JsValue {
    to_js::<Vec<(Quantity, u8)>>(Ok(PRECISION.to_vec()))
}

/// Per prompt index, the taxon names the exercise's student-facing
/// text mentions (owner decision 2026-11-25) — the assignment
/// builder's "names vary per student" warning source.
#[wasm_bindgen]
pub fn prose_names_taxa(exercise: JsValue) -> JsValue {
    to_js::<Vec<(u32, Vec<String>)>>(
        arg::<Exercise>(exercise, "exercise").map(|e| neophylo_core::assess::prose_names_taxa(&e)),
    )
}

/// The `fnv1a64` content hash of a file's exact bytes (spec §5.7) —
/// what a `builtin` reference records as `content_hash`.
#[wasm_bindgen]
pub fn content_hash(text: JsValue) -> JsValue {
    to_js::<String>(
        arg::<String>(text, "text").map(|t| neophylo_core::assess::content_hash(t.as_bytes())),
    )
}
