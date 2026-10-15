//! Neighbor-Joining (Saitou & Nei; Studier & Keppler formulation),
//! spec §4.5 steps 1-6.
//!
//! Each join picks the pair minimizing
//! `Q(i, j) = (n - 2) * d(i, j) - R_i - R_j` over active clusters `i < j`;
//! ties go to the lowest `(i, j)` in lexicographic order. When three nodes
//! remain they join a central node, which becomes the root of an unrooted
//! tree. Negative lengths are kept as computed.

use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::algos::{BuildResult, Trace};
use crate::error::NeoError;
use crate::matrix::Matrix;
use crate::tree::{NodeId, Tree};

/// One NJ join record (spec §4.5). Indices in `chosen` and the rows of
/// `distance`, `q`, `r` and `new_row` are positions in `active`, not
/// `NodeId`s.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct NjStep {
    /// 1-based join number.
    pub step: u32,
    /// Active cluster nodes, in index order, before this join.
    pub active: Vec<NodeId>,
    /// Distances over `active`, before this join.
    pub distance: Matrix,
    /// Row sums `R_i` of `distance`.
    pub r: Vec<f64>,
    /// `Q(i, j) = (n - 2) * d(i, j) - R_i - R_j`; the diagonal is 0.
    pub q: Matrix,
    /// Indices into `active` of the minimizing pair, `i < j`.
    pub chosen: (usize, usize),
    /// True when another pair also achieved the minimum Q.
    pub tie: bool,
    /// Branch length from `active[chosen.0]` to the new node.
    pub len_i: f64,
    /// Branch length from `active[chosen.1]` to the new node.
    pub len_j: f64,
    pub new_node: NodeId,
    /// Distances from the new node to the remaining active nodes, in order.
    pub new_row: Vec<f64>,
}

/// The final three-way join that produces the central node (spec §4.5
/// step 5). `a`, `b` and `c` are the three remaining active nodes in order.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct NjFinal {
    pub a: NodeId,
    pub b: NodeId,
    pub c: NodeId,
    /// `(d_ab + d_ac - d_bc) / 2`
    pub la: f64,
    /// `(d_ab + d_bc - d_ac) / 2`
    pub lb: f64,
    /// `(d_ac + d_bc - d_ab) / 2`
    pub lc: f64,
}

/// Run Neighbor-Joining on a validated `n x n` matrix (`n >= 3` is
/// guaranteed by `build_tree`). Leaf labels come from the distance matrix.
pub(crate) fn run(
    input: &Matrix,
    labels: &[String],
    want_trace: bool,
) -> Result<BuildResult, NeoError> {
    let mut tree = Tree::new();
    let mut active: Vec<NodeId> = (0..input.n)
        .map(|i| tree.add_node(labels.get(i).cloned()))
        .collect();
    let mut d = input.data.clone();
    let mut steps = Vec::new();
    let mut step_no = 0u32;

    while active.len() > 3 {
        step_no += 1;
        let k = active.len();

        // 1. R_i = sum_k d(i, k)
        let r: Vec<f64> = d.chunks(k).map(|row| row.iter().sum()).collect();

        // 2. Q(i, j) = (k-2) * d(i, j) - R_i - R_j; minimize over i < j.
        let span = k as f64 - 2.0;
        let mut q = Matrix::zeros(k);
        for i in 0..k {
            for j in 0..k {
                if i != j {
                    q.data[i * k + j] = span * d[i * k + j] - r[i] - r[j];
                }
            }
        }
        let mut best = f64::INFINITY;
        let mut chosen = (0usize, 1usize);
        let mut ties = 0usize;
        for i in 0..k {
            for j in (i + 1)..k {
                let v = q.data[i * k + j];
                if v < best {
                    best = v;
                    chosen = (i, j);
                    ties = 1;
                } else if v == best {
                    ties += 1;
                }
            }
        }
        let (ci, cj) = chosen;

        // 3. Limb lengths to the new node u.
        let dij = d[ci * k + cj];
        let len_i = dij / 2.0 + (r[ci] - r[cj]) / (2.0 * span);
        let len_j = dij - len_i;
        let new_node = tree.add_node(None);
        tree.attach(new_node, active[ci], Some(len_i));
        tree.attach(new_node, active[cj], Some(len_j));

        // 4. d(u, x) = (d(i, x) + d(j, x) - d(i, j)) / 2, over the
        //    remaining active nodes in order.
        let remaining: Vec<usize> = (0..k).filter(|&x| x != ci && x != cj).collect();
        let new_row: Vec<f64> = remaining
            .iter()
            .map(|&x| (d[ci * k + x] + d[cj * k + x] - dij) / 2.0)
            .collect();

        if want_trace {
            steps.push(NjStep {
                step: step_no,
                active: active.clone(),
                distance: Matrix {
                    n: k,
                    data: d.clone(),
                },
                r,
                q,
                chosen,
                tie: ties > 1,
                len_i,
                len_j,
                new_node,
                new_row: new_row.clone(),
            });
        }

        // Shrink the matrix: remaining nodes keep their order, the new
        // node is appended last.
        let nk = k - 1;
        let mut nd = vec![0.0; nk * nk];
        for (x, &a) in remaining.iter().enumerate() {
            for (y, &b) in remaining.iter().enumerate() {
                nd[x * nk + y] = d[a * k + b];
            }
            nd[x * nk + nk - 1] = new_row[x];
            nd[(nk - 1) * nk + x] = new_row[x];
        }
        let mut next: Vec<NodeId> = remaining.iter().map(|&x| active[x]).collect();
        next.push(new_node);
        active = next;
        d = nd;
    }

    // 5. Three nodes remain; join them at a central node.
    let (a, b, c) = (active[0], active[1], active[2]);
    let (dab, dac, dbc) = (d[1], d[2], d[5]);
    let la = (dab + dac - dbc) / 2.0;
    let lb = (dab + dbc - dac) / 2.0;
    let lc = (dac + dbc - dab) / 2.0;
    let center = tree.add_node(None);
    tree.attach(center, a, Some(la));
    tree.attach(center, b, Some(lb));
    tree.attach(center, c, Some(lc));
    tree.set_root(center);

    // 6. Unrooted output (the default on `Tree::new`); negative lengths
    //    are kept as computed.
    let final_join = NjFinal {
        a,
        b,
        c,
        la,
        lb,
        lc,
    };
    Ok(BuildResult {
        tree,
        trace: want_trace.then_some(Trace::Nj { steps, final_join }),
    })
}
