//! Tree-building algorithms and their per-join traces (spec §4.5).

pub mod nj;

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::dist::DistanceMatrix;
use crate::error::NeoError;
use crate::matrix::Matrix;
use crate::seq::MAX_TAXA;
use crate::tree::{NodeId, Tree};

pub use nj::{NjFinal, NjStep};

/// Which algorithm `build_tree` runs.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum Method {
    /// Neighbor-Joining; unrooted output.
    Nj,
    /// UPGMA; rooted, ultrametric output.
    Upgma,
}

/// Options for `build_tree`. Traces are produced only when requested,
/// because a 200-taxon trace would be over 100 MB.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct BuildOptions {
    pub trace: bool,
}

/// One record per join, for the UI stepper (spec §4.5).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub enum Trace {
    Nj {
        steps: Vec<NjStep>,
        final_join: NjFinal,
    },
    Upgma {
        steps: Vec<UpgmaStep>,
    },
}

/// One UPGMA join record (spec §4.5). Defined here because `Trace`
/// references it; the algorithm that produces it is added by a later task.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct UpgmaStep {
    /// 1-based join number.
    pub step: u32,
    /// Active cluster nodes, in index order, before this join.
    pub active: Vec<NodeId>,
    /// Distances over `active`, before this join.
    pub distance: Matrix,
    /// Cluster sizes parallel to `active`.
    pub sizes: Vec<u32>,
    /// Indices into `active` of the chosen pair, `i < j`.
    pub chosen: (usize, usize),
    /// True when another pair also achieved the minimum.
    pub tie: bool,
    /// Height of the new node, `d(i, j) / 2`.
    pub height: f64,
    /// Branch length from `active[chosen.0]` to the new node.
    pub len_i: f64,
    /// Branch length from `active[chosen.1]` to the new node.
    pub len_j: f64,
    pub new_node: NodeId,
    /// Distances from the new node to the remaining active nodes, in order.
    pub new_row: Vec<f64>,
}

/// The inferred tree plus the trace when `BuildOptions::trace` was set.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct BuildResult {
    pub tree: Tree,
    pub trace: Option<Trace>,
}

/// Build a tree from a distance matrix (spec §4.5).
///
/// Checks, in order: `TooFewTaxa` when `n < 3`, `TooManyTaxa` when
/// `n > 200`, then `SaturatedMatrix` via `DistanceMatrix::to_matrix`.
pub fn build_tree(
    m: &DistanceMatrix,
    method: Method,
    opts: BuildOptions,
) -> Result<BuildResult, NeoError> {
    let n = m.n();
    if n < 3 {
        return Err(NeoError::TooFewTaxa { min: 3, got: n });
    }
    if n > MAX_TAXA {
        return Err(NeoError::TooManyTaxa {
            max: MAX_TAXA,
            got: n,
        });
    }
    let matrix = m.to_matrix()?;
    // A hand-built DistanceMatrix can disagree with its own labels; the
    // algorithms index `data[i * n + j]`, so refuse rather than panic.
    if matrix.data.len() != n * n {
        return Err(NeoError::InvalidExercise {
            field: "cells".to_string(),
            msg: format!(
                "matrix has {} cells for {} taxa, expected {}",
                matrix.data.len(),
                n,
                n * n
            ),
        });
    }
    match method {
        Method::Nj => nj::run(&matrix, &m.labels, opts.trace),
        Method::Upgma => Err(NeoError::InvalidExercise {
            field: "method".to_string(),
            msg: "upgma is not implemented yet".to_string(),
        }),
    }
}
