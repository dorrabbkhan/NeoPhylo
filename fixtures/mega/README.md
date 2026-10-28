# MEGA-CC fixtures (frozen, local only)

Reference outputs produced by **MEGA-CC 12.1.4 (build 12261022-x86_64)**
with the committed `.mao` files in `mao/`. MEGA is closed-source: it is
never installed in CI and `generate_mega.sh` is never called from CI or
the other generators. **Regenerate only locally** by running
`bash fixtures/generate_mega.sh` with `megacc` on `PATH`; the committed
JSON is the oracle. Do not edit the outputs by hand.

## `.mao` serialization (read this first)

The `.mao` files use MEGA's **GUI serialization** — the same key names,
order and sections the MEGA Prototype dialog writes (`Gaps/Missing Data`,
`Labelled Sites` under `[ DataSettings ]`, `Rates among Sites = Uniform
Rates`, …). Only GUI-serialized `.mao` files are valid: hand-written
files using the `Gaps/Missing Data Treatment` key are echoed by megacc
but the treatment is **silently ignored** (evidence:
`../worked/mega-notes.md`). With the correct serialization megacc applies
the declared gap treatment itself — every run gets the unfiltered input,
and the generator asserts MEGA's reported `No. of Sites` against an
independently computed kept-site count for `complete`/`partial95`.

## Layout

- `mao/*.mao` — one file per
  `{dist,nj,upgma}_{dna,protein}_{model}_{filter}` combination. DNA
  models `p`, `jc69`, `k2p` (MEGA names: p-distance, Jukes-Cantor model,
  Kimura 2-parameter model); protein models `p`, `poisson`, `jtt`
  (p-distance, Poisson model, Jones-Taylor-Thornton (JTT) model). Filters
  `pairwise`, `complete`, `partial95` (Partial deletion, 95%). Every
  setting is written explicitly; no defaults are relied on.
- `<name>.json` — one per input: every `inputs/*.fasta` (DNA) and
  `inputs/protein/*.fasta` (protein), plus `inputs/gaps_boundary.fasta`.

## JSON format

```json
{ "generator": { "megacc": "12.1.4 (build 12261022-x86_64)",
                 "mao_sha256": { "<file>.mao": "<sha256 hex>" },
                 "note": "..." },
  "input": "inputs/<file>.fasta",
  "alphabet": "dna" | "protein",
  "precision": { "distances": 8, "branch_lengths": <max decimals seen> },
  "distances": { "<model>/<filter>": { "labels": [...], "matrix": [[...]] } },
  "trees": { "nj/<model>/<filter>": "<newick>",
             "upgma/<model>/<filter>": "<newick>" } }
```

- `<model>` uses the NeoPhylo JSON names `p`, `JC69`, `K80` (DNA) and
  `p`, `Poisson`, `JTT` (protein); `<filter>` is `pairwise`, `complete`
  or `partial95`.
- `matrix` is a full symmetric n×n row-major array expanded from MEGA's
  lower-left printout; the diagonal is `0.0`. Cells MEGA prints as `n/c`
  (not computable — e.g. a pair with no comparable sites, or a saturated
  correction) are `null`. Never a bare `NaN`.
- `precision.distances` is always 8 (MEGA prints `%.8f` cells).
  `precision.branch_lengths` is the **largest** decimal count seen in the
  input's trees — MEGA prints ~16 significant digits and trims trailing
  zeros, so `0.01` and `0.0197306397306397` appear side by side. Compare
  each printed branch length within half an ulp of **its own** decimals,
  not a global value.
- Newicks are verbatim MEGA output. NJ trees are unrooted (basal
  trifurcation); UPGMA trees are rooted and ultrametric.
- `mao_sha256` covers every `.mao` run for that input, so fixture drift
  is detectable.
