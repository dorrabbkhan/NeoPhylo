//! UPGMA (unweighted pair group method with arithmetic mean), spec §4.5.
//!
//! Each join picks the active pair with the smallest distance; ties go to
//! the lowest `(i, j)` in lexicographic order. The new node's height is
//! `d(i, j) / 2`, each child's branch length is that height minus the
//! child's own height, and distances to the new cluster are size-weighted
//! means. Joins continue until one cluster remains; that last merge is the
//! root of a rooted, ultrametric tree.

use crate::algos::{BuildResult, Trace, UpgmaStep};
use crate::error::NeoError;
use crate::matrix::Matrix;
use crate::tree::{NodeId, Tree};

/// Run UPGMA on a validated `n x n` matrix (`n >= 3` is guaranteed by
/// `build_tree`). Leaf labels come from the distance matrix.
pub(crate) fn run(
    input: &Matrix,
    labels: &[String],
    want_trace: bool,
) -> Result<BuildResult, NeoError> {
    let mut tree = Tree::new();
    let mut active: Vec<NodeId> = (0..input.n)
        .map(|i| tree.add_node(labels.get(i).cloned()))
        .collect();
    // Per-cluster height above the leaves (0 for leaves) and leaf count.
    let mut heights = vec![0.0; input.n];
    let mut sizes = vec![1u32; input.n];
    let mut d = input.data.clone();
    let mut steps = Vec::new();
    let mut step_no = 0u32;

    while active.len() > 1 {
        step_no += 1;
        let k = active.len();

        // 1. Choose the pair minimizing d; ties go to the lowest (i, j).
        let mut best = f64::INFINITY;
        let mut chosen = (0usize, 1usize);
        let mut ties = 0usize;
        for i in 0..k {
            for j in (i + 1)..k {
                let v = d[i * k + j];
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

        // 2. New node u at height h = d(i, j) / 2; each child's branch is
        //    h minus the child's height (negative lengths are kept).
        let dij = best;
        let h = dij / 2.0;
        let len_i = h - heights[ci];
        let len_j = h - heights[cj];
        let new_size = sizes[ci] + sizes[cj];
        let new_node = tree.add_node(None);
        tree.attach(new_node, active[ci], Some(len_i));
        tree.attach(new_node, active[cj], Some(len_j));

        // 3. d(u, x) = (s_i * d(i, x) + s_j * d(j, x)) / (s_i + s_j), over
        //    the remaining active nodes in order.
        let remaining: Vec<usize> = (0..k).filter(|&x| x != ci && x != cj).collect();
        let (si, sj) = (f64::from(sizes[ci]), f64::from(sizes[cj]));
        let new_row: Vec<f64> = remaining
            .iter()
            .map(|&x| (si * d[ci * k + x] + sj * d[cj * k + x]) / (si + sj))
            .collect();

        if want_trace {
            steps.push(UpgmaStep {
                step: step_no,
                active: active.clone(),
                distance: Matrix {
                    n: k,
                    data: d.clone(),
                },
                sizes: sizes.clone(),
                chosen,
                tie: ties > 1,
                height: h,
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
        let mut nh: Vec<f64> = remaining.iter().map(|&x| heights[x]).collect();
        nh.push(h);
        heights = nh;
        let mut ns: Vec<u32> = remaining.iter().map(|&x| sizes[x]).collect();
        ns.push(new_size);
        sizes = ns;
        d = nd;
    }

    // 4. The last merge is the root of a rooted, ultrametric tree.
    tree.set_root(active[0]);
    tree.rooted = true;

    Ok(BuildResult {
        tree,
        trace: want_trace.then_some(Trace::Upgma { steps }),
    })
}
