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

## Task 22: URL state and error boundary

- Files outside the Files block:
  - `web/src/state/urlRestore.ts` — the decode→load and session→UrlState
    wiring, extracted from App.tsx so it stays near the 400-line rule
    (411), same pattern as stepMatrix.ts/promptGate.ts. App owns no URL
    logic itself.
  - `web/src/views/App.tsx` — the task's own Produces requires the App to
    decode on load and to sync `history.replaceState` on every state change;
    no other component can do that.
  - `web/src/main.tsx` — mounts `ErrorBoundary` around `<App />`; nothing
    else can wrap the root.
  - `web/src/index.css` — `.toast` (failed-decode message) and
    `.error-boundary` styles; all view styling lives there.
  - `web/package.json` + lock — `lz-string` (named in the plan's Tech
    Stack and required by `encode`/`decode`) plus `@types/lz-string`.
- Ambiguities resolved:
  - `UrlState` gains `src?: "sandbox"` (encoded `&sb=1` in query links,
    inside the `#x=` JSON for custom exercises). Implements the Task 21
    follow-up above; Produces otherwise unchanged.
  - A `#x=` payload compresses the whole `UrlState` (including `x`), not
    just the exercise, so step/mode/overrides survive in one fragment.
  - Built-in links always write the current `sim` and `analysis` as the
    `o` override (plus `branchScale` when ≠ 1) rather than diffing against
    the lesson file — the merge is idempotent, and the URL stays correct
    even if a lesson file changes between shares.
  - `migrate`'s v0 → v1 path is a stub by design: v0 carried only
    `step`/`mode`, which are lifted (invalid values fall back to
    `0`/`"concept"`); everything else is dropped. Any other version → null.
  - A bare URL (no `?`, no `#x=`) decodes to the default state without a
    toast; only recognizable-but-broken links (`#x=` garbage, malformed
    `s`/`m`/`o`, empty `lesson`, `src`/`x`/`overrides` of wrong type)
    return `ok: false`. Unrelated query params are ignored.
  - A `?lesson=` id that fails to fetch also toasts and falls back to the
    default lesson (spec §6.4 "invalid state loads the default lesson").
  - The `exercise` prop skips URL decoding entirely (tests drive the app
    directly) and syncs as `#x=` — a prop exercise isn't a built-in.
  - Overrides are merged onto the exercise before `load` so the first
    `recompute` already uses them; `branchScale`/`src`/`step`/`mode` are
    applied as reducer actions afterwards (step clamps via `reducer`).
  - The toast has no auto-dismiss timer; it stays until reload/navigation.

## Task 23: built-in lessons and e2e tests

- Files outside the Files block:
  - `web/e2e/helpers.ts` — shared Playwright helpers (waitForApp, readStep,
    answerPredictPrompt, stepToEnd, matrixLabels) used by both specs; kept
    out of the spec files so each test states only what it asserts.
  - `web/package.json` + `package-lock.json` — `@playwright/test`
    devDependency; Playwright is named in the plan's Tech Stack.
  - `web/eslint.config.js` — node globals for `e2e/**` and
    `playwright.config.ts` (`process.env`); browser globals otherwise.
  - `web/tsconfig.node.json` — include `playwright.config.ts` so `tsc -b`
    type-checks it.
  - `web/vite.config.ts` — `server.fs.allow` covers the repo root (the
    `?raw` import of `exercises/nj-basics.json` is outside web/);
    `test.include` scoped to `src/**` because Vitest's default glob also
    matches `*.spec.ts` and was picking up the Playwright specs.
  - `web/.gitignore` — standard Playwright artifact ignores.
  - `web/src/views/TeachingNotices.tsx` — the saturation panel headline is
    now `errorMessage(sat).title` ("Some distances can't be estimated"),
    the phrase the plan's e2e asserts; previously only "cannot estimate:"
    was rendered and the role="alert" title was suppressed for
    SaturatedMatrix.
  - `web/src/lessons/loader.test.ts`, `web/src/views/App.prompts.test.tsx`,
    `web/src/views/App.sandbox.test.tsx` — were coupled to the placeholder
    lesson's prompt wording; now read `exercise().prompts[...]` from the
    real file (and the note test follows the real prompt layout).
- Ambiguities resolved:
  - "load `nj-basics`" in `src/lessons/default.ts`: the file is embedded
    via `import ... ?raw` instead of fetched — zero requests for "/",
    identical bytes as `exercises/nj-basics.json`, still validated through
    `engine.loadExercise`.
  - `upgma-fails`: "UPGMA is locked" can't mean `analysis.method ∈ locked`
    — the same lesson's final note invites switching to NJ and the e2e
    asserts RF = 0 after switching. Locked fields are `sim.model` and
    `analysis.correction`; `analysis.method` is the unlocked lever.
    UPGMA fails deterministically (RF = 2 at every seed tried; pinned 42):
    branch B = 0.5 is 10× the cherry/internal branches, so A–E is the
    closest pair and UPGMA's wrong first join costs a split.
  - `saturation` pins seed 42 as the plan asserts: at length 50 the JC69
    matrix has 3 saturated pairs; the "Use longer sequences" fix still
    saturates at 100 and produces a tree at 200 (verified against the
    wasm build). Branches 0.5–0.8, inside the plan's 0.5–1.5 band.
  - `nj-basics` pins seed 42: NJ recovers the true tree (RF = 0 / 6) at
    1000 sites; e2e answers predict_pair prompts by picking the minimum-Q
    cell via the Distance/Q switch — the gate hides the mark, not the
    values, so the test answers correctly without peeking.
  - The ci.yml "Playwright job" is check.sh's existing `E2E=1` step (the
    project has no GitHub CI; AGENTS.md). Playwright config runs all
    three projects (Chromium, Firefox, WebKit) against the dev server.
  - "Copy the URL" in share.spec is `page.url()` — the app already syncs
    state to `history.replaceState` on every change; no clipboard needed.
- Environment note (not committed): WebKit needed libavif16,
  libmanette-0.2-0, libyuv0, libgav1-2 and libhidapi-hidraw0; the .debs
  were extracted into `~/.cache/ms-playwright/webkit-*/minibrowser-*/sys/lib`
  because the MiniBrowser wrapper overwrites LD_LIBRARY_PATH. sudo
  `npx playwright install-deps` does the same thing system-wide.

## Task 23 checkpoint-7: lesson content requirements

- `at_step` convention documented in exercises/schema.json: it is the
  1-based number of the join being discussed — the prompt shows at
  stepper position `at_step - 1`, where that join is still pending; one
  past the last join shows on the completed tree (closing notes).
- `Prompt.reveal` added to the engine (`Option<String>`, ts-rs →
  `string | null`) and the JSON Schema: an explanation a predict_pair
  card shows only after the student picks, so the nj-basics step-3
  question is not spoiled. Required because the reveal text must exist
  without leaking the answer beforehand. Spec §7 documents it and its
  placeholder note got real text.
- nj-basics keeps tree
  `((A:0.1,B:0.15):0.1,(C:0.12,D:0.08):0.15,(E:0.1,F:0.2):0.05)` and
  seed 42 — the checkpoint-7 premise already holds there: at join 3 the
  smallest distance is u1–u2 (≈0.255) while the minimum-Q join NJ takes
  is E–F. The step-3 prompt's `reveal` states this; the e2e asserts the
  premise by locating the min cell in each view.
- upgma-fails (tree `((A:0.02,B:0.5):0.02,(C:0.05,D:0.05):0.05,E:0.02)`,
  seed 42) and saturation (tree
  `((A:0.8,B:0.7):0.5,(C:0.5,D:0.8):0.5,(E:0.6,F:0.5):0.5)`, seed 42,
  length 50) keep their verified parameters; closing notes moved/added
  at "one past the last join" so they show on the completed tree.
- New `src/lessons/lessons.test.ts` enforces checkpoint-7 content rules
  on every exercises/\*.json: no empty/"…" prompt text, no predict_pair
  at the final join (built from the real trace; saturation falls back to
  leaf counts since its own settings block the build), and at_step
  within the stepper's range.
- `PromptCard` renders `reveal` only after a pick (`.prompt-reveal`);
  component test added.
- nj-basics e2e now picks the _closest_ cell at join 3, sees
  "Not quite" plus the reveal, then steps to RF = 0 / 6 — the student's
  intended mistake becomes the teaching moment.
- Fuzz seeds `crates/…/fuzz/seeds/exercise/*.json` keep their "…" text
  on purpose — they are corpus inputs for parser robustness, not lesson
  content.
- Flake fix (Task 22 test): `App.url.test.tsx`'s URL-sync assertion now
  awaits `window.location.hash` with `waitFor` — the replaceState sync
  runs in an effect and raced the assertion once under check.sh load.

## Task 24: export and R parity

- Files outside the Files block: `web/src/views/App.tsx` — modified to
  mount `ExportMenu` in the controls column; the export functions are
  otherwise unreachable from the UI (spec §6.6 lists export as an app
  feature). No behavior changes beyond rendering the menu.
- `ci.yml` does not exist (no GitHub CI, per AGENTS.md); the
  `fixtures-r` equivalent already lives in `scripts/check.sh` as the
  `RPARITY=1` step, which now activates since `web/scripts/r-parity.mjs`
  exists. No check.sh edit was needed.
- `r-parity.mjs` imports `src/export/rscript.ts` directly — Node 24's
  built-in type stripping handles it, and the file only uses erasable
  syntax plus `import type`, so no bundler step is required.
- R scripts are run via a temp file (`Rscript file.R`), not `Rscript
-e`: long `-e` arguments get mangled by the shell/R arg parser.
- `write.tree(tree)` prints R's vector form (`[1] "…"`); the parity
  script unwraps the quotes and unescapes `\"`/`\\` before parsing.
- Branch lengths are compared via all-pairs patristic distances within
  1e-6 (plan tolerance "since R prints limited digits"), not per-edge:
  the engine and R produce differently-rooted/ordered arenas, and RF=0
  already guarantees the splits match.
- Review Focus 2 in the parity job asserts the `O'Brien"s` script runs
  and the label survives in the output. It does not re-parse the Newick:
  ape's `write.tree` emits labels containing `'` or `"` bare (not
  single-quoted), which is non-standard Newick our strict parser
  rejects. Documented here rather than "fixed" — it is R's output, and
  the plan only requires the generated script to be valid runnable R.
- `exportSvg` uses fixed geometry (22 px leaf spacing, 480 px draw
  width): there is no panel to measure in a download, and the same
  `layout()`/`treePanel` helpers as `TreeView` keep spacing and label
  room consistent with the on-screen tree.

## Task 25: accessibility, offline and deploy

- Files outside the Files block, all required to make the plan's own
  checks pass or the feature work:
  - `web/package.json`, `web/package-lock.json` — dev deps
    `@axe-core/playwright` and `vite-plugin-pwa`, both named by the
    spec (§6.5 axe checks, §6 stack).
  - `web/playwright.config.ts` — a second `webServer` (build +
    `vite preview` on :4174): the dev server never registers a service
    worker, so the offline test must target the production build.
  - `web/tsconfig.e2e.json`, `web/tsconfig.json` — `e2e/` sat outside
    every tsconfig; the new spec uses DOM types inside
    `page.evaluate`, so e2e got its own project (esnext+bundler,
    ES2023+DOM lib) wired into `tsc -b`.
  - `web/index.html` — title was "web"; now "NeoPhylo".
  - `web/src/index.css` — `--accent` (#aa3bff) fails 4.5:1 on
    `--accent-bg`/white, so text uses a new `--accent-text` token
    (#6d28d9 light / #c084fc dark). Affected rules: checked
    mode-switch radio, `.stepper-rf`.
  - `web/src/views/Stepper.tsx` — axe `label-content-name-mismatch`:
    visible "◀ prev"/"▶ next" didn't appear in the accessible names;
    labels are now "◀ Previous"/"Next ▶" (truncations of the
    aria-labels "Previous step"/"Next step").
  - `web/src/views/MatrixHeatmap.tsx` — `focusable="true"` on each
    gridcell: WebKit ignores `tabindex` on SVG elements for
    sequential (Tab) focus; the attribute is ignored elsewhere.
  - `web/src/views/App.tsx` — focus rescue: landing on a gated step
    disables the focused stepper control and the browser drops focus
    to `<body>`, and in WebKit the Tab ring cannot re-enter from
    there. On the gated transition, dead focus moves to the roving
    gridcell; live focus is never stolen and a gated initial position
    is left alone.
- The offline test runs only on Chromium: Playwright's `setOffline`
  emulation rejects SW-served navigations in Firefox
  (`NS_ERROR_OFFLINE`) and WebKit (internal error) — a driver
  limitation, not app behavior. The precache contract it validates is
  engine-agnostic.
- The Files block said modify `vite.config.ts` to "set `base` for
  GitHub Pages". `base` comes from `NEOPHYLO_BASE` (default `/`):
  hard-coding `/NeoPhylo/` would break dev, vitest and `vite preview`
  (which the offline test depends on). Only the deploy workflow sets
  it, to `/NeoPhylo/` matching repo `dorrabbkhan/NeoPhylo`.
- The deploy workflow builds wasm via `scripts/build-wasm.sh`
  (wasm-pack installed through npm, `rust-toolchain.toml` supplies
  toolchain + target) and publishes `web/dist` with
  actions/upload-pages-artifact + deploy-pages. `workflow_dispatch`
  allows manual redeploys. The live-URL check ("deployed URL loads
  the default lesson") can't run until the workflow exists on `main`
  — Pages must also be enabled once in repo Settings.
- `workbox.globPatterns` covers `.wasm` and `.json` (defaults exclude
  both) so the engine and `exercises/*.json` are precached;
  `maximumFileSizeToCacheInBytes` raised to 8 MiB for wasm headroom.
- `tabUntil` in the keyboard test walks forward then backward:
  Playwright's Firefox cannot Tab past the last page element (focus
  leaves the document and does not wrap), so targets earlier in the
  ring are reached with Shift+Tab — as a real keyboard user would.

## CI & hygiene

- LICENSE already held the canonical AGPL-3.0 text and the workspace
  `license` fields were already set (commit c2606e5); verified
  byte-identical to gnu.org's agpl-3.0.txt. Added the missing
  `license = "AGPL-3.0-only"` to `crates/neophylo-core/fuzz/Cargo.toml`
  (standalone workspace, so a literal value, not `license.workspace`).
- Footer link: `REPO_URL` lives in `web/src/config.ts`; the
  "Source code (AGPL-3.0)" anchor renders unconditionally in
  `.app-footer`, so it is visible in both Lesson and Sandbox modes.
  `.app-footer` is now a flex row (stepper grows, link pinned right).
- `scripts/check.sh` split into `scripts/ci/`: fixture-guard.sh,
  rust.sh, wasm.sh, web.sh, fuzz.sh, e2e.sh, r-parity.sh — same
  execution order as before (guard/regen → rust → wasm → web → fuzz →
  e2e → r-parity). Gates stay inside each script so they are
  standalone-runnable: FUZZ=1, E2E=1, RPARITY=1 opt in; FIXTURES=1
  regenerates; ALLOW_FIXTURE_CHANGE=1 skips the guard.
- fixture-guard.sh takes the base commit from `$BASE` (default:
  `git merge-base HEAD main`, used only when `main` exists — same
  skip-if-no-main behavior as before).
- Environment note (not committed): the fresh Playwright install pulled
  `webkit-2370`, so the Task 23 sys-lib workaround had to be re-applied —
  `apt-get download libavif16 libmanette-0.2-0 libyuv0 libgav1-2
libhidapi-hidraw0`, `dpkg -x`, copy `*.so*` into both
  `~/.cache/ms-playwright/webkit-2370/minibrowser-{gtk,wpe}/sys/lib`.

## CI: .github/workflows/ci.yml

- The workflow delegates to `scripts/ci/*.sh`; YAML only installs the
  toolchain each script assumes (rustup via `rust-toolchain.toml`,
  wasm-pack, node via `.nvmrc`, R + rspm, phylip, Playwright browsers).
- `.nvmrc` added (`24`) — the task required a `.nvmrc` for
  `actions/setup-node`; `deploy.yml` already used Node 24 and local dev is
  on v24.22.0.
- `scripts/ci/e2e.sh` now passes `"$@"` through to `npx playwright test`
  so each matrix leg selects one project and adds the `html` reporter
  (config keeps `list`; CI passes `--reporter=list,html`). Unchanged
  behavior when called bare locally.
- Third-party actions are pinned to commit SHAs with a `# vX.Y.Z` comment
  (checkout v7.0.1, setup-node v7.1.0, upload-artifact v7.0.2,
  download-artifact v8.0.2, cache v6.1.0, Swatinem/rust-cache v2.9.2,
  r-lib/actions v2.14.0). SHAs resolved via `git ls-remote` tag peels.
- wasm-pack is installed as the pinned prebuilt musl tarball from
  `wasm-bindgen/wasm-pack` v0.15.0 (sha256-verified) into `~/.cargo/bin`,
  cached by `actions/cache` — the repo moved from `drager` to
  `wasm-bindgen`, which broke the old `npm i -g wasm-pack` path used in
  `deploy.yml` (see wasm-pack release notes; the npm path was never
  republished for 0.14+).
- The `r-and-fixtures` job regenerates fixtures through
  `FIXTURES=1 scripts/ci/fixture-guard.sh` (which runs
  `generate.R` + `generate_phylip.sh`, `git diff --exit-code
fixtures/ref`, and an untracked-file check). If regeneration differs on
  CI the job fails and reports the diff — fixtures are never updated
  automatically; the owner judges version/locale drift.
- `r-and-fixtures` needs Node + the `wasm-pkg` artifact because
  `web/scripts/r-parity.mjs` imports `src/engine/pkg` and uses Node 24's
  type stripping on `src/export/rscript.ts`.
- The Playwright browser cache key embeds the installed
  `@playwright/test` version plus the browser name, computed after
  `npm ci`.
- Check names for branch protection: `fixture-guard`, `rust`, `wasm`,
  `fuzz-build` (added later — see "fix/fuzz-targets-schema-v2" below),
  `web`, `e2e (chromium)`, `e2e (firefox)`, `e2e (webkit)`,
  `r-and-fixtures`.
- `.github/workflows/deploy.yml` removed (owner decision): the spec only
  requires "any static host", Pages was never enabled, and the workflow
  used unpinned actions plus the broken `npm i -g wasm-pack` install.
  The `web` job's `dist` artifact keeps a build available for any future
  host; `NEOPHYLO_BASE` in `vite.config.ts` stays (host-agnostic).
- First run fix: `wasm-pkg` artifact downloads specify
  `path: web/src/engine` — upload-artifact roots multi-path artifacts at
  the paths' least common ancestor, so the zip holds `pkg/` and
  `generated/` directly and must extract into `web/src/engine`, not the
  repo root (vitest failed to resolve `engine/pkg/neophylo_wasm.js`).

## ci/netlify-deploy: Netlify deploy job + \_headers

- `web/public/_headers` (new) — Vite copies `public/` verbatim into
  `dist/`, so the file lands at `dist/_headers`. Verified against the real
  build output: fingerprinted bundles are under `/assets/` (js, css,
  KaTeX fonts, `neophylo_wasm_bg-*.wasm`); `index.html`, `sw.js`,
  `registerSW.js`, `manifest.webmanifest` and `workbox-*.js` sit at root.
  Additions beyond the task's header list:
  - `/` alongside `/index.html` — browsers request `/`, and Netlify
    matches header rules on the request path, not the resolved file.
  - `/registerSW.js` — vite-plugin-pwa's unhashed SW registration script;
    no-cache for the same reason as `sw.js`.
  - `/workbox-*.js` — the content-hashed Workbox runtime lives at root,
    not under `/assets/`; marked immutable like the hashed assets.
  - `/*.wasm` is a mid-segment wildcard — allowed in header paths per
    Netlify docs ("wildcards can be used at any place inside of a path
    segment"); the redirects restriction does not apply. The wasm asset
    matches both `/assets/*` (immutable) and `/*.wasm` (Content-Type).
- vite base: `web/vite.config.ts` resolves `process.env.NEOPHYLO_BASE ?? "/"`
  and the CI `web` job never sets `NEOPHYLO_BASE`, so the `dist` artifact
  is already built for `/` — no config change needed for Netlify.
- `deploy` job in `ci.yml`:
  - `needs` includes `fixture-guard` (task requirement on PRs), which is
    skipped on push by its own `if: pull_request`. A skipped need would
    normally skip the dependent job, so `deploy` uses
    `always() && !failure() && !cancelled()` plus the event guards —
    identical gating on jobs that ran, tolerant of the intentional skip.
  - Single job as tasked: `environment` resolves to `production` on push
    and `preview` on PRs; job permissions are `contents: read` +
    `pull-requests: write` for the sticky comment.
  - Fork PRs never deploy: `pull_request` only when
    `head.repo.full_name == github.repository`; `pull_request_target` is
    not used anywhere.
  - `netlify-cli` pinned via `npx --yes netlify-cli@27.13.0`;
    `actions/github-script` pinned to the v9.0.0 commit SHA like the other
    actions in the file.
  - The PR comment carries a `<!-- neophylo-netlify-preview -->` marker so
    a single comment is updated, not duplicated; visible text stays
    "Preview: <url>".
  - The only checkout is for `setup-node`'s `node-version-file: .nvmrc`;
    the deploy itself works purely off the `dist` artifact.
  - `npx --yes --package netlify-cli@27.13.0 netlify` — the package's bins
    are `netlify`/`ntl`, not `netlify-cli`, so the bare
    `npx netlify-cli@ver deploy` form fails to resolve an executable.
- Requires repo secrets `NETLIFY_AUTH_TOKEN` and `NETLIFY_SITE_ID`.

## docs/public-readme: public-facing docs pack

- README links the CI badge at `.github/workflows/ci.yml`, which now exists
  (the AGENTS.md "no GitHub CI" note predates the ci/\* branches).
- Placeholders pending owner input: `<LIVE URL>` (Netlify production URL),
  `<AUTHOR SURNAME>`/`<AUTHOR GIVEN NAME>`/`<AUTHOR ORCID>` and
  `<DATE RELEASED>` in CITATION.cff, `<PROJECT OWNER NAME>`/
  `<PROJECT OWNER EMAIL>` in CLA.md, and CLA signature fields.
- CITATION.cff keeps `orcid` and `date-released` as commented placeholders:
  the cff 1.2.0 schema requires a digit ORCID pattern and an ISO date, so
  literal placeholder strings fail `cffconvert --validate`. `url` uses
  `https://<LIVE URL>` so the file validates while the placeholder stays
  visible.
- `web/scripts/record-media.mjs` is new (no Files block covers it): it
  regenerates docs/media/ via a Playwright-recorded video; GIF conversion
  used the imageio-ffmpeg static binary since no system ffmpeg exists.
- CLA.md is an ASF ICLA v2.2 adaptation with an added sublicensing /
  relicensing grant (for future dual licensing); marked "DRAFT — requires
  owner review" and is not enforceable until the owner approves and CLA
  Assistant is configured on the repo.
- Branch pushed and PR opened on explicit instruction, overriding the
  default "commit but do not push" workflow.

## chore/agent-workflow-ci: CI restored, agent workflow updated

- GitHub CI now exists (`.github/workflows/ci.yml`, `fuzz.yml`; see
  "CI: .github/workflows/ci.yml" above), so the plan's "No-CI override"
  note is marked **Superseded** — kept in place for history.
- `AGENTS.md` Workflow rules updated: run `./scripts/check.sh` before
  pushing; push the task branch and open a PR with `gh pr create`
  (body = Final summary); a PR is done when `gh pr checks --watch` is
  green; the human merges. Deviations still land here, in the same PR.
- `.devin/skills/neophylo-task`: commit → push → `gh pr create` →
  `gh pr checks --watch` → fix until green → report PR URL and checks.
- `.devin/skills/neophylo-review`: accepts a PR number or task number,
  reviews `gh pr diff`, requires `gh pr checks` green, and posts the
  verdict via `gh pr review --comment`.

## Task 2 (v1.1): protein fixtures

- Files outside the Files block: `scripts/ci/fixture-guard.sh` — the
  regeneration order is swapped to `generate_phylip.sh` then `generate.R`.
  `generate.R` must read `ref/protein_*.json` back (protdist JTT tie check)
  and is the last writer so `second_opinion` survives; `README.md` documents
  the same order for manual runs.
- Ambiguities resolved:
  - `assert_no_nj_ties` now exempts exactly one case: at four active nodes a
    min-Q pair and its algebraic complement always tie (Q(i,j) = Q(k,l)
    identically), and either join gives the same split with identical branch
    lengths, so it cannot bias a fixture. `p10_400` hit this benign tie
    bit-for-bit; the DNA corpus previously escaped it only through float
    noise. Ties between different splits still fail, at every n.
  - `protein_p12_100` has three saturated Kimura pairs; `protdist` writes
    `-1` for saturated cells (documented PHYLIP convention). Task 6's corpus
    test should treat `-1` as `Saturated` rather than a numeric distance.
  - `second_opinion.generator` records `phangorn <v> / ape <v>` (both
    packages are used); the plan's sketch showed `phangorn <v>` only.
  - protdist reaches Kimura after 3 `P` toggles on PHYLIP 3.697; the count
    is read off the menu output each run, per the task.
  - `as.phyDat` takes no `type =` argument on an `AAbin` (it dispatches to
    `phyDat.AA`), and `ape::dist.aa` requires the matrix form
    `as.matrix(aln)` — both produce the same values the task intends.
- `worked/protdist_doc_jtt.json` was hand-entered from the plan's published
  values and additionally verified locally: `protdist` 3.697 on the five
  doc sequences reproduces all ten upper-triangle entries exactly.
- Protein refs live at `ref/protein/<name>.json`, not the plan's flat
  `ref/protein_<name>.json`: `tests/corpus.rs` flat-globs `ref/*.json` and
  replays every fixture's input through `parse_fasta`, which cannot read
  protein until Task 3. A subdirectory is skipped by that glob, keeping
  the corpus DNA-only; Task 6 should glob `ref/protein/` (the fixture
  guard bars touching `crates/` in this PR, so the corpus test itself
  cannot be adjusted here).
- `second_opinion` matrices are rounded to 8 decimals: `dist.ml` is an
  iterative optimizer whose last ~1e-14 differs between BLAS/R builds, so
  full-precision output made CI regeneration differ from local output.
  8 decimals is still far finer than the ~0.1 protdist↔phangorn residual
  it cross-checks.
- Note for Task 6: max |protdist JTT − phangorn JTT| over this corpus is
  ≈ 0.12 (second opinion is a cross-check, not a gate, per spec §6.1).

## Task 3 (v1.1): alphabet, detection and override

- Files outside the Files block:
  - `crates/neophylo-core/src/lib.rs` — the new `alphabet` module must be
    declared and its items re-exported.
  - `crates/neophylo-core/src/sim.rs` and `tests/dist.rs` — struct-literal
    `Alignment` constructions needed the new `alphabet` field
    (`Alphabet::Dna`; JTT simulation arrives in Task 7).
  - `web/src/engine/generated/{Alphabet,Alignment,NeoError}.ts` —
    regenerated by `scripts/build-wasm.sh`/`export_bindings`; the wasm CI
    step diffs this directory against the commit, so the new field and
    variant ship here.
  - `web/src/explain/errors.ts` — its `NeoError` switch is exhaustive via
    a `never` check, so `ModelAlphabetMismatch` needed a case to keep the
    web build compiling. Wording follows the plan's Task 10 template
    ("JC69 is for DNA; this data is protein. Choose p, Kimura or JTT.");
    Task 10 may still adjust it.
  - `web/src/state/session.test.ts`, `web/src/state/url.test.ts`,
    `web/src/export/rscript.test.ts` — `Alignment` object literals needed
    `alphabet: "dna"` for the new required generated field.
- Deliberate change recorded per the plan: `tests/seq.rs::unsupported_char`
  now uses `AC#T`/`'#'` because DNA input containing `X` is detected as
  protein rather than rejected.
- Ambiguities resolved:
  - `with_alphabet(_, Dna)` uses the v1 DNA rules (shared validator);
    the plan's `MKV` test example was invalid and was replaced by `MEV`.
  - `parse_fasta` is now two-phase: sequences are collected raw
    (uppercased), the alphabet is detected, then characters are validated
    and normalized. This is required so `U` stays selenocysteine
    (missing) in protein instead of being normalized to `T` before
    detection could run. Error precedence is unchanged: parse errors,
    then `UnsupportedCharacter`, then `UnequalLengths`.
  - `ModelAlphabetMismatch.model` carries the exercise-file spelling via
    `DistModel::name()` ("p", "JC69", "K80"), matching the plan test's
    `model: "JC69"`.
  - Detection of input with no countable characters (all `-`/`?` or
    empty) falls through to `Protein`, the spec's "otherwise" arm.

## Task 4 (v1.1): PHYLIP parser and matrix writer

- Files outside the Files block:
  - `crates/neophylo-core/src/lib.rs` — required to register `pub mod phylip`
    and re-export `parse_phylip`, `write_phylip_matrix`, `NameMode`.
  - `crates/neophylo-core/fuzz/Cargo.toml` — required `[[bin]]` registration
    for the new `phylip` fuzz target.
  - `crates/neophylo-core/fuzz/Cargo.lock` — the committed lock was stale
    (pinned `ts-rs 10.1.0` while `neophylo-core` requires `ts-rs = "12"`);
    the first `cargo fuzz` build re-resolved it to the 12.0.1 the main
    lockfile already uses.
- Ambiguities resolved:
  - Spec §3.2 does not say which error `Auto` reports when both name modes
    fail. The Relaxed error is returned: Auto prefers Relaxed, and its
    messages name tokens that appear verbatim in the file (e.g. "taxon 'c'"),
    whereas a failed Strict parse reports mangled names like "a ACGT".
  - Interleaved continuation lines are assigned to taxa in order, restarting
    at the first taxon after each blank line; without blank separators the
    assignment cycles `i mod n`. Sequence-wrapped sequential input (allowed
    by PHYLIP but not described in §3.2) therefore errors on the site count
    rather than silently mis-assigning.
  - `NameMode` carries serde derives but no `TS` derive yet; Task 8 adds the
    wasm boundary and can derive it then.
  - Sequence data must be ASCII; non-ASCII characters are rejected, never
    truncated (found in Task 4 review).

## Task 5 (v1.1): model module and generated JTT constants

- Files outside the Files block:
  - `crates/neophylo-core/src/lib.rs` — required to register `pub mod model`
    and re-export `JTT` / `RateModel`.
- Ambiguities resolved:
  - `jtt.dat` (PAML `dat/jones.dat`) frequencies sum to 1.000001; the
    generator renormalizes π to exactly 1 before building Q. Without this
    `freqs_sum_one` (1e-12) fails. Effect on distances is ~1e-6 relative,
    far inside the Task 6 parity tolerance.
  - `--check` compares regenerated vs committed constants at rtol 1e-12
    plus atol 1e-14 (the task's "1e-12 relative" alone cannot hold for the
    ~1e-16 stationary eigenvalue). It also verifies the header's embedded
    input SHA-256 equals `jtt.dat`'s, covering the spec §6.2 checksum test.
  - `model::jtt_constants` is `pub` so integration tests rebuild
    `Q = U·diag(λ)·U⁻¹` from the committed constants (the plan's `normalized`
    / `reversible` tests); `RateModel`'s eigendecomposition fields stay
    private per the plan's sketch.
  - `RateModel` keeps spec §3.3's `pub n: usize` field (= 20); the plan's
    Produces sketch omitted it.
  - The generated file carries a scoped
    `#![allow(clippy::excessive_precision)]`: the 17-significant-digit
    literals are deliberate (exact f64 round-trip), and clippy's 387 hits
    on them were noise.
  - `scripts/ci/rust.sh` uses `python3` (the task says `python`; Ubuntu
    runners ship only `python3`) and installs `numpy==2.4.6` — the pinned
    version used to generate the committed constants — only when numpy is
    not already importable.
  - ~~JTT data license: GPL-3.0 (PAML repo, commit 368238e); compatible with AGPL-3.0-only. Blocks a
    proprietary dual license until replaced with a permissive or original-paper source (owner, Task 5).~~
    **Superseded in Task 6:** the PAML `jones.dat` data was replaced by the spectral decomposition
    embedded in PHYLIP 3.697 `protdist.c` (parity reasons below). PHYLIP 3.696+ is BSD-2-Clause —
    upstream `src/COPYRIGHT`, confirmed against the 3.697 tarball — so no GPL encumbrance remains and
    the proprietary-dual-license blocker is gone. The notice is carried in `data/models/README.md`,
    the generated `jtt_constants.rs` header, and `THIRD_PARTY_NOTICES.md`; the S+π input path was
    removed from `scripts/gen_models.py` so the shipped model derives from PHYLIP only.

(Conflict-resolution note, added in Task 6: this file reached `main` with
unresolved `<<<<<<<`/`=======`/`>>>>>>>` markers between the Task 5 entry
and the following ci/release entry. Both entries were kept verbatim.)

## ci/release-only-production: production deploys only on releases

- Netlify bills 15 credits per **production** deploy while preview/alias
  deploys are free, so `ci.yml` no longer runs `netlify deploy --prod` on
  every push to `main`. Production now deploys only on `v*.*.*` tag pushes
  and on `workflow_dispatch` runs of `main`; `environment: production`
  resolves only for those two triggers.
- Pushes to `main` deploy a free `--alias main` deploy instead
  (`main--<site>.netlify.app`), reported via `$GITHUB_STEP_SUMMARY` — no
  PR comment (there is no PR to comment on).
- PR previews are unchanged (`--alias pr-<n>`, same-repo PRs only).
- Tag-triggered runs keep the full test gate: `deploy`'s `needs` list is
  untouched and `web` builds `dist` from the checked-out tag, so the
  artifact deployed is exactly the tagged code.
- `environment` is now a three-way expression (production / staging /
  preview). A `workflow_dispatch` from a non-main ref runs the tests but
  deploys nothing.

## Task 6 (v1.1): protein distances — JTT constants, optimizer, pair detail

- **Spec deviations, forced by the fixtures (investigated per the task's
  "do not adjust tolerances; investigate constants/scaling and report"):**
  - **JTT constants source changed.** `data/models/jtt.dat` no longer
    holds PAML `dat/jones.dat` but the spectral decomposition embedded in
    PHYLIP 3.697 `protdist.c` (`jtteigs`/`jttprobs`, "due to Elisabeth
    Tillier"), transcribed verbatim. Cause: protdist's JTT is a different
    JTT variant than PAML's (Kosiol & Goldman 2005 documents the
    divergence) — its frequencies and exchangeabilities differ ~1–2%,
    shifting ML distances ~0.5% (~2e-3), far beyond the 5e-7/5e-5 parity
    tolerances. Reconstructing the rate matrix behind the embedded
    decomposition (Q = Π⁻¹ Cᵀ Λ C, re-decomposed) reproduces protdist only
    to ~2.3e-6 — the embedded data carries ~1e-7 precision noise — so the
    coefficients themselves are shipped as the constants. The generator
    emits `U_INV = C` verbatim and `U[i,k] = C[k,i]/πᵢ`, making the
    engine's `π_x·P_xy(t)` arithmetic identical to protdist's `predict`.
    Old `jtt.dat` (jones.dat) remains in git history; its sha256 is
    `f7df96390900e22ee1a3b7d63bec10c227eca8ee5ca5a50b6d1978c7d2c74725`.
  - **Optimizer is protdist's Newton loop, not spec §3.4's Brent.** The
    doc pair (0,4) likelihood has a ~1e-7-wide flat plateau at its peak;
    the fixture's printed `1.365098` encodes where protdist's 20-iteration
    Newton lands in the plateau (≈1.36509751), which is _not_ the f64
    argmax (≈1.36509745 — outside the 5e-7 tolerance). Replicating
    `makedists` (tt=0.1, delta=tt/2, curvature/delta-halving rules,
    protepsilon=1e-5 floor, divergence above tt=1e4, 20 iterations) hits
    every doc cell inside 5e-7 and the corpus inside ~1e-9, and converges
    to a true stationary point — `slope_at_peak` (|L′| < 1e-6) fails under
    pure Brent, whose f64 evaluation noise limits landing accuracy to
    ~2e-7.
  - **Brent fallback added on review.** Newton's result is accepted only
    when the loop ends inside [0,10], finite, with a stationary slope
    (|L′| ≤ 1e-6 per comparable site — a per-site threshold, since the
    slope sums over sites). Step size alone is not the criterion: the
    protepsilon floor can pin tt while the slope stays large, and
    delta-halving can shrink steps while the iterate still drifts.
    Anything else — non-convergence, non-finite, out of [0,10] — falls
    back to a bounded Brent search on [0,10] (tol 1e-10 in d). The
    bounded search also owns the `Saturated` call (maximum within 1e-6
    of 10), replacing the earlier `tt ≥ 10−1e-6 || diverged` mapping,
    since the Newton trajectory has no guarantee of finding the true
    maximum near the bound. `newton_never_worse` (500 seeded random
    pairs, lengths 20–400, near-identical to near-saturated) checks
    logL(newton) ≥ logL(brent) − 1e-9 wherever Newton reports
    convergence; `optimizer_estimates` is a `#[doc(hidden)]` test hook
    exposing both argmaxes.
  - **Likelihood evaluated spectrally** (`Σ N_xy·ln(Σ_k c_k(x)c_k(y)e^{λt})`
    via `RateModel::site_prob_derivs`, added `pub(crate)` in `model.rs`)
    rather than through `transition_probs`: same value, but identical
    per-site arithmetic to `protdist`'s `predict`, which the Newton
    trajectory requires.
  - **phangorn second-opinion residual measured at 0.120**
    (max |NeoPhylo−phangorn| on the protein corpus, protein_p12_100
    P05–P08: NeoPhylo 7.708440, phangorn 7.588787) — confirming the
    Task 2 note's ~0.12: phangorn's JTT is yet another variant, so the
    corpus test only asserts the residual is finite. By NeoPhylo
    distance band, max |abs|/max rel: d<0.5 → 0.0033/0.011,
    0.5–1 → 0.0082/0.0095, 1–2 → 0.0157/0.011, d≥2 → 0.120/0.017.
- **Files outside the Files block:**
  - `crates/neophylo-core/src/model.rs` — `pub(crate) site_prob_derivs`
    helper (spectral joint probability + two derivatives).
  - `crates/neophylo-core/src/model/jtt_constants.rs` — regenerated (see
    constants change above).
  - `data/models/jtt.dat`, `data/models/README.md`,
    `scripts/gen_models.py` — spectral input format. The S+π
    (PAML `jones.dat`) input path was removed on review, so the shipped
    model derives from PHYLIP only; `THIRD_PARTY_NOTICES.md` at the repo
    root carries the PHYLIP BSD-2 notice, as do `data/models/README.md`
    and the generated `jtt_constants.rs` header.
  - `crates/neophylo-core/tests/model.rs` — `normalized`,
    `p_zero_identity`, `rows_sum_one` relaxed from 1e-12 to a documented
    `DATA_TOL = 5e-6`: the embedded decomposition is self-consistent only
    to ~1e-6 (float32-era constants; C row 0 sums to 1.0000005). The
    structural tests (`reversible`, `rows_sum_zero`, `eigvals`,
    `freqs_sum_one`) remain at 1e-12 and still pass.
  - `web/src/engine/generated/{DistModel,PairDetail}.ts` — regenerated
    by `cargo test -p neophylo-wasm export_bindings` (per AGENTS.md).
  - `web/src/export/rscript.ts` — `tsc` requires exhaustive `DistModel`
    keys after the new variants; protein corrections now throw a clear
    "not yet supported" error rather than emit a wrong `ape::dist.dna`
    script (they are unreachable until the protein UI task lands).
  - `docs/decisions.md` — also resolved the pre-existing merge conflict
    on `main` noted above.
- Ambiguities resolved:
  - `PairDetail.jtt` for a saturated pair samples its curve on [0,10]
    (the spec's search bound), consistent with §3.4's note that the
    curve's last point is the peak for ordinary pairs.
  - `DistModel::name()` returns `"Kimura"`/`"JTT"` to match fixture keys.
  - The engine reports `Saturated` wherever protdist writes `-1`
    (divergence or bound hit); `protdist_corpus` maps fixture `-1`s to
    `Saturated` the same way.
  - Owner sign-off: JTT variant = PHYLIP protdist (matches existing labs to printed precision);
    BSD-2-Clause notice retained.
  - Owner sign-off: model invariant tolerance 5e-6 (source data precision), was 1e-12.
  - Owner sign-off: Newton (protdist-compatible) with Brent fallback; newton_never_worse guards it.
  - phangorn JTT differs by ~1–1.7% relative across all distance bands (systematic variant
    difference, not error); owner reviewed (Task 6).

## Task 7 (v1.1): JTT simulation and golden

- Files outside the Files block:
  - `web/src/engine/generated/SimModel.ts` — regenerated by
    `cargo test -p neophylo-core export_bindings` (per AGENTS.md);
    `SimModel` gained the `Jtt` variant.
- Ambiguities resolved:
  - The JTT golden lives in a new `fixtures/sim_golden_jtt.json`
    (one `jtt_seed4` case), leaving the frozen v1
    `fixtures/sim_golden.json` byte-identical, as the task requires.
  - `root_composition` uses zero-length branches `(A:0,B:0)` so tip
    sequences equal the root draw; `P(0)`'s ~1e-6 off-diagonal noise
    (embedded-constants precision, Task 6) is far below the 0.01
    tolerance.
  - `jtt_beats_p_in_aggregate` spreads 20 seeded two-leaf pairs evenly
    over path lengths [0.5, 1.5] (`(A:d/2,B:d/2)`, seeds 100–119, 1,000
    sites) and compares mean absolute errors.
  - `mutate`'s DNA-site match gained a `SimModel::Jtt` arm returning
    "same" purely for exhaustiveness — `evolve` routes Jtt through
    `mutate_protein` before `mutate` can see it.
  
## Flaky-test fix: App.test.tsx "syncs the heatmap to the highlighted join"

- Failed intermittently on main (seen in CI; ~2% locally — 1 failure in
  50 runs). Failing assertion: `aria-rowcount` expected `"4"`, got `"5"`
  — the ArrowRight keydown was silently dropped and the step never
  advanced.
- Root cause: `Stepper` attaches its global ←/→ handler to `window` in a
  `useEffect`. `findByRole` resolves on the DOM commit (MutationObserver,
  a microtask) while the session's `setSession` arrives from an async
  init continuation outside `act`, so passive effects — including the
  listener attach — are still queued when the test fires the key. The
  event hits a `window` with no listener; nothing is retried.
- Fix: new test helper `pressKey(key, target = document.body)` in
  `web/src/test/keys.ts` — `await act(async () => {})` then
  `fireEvent.keyDown`. It replaces every `document.body` keydown that
  relies on the global listener (the other two sites had the same latent
  race): App.test.tsx "syncs the heatmap …" and "shows only leaves at
  step 0 …", plus App.prompts.test.tsx "gates the stepper …". Cell-
  targeted keydowns (matrix grid navigation, Enter picks) go through
  React's onKeyDown prop, not the window listener, and are unchanged.
- Convention: tests must use `pressKey()` for global keyboard
  shortcuts, never bare `fireEvent.keyDown(document.body, …)`.
- Verified: 100 consecutive `vitest run src/views/App.test.tsx` passes
  and 20 consecutive full web suite runs pass.

## Task 8: exercise schema v2

- Files outside the Files block: `crates/neophylo-core/src/lib.rs`
  (re-exports for the new public types), `src/dist.rs` (`supports` promoted
  to `pub(crate)` so exercise validation can reuse the §3.4 table),
  `src/phylip.rs` (`#[derive(TS)]` on `NameMode` so `PhylipParseResult.
  names_used` generates a named type), `tests/exercise.rs` (v1 tests
  updated to the normalized v2 `Exercise` shape), and the web bridge
  needed to keep the build green against the new `Exercise` type:
  `state/session.ts`, `state/url.ts`, `state/urlRestore.ts`,
  `views/App.tsx`, `views/Controls.tsx`, `views/TeachingNotices.tsx`,
  `lessons/lessons.test.ts`, and the `Exercise` literals in the
  session/url/App/sandbox/TeachingNotices/ImportPanel tests.
- The web bridge is deliberately minimal; Task 9 owns the real session
  changes (`reference`, `alphabet`, URL `v: 2` + migrate). Until then:
  `Session.trueTree`/`trueTreeOrigin` are unchanged, an embedded
  exercise loads its FASTA as `alignmentOrigin: "imported"` with the
  `reference` tree standing in for RF comparison, sim controls hide when
  `exercise.data.kind` is "embedded", and `sessionUrlState` omits the
  `sim` override for embedded data. Old `#x=` v1 exercises decode to the
  wrong shape until Task 9's migrate() — URLs are still `v: 1`.
- Spec-silent details resolved: a `schema_version: 2` file in flat v1
  shape reports `InvalidExercise { field: "alphabet" }` (first missing
  v2 field), not a version error. The declared alphabet is
  authoritative for embedded data; detection is only a default, so a
  declared-vs-detected mismatch is not an error (`ModelAlphabetMismatch`
  remains only for model-vs-alphabet, e.g. a JTT sim declared "dna" or
  a "JC69" correction on protein data). A normalized `Exercise` always
  reports `schema_version: 2`, including migrated v1 inputs.
- Review fixes: `session.ts` `load` re-tags an embedded alignment with
  `withAlphabet(exercise.alphabet)` so a DNA-looking protein lesson can
  run protein corrections; `exercises/schema.json` now validates
  schema_version 2 only (the engine still accepts v1 for old links) and
  `schema.test.ts` asserts every `exercises/*.json` declares version 2.
  The `__fixtures__` files were converted to v2 so the schema/engine
  agreement tests keep exercising their specific validation rules.
  `load_v1` gained the DNA `supports` check for `analysis.correction`
  and the `JTT` sim-model check — the shared `analysis()` parser accepts
  the "Kimura"/"JTT" spellings, so without it a v1 exercise could load a
  protein-only model and fail downstream instead of at load
  (`ModelAlphabetMismatch`; regression tests `v1_rejects_protein_*`).
- Wire vs file shape: `Exercise`'s derived serde emits engine spellings
  (`"Jc69"`, `{ "K80": { "kappa": ... } }`) on the wasm boundary — the
  file-shape mirror lives only inside `load_exercise`, exactly as v1 did.
  Safe because `#x=` exercises are trusted objects (never re-parsed) and
  no code round-trips a serialized `Exercise` through `loadExercise`.
- Owner sign-off: the plan's Task 8 protein_validation case 2 was wrong (A/C/G/T are valid amino acids). Declared alphabet is authoritative; embedded DNA-looking protein declared "protein" loads. Confirmed by owner 2026-10-17.
## Task 9 (v1.1): web session reference/alphabet, URL v2

- Files outside the Files block, all required by the `trueTree`/`trueTreeOrigin`
  → `reference` rename and `v: 1` → `v: 2` bump: `web/src/state/urlRestore.ts`
  (reads the renamed fields, writes `v: 2`), `web/src/views/App.tsx` and
  `web/src/views/TeachingNotices.tsx` (read `reference.tree`), and the test
  files `web/src/views/ImportPanel.test.tsx` and `web/src/views/App.url.test.tsx`
  (assert on the renamed field / encode a `v: 2` state).
- The plan says 12 capture cases but lists 13 items; all 13 were captured.
- Ambiguities resolved:
  - Embedded exercises get a third `alignmentOrigin`, `"embedded"`,
    replacing both Task 8's stand-in `"imported"` and the interim
    `"simulated"` workaround: `recompute` parses `data.fasta` for
    `"embedded"`, simulates only for `"simulated"`, and never touches
    `"imported"`. `importTree` restores the exercise's own origin
    (`"embedded"` or `"simulated"`), so the embedded alignment is
    re-parsed — not re-simulated — against the imported reference.
    `"embedded"` does not count as user data: `hasImportedData` stays
    false, `sessionUrlState` never writes the lesson FASTA into
    `imported`, and the sim controls and the re-simulation saturation
    fixes ("Use longer sequences", "Use shorter branches") are
    disabled/hidden for `"embedded"` exactly as for `"imported"`,
    with the "real sequences" tooltip on disabled sim controls so no
    control is visible and inert. Tests `embedded_origin`,
    `embedded_link_size` and `embedded_saturation_fixes` cover the
    three-valued origin; the earlier `embedded_not_resimulated` case
    was folded into `embedded_origin`.
  - A simulated exercise with `reference: null` still gets the
    `data.true_tree` as its `kind: "true"` reference (v1 parity: RF
    against the sim tree); a declared reference with a different
    topology is compared against, but simulation still runs along
    `data.true_tree` (an imported reference is simulated along, per the
    unchanged `importTree` rule).
  - An imported tree is `kind: "true"` (the user supplies the truth to
    compare against); Task 10 owns kind-aware tree titles.
  - `migrate()` fills `alphabet: "dna"` on imported alignments missing
    the field (v1 links), in both `#x=` and `?d=` paths; the engine's
    serde default would make it DNA anyway.
  - The corpus test compares matrices at JSON level (`JSON.stringify`
    round-trip) because JSON cannot express `-0`, which the engine
    legitimately produces for zero distances.
- `imported.trueTree` stays the wire field name in v2 states; imported
  trees are always kind "true" so no kind field is carried.

## Task 10 (v1.1): alphabet badge, model menus, PHYLIP import, reference labels

- Files outside the Files block:
  - `web/src/state/session.ts` and `web/src/state/session.test.ts`: the
    task's Produces interface is a *reducer action* (`setAlphabet`), so
    the session reducer had to change; the tests exercise it.
  - `web/src/views/TreeView.tsx`: `title` widened from the
    `"True tree" | "Inferred tree"` union to `string` so App can pass
    the classification caption (the Files block changes titles "via
    App.tsx"; the prop type had to follow).
  - `web/src/views/TeachingNotices.tsx` (+ test): the tree-comparison
    notice is the other "RF text" (spec §5.3); it now says "accepted
    classification" for `kind: "classification"`, matching the Stepper
    wording.
  - `web/src/index.css`: styles for `.alphabet-badge`,
    `.alphabet-notice` and `.phylip-names`.
  - `web/src/views/Controls.test.tsx` is a new test file (the Files
    block's "their tests"); there was no Controls test before.
- Ambiguities resolved:
  - `setAlphabet` sets a new `Session.notice: string | null` (Session
    had no notice field). It renders as a `role="status"` line in the
    notices area and is cleared by the next model- or data-changing
    action so it can't go stale.
  - For `alignmentOrigin === "simulated"` the override does not call
    `withAlphabet`: `recompute` re-simulates from `sim.model`, so the
    sim model switches to the target alphabet's default and the
    alignment is re-simulated (calling `withAlphabet` would either be
    discarded or spuriously fail on real protein letters). Imported and
    embedded alignments are reinterpreted via `withAlphabet` as the
    spec says; a successful embedded override flips the origin to
    `"imported"`, because staying "embedded" would re-parse
    `data.fasta` and undo it. A failed `withAlphabet` keeps the data
    and stores the error — never a stuck state.
  - The classification readout's N is `rf.missing_in_inferred.length`,
    matching the existing "differs … in N clade(s)" notice count (the
    outlined clades), not the raw RF distance.
  - The PHYLIP names toggle keeps the last pasted text in component
    state and re-parses with the chosen mode forced; a failed re-parse
    shows the parse error in-panel and keeps the previous alignment.
  - `docs/media/sandbox-{dna,protein,phylip}.png`: the task requires a
    PR "with screenshots of DNA and protein sandbox"; they were
    committed first, then removed in review — the PR's Netlify preview
    link is the evidence (new AGENTS.md hard rule 10: only README media
    goes in `docs/media/`).
- Review fixes (same PR):
  - `simModelName` and the label→`SimModel` mapping in `Controls.tsx`
    are now exhaustive switches over the `SimModel`/`SimModelName`
    unions ending in `never` checks — no fallback covers "any other
    string" or "any object", so a future variant fails to compile
    instead of silently picking a default.
  - When `sim` is `null` (embedded data) the Simulation section now
    renders with every control disabled under the "This lesson uses
    real sequences; they can't be re-simulated." tooltip and the model
    menu shows no model name (a disabled empty option) instead of
    hiding the section or fabricating "Jc69".
  - `AlphabetBadge` gained an `alignmentOrigin` prop (wired in
    `App.tsx`): the "Treat as" override is shown only on imported or
    embedded data. On simulated data the badge just names the alphabet
    — the sim model menu controls it, respecting lesson locks.
- Review fixes, round 2 (found at checkpoint 10):
  - `reconcileModels(session)` in `session.ts` centralizes the
    model/alphabet reconciliation that `setAlphabet` used to do inline:
    a correction or sim model invalid for the current alphabet switches
    to the alphabet's default (DNA → JC69, protein → JTT) with a
    notice. It now runs on every alphabet/data path — `load` (including
    embedded), `setAlphabet`, `importAlignment` (FASTA and PHYLIP),
    `importTree`, `enterSandbox`, `exitSandbox` (via `load`) — because
    importing protein after the DNA lesson errored with JC69 kept, and
    importing DNA PHYLIP under JTT errored the other way.
  - `importTree` reconciles against the alphabet the action will
    display — the declared alphabet for embedded data, the sim model's
    own alphabet (`simModelAlphabet`) for simulated data — not the
    stale `session.alphabet`, which can still describe the imported
    alignment the action discards.
  - The negative-branch notice no longer says "the trace is never
    altered"; it now reads "The calculated value is shown unchanged;
    use 'set to zero' to draw it as 0."
  - New tests: `web/e2e/alphabet.spec.ts` (default lesson → Sandbox →
    import `fixtures/inputs/protein/p6_150.fasta` gives the protein
    badge, JTT selected and a 6×6 matrix; nj-basics shows the badge
    with no override button), reducer cases for both reconciliation
    directions in `session.test.ts`, and a per-alphabet "select value
    ∈ displayed options" invariant in `Controls.test.tsx`.

## Task 11 (v1.1): pair panel and likelihood curve

- Files outside the Files block (all "Modify"; the block listed only
  Creates):
  - `web/src/views/App.tsx`: the Files block has no entry for wiring,
    but Consumes is the heatmap's `onPick` and the panel opens "when a
    matrix cell is activated" — App owns `onPick`. Added the `pair`
    state, `onPickPairCell` and the `pairDetail` memo, branched
    `onPick`, and rendered `<PairPanel>` at the `.app` root.
  - `web/src/index.css`: styles for `.pair-panel*`, `.pair-seqs`,
    `.pair-numbers`, `.likelihood-curve` and the Okabe-Ito
    property-class tints, same as prior tasks recorded their view CSS.
  - `web/e2e/pair-panel.spec.ts`: a new e2e spec rather than an edit
    to `a11y.spec.ts`. The required "axe has no violations" test can
    only run in e2e — `@axe-core/playwright` is the only axe binding
    in the dependency list, and adding `axe-core`/jest-axe for jsdom
    would be a new dependency the plan doesn't name.
- Ambiguities resolved:
  - `PairPanel`'s `detail` prop is typed `Result<PairDetail>` (the
    `engine.jttPairDetail` return), not `PairDetail`: Review Focus 5
    requires the panel to render the "no comparable sites" message
    *inside the open panel*, and only the engine `Result` carries the
    `InsufficientOverlap` error. Other engine errors fall back to the
    shared `errorMessage` text, so the panel can never crash the app.
  - "A matrix cell is activated": the pick stores the cell's cluster
    labels; the panel opens only when both labels are taxon names
    resolvable to alignment sequences. Cells involving a joined
    cluster (u1, u2, …) — which appear in the distance view from step
    1 on — do not open it, since `jtt_pair_detail` is defined over
    alignment sequences only. The diagonal is allowed: an i==j pick is
    a genuine identical-pair detail (d̂ = 0).
  - "No predict prompt is active" is implemented as `gating === null`
    (the unanswered `predict_pair` at this position). An answered or
    `note` prompt does not block the panel.
  - d̂ in the Math lines uses `fmt` (3 decimals, trailing zeros
    trimmed) to match the explanation panel's math convention; the
    numbers row uses `toFixed(3)` so the identical pair reads
    "0.000" as the task's test requires.
  - The peak marker sits on the curve at d̂ by linear interpolation
    between the two bracketing samples; `d_hat` is not a curve grid
    point in general.

## Task 11 (v1.1) checkpoint-11 fixes

- **Explanation follows `Session.mode`.** The panel used to render the
  Concept sentence and the KaTeX lines at once and had no mode control
  of its own, while the main toggle sits outside the dialog's focus
  trap. The panel now renders only the active mode's text and carries
  the same toggle component in its header — `ModeToggle`, extracted
  from `ExplanationPanel` into `web/src/views/ModeToggle.tsx` — bound
  to the same `Session.mode` via `setMode`, so switching in either
  place switches both. Spec §5.2 gained the line "The panel's
  explanation follows the global Concept/Math mode and has its own
  synced toggle."
- **Sequence comparison is a column grid.** The marker row was a text
  string of "×"/spaces whose blank cells collapsed, misaligning
  markers; the strip is now one fixed-width `.pair-col` per alignment
  position (position number every 10 columns, top residue,
  ×-or-blank marker cell, bottom residue) inside a horizontally
  scrolling `.pair-seq-strip`, with a static label legend beside it.
  No text strings carry alignment spacing.
- **Likelihood y-window.** logL crashes toward −690 near d = 0 (the
  engine floors probabilities at 1e-300), flattening the drawn peak.
  The y-axis now shows [logL̂ − 15, logL̂] — [max logL − 15, max logL]
  when saturated — plotting starts at the first sample with finite
  logL inside the window, samples below the window clip to the bottom
  edge and get a small `below-range` triangle marker, and ticks label
  d at 0/d̂/right edge and logL at the window's top and bottom.
  `LikelihoodCurve` takes the new `loglHat` prop straight from
  `PairDetail.logl_hat`.

## Task 12 (v1.1) protein lessons

- **`protein-models` seed.** The plan's search ran against the real wasm
  engine (same pipeline the app uses): seeds in order at length 300 on a
  7-taxon true tree with F's branch 3× the others. Seed **39** is the
  first where NJ-on-p gives RF > 0 (RF = 2) and NJ-on-JTT gives RF = 0.
  Under p the wrong join is step 4: E+(A,B) wins a tie over (C,D)+(F,G)
  at Q = −0.698333 while the correct E+(F,G) sits at −0.694167 — the
  reveal sends students to the C–F pair panel (p = 0.42, JTT = 0.61).
- **`protein-models` starts on correction `p`** (the failing default the
  lesson fixes), with `sim.model` and `analysis.method` locked so the
  correction menu is the teaching lever — same pattern as
  `upgma-fails` leaving Method open.
- **`cytochrome-c` data.** Eight UniProtKB reviewed cytochrome c
  sequences (P99999, P00002, P62897, P62894, P67881, Q640U4, Q6IQM2,
  P00044) aligned with MAFFT v7.525 (`--auto`, installed via the
  bioconda conda package because MAFFT was not present on the worker).
  Species, accessions, the exact command and the classification source
  are in `docs/lessons/cytochrome-c-provenance.md`; the owner verifies
  them at the PR gate. NJ join 5 is a tie under JTT, so the only
  predict prompt targets join 1 (human+macaque). The reference Newick
  encodes the accepted unrooted grouping with unit lengths; the
  inferred NJ/JTT tree differs from it in 4 clades (RF 8/10), which the
  closing note discusses as the lesson's point.
- **No lesson index/menu exists** — lessons are served dynamically by
  `?lesson=<id>` — so the Files block's conditional "modify the lesson
  index/menu" was a no-op.
- **Files outside the Files block:** `docs/decisions.md` itself (this
  entry — the workflow requires decisions in the same PR).

### Task 12 owner gate — species set replaced

- **Why:** the first set (4 near-identical mammals + frog + fish + yeast)
  gave RF 8/10 with yeast sliding onto the primate group — cytochrome c
  carries too little signal among mammals and a lone long branch attaches
  arbitrarily, which made a misleading showcase. The owner directed a
  Fitch & Margoliash (1967)-style set spanning deep divergences.
- **New set (8):** human P99999, horse P00004, chicken P67881,
  zebrafish Q6IQM2, Drosophila P04657 (Cyt-c-d, the somatic isoform —
  Cyt-c-p P84029 is larval/testis), wheat P00068 (single canonical gene,
  also in the original 1967 alignment; Arabidopsis rejected — two
  paralogues), yeast P00044, Neurospora crassa P00048.
- **Result:** NJ/JTT recovers all three deep groups (fungi, animals,
  vertebrates) and differs from the classification in **1 clade**
  (RF = 2/10): chicken pairs with zebrafish instead of the mammals —
  the "close vertebrates are uncertain" point the lesson now teaches.
- **Prompt consequence:** join 1 is the fungi pair — the smallest Q but
  not the smallest distance (horse–chicken 0.119 is the matrix minimum).
  The predict reveal exploits that; the e2e picks the fungi cell
  directly because the generic min-distance helper would be wrong.

### Task 12 owner gate, pass 2 — rooting and Drosophila isoform

- **Rooting corrected.** The owner pointed out animals and fungi are
  sister groups (Opisthokonta) with plants outside, so the reference is
  now written as a ladder rooted on wheat:
  `(wheat,((yeast,neurospora),(drosophila,(zebrafish,(chicken,(horse,human))))))`.
  Same unrooted splits as the previous fungi-outgroup rooting, so
  re-rooting alone does not change the RF.
- **Drosophila isoform swapped.** UniProt expression data show P04657
  (cytochrome c-1, Cyt-c-d) is the minor form — "constant, but
  relatively low levels" (testis spermatid + 34 tissues) — while P84029
  (cytochrome c-2, Cyt-c-p) is the somatic form — "varying, but
  relatively high levels" (300+ tissues). The alignment was rebuilt
  with P84029 and the prompt distances re-derived from the new matrix.
- **RF improved 2/10 → 0/10.** With the somatic isoform the NJ/JTT tree
  recovers every clade of the classification, including the vertebrate
  ordering. Join 5 (chicken + mammals) is a trace-flagged tie, so the
  closing note still teaches "close vertebrates are barely resolved"
  honestly instead of a false miss.
- **Prompt consequence:** the predict pair (fungi first, Q-vs-distance
  point) is unchanged; the closing note now asserts RF = 0 with the tie
  caveat rather than the previous single-clade miss.

### Task 12 owner gate, pass 3 — RF = 0 wording and the vertebrate caveat

- **Closing note rewritten.** The join-5 tie was removed as evidence —
  with 8 taxa the last NJ join is a four-node step where a tie is
  guaranteed by construction. The "close vertebrates are barely
  resolved" point now rests on real signal: horse–chicken (0.119) is the
  matrix minimum even though horse sits much closer to human, and NJ
  recovers the classification anyway because it joins by Q, not raw
  distance — the same Q-vs-distance theme as the join-1 predict.
- **New RF = 0 stepper wording** (`web/src/views/Stepper.tsx`):
  "matches the accepted classification in every clade" for a
  classification reference and "matches the true tree in every clade"
  for a true tree, replacing "differs … in 0 clades" and the numeric
  "RF = 0 / N". `Stepper` gained an `rfZero` prop fed from
  `Session.rf.rf === 0`; covered by `Stepper.test.tsx` and the two e2e
  specs. Files outside the Files block: `Stepper.tsx`, `Stepper.test.tsx`,
  `App.tsx`, `App.test.tsx`, `lesson.spec.ts`, `a11y.spec.ts` — all
  required by this owner-gate change.

## Checkpoint 12 lesson UX fixes

- **Conceal answers while a predict_pair gates.** The explanation panel now shows
  "Make your prediction first; the explanation appears after you answer." in both
  modes — the concept/math text names the joining pair and shows its Q values,
  so it had to be replaced wholesale, not blurred (checkpoint-7 styling already
  hid the marked matrix cell). The Distance/Q switch is disabled with the
  tooltip "Available after you answer." and the heatmap is pinned to distances
  (`smShown` in `App.tsx`): the minimum-Q cell IS the answer, so the Q view
  would hand it out. Tree highlights of the joining pair are suppressed
  (stepEmphasis uses `smShown`); hover marks on the student's own picks remain.
- **RF result and wrong-clade outlines are final-step only.** The RF verdict
  appeared mid-trace whenever `session.rf` existed; `TeachingNotices` and
  `stepEmphasis` now require the final position (or a completed tree with no
  trace) before the verdict or red outlines render.
- **`reveal_pair: [label_a, label_b]`** is a new optional Prompt field
  (engine-validated against the alignment/tree labels — the JSON schema only
  checks the shape). An answered card offers "Show a vs b" which opens the
  pair-detail dialog, and the next step's explanation keeps a "Revisit: a vs b"
  link. Wired on protein-models (["C","F"]) and cytochrome-c
  (["horse","chicken"]); both reveals now point at the button instead of a
  matrix cell. Fixes 1–2 affect all lessons with prompts since v1.
- **Alphabet override is Sandbox-only.** "Treat as DNA/protein" moved from
  any non-simulated alignment to `source === "sandbox"` only — in a lesson the
  author chose the alphabet deliberately.
- **Embedded alignments collapse Simulation to one line.** "Real sequences:
  not simulated." replaces the section; imported data keeps the disabled
  controls (a user import should still show what would have run).
- **Unrooted-tree caption at the final step** on NJ lessons with a reference:
  "NJ builds an unrooted tree, drawn here from an arbitrary point. It can look
  different from the reference even when every grouping matches; compare the
  groupings, not the shape." Display-only; a display reroot is on the roadmap.

## Task 13 (v1.1): export additions and "Coming from PHYLIP?"

- **Files outside the Files block:**
  - `web/src/index.css` — styles for `.phylip-help-open`,
    `.phylip-help-map` and `.phylip-note`; all view styling lives there.
  - `web/src/views/App.tsx` is the Files block's "the header (help
    entry)" — the header markup lives there, and it is also the only
    place that owns the session's `matrix` for the new `ExportMenu`
    prop.
- Ambiguities resolved:
  - **JTT parity is a relative tolerance.** `JTT_REL_TOL = 0.02` in
    `web/scripts/r-parity.mjs` (points at Task 6's measured ~1–1.7%
    relative phangorn↔protdist difference). An absolute tolerance fails
    on distant pairs — e.g. protein_p12_100 P05–P08 differs by 0.120 in
    absolute terms.
  - **Protein parity compares distances, not trees.** The exported R
    script prints the distance matrix after the tree via
    `write.table(format(m, digits = 15), quote = FALSE)`; a 1–2%
    relative JTT difference would sink the DNA-style patristic check at
    1e-6. p and Kimura are still checked to 1e-9.
  - The protein script wraps `nj`/`upgma` in `tryCatch` — unestimable
    (NaN) distances make tree building fail in R, while the engine
    reports `Saturated` cells and still runs NJ itself. The printed
    matrix is what parity consumes; a `# tree building failed:` line
    documents the failure for users.
  - The plan's `phyDat(..., type = "AA")` is emitted as
    `phyDat(as.character(aln), type = "AA")` — `as.phyDat` ignores
    `type` on an `AAbin` (Task 2 note), while `phyDat` accepts it.
  - **The `neighbor` round-trip lives inside `r-parity.mjs`** (it needs
    the wasm engine for the matrix, NJ tree and RF); `r-parity.sh`
    locates the binary the way `generate_phylip.sh` does and passes it
    as `PHYLIP_NEIGHBOR`, failing fast when PHYLIP is absent.
    `write_phylip_matrix` output is fed to `neighbor` verbatim and the
    outtree is compared to NeoPhylo's own NJ tree, RF = 0.
  - `ExportMenu.matrix` is the session's leaf `DistanceMatrix`;
    `phylipMatrix()` reports `relaxed` by the engine's own Auto rule
    (any name > 10 chars) and `saturated` so the UI can note the
    `-1.000000` convention (§3.2).
  - `PhylipHelp.test.tsx` sits next to its component (the established
    co-location convention) and also covers the header button.

## Task 14 (v1.1): protein perf check + comparison script

- **The "checkpoint 7 version" of `compare_app.R` does not exist.** No
  commit on `main` ever carried `scripts/compare/compare_app.R` — the
  plan's "from the checkpoint 7 version, extended" refers to a script
  that was never committed. It was written fresh: it takes
  `<alignment> <matrix> <model>` (alignment FASTA or PHYLIP-sequential,
  matrix = the app's `neighbor` export, Strict or Relaxed names
  auto-detected), computes the R distance (ape `dist.dna` /
  `dist.aa`, explicit Kimura, phangorn `dist.ml` for JTT), and prints
  ALL PASS/FAIL. Alphabet is detected from content (the §3.1 rule), so
  `p` serves both DNA and protein alignments. Tolerances: 1e-5 absolute
  for exact models (the export prints 6 decimals); JTT at 2% relative +
  1e-4 floor (Task 6 variant difference); app `-1.000000` cells must
  match R's non-finite (NaN/Inf) cells.
- **Files outside the Files block (all required to meet the 2 s budget;
  measured 31.7 s → 1.75 s):**
  - `crates/neophylo-core/src/model.rs` — `spectral_weights(t)` hoists
    the 20 `exp(λ_k·t)` calls out of `site_prob_derivs`'s per-cell
    spectral sum (was ~168k `exp` calls per pair, 3.3 billion per
    matrix); terms regroup to `(c_k(x)·e_k)·c_k(y)` and λ²·q reuses
    λ·q, saving a multiply per term.
  - `crates/neophylo-core/src/protein_dist.rs` — count tables are merged
    symmetric→sparse (`N_xy + N_yx` for x ≤ y; `J_xy ≡ J_yx` bit-for-bit
    for a reversible model), halving spectral work; `newton_mle` exits
    early once `tt` freezes bit-identically (a stable fixed point in
    every branch — |delta| only shrinks outside the Newton step), exits
    still earlier once the iterate is converged in the same sense the
    final check uses (|slope| ≤ 1e-6·sites at a concave point whose next
    Newton step is ≤ 1e-9 — the remaining protdist iterations only wiggle
    `tt` within ulps), and reuses its last slope for the convergence
    check instead of a 21st evaluation. The early exits roughly halve
    `jtt_ml` (~750 → ~380 ms for the seeded 200×1,000 table, native
    release) with an endpoint identical to the full trajectory's fixed
    point.
  - `web/src/views/MatrixHeatmap.tsx` (+ test) — compact mode for
    n > 64 taxa: cells render as ≤65 fill-bucketed `<path>`s plus one
    focusable overlay rect (hover/click/arrow-keys/Enter picking kept;
    per-cell gridcells and value texts dropped — unreadable at that
    scale anyway). The svg role becomes `group` with
    `aria-label="Distance matrix, n taxa"`.
  - `scripts/ci/e2e.sh` — the `@perf`-tagged spec runs in a second
    Playwright invocation with `--workers=1`: under `fullyParallel` the
    import→render measurement raced other tests (3.5 s vs the 2 s
    budget on this machine); a wall-clock gate needs a quiet worker.
- **Ambiguities resolved:**
  - The perf spec runs against the production preview server (:4174,
    the second `webServer` in `playwright.config.ts`), not the dev
    server — dev React's StrictMode double render is not what the
    shipped budget is about.
  - The spec's "if it fails, print the measured time and stop" is
    implemented as a `console.log` of the elapsed ms plus a hard
    `expect(elapsed).toBeLessThan(2000)` failure message.
  - Measured on this machine: 1,747 ms end-to-end (import → rendered
    200×200 heatmap), of which ~1.2 s is the wasm JTT matrix.
  - Parity preserved: `cargo test -p neophylo-core` is all green,
    including `protdist_corpus`, `jtt_doc_parity`, `slope_at_peak` and
    `newton_never_worse`; the symmetric merge perturbs the Newton
    trajectory by ~1 ulp per term, far inside the 5e-7 doc tolerance.

## Checkpoint 13: Lessons menu + lesson-load reset

- **`summary` is a schema-level requirement, not an engine field.** The
  Lessons menu needs a one-line description per lesson; it is stored as
  `summary` in each `exercises/*.json`. `exercises/schema.json` requires
  it (`minLength: 1`) — deliberately stricter than the engine, like
  `schema_version: 2` — because repository lessons power the menu. The
  engine ignores unknown fields, so `Exercise` gains no field and the
  menu reads title/summary from the raw file text
  (`src/lessons/catalog.ts`, `?raw` imports), not the parsed Exercise.
- **Teaching order lives in the catalog, not the files.** The menu order
  (nj-basics, upgma-fails, saturation, protein-models, cytochrome-c) is
  the array order in `catalog.ts`; a test asserts every
  `exercises/*.json` stem is covered so a new lesson can't be silently
  skipped.
- **`Session.lessonExercise` holds the pristine loaded exercise.**
  `exercise` is the working copy mutated by `setSim`, `setAnalysis` and
  `reconcileModels`; the old `exitSandbox` reloaded `s.exercise`, so
  sandbox tweaks (e.g. a changed correction) leaked back into lesson
  mode. `exitSandbox` now reloads `lessonExercise`. Menu picks avoid
  this entirely by fetching the file fresh.
- **`load` keeps reconcileModels' silent fix but drops its notice.**
  A mismatched exercise can only arrive as a trusted v2 `#x=` payload
  (never re-validated); loading a lesson must not warn about a switch
  the file itself dictates — notices are reserved for user-driven
  changes (`setAlphabet`, imports).
- **Menu picks bypass URL state entirely.** `resolveInitial`'s overrides
  merge applies only to real navigations; an in-app pick dispatches
  `load` directly and the sync writes `?lesson=<id>` with the new
  lesson's own settings.
- **View preferences (`mode`, `clampNegative`, `matrixView`) still carry
  over on load.** They are display prefs no lesson file defines; the
  reset covers lesson state (analysis, sim, locks, step, prompts,
  notice, pair panel).

## fix/fuzz-targets-schema-v2: exercise fuzz target + fuzz-build CI job

- **Cause.** `crates/neophylo-core/fuzz/Cargo.toml` declares its own
  `[workspace]` — the fuzz crate is outside the main workspace on
  purpose (cargo-fuzz needs a nightly libFuzzer build, and isolation
  keeps its `Cargo.lock` and sanitizer flags off the real crates). The
  price: nothing in `cargo test --workspace`, clippy, wasm.sh or the
  rest of CI ever compiles it, so the exercise schema v2 refactor
  (`exercise.true_tree`/`exercise.sim` → `exercise.data: ExerciseData`)
  broke `fuzz_targets/exercise.rs` without breaking a single check.
  The nightly fuzz run was the only compile, and its failure path was
  written for crashes, not build errors.
- **Fix.** `fuzz_targets/exercise.rs` now matches `exercise.data`
  (`Simulated` → `parse_newick` + `simulate`; `Embedded` → `parse_fasta`
  + `with_alphabet(exercise.alphabet)`), then runs `compute` →
  `build_tree(trace: true)` → `rf` against `exercise.reference` when
  present. Every step is `let Ok(..) else { return }` — the target still
  asserts "no panic", not "no error". New seeds:
  `seeds/exercise/embedded_protein.json` (v2 embedded protein, exercises
  the new `Embedded` arm) and `seeds/exercise/v1_jc69_nj.json` (v1, so
  the migration path stays in the corpus).
- Not changed: `fuzz-build` is not in `deploy`'s `needs` — deploy
  gating is unchanged; branch protection is what makes the job
  blocking for merges. The nightly run still drives targets through
  `scripts/ci/fuzz.sh` rather than duplicating the per-target loop in
  YAML.

## v1.1 release docs

- **README**: five-lesson list with `?lesson=<id>` ids, real-data
  authoring description, "How was this distance computed?" feature
  bullet, "Current scope" section, protdist-parity claim, corrected
  `compare_app.R` usage (`<alignment> <matrix> <model>` — no flags, the
  model must match the detected alphabet), one-line deploys bullet
  (details stay in CONTRIBUTING.md), third-party license note.
- **THIRD_PARTY_NOTICES.md**: protdist doc-fixture note; new UniProtKB
  section (CC BY 4.0) for the cytochrome-c lesson sequences.
- **Licenses page** (`licenses.html`, §C): generated at build time into
  `web/public/` (gitignored) by `web/scripts/licenses.ts` — combines
  THIRD_PARTY_NOTICES.md, a cargo-about render (`about.toml`/`about.hbs`,
  scripts/ci/licenses.sh) and npm production deps from
  `package-lock.json`. Footer "Licenses" link in `App.tsx`. Deviations:
  - npm gating is done by the generator itself (reading the lockfile's
    `dev` flags) rather than rollup-plugin-license — equivalent, zero new
    dependencies, and the same accepted list as `about.toml`.
  - The crate list reaches the web build via a CI artifact
    (`web/.licenses/rust-licenses.html`) so the web job needs no Rust
    toolchain; locally without cargo-about the page falls back to a
    placeholder section with a warning.
  - Both crates got `publish = false` so `about.toml`'s
    `[private] ignore` keeps AGPL-3.0-only (the app's own license, not a
    redistributed dependency) out of the `accepted` gate.
  - New `licenses` CI job is the hard gate; it is not added to
    `scripts/check.sh` since cargo-about is an optional local tool
    (documented in CONTRIBUTING.md prerequisites as needed).
- **CITATION.cff**: v1.1.0, release date 2026-10-19, expanded abstract,
  protein/JTT/PHYLIP keywords, ORCID placeholder removed (none yet).
  `cffconvert --validate` passes.
- **roadmap.md**: status line; v1.2 reroot item and v1.3
  layout/saturation-feedback items found at v1.1 checkpoints.

## Checkpoint 13: saturation panel progress feedback

- **The "try again" flag is local component state, not Session.** It
  answers "did the student click a fix in this panel", not a pipeline
  fact — Session stays the single mutator of the pipeline. To get the
  reset-on-resolution without an effect, the saturation section was
  extracted into `SaturationPanel`, rendered only while the error is
  `SaturatedMatrix`: its `fixTried` state unmounts with the panel, so a
  later fresh saturation starts unmarked.
- **Message names the knob that was turned.** "Still saturated at
  length <n>" for Use longer sequences (read back from
  `exerciseSim(session.exercise)`, so it reports the capped value if
  SIM_MAX clamped the doubling); "at branch scale ×<s>" for Use shorter
  branches. `<k> pair(s)` is `sat.cells.length` — the engine's error
  already lists unique i<j pairs. Rendered as `role="status"` so the
  update is announced, matching the alphabet-notice pattern.
- **The lesson's two-click arc is real, verified against wasm:**
  saturation.json at length 50 has 3 saturated pairs, 100 has 4
  (more sites sharpen p estimates — different pairs cross the 0.75
  ceiling), 200 has none. The e2e-style component test drives the real
  file.

## v1.2 Task 2: consensus and support fixtures

- **Canonical grouping side is "not containing `labels[1]`" everywhere.** PHYLIP
  `consense` prints the side not containing *its* species 1 (the first tip of
  the intree), which differs from the fixture's `labels[1]` in several sets —
  `generate_consensus.sh` re-canonicalizes parsed rows instead of depending on
  intree tip order. For rooted sets consense prints clades directly.
- **Extended-majority ambiguity is judged only until the tree is fully
  resolved.** Spec §3.5 stops extension at n-3 splits (unrooted) / n-2 clades
  (rooted); consense confirms this (it never lists compatible sets beyond
  resolution). Ties that occur only below the resolution point cannot make a
  decision order-dependent, so `generate.R`'s seed search and
  `generate_consensus.sh`'s assertion both stop there.
- **`prop.part` is used for the observed grouping inventory** (bipartitions
  for unrooted trees, clades for rooted), deduplicating exact matches;
  `prop.clades` supplies `prop_clades` counts against the reference. Both
  agree to the count in the generators' assertions.
- **Two PHYLIP quirks handled in `generate_consensus.sh`:** the species list
  and set masks wrap every 10 positions, and R's `cat(TRUE)` yields `TRUE`
  while the driver tested lowercase `true` — the flag is normalized before
  the `R` toggle is sent.
- **Files outside the Files block:** `fixtures/generate_consensus.sh` (new;
  invoked at the end of `generate_phylip.sh` — the plan's "in
  generate_phylip.sh run consense" intent kept while honoring the ~400-line
  single-purpose rule), `scripts/ci/fixture-guard.sh` (regeneration diff
  extended to `fixtures/consensus` + `fixtures/worked` so CI reproduces the
  new oracle), and `docs/decisions.md` (this entry).

### Task 2 owner-gate fix: consense `groups` must hold only included sets

- **Bug (found at the PR #39 owner gate):** `consense.<kind>.groups`
  concatenated both outfile tables, so rejected sets like `{C,D}` (count 3,
  incompatible with `{D,E}` and absent from the extended newick) appeared
  in `groups`. Now `groups` is only "Sets included in the consensus tree";
  the "Sets NOT included" table is kept separately as `not_included`.
  Only extended ever prints a NOT-included table, so only `extended`
  changed: hand 3→2 (`groups` now equals `expected.extended`), rmtree_6_20
  23→3, rmtree_8_100 108→5, rmtree_12_200 718→9, rmtree_6_20_rooted 42→4,
  rmtree_8_100_rooted 195→6, boot_jc12 18→9, boot_p8 8→5.
- **New assertions on every set and kind** (fail the generator): `groups`
  equals exactly the non-trivial groupings of that kind's `newick` parsed
  through `prop.part` (same canonical sides); all `groups` are pairwise
  compatible; strict ⊆ majority ⊆ extended. The hand file additionally
  asserts `groups` == `expected` per kind.
- **Trivial-split filter corrected:** unrooted groupings are dropped when
  *either* side has <2 taxa (`min(s, n-s) < 2`), because a degree-2 outtree
  root can print the n-1 side as a "clade" (e.g. the strict star
  `((t1,...,t6),t2)`); rooted keeps n-1 clades. Applied in both
  `grouping_inventory` and the newick `tree_groups` check.
- **jsonlite quirk:** a one-element array-of-arrays simplifies to a
  matrix, so `expected` sets are normalized rows-as-sets before keying.

## v1.2 Task 3: weighted distances

- **`compute` delegates to `compute_weighted`** with an all-ones weight
  vector (the plan permits this "only if `identity_bit_for_bit` passes" —
  it does). One code path means the two cannot drift; every contribution
  is multiplied by 1, so the result is bit-for-bit identical.
- **"Number of alignment columns" is the longest sequence's length**, not
  `seqs[0]`: a ragged hand-built `Alignment` whose `seqs[0]` is shortest
  would otherwise reject a `w` covering every column any pair can reach.
  Pair counting still treats a missing `w[k]` as 0, so a short `w` can
  never index past its end.
- **`pair_counts_weighted` (protein) returns `u64` comparable/difference
  counts** because weighted sums are unbounded; `pair_counts` keeps its
  `u32` signature by delegating and clamping (unreachable: sequences are
  capped at `MAX_SITES`). Table cells saturate at `u32::MAX` rather than
  wrapping, keeping the no-panic rule on absurd weights.
- **`w.len()` is validated before the model/alphabet check** — the plan
  states the `InvalidExercise { field: "weights" }` contract first, and
  `compute`'s delegation always passes a correctly-sized `w`, so v1/v1.1
  behavior is unchanged either way.
- **Files outside the Files block:** `docs/decisions.md` (this entry).
## v1.2 Task 4: splits, resampling, tallies, replicate detail

- **`bootstrap::Split` is not re-exported at the crate root** — the name is
  already taken by `compare::Split` (spec §4.6). Everything else in
  `bootstrap` is re-exported; the bitset type is reached as
  `neophylo_core::bootstrap::Split`.
- **`BootstrapTally` carries `labels: Vec<String>` instead of the spec's
  bare `n`** (the plan's own instruction, recorded here as required):
  support and consensus need to name groupings, and `Split` serializes as
  a sorted label list resolved against `tally.labels`.
- **`weights_golden` hash generated once:** SHA-256 of every `u32` weight
  as little-endian bytes, replicate-major, for seed 1, i in 0..10, l = 100
  is `e1891dcc8d4e15c9b8c61233eb0d6e0ae9cca04e5c9feef76a6811d0f827d3cc`.
  It locks `ChaCha8Rng::seed_from_u64(seed)` + `set_stream(i)` + the
  multiply-shift draw. The hash is a ~90-line local implementation in the
  test (no new dependency, per rule 8), sanity-checked against the
  published "abc" vector in `sha256_sanity`.
- **`Split::compatible` uses the disjoint-or-nested rule.** For canonical
  unrooted splits the stored side never contains taxon 0, so the fourth
  intersection `!a & !b` can never be empty — the three-term test is the
  full unrooted test — and it is also the correct rule for rooted
  clusters, so consensus can use one function for both tally kinds.
  `n` bounds the universe; bits at or beyond it are masked out.
- **`merge_tallies` error choices:** a method mismatch is
  `InvalidExercise { field: "method" }`; a labels mismatch is
  `LabelMismatch` with the differing names.
- **`tree_splits` returns one (NodeId, Split) pair per inducing branch**
  and may emit the same grouping twice on degenerate trees (chains of
  single-child internal nodes); `bootstrap_batch` deduplicates per
  replicate through a `BTreeSet` so each replicate counts a grouping at
  most once.
- **No `TS` derive on the new types yet** — the generated-types step is
  Task 8's; only `NeoError`'s existing derive picked up the new variant.
- **Files outside the Files block:** `web/src/engine/generated/NeoError.ts`
  (regenerated by `export_bindings`; the new `BootstrapFailed` variant
  must cross the boundary), `web/src/explain/errors.ts` +
  `errors.test.ts` (the exhaustive `never`-checked switch in
  `errorMessage` fails `tsc -b` until the variant has a friendly
  message; the §6.2 wording suggests p-distance or longer sequences),
  and `docs/decisions.md` (this entry).

### Task 4 fix: `replicate_detail` distance must match the method

- **`rf_to_original` for UPGMA is the rooted cluster distance** — the
  size of the symmetric difference of the two trees' cluster sets
  (sizes 2..=n-1), i.e. `differing.len()` — not the unrooted
  `compare::rf`, which would compare unlike grouping conventions. NJ
  keeps `compare::rf` (unrooted splits). New test
  `replicate_detail_rf_is_method_consistent` asserts `rf == 0` iff
  `differing` is empty under both methods, and that both regimes occur.

## v1.2 Task 5: support on the tree

- **Root branch has no support.** A root node has no branch above it, so
  `branches[root]` stays `None` even though the root is an internal node —
  "internal branches" in spec §3.4 means edges that induce a grouping.
- **Degree-2 unrooted root: one split, shown once** (owner request,
  spec §3.7). Both root edges induce the *same* canonical split, so the
  support value goes only on the edge whose subtree is the canonical
  side (the side not containing taxon 0, detected by climbing ancestors
  from the `labels[0]` leaf — no subtree set needs rebuilding); the
  complementary edge stays `None`. The rule only applies when the split
  is induced by ≥2 in-scope edges: a non-duplicated root edge still
  carries the value even when its subtree holds taxon 0 (e.g. the
  `(a,b)` edge of `((a,b),c,d)`). Rooted (UPGMA) root children are real
  clusters and are unaffected. Degenerate duplicate chains away from
  the root (single-child internal nodes) keep the pre-existing
  duplicate placement — `tree_splits` documents that callers dedup.
- **`successful == 0` gives `0.0`, never NaN:** a manually built empty
  tally (or `bootstrap_batch(.., 0)` where all-zero counts is allowed)
  sets `Some(0.0)` on in-scope branches rather than `0/0`.
- **TS `BranchAttrs.support` is a required key** (`support: number | null`),
  matching every other generated type — serde still emits the field as
  `null`; `#[serde(default)]` only affects deserialization of v1/v1.1 JSON.
- **Files outside the Files block:**
  - `crates/neophylo-core/src/bootstrap/mod.rs` — `pub mod support` plus the
    re-export; required for the new module to exist.
  - `crates/neophylo-core/src/lib.rs` — crate-root `support_on_tree`
    re-export, matching every other bootstrap export.
  - `web/src/engine/generated/BranchAttrs.ts` — regenerated by
    `build-wasm.sh`/`export_bindings`; the wasm.sh freshness check fails
    until the regenerated file is committed.
  - `web/src/views/TeachingNotices.test.tsx`, `web/src/views/TreeView.test.tsx`
    — `BranchAttrs` literals gained the required `support: null` key.
  - `docs/decisions.md` (this entry).

## v1.2 Task 6: consensus

- **`labels` comes from `tally`, not a separate argument.** The spec §3.5
  signature is `consensus(tally, kind, labels)`; `BootstrapTally` already
  carries `labels` (Task 4's recorded deviation, which the plan mandates),
  so the implemented signatures are the plan's `consensus(tally, kind)` and
  `consensus_dropped(original, tally, kind) -> Vec<DroppedGroup>` (a named
  struct with sorted `labels` + `support`, per the plan, not the spec's
  `Vec<(Split, f64)>`).
- **Tree building uses the laminar property.** The accepted set is always
  pairwise compatible — two incompatible groupings can never both exceed
  half the successes, and extended filters candidates against everything
  accepted — so each grouping's parent is the smallest strictly containing
  grouping (sorted ascending by size, first superset wins), else the root.
  Leaves attach to the smallest grouping containing them, else the root.
- **Unrooted root degree is >= 3 by construction:** canonical sides are
  size 2..=n-2, so at least two taxa (taxon 0 among them) always remain
  outside every maximal grouping. Rooted (UPGMA) roots take the maximal
  clusters plus unclustered leaves, degree >= 2.
- **Extended "fully resolved" limit:** n-3 groupings unrooted, n-2 rooted
  (binary-tree internal counts); iteration over candidates stops there or
  when exhausted. `BTreeMap`'s ascending-bitset iteration plus a stable
  descending-count sort gives the spec's "count desc, bitset asc" order.
- **`successful == 0` gives support `0.0`** on consensus branches and in
  `DroppedGroup` — same no-NaN convention as `support_on_tree` (Task 5).
- **Consensus branch `support` sits on the grouping's internal branch**
  (the edge above its node), so it is a branch attribute that survives
  display rerooting, matching spec §3.4/§3.7.
- **Files outside the Files block:**
  - `crates/neophylo-core/src/bootstrap/mod.rs` — `pub mod consensus` plus
    re-exports; required for the new module to exist.
  - `crates/neophylo-core/src/lib.rs` — crate-root re-exports of
    `consensus`, `consensus_dropped`, `ConsensusKind`, `DroppedGroup`,
    matching every other bootstrap export.
  - `docs/decisions.md` (this entry).

## v1.2 Task 7: rerooting

- **`reference_outgroup` returns sorted labels** (matching `Split::labels`
  ordering). Tie-break generalizes "the child containing the
  alphabetically first label" to: among root-child subtrees tied on fewest
  leaves, the one whose alphabetically smallest label is smallest — the
  same outcome as "contains the global first label" whenever that child
  is tied. A root with fewer than two children yields an empty outgroup.
- **A single-taxon outgroup is always "a group"** (`outgroup_is_group`):
  a leaf set is a split iff it is one side of some edge's bipartition,
  and a terminal edge's bipartition always is `{taxon} | rest`. This
  also covers outgroup = all-but-one taxon via the complement lookup.
- **Support lands on the ingroup-side root edge only** (spec §3.7),
  whichever endpoint of the split edge that is; the outgroup-side edge
  gets `None`. If the outgroup names the canonical-side-complement, the
  same edge is found via the complement leaf-set lookup — the outgroup
  need not be a stored subtree.
- **Empty outgroup** gives `InvalidExercise { field: "outgroup" }` (the
  spec names no error for it); unknown labels give `LabelMismatch` with
  the tree as side A, so the missing labels land in `only_in_b`.
- **`RerootResult.tree` has `rooted = true`**: it is drawn as a rooted
  tree, matching `parse_newick`'s degree-2-root convention.
- **Files outside the Files block:**
  - `crates/neophylo-core/src/lib.rs` — `pub mod reroot` plus crate-root
    re-exports (`reference_outgroup`, `reroot_on_outgroup`,
    `RerootResult`); required for the new module to exist.
  - `docs/decisions.md` (this entry).

## v1.2 Task 8: wasm exports, generated types, R statistical parity

- **`seed` crosses as `JsValue`, not `u64`.** A `u64` parameter would
  appear as `bigint` in the generated `.d.ts`, which spec §4 forbids;
  it is deserialized via `arg::<u64>` so JS numbers (and BigInt) work.
- **`consensus(tally, kind, labels)` keeps the spec §4 signature** even
  though the tally carries its labels (Task 4): the argument is
  validated against `tally.labels` and a mismatch is a `LabelMismatch`
  error value rather than a silently wrong tree.
- **TS derives live on the core types** (`BootstrapTally`,
  `ConsensusKind`, `DroppedGroup`, `ReplicateDetail`, `RerootResult`),
  the established pattern; `BootstrapTally.counts` gets a
  `#[ts(type)]` override for its wire shape
  `{ labels: string[], count: number }[]` so `bootstrap::Split` is
  never exported to TS.
- **The R side resamples with an explicit `sample.int` loop, not
  `ape::boot.phylo`.** boot.phylo cannot express the engine's
  failed-replicate rule: a FUN error aborts the whole run, and
  returning NULL breaks its post-processing. The loop is exactly
  boot.phylo's `block = 1` sampling (`x[, sample.int(ncol(x), TRUE)]`)
  and keeps only successful trees, mirroring `successful`/`failed`;
  support fractions divide by kept replicates on both sides. The DNA
  and protein FUNs still run the spec's `ape::dist.dna`/`dist.aa` +
  `ape::nj` per resample.
- **`ape::prop.part` counts are summed across both orientations.** It
  reports each bipartition under whichever side is below the stored
  root, which varies across replicate trees, so the same split can
  appear under either side — first-match counting undercounted one
  jc12 bipartition by 58 pp in testing.
- **Files outside the Files block:**
  - `crates/neophylo-core/src/bootstrap/{tally,consensus,resample}.rs`
    and `crates/neophylo-core/src/reroot.rs` — `TS` derives on the
    types the boundary serializes (generated types come from core).
  - `crates/neophylo-wasm/tests/native.rs` +
    `crates/neophylo-wasm/tests/data/bootstrap_tally_jc6.json` — the
    task's "JSON fixture produced by a native test": `write_fixture`
    regenerates it (ignored by default), `native_tally_matches_fixture`
    pins it, and `generated_types_have_no_bigint` scans
    `web/src/engine/generated/` for the spec §4 bigint ban (not
    possible inside a wasm32 test).
  - `docs/decisions.md` (this entry).

## v1.2 Task 9: bootstrap worker and client

- **`cancelled` is an eighth worker→page message.** Spec §5's cancel
  rule ("acknowledged within 1 s, or terminate and respawn") needs an
  acknowledgement the §5 message table never names; `cancelled` is it.
  The worker sends it when a job ends after a cancel (including a job
  cancelled while queued), never for a normal finish.
- **`runBootstrapJob`'s `post` takes `WorkerToPageJob`, not
  `WorkerToPage`.** The job doesn't know its jobId — the worker stamps
  it onto every message — so the job emits the same union minus
  `jobId` (and minus `cancelled`, which only the worker sends). The
  wire union keeps spec §5's fields exactly.
- **A `start` while a job runs cancels the running job and queues the
  new one** rather than interleaving two jobs on the worker's single
  thread; the page still drops anything whose jobId isn't current, and
  a `cancel` for a not-yet-started job is acknowledged on dequeue.
- **All-failed batches are counted, not fatal.** `bootstrap_batch`
  returns `BootstrapFailed` when every replicate in a batch fails
  (Task 4 semantics); the job counts those replicates toward `done`
  and `failed` and only posts `BootstrapFailed` when zero replicates
  succeeded overall.
- **The client auto-confirms, the worker always waits.** `onEstimate`
  fires only when `totalMs` exceeds `confirmThresholdMs` (default
  10,000); under the threshold the client sends `confirm` immediately,
  matching spec §5's "the page confirms immediately".
- **The job checks `shouldStop` before posting the estimate and before
  `waitConfirm`.** A `cancel` processed during replicate 0 used to
  leave the job waiting for a `confirm` that could never arrive —
  the flag was set but nothing resolved the wait. `waitConfirm` also
  resolves `false` immediately when the job is already cancelled, and
  the worker claims the `active` slot before the async wasm init so a
  `start`/`cancel` landing during init is handled against that job.
- **`onStaleMessage` is an observability option** on `BootstrapClient`
  so tests and e2e can assert the §5 stale-results rule fires; the app
  singleton doesn't set it.
- **Files outside the Files block:**
  - `web/src/main.tsx` — installs the `neophylo-e2e` localStorage page
    hook (`window.__neophylo` with the engine, `BootstrapClient` and
    the shared client) so e2e/bootstrap.spec.ts can drive real worker
    jobs until Task 10 wires the client into the session. A `?e2e`
    query param was tried first: the app's URL `replaceState` sync
    strips unknown params, so the flag was gone by the offline reload —
    localStorage survives reloads and works in the preview build too.
  - `docs/decisions.md` (this entry).

**Review fix.** The first implementation leaked `cancelledBeforeStart`
entries and never acknowledged a queued job's cancel: a `cancel` for a
jobId that was never started (or already finished) added a permanent
set entry, and a queued start skipped by `cancelledBeforeStart` posted
no `cancelled` ack — so `cancel()` always fell through to the 1 s
terminate+respawn. Now a queued start's cancel is acked when the job
is skipped on dequeue, and a cancel for a jobId that is neither active
nor queued is acked immediately with no bookkeeping. The wiring moved
into an exported `installWorkerScope(postMessage, ready)` (with a
test-only `pendingCancels()` size getter) so these cases run
in-process in `worker.test.ts`. The wasm `ready()` await is also
wrapped so a failed init reports an `error` on the job instead of
wedging the start queue.

## v1.2 Task 10: session bootstrap state and URL v3

- **`Session.bootstrap` carries five bookkeeping fields beyond spec
  §6.1's shape** (plus `settingsUsed`, which the task names): `jobId`
  (the client's current job), `cancelJobId` (a job the reducer asks the
  page to cancel — set on clear-on-data-change and on a declined
  autorun), `autorun` (the request came from a `ran: true` link),
  `prefilledRun` (an autorun whose estimate exceeded 10,000 ms: show a
  prefilled Run button instead of the confirm dialog), and `error`
  (the `NeoError` behind the "error" status). `etaMs` is
  `number | null` — the spec lists the field but not its type, and
  there is no estimate until the first message lands.
- **The reducer, not the page, owns the autorun decision.**
  `bootstrapEstimated` resolves to `running` at ≤ 10,000 ms, to
  `confirming` for a manual run over budget, and to `idle` +
  `prefilledRun` for an autorun over budget (the pending job moves to
  `cancelJobId`). This matches the plan's test wording ("the
  auto-start decision uses the estimate") while §5's client still
  auto-confirms under the threshold — the reducer rule covers the
  autorun case the client's silent confirm would otherwise bypass.
- **`ran` means "a run is in flight or finished"** in
  `sessionUrlState` — `estimating`/`confirming`/`running`/`done`
  encode `ran: true`; `idle`/`cancelled`/`error` encode `false`. The
  spec doesn't define `ran` for failed or cancelled runs; re-running
  an errored run on open felt wrong, and a user-cancelled run likewise.
- **Query links carry bootstrap settings in a `b=` lz-param**, same
  pattern as `o=`/`d=`; `#x=` payloads get the `bootstrap` field in the
  JSON. A malformed block rejects the whole link, matching the
  `src`/`overrides` rule.
- **A lesson load resets bootstrap settings; sandbox data changes
  keep them.** The v1.1 rule that nothing carries over between
  lessons applies to settings too, not just results: `load` rebuilds
  `Session.bootstrap` from `defaultBootstrap()` plus the exercise's
  own `bootstrap` block (spec §7.1; Task 14 adds the field to the
  `Exercise` type — `exerciseBootstrap` reads it defensively until
  then) or the defaults (100 replicates, seed 1, view "support").
  Sandbox imports (`importAlignment`/`importTree`) and model/data
  edits keep the user's replicates/seed/view as preferences while
  `clearBootstrap` resets results and moves an in-flight `jobId` to
  `cancelJobId` so the App effect can `client.cancel` it.
- **`setBranchScale` and `setAlphabet` also clear bootstrap state** —
  the task names `setSim`/`setAnalysis`/`importAlignment`/`importTree`/
  `load`, but branch scale changes the simulated alignment and an
  alphabet switch can change both models, so they follow the same
  spec §6.1 "data, model or method" rule. `enterSandbox` changes
  nothing about the data and does not clear.
- **The pair panel isn't a session action** — it's App-local state —
  so Review Focus 2's "opening the pair panel" is covered by testing
  every session-level navigation action (`step`, `setMode`,
  `setMatrixView`, `setBootstrapView`, `setReplicateIndex`,
  `toggleRerootDisplay`, `hover`) leaves a running job untouched.
- **Job messages are adopted by id.** `bootstrapRequested` without a
  `jobId` (the `ran: true` path — `applyUrlState` is pure and cannot
  call `client.start`) leaves `jobId: null` in "estimating"; the first
  job-scoped message adopts its id. Every other mismatch is ignored,
  mirroring the client's stale filter.
- **Files outside the Files block:**
  - `web/src/state/urlRestore.ts` — `sessionUrlState`/`applyUrlState`
    are the URL v3 write/read pair for the live session; keeping them
    in `url.ts` would put session-redux logic in the codec module.
  - `web/src/views/App.url.test.tsx` — a `v: 2` literal became `v: 3`.
  - `docs/decisions.md` (this entry).

## Task 11 (v1.2) — Bootstrap panel, support labels, reference rooting

- **`bootstrapCancelRequested` is a new action** (not in Task 10's
  union): the panel's Cancel button moves the current `jobId` into
  `cancelJobId` so the App effect performs `client.cancel` — session
  stays the only thing that decides when a job dies. The panel has no
  Cancel control during `confirming`? It does — `confirming` counts as
  active, so Cancel appears beside Start and cancels the parked job.
- **`bootstrapCancelled` takes an optional `jobId`.** A scoped ack
  settles only the pending cancel it names (`cancelJobId` must match);
  an ack that arrives after the session moved on to a newer request is
  ignored. The no-`jobId` form is the Task-10 behaviour, kept for
  clears that don't name a job.
- **The App effect binds via `queueMicrotask`.** `dispatch` inside the
  effect body is a synchronous `setState`, which
  `react-hooks/set-state-in-effect` rejects. A microtask still lands
  before the next task (any user event), so a Cancel click can never be
  swallowed by a late bind, and ordering is unchanged.
- **`pendingBind` cancels orphaned jobs.** If a started job's bind
  lands on a session that has already resolved the request, the next
  effect run calls `client.cancel` on it — no leaked worker job. (The
  un-gated `bootstrapRequested{jobId}` semantics from Task 10 are
  unchanged: bind remains the reducer's "request + adopt" shortcut.)
- **The support label and zero-length "0" share the same slot.**
  `support-label` sits at the branch midpoint just above the branch,
  where `zero-len` also renders; a support-bearing edge that is zero
  length would overlap. On real runs a zero-length internal edge can
  carry support, so the label takes precedence visually — they are the
  same font size and anchor.
- **A weak branch thins the whole edge** — the branch line only (the
  node-level connector belongs to the children's splits and stays
  thick); the `*` marker is the non-colour signal (spec §6.5).
- **Panel copy follows spec §6.2 verbatim** — grouping count uses the
  "n−3"/"n−2" wording per method; the run button is `Run bootstrap`;
  the `ran:true`-link fallback is `Run bootstrap (N replicates)`
  (`prefilledRun`). Progress text is `Replicate k of N · about T left`
  and the confirm line is `This will take about N.` per spec §5.
- **`MathLine` mirrors `ExplanationPanel`'s convention**: lines with
  `=` render through KaTeX; prose lines render as text.
- **Files outside the Files block:**
  - `web/src/state/session.ts` — the two new actions; the cancel-ack
    scoping is required by the "cancel ack cannot kill a newer run"
    contract tested at the App level.
  - `web/src/views/Controls.tsx` — `NumberField` exported for the
    panel's Replicates/Seed inputs and a `bootstrapPanel` slot under
    Analysis (keeps the section in the shared column).
  - `web/src/index.css` — styles for the new panel classes.
  - `docs/decisions.md` (this entry).

## Task 11 (v1.2) — review fixes before merge

- **`isNj` is the requested method, not the trace.** `App` now reads
  `session.exercise.analysis.method === "Nj"`; a trace exists only up
  to 50 taxa, so the previous `"Nj" in trace` check skipped §6.7
  rerooting for larger alignments. Every `isNj` consumer still wants
  the method: `qAvailable` keeps its `&& trace !== null` gate, and the
  caption's `k === n` holds trivially when there is no trace (0 === 0).
  UPGMA is unchanged — never rerooted. Tests drive it through the real
  sandbox import flow: a 60-taxon FASTA plus a rooted Newick whose
  outgroup is a cherry of the computed NJ tree (guaranteed a
  grouping), asserting the drawn tree is `rerootOnOutgroup` (+1 node)
  with the "same outgroup" caption; the UPGMA variant draws the
  computed tree verbatim with no reroot caption.
- **The cancel-once test counts exactly.** After two quick model
  changes it now asserts `cancel` was called exactly once (with job
  1's id) and `dispose` never ran — previously only `> 0` cancels was
  checked. The pending ack is flushed with `await act(async () => {})`
  first so the count covers the settled lifecycle.

## v1.2 checkpoint 11 fixes

- **Support labels are pills, placed by `layout/supportLabels.ts`.**
  Each labeled branch's value draws in a backgrounded pill just left of
  and above the node at the branch's child end — near the node, never
  on it. Placement is a pure function so collision handling is unit-
  tested: node markers, leaf names and "0" markers are obstacles, and a
  colliding pill nudges vertically (up first, below when the canvas top
  is reached). Internal u-names are a step-through aid, so they hide
  whenever support labels are on screen rather than moving below the
  node — the checkpoint allowed either, and hiding keeps `TreeView`
  from needing a second placement pass.
- **`layout()` grew `minBranchPx` (12 px in `TreeView`).** Internal
  branches carrying support stretch to ≥12 px, display-only — the extra
  length is a subtree shift, so a node's own branch grows by exactly
  its own stretch and the underlying tree never changes. Shifts are
  computed over the full tree so positions stay stable across steps;
  cladogram tips re-align on a uniform shift.
- **Imported alignments collapse the Simulation section** to "Your
  sequences: not simulated." — the embedded lessons' treatment with
  importer-appropriate wording — instead of disabled fields.
- **`setAnalysis` lands on the new final step** when the stepper was at
  its final position (re-analyzing at the end shows the finished tree
  and the bootstrap panel at once); any earlier position still resets
  to step 0. `clearBootstrap` runs either way, so results clear to
  idle and a queued cancel still goes out.
- **The reroot toggle is a state button, not a switch.** The label says
  what a click switches to ("Show as computed (unrooted)" ↔ "Show
  rooted like the reference") and `aria-pressed` says which view is on
  (pressed = rooted). This replaces the fixed label + `role="switch"`.
- **Text floor is 12 px everywhere in the tree views.** `treePanel`
  exports `MIN_FONT_PX`; `TreeView` clamps both the name font and the
  small (support/zero-length) font to it, so only branch geometry ever
  scales.
- **`isNj` and the cancel-once assertions were already on main** (PR
  #49); this branch only re-verified them — no duplicate changes.
- **Tests added:** `layout/supportLabels.test.ts` (weak-support ladder
  with two sub-10-px internal branches on one row: pills clear markers,
  names and each other; branches stretch to 12 px); `TreeView` tests
  for the pill, hidden u-names and the 12 px floor; `Controls`/
  `App.sandbox` for the imported-data line; `session.test.ts` for the
  final-vs-middle stepper rule incl. bootstrap clearing; App-level
  tests for the toggle states, rooted/computed font parity and the
  protein-models p→JTT final/middle switches; and an e2e acceptance
  test asserting zero pill overlaps in both views on cytochrome-c
  (100 reps, seed 1) with screenshots saved to `test-results/`.

## v1.2 checkpoint 12 fixes

- **Support pills moved to the RIGHT of their node.** The left-of-node
  placement from checkpoint 11 hung pills off the svg's left edge on
  shallow trees — the owner screenshot showed "47*"/"32*" clipped to
  just "*". Each pill now sits just right of the child-end marker,
  above the start of the descending branch (the usual node-label spot
  on a horizontal phylogram); the vertical collision nudging is
  unchanged, and labels are never placed left of a node.
- **The `*` weak marker is part of the label text** ("47*" is one
  string) instead of a second `.weak-marker` element — the number can
  never render half-clipped again, and the pill width covers the whole
  value. Tests assert `text.length × 0.5em` fits inside the pill.
- **The svg `viewBox` fits the content, not the layout width.**
  `TreeView` unions every drawn box — node markers (with stroke slack),
  leaf names, drawn internal names, "0" markers, support pills and
  wrong-clade rects (including the ✕ above them) — and maps it onto
  `0 0 w h` with the usual pad. Nothing clips at any tree size, in the
  rooted or computed view.
- **The leaf-name obstacle box was underestimated vertically.**
  `dominantBaseline="middle"` text reaches ~1em above its anchor, not
  ±0.5em — a pill grazing the real "chicken" glyphs while clearing the
  estimated box caused the only overlap in the computed-view e2e. Both
  the collision obstacles and the viewBox bounds now use the
  asymmetric estimate.
- **Tests added:** `TreeView` asserts every pill rect lies inside the
  `viewBox` and is wide enough for its text; `supportLabels` asserts
  right-of-node placement, the merged "30*" text and the width rule;
  the cytochrome-c e2e overlap check runs in both views (found the
  name-box bug).
- **Screenshot attachments** for the PR live on the orphan branch
  `assets/cp12-shots` (review attachments can't be uploaded via `gh`;
  they stay out of the PR diff so they never reach main on merge).

## v1.2 Task 15: exports

- **`write_newick_with_support` writes the integer percent in place of
  a node's own label** — a Newick node carries one label, and spec
  §6.8 names it "the" internal node label, so support wins (the
  convention `ape::read.tree`'s `node.label`, FigTree and iTOL read).
  Nodes without support keep their label; `write_newick` is
  byte-for-byte unchanged.
- **Tree exports follow the drawn tree, not the computed one.** `App`
  passes `drawnTree` — support labels applied, rerooted on the
  reference's outgroup when that view is on — and the menu items say
  which ("SVG (rooted on wheat)"). "Consensus (Newick)" exports the
  tree of `bootstrap.view` (the support tree on "Your tree with
  support", else that view's consensus) so it already maps to the tab
  Task 12's ConsensusTabs will draw.
- **The R script's bootstrap block runs `boot.phylo` with the same
  distance + method inside FUN** — protein included, where `x` is the
  alignment as a character matrix and Kimura's `-log(1 - p - 0.2p²)`
  sits inside the FUN (the protein block is skipped when the tree is
  unbuildable). `trees = TRUE` + `phangorn::plotBS` (ape has no
  `plotBS`); the script warns that R's draws differ and that B
  replicates can take a while.
- **The parity check runs the exported boot block on failure-safe
  alignments** (jc12 JC69, p8_250 Kimura — 0 failed replicates at the
  sampled counts), because `boot.phylo` aborts on the first FUN error
  and cannot skip replicates the way the engine does.
- **`ape::read.tree` cannot read an apostrophe label** (`''` reads as
  NA, a bare `'` errors) — Review Focus 4's label round-trip is
  asserted through our own parser; the R step checks only `Ntip` and
  `node.label` = the supports, which is all the task asks of it.
- **Files outside the Files block:**
  - `crates/neophylo-core/src/lib.rs` — re-export so the wasm binding
    can call the new writer.
  - `crates/neophylo-wasm/src/lib.rs`, `web/src/engine/index.ts` —
    `write_newick_with_support` must cross wasm for the UI to use it;
    adding the export is less invasive than changing `write_newick`'s
    bytes for every existing caller.
  - `web/src/views/App.tsx` — the displayed tree (`drawnTree`), the
    rooted-on note, the current view's tree and the run's replicates
    all originate in App's session/render state.
  - `crates/neophylo-core/tests/newick.rs`,
    `web/src/export/svg.test.ts`, `web/src/export/rscript.test.ts`,
    `web/src/views/ExportMenu.test.tsx` — the task's tests (AGENTS.md
    ships tests in the same PR).
  - `docs/decisions.md` (this entry).

## fix/newick-compatible-names (found at checkpoint 15)

- **Owner finding:** `ape::read.tree` keeps the quote characters in a
  quoted label and coerces `'O''Brien'` to NA (silently, with a
  coercion warning). Exact standard Newick is correct but unreadable in
  the tools students actually use.
- **`write_newick_compatible(tree, support)`** maps every node label to
  `[A-Za-z0-9._-]`: anything else becomes `_`, `_` runs collapse, and
  collisions get `_2`, `_3`… in node order. Names already safe are
  reserved first, so a mapped name can never steal one (the rename —
  not the original — takes the suffix). No quotes are written; mapped
  names are emitted bare because the map guarantees it.
- **`compatible_names(tree)`** returns the `(original, exported)` pairs
  that changed — it feeds the UI note and `neophylo-name-map.csv`, and
  is empty when nothing would change.
- **`labels_need_quotes(tree)`** is the default-mode signal: Exact when
  no label would be quoted, Compatible otherwise. Quoting, not the
  rename set, decides — `'Ångström_1'` needs no quotes (default stays
  Exact) but is still renamed under Compatible.
- **The mode is one select for both Newick exports** ("Consensus
  (Newick)" follows the same mode) — per the task's "the same rules
  apply to the consensus export."
- **The R parity check runs `options(warn = 2)`** so ape's silent
  coercion warning would abort the script; tip labels must equal the
  mapped names exactly and `node.label` the integer supports.
- Files touched: `crates/neophylo-core/src/{newick.rs,lib.rs}` +
  `tests/newick.rs`, `crates/neophylo-wasm/src/lib.rs`,
  `web/src/engine/index.ts`, `web/src/views/ExportMenu.tsx` +
  `ExportMenu.test.tsx`, `web/src/index.css` (one select rule),
  `web/scripts/r-parity.mjs`, `docs/decisions.md`.

## v1.2 Task 12: consensus tabs

- **Tab metadata lives in `consensusTabs.ts`, not the component file.**
  The react-refresh lint forbids a component file exporting
  non-component symbols; `CONSENSUS_TABS`, `consensusKind`, `viewLabel`
  and `droppedLine` are shared by `ConsensusTabs.tsx` and `App.tsx`
  (which picks the tree to draw), so they sit in a sibling `.ts` — the
  same split as `stepEmphasis.ts`.
- **A stored consensus view without results falls back to "support".**
  `Session.bootstrap.view` survives `clearBootstrap`, and a `ran: false`
  link can name a consensus tab; with no `done` run the consensus tabs
  are disabled, so the selected tab and the drawn tree both fall back
  to the support view instead of showing a disabled selection over the
  wrong tree.
- **Consensus views are rerooted exactly like the support tree.** The
  App's existing `reroot` block operates on `drawnInferred`, which now
  includes the active consensus tree — NJ consensus trees (unrooted)
  are rooted on the reference's outgroup under the same toggle, while
  UPGMA consensus trees are already rooted and untouched.
- **Consensus tabs mount only at the final stepper position**, matching
  the BootstrapPanel's spoiler gate: support labels (and now the tabs)
  appear only when the finished tree is on screen.
- **The tab strip is a single horizontally-scrollable row and the
  canvas has a 96 px floor.** The first e2e run caught the collapse:
  when the teaching notices squeeze `.trees` to ~160 px, a wrapping
  two-row tablist plus the reroot note/toggle starved `.tree-canvas`
  to a zero box and the svg rendered `hidden`. Now the tablist never
  wraps (`overflow-x: auto`), `.consensus-tabs`/`.consensus-tabpanel`/
  `.tree-panel` refuse to shrink below content, and `.tree-col` gets
  `overflow-y: auto` so the whole block scrolls instead of clipping
  the drawing or painting over the heatmap row.
- **Files outside the Files block:**
  - `web/src/views/consensusTabs.ts` — new; shared tab metadata
    (react-refresh rule, see above).
  - `web/src/index.css` — styles for the tab strip, the size floor and
    the dropped line.
  - `web/e2e/bootstrap.spec.ts` — the owner's cytochrome-c acceptance:
    the majority-rule view draws rerooted with wheat on its own branch
    and no support label clipped or overlapping.
  - `docs/decisions.md` (this entry).

## v1.2 Task 13: watch one replicate

- **The worker `detail` job is a new protocol message.** Spec §6.5's
  "one-replicate job" needed a name the §5 table doesn't give;
  `detail` carries `ReplicateDetailParams` (alignment, model, method,
  seed, index) and answers `{ type: "detail", detail }` or `error`. It
  shares the client's single live-job slot: `BootstrapClient.detail`
  cancels whatever is current, exactly like `start`, so the spec's
  "never two live jobs" rule is unchanged. The worker queues it behind
  a running job like a `start`.
- **`BootstrapState.msPerReplicate` stores the run's estimate.** §6.5
  routes the detail through the worker when "estimated > 2 s"; the
  only estimate available once a run finishes is the `estimate`
  message's `msPerReplicate`, so `bootstrapEstimated` now keeps it.
  One `replicate_detail` call costs about one bootstrap replicate
  (weights + weighted distances + build + compare), which is what the
  estimate measures.
- **The Watch button shows whenever `support !== null`, disabled while
  a job is active.** A run in flight holds the worker's job slot, so a
  detail request then would cancel it — gating on `!active` prevents
  that (and matches Review Focus 2: a run must never be cancelled by
  navigation). The panel uses `settingsUsed.seed` and the run's total
  so the view matches the run the results belong to (Review Focus 3).
- **`rf_to_original` drives the difference line verbatim:** "This
  replicate's tree differs from your tree in K grouping(s)." K is the
  method's own comparison — unrooted RF for NJ, rooted cluster
  difference for UPGMA — which is exactly what the engine reports
  (Task 4 fix), so the panel never recomputes it.
- **Outlines reuse the wrong-clade mark.** `differing` groupings are
  matched to drawn nodes by leaf set: exact side for UPGMA clusters,
  side or complement for NJ splits (the canonical side never holds
  taxon 0). Each differing grouping exists in exactly one tree, so it
  is outlined exactly once across the pair.
- **Both trees follow the main view's rooting.** `original` is the
  `drawnTree` prop — support labels and the §6.7 reference rooting
  included; the replicate tree is rerooted on the same outgroup when
  that display is on ("same toggle state"). Support labels come free
  via TreeView's checkpoint-11 pill layout.
- **Files outside the Files block:**
  - `web/src/engine/bootstrapProtocol.ts` — the `detail` message pair
    and handler types.
  - `web/src/engine/bootstrapClient.ts` — `detail()` plus the
    handlers-map refactor (per-job dispatch closures) it required.
  - `web/src/engine/worker.ts` — `detail` job handling in
    `installWorkerScope`.
  - `web/src/state/session.ts` — `msPerReplicate` (see above).
  - `web/src/views/BootstrapPanel.tsx` — the "Watch one replicate"
    button that dispatches `setReplicateIndex(0)`.
  - `web/src/views/App.tsx` — detail acquisition (sync or worker
    route) and the panel render.
  - `web/src/views/stepEmphasis.ts` — `sameSet` exported for grouping
    matching.
  - `web/src/index.css` — dialog, column strip and tree-pair styles.
  - `docs/decisions.md` (this entry).

### Checkpoint fixes: orientation and difference wording

- **The replicate tree is drawn in the original's orientation.** The
  outgroup it roots on is the `outgroup` prop when the reference-rooted
  display is on (unchanged), otherwise the leaf set of the original
  drawing's root-side first child — rerooted via `reroot_on_outgroup`
  (the engine's terminal-branch fallback covers a side that isn't a
  split in the replicate). Its children are then sorted by each
  subtree's earliest leaf position in the original's drawn leaf order
  (`orderLike`), so a replicate with the same groupings draws with the
  same leaf order — verified by test, not just by construction. Both
  are view-only transforms; no topology changes.
- **The difference line counts against your tree.** `differing`
  entries found in the original's drawn tree are "missing here"; the
  rest "appear instead". For NJ's unrooted splits on binary trees the
  counts are equal (M = K/2); for UPGMA's rooted clusters they are the
  actual counts, which can differ in general. When `rf_to_original` is
  0 the line reads "This replicate's tree has the same groupings as
  your tree."
- **Display reroot caveat:** "missing" counts match `differing`
  against `original` only, and "extra" is `|differing| − missing`, so
  the wording stays exact even when the display reroot moves a UPGMA
  cluster off the drawn replicate tree — an outline then simply has
  nowhere to draw on that side.

## v1.2 checkpoint 15 fixes: export item names and computed-view clipping

- **The menu names the drawing, not just the rooting.** `ExportMenu`'s
  `rootedOn: string[] | null` prop conflated "computed view" with "no
  reroot view exists", so the items went silent exactly when the user
  most needed to know they were exporting the unrooted tree. It is now
  a `TreeViewState` union — `rooted` (outgroup labels), `computed`,
  `plain` — so the item names cover all three display states, and the
  Consensus item carries the same qualifier ("Consensus (Newick,
  rooted on wheat)" / "… as computed, unrooted").
- **"Consensus (Newick)" exports the drawn tree.** App now passes
  `drawnTree` (the rerooted view's tree) instead of the stored
  unrooted consensus whenever a consensus view exists, so the exported
  file's rooting matches the item's name. The stored consensus is
  unchanged — this is a display-following export, per §6.8's "the
  current consensus view".
- **Top-of-drawing clipped after toggling (the zebrafish bug).** Two
  causes, both in the tree column: (1) the svg's intrinsic
  aspect-ratio height counted as the canvas's min-content inside the
  min-height:auto chain, inflating the column's scroll content past
  the row, and (2) the toggle sits below that overflow, so clicking it
  focused-scrolled the column and left the drawing's top clipped.
  Fixes: `.consensus-tabs .tree-canvas svg` is `position: absolute`
  (scoped — the replicate trees' canvas is sized by that intrinsic
  height, so the global rule stays in-flow), and App resets
  `.tree-col`'s `scrollTop` in a `useLayoutEffect` on `rerootDisplay`.
  `scrollTop`, not `scrollTo`: jsdom implements the property but not
  the method (all App tests render this tree).
- **e2e asserts pixels, not just DOM.** `toBeVisible` ignores overflow
  clipping, so the new spec checks `getBoundingClientRect` of all 8
  leaf names inside the svg rect, the svg + caption inside the column,
  and `scrollTop === 0` after toggling — plus the downloaded Newick's
  top-level structure (wheat is a root child rooted, not computed).

## v1.2 checkpoint 15 fixes (release blocker): figure exports and the R bootstrap

- **One figure path for screen and export.** The SVG/PNG export ran its
  own fixed-geometry layout (22 px spacing, 480 px draw width, a label
  room reserved even where no label reached it), while the screen
  derived the same quantities from the measured panel. The exported
  tree was therefore a *different drawing*: pill collision resolution
  placed support labels up to ~300 px from their nodes (read by the
  owner as "labels on the wrong groupings"), short support branches
  were all stretched to a 12 px floor (the "staircase"), and the
  reserved label room showed as a large empty right area. Layout,
  label placement and content bounds now live in
  `web/src/layout/treeFigure.ts`; `TreeView` and `exportSvg` both
  consume it. App feeds the export the same inputs the screen used
  (shared leaf spacing, the measured `.tree-canvas` width via
  `TreeView`'s `onPanelSize`, the view's `kind`, `visibleNodes`), so
  the only export/screen differences are serialization and padding.
- **`data-split` keys are computed in TS.** Every `g[data-node]` and
  `.support-label` carries the canonical grouping key
  (`web/src/layout/splitKeys.ts`): sorted labels of the canonical
  side — the side not containing taxa[0] for unrooted (NJ) tallies,
  the node's own leaf set for rooted-cluster (UPGMA) tallies — `|`-joined,
  matching the form `BootstrapTally.counts` rows serialize to. The
  canonicalization mirrors `bootstrap/split.rs` display-side; the
  engine itself is unchanged. A rerooted NJ drawing keeps unrooted
  keys (`splitRooted={!isNj}`) because rerooting changes only the
  drawing; the reference tree draws its own clusters.
- **The exported R bootstrap skips saturated replicates.** `boot.phylo`
  aborts on the first FUN error, so a single saturated replicate
  (p6_150 under Kimura) killed the exported run. The block is now an
  explicit loop mirroring spec §3.3: `set.seed(<seed>)`, resample
  columns with replacement, recompute the same distance (`distOf`),
  skip the replicate when any off-diagonal value is non-finite (or the
  distance/build call errors), then `ape::prop.clades(tree, kept)` over
  the kept trees as node-label percents. It prints
  `Skipped (saturated): S of B`, warns when `S/B > 10%` and stops with
  a clear message when nothing succeeds. `ExportBootstrap` gained
  `seed`; the support tree's Newick is printed last so the parity job
  can read the values back.
- **Checks that must fail on the pre-fix code.** Unit: `data-split` on
  nodes/labels and content-fit bounds in `export/svg.test.ts`; the
  loop/seed/prop.clades assertions in `export/rscript.test.ts` and
  `ExportMenu.test.tsx`. e2e (`e2e/export-figure.spec.ts`): per-view
  label grouping/value vs screen and tally, ≤30 px label distance,
  ≤1% branch-length match, PNG = fitted SVG × 2, and a Newick
  per-grouping support guard in both views. R parity
  (`scripts/r-parity.mjs`): p6_150 Kimura must complete with
  `Skipped > 0` and supports within 10 pp for groupings ≥ 50.

### Support-label proximity (part of the same checkpoint)

- **Pills may sit over the incoming branch.** The old rule "labels
  never hang left of nodes" existed only because the fixed viewBox
  could not extend past x=0 (a left pill clipped on the owner
  screenshot). With content-fit bounds that cannot happen, so
  `supportLabels` now tries, in order: right-above, right-below, then
  the mirrored spots over the node end of the incoming branch — where
  FigTree/iTOL put support values — and finally a 1 px scan of every
  pill-centre position whose anchor stays within 30 px of the node.
  Only if the whole 30 px disc is blocked does the legacy vertical
  climb run. This is what keeps every cytochrome-c label within ~25 px
  of its node in both views (previously 110 px in the rooted view's
  dense cluster — the "staircase" that read as wrong groupings).

## Support labels ride the incoming branch segment (owner checkpoint 21-10-26)

- **Placement convention replaced.** In dense regions the corner-
  candidate scheme left labels visibly ambiguous between neighbouring
  nodes even while each stayed inside its 30 px reach. Each pill is
  now centred just ABOVE the horizontal segment into its node,
  right-aligned near the node end — the nearest incoming segment is
  always its own, so the grouping it annotates is unambiguous.
- **Segment fit is per-edge.** `minBranchPx` became a per-node
  resolver: a supported edge stretches (display-only, like the old
  12 px stroke floor) until it can hold its pill — pill width plus
  marker clearance plus 4 px headroom, the owner's "label width +
  4 px" rule. `supportLabels` reuses the same `segFitPx` value, so the
  layout pass and the placement pass can never disagree.
- **20% distortion cap → leader line.** If the needed stretch exceeds
  20% of the drawing width the edge keeps the 12 px floor and the
  label is drawn offset above the node with a thin dashed leader to
  it (`SupportLabel.leader`). The same fallback covers a segment
  whose every on-segment spot is blocked — a silently stacked pill
  would re-create the ambiguity this change removes. Both renderers
  draw the leader from the stored geometry; PNG inherits it through
  the shared SVG.
- **Tests assert the association, not a distance budget.** The
  nearest incoming horizontal segment to each label's anchor (pill
  bottom centre, or the leader endpoint at the node) must be its own
  node's — a boundary tie is allowed only where the node point is
  literally a child's segment start. Overlap-vs-markers/names/pills
  and in-bounds checks are kept; the stretch test still pins the
  12 px floor and a narrow-panel test pins the cap→leader path.

### Refinement (same checkpoint): overhang replaces stretch-to-fit

- **Leaders stopped being the short-segment default.** A leader label
  raised by a full pill height landed on a neighbour's row and read as
  that node's value (the 35* at zebrafish height report). Short
  segments are no longer stretched to fit at all: the pill keeps the
  node's own y, right-aligned, and simply extends left past the
  segment's start — over the parent's vertical, which the opaque pill
  masks. `minBranchPx` is back to the flat 12 px stroke floor; the
  per-node resolver and the 20% cap are gone.
- **Nudge before leader, with the drop extended.** Collision
  obstacles are labels, leaf names and node markers only (branch
  lines are maskable). A blocked spot nudges vertically ±6 px — down
  first, since the pill may mask the segment it straddles and that
  keeps the centre closest to the row. *Deviation:* if the ±6 px
  band is fully blocked the pill keeps descending while its centre
  stays within the 10 px row bound — covering its own segment is
  allowed (it masks like any branch line). The dense cytochrome-c
  cluster needs this: the 35*/52 stack collides with the parent
  marker 8–10 px off base, and a strict 6 px cap would produce the
  leaders the acceptance case forbids. A label that can't fit within
  the 10 px bound still earns a leader. The leader's attach point is
  searched along the pill's bottom edge then right edge so the
  straight line to the node crosses no drawn segment or connector.
- **cytochrome-c acceptance:** the e2e now asserts zero
  `.support-leader` elements and |pill centre − node y| ≤ 10 px in
  both views, on top of the no-overlap boxes.
- Owner sign-off: support labels may drop up to 10 px below their row to avoid collisions (beyond the
  ±6 px nudge); stretch-to-fit (segFitPx / 20% cap) removed in favor of overhang placement. Verified
  visually on cytochrome-c exports (checkpoint 15). Confirmed by owner 2026-10-20.
  
## Task 14 (v1.2): predict_branch and the bootstrap-basics lesson

- Outside Files block: the verdict needs machinery the Files list did
  not name — `web/src/lessons/promptGate.ts` (branch-pick state keyed by
  at_step), `web/src/views/TreeView.tsx` (`onPickBranch` + invisible
  `.branch-hit` lines on internal edges only), `web/src/views/App.tsx`
  (weakest-branch scan on the run's support tree via `splitKeys`),
  `web/src/index.css` (`.branch-hit` cursor/width), and
  `web/src/state/session.ts` (typed `Exercise.bootstrap` read).
- `predict_branch`'s `at: "bootstrap"` resolves to the final stepper
  position: step n−1 for NJ and n for UPGMA on n taxa — the position
  where the bootstrap panel shows.
- Verdict rule: "Correct" when the clicked branch's support equals the
  minimum across the support tree's internal branches — a tie for
  weakest counts as correct.
- Seed search required NJ to recover the exact true topology (rf == 0)
  at both 300 and 3,000 sites on top of the §7.2 premises, so the
  verdict names a real weak-but-true grouping. First pair in scan
  order: sim seed 4, bootstrap seed 96 — (E,F,G,H) at 57% on 300 sites,
  rising to 90% at 3,000.
- `ExerciseBootstrap.seed` is `u64` exported as `number`
  (`#[ts(type = "number")]`), the same convention Task 12 set for
  `SimSpec.seed`.
- The lesson's predict_branch math note, the length note and the
  closing note are spoiler-safe: math lines render in math mode before
  the run, so none names the designed branch; only the post-verdict
  reveal does.
- Task-14 follow-up (owner notes): terminal edges draw hit lines too —
  a leaf-edge click is not an answer but explains itself via
  `onPickTerminal` → "Pick a branch that joins two or more taxa." This
  changes the earlier "terminal branches are unpickable" design; the
  hint is separate from the answer state so Run stays gated. The lesson
  gained a seed-variance note (different bootstrap seed → ±few points;
  1,000 replicates steadies) and the closing note warns against
  overinterpreting small differences. The final-step figure screenshot
  ships in docs/media/ (rule 10 names media the exception) for the
  PR's owner-review figure.
- Task-14 round 2 (owner notes): seeds re-searched for a clear margin —
  sim 7 / bootstrap 39 (scan: crates/neophylo-core/tests/seed_scan.rs,
  #[ignore]d). {E,F,G,H} is the weakest grouping at 67% on 300 sites,
  next-weakest C|D|E|F|G|H at 98% (margin 31 pts), rising to 87% at
  3,000 (+20); rf = 0 at both lengths. Verdict now tolerant (within 5
  points of the lowest counts Correct) and LOCKED — promptGate's
  branchVerdicts freezes the first completed run's scoring; reruns
  never re-evaluate. Card text: "Your prediction: Correct" /
  "Your prediction: Not quite — the weakest group was (…) at N%." The
  tolerance e2e uses 20 replicates/seed 391 (EFGH 95 vs lowest 90).
  visually on cytochrome-c exports (checkpoint 15). Confirmed by owner 2026-10-20.
- fix/label-measured-widths (owner note): support-label placement now
  uses MEASURED text metrics. `web/src/measureText.ts` parks a hidden
  <text> probe on <body> and returns getComputedTextLength()+getBBox()
  extents {w, top, bottom} per (text, fontSize, baseline); layout
  stays pure — TreeView/export inject the measurer as an option
  (`measure`), and a null return (jsdom, workers) falls back to the
  0.62 em estimates so every unit test is unchanged. The local Firefox
  failure was a VERTICAL graze (name descent > 0.5em estimate), so
  heights are measured too, not just widths; the "0" marker is
  measured on its real alphabetic baseline. Exports measure against
  their own FONT_FAMILY stack.

### fix/tree-scaling-and-replicate-count (owner review)

- **Tree text never scales.** `TreeView`'s svg now renders at its
  natural pixel size (`width`/`height` = viewBox) and `.tree-canvas`
  scrolls on overflow — the ≥12 px layout font is the rendered font.
  *Deviation from checkpoint 11/15:* the svg no longer stretches to
  fill the panel; small trees draw top-left instead of upscaling.
- **"Your tree" compares the computed tree.** `ReplicatePanel`'s
  `original` is now the support-bearing computed tree (display-rooted
  when the reroot toggle is on), not `drawnTree`. *Deviation from
  Task 13:* the original spec passed the drawn tree verbatim — under a
  consensus tab that is the collapsed consensus, which made the
  "missing" count read 0 while the replicate still showed outlines.
- **Intrinsic-size ratchet follow-up:** the px `width`/`height` on the
  svg made it a min-content contribution, and `.trees`' `1fr` tracks
  (`minmax(auto,1fr)`) pinned the column at the svg's intrinsic width —
  relayout then sized the svg to the grown canvas, looping ~1 px per
  frame (CI click timeouts on element stability). Tracks are now
  `minmax(0,1fr)` and `.tree-panel` carries `min-width:0`.

## Task 16 (v1.2): performance budgets and the v1.2 release checkpoint

- Files outside the Files block: this entry (`docs/decisions.md`), as
  every task records. All other writes are the Files block verbatim.
- The nj-basics budget is measured end to end — Run-button click to the
  "Run complete" status — in the built app on the preview server
  (:4174), the same basis as `perf-protein.spec.ts`.
- The ETA check compares the worker's `estimate.totalMs` (sent after
  replicate 0) against the actual start→result wall-clock of the same
  run; the spec's "actual time" is the whole run, not the post-estimate
  remainder.
- The 50 ms main-thread budget maps to zero `longtask` entries — the
  Long Tasks API only reports tasks that already exceed 50 ms.
- `CITATION.cff` bumped to 1.2.0 with `date-released` removed rather
  than left stale — the plan leaves the date for the owner, and a wrong
  date would assert a release that hasn't been tagged yet (the
  checkpoint doc has the owner fill it at tag time).

### fix/bootstrap-basics-sequencing-layout (bootstrap-basics round 3–4 fixes)

- **`after` note triggers** (round 3): `Prompt`/`PromptFile` gained
  `after`, validated in `prompts()` against the new `NoteAfter` enum
  (`first_run` | `continue_or_second_run` | `longer_run`); bad values
  report `InvalidExercise { field: "prompts.{i}.after" }` — dot
  notation, matching every existing prompts.* field name. The enum is
  exported via ts-rs; `exercises/schema.json` mirrors the values as a
  JSON enum and `__fixtures__/bad-after.json` keeps the schema/engine
  agreement test honest. `after` is value-checked on any prompt type
  (the schema's "unknown properties are ignored" stance means it can't
  forbid it per-type without breaking parity).
- **Sequencing lives in the gate:** `session.bootstrap` counts
  `completedRuns` and `maxRunSites` (sites of the longest completed
  run; cleared with the results on any data change). `usePromptGate`
  folds those plus a `continued` set into a STICKY `unlocked` set —
  the triggers are one-way, so a re-simulation that resets the run
  count never re-hides a note ("once shown it stays"). The
  `longer_run` threshold is `LONGER_RUN_SITES = 3000` in
  `lessons/prompts.ts` — the task's "Length ≥ 3,000" made literal
  rather than inferred from the exercise's own length.
- **Continue buttons:** a sequenced note offers Continue only while
  its successor stage isn't already unlocked by a run — the button is
  never a dead end (`continueFor` in the gate, `.prompt-continue` in
  `PromptCard`).
- **Natural tree sizing** (round 4): `sharedSpacing` is now the fixed
  `LEAF_SPACING_NATURAL = 28` instead of filling the measured row; the
  `.trees` row is content-height, `.tree-canvas` caps at 1,180 px
  (~40 leaves × 28 px + padding) so inner scrolling only appears
  above `LEAF_SCROLL_CUTOFF = 40` leaves, and `.prompts` is its own
  grid row capped at 34 vh with `overflow-y: auto` — the notes scroll
  instead of shrinking the trees. The column itself scrolls when the
  stack is taller than the viewport; the heatmap's `max-height: 100%`
  is gone so it keeps its natural size rather than squeezing text.
  *Deviation from the checkpoint-15 layout:* trees no longer stretch
  to fill ~45% of the column — they take their natural height, and
  the empty space that used to sit under them is gone.
- **Text ≥ 12 px:** heatmap `FONT`/`LABEL_FONT` went 9/10 → 12; the
  consensus tablist wraps (`flex-wrap: wrap`) so all four labels stay
  complete — the wrap/nowrap history was a starvation workaround that
  content-height rows make unnecessary; the absolutely-positioned
  consensus svg is back in flow so the canvas sizes to the drawing.
  The reroot caption wraps because the column now grows to fit it.
- **Files outside the owner's list:** `docs/decisions.md` (this
  entry), `web/src/engine/generated/{Prompt,NoteAfter}.ts`
  (regenerated by `export_bindings`), `web/src/engine/pkg/*`
  (rebuilt by `scripts/build-wasm.sh` — required, vitest runs the
  compiled artifact), and `after: null` added to `Prompt` literals in
  three existing test files (generated type now requires the field).

## ci/speed: faster local and PR feedback without weaker main/release gates

- **Measured first.** Last five completed PR runs (`gh run view --json
  jobs`, seconds of job wall time): R/fixtures 195–289 (setup-R
  39–61 s + R-package deps 96–157 s inside it), e2e webkit 94–416
  (one 256 s browser-install outlier), e2e chromium 103–273, e2e
  firefox 93–137, web 62–69, wasm 52–68, deploy 44–54, fuzz-build
  39–56, rust 31–53, licenses 24–37, fixture-guard 3–6. Critical path
  was R/fixtures-or-webkit → deploy: ~5–8 min to mergeable. Locally
  the default `./scripts/check.sh` cost ~170 s warm (wasm 129 s,
  web 27 s, rust 12 s, fixture-guard ~0 s; e2e/R/fuzz opt-in, idle).
- **PR fast path.** A `changes` job (dorny/paths-filter@de90cc6f,
  v3.0.2) path-filters the heavy jobs; a skipped job reports a passing
  conclusion so required checks stay green. PR e2e is Chromium only,
  sharded `--shard=n/2` across two runners, `E2E_PERF=0` skips @perf.
  Docs-only changes (`docs/**`, `*.md`, `CITATION.cff`, `LICENSE`)
  match no heavy-job filter, so a docs PR costs fixture-guard + rust
  (~1 min) — the <2 min target.
- **Full matrix is untouched where it matters.** `full` = every non-PR
  event (main push, `v*.*.*` tag, new nightly cron `0 3 * * *`,
  workflow_dispatch on any branch — the manual "run the full matrix
  on this PR's branch" path). All three browsers ×2 shards run @perf
  in-shard, R parity and the fuzz build run, and `deploy`'s `needs`
  now includes `fuzz-build` and `licenses` in addition to the previous
  jobs, so a production deploy cannot land unless the full matrix
  passed for that tagged commit. Concurrency cancels superseded
  PR/branch runs but never main or tags.
- **R stack is a pinned image.** `docker/ci-r/Dockerfile`
  (ubuntu:24.04 + Debian `phylip` → /usr/lib/phylip/bin +
  `remotes::install_version` pins ape 5.8-1 / phangorn 2.12.1 /
  jsonlite 1.9.1 — the versions in the committed fixtures'
  `generator` field — verified by `stopifnot` inside the image
  build). `publish-ci-r.yml` rebuilds it monthly and on Dockerfile
  changes, pushing moving `:1` + `latest` and immutable `sha-<commit>`
  tags; `r-and-fixtures` uses `ghcr.io/dorrabbkhan/neophylo-ci-r:1` —
  removes the ~100–160 s R/PHYLIP setup. Bump the `:1` tag in both
  files for a breaking toolchain change.
- **Local tiers.** `./scripts/check.sh quick` runs fmt + clippy
  always, `cargo nextest`/`cargo test` only when
  `crates/|Cargo.toml|Cargo.lock` changed, `vitest --changed
  <merge-base>` only when `web/` changed, and rebuilds the wasm pkg
  only when its inputs changed (content-hash cache in
  `web/src/engine/pkg/.source-hash`, ignored via `pkg/`'s existing
  gitignore). The default check is unchanged (still the full local
  gate minus e2e). Measured: quick 1.6 s on a cache hit, 121 s worst
  case (crates changed → wasm rebuild); both inside the <2 min target.
- **Rust speed.** `[profile.dev.package."*"] opt-level = 3` +
  `[profile.test] opt-level = 2` in Cargo.toml (the engine is numeric;
  unoptimized deps dominated test wall time). cargo-nextest measured
  1.70 s → 0.61 s warm (PROPTEST_CASES=64; 256 cases → 0.99 s): small
  in absolute terms but ~free — CI installs the pinned prebuilt
  binary (get.nexte.st/0.9.149, sha256-pinned, cached like wasm-pack)
  and `rust.sh` falls back to `cargo test` where nextest is absent;
  a `cargo test --doc` step keeps doctests covered (nextest skips
  them). `PROPTEST_CASES` defaults to 64 locally, 256 when `CI=true`
  (proptest's own default; explicit so it is auditable). mold
  measured 46.5 s → 43.0 s on a cold `cargo test --no-run` — ~7 %,
  less than the apt-install cost — not adopted.
- **Wasm pkg cached in CI** keyed `hashFiles('crates/**','Cargo.lock',
  'scripts/build-wasm.sh')`; on a hit `WASM_PKG_HIT=true` makes
  wasm.sh skip only the rebuild — parity tests, generated-types diff
  and the bundle-size check still run against the restored pkg.
- **Agent loop.** `scripts/neophylo-loop.sh {watch|await|status}`
  backgrounds `gh pr checks --watch` so the review pass overlaps CI;
  only the final summary blocks on `await`. `neophylo-task`'s skill
  lists the required screenshot evidence for view/layout/export
  changes (PR comments, never committed).
- **Deviations from the task's literal filter table.** `wasm` also
  runs when the `fixtures` filter matches (r-and-fixtures downloads
  its artifact); `licenses` is gated like `web` since `web` needs its
  notices artifact; `rust` is unconditional (stable ~40 s required
  check); the `fixtures`/`webapp` filters also cover `scripts/**` and
  `.github/workflows/ci.yml` so script and workflow changes still
  exercise the jobs that run them. These are supersets — nothing the
  task required to run is skipped.
- **Required branch-protection check names** (skipped conclusions
  pass on PRs where the fast path applies): `changes`,
  `fixture-guard`, `rust`, `wasm`, `fuzz-build`, `licenses`, `web`,
  `e2e (chromium, 1)`, `e2e (chromium, 2)`, `r-and-fixtures`,
  `deploy`. On main/tags the e2e matrix expands to
  `e2e (<browser>, <shard>)` for firefox/webkit as well — the old
  `e2e (<browser>)` check names no longer exist, so protection
  entries must be renamed.
- **Targets vs measured.** Typical code PR <10 min: this PR's own
  run took ~13 min end to end, but it is the worst case — Cargo.toml
  changed, so rust-cache missed (rust 3m49s) and one e2e shard's
  `install --with-deps` apt run stalled ~9 min on a slow mirror
  (the other shard's whole job was 1m21s). Steady-state actuals per
  job: changes 4 s, fixture-guard 7 s, licenses 29 s, r-and-fixtures
  **58 s** (vs 195–289 s baseline — the R/PHYLIP image removes the
  per-run setup), wasm 2m7s on a pkg cache hit, web 1m8s, e2e shard
  1m21s, deploy 46 s, fuzz-build skipped (no crates/**). Docs PR
  <2 min: yes (~1 min: changes + fixture-guard + rust only). quick
  <2 min: 1.6 s hit / 121 s worst-case engine rebuild. Default check
  <8 min: 53 s warm. Known cost not yet cached: `playwright install
  --with-deps` re-runs apt per e2e job (normally ~1 min, observed
  9 min outlier) — a candidate follow-up.
- **Bug found by the new shard layout.** The two Chromium offline
  specs raced `clients.claim()`: `reg.active !== null` does not
  imply `controller`, so `setOffline` + `reload` could hit the real
  network (ERR_INTERNET_DISCONNECTED). Both specs now wait for
  `navigator.serviceWorker.controller !== null`. `r-and-fixtures`
  also needed `git config --global --add safe.directory
  "$GITHUB_WORKSPACE"` — checkout's safe.directory lives in a
  temporary HOME that does not persist to container run steps.
- **Container pinning + e2e in the Playwright image** (follow-up on
  this PR). Both job containers are pinned `tag@sha256:`:
  `neophylo-ci-r:1@sha256:f7618b63…` and
  `playwright:v1.64.1-noble@sha256:7852dc5a…` (the noble image ships
  Node 24, matching `.nvmrc`, plus all three browsers and their system
  libraries — `install --with-deps`, the browser cache and setup-node
  all drop out of the e2e job; `~/.npm` replaces setup-node's cache).
  `--ipc=host` is Chromium's shared-memory requirement.
  `scripts/ci/check-playwright-image.sh` fails the e2e job if the image
  tag version differs from locked `@playwright/test` (browser builds in
  the image are keyed to it) or if either container ref loses its
  digest pin, and also fails if `.nvmrc`'s major stops matching the
  image Node. Dependabot **cannot** bump `container:` refs inside
  workflow files (dependabot-core#5819, still open — it only tracks
  Dockerfiles), so both pins are maintained by workflow PRs via `gh`
  (chosen over peter-evans/create-pull-request: no new action
  dependency, `gh` is preinstalled): `publish-ci-r.yml` opens a digest
  bump PR after each image publish; `bump-ci-image.yml` resolves the
  matching `v<locked-version>-noble` digest weekly/dispatch, and on
  `pull_request_target` for Dependabot lockfile bumps it pushes the
  image bump onto the Dependabot branch itself so one PR carries both
  halves (restricted to `dependabot[bot]` + non-fork heads; no PR code
  executes — only the lockfile is read). GITHUB_TOKEN PRs/pushes do
  not trigger CI runs, so bump PRs need a close/reopen (or an empty
  commit) before their checks run — noted in the PR body the script
  writes. No `visual` job exists yet; nothing to convert there.
- **Findings from the first in-container full-matrix run.** (a) Firefox
  exited instantly: the container runs as root while GitHub mounts
  `HOME=/github/home` owned by the image's `pwuser`, and Firefox refuses
  a root launch on a foreign-owned `$HOME` — fixed with `HOME: /root` on
  the e2e step (Chromium/WebKit don't check). (b) The offline reload
  flake resurfaced differently: a raced navigation now *hangs* the full
  ~28 s nav timeout inside `toPass`, consuming the whole retry budget in
  one attempt — fixed with `page.reload({ timeout: 8_000 })` so raced
  attempts fail fast and retries actually cycle (a11y + bootstrap
  specs). Re-run `39822909530` is green on all six shards.
- **e2e timings, runner vs container.** PR shards (chromium, no @perf):
  1m09s/1m10s before → 1m18s/1m23s after; the ~1–2 GB image pull roughly
  offsets the dropped `install --with-deps`, and removes the 9-min apt
  outlier class entirely. Full matrix (all 3 browsers + @perf), run
  39822909530: chromium 2m19s/1m22s, firefox 1m45s/1m44s, webkit
  1m49s/1m34s; r-and-fixtures 1m01s on the digest-pinned image. Net win
  is determinism (no apt, browsers keyed to the exact playwright
  version) more than wall-clock on PRs.

### Files (ci/speed)

`.github/workflows/ci.yml`, `.github/workflows/publish-ci-r.yml`
(new), `.github/workflows/bump-ci-image.yml` (new),
`docker/ci-r/Dockerfile` (new), `scripts/check.sh`,
`scripts/ci/quick.sh` (new), `scripts/ci/rust.sh`,
`scripts/ci/wasm.sh`, `scripts/ci/e2e.sh`,
`scripts/ci/check-playwright-image.sh` (new),
`scripts/ci/bump-image-pin.sh` (new),
`scripts/neophylo-loop.sh` (new), `Cargo.toml`, `AGENTS.md`,
`.devin/skills/neophylo-task/SKILL.md`, `web/e2e/a11y.spec.ts`,
`web/e2e/bootstrap.spec.ts` (offline SW controller wait),
`web/e2e/bootstrap-lesson.spec.ts` (lesson-switch h1 wait),
`docs/decisions.md` (this entry).

## v1.3 Task 1: skills map, spec and plan, snapshot-baseline rule

- The v1.3 spec and plan were landed on main before this task ran, so
  the "Create: the spec and this plan" Files entry needed no work.
- Files outside the Files block: the plan's Files block lists
  `CODEOWNERS`; the repo's file is `.github/CODEOWNERS` (no root-level
  CODEOWNERS exists or was created). The
  `/web/e2e/__screenshots__/ @dorrabbkhan` line was added there.
  `docs/decisions.md` carries this entry.

## v1.3 Task 2: split session.ts into state modules

- `session.ts` keeps its public API identical: all 22 baseline names
  (`Session`, `BootstrapView`, `MIN_REPLICATES`, `MAX_REPLICATES`,
  `AUTO_RUN_MS`, `BootstrapStatus`, `BootstrapState`,
  `defaultBootstrap`, `clearBootstrap`, `exerciseSim`, `Action`,
  `CORRECTIONS`, `DIST_LABEL`, `SimModelName`, `SIM_MODEL_NAMES`,
  `SIM_LABEL`, `simModelName`, `reconcileModels`, `recompute`,
  `reducer`, `initialSession`, `hasImportedData`) remain importable
  from `./session`, mostly via re-exports. `defaultBootstrap` is now a
  re-export alias of `bootstrapInitial()`, the `xxxInitial()` the task
  interface requires.
- `Session` is still flat: it extends `LessonState`, `AnalysisState`
  and `UiState` plus `bootstrap: BootstrapState`, so `s.exercise`,
  `s.step`, `s.mode`, `s.bootstrap` keep working; no caller import
  changed.
- Each module exports `xxxState`, `xxxInitial()` and
  `xxxReducer(slice, action, ctx)`; `ctx` is the pre-action `Session`
  (read-only) — `bootstrapReducer` uses it for the finished run's
  alignment site count. Actions that write across slices
  (`load`/`setSim`/`setAnalysis`/`setAlphabet`/`importAlignment`/
  `importTree`/`setBranchScale`/`enterSandbox`/`exitSandbox`) cannot be
  expressed as a slice reducer, so they live as Session-level `apply*`
  helpers in `lesson.ts` (they all rewrite the exercise or the
  imported data, then `clearBootstrap` + `recompute`); `reducer`
  dispatches to them or to `compose`, which merges the slice reducers
  and returns the session itself when no slice changed (no-op
  dispatches keep their identity, as before).
- Files outside the Files block: `web/src/state/actions.ts` (new)
  holds the `Action` union verbatim (its members reference the slice
  state types instead of `Session[...]`, same types). Keeping the
  union in `session.ts` would push the composer past the task's
  150-line cap. `docs/decisions.md` carries this entry.

## v1.3 Task 3: design tokens with the current look

- `color` holds the 15 §3.2 tokens per theme — light keeps the current
  light palette, dark the current prefers-color-scheme one (no visual
  change). Three values had no §3.2 slot and are emitted by
  `cssVariables` as derived vars so no pixel moves: `--color-text-h`
  (the third text level, ex `--text-h`), `--color-accent-bg` /
  `--color-accent-border` (rgba tints derived from `accent` at the old
  alphas 0.10/0.15 and 0.50) and the unthemed `--color-scrim` /
  `--color-aa-*` Okabe-Ito tints / `--color-aa-text` pair-panel palette.
  `--color-wrong-clade` replaces `--danger` on the `.wrong` annotation
  (same value today). Unused semantic tokens (`support-weak`,
  `highlight`, `focus`) take the closest current-look value until
  Task 6 designs the real themes.
- Font sizes are unchanged: the stylesheet's off-scale 9/11/13/15/17
  px live in `legacySize` (emitted as `--size-legacy-*`), which exists
  by owner decision (option 1 on PR #65) so Task 3 is a pure refactor
  — Task 6 removes `legacySize` and moves every use onto `size`, with
  the owner approving the baseline changes there. 12/14/20 px rules
  use `--size-xs/sm/lg` directly, and `--font-mono` keeps `Consolas`
  from the old `--mono` stack. All colors, geometry, spacing and radii
  are unchanged — spacing/radius literals stay for Tasks 9–11 to
  normalize (the §3.4 test enforces colors + font sizes).
- `export/svg.ts` inks with the `exportInk` token (#1a1a1a — the same
  value as the old literal, held outside `ColorTokens`) and the pill
  uses `color.light.bg`/`border` at their identical values; ink stays
  #1a1a1a until Task 15 applies the §7.3 print palette. Exported font
  stack stays as-is; Task 4/15 wire `font.ui` + embedding.
- The generated `tokens.css` keeps the pre-token behavior: bare `:root`
  is light, `prefers-color-scheme: dark` still applies dark until
  Task 6 sets `data-theme` (the plugin emits
  `:root:not([data-theme])` inside the media query plus the two
  `data-theme` blocks §3.1 names).
- Files outside the Files block: `web/.gitignore` gained a
  `src/design/tokens.css` entry — the generated file must never be
  committed (spec §3.1). `docs/decisions.md` carries this entry.

## v1.3 Task 4: bundled Inter and JetBrains Mono

- `scripts/fonts/subset.sh` adds `--no-hinting` to the `pyftsubset`
  flags and subsets the upstream hinted TTF statics (Inter
  `extras/ttf/`, JetBrains Mono `fonts/ttf/`), not the OTF/CFF builds:
  hinted subsets exceed the spec §4.1 200 KB budget, and Inter's OTF
  statics subset ~20% larger once hinting is dropped. Final bundle:
  16 woff2 files, 189,320 bytes — the 200 KB budget is unchanged.
- The TreeView render gate (spec §4.2): the `<svg>` is withheld until
  `whenFontsReady()` settles, up to the 3 s budget. A timeout lays out
  on fallback metrics, and `onFontsLateLoad` fires a single re-render
  (`bumpFontsTick`) so the uncached measurer re-reads the real Inter
  metrics — the one permitted late re-layout.
- `makeTextMeasurer`'s default probe family is now the `font.ui`
  token (was: inherit the host context) so measurements name the
  bundled Inter faces the tree draws; the SVG export still passes its
  standalone document's own stack.
- Files outside the Files block: `web/src/design/tokens.ts` — the
  Interfaces section requires `tokens.font.mono` =
  `"JetBrains Mono", ui-monospace, monospace`, and the token lives
  here (the `Consolas` entry was dropped). `about.toml` — plausibly
  "the license aggregation config" the Files block names, recorded for
  completeness: `OFL-1.1` added to `accepted` so the cargo-about gate
  covers the font license. `web/scripts/licenses.ts` — the license
  aggregation script, whose `ACCEPTED_LICENSES` must mirror
  about.toml's `accepted`; `OFL-1.1` added for the same reason.
  `docs/decisions.md` carries this entry.
- Fix round 1, offline e2e regression (root cause): the specs' readiness
  check is `waitForFunction(async () => …)` — Playwright resolves an
  async predicate on its first settled promise, so the wait is a no-op
  and the test cuts the network at ~200 ms after nav. That race was
  always thin; this branch's `**/*.woff2` precache glob added ~36 files
  to the SW install (the 16 bundled fonts plus ~20 KaTeX woff2 assets
  that were never precached before), pushing activation to ~250–275 ms
  (base: ~180 ms). `setOffline` landed mid-install, the precache fetch
  died, the worker went redundant, and every offline navigation then
  missed the SW — `net::ERR_INTERNET_DISCONNECTED`. What looked like a
  second installing worker was the same install job retrying (and
  dying) while offline. Fix (app/build side, tests untouched): narrow
  the glob to `fonts/*.woff2` — spec §4.2 precaches the bundled font
  files, KaTeX assets stay out — register the SW at index.html parse
  time instead of window `load` (`injectRegister: false` + an inline
  `<script>` in `web/index.html`), and `inlineWorkboxRuntime: true` to
  drop a round trip. Activation now lands ~150 ms, ahead of the test's
  ~200 ms deadline with margin similar to or better than main's.
- Fix round 1 also added `fontsStatus()` to `web/src/design/fontsReady.ts`
  (synchronous gate snapshot) so a TreeView mounted after fonts settled
  renders its `<svg>` on the first render instead of a blank frame.
- Fix round 1, files outside the Files block: `web/index.html` — hosts
  the inline parse-time `serviceWorker.register` (replaces the plugin's
  generated load-gated registerSW.js); `web/public/_headers` — dropped
  the now-dead `/registerSW.js` and `/workbox-*.js` rules (the workbox
  runtime is inlined into sw.js).
- Fix round 2, offline e2e flake (root cause): the readiness wait in
  `a11y.spec.ts` and `bootstrap.spec.ts` was
  `waitForFunction(async () => …)` — an async predicate returns a
  Promise object, which is truthy, so Playwright's poll resolved on the
  first tick and the wait never waited; `setOffline(true)` then raced SW
  activation (job 120184590212's `ERR_INTERNET_DISCONNECTED`, still
  flaky 1/3 on 406f3a1). Fix (test side, stricter — no sleeps, retries,
  timeouts or skips added, assertions unchanged): new shared
  `waitForServiceWorkerControl(page)` in `web/e2e/helpers.ts` awaits
  `navigator.serviceWorker.ready` in `page.evaluate` — an active worker
  implies install+precache completed — then, because the generated
  sw.js never calls `clients.claim()` (so a first load is never
  controlled), reloads once while still online so the page is genuinely
  controlled before the network is cut. Verified: both tests pass
  `--repeat-each=10` on chromium against this branch's preview, pass
  once each on merge base e3acf22 with the new wait (the old failure
  was the test-side race, not an app regression), and fonts.spec.ts
  passes on all three engines.
- Fix round 2, files outside the Files block: `web/e2e/helpers.ts` —
  new `waitForServiceWorkerControl` helper; `web/e2e/a11y.spec.ts` and
  `web/e2e/bootstrap.spec.ts` — the offline tests now call it (the only
  `waitForFunction(async` sites in web/e2e; a grep found no others).
- Fix round 3 (owner decision, option 1): the extra still-online reload
  in `waitForServiceWorkerControl` added a second online load, breaking
  the tests' "after ONE online load" premise. Dropped it: the helper is
  renamed `waitForServiceWorkerReady(page)` and now only awaits
  `navigator.serviceWorker.ready` (an active worker implies the
  precache-completing install finished). The page itself is never
  controlled on first load — the generated sw.js has no
  `clients.claim()` — but a navigation selects the active registration,
  so the offline reload in each spec is already intercepted by the
  worker and the one-load premise is preserved. Call sites and comments
  in `a11y.spec.ts` and `bootstrap.spec.ts` updated to match;
  assertions unchanged. Verified: both offline tests pass
  `--repeat-each=10 --retries=0` on chromium against this branch's
  preview build (20/20).
## v1.3 Task 5: visual snapshot infrastructure and first baselines

- `web/e2e/data/weak-support.fasta` is the checkpoint-11 recipe output
  (the `~/cp12/weak_support.fasta` artifact from the v1.2 checkpoint
  run): 6 taxa A–F, 120 sites, seed 5. Verified in-app: the seeded
  100-replicate NJ/JC69 run shows weak styling — groupings at 42* and
  32* — so the `[data-weak="true"]` assertion in the `weak-support`
  scene is a real premise check, not a tautology. Task 12 ships
  `scripts/samples/weak_support.py` to regenerate it byte-identically.
- The `four-taxa` scene pastes the checkpoint-11 4-taxa block inline
  (from `~/cp12/scripts/tiny_taxa.txt`); `replicate-panel` drives
  cytochrome-c like the Task 4 evidence captures; `export-svg-roundtrip`
  downloads "SVG (rooted on wheat)" and renders it back in a bare
  white document — the export is theme-independent by design (fixed
  ink + system font stack), so light/dark baselines of that scene are
  identical on purpose.
- Baselines were generated inside the exact CI image
  (`mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a…`,
  the e2e/visual job container) with `PLAYWRIGHT_BROWSERS_PATH` pointed
  at the image's baked-in browsers — the exported SVG's system font
  stack and any fallback glyphs render only identically in that
  environment. A second container run reproduced all 42 with zero
  diffs.
- Known current-look quirks the baselines record (all in Task 9's
  scope, not bugs to fix here): at 768 wide the page itself scrolls
  sideways and leaf labels at a tree panel's right edge
  (`cytc-computed`'s "neurospora", `bootstrap-basics-final`'s "H") are
  clipped behind the panel's horizontal scroll — allowed by the
  layout invariants until the responsive layout lands.
- Files outside the Files block: `scripts/ci/visual.sh` — the
  workflow's runner script (the repo convention is that every CI job
  delegates to `scripts/ci/*.sh`; the ci.yml job named in the Files
  block calls it). `web/e2e/data/weak-support.fasta` — the scene
  definition names it and says "committed here". `docs/decisions.md` —
  this entry.

## R parity: R-side resampling seeded

- Found on PR #67: the bootstrap statistical-parity section of
  `web/scripts/r-parity.mjs` was nondeterministic. `bootScript()`'s
  generated R resample loop had no `set.seed`, so ape's column resamples
  changed on every run while the engine side is seeded. Across 6 CI
  runs the worst p6_150 Kimura/NJ split gap ranged 0.70–5.06 pp against
  the 5 pp budget and failed once.
- Fix (owner's choice in the PR #67 escalation): `bootScript()` takes a
  `seed` parameter (default 1, matching the engine side's `seed: 1`
  convention in the file) and emits `set.seed(<seed>)` immediately
  before the resample loop. Both parity cases (jc12 JC69/NJ, p6_150
  Kimura/NJ) use the same `BOOT_SEED = 1`. The R and engine RNGs still
  differ, so the check remains an independent — now fixed — sample.
- Unchanged: the 5 pp budget, BOOT_REPS (1000), the fixtures, the
  engine, and every other check in the script. No seed was picked to
  pass; seed 1 was used as specified.
- Follow-up (same PR): the `fixtures` paths-filter in ci.yml now also
  lists `web/scripts/r-parity.mjs`, where the parity logic actually
  lives — before this, a change to the parity script could skip the
  r-and-fixtures job entirely, and this PR's first CI run did skip it.
## Firefox support-label regression (from v1.3 Task 4) and Firefox on rendering PRs

- Owner-requested fix, one PR, two parts (not a plan task). Branch
  `fix/firefox-support-label`.
- Root cause: the on-segment convention seats a support pill with its
  centre exactly ON the 10 px acceptance bound — at the app's
  `smallFont` (12 px → 16 px pill) `raise0 = min(GAP, 10 − pillH/2) = 2`,
  centre −10.0. The e2e check measures the drawn rect with `getBBox`
  and allows ~1e-6 of slop. Chromium's `getBBox` returns the rect's
  float64 geometry verbatim; Firefox's is float32-precise (Gecko stores
  SVG geometry as `float`), so the same attribute
  `y="110.4166669845581"` reads back `110.41666412353516` and the centre
  offset computes as 10.0000029 > 10 + 1e-6. Whether a boundary pill
  passed in Firefox was luck — before Task 4's bundled-font metrics,
  every pill's float32 rounding happened to fall inside the bound; the
  new y values round node 10's pill the other way. Evidence (seeded
  cytochrome-c run, rooted view): Chromium `dy = 10` (attribute and
  `getBBox` agree exactly); Firefox `dy = 10.0000029`.
- Fix (`web/src/layout/supportLabels.ts`): placements keep the pill
  centre strictly inside the ±10 px bound by `BOUND_INSET = 0.25` px —
  `raise0` becomes `min(GAP, DROP_PAD − BOUND_INSET − pillH/2)` (1.75 px
  at 12 px type, a sub-pixel move) and the extended downward nudge stops
  at centre +9.75 instead of +10.0. No test, tolerance, fixture or
  baseline changed; `supportLabels.test.ts` expectations updated for
  the new base raise. 0.25 px is ~2500× the worst float32 rounding at
  these viewBox magnitudes, and invisible in the drawing.
- Evidence: the failing spec passes `--repeat-each=3` in Firefox in the
  pinned image; the full e2e suite passes in Chromium (45), Firefox
  (43) and WebKit (43) in the pinned image; the `visual` project passes
  42/42 with ZERO baseline changes in the pinned image. Before/after
  screenshots of the seeded cytochrome-c inferred tree in Firefox and
  Chromium are a PR comment — all leaves visible, no clipped or
  overlapping labels.
- CI change: a `render` paths-filter output in `ci.yml` matches
  `web/src/{views,layout,export,design}/**`, `web/src/measureText.ts`,
  `web/public/fonts/**`, `web/e2e/**` and the workflow itself; on PRs
  the e2e browser matrix becomes `["chromium","firefox"]` when it
  matches. Non-PR events keep all three browsers. Cost: +2 e2e shards
  (~+35–60 s wall) only on rendering PRs — the regression this fixes
  shipped through Chromium-only PR e2e on #66 and #67.
- Files outside a plan Files block (owner-requested fix): this entry
  plus `docs/decisions.md` itself.

## v1.3 Task 6: light-first themes, toggle and contrast

- `UiState` grows the full §7.1 field set in one go (`theme`,
  `presenter`, `drawerOpen`, `tourStep`): the task's Produces block
  defines that shape and Tasks 10–12 wire the rest. `uiInitial()`
  reads the `neophylo.theme` device pref (light default); `setTheme`
  only touches the ui slice, so a mid-run switch can't recompute or
  drop state (Review Focus 4).
- Theme plumbing lives in a new `web/src/design/theme.ts`
  (`readThemePref`/`applyTheme`, both try/catch-guarded); the
  index.html inline script repeats the same fallback so `data-theme`
  is set before first paint. `tokensCssPlugin` drops the
  prefers-color-scheme fallback entirely (spec §3.3: light regardless
  of OS) and emits `color-scheme` per theme so scrollbars/form chrome
  match.
- Palette: light keeps the current near-white projector palette;
  `supportWeak` becomes a caution amber in both themes (a
  supplementary cue — weak support is still carried by the thinner
  stroke + "*" glyph, never color alone). `highlight` stays equal to
  `accent` — that IS the highlight style. Dark is refined: `success`
  lifts to #3fb950 (the old #1a7f37 was ~3.3:1 on the dark ground —
  under the 4.5:1 bar for the body-size "Correct" verdict) and
  `supportWeak` is the lifted amber #fbbf24. `contrastRatio` covers
  every required pair plus the semantic text colors.
- `legacySize` is gone (the Task 3 owner's option-1 decision said
  Task 6 removes it under baseline approval): every use moved onto the
  type scale — 9/11 → xs, 13 → sm, 15 → md, 17 → lg. Nothing in the
  app now renders under 12 px.
- Baselines were regenerated inside the exact pinned CI image
  (`mcr.microsoft.com/playwright:v1.64.1-noble@sha256:7852dc5a…`, the
  e2e/visual job container), like Task 5 — host-local renders differ
  enough to fail the 0.001 ratio. A second container run reproduced
  all 42 with zero diffs.
- The mid-run Review Focus 4 e2e opens the pair panel at step 0 (the
  final position's matrix holds cluster labels, which can't resolve
  to a taxon pair), toggles via `dispatchEvent` — the modal scrim
  makes a pointer click physically impossible, and the assertion is
  about state retention — then closes, returns to the final step and
  confirms the run completes.
- Files outside the Files block: `web/src/views/Header.tsx` (the Files
  block says "Modify" but no such file existed — the header markup
  lived inline in `App.tsx`; created per the File Map, which Tasks 8
  and 10 also modify). `web/src/views/App.tsx` (mounts `Header`, owns
  the session-theme → `data-theme` + storage effect).
  `web/src/design/theme.ts` (the pref helpers above).
  `web/src/state/actions.ts` (the `setTheme` action lives in the
  union). `web/src/design/tokensCssPlugin.ts` (default-light +
  color-scheme above). `web/src/index.css` (the `legacySize`
  migration, `.theme-toggle` styles, the dropped static
  `color-scheme`). `web/e2e/visual.spec.ts` (scenes now pick the theme
  through the `neophylo.theme` device pref, not
  prefers-color-scheme emulation). `docs/decisions.md` — this entry.
- Fix round (PR #70 review): the pair-panel residue ink is now the
  theme's own `text` (identical in light, #e5e7eb in dark) and the
  Okabe-Ito `special` tint drops to 0.25 alpha in dark only — the
  unthemed "#241f2e on translucent tint" cells measured 1.17–3.44:1 on
  the dark surface, under the 4.5:1 bar. `contrast.test.ts` now checks
  every `--color-aa-*` composited over `surface` plus `text` over
  composited `--color-accent-bg` (via a new `compositeOver` helper), and
  `theme.spec.ts` runs axe on the open pair panel in both themes.
  `web/src/index.css` (comment only — it repeated the false "dark text
  in both schemes" claim) sits outside the Files block, like the rest
  above.
- Plan amended at the owner's request on PR #70: Task 9 adds a header-controls-visible-at-all-widths test (the theme toggle is clipped at 1024 and off-screen at 768 until then, a pre-existing header overflow); Tasks 10 and 11 must exercise Review Focus 4 through real input only, stopping for an owner decision if the modal design leaves no such path. Files outside the Files block: the plan file.

## v1.3 Task 7: icon options

- Spec §5 says the icon is "drawn with the `accent` color" without saying
  which theme's. Resolved: the files carry the light accent `#aa3bff` as
  the canonical brand color via `color` + `currentColor`, so a standalone
  render (favicon/PWA/og-image) shows the accent while an inlined copy can
  still be themed with CSS `color`. Documented in
  `docs/brand/icon-options.md`.
- The Playwright preview script ran from `/tmp` inside the pinned CI
  image (same pattern as Task 5/6 baseline renders); its outputs are PR
  comment images, not commits, per the task.
- Owner chose Option C ("Node link") on PR #71;
  `web/public/brand/icon.svg` is a byte-for-byte copy of
  `options/option-c.svg` and the unchosen option files were deleted.
- Files outside the Files block: `docs/decisions.md` — this entry.

## v1.3 Task 8: brand assets

- Every asset is rendered from `web/public/brand/icon.svg` (the Task 7
  Option C file) — the generator never redraws the mark. The SVG icons
  keep transparency; `apple-touch-icon.png` and `icon-maskable-512.png`
  are solid (`bg` from the light tokens — transparency composites onto
  black on iOS, and maskable needs a full-bleed ground). The maskable
  mark sits at 70% (`MASKABLE_MARGIN = 0.15`, spec's ≥ 10% each side);
  the e2e spec checks the rendered outer band, the unit test checks the
  constant.
- `favicon.ico` packs the 16/32/48 px renders as PNG-in-ICO entries
  (valid since Vista). `og-image.png` renders the spec §5 template
  (icon, "NeoPhylo" in Inter 600, the tagline) with the bundled Inter
  subsets as data URIs so the card doesn't depend on installed fonts.
- `index.html` `og:image` is a relative `/brand/og-image.png`: the site
  deploys to both Netlify (root) and GitHub Pages (`NEOPHYLO_BASE`
  scope), so no absolute origin is correct everywhere.
- `Wordmark` renders the canonical `icon.svg` via `<img>` (never a
  redrawn copy) at `text` color; `sm`/`md` map to the 16/20 px type
  scale steps. The manifest now lists `brand/icon.svg` + the 192/512
  and maskable PNGs; `web/public/favicon.svg` and `icons.svg` stay on
  disk but nothing references them anymore (cleanup left for a
  follow-up — deleting files is outside this task's scope).
- Baselines regenerated in the pinned CI image, same as Tasks 5/6 —
  the header wordmark changes every full-page scene.
- **Narrow-width icon-only wordmark (owner decision 2026-10-23, PR #72
  escalation, option 1):** the full wordmark pushed the header over
  main's height at the narrow snapshot viewports — at 1024×768 the
  title and the last two buttons wrapped to two lines (~76 px vs main's
  53), and at 768×1024 controls clipped at the right edge. Below the
  wide breakpoint (`@media (width < 1280px)`, per the plan's
  breakpoints) `.wordmark-text` is visually hidden but stays in the
  DOM, so the accessible name is still "NeoPhylo"; `.wordmark` itself
  is `flex-shrink: 0`. The header is then exactly as tall as on main at
  both 1024×768 and 768×1024 — including the scenes where main's own
  header already wrapped at 768 px (parity, not a forced single row).
  A proper responsive header is Task 9's scope.
- Files outside the Files block: `web/src/index.css` (the app's single
  stylesheet — the wordmark styles had nowhere else to live);
  `web/scripts/brand.test.ts`, `web/src/views/Wordmark.test.tsx`,
  `web/e2e/brand.spec.ts` (the task's tests — the Files block named no
  test files); `docs/decisions.md` — this entry.

## v1.3 Task 9: responsive layout

- **Medium breakpoint without the drawer (owner decision, PR #73):**
  spec §6.1's medium and narrow arrangements put the controls in the
  Task 10 settings drawer, which does not exist yet. The owner chose
  option B: at medium (1024–1279 px) the wide layout keeps its first
  two columns — controls left, center right in its wide internal order
  — and the explanation sits below the center content inside the
  center's column track (`"controls center" / "controls explain"`), not
  in a third column. Below 1024 px (narrow, compact) everything stacks
  in a single column in §6.1's order — notices, trees (true over
  inferred, full width each), matrix, prompts, explanation, controls
  last — and `.app-grid` becomes the one vertical scroller
  (`overflow-x: clip`). Task 10 replaces the controls column/drawer
  split with the real drawer.
- **200 %-zoom test:** the plan's `document.body.style.zoom = "2"`
  emulation does not re-evaluate viewport media queries in the pinned
  Chromium (verified: innerWidth and `(width >= 1280px)` stay put while
  scrollWidth doubles). The test instead uses a 640×400 viewport at
  `deviceScaleFactor: 2` — what a 1280×800 window at 200 % zoom actually
  presents to the page — so the compact layout is exercised for real.
- **Prompt order:** §6.1 lists "matrix, prompts" in the single column;
  the DOM order (prompts first) is kept at ≥ 1280 px "as today" and CSS
  `order` moves the prompt strip below the matrix below that.
- **Stepper.tsx and TreeView.tsx needed no changes:** the stepper is
  pinned by the `.app` grid row (safe-area padding + wrapping went into
  `.app-footer`/`.stepper` in index.css), and tree panels already scroll
  horizontally inside `.tree-canvas` for over-wide figures (§6.2).
- Files outside the Files block: `web/src/design/breakpoints.ts` —
  required by the task's own Interfaces → Produces (`Breakpoint`,
  `useBreakpoint`); `docs/decisions.md` — this entry.

## v1.3 Task 10: sheets, drawer, more menu, touch targets

- **Drawer replaces the controls column in JS, not CSS:** below 1280 px
  the `.col-controls` aside is not rendered; the same sections
  (Alphabet badge, Simulation, Analysis, How sure are we?, Import —
  sandbox only — and Export) render inside `SettingsDrawer`, a Sheet
  anchored to the left edge (§6.4). Rendering rather than hiding keeps
  a single DOM instance, so there is no duplicated state or hidden
  focusables — and crossing breakpoints mid-session cannot strand a
  second copy of the controls.
- **An open drawer survives into wide:** crossing to ≥1280 px with the
  drawer open keeps it open as an overlay (Review Focus 5's "open and
  focused" option — the alternative of closing it and returning focus
  to a button that no longer exists was worse). The wide grid's empty
  controls column is collapsed by a `:has()`-scoped media rule; closing
  the drawer brings the column back.
- **"Watch one replicate" dismisses the drawer:** the replicate sheet
  and the drawer must not stack, so `uiReducer` closes the drawer on
  any `setReplicateIndex` to a non-null index. Esc on the replicate
  sheet then lands on the page body rather than a gone trigger — noted
  as a deliberate deviation from the literal "returns focus to the
  trigger" test list (the trigger lived in the dismissed drawer); the
  pair sheet covers the true trigger-restore path.
- **Theme toggle sits above every scrim (z-index 40):** Review Focus 4
  requires a *real* pointer path to the theme toggle while a dialog is
  open. Raising the toggle over the scrim is the minimal answer that
  needs no synthesized events and no stop for an owner decision.
  Sheets below 1024 px leave a top strip clear so the raised toggle is
  never covered visually. The older `dispatchEvent("click")` theme
  tests were converted to real clicks; where a real click moves focus
  to the header, dialogs are closed via their own × button rather than
  Esc.
- **Sheet's initial focus skips disabled controls:** the replicate
  view's "Previous" button is disabled at index 0; focusing it is a
  no-op that left focus on `<body>` and made Esc silently dead. The
  shared Sheet now picks the first *enabled* focusable — this also
  fixes the pre-existing Esc-dead spot on main.
- **"Help" destination:** no in-app help page exists (§6.3), so the
  More menu's Help item links to the project README — the published
  documentation — as an `href`, same as Licenses and Source code.
  "Coming from PHYLIP?" is the only action item; it opens the existing
  help sheet and returns focus to the More button on close.
- **Skip link moves focus explicitly:** fragment navigation scrolls to
  `#main-content` but leaves `document.activeElement` on the link, so
  the click handler focuses the main element (it carries
  `tabindex="-1"`).
- **No sheet entrance animation:** a 120 ms opacity-in on `.sheet-backdrop`
  sections made WebKit's axe run report color-contrast violations on the
  open pair panel (mid-animation opacity is factored into the ratio).
  Transitions on buttons/menus remain, and the reduced-motion rule
  zeroes both transitions and animations.
- **Coarse-pointer geometry:** buttons/links get `min-width/height:
  40px` under `(pointer: coarse)`; matrix cells reach 40 px by scaling
  the svg's `min-width` to the 40 px floor (`.matrix-wrap` scrolls when
  it outgrows the column); predict_branch hits get a hidden ≥40×40 pad
  rect that only displays under coarse pointers — the visual line stays
  12 px for fine pointers. jsdom's unit tests are pinned to a 1280 px
  viewport in `src/test/setup.ts` so the wide layout (controls column)
  is what existing component tests see.
- **Baselines regenerated (owner gate):** the pinned Playwright image
  was run twice — second run zero diffs. Changed scenes (all below
  1280 px; every 1920×1080 baseline byte-identical):
  bootstrap-basics-final (1024×768, 768×1024, both themes),
  cytc-computed (1024×768, 768×1024, both), cytc-rooted (1024×768,
  768×1024, both), export-svg-roundtrip (1024×768, both), four-taxa
  (1024×768, 768×1024, both), replicate-panel (1024×768, 768×1024,
  both), weak-support (1024×768, 768×1024, both).
- Files outside the Files block: `web/src/views/App.tsx` — the drawer
  renders at the app root, the skip-link target lives on `<main>`, and
  the controls sections are shared between the aside and the drawer;
  `web/src/state/actions.ts` — the `setDrawer` action variant (the
  Action union lives there, not in ui.ts); `web/src/views/MatrixHeatmap.tsx`
  — the `.matrix-wrap` scroller and `--matrix-min` floor for coarse
  cells; `web/src/views/TreeView.tsx` — the predict_branch hit-pad
  rects; `web/e2e/layout.spec.ts` — Task 9's medium-column assertion is
  replaced by the §6.4 drawer check, and the header button count now
  follows the breakpoint; `web/e2e/theme.spec.ts` — real clicks per the
  plan's Review Focus 4 note; `web/e2e/visualScenes.ts` — the
  `inSettings` helper that drives controls through the drawer below
  1280; `web/src/test/setup.ts` — the pinned unit-test viewport;
  `web/src/views/Wordmark.test.tsx` — Header gained `breakpoint` and
  `drawerOpen` props; `web/e2e/__screenshots__/` — the regenerated
  baselines above; `docs/decisions.md` — this entry.

### Fix round 1 (PR #74 review): toggle slot, drawer fit, matrix text floor

- **The theme toggle parks in the sheet's reserved strip below 1024
  px:** while a content sheet is open, `.theme-toggle` becomes
  `position: fixed; top: 10px; right: 16px` (its header spot was not
  stable — the wrapped header's second row dropped it onto the sheet
  title). The strip is the sheet's existing `padding-top: 52px`, so the
  toggle keeps its real-pointer path (z-40 over the scrim, under the
  drawer scrim's z-50) without touching sheet content. At ≥1024 the
  centered dialogs can't reach the header row, so the toggle is left
  in place there — the new e2e asserts the no-intersection box check
  at 768/1024/1920 for the pair panel, the replicate panel and PHYLIP
  help, in both themes.
- **The Newick-names select is clamped to its container**
  (`max-width: 100%`): its longest option is wider than the 320 px
  drawer — and than the 230 px controls column at wide, the same
  latent overflow. A new e2e asserts no drawer descendant crosses the
  drawer edges (elements inside an inner horizontal scroller exempt)
  plus `scrollWidth ≤ clientWidth` at 768 and 1024.
- **`.matrix-wrap` got a definite width below 1024 px:** as a column
  flex item with auto side margins it shrink-wrapped to the svg's
  300 px replaced fallback, scaling cell text to ~9.7 px. Now
  `width: 100%` (still capped at 560 and centered) — the same size the
  block layout gave it on main — and the svg carries `min-width:
  var(--matrix-w)` (its natural px width) with the wrap's
  `overflow-x: auto` unconditional: below the natural width the wrap
  scrolls and text never renders under the 12 px floor. Upper size
  unchanged (scales up to 560 exactly like main).
- **WebKit 1/64 px layout quantization:** WebKit renders a fractional-
  width svg a hair under its viewBox scale — a 40 px predict_branch
  hit pad reported 39.999 px (the §6.5 ≥40×40 test, WebKit only; PR
  e2e runs Chromium/Firefox so CI never saw it). `hitPad`'s floor is
  now 40.05 px (invisible rect, still ≥40×40 spec) and `--matrix-min`
  is `Math.ceil`ed, absorbing the quantization everywhere.
- Files outside the Files block (this round): `web/src/views/TreeView.tsx`
  (hit-pad floor), `web/src/views/MatrixHeatmap.tsx` (`--matrix-w`,
  rounded `--matrix-min`).
- **Baselines regenerated (owner gate):** pinned Playwright image, run
  twice, second run zero diffs. Changed: every 768×1024 scene in both
  themes except replicate-panel light, which stayed within tolerance —
  bootstrap-basics-final, cytc-computed, cytc-rooted, four-taxa,
  weak-support (both themes) and replicate-panel dark. The matrix now
  fills 560 px again and the toggle sits in the sheet's reserved strip.
  Every 1024×768 and 1920×1080 baseline is byte-identical.

## v1.3 Task 11: presenter mode

- **Mechanism (spec §6.6):** `<html data-presenter>` — set before
  first paint by the index.html inline script and kept in sync from
  `session.presenter` by `applyPresenter` (design/presenter.ts,
  `neophylo.presenter`, "1"/absent, try/catch, never in URLs). The
  generated tokens.css gains a `:root[data-presenter]` block from
  `presenterCssVariables()` that overrides exactly the `--size-*` and
  `--space-*` vars at `PRESENTER_SCALE` (1.5) — colors, radii, fonts
  and shadows stay, and the Task-3 discipline test still passes.
- **Tree text:** `treeFigure` takes a `textScale` option applied
  after the 12 px floor (21 px leaf labels, 18 px support pills);
  App passes `PRESENTER_SCALE` while the mode is on and scales the
  shared leaf spacing the same way (28 → 42 px/leaf). Exports are
  document-size figures: the ExportMenu `figure` prop pins
  `leafSpacing: LEAF_SPACING_NATURAL` and `ExportSvgOptions` has no
  `textScale` field, so no presenter factor reaches SVG/PNG/Newick
  (fix round 1 — the prop originally passed the scaled
  `sharedSpacing`).
- **Step buttons** get the scaled spacing tokens as padding
  (`--space-8`/`--space-12` → 12/18 px) on top of the scaled type.
- **Drawer-on-enable decision:** `setPresenter(true)` clears
  `drawerOpen` in `uiReducer` — the drawer button hides in presenter
  mode, so an open drawer can't be left up with its trigger gone.
  Its scrim (z-50) covers the toggles, so a real click can only hit
  this through a non-pointer dispatch, but the state must stay
  consistent either way; the drawer's focus restore finds its button
  unmounted and focus settles on the page body. Turning presenter
  back off does not reopen it.
- **Toggle slot (PR #74 pattern, widened):** theme + presenter sit in
  one `.header-toggles` flex wrapper (z-40 over the content scrim,
  under the drawer's z-50) so both stay real click targets while a
  dialog is open. Below 1024 the pair parks in the sheet's reserved
  strip as before. Presenter widens the problem to every width — at
  1.5× the header wraps below 1280 and an un-parked second row would
  land on the centered sheets — so under `[data-presenter]` the pair
  parks fixed at top-right while a content sheet is open at any
  viewport, and at ≥1024 the centered sheets take a `margin-top:
  var(--space-48)` (72 px at presenter scale) plus a matching
  `max-height: calc(88vh - var(--space-48))` so the parked toggles
  can never land on their headers and nothing overflows the bottom.
  The e2e asserts zero header-element intersection at 768/1024/1920
  in both themes, presenter on.
- **Header DOM order:** the More menu moved before the toggles so the
  presenter switch is the last button — enabling it removes the
  Settings button, and nothing it can remove sits after it (the
  layout spec clicks every header button in DOM order).
- **Baselines regenerated (owner gate):** pinned Playwright image
  (v1.64.1-noble digest-pinned), second run zero diffs. The new
  header button touches every scene's header, so the 36 non-roundtrip
  baselines changed; `export-svg-roundtrip` (6) stayed byte-identical —
  it renders the exported SVG on a bare page. First-push claim of "36
  of 42 regenerated" was wrong by one:
  `replicate-panel-768x1024-light` had stayed byte-identical to main —
  a real 560-px diff hidden under `maxDiffPixelRatio: 0.001` —
  regenerated in fix round 1. New baseline:
  `bootstrap-basics-final-presenter` at 1920×1080 light only.
- **Files outside the Files block:** `web/src/state/actions.ts` (the
  `setPresenter` variant — the Action union lives there),
  `web/src/design/presenter.ts` (device-local pref, mirrors
  design/theme.ts), `web/src/design/tokensCssPlugin.ts` (emits the
  `:root[data-presenter]` block), `web/index.html` (pre-paint
  data-presenter in the existing inline script), `web/src/views/App.tsx`
  (presenter prop, applyPresenter effect, hidden controls column,
  scaled spacing/textScale), `web/src/views/TreeView.tsx` and
  `web/src/views/ReplicatePanel.tsx` (textScale plumbing),
  `web/src/layout/treeFigure.ts` (the textScale option),
  `web/src/state/ui.test.ts` + `web/src/design/tokens.test.ts` +
  `web/src/views/Wordmark.test.tsx` (unit coverage / prop updates),
  `web/e2e/presenter.spec.ts` (the task's e2e list),
  `web/e2e/visualScenes.ts` (presenter scene + shared
  bootstrap-basics-final helper), `web/e2e/visual.spec.ts`
  (scene `only` restriction), `web/e2e/layout.spec.ts` (header button
  count 6/7), `web/e2e/__screenshots__/` (baselines above) and this
  file.

### Fix round 1 (PR #78 review): stale baseline, unscaled exports

- **Stale baseline regenerated:** `replicate-panel-768x1024-light`
  was byte-identical to main at first push — the real 560-px diff
  sat under `maxDiffPixelRatio: 0.001`, so `--update-snapshots`
  never rewrote it. Regenerated alone in the pinned Playwright
  image. A strict audit (throwaway spec with `maxDiffPixels: 0`,
  deleted after use) re-rendered every baseline still byte-identical
  to main — the six `export-svg-roundtrip` frames — and all six
  matched at 0 px, so no other baseline is stale. Two full
  visual-suite runs after the regen: 43/43, zero diffs. Changed
  scenes vs main: all six viewports/themes of bootstrap-basics-final,
  cytc-computed, cytc-rooted, four-taxa, replicate-panel and
  weak-support (36), plus the new bootstrap-basics-final-presenter
  baseline — `export-svg-roundtrip` (6) unchanged.
- **Exports no longer take presenter scaling:** the ExportMenu
  `figure` prop now passes `leafSpacing: LEAF_SPACING_NATURAL`
  instead of the screen's `sharedSpacing` — presenter's 1.5× spacing
  (and `textScale`) can no longer reach `exportSvg`, PNG or Newick;
  `ExportSvgOptions` has no `textScale` field at all. `panelWidth`
  still follows the measured `.tree-canvas` box (checkpoint 15):
  presenter changes it only through the layout's natural width change
  (the controls column leaves the grid), never through a scale
  factor. `App.export.test.tsx` drives the real App → ExportMenu →
  `exportSvg` path and asserts the SVG download is byte-identical
  with presenter off and on at the same tree and measured width —
  the drawer is force-opened through the captured dispatch because
  the menu has no UI path under the mode.
- **Files outside the Files block (this round):**
  `web/src/views/App.export.test.tsx` (the regression test) and this
  file.

## v1.3 Task 12: tour, empty/loading states, Sandbox samples

- **Weak-support generator could not reproduce the checkpoint-11
  bytes.** The committed `web/e2e/data/weak-support.fasta` (sha256
  6e5ca3fe…71bf) predates any written recipe. Reconstruction attempts:
  Python MT19937 (`random.seed(5)`, `Random(5)`, str/float/bytes seeds,
  choice/randrange/choices/getrandbits/random()*4 draw semantics) at
  every stream offset 0–39k words under all 24 alphabet permutations;
  numpy-legacy `init_genrand(5)` seeding at offsets 0–2k; and the
  engine's own ChaCha8 `simulate` (a verified pure-Python port of
  `sim.rs`, checked against the wasm output) — none matched the
  conserved columns. Per the conductor's fallback instruction,
  `scripts/samples/weak_support.py` is an honest seeded generator
  (seed 5, 6 taxa A–F, 120 sites, near-polytomous centre) writing a
  NEW file `web/public/samples/weak-support.fasta`. Owner decision
  (2026-10-24): the seed-5 generator output is canonical; the
  checkpoint-11 bytes are retired — the `weak-support` visual scene
  reads `web/public/samples/weak-support.fasta` (the file the Sandbox
  button serves), `web/e2e/data/weak-support.fasta` is deleted, and
  the six weak-support baselines were regenerated.
- **Tour auto-start rules (§6.7):** starts only when the URL resolved
  with `step === 0`, the raw href carries no `#x=`, the exercise came
  from the URL (a prop-driven `<App exercise>` — the unit-test path —
  never auto-tours), and `neophylo.tourSeen` is unread. Storage
  helpers live in `web/src/design/tour.ts` beside theme.ts/
  presenter.ts (the react-refresh lint forbids non-component exports
  from Tour.tsx); a module flag only covers the blocked-write case so
  in-memory state can't drift from storage.
- **`storageState` in playwright.config.ts marks `neophylo.tourSeen`
  for every project** (both dev 4173 and preview 4174 origins);
  `tour.spec.ts` overrides back to empty storage. This is the shared
  e2e mechanism the conductor prescribed instead of editing every
  spec's init script.
- **Consensus-tabs empty line sits under the tab strip** while no run
  is done, so the disabled tabs explain themselves (§6.8).
- **Files outside the Files block:** `web/src/state/actions.ts` (the
  tour* action types — ui.ts handles them), `web/src/design/tour.ts`
  (device-local pref helpers, mirroring theme.ts/presenter.ts),
  `web/src/views/Header.tsx` and `web/src/views/MoreMenu.tsx` (the
  "Take the tour" item + dispatch), `web/src/index.css` (tour,
  empty-state and skeleton styles), `web/playwright.config.ts` (the
  tourSeen storageState), `web/e2e/visualScenes.ts`,
  `web/src/views/MoreMenu.test.tsx`, `web/src/views/App.prompts.test.tsx`
  (the §6.8 loading text), `web/src/views/ImportPanel.test.tsx`,
  `web/src/views/BootstrapPanel.test.tsx`,
  `web/src/views/ConsensusTabs.test.tsx` (the new assertions),
  `web/e2e/sheets.spec.ts` (the More-menu item list gained "Take the
  tour") and `web/src/state/ui.test.ts` (the tour reducer tests) —
  both missed from this list in the first round — and this file.
  Round 2 (owner decision 2A) adds: `web/src/views/SettingsDrawer.tsx`
  (the 1024–1279 tour item) and `web/e2e/layout.spec.ts` (the header
  button count). Round 3 (owner decision B) adds:
  `web/src/views/LessonsMenu.tsx` + `web/src/views/LessonsMenu.test.tsx`
  (the ≥ 1280 "Take the tour" menu item) and
  `web/src/views/Header.test.tsx` (asserts no tour button in the
  header at any width).
- **Baselines regenerated:** round 1 only `four-taxa` (6 files: 3
  viewports × 2 themes) — the one scene where the new bootstrap-idle
  and consensus-tabs empty lines are actually visible; every other
  diff was sub-threshold stale noise reverted to main bytes. Round 2
  (owner decisions 1A/2A) adds the six `weak-support-*` frames (the
  canonical seed-5 sample). Round 3 reverts every 1920×1080 frame
  that changed only for the header button back to main's bytes and
  regenerates the `weak-support-*` ×6 and `four-taxa-*` ×6 frames —
  the only scenes that legitimately differ from main (the canonical
  sample and the §6.8 empty lines). No baseline differs because of
  the header.

### Fix round 3 (owner decision B, 2026-10-24): the ≥ 1280 reopen path moves into the Lessons menu

The round-2 "Take the tour" header button wrapped the header controls
to two rows at exactly 1280 px on the longer lesson titles
(cytochrome-c, saturation, upgma-fails — 95 px vs main's 54 px). The
owner chose **option B**: drop the button entirely.

- `web/src/views/LessonsMenu.tsx`: a "Take the tour" `menuitem` is
  the menu's last row when `onTakeTour` is set — plain action role
  (never `menuitemradio`/`aria-checked`), joined into the roving
  `active` index so arrows/Home/End reach it and Enter/Space activate
  it like every other item. Separated from the lessons by a
  token-space gap + the same 1 px rule (`.lessons-menu-tour` in
  index.css; 14 px text, and the coarse-pointer 40×40 rule already
  covers `button`). Selecting it closes the menu and calls
  `onTakeTour`; the mounting `.tour-card`'s passive focus effect wins
  over the menu's focus-restore, same as the drawer path.
- `web/src/views/Header.tsx` passes `onTakeTour` only at the wide
  breakpoint, so each width still has exactly one reopen path
  (Lessons menu ≥ 1280, Settings drawer 1024–1279, More menu < 1024).
- `.tour-open` markup + CSS removed; `.app-header` gap floor restored
  to main's literal `16px` and the `< 1280` → `--space-8` media query
  restored verbatim — header markup and CSS are identical to main
  apart from the `onTakeTour` prop on `LessonsMenu` (and the existing
  `MoreMenu` prop for < 1024).
- layout.spec.ts header button count back to main's
  `vp.w >= 1280 ? 6 : 7`; tour.spec.ts's 1280 test now opens the
  Lessons menu and asserts focus lands in the card; a per-lesson
  no-wrap check at 1280×720 iterates all six catalog lessons
  asserting one row, `scrollWidth ≤ clientWidth`, and header height
  = main's 54 px.
- Fix round 4 (2026-10-24): `.lessons-menu-list` caps inside the
  viewport (`max-height: calc(100dvh - var(--lessons-menu-top, 0px)
  - var(--space-16))`, `overflow-y: auto`; the top edge is measured
  on open + resize because the header height isn't fixed) and roving
  focus scrolls its item into view so End reaches "Take the tour";
  `web/e2e/lesson-picker.spec.ts` gained the 1280×720/1280×600
  fit-and-End checks, `LessonsMenu.test.tsx` the scrollIntoView unit
  test.
