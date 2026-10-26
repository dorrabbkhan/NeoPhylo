//! F84 and PHYLIP "Kimura 2-parameter" distances (v1.4 spec §3.1).
//!
//! Faithful ports of `dnadist`'s maximum-likelihood solves in PHYLIP
//! 3.697 (`src/dnadist.c` `makev`, `src/seq.c` `getbasefreqs`), not the
//! textbook closed forms. dnadist's Kimura distance is an ML estimate at
//! a user-fixed transition/transversion ratio with equal base
//! frequencies, so it deliberately differs from K80's closed form
//! (spec §3.3). F84 is the same kind of solve with empirical base
//! frequencies and dnadist's default ratio 2.0.
//!
//! Where dnadist reports an inestimable distance as -1.0 ("DIFFERENCE
//! ... TOO LARGE TO ESTIMATE DISTANCE"), these functions return
//! `Cell::Saturated` (v1 spec §4.2), matching the existing K80 branch.

use libm::exp;

use crate::dist::Cell;
use crate::seq::Alignment;

/// `iterationsd` and the step tolerance of `makev`'s hill-climbing loop.
const ITERATIONSD: u32 = 100;
const STEP_EPS: f64 = 0.0000002;
/// dnadist's default transition/transversion ratio (menu option T).
const TTRATIO: f64 = 2.0;

/// A, C, G, T index of a concrete base; `None` for anything else.
pub(crate) fn base_index(b: u8) -> Option<usize> {
    match b {
        b'A' => Some(0),
        b'C' => Some(1),
        b'G' => Some(2),
        b'T' => Some(3),
        _ => None,
    }
}

/// Everything `getbasefreqs` derives from the base frequencies and the
/// transition/transversion ratio: the within-class conditional
/// frequencies and (xv, fracchange) used by `makev`.
pub(crate) struct RatioParams {
    pub freqar: f64,
    pub freqcy: f64,
    pub freqgr: f64,
    pub freqty: f64,
    pub xv: f64,
    pub fracchange: f64,
}

pub(crate) fn ratio_params(f: &[f64; 4], ttratio: f64) -> RatioParams {
    let (a, c, g, t) = (f[0], f[1], f[2], f[3]);
    let freqr = a + g;
    let freqy = c + t;
    // Conditional frequencies. dnadist divides by freqr/freqy unguarded
    // (a whole missing class gives NaN); 0 keeps the result finite and
    // is harmless because a missing class cannot appear in the data.
    let freqar = if freqr > 0.0 { a / freqr } else { 0.0 };
    let freqgr = if freqr > 0.0 { g / freqr } else { 0.0 };
    let freqcy = if freqy > 0.0 { c / freqy } else { 0.0 };
    let freqty = if freqy > 0.0 { t / freqy } else { 0.0 };
    let aa = ttratio * freqr * freqy - a * g - c * t;
    let bb = a * freqgr + c * freqty;
    let xi = if aa + bb > 0.0 { aa / (aa + bb) } else { -1.0 };
    // dnadist warns "This transition/transversion ratio is impossible
    // with these base frequencies!" and resets to the smallest feasible
    // ratio (xi = 0, xv = 1). For equal frequencies that floor is 0.5.
    let (xi, xv) = if xi < 0.0 { (0.0, 1.0) } else { (xi, 1.0 - xi) };
    // getbasefreqs's own floor: each non-positive frequency becomes 1e-6
    // for the fracchange term only (freqar & friends keep raw values).
    let cl = f.map(|x| if x <= 0.0 { 1e-6 } else { x });
    let fracchange = xi * (2.0 * cl[0] * freqgr + 2.0 * cl[1] * freqty)
        + xv * (1.0 - cl[0] * cl[0] - cl[1] * cl[1] - cl[2] * cl[2] - cl[3] * cl[3]);
    RatioParams {
        freqar,
        freqcy,
        freqgr,
        freqty,
        xv,
        fracchange,
    }
}

/// `dnadist_empiricalfreqs`: for unambiguous data its 8 EM iterations
/// reduce to counting each A/C/G/T once per site per sequence, weighted
/// by column. There is no pairwise deletion here — every sequence
/// contributes every site it covers. Returns raw frequencies; a dataset
/// with no concrete bases gets equal frequencies (every pair will fail
/// `InsufficientOverlap` before the value matters).
fn empirical_freqs(aln: &Alignment, w: &[u32]) -> [f64; 4] {
    let mut c = [0.0; 4];
    let mut total = 0.0;
    for seq in &aln.seqs {
        for (k, &b) in seq.iter().enumerate() {
            if let Some(i) = base_index(b) {
                let wt = f64::from(w.get(k).copied().unwrap_or(0));
                c[i] += wt;
                total += wt;
            }
        }
    }
    if total <= 0.0 {
        return [0.25; 4];
    }
    c.map(|x| x / total)
}

/// The `getinput` floor: a frequency below 1e-8 is set to 1e-6 and the
/// other three rescaled by 0.999999 (not renormalized), applied in
/// A, C, G, T order. This is what `makev`'s per-site terms see.
fn clamp_freqs(mut f: [f64; 4]) -> [f64; 4] {
    for i in 0..4 {
        if f[i] < 1e-8 {
            f[i] = 1e-6;
            for (j, fj) in f.iter_mut().enumerate() {
                if j != i {
                    *fj *= 0.999999;
                }
            }
        }
    }
    f
}

/// Per-alignment constants for the F84 solve: the clamped empirical
/// frequencies `makev` multiplies into its per-site products, and the
/// ratio parameters at dnadist's default T = 2.0.
pub(crate) struct F84Ctx {
    f: [f64; 4],
    rp: RatioParams,
}

pub(crate) fn f84_context(aln: &Alignment, w: &[u32]) -> F84Ctx {
    let raw = empirical_freqs(aln, w);
    F84Ctx {
        f: clamp_freqs(raw),
        rp: ratio_params(&raw, TTRATIO),
    }
}

/// `prod2` of `makev`: pi_x times the within-class conditional
/// frequency of y, when x and y share a class, else 0.
fn prod2(x: usize, y: usize, f: &[f64; 4], rp: &RatioParams) -> f64 {
    match (x, y) {
        (0 | 2, 0) => f[x] * rp.freqar,
        (0 | 2, 2) => f[x] * rp.freqgr,
        (1 | 3, 1) => f[x] * rp.freqcy,
        (1 | 3, 3) => f[x] * rp.freqty,
        _ => 0.0,
    }
}

/// `makev`'s non-quick branch (F84, one rate category): maximize the
/// per-site log-likelihood in `tt` by the same fixed-step hill climb
/// dnadist uses, then scale by `fracchange`. `tab` is the pair's
/// weighted 4×4 pattern counts.
pub(crate) fn f84_distance(ctx: &F84Ctx, tab: &[u64; 16]) -> Cell {
    let mut tt: f64 = 0.1;
    let mut delta: f64 = 0.1;
    let mut it = 1;
    while it < ITERATIONSD && delta.abs() > STEP_EPS {
        let mut slope = 0.0;
        if tt > 0.0 {
            let z1 = exp(-ctx.rp.xv * tt);
            let z1zz = exp(-tt);
            let y1 = 1.0 - z1;
            let z1yy = z1 - z1zz;
            let z1xv = z1 * ctx.rp.xv;
            for x in 0..4 {
                for y in 0..4 {
                    let n = tab[x * 4 + y] as f64;
                    if n == 0.0 {
                        continue;
                    }
                    let aa = if x == y { ctx.f[x] } else { 0.0 };
                    let bb = prod2(x, y, &ctx.f, &ctx.rp);
                    let cc = ctx.f[x] * ctx.f[y];
                    slope += n * (z1zz * (bb - aa) + z1xv * (cc - bb))
                        / (aa * z1zz + bb * z1yy + cc * y1);
                }
            }
        }
        delta = if slope < 0.0 {
            -delta.abs() / 2.0
        } else {
            delta.abs()
        };
        tt += delta;
        it += 1;
    }
    if delta >= 0.1 {
        Cell::Saturated
    } else {
        Cell::Value(tt * ctx.rp.fracchange)
    }
}

/// `makev`'s `kimquick` branch (equal frequencies, no rate variation):
/// maximize the log-likelihood of the (identical, transition,
/// transversion) counts in `tt`, then scale by `fracchange`.
pub(crate) fn k2p_distance(n1: f64, n2: f64, n3: f64, rp: &RatioParams) -> Cell {
    let mut delta: f64 = 0.0;
    let mut tt = 1.0 - n1 / (n1 + n2 + n3);
    if tt > 0.0 {
        delta = 0.1;
        tt = delta;
        let mut it = 0;
        while delta.abs() > STEP_EPS && it < ITERATIONSD {
            it += 1;
            let p1 = exp(-tt);
            let z1 = exp(-rp.xv * tt);
            let p2 = z1 - p1;
            let p3 = 1.0 - z1;
            let q1 = p1 + p2 / 2.0 + p3 / 4.0;
            let q2 = p2 / 2.0 + p3 / 4.0;
            let q3 = p3 / 2.0;
            let slope = 0.5 * p1 * (n2 / q2 - n1 / q1)
                + 0.25 * rp.xv * z1 * (n3 * 2.0 / q3 - n2 / q2 - n1 / q1);
            delta = if slope < 0.0 {
                -delta.abs() / 2.0
            } else {
                delta.abs()
            };
            tt += delta;
        }
    }
    if delta >= 0.1 {
        Cell::Saturated
    } else {
        Cell::Value(tt * rp.fracchange)
    }
}
