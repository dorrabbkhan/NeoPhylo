//! Tree arena (spec §4.4).
//!
//! Nodes live in a `Vec` addressed by `NodeId`; branch attributes are stored
//! separately, keyed by the *child* `NodeId`, so rerooting cannot misplace
//! them. `branches[i]` is the edge above node `i`; the root's entry is always
//! `length: None`.
//!
//! Node ID convention (Global Constraints): leaves are `NodeId(0..n)` in
//! input order and internal nodes are numbered in creation order.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

/// Index of a node in `Tree::nodes`.
#[derive(Copy, Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct NodeId(pub u32);

/// One arena node: parent link, ordered children and an optional label.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Node {
    pub parent: Option<NodeId>,
    pub children: Vec<NodeId>,
    pub label: Option<String>,
}

/// Attributes of the edge above a node: `length`, plus `support`
/// (v1.2 spec §3.4), a bootstrap fraction 0-1 set by
/// `bootstrap::support_on_tree`. `#[serde(default)]` keeps v1/v1.1
/// tree JSON (which has no `support` key) deserializable as `None`.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct BranchAttrs {
    pub length: Option<f64>,
    #[serde(default)]
    pub support: Option<f64>,
}

/// A rooted or unrooted tree. Unrooted trees are stored with an internal
/// root of degree 3.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct Tree {
    pub nodes: Vec<Node>,
    pub branches: Vec<BranchAttrs>,
    pub root: NodeId,
    pub rooted: bool,
}

impl Tree {
    /// An empty tree. `root` is a sentinel until `set_root` is called.
    pub fn new() -> Self {
        Self {
            nodes: Vec::new(),
            branches: Vec::new(),
            root: NodeId(u32::MAX),
            rooted: false,
        }
    }

    /// Append an unattached node and return its id.
    pub fn add_node(&mut self, label: Option<String>) -> NodeId {
        let id = NodeId(self.nodes.len() as u32);
        self.nodes.push(Node {
            parent: None,
            children: Vec::new(),
            label,
        });
        self.branches.push(BranchAttrs {
            length: None,
            support: None,
        });
        id
    }

    /// Make `child` the last child of `parent` and set its branch length.
    /// Out-of-range ids are ignored.
    pub fn attach(&mut self, parent: NodeId, child: NodeId, length: Option<f64>) {
        let (p, c) = (parent.0 as usize, child.0 as usize);
        if p >= self.nodes.len() || c >= self.nodes.len() {
            return;
        }
        self.nodes[c].parent = Some(parent);
        self.nodes[p].children.push(child);
        self.branches[c].length = length;
    }

    /// Set the root id used by traversals and `write_newick`.
    pub fn set_root(&mut self, root: NodeId) {
        self.root = root;
    }

    /// Length of the edge above `child` (`None` for the root).
    pub fn branch_length(&self, child: NodeId) -> Option<f64> {
        self.branches.get(child.0 as usize).and_then(|b| b.length)
    }

    /// True when `id` exists and has no children.
    pub fn is_leaf(&self, id: NodeId) -> bool {
        self.nodes
            .get(id.0 as usize)
            .is_some_and(|n| n.children.is_empty())
    }

    /// Node ids in preorder from the root (parents before children, children
    /// in attach order). Empty when the tree or root is invalid.
    pub fn preorder(&self) -> Vec<NodeId> {
        let mut out = Vec::with_capacity(self.nodes.len());
        let mut seen = vec![false; self.nodes.len()];
        let mut stack = vec![self.root];
        while let Some(id) = stack.pop() {
            let i = id.0 as usize;
            let Some(node) = self.nodes.get(i) else {
                continue;
            };
            if seen[i] {
                continue; // cycle guard: the engine must never hang or panic
            }
            seen[i] = true;
            out.push(id);
            for &c in node.children.iter().rev() {
                stack.push(c);
            }
        }
        out
    }

    /// Labels of leaves in preorder order; unlabeled leaves give `""`.
    pub fn leaf_labels(&self) -> Vec<String> {
        self.preorder()
            .into_iter()
            .filter(|&id| self.is_leaf(id))
            .map(|id| self.nodes[id.0 as usize].label.clone().unwrap_or_default())
            .collect()
    }
}

impl Default for Tree {
    fn default() -> Self {
        Self::new()
    }
}
