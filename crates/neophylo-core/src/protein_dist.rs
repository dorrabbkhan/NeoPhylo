//! Protein distances: shared pair counting, the Kimura correction and
//! JTT maximum likelihood (v1.1 spec §3.4).
//!
//! A site counts for a pair only when both characters are standard
//! amino acids (`protein_index`); `B Z J X U O * - ?` and ragged tails
//! are pairwise-deleted, as in the DNA path. `compute` routes protein
//! alignments here for `DistModel::{P, Kimura, Jtt}`; `jtt_pair_detail`
//! computes the same estimate for one pair on demand, plus the
//! teaching detail (sparse count table and likelihood curve).

use libm::log;
use serde::{Deserialize, Serialize};
use ts_rs::TS;

use crate::alphabet::{protein_index, Alphabet};
use crate::dist::{label, Cell, DistModel};
use crate::error::NeoError;
use crate::model::jtt_spectral;
use crate::seq::Alignment;
use crate::site_filter::{site_mask, SiteFilter};

/// Farthest distance reported by the JTT fit (spec §3.4: protdist
/// writes -1 for pairs whose estimate runs past the search bound).
const D_MAX: f64 = 10.0;
/// `d̂` at or beyond this is reported `Saturated` (spec §3.4).
const SATURATED_EPS: f64 = 1e-6;
/// Points sampled for `PairDetail::curve` (spec §3.4).
const CURVE_POINTS: usize = 60;
// Optimizer constants mirroring protdist 3.697 `makedists`: fixed 20
// Newton iterations from tt = 0.1 with step-halving (delta = tt/2),
// a small-distance clamp (`protepsilon`), and divergence declared
// when tt exceeds 1e4.
const NEWTON_ITERS: usize = 20;
const PROTEPSILON: f64 = 1e-5;
const DIVERGED: f64 = 1e4;
// Newton acceptance: after the fixed iteration limit the result counts
// as converged only when the logL slope is stationary per site. A small
// last step is not sufficient: the `protepsilon` floor clamp can pin the
// iterate while the slope stays large (near-identical pairs), and
// delta-halving can shrink steps while the trajectory still drifts.
// Anything else falls back to the bounded Brent search.
const NEWTON_CONV_SLOPE: f64 = 1e-6;
// Bounded Brent search on [0, D_MAX] (spec §3.4): absolute tolerance
// 1e-10 in d.
const BRENT_TOL: f64 = 1e-10;
const BRENT_ITMAX: usize = 200;
const CGOLD: f64 = 0.3819660112501051; // (3 - sqrt(5)) / 2
const ZEPS: f64 = 1e-12;

/// Count a protein pair into a 20×20 ordered-pair table `N_xy`
/// (`PROTEIN_STATES` order), plus the comparable-site and difference
/// counts. Sites where either character is not a standard amino acid
/// are skipped; so are sites past the end of the shorter sequence.
pub fn pair_counts(a: &[u8], b: &[u8]) -> ([[u32; 20]; 20], u32, u32) {
    let w = vec![1u32; a.len().max(b.len())];
    let (table, comparable, differences) = pair_counts_weighted(a, b, &w);
    (
        table,
        comparable.min(u64::from(u32::MAX)) as u32,
        differences.min(u64::from(u32::MAX)) as u32,
    )
}

/// Weighted variant of `pair_counts` (v1.2 spec §3.1): column `k`
/// contributes `w[k]` to the table and the comparable/difference
/// counts. A weight of 0 drops the column and a missing `w[k]` is
/// treated as 0, so a short `w` can never index past its end. Table
/// cells saturate at `u32::MAX` instead of overflowing.
pub fn pair_counts_weighted(a: &[u8], b: &[u8], w: &[u32]) -> ([[u32; 20]; 20], u64, u64) {
    let mut table = [[0u32; 20]; 20];
    let mut comparable = 0u64;
    let mut differences = 0u64;
    for k in 0..a.len().min(b.len()) {
        let wt = u64::from(w.get(k).copied().unwrap_or(0));
        if wt == 0 {
            continue;
        }
        let (Some(x), Some(y)) = (protein_index(a[k]), protein_index(b[k])) else {
            continue;
        };
        comparable += wt;
        if x != y {
            differences += wt;
        }
        table[x as usize][y as usize] = table[x as usize][y as usize].saturating_add(w[k]);
    }
    (table, comparable, differences)
}

/// The Kimura protein correction (spec §3.4): `x = 1 − p − 0.2p²`,
/// `d = −ln x`; `Saturated` when `x ≤ 0` (p ≳ 0.854).
pub fn kimura_from_p(p: f64) -> Cell {
    let x = 1.0 - p - 0.2 * p * p;
    if x <= 0.0 {
        Cell::Saturated
    } else {
        Cell::Value(-log(x))
    }
}

/// Sparse merged count table `(x, y, n)` with `x ≤ y`, one entry per
/// unordered state pair that occurs. The joint probability is symmetric
/// — `π_x·P_xy(t) ≡ π_y·P_yx(t)` for a reversible model, bit-for-bit in
/// the spectral form (`c_k(x)·c_k(y)` commutes) — so `N_xy·ln J_xy +
/// N_yx·ln J_yx` is evaluated as `(N_xy + N_yx)·ln J_xy`. This halves
/// the spectral work per pair; the merged integer count is exact
/// (counts are ≤ 2³²), so the only rounding change is one fewer
/// multiply-add per merged pair — far inside the parity tolerances.
type CountList = Vec<(u8, u8, u32)>;

fn merge_counts(counts: &[[u32; 20]; 20]) -> CountList {
    let mut cells = Vec::with_capacity(210);
    for (x, row) in counts.iter().enumerate() {
        for (y, &n) in row.iter().enumerate().skip(x) {
            let n = n + if x == y { 0 } else { counts[y][x] };
            if n > 0 {
                cells.push((x as u8, y as u8, n));
            }
        }
    }
    cells
}

/// `logL(d) = Σ N_xy · ln(π_x · P_xy(d))` (spec §3.4), evaluated in
/// the spectral form `Σ N_xy · ln(Σ_k c_k(x)c_k(y)e^{λ_k d})` that
/// `protdist`'s `predict` uses — same value, oracle-matching rounding
/// within merged-cell ulps.
fn jtt_logl(cells: &CountList, d: f64) -> f64 {
    let ctx = jtt_spectral(d);
    let mut l = 0.0;
    for &(x, y, n) in cells {
        let p = ctx.prob(x as usize, y as usize);
        l += f64::from(n) * log(p.max(1e-300));
    }
    l
}

/// `logL`'s first two derivatives at `d` (protdist's `slope`/`curv`),
/// plus whether any observed site pair's joint probability underflowed.
fn logl_derivs(cells: &CountList, d: f64) -> (f64, f64, bool) {
    let ctx = jtt_spectral(d);
    let (mut slope, mut curv) = (0.0, 0.0);
    let mut neginfinity = false;
    for &(x, y, n) in cells {
        let (p, dp, d2p) = ctx.derivs(x as usize, y as usize);
        if p <= 0.0 {
            neginfinity = true;
        } else {
            let n = f64::from(n);
            // One reciprocal per cell; protdist's n·dp/p and
            // n·(d2p/p − (dp/p)²) are evaluated with three divides.
            // The ulp-level difference stays far inside the parity
            // tolerances.
            let invp = 1.0 / p;
            slope += n * dp * invp;
            curv += n * (d2p * invp - dp * dp * invp * invp);
        }
    }
    (slope, curv, neginfinity)
}

/// protdist 3.697's pair-distance optimizer (`makedists`): a fixed 20
/// Newton iterations on `slope = d(logL)/dt` and `curv = d²(logL)/dt²`,
/// with delta-halving when the curvature is non-negative or any site
/// probability underflows, the `protepsilon` floor, and divergence
/// (PHYLIP prints -1) above `DIVERGED`.
///
/// Spec §3.4 asks for Brent on [0, 10] — but the reference fixtures
/// were produced by this loop, and on the doc data the likelihood has
/// a ~1e-7 flat plateau at its peak whose landing point decides
/// whether the printed values match. Replicating the oracle's
/// trajectory is the only way to meet the 5e-7 doc parity tolerance;
/// it also converges to a true stationary point (|slope| ~ 1e-10),
/// which Brent cannot reach through f64 evaluation noise.
/// (docs/decisions.md, Task 6.)
///
/// Returns `Some(d)` when the loop ends converged at a finite `d` inside
/// `[0, D_MAX]`, `None` when it diverges, leaves the interval, goes
/// non-finite, or has not settled within the iteration limit — the
/// caller then falls back to [`brent_mle`].
fn newton_mle(cells: &CountList) -> Option<f64> {
    let mut tt = 0.1;
    let mut delta = tt / 2.0;
    let mut diverged = false;
    let mut it = 0;
    // Slope at the final tt when the loop ended on a frozen iterate
    // (see below): the last derivative call already evaluated it, so the
    // convergence check reuses it instead of re-evaluating.
    let mut last_slope = 0.0;
    let mut frozen = false;
    let total = cells.iter().map(|&(_, _, n)| f64::from(n)).sum::<f64>();
    while it != NEWTON_ITERS {
        let prev = tt;
        let (slope, curv, neginfinity) = logl_derivs(cells, tt);
        last_slope = slope;
        it += 1;
        // Converged stationary point: the slope already passes the
        // acceptance check and the next Newton step is below print
        // precision, so the remaining iterations only wiggle tt within
        // a few ulps. protdist still runs all NEWTON_ITERS passes; the
        // endpoint it emits is this same fixed point to ~1e-15. (The
        // step-size guard keeps a lucky near-zero slope at a nearly
        // flat point from freezing a still-moving iterate.)
        if !neginfinity
            && curv < 0.0
            && slope.abs() <= NEWTON_CONV_SLOPE * total.max(1.0)
            && (slope / curv).abs() <= 1e-9
        {
            frozen = true;
            break;
        }
        if !neginfinity {
            if curv < 0.0 {
                tt -= slope / curv;
                if tt > DIVERGED {
                    diverged = true;
                    break;
                }
            } else {
                if (slope > 0.0 && delta < 0.0) || (slope < 0.0 && delta > 0.0) {
                    delta /= -2.0;
                }
                tt += delta;
            }
        } else {
            delta /= -2.0;
            tt += delta;
        }
        if tt < PROTEPSILON && !diverged {
            tt = PROTEPSILON;
        }
        // The iterate is frozen when this step left tt bit-identical:
        // every remaining iteration would evaluate the same point and
        // recompute the same step, so the loop's final state is known.
        // In each branch this is stable — curv<0 repeats slope/curv, and
        // tt+delta == tt implies |delta| < ulp(tt) while every other
        // branch only shrinks |delta| — so breaking here reproduces the
        // full NEWTON_ITERS trajectory exactly.
        if tt == prev {
            frozen = true;
            break;
        }
    }
    if diverged || !tt.is_finite() || !(0.0..=D_MAX).contains(&tt) {
        return None;
    }
    // Convergence check at the final point: the trajectory counts as
    // converged only at a stationary point of logL. The slope is summed
    // over comparable sites, so its threshold scales with the site
    // count. A floor-clamped or still-drifting iterate keeps a
    // macroscopic slope and falls back to Brent — for a pair whose true
    // maximum lies below `protepsilon`, the bounded search can land
    // meaningfully closer to 0 than the floor.
    let slope = if frozen {
        last_slope
    } else {
        logl_derivs(cells, tt).0
    };
    if slope.abs() <= NEWTON_CONV_SLOPE * total.max(1.0) {
        Some(tt)
    } else {
        None
    }
}

/// Bounded Brent search for the `logL` maximum on `[0, D_MAX]` to an
/// absolute tolerance of `BRENT_TOL` in `d` (spec §3.4). Fallback for
/// the cases `newton_mle` cannot certify, and the decider for
/// saturation: a bounded maximum within `SATURATED_EPS` of `D_MAX`
/// means the likelihood is still climbing at the search boundary.
fn brent_mle(cells: &CountList) -> f64 {
    // Minimize -logL; follows the canonical Brent structure with golden
    // steps when the parabolic fit is unacceptable.
    let f = |d: f64| -jtt_logl(cells, d);
    let (mut a, mut b) = (0.0_f64, D_MAX);
    let mut x = a + CGOLD * (b - a);
    let mut w = x;
    let mut v = x;
    let mut fx = f(x);
    let mut fw = fx;
    let mut fv = fx;
    let mut d: f64 = 0.0;
    let mut e: f64 = 0.0;
    for _ in 0..BRENT_ITMAX {
        let xm = 0.5 * (a + b);
        let tol1 = BRENT_TOL + ZEPS * x.abs();
        let tol2 = 2.0 * tol1;
        if (x - xm).abs() <= tol2 - 0.5 * (b - a) {
            break;
        }
        if e.abs() > tol1 {
            // Inverse-parabolic step through (x, w, v).
            let r = (x - w) * (fx - fv);
            let q = (x - v) * (fx - fw);
            let p0 = (x - v) * q - (x - w) * r;
            let q = 2.0 * (r - q);
            let p = if q > 0.0 { -p0 } else { p0 };
            let q = q.abs();
            let etemp = e;
            e = d;
            if p.abs() >= (0.5 * q * etemp).abs() || p <= q * (a - x) || p >= q * (b - x) {
                e = if x >= xm { a - x } else { b - x };
                d = CGOLD * e;
            } else {
                d = p / q;
                let u = x + d;
                if u - a < tol2 || b - u < tol2 {
                    d = tol1.copysign(xm - x);
                }
            }
        } else {
            e = if x >= xm { a - x } else { b - x };
            d = CGOLD * e;
        }
        let u = if d.abs() >= tol1 {
            x + d
        } else {
            x + tol1.copysign(d)
        };
        let fu = f(u);
        if fu <= fx {
            if u >= x {
                a = x;
            } else {
                b = x;
            }
            v = w;
            fv = fw;
            w = x;
            fw = fx;
            x = u;
            fx = fu;
        } else {
            if u < x {
                a = u;
            } else {
                b = u;
            }
            if fu <= fw || w == x {
                v = w;
                fv = fw;
                w = u;
                fw = fu;
            } else if fu <= fv || v == x || v == w {
                v = u;
                fv = fu;
            }
        }
    }
    x
}

/// The JTT maximum-likelihood distance for one pair's count table
/// (spec §3.4). `d̂ = 0` exactly when the pair is identical over its
/// comparable sites; `Saturated` when the likelihood is still climbing
/// at `D_MAX` — decided by the bounded search, since the Newton
/// trajectory has no guarantee of reaching the true maximum there.
pub fn jtt_ml(counts: &[[u32; 20]; 20]) -> Cell {
    let differences: u32 = counts
        .iter()
        .enumerate()
        .flat_map(|(x, row)| row.iter().enumerate().map(move |(y, &n)| (x, y, n)))
        .filter(|&(x, y, _)| x != y)
        .map(|(_, _, n)| n)
        .sum();
    if differences == 0 {
        // Also covers the all-zero table; callers reject zero-comparable
        // pairs with `InsufficientOverlap` before reaching this.
        return Cell::Value(0.0);
    }
    // Primary: the protdist Newton trajectory. A converged result
    // strictly inside the search interval is the estimate; anything near
    // the bound or unconverged is adjudicated by the bounded Brent
    // search, which owns the saturation call.
    let cells = merge_counts(counts);
    match newton_mle(&cells) {
        Some(d) if d < D_MAX - SATURATED_EPS => Cell::Value(d),
        _ => {
            let d = brent_mle(&cells);
            if d >= D_MAX - SATURATED_EPS {
                Cell::Saturated
            } else {
                Cell::Value(d)
            }
        }
    }
}

/// Optimizer internals for tests (not public API): the Newton estimate
/// (`None` when it did not converge) and the bounded Brent argmax.
#[doc(hidden)]
pub fn optimizer_estimates(counts: &[[u32; 20]; 20]) -> (Option<f64>, f64) {
    let cells = merge_counts(counts);
    (newton_mle(&cells), brent_mle(&cells))
}

/// The Poisson correction (v1.4b spec §3.3): `d = −ln(1 − p)` on
/// pairwise-compared sites; `Saturated` when `p ≥ 1`.
pub fn poisson_from_p(p: f64) -> Cell {
    if p >= 1.0 {
        Cell::Saturated
    } else {
        Cell::Value(-log(1.0 - p))
    }
}

/// The on-demand detail behind one pair's distance, for the "How was
/// this distance computed?" panel (spec §3.4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "../../../web/src/engine/generated/")]
pub struct PairDetail {
    /// Indices of the two sequences in the alignment.
    pub a: usize,
    pub b: usize,
    /// Sites where both characters are standard amino acids.
    pub comparable: u32,
    /// Comparable sites whose amino acids differ.
    pub differences: u32,
    /// `differences / comparable`.
    pub p: f64,
    /// Kimura correction of `p`.
    pub kimura: Cell,
    /// JTT maximum-likelihood estimate.
    pub jtt: Cell,
    /// Sparse `N_xy` in `PROTEIN_STATES` order: `(x, y, n)` with `n > 0`.
    pub counts: Vec<(u8, u8, u32)>,
    /// `(d, logL)` at `CURVE_POINTS` points over `[0, max(2·d̂, 0.5)]`,
    /// or `[0, D_MAX]` when the pair is saturated.
    pub curve: Vec<(f64, f64)>,
    /// The finite estimate, `None` when saturated.
    pub d_hat: Option<f64>,
    /// `logL` at `d_hat`, `None` when saturated.
    pub logl_hat: Option<f64>,
}

/// Everything the pair panel needs for sequences `i` and `j` of a
/// protein alignment (spec §3.4). Errors: `ModelAlphabetMismatch` for
/// non-protein input, `InvalidExercise` for an out-of-range index, and
/// `InsufficientOverlap` when the pair shares no comparable sites.
pub fn jtt_pair_detail(aln: &Alignment, i: usize, j: usize) -> Result<PairDetail, NeoError> {
    if aln.alphabet != Alphabet::Protein {
        return Err(NeoError::ModelAlphabetMismatch {
            model: DistModel::Jtt.name().to_string(),
            alphabet: aln.alphabet,
        });
    }
    let n = aln.seqs.len();
    if i >= n || j >= n {
        return Err(NeoError::InvalidExercise {
            field: "pair".to_string(),
            msg: format!("pair index out of range for {n} sequences"),
        });
    }
    let (table, comparable, differences) = pair_counts(&aln.seqs[i], &aln.seqs[j]);
    if comparable == 0 {
        return Err(NeoError::InsufficientOverlap {
            a: label(&aln.labels, i),
            b: label(&aln.labels, j),
        });
    }
    Ok(pair_detail_from_counts(
        i,
        j,
        &table,
        comparable,
        differences,
    ))
}

/// `jtt_pair_detail` under a site filter (v1.4b spec §3.1, §6.2 — owner
/// decision 2026-10-30: the pair panel's numbers follow the gap
/// treatment). Only the columns `site_mask` keeps count toward the
/// pair's comparable sites, differences, p and the JTT fit.
///
/// Errors come in the same order as `jtt_pair_detail` — alphabet, then
/// index — followed by the filter's own errors (`NoSitesKept`, an
/// invalid `cutoff_pct`), then `InsufficientOverlap` when the pair has
/// no comparable kept site (never a NaN `p`). `SiteFilter::Pairwise`
/// gives a `PairDetail` bit-identical to `jtt_pair_detail`.
pub fn jtt_pair_detail_filtered(
    aln: &Alignment,
    i: usize,
    j: usize,
    filter: SiteFilter,
) -> Result<PairDetail, NeoError> {
    if aln.alphabet != Alphabet::Protein {
        return Err(NeoError::ModelAlphabetMismatch {
            model: DistModel::Jtt.name().to_string(),
            alphabet: aln.alphabet,
        });
    }
    let n = aln.seqs.len();
    if i >= n || j >= n {
        return Err(NeoError::InvalidExercise {
            field: "pair".to_string(),
            msg: format!("pair index out of range for {n} sequences"),
        });
    }
    let mask = site_mask(aln, filter)?;
    let (table, comparable, differences) =
        pair_counts_weighted(&aln.seqs[i], &aln.seqs[j], &mask.weights);
    if comparable == 0 {
        return Err(NeoError::InsufficientOverlap {
            a: label(&aln.labels, i),
            b: label(&aln.labels, j),
        });
    }
    let comparable = comparable.min(u64::from(u32::MAX)) as u32;
    let differences = differences.min(u64::from(u32::MAX)) as u32;
    Ok(pair_detail_from_counts(
        i,
        j,
        &table,
        comparable,
        differences,
    ))
}

/// The `PairDetail` assembly shared by `jtt_pair_detail` and
/// `jtt_pair_detail_filtered`: the JTT fit, p and Kimura from the
/// counts, the sampled likelihood curve and the sparse count table.
/// `comparable` must be nonzero — callers reject the zero-overlap pair
/// with `InsufficientOverlap`, so `p` can never be NaN.
fn pair_detail_from_counts(
    i: usize,
    j: usize,
    table: &[[u32; 20]; 20],
    comparable: u32,
    differences: u32,
) -> PairDetail {
    let jtt = jtt_ml(table);
    let cells = merge_counts(table);
    let p = f64::from(differences) / f64::from(comparable);
    let kimura = kimura_from_p(p);
    let (d_hat, logl_hat, top) = match jtt {
        Cell::Value(d) => (Some(d), Some(jtt_logl(&cells, d)), (2.0 * d).max(0.5)),
        Cell::Saturated => (None, None, D_MAX),
    };
    let step = top / (CURVE_POINTS - 1) as f64;
    let curve = (0..CURVE_POINTS)
        .map(|k| {
            // Land exactly on the endpoints so the range is exact.
            let d = if k == CURVE_POINTS - 1 {
                top
            } else {
                step * k as f64
            };
            (d, jtt_logl(&cells, d))
        })
        .collect();
    let counts: Vec<(u8, u8, u32)> = table
        .iter()
        .enumerate()
        .flat_map(|(x, row)| {
            row.iter()
                .enumerate()
                .filter(|&(_, &n)| n > 0)
                .map(move |(y, &n)| (x as u8, y as u8, n))
        })
        .collect();

    PairDetail {
        a: i,
        b: j,
        comparable,
        differences,
        p,
        kimura,
        jtt,
        counts,
        curve,
        d_hat,
        logl_hat,
    }
}
