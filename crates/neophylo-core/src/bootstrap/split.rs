//! Bitset groupings for bootstrap tallies (v1.2 spec §3.3).
//!
//! A `Split` is a fixed 4 x u64 bitset over alignment taxon order, wide
//! enough for the 200-taxon limit. Two conventions share the type:
//! - **unrooted (NJ):** each edge's bipartition, stored as the side that
//!   does *not* contain taxon 0; kept only when both sides have >= 2
//!   taxa.
//! - **rooted (UPGMA):** the leaf set of each non-root internal node,
//!   with 2 <= size <= n - 1.
//!
//! Because canonical unrooted sides never contain taxon 0, both kinds
//! share one compatibility rule: two groupings are compatible iff they
//! are disjoint or one nests inside the other (the fourth intersection
//! `!a & !b` cannot be empty while containing taxon 0, so it never
//! needs testing).

use std::collections::HashMap;

use crate::tree::{NodeId, Tree};

/// A canonical grouping of taxa (spec §3.3): four 64-bit words over
/// taxon indices in alignment order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Hash)]
pub struct Split(pub [u64; 4]);

impl Split {
    /// The split containing the given taxon indices. Indices >= 256
    /// are dropped (the 200-taxon limit keeps real alignments inside).
    pub fn from_indices(ix: &[usize]) -> Self {
        let mut s = Split([0; 4]);
        for &i in ix {
            if i < 256 {
                s.0[i / 64] |= 1u64 << (i % 64);
            }
        }
        s
    }

    /// Whether taxon `i` is on this side.
    pub fn contains(&self, i: usize) -> bool {
        i < 256 && self.0[i / 64] & (1u64 << (i % 64)) != 0
    }

    /// Number of taxa on this side.
    pub fn len(&self) -> u32 {
        self.0.iter().map(|w| w.count_ones()).sum()
    }

    /// Whether the side is empty.
    pub fn is_empty(&self) -> bool {
        self.0 == [0; 4]
    }

    /// The taxa on this side as a sorted label list (spec §4 display
    /// form). `labels[i]` names taxon `i`; indices without a label are
    /// ignored.
    pub fn labels(&self, labels: &[String]) -> Vec<String> {
        let mut out: Vec<String> = labels
            .iter()
            .enumerate()
            .filter(|(i, _)| self.contains(*i))
            .map(|(_, l)| l.clone())
            .collect();
        out.sort();
        out
    }

    /// Whether two canonical groupings can coexist in one tree
    /// (spec §3.5's compatibility test for extended majority).
    /// Disjoint, or one nested in the other. Bits at or beyond `n`
    /// never participate.
    pub fn compatible(&self, other: &Split, n: usize) -> bool {
        let a = self.masked(n);
        let b = other.masked(n);
        let (mut ab, mut a_nb, mut na_b) = (0u64, 0u64, 0u64);
        for w in 0..4 {
            ab |= a.0[w] & b.0[w];
            a_nb |= a.0[w] & !b.0[w];
            na_b |= !a.0[w] & b.0[w];
        }
        ab == 0 || a_nb == 0 || na_b == 0
    }

    /// Copy with all bits at index >= `n` cleared.
    fn masked(&self, n: usize) -> Split {
        let mut s = *self;
        for (w, word) in s.0.iter_mut().enumerate() {
            let hi = w * 64;
            if n <= hi {
                *word = 0;
            } else if n < hi + 64 {
                *word &= (1u64 << (n - hi)) - 1;
            }
        }
        s
    }

    /// The opposite side over `0..n` taxa.
    fn complement(&self, n: usize) -> Split {
        let mut s = *self;
        for (w, word) in s.0.iter_mut().enumerate() {
            *word = !*word;
            let hi = w * 64;
            if n <= hi {
                *word = 0;
            } else if n < hi + 64 {
                *word &= (1u64 << (n - hi)) - 1;
            }
        }
        s
    }
}

/// Set the bits of every leaf under `id` (inclusive) in `out`.
/// Iterative with a visited set so a malformed cyclic arena cannot
/// hang; leaves whose label is absent from `index` set no bit.
fn leaf_bits(tree: &Tree, id: NodeId, index: &HashMap<&str, usize>, out: &mut Split) {
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
            if let Some(label) = &node.label {
                if let Some(&ix) = index.get(label.as_str()) {
                    out.0[ix / 64] |= 1u64 << (ix % 64);
                }
            }
        } else {
            stack.extend(node.children.iter().copied());
        }
    }
}

/// The canonical groupings induced by `tree`'s edges, paired with the
/// child `NodeId` of the branch that induces each one (spec §3.3).
///
/// `rooted = true` keeps the leaf set of every non-root internal node
/// with size in 2..=n-1 (UPGMA clusters). `rooted = false` keeps every
/// edge whose bipartition is non-trivial (both sides >= 2 taxa),
/// canonicalized to the side not containing taxon 0 (NJ splits).
///
/// Degenerate trees may produce the same grouping on two branches
/// (e.g. a chain of single-child internal nodes); callers that count
/// groupings deduplicate the returned splits themselves.
pub fn tree_splits(tree: &Tree, labels: &[String], rooted: bool) -> Vec<(NodeId, Split)> {
    let n = labels.len();
    let index: HashMap<&str, usize> = labels
        .iter()
        .enumerate()
        .map(|(i, l)| (l.as_str(), i))
        .collect();
    let mut out = Vec::new();
    for i in 0..tree.nodes.len() {
        let id = NodeId(i as u32);
        if id == tree.root || tree.nodes[i].children.is_empty() {
            continue; // root has no branch above it; leaf edges are trivial
        }
        let mut under = Split([0; 4]);
        leaf_bits(tree, id, &index, &mut under);
        let k = under.len() as usize;
        if rooted {
            if (2..=n.saturating_sub(1)).contains(&k) {
                out.push((id, under));
            }
        } else {
            if k < 2 || k > n.saturating_sub(2) {
                continue;
            }
            let side = if under.contains(0) {
                under.complement(n)
            } else {
                under
            };
            out.push((id, side));
        }
    }
    out
}
