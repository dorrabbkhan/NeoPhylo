# MEGA-CC oracle notes (v1.4b Task 2)

Everything below was observed on the conductor machine 2026-10-28 with
`megacc` (MEGA-CC) **12.1.4, build 12261022-x86_64** (`/usr/bin/megacc`).
The `.mao` files use MEGA's **GUI serialization**: `dist_dna_p_complete`
and `dist_dna_p_partial95` are verbatim files produced by the MEGA
Prototype dialog (12261022 build); the other 52 are derived from them with
the same key names, order and sections, changing only the model, data
type, gap value, cutoff and analysis. Each file lists every setting
explicitly and the generator asserts the settings MEGA echoes back
(`!Description` / `*_summary.txt`).

## megacc applies the gap treatment — with GUI-serialized `.mao`

`Gaps/Missing Data` in a GUI-serialized `.mao` **takes effect** in
MEGA-CC 12.1.4 for distance estimation and for distance-based tree
inference (NJ, UPGMA):

- 3-taxon 10-site control with one gapped column: `Complete deletion`
  reports `No. of Sites = 9` and a–b = 0.11111111; `Pairwise deletion`
  reports 10.
- `inputs/jc8_gaps.fasta` (500 sites, 135 gapped columns): `Complete
  deletion` and `Partial deletion` at 95% report `No. of Sites = 365`
  under `dist`, `nj` and `upgma`; `Pairwise deletion` reports 500. The
  NJ and UPGMA trees also differ between treatments.
- Protein behaves the same: a 6-taxon 40-site alignment with gapped/X
  columns reports 38 sites under `complete`/`partial95` vs 40 under
  `pairwise` for `dist`, `nj` and `upgma`.
- `Test of Phylogeny = None`, `Statistical Method = Neighbor-joining` /
  `UPGMA`, every model and `datatype = snProtein` all bind too: NJ and
  UPGMA produce different trees on a non-ultrametric input, each model
  gives different numbers from p-distance on a divergent input, and
  protein analyses run under the amino-acid models.

**History:** an earlier round used hand-written `.mao` files whose key
was `Gaps/Missing Data Treatment`. Those files are echoed verbatim but
**silently ignored** — an all-gap control still produced a distance
matrix under `Complete deletion`, and pairwise/complete/partial runs were
byte-identical. Only GUI-serialized `.mao` files are valid; that is why
`generate_mega.sh` derives every file from the two GUI prototypes.

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
  (`1,500`); the generator strips commas. It reports the sites left after
  the declared gap treatment, which is how the partial-95 boundary is
  visible (`gaps_boundary`: 1,000 → 999 under partial95, → 998 under
  complete).

## Defaults (prototyper)

- Default gap treatment: MEGA's UI default is pairwise deletion (all
  documentation and .mao examples use it; nothing in the binary suggests
  otherwise). The sandbox default stays `Pairwise`.
- Default site-coverage cutoff: **95%**, MEGA's well-known default for
  partial deletion and the value the plan fixes anyway. The binary
  carries the caption "The partial deletion option was applied to
  eliminate all positions with less than %d%% site coverage".

## Partial cutoff boundary: `>=` (observed from MEGA's output)

`gaps_boundary.fasta` (20 × 1,000; long enough that NJ/UPGMA have no tied
joins — `generate.R` asserts this for every `inputs/*.fasta`) puts a
column at exactly 19/20 = 95% coverage and one at 18/20 = 90%. MEGA
itself reports:

- `Pairwise deletion`: `No. of Sites = 1,000`
- `Partial deletion`, cutoff 95: `No. of Sites = 999` — the 95% column
  is **kept**, so the comparison is `present*100 >= cutoff_pct*n`.
- `Complete deletion`: `No. of Sites = 998`

The same `>=` boundary shows on protein: a 20-taxon 60-site alignment
with a 19/20 (95%) column, an 18/20 (90%) column and a 19/20
X-containing column reports 59 sites under `partial95` vs 57 under
`complete` — the 95% columns are kept and `X` counts as missing for
coverage. The two documentary sources agree: the binary's caption
("less than %d%% site coverage" is removed) and
`Partial-Deletion_Option.htm` ("a site is removed if it has a higher
percentage of ambiguous sites than is specified" → kept iff
`present% >= cutoff`).

## Missing characters (per treatment)

Under **pairwise deletion**, MEGA deletes `-`, `?`, `N` and IUPAC
ambiguities (`R`, `Y`, …) per pair — verified: `a=AAAACCCC` vs
`b=AANACGCC` gives 1/7 = 0.14285714, and `c=ARNAYYCC` contributes only
4 comparable sites against either. This matches the engine's `is_base`
(A/C/G/T) and `protein_index` (20 standard states) exactly, so the same
rule drives the generator's independent kept-site check for
`complete`/`partial95`: `-`, `?`, `N`, IUPAC ambiguities and protein `X`
all count as missing for site coverage. `jc8_gaps.fasta` contains `N`;
under every treatment those columns behave as missing data (pairwise:
excluded per pair; complete/partial95: counted as missing for coverage
and removal).

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
- On `jc7_long.fasta` and `gaps_boundary.fasta` distance runs, megacc
  prints `EAccessViolation` and exits 1 **after** the `.meg` and summary
  are fully written (reproducible on every model and filter; NJ/UPGMA on
  the same data exit 0). The generator warns but continues only when the
  summary is clean and the expected output exists and parses completely
  (cell count checked).
- `megacc -a file.mao -d data.(fasta|meg) -o outbase` writes
  `outbase.meg` (distances) or `outbase.nwk` (trees) plus
  `outbase_summary.txt`. Errors appear at the bottom of the summary as
  `;	Error: ...`; the generator fails on any such line and on a missing
  output. Without `ppDistEst = true` a distance `.mao` fails with
  "Unable to recognize type of Analysis".
- `.mao` echo is verbatim text, not a validated readback (unrecognized
  values are echoed too) — which is why the generator also asserts the
  output's `No. of Sites` equals an independently computed kept-site
  count and compares numbers itself.
