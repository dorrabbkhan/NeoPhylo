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
  `{dist,nj,upgma}_{dna,protein}_{model}_{filter}` combination, plus
  `njboot_{dna,protein}_{k2p,jtt,poisson}_{pairwise,complete}.mao` for
  NJ bootstrap (100 replicates). DNA models `p`, `jc69`, `k2p` (MEGA
  names: p-distance, Jukes-Cantor model, Kimura 2-parameter model);
  protein models `p`, `poisson`, `jtt` (p-distance, Poisson model,
  Jones-Taylor-Thornton (JTT) model). Filters `pairwise`, `complete`,
  `partial95` (Partial deletion, 95%; bootstrap runs pairwise and
  complete only). Every setting is written explicitly; no defaults are
  relied on. Bootstrap uses MEGA 12's serialization
  (`Test of Phylogeny = Bootstrap method`, `Approach = Standard
  Bootstrap (slow)`, `Bootstrap Replicates = 100`); the older
  `No. of Bootstrap Replications` key alone is echoed but ignored
  (`../worked/mega-notes.md`).
- `<name>.json` — one per input: every `inputs/*.fasta` (DNA) and
  `inputs/protein/*.fasta` (protein), plus `inputs/gaps_boundary.fasta`.
- `library/<id>.json` — the same shape for each library dataset the MEGA
  handouts use, read from `../web/public/library/<id>.fasta` (the data
  itself is never copied into `fixtures/`). Adds a `bootstrap` block
  (below).
- `roundtrip/<name>.meg` — every `inputs/*.fasta` written in MEGA format
  by `neophylo_core::write_meg` (via `fixtures/tools/write_meg`).
- `roundtrip/<name>.json` — MEGA-CC distances on that `.meg`, same shape
  minus `trees` (`precision` has `distances` only). During generation
  every matrix is asserted equal, cell for cell, to the matrix MEGA
  produced from the FASTA in `<name>.json` (success criterion 4).

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

## `bootstrap` block (library files only)

```json
"bootstrap": { "nj/<model>/<filter>":
               { "replicates": 100,
                 "support": { "<split key>": <percent> } } }
```

- Runs: NJ, 100 replicates, Standard Bootstrap. `primate-mtdna` and
  `16s-rrna` with `K80`; `globins` with `JTT` and `Poisson`; each under
  `pairwise` and `complete`.
- `support` is read from MEGA's **original NJ tree** (the `<out>.nwk`
  BCL labels, printed as proportions like `0.9800` → percent), never
  from the `<out>_consensus.nwk`. Each labelled internal edge is a
  split; the key is the **canonical side — the side that does NOT
  contain the dataset's first label** — as sorted labels joined by `|`,
  the same rule `fixtures/consensus/` uses. Percent is an integer (100
  replicates).
- During generation every split is cross-checked against megacc's
  `-pfc 0.0` partition list: the tree's BCL must equal the partition
  frequency exactly.
- **Not byte-reproducible:** megacc has no seed option, so rerunning the
  generator produces fresh support values (and different internal
  replicate trees). Do not diff bootstrap blocks across runs; the
  generator itself never compares them.
