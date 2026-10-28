//! Column resampling and per-replicate detail (v1.2 spec §3.2, §3.6).
//!
//! Replicate `i` draws `L` column indices with replacement from a
//! private `ChaCha8Rng` stream: `seed_from_u64(seed)` then
//! `set_stream(i)`. The same `(seed, i)` always produces the same
//! replicate, independent of batching, ordering or cancellation — that
//! is what makes partial and merged tallies exact.

use std::collections::BTreeSet;

use rand_chacha::ChaCha8Rng;
use rand_core::{RngCore, SeedableRng};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::algos::{build_tree, BuildOptions, Method};
use crate::bootstrap::split::{tree_splits, Split};
use crate::compare::rf;
use crate::dist::{compute_filtered, compute_weighted, DistModel};
use crate::error::NeoError;
use crate::seq::Alignment;
use crate::site_filter::{site_mask, SiteFilter};
use crate::tree::Tree;

/// Column weights for replicate `i` of `seed` over `l` columns
/// (spec §3.2). Each of the `l` draws is
/// `((rng.next_u64() as u128 * l as u128) >> 64) as usize`; the draws
/// come in that order and nothing else consumes the stream.
pub fn resample_weights(seed: u64, i: u32, l: usize) -> Vec<u32> {
    let mut rng = ChaCha8Rng::seed_from_u64(seed);
    rng.set_stream(u64::from(i));
    let mut w = vec![0u32; l];
    for _ in 0..l {
        let k = ((rng.next_u64() as u128 * l as u128) >> 64) as usize;
        if let Some(cell) = w.get_mut(k) {
            *cell += 1;
        }
    }
    w
}

/// The full teaching detail of one replicate (spec §3.6): its column
/// weights, whether it was skipped, the tree it built, and how that
/// tree differs from the original.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct ReplicateDetail {
    /// 0-based replicate index.
    pub index: u32,
    /// Column weights, one per alignment column.
    pub weights: Vec<u32>,
    /// Number of columns with weight 0.
    pub undrawn: u32,
    /// The replicate's tree; `None` when the replicate was skipped.
    pub tree: Option<Tree>,
    /// The replicate was skipped (saturated cell or no comparable
    /// sites); `tree` and `rf_to_original` are `None`.
    pub failed: bool,
    /// Distance between the replicate tree and the original tree in
    /// the method's own terms: the unrooted RF for NJ, the rooted
    /// cluster symmetric difference (sizes 2..=n-1) for UPGMA — the
    /// same sets `differing` reports. `None` when `failed`.
    pub rf_to_original: Option<u32>,
    /// Groupings present in exactly one of the two trees, each as a
    /// sorted label list.
    pub differing: Vec<Vec<String>>,
}

/// Compute one replicate on demand for the "watch one replicate" view
/// (spec §3.6). Uses the identical weights as replicate `i` of
/// `bootstrap_batch`. A skipped replicate returns `failed: true`;
/// other engine errors propagate.
pub fn replicate_detail(
    aln: &Alignment,
    model: DistModel,
    method: Method,
    seed: u64,
    i: u32,
) -> Result<ReplicateDetail, NeoError> {
    replicate_detail_filtered(aln, model, method, SiteFilter::Pairwise, seed, i)
}

/// `replicate_detail` under a site filter (v1.4b spec §3.2): replicates
/// draw over the kept columns only, exactly as in
/// `bootstrap_batch_filtered`, and the "original" tree is built on the
/// filtered distances so like is compared with like. `weights` stays
/// one entry per alignment column (removed columns are 0 and count in
/// `undrawn`). Under `Pairwise` this is today's path bit for bit.
pub fn replicate_detail_filtered(
    aln: &Alignment,
    model: DistModel,
    method: Method,
    filter: SiteFilter,
    seed: u64,
    i: u32,
) -> Result<ReplicateDetail, NeoError> {
    let n = aln.seqs.len();
    let labels: Vec<String> = (0..n).map(|k| crate::dist::label(&aln.labels, k)).collect();
    let l = aln.seqs.iter().map(Vec::len).max().unwrap_or(0);
    let mask = site_mask(aln, filter)?;
    let kept: Vec<usize> = mask
        .weights
        .iter()
        .enumerate()
        .filter(|(_, &w)| w == 1)
        .map(|(k, _)| k)
        .collect();
    let kept_w = resample_weights(seed, i, kept.len());
    let mut w = vec![0u32; l];
    for (j, &wt) in kept_w.iter().enumerate() {
        w[kept[j]] = wt;
    }
    let undrawn = w.iter().filter(|&&x| x == 0).count() as u32;
    let mut detail = ReplicateDetail {
        index: i,
        weights: w,
        undrawn,
        tree: None,
        failed: false,
        rf_to_original: None,
        differing: Vec::new(),
    };

    let dm = match compute_weighted(aln, model, &detail.weights) {
        Ok(dm) => dm,
        Err(NeoError::InsufficientOverlap { .. }) => {
            detail.failed = true;
            return Ok(detail);
        }
        Err(e) => return Err(e),
    };
    if !dm.saturated_cells().is_empty() {
        detail.failed = true;
        return Ok(detail);
    }
    let rep = build_tree(&dm, method, BuildOptions { trace: false })?.tree;

    // The original tree is rebuilt on demand under the same filter; its
    // errors propagate.
    let orig_dm = compute_filtered(aln, model, filter)?;
    let orig = build_tree(&orig_dm, method, BuildOptions { trace: false })?.tree;

    let rooted = method == Method::Upgma;
    let groupings = |t: &Tree| -> BTreeSet<Split> {
        tree_splits(t, &labels, rooted)
            .into_iter()
            .map(|(_, s)| s)
            .collect()
    };
    let a = groupings(&orig);
    let b = groupings(&rep);
    detail.differing = a
        .symmetric_difference(&b)
        .map(|s| s.labels(&labels))
        .collect();
    // Compare like with like: a rooted (UPGMA) tree's distance is the
    // cluster symmetric difference — exactly `differing` — not the
    // unrooted split distance that only fits NJ.
    detail.rf_to_original = if rooted {
        Some(detail.differing.len() as u32)
    } else {
        Some(rf(&orig, &rep)?.rf)
    };
    detail.tree = Some(rep);
    Ok(detail)
}
