# NeoPhylo v1 — Design Spec

Status: Draft for review · Date: 2026-10-15 · Intended repo path: `docs/superpowers/specs/2026-10-15-neophylo-design.md`

## 1. Purpose

NeoPhylo is a free, browser-based, interactive tool for **learning how phylogenetic trees are built**. Students watch distance-based tree methods work one step at a time on small datasets, with a known "true" tree to check against. It is mathematically validated against established tools so instructors can trust it, and it needs nothing installed.

### 1.1 Why this scope (decision record)

The original blueprint aimed to replace PHYLIP for research. That was dropped because research users have moved to maximum-likelihood and Bayesian tools (IQ-TREE, RAxML-NG, MrBayes, BEAST), and MEGA already fills the "PHYLIP with a GUI" niche. What no existing tool does well is **make the algorithms visible**. That is NeoPhylo's niche.

Because teaching datasets are small (≤50 taxa in step-through), the original performance goals (20k taxa, SIMD, WebGPU, multithreading) do not apply and are deliberately excluded.

### 1.2 Audience

- **Intro undergraduate biology:** concepts, no formulas required.
- **Upper-level and graduate bioinformatics:** formulas with live numbers.
- Both are served by one interface with a global **Concept / Math** toggle.

### 1.3 Success criteria

1. An instructor can share one link, and every student sees the identical exercise in a current browser, on any OS including ChromeOS, without installing anything.
2. Every number shown (distances, Q-values, branch lengths) matches the reference tools within the tolerances in §8.
3. A student can step forward and backward through every join of NJ and UPGMA, and see why each pair was chosen.
4. A student can see a method fail (saturation, a non-clock-like tree under UPGMA) and see why, measured against the true tree.
5. An instructor can author a new exercise by editing a JSON file, without writing code.

## 2. Scope

### 2.1 In v1

- **Simulation:** sequences evolved on a known true tree under JC69 or K80, with a seeded random number generator.
- **Distances:** p-distance, JC69, K80, with explicit saturation handling.
- **Tree methods:** Neighbor-Joining and UPGMA, each producing a full step trace.
- **Comparison:** Robinson–Foulds (RF) distance to the true tree, with mismatched clades highlighted.
- **Modes:** guided lessons (exercise files with predict-then-reveal prompts) and sandbox.
- **Sandbox import:** FASTA alignments and Newick trees.
- **Sharing:** exercise state stored in the URL; no accounts and no server.
- **Export:** tree as SVG, PNG and Newick; an equivalent **R script** (`ape` / `phangorn`).
- **Built-in lessons:** (1) How NJ works; (2) When UPGMA fails; (3) Saturation and distance correction.
- Accessibility (§6.5); works offline after first load.

### 2.2 Planned later (not v1)

- **v1.1:** bootstrap and branch support; Python script export, once a Python library passes the export parity check (§8.6).
- **v2:** parsimony (Fitch) step-through.

### 2.3 Non-goals

- Research-scale data, performance tuning, multithreading, WebGPU.
- Maximum likelihood or Bayesian inference; wrapping IQ-TREE or MAFFT; alignment.
- Protein sequences.
- Accounts, a server-side backend, or LMS integration.
- A desktop app or a Python package.
- Faithful drop-in compatibility with PHYLIP files and menus.

## 3. Architecture

A Cargo workspace (the Rust engine) plus a static web app.

```
neophylo/
├── crates/
│   ├── neophylo-core/      # pure Rust: all science; no wasm/UI deps
│   │   └── src/{seq,sim,dist,tree,newick,algos,compare,error}.rs
│   └── neophylo-wasm/      # thin wasm-bindgen layer, no logic
├── web/                    # React + TypeScript + Vite static site
│   └── src/{engine,layout,views,lessons,export,state}/
├── exercises/              # built-in lesson JSON files
├── fixtures/               # reference outputs + generator scripts (R, PHYLIP)
└── docs/
```

**Rules:**

- `neophylo-core` has no dependencies on wasm, the UI or the clock. Every function is deterministic for a given input and seed.
- `neophylo-wasm` only converts types at the boundary. It uses `serde` with `serde-wasm-bindgen`, and TypeScript types are generated from the Rust structs with `ts-rs`. Hand-written duplicate types are not allowed.
- The wasm build is **single-threaded**: no `rayon` and no `SharedArrayBuffer`, so no special hosting headers are needed. Any static host works, including GitHub Pages.
- **Cross-target determinism:** all math functions in `neophylo-core` (`exp`, `ln`) use the `libm` crate explicitly. Native and wasm builds must produce bit-identical simulations, because shared links depend on it.
- The engine runs on the main thread. A Web Worker is not needed at this scale.

### 3.1 Data flow

```
exercise JSON (true tree, sim spec, analysis spec)
  → sim::simulate        → Alignment
  → dist::compute        → DistanceMatrix (cells may be Saturated)
  → algos::{nj,upgma}    → (Tree, Trace)
  → compare::rf          → RfResult vs true tree
  → UI renders trace step k; export on demand
```

In sandbox mode, an imported FASTA file replaces the simulation step. An imported Newick tree can serve as the "true tree" for simulation.

## 4. Engine (`neophylo-core`)

### 4.1 Sequences (`seq`)

- **Alphabet:** DNA only. Input is case-insensitive; `U` is read as `T`. IUPAC ambiguity codes and `-`/`?` are accepted on import.
- **Imported alignments:** all sequences must be the same length, or the result is `NeoError::UnequalLengths`.
- **Missing data:** pairwise deletion. For each pair, a site is excluded if either base is not A, C, G or T. If a pair has zero comparable sites, the result is `NeoError::InsufficientOverlap`. The UI states this rule on screen.
- **Limits:** at most 200 taxa (`NeoError::TooManyTaxa`) and 100,000 sites for import.

### 4.2 Simulation (`sim`)

**Input:**

- a rooted or unrooted true tree with branch lengths (in expected substitutions per site)
- the model, `JC69` or `K80 { kappa }`
- `length`: the engine accepts 10–100,000 sites; the UI and exercise files allow 10–10,000
- `seed: u64`

**RNG:** `rand_chacha::ChaCha8Rng` seeded from `seed`.

**Consumption order (fixed, so results are reproducible):**

1. The root sequence is drawn first, sites in order, each uniform over A/C/G/T.
2. Then branches are visited in preorder, children in stored order, sites in order, with one uniform draw per site per branch.

**Transition probabilities** for a branch of length d:

- JC69: P(same) = ¼ + ¾·e^(−4d/3); each of the 3 other bases = ¼ − ¼·e^(−4d/3).
- K80:
  - P(transition) = ¼ + ¼·e^(−4d/(κ+2)) − ½·e^(−2d(κ+1)/(κ+2))
  - P(each transversion) = ¼ − ¼·e^(−4d/(κ+2))
  - P(same) = 1 − P(transition) − 2·P(each transversion)

**Sampling:** outcomes are ordered [same, transition, transversion targets in alphabetical order], and the uniform draw is compared against the cumulative probabilities. The tip sequences, ordered by tip label in input order, form the output alignment.

### 4.3 Distances (`dist`)

Each cell of the output matrix is `Cell::Value(f64)` or `Cell::Saturated`. The matrix is symmetric with a zero diagonal.

| Model | Formula                              | Saturated when               |
| ----- | ------------------------------------ | ---------------------------- |
| p     | p = differences / comparable sites   | never                        |
| JC69  | d = −¾ ln(1 − 4p/3)                  | p ≥ 0.75                     |
| K80   | d = −½ ln(1 − 2P − Q) − ¼ ln(1 − 2Q) | 1 − 2P − Q ≤ 0 or 1 − 2Q ≤ 0 |

For K80, P is the proportion of transitions and Q the proportion of transversions.

### 4.4 Trees (`tree`, `newick`)

**Structure:** an arena of nodes (`NodeId(u32)`), each with a parent and an ordered list of children. A `rooted: bool` flag marks the tree; unrooted trees are stored with an arbitrary internal root of degree 3.

**Attributes:**

- **Node attributes:** label.
- **Branch attributes:** stored separately, keyed by the child `NodeId`. In v1 this is `length`; v1.1 adds support values.
- This separation is mandatory, so rerooting cannot misplace support values (Czech et al., _MBE_ 2017).

**Newick:**

- Reading supports quoted labels, branch lengths, internal labels, and comments (ignored).
- Writing is lossless for labels and lengths.
- Malformed input gives `NeoError::Parse { line, col, msg }`.

### 4.5 Algorithms (`algos`)

Both algorithms return `(Tree, Trace)` and refuse a matrix with any `Saturated` cell, returning `NeoError::SaturatedMatrix { cells }`.

**Index and tie-break rule (shared):**

- Active clusters are indexed with the original taxa first, in input order, and new nodes appended.
- A tie is broken by choosing the pair with the lowest (i, j) in lexicographic order, with i < j.
- The step is marked `tie: true`.

**Neighbor-Joining (Saitou & Nei; Studier & Keppler formulation).** Each join, with n active nodes:

1. Compute R_i = Σ_k d(i,k).
2. Compute Q(i,j) = (n−2)·d(i,j) − R_i − R_j, and choose the pair (i,j) that minimizes Q.
3. Set the branch lengths to the new node u:
   - δ(i,u) = d(i,j)/2 + (R_i − R_j) / (2(n−2))
   - δ(j,u) = d(i,j) − δ(i,u)
4. Compute distances to u: d(u,k) = (d(i,k) + d(j,k) − d(i,j)) / 2.
5. Stop when 3 nodes a, b, c remain. Join them to a central node with:
   - l_a = (d_ab + d_ac − d_bc)/2
   - l_b = (d_ab + d_bc − d_ac)/2
   - l_c = (d_ac + d_bc − d_ab)/2

   This final step is recorded in the trace.

6. The output is unrooted. Negative lengths are kept as computed; clamping is display-only (§6.3).

**UPGMA:**

- Choose the pair with minimal d.
- Merge into a cluster with height h = d(i,j)/2 and size s_i + s_j. Each child's branch length is h minus the child's height.
- Distances to the new cluster are size-weighted averages.
- The output is rooted and ultrametric.

**Trace:** one record per join. Matrices are row-major `Vec<f64>` with an index-to-label map.

```rust
struct NjStep {
    step: u32,
    active: Vec<NodeId>,
    distance: Matrix,
    r: Vec<f64>,
    q: Matrix,
    chosen: (usize, usize),
    tie: bool,
    len_i: f64,
    len_j: f64,
    new_node: NodeId,
    new_row: Vec<f64>,
}
struct NjFinal { a: NodeId, b: NodeId, c: NodeId, la: f64, lb: f64, lc: f64 }
struct UpgmaStep {
    step: u32,
    active: Vec<NodeId>,
    distance: Matrix,
    sizes: Vec<u32>,
    chosen: (usize, usize),
    tie: bool,
    height: f64,
    len_i: f64,
    len_j: f64,
    new_node: NodeId,
    new_row: Vec<f64>,
}
```

### 4.6 Comparison (`compare`)

Comparison uses unrooted Robinson–Foulds distance over bipartitions, so it works for both NJ and UPGMA output. It returns `{ rf, max_rf, normalized, missing_in_inferred: Vec<Split>, extra_in_inferred: Vec<Split> }`. Both trees must have the same label set, or the result is `NeoError::LabelMismatch`.

### 4.7 Errors

`NeoError` is a single enum:

- `Parse`, `UnequalLengths`, `UnsupportedCharacter`
- `InsufficientOverlap`, `TooManyTaxa`, `SaturatedMatrix`
- `LabelMismatch`, `InvalidExercise`

It serializes to a TypeScript union type with one case per variant.

**The engine must never panic on any input.** Panics are treated as bugs, the parsers are fuzzed (`cargo-fuzz`), and `console_error_panic_hook` is enabled in development builds only.

## 5. wasm boundary (`neophylo-wasm`)

The exported functions take and return `serde` types:

- `simulate(spec) -> Result<Alignment>`
- `parse_fasta(text) -> Result<Alignment>`
- `parse_newick(text) -> Result<Tree>`
- `write_newick(tree) -> String`
- `distances(alignment, model) -> Result<DistanceMatrix>`
- `build_tree(matrix, method) -> Result<{ tree, trace }>`
- `compare(a, b) -> Result<RfResult>`

**Budget:** the wasm bundle stays under 1 MB gzipped.

## 6. Web app

**Stack:**

- React 19, TypeScript in strict mode, Vite.
- KaTeX for formulas; SVG rendering throughout.
- `vite-plugin-pwa` for offline use after first load.

**Supported browsers:** the last two versions of Chrome, Edge, Firefox and Safari, including ChromeOS.

### 6.1 Layout

```
┌───────────────┬──────────────────────────────┬───────────────────┐
│ Controls      │  True tree  │  Inferred tree │ Explanation       │
│               ├──────────────────────────────┤ [Concept | Math]  │
│               │ Distance / Q matrix heatmap  │                   │
├───────────────┴──────────────────────────────┴───────────────────┤
│ ◀ prev  ▶ next  ⏵ play  ──●──── step k of N        RF = x / max  │
└──────────────────────────────────────────────────────────────────┘
```

**Tree layout:** pure TypeScript functions in `web/src/layout`, for rectangular phylograms and cladograms. The functions are unit-tested and separate from rendering. The same layout feeds both on-screen SVG and export.

### 6.2 Interaction

**Stepping:**

- Steps are controlled by buttons, the ← and → keys, or a slider.
- All panels stay in sync with step k.
- Hovering a matrix cell highlights both taxa in the trees, and the chosen pair is emphasized in every view.

**Explanation panel:**

- Both layers are rendered from the same trace record.
- The **Concept** layer is plain-language text per step type.
- The **Math** layer shows the step's formulas with live values plugged in.
- The toggle is global and remembered for the session.

**Guided lessons:**

- A lesson may pause at a given step with a predict-then-reveal prompt ("Which pair joins next?"). The student clicks a matrix cell or a pair, then the answer is revealed with an explanation.
- Lessons may lock controls.

**Sandbox:** all controls are unlocked, and FASTA and Newick can be imported.

### 6.3 Teaching states (not errors)

- **Saturated cells** are hatched and labeled "cannot estimate." Tree building is blocked with an explanation and suggested fixes: longer sequences, shorter branches, or a different correction. A small chart shows p against true distance, with the JC69 curve.
- **Negative branch lengths** are drawn with a distinct style and label. A "set to zero" display toggle is available, and the Math layer explains why they occur. The trace is never altered.
- **Ties** are announced in the explanation panel.
- **Zero-length branches** are allowed and labeled.

### 6.4 State and sharing

**URL contents:**

- A built-in exercise uses `?lesson=<id>` plus overrides in the query string. A custom exercise is compressed JSON in the URL fragment (`#x=`), so it is never sent to a server.
- The current step and the Concept/Math mode are included.
- The state carries `schema_version`. Older versions are converted on load; invalid state shows a friendly message and loads the default lesson.

**UI error boundary:** offers "copy link to this state" for bug reports.

### 6.5 Accessibility

- Full keyboard operation.
- A colorblind-safe palette, with meaning never carried by color alone (hatching, labels, line styles).
- SVG elements carry accessible names, and the explanation text is readable by screen readers.
- Automated axe checks run in CI.

### 6.6 Export

- The tree as SVG, PNG (rendered from the SVG) or Newick.
- An **R script** containing:
  - the alignment embedded as FASTA text
  - `ape::dist.dna(model = "raw" | "JC69" | "K80")`
  - `ape::nj()` or `phangorn::upgma()`
  - a printout of the resulting tree

## 7. Exercise file format

```json
{
  "schema_version": 1,
  "id": "nj-basics",
  "title": "How Neighbor-Joining works",
  "true_tree": "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
  "sim": { "model": "JC69", "length": 1000, "seed": 42 },
  "analysis": { "correction": "JC69", "method": "NJ" },
  "locked": ["sim.model", "analysis.method"],
  "prompts": [
    {
      "at_step": 1,
      "type": "predict_pair",
      "concept": "Which two taxa will join first?",
      "math": "Find the minimum Q(i,j)."
    },
    { "at_step": 3, "type": "note", "concept": "…", "math": "…" }
  ]
}
```

**Model fields:**

- `sim.model` is `"JC69"` or `"K80"`, plus `kappa` for K80.
- `analysis.correction` is `"p"`, `"JC69"` or `"K80"`.
- `analysis.method` is `"NJ"` or `"UPGMA"`.

**Validation:** files are checked against a JSON Schema kept in the repo. Invalid files give `NeoError::InvalidExercise` with the failing field.

## 8. Testing and validation

**Rules:**

- Reference fixtures and tests are written **before** the code they test.
- No engine change merges unless the whole suite passes.

### 8.1 Reference corpus (`fixtures/`)

**Generation:** `fixtures/generate.R` (using `ape` and `phangorn`) and `fixtures/generate_phylip.sh` (using `dnadist` and `neighbor`) produce JSON fixtures, committed together with the scripts and tool versions.

**Tolerances against R (`ape`/`phangorn`):**

- Distances and branch lengths match to 10⁻⁹.
- NJ topology matches exactly (RF = 0).
- UPGMA is rooted, so it is checked with **rooted** clade comparison and node heights, not just unrooted RF.

**Against PHYLIP:** values match to PHYLIP's printed precision, with one known exception.
PHYLIP `dnadist`'s Kimura 2-parameter option estimates distances under a user-set
transition/transversion ratio (fixtures use the default 2.0), while NeoPhylo's K80 (§4.3)
uses the closed-form estimate from observed transition and transversion proportions, as ape
does. For PHYLIP K80 distances the corpus test asserts this known divergence instead of
equality; K80 distance correctness is verified against ape. PHYLIP NJ trees are compared
using PHYLIP's own printed distance matrix as input.

**Ties:** fixtures contain no tied minima, because tools break ties differently.

### 8.2 Step-level worked examples

Textbook NJ and UPGMA examples are checked **per step**: every R, Q, chosen pair, branch length and new row. These files are also the source content for lesson 1.

### 8.3 Property tests (`proptest`)

These rules must hold on randomly generated inputs:

- NJ exactly recovers the tree from any additive matrix.
- UPGMA exactly recovers the tree from any ultrametric matrix.
- Distance matrices are symmetric with a zero diagonal, and JC69 ≥ p wherever both are defined.
- Newick round-trips without loss.
- RF(t, t) = 0, and RF is symmetric.

### 8.4 Simulator

**Convergence:** with 100,000 sites, a fixed seed, and the generating model used as the correction, each corrected distance is within 2% of the true path length.

**Golden hashes:** for fixed seeds, the hashed alignments are committed. Any change in RNG consumption order is caught as a breaking change.

### 8.5 Native vs. wasm parity

A subset of the corpus and the simulator golden hashes run under `wasm-pack test --node`. The simulator output must be bit-identical between native and wasm builds.

### 8.6 Export parity

CI runs the generated R scripts and checks that their output matches the engine's (§8.1 tolerances).

### 8.7 UI tests

- **Vitest** for layout functions and for checking that the numbers in explanation panels match the trace.
- **Playwright** for one full guided lesson end to end, and for a shared-link round trip.
- **axe** for accessibility.

### 8.8 Human review before release

- A phylogeneticist reviews all Math-layer text.
- One instructor pilots lesson 1 with real students.

## 9. Milestones

| #   | Deliverable                                                    | Done when                                         |
| --- | -------------------------------------------------------------- | ------------------------------------------------- |
| M0  | Repo, CI, fixture generators, worked examples, exercise schema | Fixtures committed; CI runs                       |
| M1  | `neophylo-core` complete (§4)                                  | All §8.1–8.4 tests pass natively                  |
| M2  | `neophylo-wasm` + generated TS types                           | §8.5 passes; bundle < 1 MB gzipped                |
| M3  | Sandbox UI: trees, matrix, stepper, both explanation layers    | Vitest passes; manual walkthrough of a 6-taxon NJ |
| M4  | Guided lessons, prompts, URL state, 3 built-in lessons         | Playwright lesson and link tests pass             |
| M5  | Export, R script, accessibility, offline, polish               | §8.6–8.7 pass; §8.8 complete                      |

## 10. Guidance for AI-assisted implementation

- Work milestone by milestone. Each module ships with its tests in the same change.
- Keep files small and single-purpose: one algorithm per file, and no file over about 400 lines.
- Never hand-edit generated TS types, and never duplicate engine logic in TypeScript.
- When a reference test fails, assume the implementation is wrong before suspecting the fixture. Fixtures change only through their generator scripts.
- Use `libm` for math functions in core; never `f64::exp` or `f64::ln` directly. Enforce this with a clippy `disallowed-methods` rule.

## 11. Resolved gaps

These gaps were found during planning and are resolved as follows:

1. `NeoError` includes a `TooFewTaxa { min, got }` variant; building a tree needs at least 3 taxa.
2. `build_tree` takes `BuildOptions { trace: bool }` and returns `trace: Option<Trace>`, because a 200-taxon trace would be over 100 MB. Traces are produced only when requested; the UI requests them only for 50 taxa or fewer.
3. The wasm boundary includes `load_exercise(json) -> Result<Exercise>` in addition to the functions listed in §5.
4. Duplicate taxon names in a FASTA import are reported as `NeoError::Parse` at the duplicate's line.
5. A true tree used for simulation that is missing a branch length gives `NeoError::InvalidExercise { field: "true_tree" }`.
6. PHYLIP `dnadist` K2P is a fixed-ratio estimator, not §4.3 K80. The PHYLIP K80 distance column is checked as a known divergence; ape is the oracle for K80 distances (see §8.1). Ratified by owner, Task 10.
