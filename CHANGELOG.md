# Changelog

All notable changes to NeoPhylo are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses milestone tags (`v1.4.3` = milestone v1.4d).

## [Unreleased]

- Navigation redesign; assignments and grading (in progress)

## [1.4.3] - 2026-11-23 — v1.4d, tree reading

### Added

- Tree-reading exercises on interactive tree drawings: rotate a node, find the
  most recent common ancestor, mark a clade, decide whether two trees show the
  same relationships — every item with an engine-computed accepted answer and
  explanation.
- Four built-in reading lessons addressing documented "tree thinking"
  misconceptions, plus pre/post question sets (forms A and B) an instructor can
  use to measure learning.
- A `?read=<id>` reading area, `#r=` share links, library cards and a header
  entry; reading sets are `.neophylo-reading.json` files the exercise editor
  can author.

## [1.4.2] - 2026-11-18 — v1.4c, matrix input, lesson library and worksheets

### Added

- Distance-matrix input: open a `.meg` or PHYLIP matrix file, or paste/type a
  matrix and go straight to NJ/UPGMA — textbook-style "build the tree from this
  matrix" exercises, including matrix exercises in the editor.
- A lesson library page listing every built-in lesson and lab with learning
  objectives.
- Worksheets for every lesson and lab (in-app companions and pencil-and-paper
  matrix sheets) with engine-computed answer keys behind an "I'm an instructor"
  step.
- An instructor guide with a 50-minute class plan and a 3-hour lab plan.

## [1.4.1] - 2026-11-14 — v1.4b, MEGA companion and data library

### Added

- Four lab handouts mirroring the standard MEGA assignments (JC69 vs K2P, NJ vs
  UPGMA, 100 bootstrap replicates, interpreting support): understand each step
  in NeoPhylo, then reproduce it in MEGA — validated against MEGA-CC as an
  oracle, plus a "Coming from MEGA?" guide.
- MEGA `.meg` sequence-file import and export.
- MEGA's gap treatments: pairwise (default), complete and partial deletion with
  a site-coverage cutoff; removed columns shown in the pair panel.
- The Poisson protein-distance model; p-distance and Poisson match MEGA exactly.
- A curated, bundled-offline data library (globins, cytochrome c, primate mtDNA,
  16S rRNA, a small SARS-CoV-2 gene set) with provenance and licensing.

## [1.4.0] - 2026-10-27 — v1.4, instructor kit and PHYLIP lab packs

### Added

- An exercise editor in the UI: draw or paste a true tree, set the model, seed
  and length, add prompts, preview, share a link — no JSON editing.
- PHYLIP-parity distance models: F84 (`dnadist`'s default) and PHYLIP's Kimura
  2-parameter variant (user-set ratio, default 2.0), validated against
  `dnadist` to its printed precision.
- PHYLIP lab packs replacing the classic sequences (`dnadist` → `neighbor`,
  `protdist` → `neighbor`, `seqboot` → `consense`), each with a handout, the
  settings that match PHYLIP's defaults, and a "what PHYLIP's outfile showed
  you vs what NeoPhylo shows you" note.

## [1.3.0] - 2026-10-25 — v1.3, design system and polish

### Added

- A design system: tokens, a type scale, consistent light and dark themes, and
  presenter font sizes.
- One OFL-licensed bundled font for all tree text, embedded in exported SVGs so
  label placement is identical on every machine and in every viewer.
- Responsive layout: narrow windows and tablets reflow instead of clipping.
- Lesson UX polish: saturation-fix progress feedback, first-run onboarding,
  empty and loading states; KaTeX now lazy-loads.

## [1.2.0] - 2026-10-22 — v1.2, bootstrap, consensus and reference rooting

### Added

- Bootstrapping with visible resampling, support drawn on the original tree, a
  background worker with progress and cancel, and "watch one replicate".
- Strict, majority-rule and extended consensus trees, drawn rooted like the
  reference tools.
- Newick export with support values, consensus Newick, SVG/PNG from the screen
  layout and R scripts mirroring the bootstrap; the `bootstrap-basics` lesson.
- Validated against `consense` (exact), `prop.clades` (exact) and `boot.phylo`
  (within sampling noise).

## [1.1.0] - 2026-10-19 — v1.1, protein support and PHYLIP I/O

### Added

- Protein sequences end to end: alphabet detection, the JTT substitution model
  and JTT distances validated against PHYLIP `protdist`.
- Protein lessons (`protein-models`, `cytochrome-c`) and a pair panel with the
  likelihood curve.
- PHYLIP format reading and writing.

## [1.0.0] - 2026-10-16 — v1.0, the core teaching app

### Added

- Step-through Neighbor-Joining and UPGMA, one join at a time, with the live
  distance or Q matrix, Concept and Math explanation layers, and true-tree
  Robinson–Foulds comparison.
- Simulation of sequence evolution on a known tree under JC69 and K80{κ} with
  seeded, reproducible output; p, JC69 and K80 distances matching PHYLIP
  `dnadist`.
- Guided lessons with prompts and locks, a sandbox for your own alignments,
  shareable `#x=` exercise links, and SVG/PNG/Newick/R exports — all offline in
  the browser.

[Unreleased]: https://github.com/dorrabbkhan/NeoPhylo/compare/v1.4.3...HEAD
[1.4.3]: https://github.com/dorrabbkhan/NeoPhylo/compare/v1.4.2...v1.4.3
[1.4.2]: https://github.com/dorrabbkhan/NeoPhylo/compare/v1.4.1...v1.4.2
[1.4.1]: https://github.com/dorrabbkhan/NeoPhylo/compare/v1.4.0...v1.4.1
[1.4.0]: https://github.com/dorrabbkhan/NeoPhylo/compare/v1.3.0...v1.4.0
[1.3.0]: https://github.com/dorrabbkhan/NeoPhylo/compare/v1.2.0...v1.3.0
[1.2.0]: https://github.com/dorrabbkhan/NeoPhylo/compare/v1.1.0...v1.2.0
[1.1.0]: https://github.com/dorrabbkhan/NeoPhylo/releases/tag/v1.1.0
[1.0.0]: https://github.com/dorrabbkhan/NeoPhylo/releases
