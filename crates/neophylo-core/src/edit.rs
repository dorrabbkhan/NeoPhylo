//! Tree editing operations for the exercise editor (v1.4 spec §5.1).
//!
//! Each operation validates its arguments fully before mutating, so a
//! refusal (`NeoError::InvalidEdit`) leaves the tree bit-for-bit
//! unchanged. Editing may produce detached components — parentless
//! subtrees still living in the arena — which `join` and `move_subtree`
//! can graft back. `validate_editable` judges only the component
//! reachable from `tree.root`, which is what the editor draws and saves.

use std::collections::HashSet;

use crate::error::NeoError;
use crate::tree::{NodeId, Tree};

fn invalid(msg: String) -> NeoError {
    NeoError::InvalidEdit { msg }
}

fn exists(tree: &Tree, id: NodeId) -> bool {
    (id.0 as usize) < tree.nodes.len()
}

/// Refuse to touch an arena whose parallel arrays disagree. A tree can
/// arrive malformed across the wasm boundary; without this guard every
/// `tree.branches[id]` index below is a potential panic.
fn check_arena(tree: &Tree) -> Result<(), NeoError> {
    if tree.nodes.len() != tree.branches.len() {
        return Err(invalid(format!(
            "malformed arena: {} nodes but {} branch slots",
            tree.nodes.len(),
            tree.branches.len()
        )));
    }
    Ok(())
}

/// A branch length an editor may write: finite and non-negative.
fn check_length(length: f64) -> Result<(), NeoError> {
    if !length.is_finite() {
        return Err(invalid(format!("branch length {length} is not finite")));
    }
    if length < 0.0 {
        return Err(invalid(format!("branch length {length} is negative")));
    }
    Ok(())
}

/// Recompute `tree.rooted` from the root's degree after a structural
/// change (newick.rs convention: rooted iff the root has two children).
fn refresh_rooted(tree: &mut Tree) {
    if let Some(r) = tree.nodes.get(tree.root.0 as usize) {
        tree.rooted = r.children.len() == 2;
    }
}

/// Number of leaves under `id` (`id` itself when it is a leaf).
fn leaf_count_under(tree: &Tree, id: NodeId) -> usize {
    let mut seen = vec![false; tree.nodes.len()];
    let mut stack = vec![id];
    let mut n = 0usize;
    while let Some(u) = stack.pop() {
        let i = u.0 as usize;
        if i >= tree.nodes.len() || seen[i] {
            continue; // cycle guard: the engine must never hang
        }
        seen[i] = true;
        if tree.nodes[i].children.is_empty() {
            n += 1;
        } else {
            stack.extend(tree.nodes[i].children.iter().copied());
        }
    }
    n
}

/// `true` for each arena node reachable from `tree.root`.
fn reachable(tree: &Tree) -> Vec<bool> {
    let mut in_main = vec![false; tree.nodes.len()];
    for id in tree.preorder() {
        in_main[id.0 as usize] = true;
    }
    in_main
}

/// Remove `child` from its parent's child list. Returns the parent.
/// Bounds-checked throughout: a corrupt arena cannot panic.
fn unlink(tree: &mut Tree, child: NodeId) -> Option<NodeId> {
    let parent = tree.nodes[child.0 as usize].parent?;
    if (parent.0 as usize) < tree.nodes.len() {
        tree.nodes[parent.0 as usize]
            .children
            .retain(|&c| c != child);
    }
    tree.nodes[child.0 as usize].parent = None;
    Some(parent)
}

/// Join two component roots `a` and `b` under a new internal node whose
/// edges to them get `lengths.0` and `lengths.1`. Refuses unless `a` and
/// `b` are distinct, existing and parentless. When `a` or `b` was
/// `tree.root`, the new node becomes the root.
pub fn join(
    tree: &mut Tree,
    a: NodeId,
    b: NodeId,
    lengths: (f64, f64),
) -> Result<NodeId, NeoError> {
    check_arena(tree)?;
    if a == b {
        return Err(invalid(format!("cannot join node {} with itself", a.0)));
    }
    for (id, length) in [(a, lengths.0), (b, lengths.1)] {
        if !exists(tree, id) {
            return Err(invalid(format!("node {} does not exist", id.0)));
        }
        check_length(length)?;
        let n = &tree.nodes[id.0 as usize];
        if n.children.is_empty() && n.label.is_none() {
            // An unnamed leaf can never be part of an editable tree;
            // spliced-out husks stay inert until named via rename_leaf.
            return Err(invalid(format!("leaf node {} has no name", id.0)));
        }
        if n.parent.is_some() {
            return Err(invalid(format!("node {} is not a component root", id.0)));
        }
    }
    let u = tree.add_node(None);
    tree.attach(u, a, Some(lengths.0));
    tree.attach(u, b, Some(lengths.1));
    if a == tree.root || b == tree.root {
        tree.set_root(u);
    }
    refresh_rooted(tree);
    Ok(u)
}

/// Unlink `node`'s subtree from its parent; it becomes a parentless
/// component (no arena renumbering). Refuses — leaving the tree
/// unchanged — when `node` is the root, does not exist, or its removal
/// would leave the parent with fewer than two children. A node that is
/// already a detached component root detaches as a no-op.
pub fn detach(tree: &mut Tree, node: NodeId) -> Result<(), NeoError> {
    check_arena(tree)?;
    if !exists(tree, node) {
        return Err(invalid(format!("node {} does not exist", node.0)));
    }
    if node == tree.root {
        return Err(invalid("cannot detach the root".to_string()));
    }
    let Some(parent) = tree.nodes[node.0 as usize].parent else {
        return Ok(()); // already a detached component root
    };
    if !exists(tree, parent) {
        return Err(invalid(format!("node {} lists a missing parent", node.0)));
    }
    if tree.nodes[parent.0 as usize].children.len() <= 2 {
        return Err(invalid(format!(
            "removing node {} would leave node {} with fewer than two children",
            node.0, parent.0
        )));
    }
    unlink(tree, node);
    tree.branches[node.0 as usize].length = None;
    tree.branches[node.0 as usize].support = None;
    refresh_rooted(tree);
    Ok(())
}

/// SPR: move `node` onto the edge above `x` (`new_parent_edge`). The
/// edge of length `L` above `x` is split at `lengths.0` from the parent
/// side; `node` hangs off the junction with length `lengths.1`. A parent
/// left unary by the move is spliced out, its two edge lengths summed —
/// when it was the root, its remaining child becomes the root. Refuses
/// when `x` is `node`, inside `node`'s subtree or the root; when `node`
/// is the root; when `lengths.0` is outside `[0, L]`; and when the move
/// out of the main component would leave it with fewer than two leaves.
pub fn move_subtree(
    tree: &mut Tree,
    node: NodeId,
    new_parent_edge: NodeId,
    lengths: (f64, f64),
) -> Result<(), NeoError> {
    check_arena(tree)?;
    let (l_split, l_node) = lengths;
    let x = new_parent_edge;
    for id in [node, x] {
        if !exists(tree, id) {
            return Err(invalid(format!("node {} does not exist", id.0)));
        }
    }
    if node == tree.root {
        return Err(invalid("the root cannot move".to_string()));
    }
    {
        let n = &tree.nodes[node.0 as usize];
        if n.children.is_empty() && n.label.is_none() {
            return Err(invalid(format!("leaf node {} has no name", node.0)));
        }
    }
    if x == tree.root {
        return Err(invalid(format!(
            "node {} is the root; there is no edge above it",
            x.0
        )));
    }
    if x == node {
        return Err(invalid(format!("cannot move node {} under itself", node.0)));
    }
    // x may not sit inside node's subtree.
    let mut guard = 0usize;
    let mut cur = tree.nodes[x.0 as usize].parent;
    while let Some(p) = cur {
        if p == node {
            return Err(invalid(format!(
                "node {} is a descendant of node {}",
                x.0, node.0
            )));
        }
        let Some(pn) = tree.nodes.get(p.0 as usize) else {
            break;
        };
        cur = pn.parent;
        guard += 1;
        if guard > tree.nodes.len() {
            break; // cycle guard: refuse rather than loop forever
        }
    }
    check_length(l_node)?;
    let Some(px) = tree.nodes[x.0 as usize].parent else {
        return Err(invalid(format!("node {} has no parent edge", x.0)));
    };
    if !exists(tree, px) || !tree.nodes[px.0 as usize].children.contains(&x) {
        return Err(invalid(format!(
            "node {} is not a child of its parent {}",
            x.0, px.0
        )));
    }
    let l_edge = match tree.branches[x.0 as usize].length {
        Some(l) if l.is_finite() && l >= 0.0 => l,
        Some(l) => {
            return Err(invalid(format!(
                "the edge above node {} has invalid length {l}",
                x.0
            )))
        }
        None => {
            return Err(invalid(format!(
                "node {} has no branch length to split",
                x.0
            )))
        }
    };
    if !l_split.is_finite() || l_split < 0.0 || l_split > l_edge {
        return Err(invalid(format!(
            "split position {l_split} is outside the edge of length {l_edge} above node {}",
            x.0
        )));
    }
    // The arena must agree with itself where the splice may touch:
    // node's parent chain must exist and contain the expected children.
    let p_old = tree.nodes[node.0 as usize].parent;
    if let Some(p) = p_old {
        if !exists(tree, p) || !tree.nodes[p.0 as usize].children.contains(&node) {
            return Err(invalid(format!(
                "node {} is not a child of its parent {}",
                node.0, p.0
            )));
        }
        if let Some(gp) = tree.nodes[p.0 as usize].parent {
            if !exists(tree, gp) || !tree.nodes[gp.0 as usize].children.contains(&p) {
                return Err(invalid(format!(
                    "node {} is not a child of its parent {}",
                    p.0, gp.0
                )));
            }
        }
    }
    // Moving node out of the main component may not leave it with one
    // leaf (or none): same guarantee `detach` gives.
    let in_main = reachable(tree);
    if in_main[node.0 as usize] && !in_main[x.0 as usize] {
        let main_leaves = leaf_count_under(tree, tree.root);
        let moved_leaves = leaf_count_under(tree, node);
        if main_leaves - moved_leaves < 2 {
            return Err(invalid(format!(
                "moving node {} away would leave the tree with fewer than two leaves",
                node.0
            )));
        }
    }

    // 1. Split the edge above x: px -> junction -> x.
    let junction = tree.add_node(None);
    for c in tree.nodes[px.0 as usize].children.iter_mut() {
        if *c == x {
            *c = junction;
        }
    }
    tree.nodes[junction.0 as usize].parent = Some(px);
    tree.nodes[junction.0 as usize].children.push(x);
    tree.nodes[x.0 as usize].parent = Some(junction);
    tree.branches[junction.0 as usize].length = Some(l_split);
    tree.branches[x.0 as usize].length = Some(l_edge - l_split);

    // 2. Unlink node; a parent left unary is spliced out with its two
    //    edge lengths summed, or its remaining child becomes the root.
    if let Some(p_old) = p_old.and_then(|_| unlink(tree, node)) {
        let pi = p_old.0 as usize;
        if tree.nodes[pi].children.len() == 1 {
            let c = tree.nodes[pi].children[0];
            let ci = c.0 as usize;
            match tree.nodes[pi].parent {
                Some(gp) => {
                    for slot in tree.nodes[gp.0 as usize].children.iter_mut() {
                        if *slot == p_old {
                            *slot = c;
                        }
                    }
                    tree.nodes[ci].parent = Some(gp);
                    tree.branches[ci].length =
                        match (tree.branches[pi].length, tree.branches[ci].length) {
                            (Some(a), Some(b)) => Some(a + b),
                            (a, b) => a.or(b),
                        };
                }
                None => {
                    tree.nodes[ci].parent = None;
                    tree.branches[ci].length = None;
                    if p_old == tree.root {
                        tree.set_root(c);
                    }
                }
            }
            // The spliced node becomes an inert husk: parentless,
            // childless, unlabeled, with no edge attributes — kept,
            // the label would let join graft it back as a phantom
            // taxon.
            tree.nodes[pi].children.clear();
            tree.nodes[pi].parent = None;
            tree.nodes[pi].label = None;
            tree.branches[pi].length = None;
            tree.branches[pi].support = None;
        }
    }

    // 3. Hang node under the junction.
    tree.nodes[junction.0 as usize].children.push(node);
    tree.nodes[node.0 as usize].parent = Some(junction);
    tree.branches[node.0 as usize].length = Some(l_node);
    refresh_rooted(tree);
    Ok(())
}

/// Set the length of the edge above `child`. Refuses negative or
/// non-finite lengths, nonexistent nodes, and nodes with no parent edge
/// (the root or a detached component root).
pub fn set_length(tree: &mut Tree, child: NodeId, length: f64) -> Result<(), NeoError> {
    check_arena(tree)?;
    if !exists(tree, child) {
        return Err(invalid(format!("node {} does not exist", child.0)));
    }
    check_length(length)?;
    if child == tree.root {
        return Err(invalid("the root has no branch".to_string()));
    }
    if tree.nodes[child.0 as usize].parent.is_none() {
        return Err(invalid(format!("node {} has no parent edge", child.0)));
    }
    tree.branches[child.0 as usize].length = Some(length);
    Ok(())
}

/// Rename a leaf. Refuses nonexistent or non-leaf nodes, empty names
/// and names another leaf already carries — in any component, so a
/// detached subtree cannot collide when grafted back.
pub fn rename_leaf(tree: &mut Tree, leaf: NodeId, name: &str) -> Result<(), NeoError> {
    check_arena(tree)?;
    if !exists(tree, leaf) {
        return Err(invalid(format!("node {} does not exist", leaf.0)));
    }
    if !tree.nodes[leaf.0 as usize].children.is_empty() {
        return Err(invalid(format!("node {} is not a leaf", leaf.0)));
    }
    if name.trim().is_empty() {
        return Err(invalid("a taxon name may not be empty".to_string()));
    }
    let i = leaf.0 as usize;
    if tree
        .nodes
        .iter()
        .enumerate()
        .any(|(k, n)| k != i && n.children.is_empty() && n.label.as_deref() == Some(name))
    {
        return Err(invalid(format!("duplicate taxon name '{name}'")));
    }
    tree.nodes[i].label = Some(name.to_string());
    Ok(())
}

/// Is the component reachable from `tree.root` a tree the editor may
/// save? Requires at least two leaves, unique non-empty leaf names, no
/// internal node with exactly one child, and a finite, non-negative
/// length on every non-root edge. Detached components are not checked.
pub fn validate_editable(tree: &Tree) -> Result<(), NeoError> {
    check_arena(tree)?;
    let order = tree.preorder();
    let leaves = order
        .iter()
        .filter(|&&id| tree.nodes[id.0 as usize].children.is_empty())
        .count();
    if leaves < 2 {
        return Err(invalid(format!(
            "the tree has {leaves} leaf/leaves; at least 2 are required"
        )));
    }
    let mut names: HashSet<&str> = HashSet::new();
    for &id in &order {
        let i = id.0 as usize;
        let node = &tree.nodes[i];
        if node.children.is_empty() {
            let label = node.label.as_deref().unwrap_or("");
            if label.is_empty() {
                return Err(invalid(format!("leaf node {i} has an empty name")));
            }
            if !names.insert(label) {
                return Err(invalid(format!("duplicate taxon name '{label}'")));
            }
        } else if node.children.len() == 1 {
            return Err(invalid(format!("node {i} has only one child")));
        }
        if id != tree.root {
            match tree.branches.get(i).and_then(|b| b.length) {
                None => {
                    return Err(invalid(format!("node {i} has no branch length")));
                }
                Some(l) if !l.is_finite() => {
                    return Err(invalid(format!("branch length of node {i} is not finite")));
                }
                Some(l) if l < 0.0 => {
                    return Err(invalid(format!(
                        "branch length of node {i} is negative ({l})"
                    )));
                }
                _ => {}
            }
        }
    }
    Ok(())
}
