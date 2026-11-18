//! Clade-keyed tree queries (v1.4d spec §5.2, plan Task 3).
//!
//! Everything here is a pure function on `Tree` and never panics: unknown
//! tips, different tip sets and malformed input come back as
//! `NeoError::InvalidReading` with `item` empty (no item context at the
//! query level) and `field` naming the argument at fault.

use std::collections::{BTreeMap, BTreeSet, HashSet};

use serde::{Deserialize, Serialize};

use crate::error::NeoError;
use crate::tree::{NodeId, Tree};

/// A node's name in files and across the wasm boundary: its tips' labels,
/// sorted (Unicode code-point order) and deduplicated.
pub type CladeKey = Vec<String>;

/// `InvalidReading` at the set level (`item` empty).
fn invalid(field: &str, msg: impl Into<String>) -> NeoError {
    NeoError::InvalidReading {
        item: String::new(),
        field: field.to_string(),
        msg: msg.into(),
    }
}

/// The leaf labelled `label`, or `InvalidReading` with `field` "tips".
pub(crate) fn tip_node(tree: &Tree, label: &str) -> Result<NodeId, NeoError> {
    tree.preorder()
        .into_iter()
        .find(|&id| tree.is_leaf(id) && tree.nodes[id.0 as usize].label.as_deref() == Some(label))
        .ok_or_else(|| invalid("tips", format!("unknown tip '{label}'")))
}

/// Every named tip exists; used by the set-valued queries.
fn check_tips(tree: &Tree, tips: &[String]) -> Result<(), NeoError> {
    for t in tips {
        tip_node(tree, t)?;
    }
    Ok(())
}

/// Ancestors of `id` including `id` itself, walking parent links;
/// cycle-guarded.
fn ancestors_incl(tree: &Tree, id: NodeId) -> HashSet<NodeId> {
    let mut out = HashSet::new();
    let mut cur = Some(id);
    while let Some(nid) = cur {
        if !out.insert(nid) {
            break; // a cycle cannot produce new ancestors
        }
        cur = tree.nodes.get(nid.0 as usize).and_then(|n| n.parent);
    }
    out
}

/// Edges from the root to `id` (`0` for the root itself); cycle-guarded.
fn depth(tree: &Tree, id: NodeId) -> u32 {
    let mut d = 0u32;
    let mut cur = id;
    let mut steps = 0usize;
    while let Some(p) = tree.nodes.get(cur.0 as usize).and_then(|n| n.parent) {
        d += 1;
        cur = p;
        steps += 1;
        if steps > tree.nodes.len() {
            break;
        }
    }
    d
}

/// The clade key of `node`: sorted labels of the leaves at or below it.
/// A leaf's key is its own label; an unlabeled leaf contributes nothing.
pub fn clade_key(tree: &Tree, node: NodeId) -> CladeKey {
    let mut out = Vec::new();
    let mut seen = vec![false; tree.nodes.len()];
    let mut stack = vec![node];
    while let Some(id) = stack.pop() {
        let i = id.0 as usize;
        let Some(n) = tree.nodes.get(i) else {
            continue;
        };
        if seen[i] {
            continue;
        }
        seen[i] = true;
        if n.children.is_empty() {
            if let Some(l) = &n.label {
                out.push(l.clone());
            }
        } else {
            stack.extend(n.children.iter().copied());
        }
    }
    out.sort();
    out.dedup();
    out
}

/// The node whose tip set is exactly `key` (sorted or not), or `None`.
/// Leaves match single-label keys, so a tip's own set names that tip.
pub fn find_clade(tree: &Tree, key: &[String]) -> Option<NodeId> {
    let mut want = key.to_vec();
    want.sort();
    want.dedup();
    tree.preorder()
        .into_iter()
        .find(|&id| clade_key(tree, id) == want)
}

/// The most recent common ancestor of `tips`. One tip maps to itself.
/// Unknown tips give `InvalidReading` with `field` "tips".
pub fn mrca(tree: &Tree, tips: &[String]) -> Result<NodeId, NeoError> {
    if tips.is_empty() {
        return Err(invalid("tips", "mrca needs at least one tip"));
    }
    let mut m = tip_node(tree, &tips[0])?;
    for t in &tips[1..] {
        let anc = ancestors_incl(tree, tip_node(tree, t)?);
        while !anc.contains(&m) {
            match tree.nodes.get(m.0 as usize).and_then(|n| n.parent) {
                Some(p) => m = p,
                None => return Err(invalid("tips", "the tips have no common ancestor")),
            }
        }
    }
    Ok(m)
}

/// Whether `tips` is exactly the tip set of some node. Single tips and
/// the full tip set are clades; the empty set is not.
pub fn is_clade(tree: &Tree, tips: &[String]) -> Result<bool, NeoError> {
    check_tips(tree, tips)?;
    if tips.is_empty() {
        return Ok(false);
    }
    Ok(find_clade(tree, tips).is_some())
}

/// The sister group of `tip`: every tip under the tip's parent except
/// the tip's own lineage — for a polytomy, every other child's tips.
/// A tip that is the root has no sisters.
pub fn sister_tips(tree: &Tree, tip: &str) -> Result<CladeKey, NeoError> {
    let id = tip_node(tree, tip)?;
    let Some(p) = tree.nodes[id.0 as usize].parent else {
        return Ok(Vec::new());
    };
    let mut out = Vec::new();
    for &c in &tree.nodes[p.0 as usize].children {
        if c != id {
            out.extend(clade_key(tree, c));
        }
    }
    out.sort();
    out.dedup();
    Ok(out)
}

/// The tips not under the root child holding `tip` — the "most distant"
/// group of `closest_relative`. A tip that is the root has none outside.
pub fn outside_tips(tree: &Tree, tip: &str) -> Result<CladeKey, NeoError> {
    let mut cur = tip_node(tree, tip)?;
    if cur == tree.root {
        return Ok(Vec::new());
    }
    // Climb to the root's child on `tip`'s path.
    let mut steps = 0usize;
    loop {
        match tree.nodes.get(cur.0 as usize).and_then(|n| n.parent) {
            Some(p) if p != tree.root => {
                cur = p;
                steps += 1;
                if steps > tree.nodes.len() {
                    return Ok(Vec::new()); // cannot reach the root
                }
            }
            _ => break,
        }
    }
    let under: BTreeSet<String> = clade_key(tree, cur).into_iter().collect();
    let mut out: Vec<String> = tree
        .leaf_labels()
        .into_iter()
        .filter(|l| !under.contains(l))
        .collect();
    out.sort();
    out.dedup();
    Ok(out)
}

/// Which of `b` or `c` shares a more recent common ancestor with `a`,
/// comparing MRCA depths in edges from the root; equal depth or the same
/// node gives `Equal`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum Closer {
    B,
    C,
    Equal,
}

/// `B` when `mrca(a,b)` is deeper than `mrca(a,c)`, `C` when shallower,
/// `Equal` on ties (polytomies, or `b` and `c` on the same side).
pub fn closer(tree: &Tree, a: &str, b: &str, c: &str) -> Result<Closer, NeoError> {
    let ab = mrca(tree, &[a.to_string(), b.to_string()])?;
    let ac = mrca(tree, &[a.to_string(), c.to_string()])?;
    Ok(match depth(tree, ab).cmp(&depth(tree, ac)) {
        std::cmp::Ordering::Greater => Closer::B,
        std::cmp::Ordering::Less => Closer::C,
        std::cmp::Ordering::Equal => Closer::Equal,
    })
}

/// The non-trivial clades of `tree`: every internal node's tip set,
/// including the root; single tips are excluded.
pub fn rooted_clades(tree: &Tree) -> BTreeSet<CladeKey> {
    tree.preorder()
        .into_iter()
        .filter(|&id| !tree.nodes[id.0 as usize].children.is_empty())
        .map(|id| clade_key(tree, id))
        .collect()
}

/// Rooted topological equality by clade sets — rotations and drawing
/// order are ignored, polytomies respected (a polytomy never equals a
/// resolved tree). Different tip sets give `InvalidReading`.
pub fn same_relationships(a: &Tree, b: &Tree) -> Result<bool, NeoError> {
    let ta: BTreeSet<String> = a.leaf_labels().into_iter().collect();
    let tb: BTreeSet<String> = b.leaf_labels().into_iter().collect();
    if ta != tb {
        return Err(invalid("tips", "the two trees have different tip sets"));
    }
    Ok(rooted_clades(a) == rooted_clades(b))
}

/// The subtree spanning `tips`, rooted at their MRCA, with unary nodes
/// suppressed (`ape::keep.tip` semantics minus branch lengths). Unknown
/// or empty tip lists give `InvalidReading` with `field` "tips".
pub fn restrict(tree: &Tree, tips: &[String]) -> Result<Tree, NeoError> {
    check_tips(tree, tips)?;
    if tips.is_empty() {
        return Err(invalid("tips", "restrict needs at least one tip"));
    }
    let kept: HashSet<NodeId> = tips
        .iter()
        .map(|t| tip_node(tree, t))
        .collect::<Result<_, _>>()?;
    let top = mrca(tree, tips)?;
    let mut out = Tree::new();
    let mut seen = vec![false; tree.nodes.len()];
    let Some(new_root) = build_restricted(tree, top, &kept, &mut seen, &mut out) else {
        return Err(invalid("tips", "the restricted subtree is empty"));
    };
    out.set_root(new_root);
    out.rooted = out.nodes[new_root.0 as usize].children.len() == 2;
    Ok(out)
}

/// Post-order rebuild of `node`'s subtree keeping only `kept` tips;
/// `None` when nothing below is kept, single kept children are passed
/// through so unary nodes are suppressed.
fn build_restricted(
    tree: &Tree,
    node: NodeId,
    kept: &HashSet<NodeId>,
    seen: &mut [bool],
    out: &mut Tree,
) -> Option<NodeId> {
    let i = node.0 as usize;
    if i >= tree.nodes.len() || seen[i] {
        return None;
    }
    seen[i] = true;
    let n = &tree.nodes[i];
    if n.children.is_empty() {
        return kept.contains(&node).then(|| out.add_node(n.label.clone()));
    }
    let kept_children: Vec<NodeId> = n
        .children
        .iter()
        .filter_map(|&c| build_restricted(tree, c, kept, seen, out))
        .collect();
    match kept_children.len() {
        0 => None,
        1 => kept_children.into_iter().next(),
        _ => {
            let id = out.add_node(n.label.clone());
            for c in kept_children {
                out.attach(id, c, None);
            }
            Some(id)
        }
    }
}

/// Whether `anc` is a proper ancestor of `desc` (`anc != desc` and on the
/// path from the root to `desc`); cycle-guarded.
pub fn is_ancestor(tree: &Tree, anc: NodeId, desc: NodeId) -> bool {
    let mut cur = desc;
    let mut steps = 0usize;
    while let Some(p) = tree.nodes.get(cur.0 as usize).and_then(|n| n.parent) {
        if p == anc {
            return true;
        }
        cur = p;
        steps += 1;
        if steps > tree.nodes.len() {
            return false;
        }
    }
    false
}

/// Whether `order` (oldest to youngest) is consistent. Without `ages`:
/// every linear extension of the ancestry order is accepted — no node may
/// appear after one of its ancestors, while nodes on different lineages
/// order either way. With `ages` (clade key → age): the ages must be
/// non-increasing, and a node missing from the map refuses the order.
/// Tied ages are refused at load time (plan Task 4), not here.
pub fn order_consistent(
    tree: &Tree,
    order: &[NodeId],
    ages: Option<&BTreeMap<CladeKey, f64>>,
) -> bool {
    match ages {
        Some(ages) => {
            let mut prev = f64::INFINITY;
            for &id in order {
                let Some(&age) = ages.get(&clade_key(tree, id)) else {
                    return false;
                };
                if age > prev {
                    return false;
                }
                prev = age;
            }
            true
        }
        None => {
            for (i, &x) in order.iter().enumerate() {
                for &y in &order[i + 1..] {
                    if is_ancestor(tree, y, x) {
                        return false;
                    }
                }
            }
            true
        }
    }
}

/// The number of clades in `tree`: internal nodes including the root;
/// single tips are not counted (`phy$Nnode`).
pub fn count_clades(tree: &Tree) -> u32 {
    tree.preorder()
        .into_iter()
        .filter(|&id| !tree.nodes[id.0 as usize].children.is_empty())
        .count() as u32
}
