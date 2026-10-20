//! Rerooting an unrooted tree for display (v1.2 spec §3.7).
//!
//! NJ trees are computed unrooted but drawn rooted on the reference's
//! outgroup: the leaf set of the reference root's smaller child
//! subtree. When that set is one side of an edge's bipartition, a new
//! degree-2 root is inserted at the midpoint of that edge; otherwise
//! the root goes at the midpoint of the alphabetically first outgroup
//! taxon's terminal branch and `outgroup_is_group` is `false`.
//!
//! Edge attributes live on the child endpoint, so rerooting moves each
//! reversed edge's `BranchAttrs` to its new child. The split edge's
//! `support` stays on the ingroup-side root edge only — the outgroup
//! side gets `None`, so a value is never drawn twice (spec §3.7).
//! Display-only: the computed tree is never replaced, and UPGMA trees
//! are already rooted.

use std::collections::{BTreeSet, HashMap};

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::error::NeoError;
use crate::tree::{BranchAttrs, NodeId, Tree};

/// The result of `reroot_on_outgroup`: the display tree plus whether
/// the outgroup is a single group (one side of a split) in it.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct RerootResult {
    pub tree: Tree,
    pub outgroup_is_group: bool,
}

/// Leaf node indices under `id` (iterative, cycle-guarded).
fn leaf_set(tree: &Tree, id: NodeId) -> BTreeSet<usize> {
    let mut out = BTreeSet::new();
    let mut seen = vec![false; tree.nodes.len()];
    let mut stack = vec![id];
    while let Some(nid) = stack.pop() {
        let i = nid.0 as usize;
        let Some(node) = tree.nodes.get(i) else {
            continue;
        };
        if seen[i] {
            continue;
        }
        seen[i] = true;
        if node.children.is_empty() {
            out.insert(i);
        } else {
            stack.extend(node.children.iter().copied());
        }
    }
    out
}

/// The outgroup named by a rooted reference tree (spec §3.7): the leaf
/// labels of the reference root's child subtree with fewer leaves. On a
/// tie, the child containing the alphabetically first label. Labels
/// come back sorted alphabetically; a root with fewer than two
/// children gives an empty outgroup.
pub fn reference_outgroup(reference: &Tree) -> Vec<String> {
    let Some(root) = reference.nodes.get(reference.root.0 as usize) else {
        return Vec::new();
    };
    if root.children.len() < 2 {
        return Vec::new();
    }
    let mut best: Option<Vec<String>> = None;
    for &c in &root.children {
        let mut labels: Vec<String> = leaf_set(reference, c)
            .into_iter()
            .filter_map(|i| reference.nodes.get(i)?.label.clone())
            .collect();
        labels.sort();
        let replace = match &best {
            None => true,
            Some(b) => (labels.len(), labels.first()) < (b.len(), b.first()),
        };
        if replace {
            best = Some(labels);
        }
    }
    best.unwrap_or_default()
}

/// Attach `child` under `parent` with the given edge attributes.
/// Ids are assumed valid (internal use on a cloned arena).
fn attach_edge(tree: &mut Tree, parent: NodeId, child: NodeId, attrs: BranchAttrs) {
    tree.nodes[child.0 as usize].parent = Some(parent);
    tree.nodes[parent.0 as usize].children.push(child);
    tree.branches[child.0 as usize] = attrs;
}

/// Insert a new degree-2 root at the midpoint of the edge
/// `(parent, child)` (spec §3.7). `out_end` and `in_end` are the edge's
/// endpoints on the outgroup and ingroup sides; the new root's children
/// are `out_end` then `in_end`. The edge's support — if any — moves to
/// the ingroup-side edge only; all other edges keep their attributes,
/// following the reversal of the path from `parent` up to the old root.
fn midpoint_reroot(
    tree: &Tree,
    child: NodeId,
    parent: NodeId,
    out_end: NodeId,
    in_end: NodeId,
) -> Tree {
    let mut out = tree.clone();
    let old = tree.branches.clone();
    let half = |attrs: &BranchAttrs, support: Option<f64>| BranchAttrs {
        length: attrs.length.map(|l| l / 2.0),
        support,
    };
    let edge_attrs = old[child.0 as usize].clone();

    // Path from `parent` up to the old root: [v1 = parent, v2, ..., r].
    let mut path = Vec::new();
    let mut cur = Some(parent);
    for _ in 0..=tree.nodes.len() {
        let Some(id) = cur else { break };
        if id == child || path.contains(&id) {
            break; // cycle guard: never hang on a malformed arena
        }
        path.push(id);
        cur = tree.nodes[id.0 as usize].parent;
    }

    let nr = out.add_node(None);
    attach_edge(&mut out, nr, out_end, half(&edge_attrs, None));
    attach_edge(&mut out, nr, in_end, half(&edge_attrs, edge_attrs.support));

    // Remove the split edge: `child` is no longer a child of `parent`.
    out.nodes[parent.0 as usize]
        .children
        .retain(|&c| c != child);

    // Reverse every path edge (v_j, v_{j+1}) into (v_{j+1} as child):
    // the edge keeps its attributes, which move to the new child.
    for w in path.windows(2) {
        let (x, y) = (w[0], w[1]);
        out.nodes[y.0 as usize].children.retain(|&c| c != x);
        out.nodes[x.0 as usize].children.push(y);
        out.nodes[y.0 as usize].parent = Some(x);
        out.branches[y.0 as usize] = old[x.0 as usize].clone();
    }

    out.set_root(nr);
    out.nodes[nr.0 as usize].parent = None;
    out.rooted = true;
    out
}

/// Reroot `tree` at the midpoint of the edge whose bipartition
/// separates `outgroup` from the rest (spec §3.7). When no edge induces
/// that bipartition, the root goes at the midpoint of the
/// alphabetically first outgroup taxon's terminal branch and
/// `outgroup_is_group` is `false`.
///
/// Outgroup labels not found among the tree's leaves give
/// `NeoError::LabelMismatch`; an empty outgroup is an
/// `InvalidExercise`-shaped error on field `outgroup`.
pub fn reroot_on_outgroup(tree: &Tree, outgroup: &[String]) -> Result<RerootResult, NeoError> {
    // Leaf index: label -> leaf NodeId. Internal labels never match.
    let leaf_of: HashMap<&str, NodeId> = tree
        .nodes
        .iter()
        .enumerate()
        .filter(|(_, n)| n.children.is_empty())
        .filter_map(|(i, n)| n.label.as_deref().map(|l| (l, NodeId(i as u32))))
        .collect();
    let want: BTreeSet<&str> = outgroup.iter().map(String::as_str).collect();
    let missing: Vec<String> = want
        .iter()
        .filter(|l| !leaf_of.contains_key(**l))
        .map(|l| (*l).to_string())
        .collect();
    if !missing.is_empty() {
        return Err(NeoError::LabelMismatch {
            only_in_a: Vec::new(),
            only_in_b: missing,
        });
    }
    if want.is_empty() {
        return Err(NeoError::InvalidExercise {
            field: "outgroup".to_string(),
            msg: "outgroup must name at least one leaf".to_string(),
        });
    }

    // Leaf index sets under every node, for the bipartition lookup.
    let og: BTreeSet<usize> = want.iter().map(|l| leaf_of[*l].0 as usize).collect();
    let all: BTreeSet<usize> = leaf_of.values().map(|id| id.0 as usize).collect();
    let comp: BTreeSet<usize> = all.difference(&og).copied().collect();
    let under: Vec<BTreeSet<usize>> = (0..tree.nodes.len())
        .map(|i| leaf_set(tree, NodeId(i as u32)))
        .collect();

    // Find the split edge: a non-root edge `(parent, child)` whose
    // bipartition is `og | all-og`. Prefer the orientation where the
    // child subtree *is* the outgroup (e.g. a degree-2 stored root's
    // outgroup edge), then the complementary orientation.
    let mut edge = None;
    for (i, set) in under.iter().enumerate() {
        let id = NodeId(i as u32);
        if *set == og {
            if let Some(p) = tree.nodes[i].parent {
                edge = Some((id, p, id, p));
                break;
            }
        }
    }
    if edge.is_none() && !comp.is_empty() {
        for (i, set) in under.iter().enumerate() {
            let id = NodeId(i as u32);
            if *set == comp {
                if let Some(p) = tree.nodes[i].parent {
                    edge = Some((id, p, p, id));
                    break;
                }
            }
        }
    }

    match edge {
        // (child, parent, out_end, in_end)
        Some((child, parent, out_end, in_end)) => Ok(RerootResult {
            tree: midpoint_reroot(tree, child, parent, out_end, in_end),
            outgroup_is_group: true,
        }),
        None => {
            // Fallback: midpoint of the alphabetically first outgroup
            // taxon's terminal branch (spec §3.7).
            let Some(first) = want.iter().next() else {
                return Err(NeoError::InvalidExercise {
                    field: "outgroup".to_string(),
                    msg: "outgroup must name at least one leaf".to_string(),
                });
            };
            let a = leaf_of[*first];
            let Some(p) = tree.nodes[a.0 as usize].parent else {
                // Degenerate single-node tree: nothing to reroot.
                return Ok(RerootResult {
                    tree: tree.clone(),
                    outgroup_is_group: false,
                });
            };
            Ok(RerootResult {
                tree: midpoint_reroot(tree, a, p, a, p),
                outgroup_is_group: false,
            })
        }
    }
}
