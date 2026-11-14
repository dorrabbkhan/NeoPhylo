//! User-supplied distance matrices (v1.4c spec §5): `DistanceInput`
//! (taxon names plus the strict lower triangle in row order), its
//! validation, conversion to the existing `DistanceMatrix` under
//! `DistModel::Supplied`, and `additive_matrix` — patristic
//! (path-length) distances from a tree, for the editor's
//! "derive from tree" route.
//!
//! Structural problems are `NeoError::InvalidMatrix`; file-syntax
//! problems stay `NeoError::Parse` (the parsers live in Task 4's
//! `matrix_parse`). Nothing here panics on any input.

use libm::{pow, round};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::dist::{Cell, DistModel, DistanceMatrix};
use crate::error::NeoError;
use crate::seq::MAX_TAXA;
use crate::tree::{NodeId, Tree};

/// A distance matrix as the user supplies it: `names` in order and
/// `lower`, the strict lower triangle in row order — for n taxa the
/// `n·(n−1)/2` values d(1,0), d(2,0), d(2,1), d(3,0), … (spec §4.1).
/// The diagonal is implicitly zero. Storing only the lower triangle
/// means a `DistanceInput` can never be asymmetric.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct DistanceInput {
    pub names: Vec<String>,
    pub lower: Vec<f64>,
}

impl DistanceInput {
    /// Number of taxa (`names.len()`).
    pub fn n(&self) -> usize {
        self.names.len()
    }

    /// Cell `(i, j)`; symmetric, and `get(i, i)` is `0.0`.
    ///
    /// Precondition: `i < n()`, `j < n()` and `lower` holds exactly
    /// `n·(n−1)/2` values — i.e. the input has passed
    /// [`validate_input`] (or came from [`DistanceInput::to_distance_matrix`]
    /// or [`additive_matrix`], which validate first).
    pub fn get(&self, i: usize, j: usize) -> f64 {
        if i == j {
            return 0.0;
        }
        let (r, c) = if i > j { (i, j) } else { (j, i) };
        self.lower[r * (r - 1) / 2 + c]
    }

    /// Validate, then wrap as the symmetric `DistanceMatrix` the
    /// algorithms already consume: `Cell::Value` cells, a zero
    /// diagonal and `model` `DistModel::Supplied`.
    pub fn to_distance_matrix(&self) -> Result<DistanceMatrix, NeoError> {
        validate_input(self)?;
        let n = self.n();
        let mut cells = vec![Cell::Value(0.0); n * n];
        let mut k = 0usize;
        for i in 0..n {
            for j in 0..i {
                cells[i * n + j] = Cell::Value(self.lower[k]);
                cells[j * n + i] = Cell::Value(self.lower[k]);
                k += 1;
            }
        }
        Ok(DistanceMatrix {
            labels: self.names.clone(),
            model: DistModel::Supplied,
            cells,
        })
    }
}

/// Structural validation of a supplied matrix (spec §4.1), checked in
/// this order — taxon count, `lower` length, names, then values — so
/// the first problem found is the one reported:
///
/// - 3 ≤ n ≤ [`MAX_TAXA`], else `TooFewTaxa`/`TooManyTaxa`;
/// - `lower.len() == n·(n−1)/2`, else `InvalidMatrix` with no cell;
/// - every name non-empty (after trimming) and unique, else
///   `InvalidMatrix`; a duplicate names the shared string in both
///   `row` and `col` and both positions in `msg`;
/// - every value finite and ≥ 0 (`−0.0` reads as 0; zero off-diagonal
///   values are allowed — identical taxa), else `InvalidMatrix` naming
///   the first bad cell in row order.
pub fn validate_input(m: &DistanceInput) -> Result<(), NeoError> {
    let n = m.names.len();
    if n < 3 {
        return Err(NeoError::TooFewTaxa { min: 3, got: n });
    }
    if n > MAX_TAXA {
        return Err(NeoError::TooManyTaxa {
            max: MAX_TAXA,
            got: n,
        });
    }
    let want = n * (n - 1) / 2;
    if m.lower.len() != want {
        return Err(NeoError::InvalidMatrix {
            row: String::new(),
            col: String::new(),
            msg: format!(
                "expected {want} lower-triangle distances for {n} taxa, got {}",
                m.lower.len()
            ),
        });
    }
    for (k, name) in m.names.iter().enumerate() {
        if name.trim().is_empty() {
            return Err(NeoError::InvalidMatrix {
                row: String::new(),
                col: String::new(),
                msg: format!("taxon {} has no name", k + 1),
            });
        }
        // Exact-string compare: no trimming or case folding (PHYLIP is
        // case-sensitive). Truncation collisions are the parser's job.
        for (l, earlier) in m.names.iter().enumerate().take(k) {
            if earlier == name {
                return Err(NeoError::InvalidMatrix {
                    row: name.clone(),
                    col: name.clone(),
                    msg: format!("taxa {} and {} share the name '{name}'", l + 1, k + 1),
                });
            }
        }
    }
    let mut k = 0usize;
    for i in 0..n {
        for j in 0..i {
            let v = m.lower[k];
            if !v.is_finite() || v < 0.0 {
                return Err(NeoError::InvalidMatrix {
                    row: m.names[i].clone(),
                    col: m.names[j].clone(),
                    msg: format!("distance must be finite and non-negative, got {v}"),
                });
            }
            k += 1;
        }
    }
    Ok(())
}

/// Distances from `start` to every node, walking parent and child
/// links and summing branch lengths, plus the reached-node mask so the
/// caller can refuse a disconnected tree rather than report a bogus
/// distance. `None` when any edge lacks a length — the caller names
/// the leaf it started from.
fn distances_from(tree: &Tree, start: NodeId) -> Option<(Vec<f64>, Vec<bool>)> {
    let mut dist = vec![0.0f64; tree.nodes.len()];
    let mut seen = vec![false; tree.nodes.len()];
    seen[start.0 as usize] = true;
    let mut stack = vec![start];
    while let Some(id) = stack.pop() {
        let i = id.0 as usize;
        let d = dist[i];
        if let Some(p) = tree.nodes[i].parent {
            let pi = p.0 as usize;
            // A hand-built tree can carry out-of-range links; they are
            // dead ends, not panics.
            if pi < tree.nodes.len() && !seen[pi] {
                dist[pi] = d + tree.branch_length(id)?; // edge above `id`
                seen[pi] = true;
                stack.push(p);
            }
        }
        for &c in &tree.nodes[i].children {
            let ci = c.0 as usize;
            if ci < tree.nodes.len() && !seen[ci] {
                dist[ci] = d + tree.branch_length(c)?; // edge above `c`
                seen[ci] = true;
                stack.push(c);
            }
        }
    }
    Some((dist, seen))
}

/// The additive (patristic) matrix of `tree`: leaf-to-leaf path
/// lengths in `tree.leaf_labels()` order (spec §5.3).
///
/// `round_decimals` rounds every distance to `d` decimals
/// (`round(v·10^d)/10^d`) for textbook-friendly values; `d > 6` is
/// `InvalidMatrix`. A missing branch length is `InvalidMatrix` naming
/// a leaf whose path needs it. Fewer than 3 leaves is `TooFewTaxa`;
/// the result is passed through [`validate_input`], so duplicate or
/// empty leaf labels and a tree over [`MAX_TAXA`] leaves get the same
/// refusal as a supplied matrix.
pub fn additive_matrix(tree: &Tree, round_decimals: Option<u8>) -> Result<DistanceInput, NeoError> {
    if let Some(d) = round_decimals {
        if d > 6 {
            return Err(NeoError::InvalidMatrix {
                row: String::new(),
                col: String::new(),
                msg: format!("round_decimals must be 6 or less, got {d}"),
            });
        }
    }
    // Leaves in preorder = `leaf_labels()` order.
    let leaves: Vec<(NodeId, String)> = tree
        .preorder()
        .into_iter()
        .filter(|&id| tree.is_leaf(id))
        .map(|id| {
            (
                id,
                tree.nodes[id.0 as usize].label.clone().unwrap_or_default(),
            )
        })
        .collect();
    let n = leaves.len();
    if n < 3 {
        return Err(NeoError::TooFewTaxa { min: 3, got: n });
    }
    let mut lower = Vec::with_capacity(n * (n - 1) / 2);
    for (i, &(start, ref name)) in leaves.iter().enumerate() {
        let (dist, seen) = distances_from(tree, start).ok_or_else(|| NeoError::InvalidMatrix {
            row: name.clone(),
            col: String::new(),
            msg: format!("a branch on a path from '{name}' has no length"),
        })?;
        for &(target, ref tname) in leaves.iter().take(i) {
            if !seen[target.0 as usize] {
                return Err(NeoError::InvalidMatrix {
                    row: name.clone(),
                    col: tname.clone(),
                    msg: format!("taxa '{name}' and '{tname}' are not connected in the tree"),
                });
            }
            let mut v = dist[target.0 as usize];
            if let Some(d) = round_decimals {
                let p = pow(10.0, f64::from(d));
                v = round(v * p) / p;
            }
            lower.push(v);
        }
    }
    let input = DistanceInput {
        names: leaves.into_iter().map(|(_, name)| name).collect(),
        lower,
    };
    validate_input(&input)?;
    Ok(input)
}
