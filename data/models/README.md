# Substitution model source data

## `jtt.dat` — JTT spectral decomposition (PHYLIP 3.697)

Transcribed verbatim from the arrays `jtteigs` and `jttprobs` embedded in
PHYLIP 3.697's `protdist.c` ("this jtt matrix decomposition due to
Elisabeth Tillier"). The file carries 20 eigenvalues followed by the
20×20 spectral coefficient matrix C (row-major; columns in amino-acid
order `ARNDCQEGHILKMFPSTWYV`); everything after the line
`// this is the end of the file` is commentary ignored by
`scripts/gen_models.py`.

- Source: PHYLIP 3.697 source tarball, `src/protdist.c`
- Retrieved: 2026-10-17
- Upstream: https://phylipweb.github.io/phylip/download/phylip-3.697.tar.gz

`C[0]` is the equilibrium frequency vector π (it sums to ~1.0000005;
the generator renormalizes it), and `C[m][a] = √π_a · V[a,m]` where V is
the eigenvector matrix of the symmetrized rate matrix Π^½QΠ^-½. The
joint site probability is therefore

    π_a · P_ab(t) = Σ_m C[m,a] · C[m,b] · exp(λ_m t)

which is exactly the arithmetic `protdist`'s `predict()` performs, and
which `RateModel::site_prob_derivs` reproduces.

**Why this source (v1.1 Task 6).** PAML's `dat/jones.dat` is a _different_
JTT variant — see Kosiol & Goldman 2005, "Different versions of the
Dayhoff rate matrix", Mol. Biol. Evol. 22:193–199. Its frequencies and
exchangeabilities differ ~1–2% from the matrix PHYLIP decomposed, which
shifts ML pair distances ~0.5% (~2e-3): far beyond the 5e-7 doc and
5e-5 corpus parity tolerances the v1.1 fixtures enforce. Reconstructing
the implied rate matrix from the embedded decomposition and
re-decomposing it loses parity too (~2.3e-6), because the embedded data
itself carries ~1e-7 precision noise (the constants descend from
float32-era values). Shipping the spectral coefficients verbatim is the
only representation that reproduces the oracle to its printed precision;
the previous `jtt.dat` (PAML `dat/jones.dat`, sha256
`f7df96390900e22ee1a3b7d63bec10c227eca8ee5ca5a50b6d1978c7d2c74725`)
remains in git history.

**License:** PHYLIP is distributed free of charge for copying and reuse;
the arrays here are numerical reference data (an eigendecomposition of
the published Jones, Taylor & Thornton 1992 empirical matrix, CABIOS
8:275–282) rather than copied program code — flagged for owner review
like the jones.dat copy before it (v1.1 Task 6, `docs/decisions.md`).
