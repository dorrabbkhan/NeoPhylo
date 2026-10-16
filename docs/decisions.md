# Decisions & deviations log

One entry per task that deviated from the plan or spec. Newest at the bottom.

## Task 9: simulation

- Fixture guard: new fixture files may ship with code; modifying existing ones needs
  ALLOW_FIXTURE_CHANGE=1 (human only).
- JC69 outcome order unified with K80 (same, transition, transversions alphabetical) per spec §4.2.
- Added k80_convergence test.

## Task 10: reference corpus

- PHYLIP dnadist K2P is a fixed-ratio estimator, not §4.3 K80; asserted as known divergence
  (spec §8.1, gap 6). UPGMA heights checked at tol\*depth. Owner sign-off.

## Task 11: fuzzing

- .gitignore: fuzz/corpus/, fuzz/artifacts/. Committed seed corpora in fuzz/seeds/.
- cargo-fuzz runs from inside the fuzz dir (no --manifest-path support).

## Task 12: wasm bindings

- SimSpec.seed typed as number; seeds limited to 2^53-1 (gap 7).

## Task 13: engine wrapper and session

- Outside Files block: neophylo-wasm serializer uses json_compatible + serialize_missing_as_null
  (None reaches JS as null, matching generated types); none_serializes_as_null parity test;
  js-sys wasm32 dev-dependency; step_counts test in nj.rs (n-3 steps + final join);
  vite.config.ts registers test setup.
- Added Session.alignmentOrigin (imported alignments are never re-simulated) and initialSession().
- Follow-up: to_js may return null on serialization failure (unreachable today); the TS wrapper
  should throw a clear Error so the Task 22 error boundary catches it.

## Task 14: tree layout

- Plan left these conventions unspecified; resolved as:
  - `scale` = `width / maxCum` (px per unit), 0 when maxCum is 0 so a zero-length tree never NaNs.
  - Leaf i sits at `(i + 0.5) * leafSpacing`; `height` = `leafCount * leafSpacing`.
  - Internal node y = midpoint of its outermost children.
  - Cladogram leaves align at max depth x so all tips share one x (required by the task's own test).
  - `visibleNodes`: positions come from the full tree; hidden nodes are omitted, never re-laid out.
    A visible node with a hidden/absent parent has `parentX === x` — no stub edge is drawn.
  - Phylogram only: when `clampNegative` is off, x positions are scaled over `maxCum - minCum`
    and shifted by `-minCum` so no node draws at x < 0. Cladogram depths are never negative.
  - `leaf` means "no visible children", so a cluster tip during stepping reads as a leaf.
  - `negative` is true only when the parent edge is actually drawn (visible parent) and length < 0,
    independent of `clampNegative`.

## Task 15: TreeView

- Outside Files block, all required by the plan's M3 preamble ("Component tests use Vitest +
  Testing Library + jsdom"), which no earlier task had set up:
  - package.json: devDependencies `jsdom`, `@testing-library/react`, `@testing-library/dom`.
  - vite.config.ts: `test.environment = "jsdom"`.
  - src/test/setup.ts and src/layout/phylogram.test.ts: under jsdom `import.meta.url` is an
    http URL, so wasm/fixture paths fall back to cwd-relative resolution (vitest runs in web/).
- Plan ambiguities resolved:
  - "highlighted nodes are thicker and labeled": internal nodes are named
    u1, u2, … by creation order via state/names.ts; Tasks 16 and 18 must use nodeName.
  - `onHoverLeaf(label)` is called with the leaf's label on mouse enter and `null` on leave.
  - Fixed drawing geometry (viewBox 400-wide layout + label gutter); the svg scales via viewBox.
  - A "wrong clade" outline bounds the clade's laid-out nodes plus the branch leading to it;
    descendants hidden by `visibleNodes` are left out.

## Task 16: MatrixHeatmap

- Plan ambiguities resolved:
  - `values` takes the flattened row-major cell list with "sat" for saturated cells
    (the signature's `"sat" | number`); Session's DistanceMatrix.cells (Cell[]) is
    flattened by the caller in Task 17.
  - `onHover(cell)` is called with `{ i, j }` on hover/focus and `null` on leave/blur,
    matching Session.hover's type.
  - Viridis is approximated by linear interpolation over the eight stops of R's
    `viridis(8)`; min→dark, max→bright, 0.5 when all values are equal.
  - `chosen` marks exactly the [i, j] cell (traces always give i < j), not both
    symmetric halves.
  - Arrow keys use a roving tabindex (WAI-ARIA grid pattern): one cell is tabbable,
    initially the chosen cell; focus also fires onHover for keyboard parity.
  - Non-finite numbers are rendered like "sat" (hatch + ∞) defensively.

## Task 17: Stepper, Controls and App shell

- exercises/nj-basics.json does not exist yet (exercises/ is Task 23's file), so
  src/lessons/default.ts embeds the spec §7 example verbatim (identical to
  fuzz/seeds/exercise/spec_example.json) and parses it through
  engine.loadExercise, exercising the real validation path.
- App lives at src/views/App.tsx per the Files block; the Vite template
  src/App.tsx and src/App.css were deleted and main.tsx updated.
- MatrixHeatmapProps.hover widened to { i, j } | { axis: number } | null so a
  hovered tree leaf can highlight its matrix row and column; Task 16's
  { i, j }-only type could not express that.
- TreeView now draws a small "0" text on zero-length branches (§6.3), required
  by this task's Produces but absent from Task 15's file.
- Ambiguities resolved:
  - At step k the highlight is the chosen pair of join k+1 (steps[k]). At the
    end, NJ's three-way final join highlights all three nodes (no single
    matrix cell is marked); UPGMA highlights its last step's pair.
  - In distance view a chosen cell is marked only while both chosen nodes are
    still leaves (a cluster has no single taxon cell); in Q view the active-
    indexed cell is always marked. Q shows trace.steps[k].q (the pre-join
    state), clamped to the last step once the trace is exhausted, labeled by
    the active clusters' nodeName.
  - The >50-taxa stepper note is keyed on taxon count, not on build success.
  - Global keys ignore form controls and e.defaultPrevented (so the matrix
    grid's arrow navigation and Space on buttons keep native behavior); play
    steps every 800 ms and pauses at the end.
  - Locked exercise fields render as disabled controls (Task 21 adds lock UI);
    sim controls disable while an imported alignment is in place.
  - The explanation column is an empty aside until Task 18.
  - App takes an optional exercise prop (used by tests); it defaults to the
    embedded lesson.
- Dev walkthrough: `npm run dev` serves the built-in 5-taxon lesson and the
  step-through/Q-toggle/hover paths are exercised by App.test.tsx; a 6-taxon
  NJ can't be loaded interactively until Task 20 adds import UI.

## Task 17 checkpoint-6 fixes

- Distance heatmap now shows the displayed step's active-cluster matrix
  (steps[k].distance) labeled by nodeName — previously it always showed
  the full leaf matrix. Chosen cells are active-indexed in both views;
  NJ final join stores its 3×3 matrix in the trace (engine change).
- New file src/views/stepMatrix.ts holds that selection (traceLength/stepsOf
  moved there too) so App.tsx stays near the 400-line guideline and the
  sync is unit-testable; no distances are ever computed in TypeScript.
- New --fg token styles all SVG text/lines in both color schemes; leaf
  labels are 14px; each tree panel shows its title via figcaption. The app
  shell fits the viewport (grid rows: content 1fr, stepper auto) so the
  stepper is always fully visible; tree panels are ≥260px and SVGs fill them.
- Heatmap cell text picks dark/white from the viridis t value (threshold
  0.5), not from the interpolated color's luminance.

## Task 18

- `mathTex`/`conceptText` take the zero-based stepper position (position k
  discusses join steps[k], matching stepMatrix.ts). NJ's extra final
  position renders `final_join`'s three l_x formulas; the distances
  between the last three clusters are read from `final_join.distance`
  (the stored 3×3 matrix, rows ordered a, b, c) — no recomputation.
- The task only spelled out NJ's math lines; UPGMA's are by analogy:
  smallest d(i,j), h = d(i,j)/2, both branch lengths, one size-weighted
  d(u,k) example. UPGMA has no extra final position (its last join is a
  normal step), so positions clamp to the last stored step.
- `katex` + `@types/katex` added to web/package.json — KaTeX is named in
  the spec's Tech Stack. Taxon labels are always emitted inside escaped
  \text{...} so special characters can't break formulas; plain notices
  (the tie line) carry no "=" and render as text.
- Fixture reads in the new tests use cwd-relative resolve("../fixtures")
  (vitest runs in web/): a dynamic new URL(`../../../${rel}`, import.meta.url)
  makes Vite glob the repo root and fail with "Denied ID AGENTS.md?url".
- The empty-traces case (>50 taxa, no trace requested) shows a one-line
  note in the panel rather than hiding it.
- Follow-up for Task 25: lazy-load KaTeX on first switch to Math mode (main bundle 512 kB).
- Files outside the Files block: App.tsx (panel wired into .col-explain), index.css (panel styles), package.json (katex, @types/katex), and src/views/ExplanationPanel.test.tsx (component test placed next to its component rather than in explain/).

## Checkpoint-6 fixes (post-Task 18)

- `NjFinal` gains `distance: Matrix` — the 3×3 matrix of the final
  three-way join, rows ordered a, b, c (spec §4.5 step 5 records the
  final step in the trace; the struct sketch there predates this field).
  `#[serde(default)]` keeps fixtures/worked JSON deserializable; `Matrix`
  derives `Default` for that. The heatmap's final position and the Math
  layer's l_x lines now read it instead of reconstructing distances from
  the last stored step.
- Math layer precision reduced from `toFixed(4)` to `toFixed(3)` to match
  the heatmap cells; a "Values shown rounded; calculations use full
  precision." note sits under the Math panel.
- Ties with exactly four active nodes get dedicated wording (concept:
  "these two pairs always tie, and either choice gives the same tree";
  math: both equal Q values with "(always equal at four nodes)") — at
  four actives complementary pairs are algebraically guaranteed equal Q.
  Ties with more actives keep "Tie: chosen by input order."

## UI polish

- Trees fill their panels (TreeView.tsx, App.tsx, index.css, new
  src/layout/treePanel.ts):
  - `.col-center` is now a grid with rows `auto minmax(0,45fr) minmax(0,55fr)`:
    the trees row gets ~45% of the column height and the heatmap ~55%,
    with no large empty gap (the error message takes the auto row when
    present).
  - Each TreeView measures its drawing box (`.tree-canvas`, a div wrapping
    the svg so the figcaption is excluded) with a ResizeObserver and
    passes the panel size into layout(): leafSpacing fills the measured
    height clamped to 18–48px, and the drawing width leaves room on the
    right for the longest leaf label (labelRoomFor, ~0.62em/char).
  - App measures the `.trees` row once and passes one leafSpacing to both
    TreeViews so their rows line up side by side; leaf labels are 14–16px
    and grow with leafSpacing. The observer binds through a callback ref:
    a mount-time effect would run while the .app-loading placeholder is
    rendered and find no element. The heatmap is top-aligned in its row
    so it sits directly under the trees.
  - Sizing math lives in src/layout/treePanel.ts (pure functions, like
    phylogram.ts) — react-refresh lint bars non-component exports from
    component files. jsdom tests stub ResizeObserver in
    src/test/setup.ts and exercise the helpers directly.
- Math panel readability (index.css; ExplanationPanel markup unchanged —
  formulas were already one <p.math-line> block each):
  - `.explain-body` text and KaTeX output use --fg (same token as the
    trees), minimum 15px.
  - `.math-line` is display:block with white-space:nowrap and
    overflow-x:auto, so a formula never wraps mid-formula — long ones
    scroll horizontally. Even 8px spacing between lines.
  - The precision note sits below in 12px --fg text (opacity 0.8).

## Task 19: teaching states

- Files outside the Files block: `web/src/index.css` — styles for the
  `.notices` row-1 container, `.notice` panels, `.notice-fixes` button
  row and `.saturation-chart`; all view styling lives there.
- Ambiguities resolved:
  - SaturationChart renders inside the saturation notice (spec §6.3
    attaches the chart to the saturated-cells teaching state).
  - The chart's x-domain is the spec's [0, 2] but extends to fit any
    plotted pair's true distance instead of silently clamping points.
  - Chart p values come from `engine.distances(alignment, "P")` (no
    engine math in TS); true path lengths are plain parent-pointer
    traversal.
  - The generic role="alert" error line is suppressed for
    SaturatedMatrix — the teaching panel names the pairs and the fixes.
  - RF notice count is `missing_in_inferred.length` (task's parenthetical);
    the wrong-clade outline already existed via TreeView's `wrong` prop.

## Task 20: sandbox import and error messages

- Files outside the Files block:
  - `web/src/views/App.tsx` — nothing else mounts ImportPanel or lets the
    user reach `source === "sandbox"`: the plan never defined a sandbox
    entry point. Added an "Import your own data" button that dispatches
    `load` with `source: "sandbox"` (reuses the existing action; no
    `session.ts` change needed) and renders ImportPanel in the controls
    column while sandboxed. The center-column `errorText` line was
    replaced by `errorMessage` (title + body), still suppressed for
    SaturatedMatrix (§6.3 notice) and additionally suppressed in sandbox
    mode, where ImportPanel shows pipeline errors under the import box.
  - `web/src/index.css` — `.sandbox-entry` and `.import-panel` styles;
    all view styling lives there.
- Ambiguities resolved:
  - Sandbox unlocks locked controls per spec §6.2 ("all controls are
    unlocked"): App passes `locked: []` while `source === "sandbox"`.
  - A "Back to the lesson" button re-dispatches `load` with
    `source: "lesson"` so the sandbox isn't a dead end.
  - Import is explicit (an Import button) rather than on every change;
    the pasted text stays in the box for editing after a failed parse.
  - `TooFewTaxa`'s title interpolates `min` ("Need at least {min}
    sequences") so the verbatim string survives a future limit change;
    `Parse` interpolates `line` per the plan's "{line}" placeholder.

## Task 21: lesson prompts and locks

- Files outside the Files block:
  - `web/src/views/App.tsx` — the only place prompt gating, PromptCard and
    the pick handlers can be wired; it owns no prompt logic itself.
  - `web/src/lessons/prompts.ts` + `web/src/lessons/promptGate.ts` — pure
    at_step→position helpers plus a `usePromptGate` hook holding the
    answered-pick map and the two-leaf pick state. Extracting them keeps
    `App.tsx` under the ~400-line rule (356).
  - `web/src/views/stepEmphasis.ts` — the chosen/hover/visible/wrong/
    matrixHover derivation moved out of App so the prompt gate can
    suppress the answer mark through `smShown`; same pattern as
    `stepMatrix.ts`.
  - `web/src/views/MatrixHeatmap.tsx` — cells call `onPick` on click (the
    spec's "student clicks a matrix cell"); Enter/Space still work.
  - `web/src/views/TreeView.tsx` — `onPickLeaf(label)` on leaf-label
    clicks for the "two leaves" pick path.
  - `web/vite.config.ts` — a small plugin serves `/exercises/*.json` from
    the repo `exercises/` dir in dev and copies the `.json` files into the
    build output (the plan's "copied to public/ at build").
  - `web/src/index.css` — `.prompt-card` styles; all view styling lives
    there.
  - `web/package.json` + lock — `ajv@^8` devDependency; the task names ajv
    for schema validation and draft 2020-12 needs v8 (`Ajv2020`).
- Ambiguities resolved:
  - `at_step` is the 1-based _join_ number (Prompt.ts docstring), so a
    prompt shows at stepper position `at_step - 1` — the position where
    that join is still pending. Task 23's nj-basics `at_step: 3` only
    makes sense this way (position 3 is the three-way final join, which
    has no pair to predict).
  - While a predict_pair prompt is unanswered the correct pair is not
    marked anywhere: `smShown` clears `chosen` and no tree highlight is
    drawn. Otherwise the highlight would give the answer away.
  - A predict_pair at a position with no pending pair renders like a
    note instead of gating forever.
  - Locked controls keep Task 17's disabled behavior and now also carry
    `title="Fixed for this lesson."` on the control element itself.
  - Pick rules: diagonal cells are ignored; clicking the same leaf twice
    re-arms it; two leaves in one cluster count as a wrong answer.
  - `schema.json` mirrors the engine, not a stricter ideal: unknown
    properties allowed, `locked`/`prompts` optional, kappa required and
    positive only under K80, and `at_step`/`seed`/`length` bounds match
    serde's effective ranges. One accepted divergence: JSON Schema's
    `integer` accepts `1.0` where serde's `u32` rejects it.
  - Prompt cards live in the center column above the trees — next to the
    matrix the student picks from — and follow the session's
    concept/math mode; prompt.math renders as plain text, not KaTeX.

## Checkpoint-7 fixes: sandbox switch, trueTreeOrigin, imported saturation

All three are plan gaps found at checkpoint 7.

- **Lesson | Sandbox switch.** The header now carries a `role="radiogroup"`
  with two `role="radio"` buttons (native keyboard support). The plan only
  specified the one-way "Import your own data" entry button; that button is
  removed and the switch is the single mode control. New reducer actions:
  `enterSandbox` just flips `source` — pipeline outputs (same simulated
  alignment, same seed) are kept so nothing jumps; `exitSandbox` re-runs
  `load` with a fresh `prompts` array copy so the prompt gate resets its
  answered picks (it keys a new exercise on the array's identity).
  `exitSandbox` reloads the _current_ exercise — sim/analysis edits made in
  the unlocked sandbox persist into the lesson, same as the old
  "Back to the lesson" button did. When `hasImportedData(session)` (an
  imported alignment or tree), leaving asks first via `window.confirm` —
  both in the header switch and in ImportPanel's "Back to the lesson".
- **`Session.trueTreeOrigin` ("lesson" | "imported").** `load` sets
  "lesson", `importTree` sets "imported". `importAlignment` clears a lesson
  true tree before recompute — the imported labels can't match it, so
  comparison would always fail with LabelMismatch; with no true tree the
  comparison is skipped (no RF). An imported tree is kept, so a label
  mismatch still produces LabelMismatch as before. UI: when `trueTree` is
  null the true-tree panel shows "No true tree — import a Newick tree to
  compare" and the stepper ends with "RF: — (no true tree)" (new
  `Stepper.noTrueTree` prop).
- **Imported-data saturation.** While `alignmentOrigin === "imported"` the
  saturation notice hides "Use longer sequences" and "Use shorter branches"
  (re-simulation can't help data that wasn't simulated), shows only
  "Switch to p-distance", and adds the line "Your own data can't be
  re-simulated."
- Files outside the plan's purview: `web/src/index.css` (`.mode-switch`,
  `.no-true-tree`; `.sandbox-entry` removed), `web/src/views/App.sandbox.test.tsx`.
- **Follow-up for Task 22:** the URL state must include `source`
  (lesson | sandbox) so sandbox links can be shared.
