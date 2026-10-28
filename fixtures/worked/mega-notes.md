# MEGA-CC oracle notes (v1.4b Task 2)

Everything below was observed on the conductor machine 2026-10-28 with
`megacc` (MEGA-CC) **12.1.4, build 12261022-x86_64** (`/usr/bin/megacc`).
Hand-written `.mao` files were used (no display for the GUI prototyper);
each file lists every setting explicitly and the generator asserts the
settings MEGA echoes back (`!Description` / `*_summary.txt`).

## megacc applies no gap treatment (the big finding)

`Gaps/Missing Data Treatment` in a `.mao` is echoed verbatim in the output
but **has no effect** in MEGA-CC 12.1.4 for distance estimation or for
distance-based tree inference (NJ, UPGMA):

- Identical distance matrices on `inputs/jc8_gaps.fasta` (135 of 500
  columns gapped) under `Pairwise deletion`, `Complete deletion` and
  `Partial deletion` with cutoff 95 — all equal to the pairwise-deletion
  result (e.g. t1–t2 p = 0.19780220 on 455 comparable sites).
- Identical NJ trees under all three treatments.
- **Control:** a 3-taxon 4-site alignment where every column has a gap
  still produced a distance matrix and a tree `(a,b,c);` under `Complete
  deletion` — MEGA's own "All Sites were removed, try partial deletion
  rather than complete" error never fires.
- Every variant tried: both serializations (the MEGA X `Analysis =
  Phylogeny Reconstruction` + `Statistical Method` layout and the MEGA 12
  `Analysis = NJ Phylogeny Reconstruction` layout), `ver` strings matching
  and not matching the build, `Scope` variants, `?` instead of `-`,
  `.meg` instead of FASTA, and every plausible value string. Model and
  all other settings bind fine (K2P output matches hand-computed K80);
  only the gap treatment is ignored.

**Consequence for the fixtures:** `generate_mega.sh` removes the columns
itself — exactly the sites MEGA's documentation says each option removes
(`Complete-Deletion_Option.htm`: "sites containing missing data or
alignment gaps are removed before the analysis begins";
`Partial-Deletion_Option.htm`: a site is removed when its ambiguous
fraction exceeds the cutoff) — and hands the filtered alignment to the
`.mao` that still declares the intended treatment. The numbers are
therefore what MEGA defines the option to compute, verified end-to-end
through MEGA's own pairwise-deletion math. Each JSON's
`generator.mao_sha256` records the `.mao` actually run; the `note` field
carries this caveat.

## Printed precision

- Distance matrices (`.meg`, `DataFormat=LowerLeft`): fixed **8 decimals**
  (`precision.distances: 8`). Non-computable cells print `n/c` — stored
  as JSON `null`, never NaN (see `fixtures/mega/README.md`).
- Newick branch lengths (`.nwk`): up to ~16–18 decimals with **trailing
  zeros trimmed** (e.g. `0.0817745273403937`, `0.01`, `0.0` in one tree).
  `precision.branch_lengths` records the *largest* decimal count seen in
  that input's trees; compare each printed length within half an ulp of
  *its own* decimals — a single global tolerance would be meaningless.
- `No. of Sites` in `!Description` prints with a thousands separator
  (`1,500`); the generator strips commas. It reports the (filtered)
  input's site count, which is how the partial-95 boundary is visible
  (`gaps_boundary`: 100 → 99 sites kept).

## Defaults (prototyper)

The GUI prototyper cannot run here (no display). What is recorded:

- Default gap treatment: MEGA's UI default is pairwise deletion (all
  documentation and .mao examples use it; nothing in the binary suggests
  otherwise). The sandbox default stays `Pairwise`.
- Default site-coverage cutoff: **95%**. Could not be read off the
  prototyper; it is MEGA's well-known default for partial deletion and
  the value the plan fixes anyway. The binary carries the caption
  "The partial deletion option was applied to eliminate all positions
  with less than %d%% site coverage".

## Partial cutoff boundary: `>=` (kept at exactly 95%)

MEGA-CC could not be observed on this (above), but two sources agree on
the comparison direction:

- The binary's caption: partial deletion removes "all positions with
  **less than** %d%% site coverage" → a column at exactly the cutoff is
  kept → `present*100 >= cutoff_pct*n`.
- `Partial-Deletion_Option.htm`: "a site is removed if it has a higher
  percentage of ambiguous sites than is specified" → removed iff
  `missing% > 100 − cutoff` → kept iff `present% >= cutoff`.

`gaps_boundary.fasta` (20 × 1,000; long enough that NJ/UPGMA have no tied
joins — `generate.R` asserts this for every `inputs/*.fasta`) puts a
column at exactly 19/20 = 95% coverage (and one at 18/20 = 90%). Its
`p/partial95` matrix shows the 95% column kept (s01–s02 = 0.05505506 vs
0.05410822 under `p/complete`), so the boundary decision is visible in
committed output.

## Missing characters (per treatment)

Under **pairwise deletion**, MEGA deletes `-`, `?`, `N` and IUPAC
ambiguities (`R`, `Y`, …) per pair — verified: `a=AAAACCCC` vs
`b=AANACGCC` gives 1/7 = 0.14285714, and `c=ARNAYYCC` contributes only
4 comparable sites against either. This matches the engine's `is_base`
(A/C/G/T) and `protein_index` (20 standard states) exactly, so the same
rule drives the generator's pre-filter for `complete`/`partial95`.
`jc8_gaps.fasta` contains `N`; under every treatment those columns behave
as missing data (pairwise: excluded per pair; complete/partial95:
counted as missing for coverage and removal).

## Bootstrap order: sites are removed before resampling

`Partial-Deletion_Option.htm`: "sites are removed **before the analysis
begins**". `Complete-Deletion_Option.htm`: "all such sites are removed
prior to the analysis". The bootstrap replicates are drawn inside the
analysis, so the mask is applied first and resampling happens on the
kept columns — matching Task 3's "filter before resampling" branch.

## JTT verdict: `JttMega` needed

MEGA's JTT is *not* protdist's JTT. Comparing `compute(.., DistModel::Jtt)`
to MEGA's `JTT/pairwise` matrices on all four protein inputs
(throwaway test, since deleted):

| input | max \|diff\| | ours vs MEGA at that cell |
|---|---|---|
| p6_150 | 0.029497 | 3.416355800 vs 3.386859090 |
| p8_250 | 0.003641 | 2.168552149 vs 2.164911620 |
| p10_400 | 0.048638 | 4.921175807 vs 4.872537340 |
| p12_100 | **0.177891** | 7.708440190 vs 7.530548870 |

All far outside half an ulp of 8 decimals. The committed fixtures are the
reference for `JttMega`.

MEGA's estimator (`Dayhoff_and_JTT_Models.htm`): the distance is found
iteratively by maximum likelihood from the observed pair-proportion
matrix F, `d = 2t·Q̄` under the JTT substitution-rate matrix Q; "the
eigen values for the PAM and JTT matrices required in this computation
were obtained from the program source code of PHYLIP version 3.6". So it
is the same family as protdist's estimator but a different implementation
(different optimizer constants / stopping rule) — hence the small but
real divergence.

`Poisson`: manual formula `d = −ln(1 − p)` (`Poisson_Correction_(PC)_distance.htm`),
exactly spec §3.3.

## megacc quirks recorded

- `megacc` writes `$XDG_CONFIG_HOME/megacc`; the generator sets
  `XDG_CONFIG_HOME` to a `mktemp -d` and works in a temp dir — nothing is
  written under `~`.
- On `jc7_long.fasta` distance runs, megacc prints `EAccessViolation` and
  exits 1 **after** the `.meg` and summary are fully written (reproducible
  on every model and filter; NJ/UPGMA on the same data exit 0). The
  generator warns but continues only when the summary is clean and the
  expected output exists and parses completely (cell count checked).
- `megacc -a file.mao -d data.(fasta|meg) -o outbase` writes
  `outbase.meg` (distances) or `outbase.nwk` (trees) plus
  `outbase_summary.txt`. Errors appear at the bottom of the summary as
  `;	Error: ...`; the generator fails on any such line and on a missing
  output. Without `ppDistEst = true` a distance `.mao` fails with
  "Unable to recognize type of Analysis".
- `.mao` echo is verbatim text, not a validated readback (unrecognized
  values are echoed too) — which is why the generator also asserts the
  output's `No. of Sites` equals the filtered site count and compares
  numbers itself.
