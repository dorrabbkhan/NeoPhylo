#!/usr/bin/env python3
"""Generate crates/neophylo-core/src/model/jtt_constants.rs from data/models/jtt.dat.

Offline constants generator (v1.1 spec §3.3). Requires numpy; not a runtime
dependency. `jtt.dat` holds the JTT spectral decomposition embedded in PHYLIP
3.697's `protdist.c` (E. Tillier): 20 eigenvalues followed by a 20x20 spectral
coefficient matrix C, rows eigenvector-indexed and columns in
ARNDCQEGHILKMFPSTWYV order. C's row 0 is the equilibrium frequency vector pi
and C[m][a] = sqrt(pi_a) V[a,m], so the engine evaluates the joint site
probability pi_x P_xy(t) = sum_m C[m,x] C[m,y] exp(lam_m t) in exactly the
arithmetic protdist performs. The file's trailing commentary is ignored.

(An exchangeabilities-plus-frequencies file in PAML jones.dat layout — 190
lower-triangle values then 20 frequencies — is also accepted and converted
by eigendecomposition, but the committed data file is the spectral one: only
it reproduces protdist's printed distances, which the v1.1 fixtures test.)

  python3 scripts/gen_models.py           regenerate jtt_constants.rs
  python3 scripts/gen_models.py --check   verify the committed file instead:
                                          fail if the embedded input SHA-256
                                          differs from jtt.dat's, or if any
                                          regenerated constant differs from
                                          the committed value (rtol 1e-12,
                                          atol 1e-14 for the ~0 eigenvalue).

Math (spectral input): pi = C[0]/sum(C[0]); EIGVALS = the stored eigenvalues;
U_INV = C verbatim; U[i,k] = C[k,i]/pi_i. Then pi_a * P_ab(t) equals
sum_m C[m,a] C[m,b] exp(lam_m t) exactly as protdist computes it.

Math (S+pi input): Q_ij = S_ij * pi_j (i != j); diagonal = -row sum; Q is
scaled so -pi . diag(Q) = 1 (expected substitutions per site). The symmetric
form A = Pi^{1/2} Q Pi^{-1/2} is eigendecomposed (numpy.linalg.eigh) and the
constants emitted are U = Pi^{-1/2} V and U^{-1} = V^T Pi^{1/2}.
"""

import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DAT = ROOT / "data" / "models" / "jtt.dat"
OUT = ROOT / "crates" / "neophylo-core" / "src" / "model" / "jtt_constants.rs"
N = 20

RTOL = 1e-12
ATOL = 1e-14  # regenerated ~0 eigenvalue is only stable to ~1e-16


def tokens_of(text: str) -> list[str]:
    """Whitespace tokens up to the '//' end-of-data marker."""
    toks: list[str] = []
    for line in text.splitlines():
        if "//" in line:  # PAML's "end of file" marker; the rest is commentary
            break
        toks += line.split()
    return toks


def parse_dat(text: str) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray, str]:
    """Parse the data file into (pi, eigvals, U, U_inv, source_label).

    Two layouts are recognized by token count:
      420 tokens — 20 eigenvalues then the 20x20 spectral coefficient
          matrix C (row-major, the protdist embedded form). Emitted
          verbatim: U_inv = C, U[i,k] = C[k,i]/pi_i, pi = C[0] renormalized.
      210 tokens — PAML jones.dat layout: 190 lower-triangle
          exchangeabilities then 20 frequencies; decomposed with eigh.
    """
    toks = tokens_of(text)
    n_tri = N * (N - 1) // 2
    if len(toks) == N + N * N:
        lam = np.array([float(t) for t in toks[:N]])
        c = np.array([float(t) for t in toks[N:]]).reshape(N, N)
        pi = c[0] / c[0].sum()
        u = np.array([[c[k, i] / pi[i] for k in range(N)] for i in range(N)])
        return pi, lam, u, c.copy(), "spectral"
    if len(toks) == n_tri + N:
        tri = [float(t) for t in toks[:n_tri]]
        pi = np.array([float(t) for t in toks[n_tri:]])
        s = np.zeros((N, N))
        i = 0
        for r in range(1, N):
            for col in range(r):
                s[r, col] = s[col, r] = tri[i]
                i += 1
        # The published frequencies sum to ~1.000001; renormalize so the
        # engine's pi is exact.
        pi = pi / pi.sum()
        lam, u, u_inv = build(s, pi)
        return pi, lam, u, u_inv, "exchangeabilities"
    raise ValueError(f"expected {N + N * N} (spectral) or {n_tri + N} (S+pi) tokens, got {len(toks)}")


def build(s: np.ndarray, pi: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """(eigvals, U, U_inv) for Q normalized to -pi . diag(Q) = 1."""
    q = s * pi[None, :]
    np.fill_diagonal(q, -q.sum(axis=1))
    q /= -(pi * np.diag(q)).sum()
    sq = np.sqrt(pi)
    a = np.diag(sq) @ q @ np.diag(1.0 / sq)
    lam, v = np.linalg.eigh(a)
    u = np.diag(1.0 / sq) @ v
    u_inv = v.T @ np.diag(sq)
    return lam, u, u_inv


def f64_lit(x: float) -> str:
    """17-significant-digit Rust f64 literal that also parses as JSON."""
    lit = f"{x:.17g}"
    if not any(c in lit for c in ".eEnN"):  # n covers nan/inf (never emitted)
        lit += ".0"
    return lit


def emit(sha: str, lam: np.ndarray, u: np.ndarray, u_inv: np.ndarray, pi: np.ndarray, source: str) -> str:
    def arr1(v: np.ndarray) -> str:
        return "[" + ", ".join(f64_lit(x) for x in v) + "]"

    def arr2(m: np.ndarray) -> str:
        rows = ",\n    ".join(arr1(row) for row in m)
        return f"[\n    {rows}\n]"

    return f"""\
//! GENERATED by scripts/gen_models.py from data/models/jtt.dat
//! ({source}, sha256 {sha}).
//! Do not edit by hand; regenerate with `python3 scripts/gen_models.py`.
//! CI verifies this file with `python3 scripts/gen_models.py --check`.
//!
//! Layout (v1.1 spec §3.3): equilibrium frequencies FREQS, and the
//! spectral decomposition U * diag(EIGVALS) * U_INV giving
//! pi_i * P_ij(t) = sum_k C[k,i] C[k,j] exp(EIGVALS[k] t) with C = U_INV
//! and U[i,k] = C[k,i]/pi_i, in amino-acid order ARNDCQEGHILKMFPSTWYV.

// Constants are emitted at 17 significant digits for exact f64 round-trip;
// the precision is deliberate, not excessive.
#![allow(clippy::excessive_precision)]

/// Stationary frequencies pi.
pub const FREQS: [f64; 20] = {arr1(pi)};

/// Eigenvalues of the symmetric form Pi^(1/2) Q Pi^(-1/2).
pub const EIGVALS: [f64; 20] = {arr1(lam)};

/// U[i,k] = C[k,i]/pi_i (spectral-coefficient rows scaled by 1/pi).
pub const U: [[f64; 20]; 20] = {arr2(u)};

/// U_INV = C, the spectral coefficient matrix; pi_a * P_ab(t) =
/// sum_k C[k,a] C[k,b] exp(lam_k t).
pub const U_INV: [[f64; 20]; 20] = {arr2(u_inv)};
"""


def committed() -> tuple[str, dict[str, np.ndarray]]:
    """Parse the committed generated file: embedded sha256 + its constants."""
    text = OUT.read_text()
    m = re.search(r"sha256 ([0-9a-f]{64})", text)
    if not m:
        raise ValueError("no sha256 in generated header")
    sha = m.group(1)
    consts = {}
    for name in ("FREQS", "EIGVALS", "U", "U_INV"):
        m = re.search(rf"pub const {name}[^=]*= (\[.*?\]);", text, re.S)
        if not m:
            raise ValueError(f"constant {name} not found")
        # rustfmt reflows the file and adds trailing commas; tolerate them.
        literal = re.sub(r",\s*([}\]])", r"\1", m.group(1))
        consts[name] = np.array(json.loads(literal))
    return sha, consts


def main() -> int:
    check = "--check" in sys.argv[1:]
    sha = hashlib.sha256(DAT.read_bytes()).hexdigest()
    pi, lam, u, u_inv, source = parse_dat(DAT.read_text())
    if not check:
        OUT.parent.mkdir(parents=True, exist_ok=True)
        OUT.write_text(emit(sha, lam, u, u_inv, pi, source))
        # Keep `cargo fmt --all --check` green for a regenerated file.
        if shutil.which("rustfmt"):
            subprocess.run(["rustfmt", "--edition", "2021", OUT], check=True)
        print(f"wrote {OUT} (input sha256 {sha[:12]}...)")
        return 0
    old_sha, old = committed()
    if old_sha != sha:
        print(f"FAIL: committed sha256 {old_sha} != jtt.dat {sha}", file=sys.stderr)
        return 1
    new = {"FREQS": pi, "EIGVALS": lam, "U": u, "U_INV": u_inv}
    bad = [
        f"{k}: max |diff| {np.abs(old[k] - new[k]).max():.3g}"
        for k in new
        if not np.allclose(old[k], new[k], rtol=RTOL, atol=ATOL)
    ]
    if bad:
        print("FAIL: constants differ (rtol 1e-12, atol 1e-14): " + "; ".join(bad), file=sys.stderr)
        return 1
    print("jtt_constants.rs matches regeneration")
    return 0


if __name__ == "__main__":
    sys.exit(main())
