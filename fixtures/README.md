# fixtures/ — reference oracle

Reference outputs that the engine's corpus test (`tests/corpus.rs`) and the
worked-example tests replay. **Regenerate only through the scripts below**;
see `AGENTS.md` for the rules.

## Layout

- `inputs/*.fasta` — five committed alignments: 6–12 taxa, 200–2,000 sites.
  `jc8_gaps.fasta` carries `-` gaps and `N`s; `k80_10.fasta` was simulated
  under K80 with κ = 6 so transitions dominate. None has a tied minimum at
  any join (the generator asserts this and fails if one appears).
- `ref/<name>.json` — ape/phangorn output, full precision (`precision: null`).
- `ref/<name>_phylip.json` — PHYLIP 3.697 output for `jc6` and `k80_10`;
  `precision` is the number of printed decimals, so compare within
  `0.5·10^-precision`. PHYLIP has no p-distance, so `distances` has only
  `JC69` and `K80`.
- `worked/*.json` — hand-entered textbook step traces (see below).

## ref/ JSON format

```json
{ "name": "...", "generator": "ape <v> / phangorn <v> | phylip <v>",
  "labels": ["..."], "input": "inputs/x.fasta",
  "distances": { "raw": [[...]], "JC69": [[...]], "K80": [[...]] },
  "nj": { "JC69": "<newick>", "K80": "<newick>" },
  "upgma": { "JC69": "<newick>" },
  "precision": null }
```

`distances` entries are dense n×n row-major arrays of numbers.

## worked/ JSON format

Per-step textbook traces, same field names as `NjStep`/`UpgmaStep`
(spec §4.5). Conventions:

- `matrix`/`distance`/`q` are `{"n": n, "data": [...]}` — `Matrix` row-major.
- `active`/`new_node`/`a`/`b`/`c` hold `NodeId` numbers; `chosen` is the pair
  of **positions** in `active`, `i < j`, lexicographically smallest on ties.
- Actives keep remaining taxa in input order with the new node appended.
- `q`'s diagonal is `0` (unused by the algorithm).
- `new_row` lists distances from the new node to the remaining actives, in
  their `active` order.
- NJ files end with `final_join` (`a`, `b`, `c` are the last three actives in
  order). `step` numbers are 1-based join numbers.

## Regenerating

```sh
Rscript fixtures/generate.R        # ape/phangorn fixtures -> ref/*.json
bash fixtures/generate_phylip.sh   # dnadist + neighbor   -> ref/*_phylip.json
```

or both at once via `FIXTURES=1 ./scripts/check.sh`, which also fails if the
outputs drift from what is committed.

## Tool versions used

ape 5.8.1, phangorn 2.12.1, jsonlite 2.0.0 on R 4.5.2; PHYLIP 3.697
(`dnadist` JC69 via `D D`, Kimura 2-parameter via `D`; `neighbor` NJ default,
`N` toggles UPGMA).
