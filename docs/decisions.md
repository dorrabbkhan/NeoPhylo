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

## v1.3 fix: leaf labels clipped by the support stretch (owner decision 3A, 2026-10-24)

- **Cause.** The checkpoint-11 `FIGURE_MIN_SUPPORT_BRANCH_PX`
  display-only stretch (`minBranchPx` in `web/src/layout/phylogram.ts`)
  grows a support-carrying internal branch to at least 12 drawn px;
  the extra width is a `shift` inherited by the whole subtree, so
  after a bootstrap run the deepest leaf's drawn x — and its name —
  overran the reserved draw width
  (`panelWidth − labelRoom − 2·FIGURE_PANEL_PAD`). The svg, sized from
  the content bounds, grew wider than `.tree-canvas`
  (`overflow: auto`) and the label sat hidden until the panel was
  scrolled (PR #79, "Pre-existing: leaf label clipped").
- **Fix — two places, both display-only.** (a) `layout()` fits the
  stretch into the width itself: the deepest drawn x at scale `s` is
  `(cum − base)·s + Σ max(0, minPx − edge·s)` over support-carrying
  ancestors — continuous and non-decreasing in `s` (a stretched edge
  draws exactly `minPx` whatever the scale) — so when it exceeds
  `opts.width` at the naive scale, a bisection finds the largest scale
  where tree plus accumulated stretch fit together; equivalently the
  scale then comes from `width −` the stretch on the deepest path.
  Only a tree whose flat `minPx` floors alone exceed the width still
  overflows — the panel's horizontal scroll remains for exactly that
  case (the Global Constraints' layout invariant). (b) `treeFigure()`
  wraps the whole figure build in a refit pass: `layout()` alone only
  bounds node x by the draw width, while the CONTENT box also spans
  leaf names, support pills overhanging left and node slack — when the
  measured bounds still exceed the panel, the draw width shrinks by
  the measured overflow and the figure is rebuilt (up to 8 passes; the
  narrowest build stands). Both renderers consume `treeFigure`, so
  exports stay identical to the screen.
- **Why `four-taxa` changed although it shows no support values.** The
  refit loop runs for every tree; it only *engages* on real overflow.
  `labelRoomFor` reserves `ceil(longest·fontSize·0.62) + 15` — an em
  estimate — while the content bounds use `measure()`'s real
  bundled-font glyph widths. Where the deepest leaf's measured label
  exceeds the estimate by more than ~0.5 px, the first pass overflows
  and the draw width shrinks a fraction of a percent — the sub-pixel
  rescale the six frames show (~530–690 changed px each, under the
  0.001 diff ratio but real, so the baselines could not be left
  stale). That overflow predates this fix: the svg was already
  slightly wider than the canvas and the label tail sat behind scroll
  — the same clip decision 3A targets, just sub-pixel. Making the
  refit stretch-only would knowingly keep it; the invariant "the
  drawing, including the leaf labels, fits the panel" is applied
  uniformly instead. (jsdom unit tests use the em estimates, so they
  see no refit on no-stretch trees — verified: identical scale.)
- **Changed baselines (15, regenerated in the pinned Playwright
  image):**
  - `weak-support-1024x768-{dark,light}`,
    `weak-support-1920x1080-{dark,light}` (4) — the fix itself: all six
    leaf names now fit inside the panel.
  - `bootstrap-basics-final-1024x768-{dark,light}`,
    `bootstrap-basics-final-1920x1080-{dark,light}`,
    `bootstrap-basics-final-presenter-1920x1080-light` (5) — the same
    stretch refit on the bootstrap-basics tree after the seeded run.
  - `four-taxa-{1024x768,1920x1080,768x1024}-{dark,light}` (6) — the
    measured-label refit above; no support involved.
  - Regenerated then reverted to HEAD bytes (anti-aliasing noise,
    1–49 px): `cytc-computed-768x1024-{dark,light}`,
    `cytc-rooted-1024x768-dark`, `cytc-rooted-768x1024-{dark,light}`,
    `replicate-panel-1920x1080-light`, `weak-support-768x1024-light`.
- **Files** (this owner-requested fix has no plan Files block):
  `web/src/layout/phylogram.ts`, `web/src/layout/treeFigure.ts`, the
  new `web/src/layout/treeFigure.test.ts` and
  `web/e2e/leaf-labels.spec.ts`, the 15 baselines above, and this
  file.

### Fix round 2 (PR #80 review): fit margin, keep-first fallback, pixel-snapped labels

- **Root cause of the deterministic e2e failure.**
  `bootstrap-sequencing.spec.ts` "sequenced notes and panel fit at
  1920×1080" failed with leaf D's `<text>` at
  `toBeInViewport({ratio: 1})` = 0.99999696 — measured in the pinned
  image. Chromium rasterizes text into an *ink box* a hairline wider
  than the measured advance box when a glyph lands on an unlucky
  fractional x; the IntersectionObserver's viewport intersection is
  computed against the layout box, so the leaf's ink edge poked
  ~0.00003 px past the svg's clip and the observed ratio dropped just
  under 1. The refit loop's `overflow <= 0.5` tolerance accepted
  builds landing flush against the panel edge — exactly where that
  sliver lives.
- **Three changes (all display-only, all in the shared
  `treeFigure`/renderer path):**
  1. **A real fit margin.** A build now counts as fitted only when
     its svg clears the panel by `FIGURE_FIT_MARGIN = 2` px — flush
     fits are misses. The next pass's draw width is floored to an
     integer before rebuilding: the iteration's fixed point is svg ==
     panel − margin, and a non-snapped step lands within fp noise of
     the edge (sometimes a hair over it), so the floor guarantees the
     accepted build is strictly inside the margin. The content bounds
     also get `FIGURE_INK_SLACK = 1` px each side so a label's
     rasterized ink — wider than its measured advance or nudged ≤ 0.5
     px by the renderer's pixel snap — can never poke past the svg's
     own overflow clip.
  2. **Never squash an unfittable tree.** When no refit pass reaches
     the margin, the least-shrunk build that is merely inside the
     panel stands; when nothing fits inside at all, the FIRST
     (unrefit, least-shrunk) build stands and the tree panel scrolls
     horizontally — the pre-PR behaviour and the Global Constraints'
     layout invariant. The old `best = narrowest` fallback kept the
     80 px-floor build: measured on a 30-leaf support ladder it gave
     scale 77.7 vs the unrefit 315.8 while the svg still overflowed
     (485 > 400 px panel) — shrunk to ~25 % AND still scrolling. Unit
     test: the 30-leaf ladder keeps its unrefit scale and svg width >
     panel.
  3. **Device-pixel label snap, on screen and in export.** Leaf-name
     anchors (and the highlighted internal names sharing the anchor)
     snap to the device-pixel grid — `snapDevicePx(v, origin)` with
     `origin` the canvas's content-box origin read from
     ResizeObserver's `contentRect.{x,y}` (the svg's screen offset
     while scrollLeft is 0); the SVG export snaps identically with
     `origin = 0`, so exported label `x`/`y` are whole integers
     (`toFixed(2)` of an integer). An anchored-at-integer label never
     straddles a pixel boundary, so its ink box can't grow the
     0.00003 px sliver. The ≤ 0.5 px nudge stays inside
     `FIGURE_INK_SLACK`.
- **Why every scene's baselines moved.** The margin refit shrinks the
  draw width by up to ~2 px + integer floor on every tree that was
  fitting flush, and the pixel snap moves every leaf-name anchor by
  ≤ 0.5 px — both touch every scene, so all 43 frames regenerated in
  the pinned image. The conductor pixel-diffed each against HEAD:
  41 carry real changes (929–16035 px), 2 were anti-aliasing noise
  (~42 px) and were restored by path.
- **Changed baselines (41, grouped by scene):**
  - `cytc-rooted-{1024x768,1920x1080,768x1024}-{dark,light}` (6)
  - `cytc-computed-{1024x768,1920x1080,768x1024}-{dark,light}` (6)
  - `replicate-panel-{1024x768,1920x1080,768x1024}-{dark,light}` (6)
  - `export-svg-roundtrip-{1024x768,1920x1080,768x1024}-{dark,light}`
    (6)
  - `weak-support-{1024x768,1920x1080,768x1024}-{dark,light}` (6)
  - `four-taxa-{1024x768,1920x1080,768x1024}-{dark,light}` (6)
  - `bootstrap-basics-final-{1024x768,1920x1080}-{dark,light}` (4) +
    `bootstrap-basics-final-presenter-1920x1080-light` (1)
  - Regenerated then reverted to HEAD bytes (anti-aliasing noise,
    ~42 px): `bootstrap-basics-final-768x1024-{dark,light}`.
- **Export contents.** An exported SVG's leaf `<text>` `x`/`y` are now
  integer-anchored (e.g. `x="123.00"` where it was `x="123.47"`); the
  tree geometry, pills and names are unchanged. The export still
  matches the screen — `export-figure.spec.ts` ("exported SVG/PNG is
  the on-screen figure, both views") and the six
  `export-svg-roundtrip` visual scenes pass against the regenerated
  baselines.
- **Files added in round 2** (beyond the round-1 list):
  `web/src/views/TreeView.tsx`, `web/src/export/svg.ts`, the two new
  cases in `web/src/layout/treeFigure.test.ts`, and the 41 baselines
  above.
- **Re-sync onto #79 rounds 3–4** (2026-10-25): merged
  `origin/m1.3/task-12-tour-empty-states-samples` as a merge commit
  (no rebase); the only code conflict was this file, resolved by
  keeping both entries, and the 13 conflicting 1920×1080 baselines
  took the base branch's bytes before all 43 frames were regenerated
  in the pinned Playwright image (19 changed vs the merge commit;
  the visual suite passes 43/43 twice).

## v1.3 Task 13: saturation progress feedback

- Spec §6.9 gives only the "Use longer sequences" wording. The
  branch-fix counterpart keeps the same structure, swapping the
  knob read-out: "Still saturated at branch scale ×{s}: {k} pair(s)
  remain. Try again, or choose another fix."
- "pair(s) remain" is literal per §6.9 — the panel previously
  pluralized ("4 pairs remain" / "1 pair remains"); now the exact
  spec string is rendered with only {n}/{s} and {k} substituted. {n}
  is read back from `exerciseSim` so the SIM_MAX cap shows; {k} is
  `sat.cells.length` from the engine's SaturatedMatrix error, never
  a literal.
- Files outside the Files block: `docs/decisions.md` — this entry.
- Fix round 1: `web/src/views/SaturationChart.tsx` is also outside the
  Files block. The chart drew its labels at 9 px; the v1.3 global
  constraint is a 12 px minimum anywhere, so its text now uses the
  `size.xs` token and the viewBox/padding grew to fit it (280×190,
  wider left/right/bottom padding — the data mapping is unchanged).

## v1.3 Task 14: lazy KaTeX, bundle and performance budgets

- Files outside the Files block: `web/src/views/PairPanel.tsx` and
  `web/src/views/BootstrapPanel.tsx` — both imported KaTeX statically;
  spec §7.2 requires every math surface on the one shared lazy loader
  so the chunk is fetched once and each caller shows "Loading
  formulas…" meanwhile. The loader itself, `web/src/explain/katex.ts`
  (plus its `katex.test.ts`), is new under `web/src/explain/*`.
  `scripts/ci/web.sh` now invokes `scripts/check-bundle-size.sh` right
  after `vite build` — the initial-JS check needs `web/dist`, which the
  wasm job never builds. The three `*.test.tsx` updates are the same
  tests awaited for async math.
- The three math surfaces keep their own `MathLine`/`KaTeXLine` shape;
  the shared module exports `loadKatex`/`useKatex`/`renderMath` and the
  exact placeholder `MATH_LOADING` = "Loading formulas…".
- KaTeX woff2 precache (§7.2 offline test needs KaTeX's own faces, not
  a fallback): `assets/KaTeX_*.woff2` joined the workbox glob; the
  woff/ttf fallbacks stay out. Precache went 38 entries / 1 577 524 B
  on main (679e5f9) → 59 entries / 1 835 284 B (+257 760 B): the 19
  emitted KaTeX woff2 faces plus the new `katex-*.js`/`katex-*.css`
  chunks, which the existing `**/*.{js,css}` glob already covered.
- `build.manifest: true` emits `.vite/manifest.json` so the budget
  script can walk the entry's static-import closure; the file is not
  precached (dot-dir is outside the glob match) and is build output
  only.
- Owner decision (2026-10-25): v1.2.0 baseline; KaTeX measured as its
  JS. `scripts/check-bundle-size.sh` therefore uses KATEX_GZ = 76 524
  (the shipped `katex.min.js` gzip; the CSS isn't JS) and the §8.2
  limit is 191 572 − 76 524 + 5 120 = 120 168 B.
- Files outside the Files block (this round): `web/src/views/App.tsx`
  now lazy-imports `web/src/views/PhylipHelp.tsx` via `React.lazy` +
  `Suspense` (owner decision: trim the initial bundle by loading the
  "Coming from PHYLIP?" dialog on first open; Sheet's mount-time focus
  contract is unchanged, and the `**/*.js` precache glob already covers
  the emitted `PhylipHelp-*.js` chunk for offline). The dialog's own
  source needed no edit — the lazy call maps its named export.
  `PhylipHelp.test.tsx` only awaited the now-async open (findByRole).
- Margin status: lazy PhylipHelp took the branch's initial JS from
  120 367 gz to 120 111 gz (the emitted `PhylipHelp-*.js` chunk is
  ~1.5 kB / 0.63 kB gz) — under the 120 168 B limit but short of the
  required ≥ 2 KB margin (≤ 118 120 B) by 1 991 B. Per the owner's
  instruction the round stopped there for a decision on the next trim.
- Owner decision (2026-10-25), closing the margin gap: lazy-load the
  export writers under `web/src/export/` in the ExportMenu handlers
  (dynamic `import()` in onSvg/onPng/onR/onPhylip), then the replicate
  panel only if still over the ≤ 118 120 B margin. Exports must be
  byte-identical and work offline (the `**/*.js` precache glob covers
  the emitted chunks — proven by the new "exports work offline" e2e
  test). Initial JS went 120 111 → **116 879 gz**, 1 241 B under the
  required margin, so the replicate panel stays eager. New chunks:
  svg 2.93 kB / rscript 4.68 kB / png 0.82 kB / phylip 0.28 kB; the
  shared figure layout (`layout/treeFigure` etc.) stays in the entry
  chunk because the screen uses it. Precache: 60 entries / 1 765.01
  KiB → 64 entries / 1 765.74 KiB (+0.73 KiB).
- Files outside the Files block (this round): `web/src/views/ExportMenu.tsx`
  (the four dynamic imports — the Newick items stay synchronous; they
  call engine writers, not `web/src/export/*`), `web/src/views/ExportMenu.test.tsx`
  and `web/src/views/App.export.test.tsx` (await the now-async
  downloads; the URL stubs became `vi.spyOn(URL, …)` because a
  whole-object `stubGlobal("URL")` left `URL` non-constructible and
  broke vitest's module runner resolving `import()`).

## v1.3 Task 15: exports embed fonts, print palette

- "Match screen theme" is **in-session UI state only** (spec §7.4
  lists theme/presenter/tourSeen as the only device preferences):
  React state in ExportMenu, unchecked by default, never written to
  localStorage, never encoded in URLs, so v1/v2 old-link fixtures and
  export bytes are unaffected. It lives in the export menu itself, so
  it is reachable wherever the menu renders — the controls column at
  ≥ 1280 and the Settings drawer below that.
- `fontFacesFor(texts, weights, families?)` gained an optional third
  parameter so the caller can ask for Inter and JetBrains Mono faces
  independently of weight selection (the produced signature is a
  superset of the plan's `(texts, weights)`; existing call semantics
  are unchanged when the parameter is omitted).
- `fontSubsets.ts` is the one structured source for the bundled
  faces' family/weight/subset/file/unicode-range (conductor note:
  same ranges as fonts.css, never duplicated). `fonts.css` stays the
  committed stylesheet form of that data — the new
  "declares exactly the fontSubsets.ts faces, in order" test keeps
  the two from drifting — and `fontEmbed.ts` picks faces from the
  same list. (`?raw` on a `.css` import returns "" under vitest, so
  parsing fonts.css at test-time was not a viable single source.)
- `text{text-rendering:optimizeLegibility}` is emitted into the
  exported `<style>` because index.css styles app text that way;
  without it a bare document shapes the same faces differently
  (~0.9 px on kern pairs). `getComputedTextLength` also pixel-fits to
  the svg's display scale, so the e2e fidelity check transplants the
  app's <text> elements into the blocked document rather than
  comparing lengths across documents.
- `png.ts` needed no edit although the Files block lists it under
  Modify: `exportPng` rasterizes the same `svg()` output, so the
  selected palette flows through with geometry untouched.
- Files outside the Files block: `web/src/views/App.tsx` (passes
  `theme={session.theme}` to ExportMenu — the menu needs the screen
  theme for the option); `web/src/design/fontSubsets.ts` (the single
  structured source above); `web/src/design/fonts.test.ts` (the
  fonts.css ↔ fontSubsets sync test); `web/src/index.css`
  (`.export-theme-match` layout + 40 px coarse-pointer target);
  `web/e2e/visualScenes.ts` (the `export-svg-roundtrip` scene now
  renders the downloaded SVG with every font request aborted and
  `svg text{font-family:"Inter"}` — the blocked-fonts render the task
  requires); `web/src/test/fontFetch.ts` and
  `web/src/views/App.export.test.tsx` (stub `/fonts/*.woff2` fetches
  for jsdom, which has no real fetch targets); the six regenerated
  `export-svg-roundtrip-*-linux.png` baselines (dark frames now show
  the default light export palette; task Step 2 requires updating
  exactly this scene's frames).
- Fix round 1 (PR #83 review): `onSvg` now catches a rejected
  bundled-font fetch into a visible `.export-error` state like
  `onPng`; the `failed` state records which export failed so the
  byte-identical PNG text and the SVG text can never cross. The
  outside-subset warning now scans `exportSvgDetailed`'s returned
  `texts` — the strings the figure actually drew (the same set the
  embedded subsets were picked for) — instead of every leaf label on
  `tree`, so a leaf `figure.visibleNodes` hides cannot trigger it.
  `exportSvg` keeps its `Promise<string>` contract; the new
  `exportSvgDetailed` in `web/src/export/svg.ts` additionally returns
  the drawn texts (same file, no new module).

## v1.3 fixes: tour Firefox, KaTeX overflow, header title wrap (out-of-plan, owner-approved)

Four bugs found during Tasks 12–14, fixed in one PR on `m1.3/fixes` from main
689518a. No plan Files block — every file touched is listed per fix.

- **Firefox tour at 768×1024:** the step's `scrollIntoView` used
  `behavior: "smooth"`. While the smooth scroll animates, every scroll event
  re-measures the target and the card glides under the pointer for hundreds of
  ms; a click whose down/up straddle a move lands on different elements and no
  `click` fires — Firefox dropped "Next" ~1-in-7 runs (reproduced 3/20 on main;
  the step stayed on `.matrix-wrap`). The scroll is instant now — a real fix,
  not a masked wait: the card never moves post-commit, the step's scroll can't
  outrace the next step's, and §6.10's reduced-motion rule is met by never
  animating. Regression test steps straight through at 768×1024 and asserts the
  ring is exactly the step-4 target's padded rect. Files: `web/src/views/Tour.tsx`,
  `web/e2e/tour.spec.ts` (new "stepping straight through" test).
- **KaTeX overflow at 1280:** `.math-line` already had `overflow-x: auto`, but
  overlay scrollbars hide the affordance, glyph edges clip at the box edge, and
  a keyboard user could never reach the clipped end (axe
  scrollable-region-focusable). The box now has `overflow-y: hidden` and
  block-end padding (design tokens), and the three identical local math-line
  renders (ExplanationPanel, BootstrapPanel, PairPanel) are one shared
  `MathLine` component that makes a line a labelled tab stop only while it
  actually overflows horizontally (ResizeObserver; jsdom reports no overflow,
  so unit tests see no extra tab stop). PairPanel's copy is folded in although
  the notes named only two surfaces — the identical component would have kept
  the same bug. Files: `web/src/views/MathLine.tsx` (new), `ExplanationPanel.tsx`,
  `BootstrapPanel.tsx`, `PairPanel.tsx`, `web/src/index.css`,
  `web/e2e/math.spec.ts` (new).
- **Header title wrap (1024 saturation, 1280 protein-models):** `flex-wrap` was
  kept for the header, but CSS line breaking uses each item's UNSHRUNK flex
  basis — a shrinkable h1 can never stop the controls wrapping. The header is
  `flex-wrap: nowrap` at ≥1024 outside presenter mode (1.5× type keeps the
  wrap escape at every width, as before; <1024 keeps it too), the h1 truncates
  with an ellipsis (`white-space: nowrap; overflow: hidden;
  text-overflow: ellipsis; min-width: 0`) and is the row's only shrinkable
  item — every other direct child is `flex-shrink: 0`, so no control's text
  wraps inside it either. The full title stays on the h1's `title` attribute
  and accessible name. tour.spec.ts's per-lesson header check now pins 54.2 px
  for every catalog lesson at 1280 AND 1024 (protein-models' "wraps on main"
  exception removed). Files: `web/src/index.css`, `web/src/views/Header.tsx`,
  `web/src/views/Header.test.tsx`, `web/e2e/tour.spec.ts`.
- **Files outside the task (no Files block exists):** all files above plus
  `docs/decisions.md`; `web/e2e/__screenshots__/` baseline regenerations are
  listed individually in the PR body.
- **Verification:** the failing Firefox test went 17/20 → 20/20 (plus 20/20 on
  the new regression test); Chromium stayed 40/40 over the same repeats;
  tour.spec.ts + math.spec.ts are 24/24 on both Chromium and Firefox; axe spec
  5/5 unchanged.
- **Fix round 1 (KaTeX scroll affordance + `useOverflowsX` robustness):** the
  overflow fix scrolled formulas but gave no visible hint — the scrollbar is
  overlay-only, so a line clipped mid-glyph read as cut off. `.math-line` is
  now wrapped in `.math-line-box`, which carries a `data-fade-*` attribute per
  edge that still hides content (`useScrollEdges`: right at scrollLeft 0, both
  in the middle, left at the end, none when the line fits); CSS paints a
  24 px (`--space-24`) fade from `--color-bg` — the panel token every math
  surface sits on — toward transparent, absolute inside the wrapper so it
  pins to the visible edge, takes no layout space, and can't cover the
  outline focus ring. The same hook replaces `useOverflowsX`'s box-only
  ResizeObserver with scroll + RO on the line AND its children +
  MutationObserver + `document.fonts.ready`, so the state also tracks content
  that changes width without a box resize (lazy KaTeX swap, late webfont
  metrics). New unit tests pin the edge/scroll contract and the
  content-swap-without-resize path; math.spec.ts asserts the affordance
  tracks real scrolling. Files: `web/src/views/MathLine.tsx`,
  `web/src/views/MathLine.test.tsx` (new), `web/src/index.css`,
  `web/e2e/math.spec.ts`, `docs/decisions.md`.

## v1.3 WebKit fixes (out-of-plan, owner decision 1A on PR #85, 2026-10-25)

Two deterministic WebKit e2e failures on main since e06a352 (#70), fixed in
one PR on `m1.3/webkit-fixes` from main 1b7acd9 so the release's full matrix
(chromium + firefox + webkit) is green. WebKit only runs in the full matrix,
which is why PR CI never saw them. Each bug has its own commit.

- **Consensus tab strip clipped its wrapped row (bootstrap-sequencing.spec.ts
  "panel fit" at 1280×800 and 1920×1080):** `[role="tablist"]` carried
  `overflow-x: auto`, which under CSS overflow rules also makes the block axis
  `auto` — the strip was a scroll container. Its scrollport is integral
  (clientHeight), so a sub-pixel of the wrapped second row's bottom edge fell
  outside it; WebKit's IntersectionObserver clips to that scrollport and
  reported the "Extended majority" tab at 98.76 % in-viewport (measured:
  content box 62.375 px tall, scrollport floored to 62 px, tab bottom 0.375 px
  under it). Chromium and Firefox clip to the unrounded content box and never
  failed. The strip already has `flex-wrap: wrap`, which makes horizontal
  overflow unreachable at every supported width (below 1024 px it is a
  full-width single column; the widest tab is ~255 px even at 1.5× presenter
  type), so the `overflow-x: auto` fallback was dead code — removed; output is
  pixel-identical (over-wide content is still clipped by `.col-center` /
  `.app-grid`). The spec now also pins computed `overflow-y: visible` on the
  strip as the regression guard. Files: `web/src/index.css`,
  `web/e2e/bootstrap-sequencing.spec.ts`.
- **presenter.spec.ts "stays out of the URL" read the pre-sync URL:** the
  app's URL state writer is a `replaceState` in a post-render effect; on
  WebKit it lands ~200 ms after `.app` first paints, so `page.url()` right
  after `waitForApp` caught `?lesson=nj-basics` without `s=`. Verified case
  (a) — a test race, not a toggle write: the same `&s=0&m=concept&o=…&b=…`
  appears with NO toggle (sampled every ~10 ms; the write lands at ~190 ms),
  and the settled pre-toggle URL equals the post-toggle URL exactly. The test
  now waits for `&s=` (encode() always emits `s`) before capturing
  `urlBefore`; the strict `toBe(urlBefore)` assertion is unchanged. Files:
  `web/e2e/presenter.spec.ts`.
- **Files (no plan Files block — out-of-plan PR):** all files above plus
  `docs/decisions.md`.
- **Verification:** see the PR body — both fixed tests `--repeat-each 10` on
  WebKit, the same on Chromium and Firefox, the full e2e suite on all three
  browsers in the pinned image, and the 43/43 visual suite unchanged.
- **Fix round 1 — layout.spec.ts "leaves reachable" was a real failure,
  not a flake (test fix):** the earlier PR body lumped the cytochrome-c
  1280×800 WebKit failure under "one-off flakes under parallel load" —
  wrong. It fails 50–70 % SERIALLY on a quiet machine, always as
  `leaf label 0 in panel 0` at `y = -7.625`. Instrumentation (rAF
  sampling + interleaved in-page/protocol reads in the pinned image):
  the reveal helper works — after `col-center.scrollTop += delta` the
  label's `getBoundingClientRect` settles at `y = 0.6875` and stays put
  for 2.5 s with `scrollTop` stable at 375 and no DOM/geometry change.
  The assertion's `locator.boundingBox()` is what lies: Playwright's
  WebKit path uses the protocol's `DOM.getContentQuads`, which for an
  SVG descendant returns the quad anchored at the `<svg>`'s own
  top-left corner — every leaf `<text>` in panel 0 reported
  `x=242, y=-7.625` (the svg's origin) with its own correct width and
  height, while the in-page rects put each label at its true position
  (x = svg.x + its `x` attribute). Chromium (`Page.getContentQuads`)
  and Firefox (in-page `getClientRects`) return the true box. The
  failure fired only when the first tree's svg top sat above the
  column top — i.e. whenever the matrix-cell click during `stepToEnd`
  left `.col-center` scrolled past ~34 px — hence the ~60 % rate. The
  app is correct; the test now measures the label rect in-page via
  `getBoundingClientRect`, identical to the other engines' quads and
  to leaf-labels.spec.ts's existing pattern; the every-leaf-in-
  viewport assertions are unchanged. Files: `web/e2e/layout.spec.ts`.
  Verified: `--repeat-each 20` on the failing test 20/20 WebKit;
  layout.spec.ts `--repeat-each 5` 140/140 on all three engines; full
  `E2E=1` suite webkit 146, chromium 151, firefox 145 passed (the
  webkit/chromium runs included the temporary instrumentation spec —
  145/150 committed), 0 failed, 0 flaky; visual 43/43.

## v1.3 Task 16: release checkpoint, README images, CITATION

- **Files outside the Files block:** this entry (`docs/decisions.md`),
  as every task records; `docs/media/cytochrome-c-rooted-support.png`
  and `docs/media/bootstrap-basics-final-step.png` (new README media,
  see below); the deleted `docs/media/{nj-basics-mid-lesson.png,
  nj-step-through.gif, protein-pair-panel.png}` (see below).
- **README images replace, not join.** The README's media block showed
  the pre-v1.3 UI (old header, no wordmark or theme toggle); joining
  would have put two designs side by side in the release README. The
  three stale images were unreferenced anywhere else, so the files are
  deleted (git history keeps them). The two replacements are
  byte-identical copies of the committed snapshot baselines
  `cytc-rooted-1920x1080-light` and `bootstrap-basics-final-1920x1080-light`
  from `web/e2e/__screenshots__/` — nothing under that directory was
  modified. `og-image.png` is unchanged. Regenerating the step-through
  GIF on the v1.3 design via `web/scripts/record-media.mjs` is a
  follow-up, not part of this task (the plan names exactly the two
  snapshot scenes).
- **`docs/roadmap.md`:** the Status line only — v1.3 moves into the
  "released or releasing" list the way v1.2 was written, next becomes
  v1.4, and the revision date moves to today. The v1.3 section heading
  is untouched.
- **`CITATION.cff`:** `version: 1.3.0` only; `date-released` stays
  absent for the owner to fill at tag time (same arrangement as the
  v1.2 release).
- **Step 2 scope:** `E2E=1 RPARITY=1 FUZZ=1 ./scripts/check.sh` can't
  run inside the agent sandbox (docker, the wasm build and the fuzz
  toolchain are unreliable here). The default gate was run as
  fixture-guard + rust + web — `wasm.sh` skipped, no `crates/` files
  changed in this task. The conductor runs the full E2E/RPARITY/FUZZ
  gate outside the sandbox; the PR body carries a checkbox for it.

## v1.4 decisions (owner, brainstorming and planning, 2026-10-26)

Recorded at Task 1 of the v1.4 plan. Spec:
`docs/superpowers/specs/2026-10-26-neophylo-v1.4-instructor-kit-design.md`.
Plan: `docs/superpowers/plans/2026-10-26-neophylo-v1.4-plan.md`.

- **Split:** v1.4 = PHYLIP parity models + PHYLIP lab packs + exercise
  editor. v1.4b = MEGA companion, `.meg` import, MEGA-CC oracle, curated
  data library.
- **Identifiers `F84` and `K2P_PHYLIP`** (not `f84` / `k2p-phylip`). The
  schema already uses `"Kimura"` for the protein Kimura correction
  (`DistModel::Kimura`), so a DNA model with a similar name would collide.
  Existing uppercase names (`JC69`, `K80`, `JTT`) are the convention. The
  UI label is "K2P (dnadist, κ = 2.0)".
- **F84 simulation takes instructor-set base frequencies** (A, C, G, T,
  positive, sum 1 within 1e-6; default equal). Estimation still uses observed
  frequencies, as `dnadist` does by default.
- **Exercise schema 3:** `analysis.kappa` (required for `K2P_PHYLIP`,
  default 2.0 in the editor) and optional `sim.base_freqs`. Schema 1 and 2
  files keep loading.
- **Exercise file is the source of truth;** the `#x=` share link is generated
  from it, and import accepts either.
- **Editor tree input:** drag-to-draw, Newick and a branch-length table, all
  views of one engine-validated tree model. Structural edits live in
  `crates/neophylo-core/src/edit.rs`.
- **Lab packs** are in-app pages with a print view, not separate PDF or Word
  files.
- **Files outside a Files block:** Task 1 only touches
  `.devin/skills/neophylo-task/SKILL.md`,
  `.devin/skills/neophylo-review/SKILL.md` (both: the `v1.4` plan row) and
  this entry, plus `scripts/parallel-worktrees.sh` (conductor tooling: one
  detached worktree per task for parallel agent sessions; no product code).

## v1.4 Task 2: F84 and PHYLIP K2P distance models

- **Formulas are ports, not closed forms.** `F84` and `K2P_PHYLIP` are
  ports of PHYLIP 3.697 `dnadist`'s `makev` (the F84 non-quick branch;
  the Kimura branch is `kimquick`) and `seq.c`'s `getbasefreqs` — i.e.
  ML hill-climb solves, not the spec §3.3 closed forms. F84 uses
  empirical frequencies from the column-weighted alignment (ambiguity
  codes are not counted, unlike dnadist's EM treatment of ambiguous
  data) and the fixed ratio 2.0; `K2P_PHYLIP` uses equal frequencies.
  The frequencies `makev` sees are the *raw* empirical ones: dnadist's
  `getinput` floor (`< 1e-8 -> 1e-6`, others `*0.999999`) sits inside
  `if (!freqsfrom)` only, so it never applies on the empirical path F84
  uses (fix in the Task 2 review round; `getbasefreqs`'s own
  `<= 0 -> 1e-6` floor still applies to the `fracchange` term). When
  `xv = 0` (e.g. only A+T in the data) an observed transversion pattern
  has a zero likelihood denominator; dnadist divides anyway and the NaN
  slope saturates the climb to -1.0, and the port returns `Saturated`
  for the pair directly instead of computing the NaN.
- **Worked-example oracle carried inline.** The plan's Task 2 test cites
  a worked example under `fixtures/worked/` that Task 3 adds; to avoid a
  fixture change in this task, `tests/dist_v14.rs` carries the dnadist
  3.697 printed values inline (0.273375 F84, 0.273342 K2P at ratio 2.0)
  at half a unit of the 6th decimal. Task 3's fixture parity supersedes
  it.
- **Invalid `ratio` handling.** A ratio ≤ 0 or non-finite returns
  `NeoError::InvalidExercise { field: "ratio" }` (the existing
  parameter-error variant). A ratio in (0, 0.5] is "impossible" with
  equal frequencies; like dnadist it is reset to the feasible floor
  (xi = 0) with no error. Decided by the owner on 2026-10-26: the
  engine keeps dnadist's reset; the editor (Task 10) refuses or warns
  on a ratio ≤ 0.5.
- **`DistModel` lost its `Eq` derive** (it now carries an `f64`);
  `PartialEq` and `Copy` remain.
- **Files outside the Files block:** `src/dist_phylip.rs` (keeps
  `dist.rs` readable; holds the dnadist ports); `src/lib.rs` (module
  declaration); `web/src/engine/generated/DistModel.ts` (regenerated by
  ts-rs, CI diffs it); `web/src/state/analysis.ts`, `lesson.ts`,
  `session.ts` and `web/src/views/Controls.tsx` (type-only adjustments
  so the web app typechecks against the new union; no runtime change for
  any existing model; the menu does not offer the new models until
  Task 10); `docs/conductor/notes/v1.4/task10.md` (conductor note
  carrying the owner's decision to Task 10).

## v1.4 Task 3: dnadist F84 and K2P fixtures and parity

- **Inputs:** all four gap-free committed inputs (jc6, jc7_long, jc12,
  k80_10) feed the new fixtures — the note's "at least jc6 and k80_10,
  more if easy". jc8_gaps is excluded (its `-`/`N`s are a different
  code path, not gap-free).
- **Menu keystrokes (3.697, read off the menu):** F84 is `Y` alone —
  F84, T 2.0 and F (empirical frequencies) are the shipped defaults.
  Kimura 2-parameter is `D` once (F leaves the menu → equal
  frequencies), then `T` `<ratio>` `Y`. Runs committed at T 2.0 and 4.0.
- **Fixture shape:** mirrors `ref/*_phylip.json` minus trees, plus a
  `model` field naming the `DistModel` replayed; the k2p `distances`
  keys are the literal ratio (`"2.0"`, `"4.0"`) so the parity test
  parses them into `K2pPhylip { ratio }`. `precision` is 6 — counted on
  dnadist's raw outfile text (`output_matrix_d` `%*.6f`), not on R's
  re-printed numbers where trailing zeros collapse.
- **Files outside the Files block:** `fixtures/README.md` (the
  precision/version note the task's step 1 requires, plus layout and
  regenerating lines for the new `phylip/` directory).
- **Fixture-guard conflict (owner decision needed):** the task requires
  modifying `fixtures/generate_phylip.sh` and `fixtures/README.md` *and*
  adding `crates/neophylo-core/tests/parity_phylip_v14.rs` in one PR.
  `scripts/ci/fixture-guard.sh` diffs the whole PR (base..HEAD), treats
  any modification under `fixtures/` as a fixture change and fails when
  `crates/` also changed — so this PR cannot go green as specified even
  though the commits are split fixtures-first as instructed. Options:
  (a) make the guard per-commit (its own comment already says "in the
  same commit as code"); (b) land the parity test in the next engine
  PR; (c) owner override. Recommendation: (a) — it matches the guard's
  documented contract and keeps this task self-contained.
- **Local check status:** fmt/clippy/`cargo test -p neophylo-core` green
  (parity tests pass at 0.5e-6). `scripts/ci/wasm.sh` cannot run in this
  sandbox (`cargo install wasm-bindgen` needs a temp dir outside the
  writable scope); the wasm pkg is unaffected — this task adds a test
  file only, and `git diff web/src/engine/generated` is empty.

## v1.4 Task 4: F84 simulation with base frequencies and golden hashes

- **Branch semantics:** branch lengths stay in expected substitutions
  per site. `mutate_f84` uses dnadist's own `tt` parameterization —
  `tt = d/fracchange` with `xv`/`fracchange` from the shared
  `dist_phylip::ratio_params(base_freqs, kappa)` — so `DistModel::F84`
  recovers path lengths exactly when the sim's kappa is dnadist's
  default 2.0. The per-site probability is `makev`'s pattern
  probability divided by πx:
  `πy·(1 − z1) + [same class]·(πy/fclass)·(z1 − z1zz) + δxy·z1zz`.
- **Infeasible kappa:** the owner decided on 2026-10-26 (conductor
  chat, PR #90 escalation, option 1) that the simulator refuses kappa
  below `(a·g + c·t)/(freqR·freqY)` with `NeoError`; the distance path
  keeps dnadist's reset.
- **Convergence-test kappa resolved as 2.0:** the task fixes equal
  frequencies and the 4-taxon tree but not kappa; 2.0 is dnadist's
  default ratio and the ratio `DistModel::F84` estimates under, so the
  ±2% bound is honest, not loosened.
- **Golden cases:** `f84_equal_seed5` (equal freqs) and
  `f84_unequal_seed6` (A 0.3, C 0.2, G 0.2, T 0.3), both kappa 2.0,
  1,000 sites on the nj-basics tree — the conductor note's "at least"
  set, seeds continuing the existing series (1–3 DNA, 4 JTT).
- **Files outside the Files block:**
  `crates/neophylo-core/src/exercise.rs` (one arm in `sim_model_name`
  so the match stays exhaustive; `sim_spec` still refuses `"F84"` in
  files until Task 6);
  `web/src/engine/generated/SimModel.ts` (regenerated by
  `cargo test -p neophylo-wasm export_bindings`, never hand-edited);
  `web/src/state/analysis.ts` (`simModelName` throws on the F84
  variant — it has no `SimModelName` until the editor task, and
  guessing one would silently mislabel it) and
  `web/src/views/Controls.tsx` (kappa read narrows on `"K80" in`;
  no menu or behaviour change).
- **Local check status:** fmt/clippy/`cargo nextest` green (234 tests,
  `sim_f84` all pass; existing `sim`/`sim_jtt` goldens bit-identical).
  `scripts/ci/wasm.sh` cannot run in this sandbox (`cargo install
  wasm-bindgen` needs a temp dir outside the writable scope); the
  generated-types diff is clean against the committed
  `SimModel.ts` regeneration.

## v1.4 Task 5: engine tree editing operations

- **`detach` of an already-detached component root is a no-op `Ok`:** the
  notes enumerate only three refusals (root, nonexistent, parent left
  unary); unlinking a parentless node changes nothing, so it succeeds.
- **Husks:** `move_subtree`'s splice leaves the old parent in the arena —
  parentless, childless, unlabeled, with no edge attributes (no arena
  renumbering, per the detach note). Because such a node can never be
  part of a valid editable tree, `join` and `move_subtree` refuse it as
  the joined/moved node ("leaf node N has no name"); `rename_leaf` can
  resurrect it deliberately. Found by `edit_props` (seed recorded in
  `tests/edit_props.proptest-regressions`).
- **Cross-component `move_subtree` out of the main tree:** refused when
  the moved subtree is reachable from `tree.root`, the target edge is
  not, and the move would leave the main component with fewer than two
  leaves — the same floor `detach` guarantees, and required for the
  notes' "after each `Ok`, `validate_editable` holds" property. All
  other cross-component moves are allowed.
- **`set_length` and `move_subtree` require a real parent edge:** the
  root and detached component roots have no edge to set or split; the
  target edge must also be `Some`, finite and non-negative before
  `0 ≤ l_split ≤ L` is checked.
- **Spliced root's remaining child loses its edge:** when `move_subtree`
  splices out `tree.root`, the remaining child becomes the root and its
  edge becomes `None` (the root never has one). A non-root splice sums
  the two edge lengths, keeping whichever is `Some` when only one is.
- **`rename_leaf` checks duplicates across the whole arena,** not just
  the reachable component, so a detached subtree can never collide when
  grafted back; whitespace-only names count as empty.
- **`tree.rooted` is recomputed** as "root has exactly two children"
  after every structural op (the `newick.rs` convention).
- **Files outside the Files block:** `crates/neophylo-core/src/error.rs`
  (one new `NeoError::InvalidEdit { msg }` variant — no existing variant
  changed); `web/src/engine/generated/NeoError.ts` (regenerated by
  `cargo test -p neophylo-core export_bindings`, never hand-edited);
  `web/src/explain/errors.ts` and `web/src/explain/errors.test.ts` (the
  exhaustive `never` switch needs the smallest `InvalidEdit` case —
  title plus the engine's `msg` verbatim — and its test line);
  `docs/decisions.md` (this entry);
  `crates/neophylo-core/tests/edit_props.proptest-regressions` (the
  shrunk husk-join counterexample, kept so the case re-runs).
- **Local check status:** fmt/clippy/`cargo test -p neophylo-core` green
  (263 tests incl. the new `edit`/`edit_props` files); `npm test` and
  `npm run build` green. `scripts/ci/wasm.sh` cannot finish in this
  sandbox (`cargo install wasm-bindgen` needs a temp dir outside the
  writable scope); `web/src/engine/generated/NeoError.ts` was
  regenerated with the documented command and the diff is clean.

## v1.4 Task 6: exercise format schema 3

- **Version reported after load (plan conflict resolved):** the plan
  says "writing always emits 3" while existing tests pin
  `schema_version == 2` for loaded v1/v2 files. `load_exercise`
  therefore reports 2 for v1/v2 inputs and 3 for v3 inputs, and the new
  `pub const CURRENT_SCHEMA_VERSION: u32 = 3` documents what writers
  (Task 7's save) must emit. No existing test was edited.
- **A v3 file in the flat v1 shape is refused at `schema_version`:** a
  body carrying top-level `true_tree`/`sim` instead of `data` is a
  version/shape mismatch ("a file in the v1 shape must declare
  schema_version 1"), which also preserves the existing
  `bad_schema_version` test's field expectation.
- **`Analysis.kappa` is `Option<f64>` with `skip_serializing_if` +
  `#[ts(optional)]`:** the wire shape and the generated TS type of
  existing data are unchanged (`kappa?: number`); a v2-loaded Exercise
  serializes byte-identically. Invariant: `K2P_PHYLIP` ⇔
  `kappa == Some(k)` and `correction == K2pPhylip { ratio: k }`; every
  other correction ⇒ `None`.
- **`kappa` defaults to 2.0 for `K2P_PHYLIP`** and must be finite and
  > 0 when present (`analysis.kappa`); dnadist clamps nothing above, so
  a huge finite value loads. `kappa` with any other correction is
  refused (`kappa applies only to K2P_PHYLIP`) — F84 uses dnadist's
  fixed 2.0, so a silently ignored kappa would mislead.
- **New identifiers are schema 3 only:** in v1/v2 files `F84` /
  `K2P_PHYLIP` corrections, `analysis.kappa`, `sim.model: "F84"` and
  `sim.base_freqs` are refused at their own field path with a message
  naming `requires schema_version 3`.
- **`sim.base_freqs` is an all-or-nothing `{ "A", "C", "G", "T" }`
  object:** all four keys required when present (else `sim.base_freqs`);
  positivity and the sum-to-1-within-1e-6 rule are engine checks via
  `sim::check_spec` (which also keeps the infeasible-kappa floor from
  PR #90). Absent means equal frequencies. `base_freqs` on a non-F84
  model is refused.
- **Explicit `null` and the array form are refused on the v3 keys**
  (PR #92 fix round 1): `analysis.kappa` and `sim.base_freqs`
  deserialize through a presence-aware `Option<Option<T>>` so
  `"kappa": null` / `"base_freqs": null` are refused at their field in
  every schema version (a present null also trips the v2
  `requires schema_version 3` gate), and `base_freqs` accepts only the
  `{A, C, G, T}` object — never the `[A, C, G, T]` array serde's
  struct-from-sequence would otherwise read — matching
  exercises/schema.json, which types them `number`/`object`.
- **Files outside the Files block:**
  `web/src/engine/generated/Analysis.ts` and
  `web/src/engine/generated/Exercise.ts` (regenerated by
  `cargo test -p neophylo-core export_bindings`, never hand-edited);
  `web/src/lessons/schema_v3.test.ts` and the new
  `web/src/lessons/__fixtures__/v3-*.json`, `v2-bad-f84.json` (the
  schema/engine agreement test the review focus requires) — fix round 1
  adds `v2-bad-kappa-null.json`, `v3-bad-basefreqs-null.json` and
  `v3-bad-basefreqs-array.json` to the same list;
  `docs/decisions.md` (this entry).
- **Local check status:** fmt/clippy/nextest green (289 tests, the 23
  new `exercise_v3` tests included); `wasm-pack test --node` green;
  `npx vitest run src/lessons src/state` green (141 tests incl. the 9
  new `schema_v3` tests). `scripts/build-wasm.sh` needs
  `WASM_PACK_CACHE=target/.wasm-pack-cache` in this sandbox (the
  default cache lookup misses the preinstalled wasm-bindgen 0.2.129);
  with it the pkg rebuild and the generated-types diff are clean.

## v1.4 Task 7: editor model, history and exercise file

- **Share-link limit — Owner decision pending:** the plan pins
  `maxLength` to "the existing browser-safe limit already used by that
  encoder", but `web/src/state/url.ts` defines no limit. Provisional
  `SHARE_LINK_MAX_LENGTH = 8000` (RFC 9110 §4.1's recommended minimum
  request-line length); every `exercises/*.json` encodes under it
  (cytochrome-c ≈ 4,500 chars), pinned by a test. Tests derive their
  sizes from the constant, never a literal.
  Resolved 2026-11-01: 32,000 (value delegated by the owner to the
  conductor). `#x=` is a URL fragment and is never sent to the server,
  so the RFC 9110 request-line reasoning doesn't apply. The shipped
  lab packs already give links of 9.3k–10.9k characters; the 16S
  library dataset alone gives ≈ 17.6k (lz-string measurement,
  2026-11-01) and the library cap (30 taxa × 2,000 sites) needs more.
  32,000 stays under Slack's 40,000-character message limit and far
  below browser URL limits (Chrome allows 2 MB).
- **`shareLink` returns `{ url } | { tooLong: true; maxLength } |
  { error: string }`:** the plan's signature is extended with
  `{ error }` because the link is built from the SAVED content — an
  unsaveable exercise has no link to return. The limit applies to the
  full returned string (`base + "#x=" + payload`); over it the result
  carries no `url` — never a truncated link.
- **`ajv` moved devDependencies → dependencies** (same `^8.20.0`, no
  lockfile version change): spec §5.4 save validation runs it in the
  app, not just in tests. Not a new dependency. Nothing imports
  `web/src/editor/` yet, so the main bundle is unchanged — the editor
  must be lazy-loaded (Task 8/10) so ajv stays out of the initial
  bundle.
- **`saveExercise` validates twice:** the file object passes
  `exercises/schema.json` via `ajv/dist/2020.js` (schema imported
  statically) AND the serialized text passes `engine.loadExercise`.
  `{ error }` names the first failing field — ajv's instancePath as a
  dotted path (with `missingProperty` for `required` errors) plus the
  message, or the engine's `InvalidExercise.field`.
- **Wire → file translation (`exerciseToFile`):** `sim.model` enum →
  the file's string + flat `kappa`/`base_freqs` (F84 always writes its
  `base_freqs` object — the wire fills the equal-frequencies default at
  load); `analysis.correction` `K2pPhylip { ratio }` → `"K2P_PHYLIP"` +
  `kappa`; `predict_branch` prompts write `at: "bootstrap"` and drop
  the load-resolved `at_step`. Optional keys are OMITTED, never written
  as `null`, where the schema refuses `null` (`bootstrap`,
  `prompts[].after`); `reference: null` is schema-valid but also
  omitted for clean files.
- **`ExerciseState = { exercise: Exercise; fileExtras?: Record<string,
  unknown> }`:** no existing type fit (the session's `LessonState` is a
  different concept). `fileExtras` preserves top-level file keys the
  engine drops (`summary`, `lab`, author/description metadata, unknown
  fields like `odd-valid`'s) so import → save round-trips them. The
  schema-required `summary` falls back to `exercise.title` when no
  fileExtra supplies one, so a bare `{ exercise }` state still saves.
- **`schema_version` written on save is the exported constant
  `CURRENT_SCHEMA_VERSION = 3`,** mirroring
  `crates/neophylo-core/src/exercise.rs` (ts-rs exports types, not the
  const).
- **The tree type alias is `EditorTree`, not `TreeView`** — `TreeView`
  is already the React tree component's name in this codebase.
- **`EditorHistory extends EditorModel`:** undo/redo need to notify the
  model's subscribers and replace its tree; subclassing keeps one
  object with one `apply` path (no bypass), and `restore` is the
  `protected` hook. Snapshots are the engine `Tree` values the wasm
  calls returned — no recomputation, no cloning. A rejected edit adds
  no entry; a new edit after undo clears redo; a no-op undo at the
  bottom of the stack does not notify.
- **Files outside the Files block:** `web/package.json` and
  `web/package-lock.json` (the ajv move above);
  `web/tsconfig.app.json` (`resolveJsonModule` — the schema.json static
  import requires it); `crates/neophylo-wasm/tests/parity.rs` (the
  `edit_exports_smoke` boundary test — the crate already has an export
  test pattern, so the bindings are covered in Rust per the task
  notes); `docs/decisions.md` (this entry).
- **Sandbox note (same as Task 6):** `wasm-pack`'s `cargo install
  wasm-bindgen` step is blocked (read-only `$CARGO_HOME`). The cached
  0.2.129 binaries work when `~/.cache/.wasm-pack/wasm-bindgen-*` and
  `wasm-opt-*/bin` are on `PATH` (equivalent to Task 6's
  `WASM_PACK_CACHE=target/.wasm-pack-cache`); with that, the pkg
  rebuild, wasm-pack parity tests and `git diff --exit-code
  web/src/engine/generated` are all clean.

## v1.4 Task 8: editor Newick view and branch-length table

- **Editor route:** `?editor` mounts the editor instead of the lesson
  app — `web/src/Root.tsx` switches at the entry (`main.tsx` renders
  `Root`). The plan never names an entry point; a URL param was chosen
  over a header/menu control because every header change would alter
  the owner-approved visual baselines, and the control belongs with
  Task 10's full editor. `EditorPage` is a `React.lazy` chunk: the
  initial-JS budget had 2.7 KB of headroom and `exerciseFile.ts`'s ajv
  import must never ship eagerly (Task 7 decision). `App` is never
  mounted on the route, so its `replaceState` sync can't strip the
  param; `decode()` ignores unknown params, so `?editor` is inert for
  any other link.
- **`EditorModel.replace(tree)`:** the Newick view's parse path can't
  be an `EditOp` — every op maps to one `edit_*` engine call and the
  engine has no "replace tree" op (join/detach/move/setLength/rename
  only). `replace` parses nothing itself; the view calls
  `engine.parseNewick`, then `replace` gates the result on
  `edit_validate` (the engine's saveable-tree check) before committing
  through the same `commit` path as `apply`, so undo covers it and a
  refused tree keeps the same object identity with no notification.
  Consequence: pasted Newick must carry branch lengths — `(A,B);` is
  refused with "node i has no branch length" — matching the "saveable
  exercise" gate (spec §5.1).
- **Duplicate taxon names are refused at `replace`, not at parse:** the
  Newick parser accepts them; `edit_validate` names the duplicate
  ("duplicate taxon name 'A'"), which the view shows inline.
- **Starter tree:** the nj-basics example
  `((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);` — a recognizable,
  already-valid tree rather than an empty canvas.
- **Internal-edge row names:** the branch table names a leaf row by its
  taxon and an internal edge by its descendant leaf list, e.g.
  "(A, B)" — display-only; the engine never sees the name.
- **Files outside the Files block:** `web/src/editor/model.ts` (the
  `replace` method above); `web/src/views/editor/EditorPage.tsx` (the
  `?editor` page root: engine boot, starter tree, EditorHistory);
  `web/src/Root.tsx` (the route switch — react-refresh's
  only-export-components forbids defining it inside the export-less
  `main.tsx`); `web/src/main.tsx` (renders `Root`);
  `web/src/index.css` (editor styles, tokens only — the codebase's one
  stylesheet); `docs/decisions.md` (this entry).
- **Editor CSS lives in `index.css`,** not a per-feature stylesheet —
  the repo keeps all view styles there (Task 11's `labs.css` is for the
  lab pages' print view, a different mechanism).

## v1.4 Task 9: drag-to-draw canvas and keyboard path

- **`N` (create leaf) — implemented in fix round 2 via the engine
  `add_leaf` op the owner chose on PR #96 (Option A, shipped as
  Task 9a / PR #97).** The `N` key and the always-visible "New leaf"
  button open the same inline form (`NewLeafForm`: a labelled "New
  taxon name" field plus an Add-leaf submit); Enter/submit applies
  `addLeaf`, Escape cancels and returns focus to the element that had
  it. The op creates a parentless labelled leaf — a new detached
  component — which is found by its engine-unique name after apply
  (never a predicted arena id) and becomes the selected AND focused
  node, announced in the canvas's status line. A refusal keeps the
  form open with its value and shows `Can't add leaf '<name>'` plus
  the engine's reason, with no history entry. The button is a ≥40×40
  target under (pointer: coarse) like the rest of the editor's
  controls; the announcement is keyed to the tree that produced it so
  the tree-change message sweep can't wipe it before it is read.
- **Gesture mapping:** dropping a node on a branch or another node is
  `move`; dropping it on its own edge/marker or on empty space within
  its row is `setLength` from the drop x; dropping it anywhere else on
  empty canvas is a `detach` attempt — detach is the only op whose
  refusal names a unary result ("would leave node N with fewer than
  two children"), which is the plan's "a drag that would create a
  unary node is refused" test. `J` joins two selected component roots
  or applies the same `move` as the drag for a node+branch selection.
- **Shared defaults:** `moveOp` splits the target edge at its midpoint
  and keeps the moved node's previous edge length (a detached root
  gets the split's remainder); `join` gives each subtree a 0.1 edge;
  arrow nudges step ±0.01. Suggested lengths are rounded to 6 decimals
  so fp dust never prints in Newick. All are suggestions — the engine
  validates every one.
- **Selection is two slots** (FIFO eviction) so it can feed `J`;
  `Delete` and the arrow keys act on every selected item's edge.
- **Drop resolution hit-tests `elementFromPoint`** — touch (and pen)
  pointers implicitly capture to the pointerdown element, so
  `e.target` on pointerup is always the dragged node for them;
  `e.target` is the fallback only where no layout hit-test exists
  (jsdom). Drag tracking lives in window listeners while a drag is
  live so a drop outside the svg still resolves (the detach gesture);
  Escape or pointercancel aborts. `touch-action: none` on the node
  handles keeps a touch drag from becoming a page pan.
- **Detached components draw below the main tree**, each laid out with
  the same `layout()` call on `{...tree, root}` — coordinates only, no
  structure decision in TS. Husks (parentless, childless, unlabeled
  arena slots left by a splice) are never drawn.
- **Files outside the Files block:** `web/src/views/editor/drawOps.ts`
  (pure gesture→op translation, aria-name helpers and the refusal
  text); `web/src/index.css` (canvas styles, tokens only — the
  codebase's one stylesheet); `docs/decisions.md` (this entry).
  **Fix round 1** added `web/src/views/editor/drawLayout.ts`
  (geometry: pad constants and the per-component layout() loop),
  `web/src/views/editor/useDrawDrag.ts` (the pointer-drag lifecycle
  hook: drag state, window listeners, drop→op resolution) and
  `web/src/views/editor/DrawTree.tsx` (the svg content component) —
  the split that keeps DrawCanvas.tsx under the ~400-line rule.
  **Fix round 2** added `web/src/views/editor/NewLeafForm.tsx` (the
  new-taxon inline form the `N` key and the "New leaf" button share)
  and `web/src/views/editor/useNewLeaf.ts` (its open/submit/focus
  flow — the split that keeps DrawCanvas.tsx under the ~400-line
  rule).
  **Fix round 3** (owner-authorized, one cosmetic issue): the leaf
  label offset and the svg margin now derive from the painted
  decorations' reach — named constants in `drawLayout.ts`
  (`DECOR_R` = the larger of the selected dot and the focus ring's
  outer stroke edge, `LABEL_DX`/`PAD` = `DECOR_R` + a gap) — so a
  selected and/or keyboard-focused node's label clears its ring and
  every ring stays inside the viewBox, including detached roots at
  the canvas's left edge. No new files; all touched files were
  already in the Files block or recorded above.
  Fix-round-1 behaviour changes: drop resolution hit-tests
  `elementFromPoint` (touch pointers implicitly capture `e.target`),
  `touch-action: none` + `user-select: none` on the canvas, refusals
  present a readable title built from the op's own ids while keeping
  the engine's reason as detail, and keyboard focus draws a dedicated
  `.focus-ring` element instead of restyling the dot/line.

## v1.4 Task 9a (follow-up): engine `add_leaf` edit op

- **Owner chose Option A on PR #96 (2026-10-26):** an engine `add_leaf`
  op, instead of dropping the `N` key or folding creation into Task 10.
  Reason: spec §5.1 requires creating a node to be an engine operation —
  the science stays in Rust, and Task 9's keyboard `N` (new leaf) had no
  op to call. This task adds the engine op and its plumbing only; the
  `N` key wiring and the draw-canvas gesture follow in a web PR after
  PR #96 merges.
- **Semantics:** `add_leaf(tree, name)` appends one new PARENTLESS leaf
  labelled `name` (a new detached component, like a detached subtree)
  with no branch length (`None`) and no support, and returns its id.
  Existing nodes are not renumbered. `join` and `move_subtree` graft it
  into the tree; until then `validate_editable` does not see it (it
  judges only the root component), unchanged.
- **Name rules are exactly `rename_leaf`'s:** empty or whitespace-only
  names and names another leaf already carries in ANY component are
  refused with `NeoError::InvalidEdit` and the same message wording;
  unlabelled husks never collide. The shared check is factored into one
  private helper (`check_leaf_name`) used by both ops; `rename_leaf`'s
  behaviour and messages are byte-identical.
- **Proptest coverage is a separate property, not a widened one:** the
  first cut widened `op_sequence_preserves_validity`'s op range
  `0u8..8` → `0u8..9`, but `edit_props.proptest-regressions` stores RNG
  seeds, not values — a changed strategy replays the saved Task 5
  husk-join seed as different inputs, silently un-pinning that
  regression. The original property is restored byte-identical;
  `add_leaf` lives in a new `op_sequence_with_add_leaf_preserves_validity`
  (fresh names plus duplicate adds ~⅓ of the time, joins biased toward
  detached added leaves, and a scripted tail add→join so grafting is
  guaranteed every run).
- **Files outside the Files block:**
  `crates/neophylo-wasm/tests/parity.rs` (the existing
  `edit_exports_smoke` boundary test now also covers `edit_add_leaf`);
  `docs/decisions.md` (this entry).
- **Sandbox note (same as Tasks 6/7):** `wasm-pack`'s `cargo install`
  step is blocked (read-only `$CARGO_HOME`); with `WASM_PACK_CACHE`
  set to an ABSOLUTE path at `target/.wasm-pack-cache` (a relative
  path resolves inside `crates/neophylo-wasm` and breaks the test
  runner) the full `./scripts/check.sh` gate runs green here,
  including `wasm-pack test --node`, the pkg rebuild, the
  generated-types diff and all 684 vitest tests.

## v1.4 Task 10: editor settings, prompts, preview, sheets, snapshots

- **Viewport ruling (conductor):** the plan's Step 4 says editor
  snapshots at 768/1,024/1,280 px but Global Constraints and
  `visual.spec.ts` pin 1920×1080, 1024×768 and 768×1024. The editor
  scenes use the standard three PLUS an extra 1280×800 frame (the
  `viewports` field added to `SCENES` — 1280 is not added to the
  global VIEWPORTS). New scenes: `editor-default`, `editor-f84`,
  `editor-preview` (the Preview button's popup — the real player,
  unchanged), `editor-sheet` (768×1024 only — sheets exist only below
  1024). Baselines are ADD-only; the owner approves.
- **One Model select, six presets.** `EditorModelChoice` maps each
  choice to a matched (sim model, correction, alphabet) triple
  following the lesson convention; `p` (uncorrected) is not offered
  (the conductor list names JC69, K80, F84, K2P_PHYLIP and the
  protein models Kimura/JTT). K80 keeps the dnadist/app default
  κ = 2 with no field — κ shows only for K2P_PHYLIP, where it sets
  BOTH `analysis.kappa` and the K80 sim's κ (spec §2.1). An imported
  exercise outside these presets is refused with a reason rather than
  silently rewritten (e.g. K80 at κ ≠ 2, a p correction, embedded
  data).
- **κ ≤ 0.5 warns, never refuses** ("dnadist treats ratios ≤ 0.5 as
  0.5", owner decision PR #88): the engine accepts it, and the named
  tests pin that the form's verdict always equals `saveExercise`'s.
- **Preview = `window.open` on the share link.** The popup IS the
  existing lesson player — no player code is embedded in the editor.
- **Player display fixes (additive, not player changes):** an F84 or
  K2P_PHYLIP exercise in an `#x=` link previously crashed Controls
  (`simModelName` threw on `{F84:…}`; the correction select had no
  matching option). `simModelName` now returns `"F84"` (the file's own
  comment deferred this to the editor task), and Controls shows
  exercise-prescribed F84/K2P_PHYLIP as conditional display options —
  the menus themselves are unchanged.
- **Task 9 carry-overs (REQUIRED per conductor notes):** (1) the touch
  scroll trap — `touch-action: manipulation` on the svg plus
  coarse-pointer HTML `.node-touch` overlays carrying `none`
  (Chromium ignores touch-action on inner svg nodes), pinned by a CDP
  touch test: a swipe over empty canvas scrolls, a handle drag still
  drags. (2) detached/new leaves corrupted internal-node accessible
  names into "#<id>" via `state/names.ts`'s leaf count — `nodeAria`
  now names internal nodes by their clade ("Node (A, B)"), editor-side
  only; `names.ts` untouched.
- **Files outside the Files block:**
  `web/src/editor/draft.ts` + `draft.test.ts` (the settings→Exercise
  assembly and single validation source — view files would exceed the
  ~400-line rule); `web/src/views/editor/SettingsForm.test.tsx` and
  `PromptList.test.tsx` (the block lists e2e tests only; Review
  Focus 1's agreement pin and per-field behaviour are cheaper in
  Vitest); `web/e2e/visualScenes.ts` (new scenes + `viewports` +
  popup-target support); `web/src/index.css` (new-component styles +
  the touch-action change); `web/src/state/analysis.ts` and
  `web/src/views/Controls.tsx` (the display fixes above);
  `web/src/views/editor/DrawCanvas.tsx`, `drawOps.ts`,
  `DrawCanvas.test.tsx` (the carry-overs); this file.

### Task 10 — fix round 1 (PR #98)

- **Touch drop resolution sees through `.node-touch`** (review).
  `finishDrag` now hits-tests with `document.elementsFromPoint` and
  skips `.node-touch` layers until a `data-node`/`data-edge` element
  is found; the overlays also carry `data-node` so the
  `elementFromPoint` fallback resolves them. The overlays stay up —
  the Task-9-carry-over swipe scroll split is untouched. A CDP
  real-touch test at 768×1024 (Chromium-only) drags a leaf onto a
  node and onto a branch and compares the Newick with the keyboard
  path.
- **Imported `reference`, `locked`, `bootstrap` ride through to
  save** (review). `buildExerciseState` previously hardcoded all
  three away. They're `Exercise` fields the editor has no UI for, so
  `settingsFromExercise` now returns a `PreservedFields` record
  alongside `fileExtras` (which only ever held top-level unknown
  keys); `buildExerciseState` writes them back into the rebuilt
  exercise, `saveExercise` re-validates them (a tree edit that breaks
  a `reference` fails naming the field — nothing is dropped), and
  Settings shows a read-only "Kept from the imported file" notice.
  Import → save untouched is deep-equal to the migrated file for
  every importable `exercises/*.json` (pin: `draft.test.ts`); the
  cytochrome-c / protein-models refusals stay.
- **K2P label shows the prescribed ratio** (plan decision). Shared
  `k2pLabel(ratio)` in `state/analysis.ts` renders
  `K2P (dnadist, κ = 2.0)`; the player's conditional correction option
  uses the exercise's actual ratio, the editor's model select uses 2.
- **Exercise-prescribed F84/K2P survive `load`** (found while
  capturing the K2P evidence shot). `reconcileExercise` treated the
  menu lists as the validity set, so a prescribed F84 or K2P_PHYLIP
  silently became the alphabet default on load — an #x= or previewed
  exercise played under JC69. `correctionValidFor`/`simModelValidFor`
  now treat the v1.4 models as valid for DNA (invalid for protein —
  a protein import still switches with its notice), and
  `simModelAlphabet` maps F84 to DNA. Pins in `session.test.ts`.
- **Styled file-import control** (conductor): a visually hidden
  `<input type="file">` behind a token-styled "Import file…" label
  (≥40×40 under coarse pointer, focus ring forwarded to the label,
  chosen file name in token type); `ImportPanel.tsx`'s separate
  "Choose a file" picker is out of scope for this fix round.
- **Sheet fields take `aria-labelledby` from the sheet title**
  (conductor): `NewickView`/`BranchTable` gained an optional
  `labelledBy`; inside sheets their own "Newick tree" label / "Branch
  lengths" caption is omitted so the heading appears once — desktop
  is unchanged.
- **Editor scenes show their subjects** (conductor): `editor-f84`
  scrolls Settings into view with the broken 1.65 sum and blocked
  save; new `editor-prompts` shows a note prompt with its join gate.
  `--update-snapshots=all --grep editor-` regenerated only editor
  baselines; `git diff --name-status origin/main` stays A-only.
- **Files outside the Files block, this round:**
  `web/src/state/lesson.ts` + `session.test.ts` (the load-time
  validity fix above); `web/src/editor/draft.ts` + `draft.test.ts`
  (preserved fields); `web/src/state/analysis.ts`, `session.ts`,
  `web/src/views/Controls.tsx` + `Controls.test.tsx`
  (`k2pLabel` + pins); `web/src/views/editor/{useDrawDrag,
  DrawCanvas,EditorPanel,NewickView,BranchTable,SettingsForm}.tsx/ts`
  (drop fix, notice, sheet labels, K2P option); `web/src/index.css`
  (import control styles); `web/e2e/{editor.spec.ts,
  visualScenes.ts}`; `web/e2e/__screenshots__/` (8 new
  `editor-prompts` baselines + regenerated editor frames).

### Task 10 — fix round 2 (PR #98)

- **One base-frequency sum message** (review): the F84 fieldset showed
  the readout "Sum: 1.65 — must be 1." AND the save-path complaint
  "the base frequencies sum to 1.65, not 1." for the same problem.
  `settingsProblems`' message is now the single line's text —
  `Sum: 1.65 — must be 1 to save.` — so the displayed message is the
  same validation object the save gate sees (the line falls back to
  the live readout only while no problem exists). A new Vitest pin
  asserts exactly one `/sum/i` element renders on a bad sum; the named
  agreement tests are unchanged.
- **"Import file…" matches its row** (review): the shared
  `.import-file` wrapper shrinks its contents to `--size-sm` for
  ImportPanel's field label; scoped `.editor-actions .import-file`
  back to the inherited `--size-md` so the control carries the same
  type size as the row's real buttons. Padding (3px 6px), radius,
  colours and the coarse-pointer ≥40×40 floor already matched.
- **Baselines:** `--update-snapshots=all --grep editor-` in the
  pinned Playwright image; 16 files changed (all 8 `editor-default`
  and all 8 `editor-f84` frames — the action row and the fieldset
  respectively). `editor-prompts`/`editor-preview` regenerated
  byte-identical; `editor-sheet` untouched. `git diff --name-status
  origin/main -- web/e2e/__screenshots__/` stays A-only (34 files).
- **Files outside the Files block, this round:** none new — the same
  `web/src/editor/draft.ts`, `SettingsForm.tsx` + test,
  `web/src/index.css` and `web/e2e/{editor.spec.ts,visualScenes.ts}`
  already recorded for this task, plus the baseline PNGs; this file.

### Task 10 — fix round 3 (PR #98)

- **Owner decision:** the preview-at-any-size follow-up lands in this
  PR. Preview no longer opens the `#x=` share link — an exercise whose
  link would exceed `SHARE_LINK_MAX_LENGTH` (8000) got an error and no
  preview.
- **Handshake design:** Preview opens a same-origin tab on
  `?preview=<nonce>` (URL carries no exercise data; the nonce comes
  from `crypto.getRandomValues`, never `Math.random`). The tab posts
  `{type:"neophylo-preview-ready", nonce}` to `window.opener`; the
  editor answers `{type:"neophylo-preview-exercise", nonce, exercise}`
  — the unsaved draft reloaded through the save path, like the old
  `#x=` preview sent — with `targetOrigin = location.origin`. Both
  sides check origin, `event.source` (opener / the opened window),
  type and nonce, and ignore anything else. No localStorage,
  sessionStorage or IndexedDB — the size limit disappears because the
  URL carries only the nonce. The received exercise is re-validated
  through `loadWireExercise` — the same file-shape reload an `#x=`
  import uses (now shared with `importExercise`'s link branch) —
  then the ordinary lesson player runs unchanged. Failure modes are
  readable messages in the tab: no opener ("open Preview again from
  the editor"), no reply within 5 s, invalid exercise; a blocked
  popup is named by the editor.
- **Files outside the Files block, this round:** `web/src/Root.tsx`
  (the `?preview` route — the receiver is a lazy chunk so ajv stays
  out of the initial bundle); new `web/src/editor/preview.ts` +
  `preview.test.ts` and `web/src/views/PreviewPage.tsx` (the
  handshake and the preview receiver); `web/src/editor/exerciseFile.ts`
  (`loadWireExercise`, shared by `importExercise`'s link branch);
  `web/src/views/editor/EditorPanel.tsx`; `web/e2e/editor.spec.ts`;
  this file.

## v1.4 Task 11: lab page framework

- **"Load this lab" — where it lands (Review Focus 5 design):** the
  plan pins LabPage's "load this lab" to replace the *editor's*
  exercise after asking, while spec §6.2 describes it loading "the
  dataset and the matching model, seed and replicate settings" — and
  real packs embed datasets the simulated-only editor cannot hold
  (`settingsFromExercise` refuses `kind: "embedded"`). Reconciled by
  context: on the standalone `?lab=<id>` page the button opens the
  exercise in the app through the standard `#x=` link (the same
  payload the editor's Share writes — dataset, model, seed and
  bootstrap settings all travel), satisfying §6.2 for embedded and
  simulated packs alike; inside the editor, the new "PHYLIP labs"
  sheet offers the same-named action and THAT is where the
  unsaved-work question lives — the only place a dirty draft can
  exist while "load this lab" is clicked, per the conductor's
  reachable-state requirement. Declining keeps the exact
  tree/settings; accepting runs the ordinary import path
  (settingsFromExercise → editable-tree gate → model.replace).
- **"Unsaved changes" is a diff, not a flag:** `draftSnapshot`
  serializes {writeNewick(tree), settings, prompts, fileExtras,
  preserved}; the baseline is set at mount and re-set after every
  accepted load (import or lab) and every successful save — "saved"
  work is no longer unsaved. No edits → no question; any deviation →
  the confirm appears. No timers, no per-keystroke bookkeeping.
- **Registry is bundled, not fetched:** lab files join the bundle via
  `import.meta.glob(...?raw)` — offline-safe and unit-testable like
  the lesson catalog; the exercises plugin still serves
  `/exercises/labs/<file>.json` for the page's exercise-file link.
  Registry key = file-name stem (= the `?lab=` id); `loadLab` also
  refuses when the block's own `lab.id` disagrees with the file name
  — a readable refusal instead of a silently mismatched link.
- **e2e-only labs:** `web/src/labs/__fixtures__/*.json` joins the
  registry only under the standard `neophylo-e2e` localStorage flag
  (checked per call), so tests exercise the real registry with zero
  shipped packs; the shipped index shows its empty state.
- **listLabs needs no engine** (JSON parse + the schema's ajv check,
  skipping files without a valid lab block); `loadLab` adds
  `engine.loadExercise` — the same double gate `saveExercise` uses.
- **The header entry is an `<a>`, not a `<button>`:** layout.spec.ts
  pins `.app-header button` at 6/7; the link keeps the count while
  landing the §6.5 header path at ≥1024 px. Below 1024 it is the More
  menu's second item — the pinned item lists in MoreMenu.test.tsx and
  sheets.spec.ts now name "PHYLIP labs" (updated expectations, not
  loosened).
- **LabPrintStyles.tsx is the print-palette component:** it emits a
  scoped `@media print` rule re-mapping every token var to
  `cssVariables("light")` inside `.lab-print` — light colors with
  zero literals (token discipline). labs.css's own `@media print`
  block hides `.lab-nav`/`.lab-controls` and shows the print-only
  masthead/footer; the lab page's handout_md/phylip_note_md render
  through a markdown subset producing React elements — no
  dangerouslySetInnerHTML.
- **§6.5 "time estimates":** the pinned lab block carries no time
  field, so the index shows objectives, chain and the settings each
  lab uses; a per-pack estimate is a Task-12 content decision (an
  optional `lab.time` field would need a schema tweak then).
- **Files outside the Files block:** `web/src/Root.tsx` (the `?labs`
  and `?lab=<id>` lazy routes — ajv stays out of the initial bundle);
  `web/src/views/editor/EditorPanel.tsx` (the lab sheet, the dirty
  baseline and the applyLoaded refactor — Review Focus 5's only
  reachable home); `web/src/views/MoreMenu.tsx` + its test and
  `web/e2e/sheets.spec.ts` (the <1024 px menu item and its pinned
  lists); `web/src/index.css` (`.labs-link` chip styling and
  `.phylip-note a` — header/footer styles must live in the initial
  bundle, not the lazy labs.css); `web/vite.config.ts` (serves and
  ships `exercises/labs/*.json` for the exercise-file link);
  `web/src/labs/labs.test.tsx` (JSX can't live in registry.test.ts —
  the index/page/dirty-flow tests sit here);
  `web/src/labs/__fixtures__/` (the three e2e-only lab files);
  `exercises/labs/.gitkeep` (the registry directory itself);
  `docs/decisions.md` (this entry).
- **Initial-JS budget:** 118285 → 119248 gz (limit 120168): the header
  link, More-menu item and PHYLIP-help line are the only initial-
  bundle additions; registry + ajv + pages are lazy chunks.

### Task 11 — fix round 1 (PR #99)

- **Header link placement corrected:** at 1024–1279 px the direct
  "PHYLIP labs" header link overflowed the row by ~27 px (measured
  `scrollWidth` 1051 vs the 1024 viewport in the pinned image; the
  failing visual frames caught it as a 3 px card edge violation).
  The link is now direct in the header only at ≥ 1280, an item in
  the Settings drawer at 1024–1279, and the More menu's second item
  below 1024 — the same one-path-per-width pattern as "Take the
  tour" (§6.7, owner decision B). The conductor note's "≥1024 in
  header, <1024 in More menu" is satisfied through the drawer: the
  link is reachable at every width without breaking the one-row/no-
  overflow contract.
- **Baselines:** only the 1920×1080 frames change (13 files — every
  app scene × both themes plus the presenter frame); the link is
  absent at 1024 and 768, so those frames stay byte-identical to
  main's (three initially-regenerated 1024 frames were pixel noise —
  main's bytes pass). `--update-snapshots=all --grep` scoped to the
  app scenes at 1920×1080 in the pinned Playwright image.
- **Files outside the Files block, this round:**
  `web/src/views/SettingsDrawer.tsx` (the medium-breakpoint link),
  `web/src/views/App.tsx` (passes `labsHref` at medium only), this
  file.

### Task 11 — fix round 2 (PR #99)

- **"Load this lab" is navigation, not a share link:** the lab page's
  load control builds an unbounded `#x=` app link straight in the
  `href` — it never goes through the editor's Share path, so
  `SHARE_LINK_MAX_LENGTH` (exerciseFile.ts) does not apply. A real
  pack's dataset can push the link past 8000 chars; follow-up for
  Task 12: check each shipped pack's load link actually opens.
- **The e2e fixture labs ride the lazy labs chunk:**
  `web/src/labs/__fixtures__/*.json` is bundled by the same
  `import.meta.glob` as the shipped packs (registry.ts) but joins the
  listing only under the `neophylo-e2e` localStorage flag — they cost
  a few KB in the lazy chunk, never the initial bundle, and are never
  listed for a real visitor.
- **Coarse-pointer floor for the new links:** the generic
  `(pointer: coarse)` rule covers `button`/`[role]` targets but not
  plain `<a>`s, so `a.labs-link`, `.settings-drawer-labs`,
  `.lab-nav-link`, `.lab-card-actions a` and `.labs-empty a` now get
  the ≥40×40 floor under coarse pointers only — fine-pointer layout
  (and every snapshot baseline) is unchanged.

## v1.4 Task 12a: neighbor NJ trees for the dnadist F84 fixtures (PR A, fixture-only)

- **Owner decision (2026-10-27, in chat):** lab pack 1 (`dnadist` →
  `neighbor`) teaches dnadist's DEFAULT model, F84. Task 3's
  `fixtures/phylip/f84/<name>.json` held only the dnadist matrices, so
  this PR adds the `neighbor` NJ tree (`"nj": {"F84": "<outtree>"}`,
  same shape as `ref/*_phylip.json`) built on PHYLIP's printed F84
  matrix (spec §3.2), split into its own fixture-only PR so the pack
  PR's `packs.test.ts` can check distances and tree against PHYLIP
  without tripping the CI fixture guard. The k2p files and every other
  fixture are unchanged; `generate.R` re-ran per the documented order
  and every regenerated file outside `phylip/f84/` is byte-identical.
- **`seqboot` defaults for pack 3 (spec §6.1/§9), read off the
  installed 3.697 menu, not assumed:** `J` Bootstrap resampling, `R` =
  100 replicates; no seed default — the run prompts "Random number seed
  (must be odd)?" and rejects 0 or even input until a valid odd seed is
  given. Recorded in `fixtures/README.md`; seqboot output is not
  committed.
- **`generator` stays `"phylip 3.697"`** — `neighbor` ships in the same
  package as `dnadist`; the script now asserts the two reported
  versions match each run.
- **Files touched:** `fixtures/generate_phylip.sh` (v1.4 section:
  `run_neighbor N` on each `mat_<name>_f84.txt`, ordered after the
  dnadist runs because it overwrites `infile`; `nj` merged into the f84
  JSON; version assert), `fixtures/phylip/f84/{jc6,jc7_long,jc12,k80_10}.json`
  (`nj` key only — `distances`, `precision`, `generator` byte-identical),
  `fixtures/README.md` (f84 bullet: trees, version, how to compare;
  seqboot defaults), `docs/decisions.md` (this entry). No changes under
  `crates/`, `web/`, `exercises/` or `scripts/`; the parity/pack tests
  that consume `nj` land in the next PR.

## v1.4 Task 12 pack 1: dnadist → neighbor lab pack (F84)

- **Scope:** plan Task 12 Steps 1, 2 and 5 for pack 1 only — packs 2
  and 3 are later PRs. Owner gate: `[OWNER REVIEW]` content check of
  the handout and the PHYLIP-vs-NeoPhylo note before merge (Step 2).
- **Dataset (conductor note 2 / spec §6.3):** the pack embeds
  `fixtures/inputs/k80_10.fasta` verbatim (10 × 800, simulated in-house
  under K80 κ = 6 so F84 matters), license = the repo's AGPL-3.0-only;
  provenance is recorded in `exercises/labs/README.md`. No
  `THIRD_PARTY_NOTICES.md` entry — original in-house data, nothing
  redistributed.
- **Settings table (conductor note 3):** every row was read off the
  installed PHYLIP 3.697 menus of `/usr/lib/phylip/bin/dnadist` and
  `neighbor` (transcripts in the PR comments). Rows whose NeoPhylo
  column asserts a real control open with `Correction:` / `Method:` so
  `packs.test.ts` pins them to the exercise's `analysis` fields; rows
  with no NeoPhylo equivalent (gamma, jumble, outgroup drawing,
  interleaved input, multiple data sets, terminal/progress printouts)
  say so plainly.
- **Prompts:** one `predict_pair` at join 1 whose reveal names t04–t05
  (the pair `neighbor` actually joins first — the engine's NJ trace on
  the fixture agrees) versus the closer pair t06–t07; and a closing
  `note` at the completed-tree step (at_step = 9 for 10 taxa NJ).
  No `reveal_pair` — its "Show a vs b" pair-detail only renders in
  protein mode (`jttPairDetail`), so on DNA it would be a dead button.
  No prompt quotes a number.
- **"Load this lab" (conductor note 5):** the shipped pack is covered
  by a new e2e in `web/e2e/labs.spec.ts` — `?lab=dnadist-neighbor` →
  "Load this lab" → the app shows F84 + NJ and a full row of matrix
  cells equal to the fixture at the displayed precision (value read
  from the fixture in the test). The `#x=` link is 5,045 chars
  (reported in the PR body).
- **Files outside the Files block:**
  - `web/src/labs/registry.test.ts`, `web/src/labs/labs.test.tsx`
    (modified): both assumed an empty shipped registry and unscoped
    lab locators; the first shipped pack means two "Load this lab" /
    "Open lab" targets exist whenever the e2e flag is on, so the
    tests are scoped to the test lab's own card/row and the
    shipped-only listing now expects `dnadist-neighbor`.
  - `web/e2e/labs.spec.ts` (modified): the same scoping for the
    index and editor-sheet locators, the without-flag index test
    updated to expect the shipped pack, plus the new shipped-pack
    load test above.
  - `web/e2e/visualScenes.ts` (modified): one new scene
    `lab-dnadist-neighbor-print` (conductor note 7) at 1920×1080 and
    768×1024 in both themes under `emulateMedia("print")`.
  - `web/e2e/__screenshots__/lab-dnadist-neighbor-print-*.png` (4 new
    baselines): additive only, generated in the pinned Playwright
    image with a targeted `--grep`; no existing baseline changed.
    Owner gate on baselines stands.
  - `docs/decisions.md` (this entry).
- **Bundle:** the pack lives in the lazy `labs` chunk; initial JS is
  119,299 B gz vs main's 119,297 B — the +2 B is filename-hash churn
  in the preload map (identical chunk content, verified byte-for-byte
  except hash names), not new code in the initial bundle.
- **Fix round 1 (PR #101, owner review):** the 4
  `lab-dnadist-neighbor-print` baselines now capture the full page
  (a `fullPage` flag on the scene, threaded through
  `toHaveScreenshot` in `web/e2e/visual.spec.ts` — outside the Files
  block), regenerated in the pinned image; `packs.test.ts` gained the
  named pin that NJ on the engine's own F84 matrix matches `nj.F84`'s
  lengths within 0.5e-5 (it passes honestly), and `phylip_note_md`
  now claims only that — plus dnadist's row wrapping (7 cells per
  line at 10 species) and neighbor's Between/And/Length outfile
  table.

## v1.4 Task 12 pack 2: protdist → neighbor lab pack (JTT)

- **Scope:** plan Task 12 Steps 3 and 5 for pack 2 only — packs 1
  (merged, #101) and 3 (later PR) untouched. Owner gate: `[OWNER
  REVIEW]` content check of the handout and the PHYLIP-vs-NeoPhylo note
  before merge (Step 2's gate applies per pack).
- **Dataset (conductor note 1 / spec §6.3):** the pack embeds
  `fixtures/inputs/protein/p10_400.fasta` verbatim (10 × 400), the
  preferred `p10_400` input. Expected numbers come from
  `fixtures/ref/protein/p10_400.json` (`distances.JTT`, `nj.JTT`,
  `precision` 4) — never from NeoPhylo's own output. The protein
  fixtures live in `ref/protein/`, not `phylip/`, so `packs.test.ts`
  gained a `loadProteinFixture` reader beside the existing
  `loadFixture`. Provenance (numpy PCG64 seed 2026, equal-rate
  replacement, NOT JTT) is recorded in `exercises/labs/README.md`;
  the pack's handout and note say so plainly and never call JTT the
  true model. License = the repo's AGPL-3.0-only; no
  `THIRD_PARTY_NOTICES.md` entry — original in-house data.
- **Menus read off the installed 3.697 binaries, not assumed**
  (conductor note 2): protdist's `P` cycles six models — JTT (the
  shipped default) → Henikoff/Tillier PMB → Dayhoff PAM → Kimura
  formula → similarity table → categories model — confirmed by running
  `/usr/lib/phylip/bin/protdist` (transcript in the PR comments).
  neighbor's menu is identical to pack 1's run. The settings table's
  protein-Kimura row names the PROTEIN Kimura correction explicitly and
  disambiguates it from dnadist's DNA "Kimura 2-parameter".
- **Precision (conductor note 3):** protdist prints 6 decimals on its
  outfile (6 cells per line at 10 species — one fewer than dnadist's
  7), but the fixture's `precision` field is 4, the smallest decimal
  count surviving the JSON round-trip (`0.722200` → `0.7222`). Tests
  compare distances within `0.5·10^-precision` = 0.5e-4 as the note
  requires; measured engine-vs-fixture max diff is 4.9e-7. The
  outtree prints 5 decimals, so all length pins use 0.5e-5 — and the
  engine's own full-precision matrix passes it honestly (measured
  4.5e-6), so the branch-length claim is pinned, not weakened.
- **Prompts:** a `predict_pair` at join 1 whose reveal names P04–P07 —
  here the matrix's closest pair AND NJ's first join (neighbor's
  progress log prints "species 4 joins species 7" at cycle 7; the
  reveal says the agreement is not the rule) — and a closing `note` at
  the completed-tree step (at_step = 9 for 10 taxa NJ) naming P05's
  negative pendant edge. Both claims are pinned to the engine's trace
  and matrix in `packs.test.ts`; no prompt quotes a number.
- **"Load this lab" (conductor note 4):** a new e2e in
  `web/e2e/labs.spec.ts` — `?lab=protdist-neighbor` → "Load this lab"
  → the app shows `Distance correction` = `Jtt` (the select's value is
  the DistModel variant name) + method NJ, and a full matrix row equal
  to the fixture at the displayed 3-decimal precision. The `#x=` link
  length is reported in the PR body.
- **Files outside the Files block:**
  - `web/src/labs/registry.test.ts`, `web/src/labs/labs.test.tsx`
    (modified): the flag-off shipped-listing assertions now expect both
    shipped packs — scoped expectations, not weakened ones (conductor
    note 7).
  - `web/e2e/labs.spec.ts` (modified): the new shipped-pack-2 load test
    above, and the without-flag index test now expects both packs.
  - `web/e2e/visualScenes.ts` (modified): one new scene
    `lab-protdist-neighbor-print` (conductor note 6) — `fullPage`,
    1920×1080 and 768×1024 in both themes under
    `emulateMedia("print")`, same treatment as pack 1's scene.
  - `web/e2e/__screenshots__/lab-protdist-neighbor-print-*.png` (4 new
    baselines): additive only, generated in the pinned Playwright
    image with a targeted `--grep`; no existing baseline changed.
    Owner gate on baselines stands.
  - `docs/decisions.md` (this entry).
- **Bundle:** the pack lives in the lazy `labs` chunk; initial JS
  measurement vs main is reported in the PR body.
- **Fix round 1 (PR #102, owner review):** the JTT matrix check in
  `packs.test.ts` now uses protdist's real printed precision — 0.5e-6
  (6 decimals, e.g. `0.722200` in outfile) — not `0.5·10^-precision`
  off the fixture's `precision: 4`. That field counts the decimals
  that survive the JSON round-trip's dropped trailing zeros and
  under-reports what protdist prints; correcting it is an owner
  decision outside this PR. Measured max engine-vs-fixture diff is
  4.95e-7, so the tighter bound passes honestly. A new named test
  pins the note's mechanism claim: at the step joining P02 and P05 the
  trace's row sums give R(P02) > R(P05), and the limb formula on the
  step's own distance and row sums reproduces P05's negative pendant.
  The "both tools count only standard-amino-acid sites" claim stays,
  verified by a gapped toy run of the installed protdist 3.697
  (Kimura printed 0.304489 = d(p) with p = 2 differences / 8
  comparable sites, i.e. `-` and `X` sites pairwise-deleted) and by
  `pair_counts` in `protein_dist.rs`, which skips any site where
  either character is non-standard. No pack text changed, so no
  baseline regeneration.
- **Fix round 2 (PR #102, owner review):** the handout's second
  question answered itself before the student's step-1
  `predict_pair` ("Was the closest pair in the matrix the first to
  join? Here it was — is that a rule?") — now asks without telling:
  "Was the closest pair in the matrix the first to join — and would
  that always be so?" The pre-action scan also caught the PHYLIP
  note naming the negative pendant's leaf (`P05's small negative
  edge included` → `a small negative pendant edge included`) —
  the note renders on the lab page before the student acts, and
  pack 1's note names no leaves. Steps 2–3's and Q3's
  negative-branch hints stay unnamed, per the round's rule; the
  step-1 reveal (P04–P07) and the step-9 note (P05) are post-action
  text and unchanged. The 4 `lab-protdist-neighbor-print` baselines
  regenerated in the pinned Playwright image (`--grep
  lab-protdist-neighbor-print`); no other baseline touched.

## v1.4 follow-up P1: fixture precision counted on raw PHYLIP output

- **Finding (owner decision 2026-10-27 on PR #102, option A):** PHYLIP
  3.697 prints distance matrices to 6 decimals (`dnadist`, `protdist`)
  and `neighbor` branch lengths to 5, but the v1 DNA and v1.1 protein
  sections of `fixtures/generate_phylip.sh` counted decimals on R's
  re-printed parsed numbers, where trailing zeros vanish (`0.722200`
  → 4). `ref/protein/{p10_400,p8_250,p12_100}.json` therefore recorded
  `precision: 4` and the protein parity tolerance was 0.5e-4 instead of
  0.5e-5. The v1.4 section already counted on raw outfile text.
- **What changed:** both sections now count decimals on the raw
  printed text — matrix outfiles for `dist_precision`, the raw
  (whitespace-stripped) outtree Newick for `tree_precision` — and write
  both keys alongside `precision = min(dist_precision, tree_precision)`.
  Regenerated through `generate_phylip.sh` then `generate.R` per the
  README order: protein `precision` 4 → 5 (p6_150 stays 5), DNA
  `precision` unchanged at 5, `dist_precision` 6 and `tree_precision`
  5 everywhere. Every distance, tree, label and other fixture byte is
  identical. No test, tolerance or code changed; the tighter protein
  bound (0.5e-5) applies automatically and `protein_dist`/`corpus`/
  wasm `parity` all pass.
- **Follow-up:** PR P2 will switch the tests to `dist_precision` for
  distance comparisons and `tree_precision` for branch lengths, so
  `precision` is no longer the single tolerance source.
- **Files touched:** `fixtures/generate_phylip.sh` (v1 DNA and v1.1
  protein decimal counting), the six `ref/*_phylip.json` /
  `ref/protein/*.json` fixtures, `fixtures/README.md` (precision key
  meanings), `docs/decisions.md` (this entry). No changes under
  `crates/`, `web/`, `exercises/` or `scripts/` — fixture-only PR.

## v1.4 follow-up P2: tests compare at PHYLIP's split printed precision

- **PR #103 follow-up (owner decision A on PR #102):** tests that
  compare PHYLIP output now read `dist_precision` for matrix cells and
  `tree_precision` for branch lengths instead of the single
  `precision` (= min of the two). On ref files both keys are required:
  a missing key fails loudly, never a silent fallback to `precision`.
- **What changed (old → new tolerance per family):**
  - `tests/corpus.rs` — `ref/*_phylip.json` distances 0.5e-5 → 0.5e-6
    (`dist_precision` 6); NJ branch lengths and UPGMA cluster heights
    stay at 0.5e-5·depth (`tree_precision` 5). ape/phangorn fixtures
    keep 1e-9. Load also asserts `precision == min(dist, tree)` on
    PHYLIP files.
  - `tests/protein_dist.rs` — `ref/protein/*.json` distances 0.5e-5 →
    0.5e-6; NJ branch lengths unchanged at 0.5e-5. Both keys are
    required serde fields.
  - `tests/parity_phylip_v14.rs` — `phylip/{f84,k2p}` fixtures record
    only `precision` (dnadist's matrix decimals); matrices stay at
    0.5e-6, now via `dist_precision.unwrap_or(precision)`. The file
    has no tree comparisons.
  - `web/src/labs/packs.test.ts` — pack 2's matrix bound reads
    `dist_precision` (was the hard-coded 0.5e-6 workaround; the
    "under-reports" comment is gone) and its three branch-length
    checks read `tree_precision` (were literal 0.5e-5). Pack 1 keeps
    the same numbers: the f84 fixture records only `precision` (the
    matrix decimals), so its matrix check reads it and its outtree
    bound stays the literal 0.5e-5 (comment notes why).
  - `neophylo-wasm/tests/parity.rs` — audited, unchanged: its corpus
    subset replays only the two ape/phangorn fixtures at 1e-12.
  - `web/e2e/labs.spec.ts` and `web/src/explain/math.test.ts` —
    audited, unchanged: they read matrices/`input` only, never the
    precision fields.
- **Result:** the tightened 0.5e-6 distance bound passes on all six
  ref PHYLIP fixtures — max |err| 4.98e-7 (DNA, `jc6_phylip/JC69`),
  4.95e-7 (protein, `p10_400/JTT`); tree bounds unchanged (max NJ
  branch |err| 4.88e-6 ref DNA, 4.75e-6 protein, 4.999999999977e-6
  f84 `jc6`). No parity finding; no expected value or tolerance
  changed beyond the split-field switch.
- **Files touched:** `crates/neophylo-core/tests/{corpus,protein_dist,
  parity_phylip_v14}.rs`, `web/src/labs/packs.test.ts`, this entry.
  Test-only PR — no engine code, no fixtures.

## v1.4 Task 12 pack 3a: seqboot → dnadist → neighbor → consense chain fixture

- **Owner decision (2026-10-27, in chat: "Real PHYLIP chain fixture"):**
  NeoPhylo's bootstrap cannot reproduce seqboot's random replicates, so
  pack 3's oracle is PHYLIP's whole `seqboot` → `dnadist` → `neighbor` →
  `consense` chain on `inputs/k80_10.fasta` (the pack 1 dataset),
  committed verbatim as `fixtures/phylip/chain/k80_10_boot100.json`. The
  pack PR can check that NeoPhylo's consensus of PHYLIP's own replicate
  trees equals `consense`, and claims nothing more about NeoPhylo's own
  replicates than the splits it pins.
- **Seed:** 8675309 — the first candidate of a deterministic odd-seed
  search (odd values from 8675309 upward, step 2) whose consense
  extended-majority run on the 100 trees has no tied decision; it was
  tie-free on the first try, so no later seed was needed. The same value
  is handed to neighbor's `M` seed prompt.
- **Menu reads (all asserted off the installed 3.697 menus, not
  assumed):** `seqboot` defaults `J` Bootstrap and `R` = 100, then asks
  "Random number seed (must be odd)?" after `Y`. `dnadist` `M` asks
  "Multiple data sets or multiple weights?" (`D`), then "How many data
  sets?" (`100`); F84, T = 2.0 and empirical frequencies are the shipped
  defaults. `neighbor` `M` asks "How many data sets?" then also demands
  an odd random seed — answering it flips `J` to "Yes (random number
  seed = <seed>)", i.e. PHYLIP jumbles input order once per data set;
  the run asserts the menu says exactly that. `consense` runs are the
  same `Y` / `C Y` / `C C Y` keystrokes as `generate_consensus.sh`,
  toggles read off the menu; all four programs report version 3.697 and
  the script asserts they match.
- **Why a new script:** PR #103 is open on `generate_phylip.sh`, so the
  chain generator is the standalone `fixtures/generate_lab_chain.sh`
  (same style and the same consense driver as `generate_consensus.sh`;
  its parser and assertions live in `fixtures/lab_chain_checks.R`, kept
  separate so both files stay single-purpose and under the ~400-line
  rule). Wiring it into `generate_phylip.sh` — or the CI fixture guard —
  is left for a later PR.
- **Fixture shape:** `name`, `generator`, `input`, `seed`, `replicates`,
  `labels`, `trees` (the 100 neighbor outtree Newicks in order,
  whitespace collapsed), `consense.{extended,strict,majority}` in the
  same `newick`/`groups`/`not_included` shape as `consensus/*.json`, and
  `tree_precision` counted on the raw outtree text (5 decimals). New
  directory `phylip/chain/` so no existing glob picks it up; the R step
  asserts consense's group inventory equals `ape::prop.part` on `trees`.
  No NeoPhylo output is pinned.
- **Files touched:** `fixtures/generate_lab_chain.sh` (new),
  `fixtures/lab_chain_checks.R` (new — the parser/assertions/JSON write),
  `fixtures/phylip/chain/k80_10_boot100.json` (new), `fixtures/README.md`
  (`phylip/chain/` bullet + regenerate line), `docs/decisions.md` (this
  entry). No changes under `crates/`, `web/`, `exercises/` or `scripts/`.

## v1.4 Task 12 pack 3a-2: pack 3 chain fixture switched to jc12 (owner command on #104)

- **Owner command (2026-10-27, `conductor: fix use jc12` on #104):** #104
  was already merged, so this is a new fixture-only PR from main. The
  pack 3 chain fixture moves from `k80_10` to `jc12`.
- **Why (owner decision, from the conductor's survey with the same chain
  and the same seed search):** on `k80_10` every consense
  extended-majority group is 100 except one at 98. On `jc12` (12 taxa,
  250 sites, committed and gap-free, already in `fixtures/phylip/f84/`
  with a neighbor tree since #100) the extended groups are
  100 100 100 99 96 95 92 90 72 and the best rejected set is 11 — a real
  bootstrap lesson with a stable majority tree.
- **Seed:** 8675309 — the unchanged deterministic odd-seed search
  (8675309 upward, step 2) accepted the first candidate again; its
  consense extended-majority run on the 100 trees has no tied decision.
  Result: 12 taxa, 100 trees, 23 groupings in
  `fixtures/phylip/chain/jc12_boot100.json`, matching the survey.
- **Deletion:** `fixtures/phylip/chain/k80_10_boot100.json` is removed;
  a repo-wide grep confirmed nothing references it (only the historical
  decisions.md entry above, which stays as the record of #104).
- **Wiring:** `generate_lab_chain.sh` is now invoked at the end of
  `generate_phylip.sh`, right after `generate_consensus.sh`, so
  `FIXTURES=1` reproduces it. Stale comments fixed at the same time:
  `INPUT="jc12"` with an owner-chosen note, the header names
  `inputs/jc12.fasta`, the "not wired yet (PR #103)" note is gone, and
  the FASTA conversion no longer claims the other file is edited by an
  open PR. `fixtures/README.md`'s `phylip/chain/` bullet and the
  regenerate block were updated to match.
- **CI coverage gap (deliberately not fixed here):** the `r-and-fixtures`
  job regenerates via `FIXTURES=1 scripts/ci/fixture-guard.sh`, whose
  drift check greps only `fixtures/ref`, `fixtures/consensus` and
  `fixtures/worked` — `fixtures/phylip/` (f84, k2p and now chain) is
  regenerated but not diffed. Covering it needs a change to
  `scripts/ci/fixture-guard.sh`, which this fixture-only PR must not
  touch; flagged for a follow-up scripts PR.
- **Files touched:** `fixtures/generate_lab_chain.sh`,
  `fixtures/generate_phylip.sh`,
  `fixtures/phylip/chain/k80_10_boot100.json` (deleted),
  `fixtures/phylip/chain/jc12_boot100.json` (new), `fixtures/README.md`,
  `docs/decisions.md` (this entry). No changes under `crates/`, `web/`,
  `exercises/`, `scripts/` or `.github/`.

## v1.4 follow-up: fixture guard covers fixtures/phylip (owner approved on #106)

- **Gap closed:** `FIXTURES=1 scripts/ci/fixture-guard.sh` regenerates
  `fixtures/phylip/` (f84, k2p via `generate_phylip.sh`; chain via
  `generate_lab_chain.sh`) but its drift check only diffed
  `fixtures/ref fixtures/consensus fixtures/worked`, so drift under
  `phylip/` regenerated silently. `fixtures/phylip` is now in both the
  `git diff --exit-code` pathspec and the `git status --porcelain`
  stray-file check. The `r-and-fixtures` step name/comment in
  `.github/workflows/ci.yml` updated to match (comment-only).
- **Local proof:** `FIXTURES=1 ./scripts/ci/fixture-guard.sh` passes on a
  clean tree — `fixtures/phylip/` is byte-stable under regeneration,
  seqboot chain included (jc12_boot100: 12 taxa, 100 trees, 23
  groupings). With a perturbed value staged in
  `phylip/f84/jc6.json` the same run exits 1 at the git-diff check
  (staging stands in for committed drift since regeneration overwrites
  the worktree copy first); the file was then restored untouched.
- **CI coverage:** the `changes` job's `fixtures` filter already lists
  `scripts/ci/fixture-guard.sh` and `.github/workflows/ci.yml`, and
  `r-and-fixtures` runs when `fixtures` matches — so this PR's own
  checks exercise the new diff. No filter change needed.
- **Files touched:** `scripts/ci/fixture-guard.sh`,
  `.github/workflows/ci.yml` (step name + comment only),
  `docs/decisions.md` (this entry). No changes under `fixtures/`,
  `crates/`, `web/` or `exercises/`.

## v1.4 Task 12 pack 3: seqboot → dnadist → neighbor → consense lab pack

- **Scope:** plan Task 12 Steps 4 and 5 for pack 3 only — packs 1 and 2
  are merged and untouched. Owner gate: `[OWNER REVIEW]` content check
  of the handout and the PHYLIP-vs-NeoPhylo note before merge.
- **Dataset (conductor note 1 / spec §6.3):** the pack embeds
  `fixtures/inputs/jc12.fasta` verbatim (12 × 250). Expected numbers
  come from `fixtures/phylip/chain/jc12_boot100.json` — PHYLIP's whole
  chain (seqboot seed 8675309, 100 replicates through dnadist M = 100,
  neighbor M = 100 with the forced jumble seed, consense three ways) —
  plus `fixtures/phylip/f84/jc12.json` for the full-data F84 matrix and
  neighbor tree. Provenance is recorded in `exercises/labs/README.md`.
  License = the repo's AGPL-3.0-only; no `THIRD_PARTY_NOTICES.md`
  entry — original in-house data.
- **Bootstrap settings:** `bootstrap: { replicates: 100, seed:
  8675309 }` — 100 is seqboot's menu default (recorded in
  `fixtures/README.md`) and 8675309 is the odd seed the chain ran.
  NeoPhylo's resamples are different random draws than seqboot's, so
  the pack pins groupings and PHYLIP's counts, never NeoPhylo's counts.
- **The plan's assertion (`packs.test.ts`):** the engine's consensus
  computed from PHYLIP's own 100 replicate trees equals `consense` for
  strict, majority and extended — the same groupings with the same
  counts — and the tally holds consense's whole set inventory,
  including the 14 "Sets NOT included" counts. The tally is assembled
  from the fixture's `trees` via `splitKeys` (the existing display
  helper whose canonicalization mirrors `bootstrap::split`), never a
  drawn view. NeoPhylo's own bootstrap (the lab's seed, 100
  replicates) reproduces all 9 majority groupings honestly — its
  counts differ (79/81/93/95/98/100s vs PHYLIP's 72/90/92/95/96/99/100s).
- **Menus read off the installed 3.697 binaries** (conductor note 2,
  transcripts in the PR comments): seqboot's `J` Bootstrap / `R` = 100
  defaults and the post-`Y` odd-seed prompt; dnadist's `M` → `D` → 100;
  neighbor's `M` → 100 → odd seed flipping `J` to "Yes (random number
  seed = 8675309)"; consense's extended-majority default and
  strict/majority toggles. Neighbor's full-matrix run confirms the
  first join the `predict_pair` reveal names (species 11 joins 12).
- **Prompts:** a `predict_pair` at join 1 (reveal: t11–t12 join first
  under Q though t01–t02 is the closest pair — both pinned to the
  engine's trace and matrix), a completed-tree `note` at at_step 11
  (12 taxa → steps+2), a `predict_branch` at the bootstrap panel
  (reveal: the least-supported internal branch unites t05–t12 — the
  minimum on the engine's own support tree, pinned), and a
  first-run-`after` note stating support is a count of replicates,
  never a probability. No prompt quotes a number.
- **"Load this lab" (conductor note 4):** a new e2e in
  `web/e2e/labs.spec.ts` — `?lab=seqboot-consense` → "Load this lab" →
  F84 + NJ, a matrix row equal to the f84 fixture at the displayed
  precision, and after stepping to the end the bootstrap panel shows
  Replicates 100 and Seed 8675309 (read from the chain fixture). The
  `#x=` link is 4,038 chars (reported in the PR body).
- **Files outside the Files block:**
  - `web/src/labs/registry.test.ts`, `web/src/labs/labs.test.tsx`
    (modified): the flag-off shipped-listing assertions now expect all
    three packs — scoped expectations, not weakened ones.
  - `web/e2e/labs.spec.ts` (modified): the new shipped-pack-3 load test
    above, and the without-flag index test now expects all three packs
    (heading-scoped — the pack's title equals its chain text).
  - `web/e2e/visualScenes.ts` (modified): one new scene
    `lab-seqboot-consense-print` — `fullPage`, 1920×1080 and 768×1024
    in both themes under `emulateMedia("print")`, same treatment as
    packs 1–2.
  - `web/e2e/__screenshots__/lab-seqboot-consense-print-*.png` (4 new
    baselines): additive only, generated in the pinned Playwright
    image with a targeted `--grep`; no existing baseline changed.
    Owner gate on baselines stands.
  - `docs/decisions.md` (this entry).
- **Bundle:** the pack lives in the lazy `labs` chunk; initial JS
  measurement vs main is reported in the PR body.

### Task 12 pack 3 — fix round 1 (PR #108)

- **The `predict_branch` reveal claims only the weakest grouping**
  (owner command): it now says the same grouping is weakest in
  PHYLIP's run and in the student's, while counts differ — the
  "the ranking is what carries" claim is gone. `packs.test.ts` reads
  PHYLIP's weakest grouping from `jc12_boot100.consense.majority`
  (its minimum-count row, t05–t12 at 72) instead of a hard-coded
  literal and asserts NeoPhylo's weakest branch equals it.
- **Bootstrap settings locked** (owner decision): the pack's `locked`
  lists `bootstrap.replicates` and `bootstrap.seed`, so the static
  reveal can't be contradicted by a student's own seed or replicate
  count. `BootstrapPanel` gained a `locked` prop honouring the same
  `disabled` + "Fixed for this lesson." tooltip pattern Controls
  uses (`LOCKED_TOOLTIP` is now exported); App passes the same
  `source === "sandbox" ? [] : exercise.locked` expression it already
  passes Controls — sandbox stays unlocked. Pins: a
  `BootstrapPanel.test.tsx` describe (locked → both inputs disabled
  with the tooltip, unlocked unchanged) and a named `labs.spec.ts`
  test (the loaded pack shows Replicates 100 and the fixture's seed,
  both disabled).
- **The `first_run` note's "Sets included" pointer** now reads "in
  the lab page's PHYLIP note" — the app shows no note below.
- **Baselines:** the 4 `lab-seqboot-consense-print` frames were
  regenerated in the pinned Playwright image with a targeted
  `--grep`; they came back byte-identical (the lock and prompt text
  never reach the lab print view) and `git diff --name-status
  origin/main -- web/e2e/__screenshots__/` stays A-only. The full
  `--project visual` run in the same image passed all 89 scenes —
  no existing baseline changed. Locked-panel screenshots (1920 and
  768, both themes) are posted as a PR comment, not committed.
- **Files outside the Files block, this round:**
  `web/src/views/BootstrapPanel.tsx` + `BootstrapPanel.test.tsx`
  (the `locked` prop and its pins), `web/src/views/Controls.tsx`
  (`LOCKED_TOOLTIP` exported), `web/src/views/App.tsx` (passes
  `locked` to the panel), `web/e2e/labs.spec.ts` (the named lock
  test), `web/e2e/__screenshots__/` (the 4 regenerated frames), this
  file.

## v1.4 Task 13: release checkpoint, roadmap, CITATION

- **Files outside the Files block:** this entry (`docs/decisions.md`),
  as every task records.
- **`docs/roadmap.md`:** the Status line — v1.4 joins the "released or
  releasing" list the way v1.3 was written, next becomes v1.4b, and
  the revision date moves to today. The v1.4 section keeps the editor,
  the parity models and the PHYLIP lab packs and drops "and MEGA
  companion" from its heading; the MEGA companion bullets, the curated
  data library and the trailing lesson-library/worksheets bullet move
  verbatim into a new "### v1.4b MEGA companion and data library"
  section right after it (v1.4b gets its own spec, per spec §1). The
  lesson-library bullet moved because a released section should list
  only shipped work; worksheets and the instructor guide are a spec
  §2.2 non-goal for v1.4.
- **`CITATION.cff`:** `version: 1.4.0` only; `date-released` stays as
  the owner left it — to be set at tag time (same arrangement as the
  v1.3 release). The abstract still describes the tool accurately —
  it makes no exhaustive claim about the model menu — so it is
  unchanged.
- **Step 3 scope:** `./scripts/check.sh` with `E2E=1` can't run inside
  the agent sandbox (docker and the Playwright image are unreliable
  here). `./scripts/check.sh quick` was run — fmt + clippy, no
  `crates/` changes so the wasm pkg was skipped; docs-only. The
  conductor verifies main's full-matrix CI.
- **Pre-release fixes (owner checkpoint 2026-10-27, same PR):**
  - Checkpoint §5 rewritten to describe reality: `F84`/`K2P_PHYLIP`
    appear in the exercise editor's settings and in the correction
    menu only when the loaded exercise or lab prescribes them; the six
    built-in lessons' menus are unchanged. A re-checks section (§8)
    covers the detach refusal wording, the saturation note and the
    bootstrap-basics Length-change behaviour; the #107 gate line now
    reads "merged 2026-10-27 (#107)".
  - `drawOps.ts` `refusalMessage`: a detach refused because the parent
    joins only two branches gets a canvas body naming the node and its
    sibling and saying what to do instead ("drag it onto another
    branch, or select it and a branch and press J"). The trigger is
    exactly the engine's refusal condition, so the two pre-existing
    tests that pinned the old "fewer than two children" phrasing
    (`DrawCanvas.test.tsx`, the unary-drag test and the
    refused-detach test) had their message assertions updated — the
    instruction's "existing test must pass unmodified" could not hold
    for the leaf-detach scenario it exercises; flagged for the owner.
  - The unary-drag e2e test (`web/e2e/editor.spec.ts`) still asserted
    the old "fewer than two children" canvas text; it now follows the
    owner-approved message change — title, the two-branch body naming
    A and B, and what to do instead — and checks the old phrasing is
    gone.
  - `saturation.json` step-1 note reworded so it stays true after a
    fix works (text only).
  - `bootstrap-basics.json`: the step-7 `first_run` note now asks for
    one action (change Seed, run again). In `lesson.ts`, a settings
    rebuild (`setSim`/`setAnalysis`/`setAlphabet`/`setBranchScale`) in
    a lesson with a `bootstrap` block and a completed run lands on the
    new tree's final position and keeps `completedRuns`/`maxRunSites`
    (results still cleared); lessons without a `bootstrap` block keep
    the reset-to-step-0 behaviour.
  - `cytochrome-c` claim verified with the engine: RF = 0 vs the
    lesson reference under JTT **and** under `p` **and** `Kimura`, so
    the "matches the accepted classification in every clade" wording
    stays; `locked` unchanged.
  - Standing note added (lesson notes must stay true under every
    student-changeable setting); roadmap v1.4b bullet added (sandbox
    correction menu gains `F84`/`K2P_PHYLIP` in v1.4b).
  - **Files outside the Files block (this fix round):**
    `web/src/views/editor/drawOps.ts`,
    `web/src/views/editor/DrawCanvas.test.tsx`,
    `web/src/state/lesson.ts`, `web/src/state/session.test.ts`,
    `web/e2e/bootstrap-lesson.spec.ts`, `exercises/saturation.json`,
    `exercises/bootstrap-basics.json`,
    `docs/conductor/standing-notes.md`,
    `crates/neophylo-core/tests/exercise_v2.rs` — plus the checkpoint
    doc itself, which is part of the original Files block.
    `exercise_v2.rs` is a test file, not engine code: its
    `V1_SATURATION` constant mirrors the exercise file verbatim so v1
    and v2 load identically; the saturation note reword forced a
    one-line text sync — no engine logic, tolerance or fixture touched.
    The snapshot baselines `web/e2e/__screenshots__/bootstrap-basics-*`
    (7 files) were regenerated in the pinned Playwright image for the
    reworded note — owner approval required as always.

## v1.4b Task 1: spec, roadmap split into v1.4b and v1.4c

- **Spec:** `docs/superpowers/specs/2026-10-27-neophylo-v1.4b-mega-companion-design.md`;
  plan `docs/superpowers/plans/2026-10-28-neophylo-v1.4b-plan.md`.
- **Roadmap split:** the old v1.4b section was narrowed to the MEGA companion and data
  library (`.meg` import/export, MEGA's gap treatments, protein parity with MEGA-CC
  fixtures, four handouts, a bundled dataset library). A new **v1.4c** section now
  carries accession fetch in the browser, distance-matrix input (`.meg` and PHYLIP),
  and the lesson library/printable worksheets/instructor guide; the Status line names
  v1.4c as following v1.4b.
- **Why the split:** accession fetch is the app's first outside network request and
  matrix input is a new pipeline entry point; both pair naturally with the lesson
  library, so they ship together in v1.4c instead of diluting the MEGA companion work.
- **Decided in this plan** (spec §10 open items that need no oracle output; verbatim
  from the plan):
  - **JSON identifiers:** `"Poisson"` (matches the existing `"Kimura"`, a named protein
    correction) and, only if Task 2 shows it is needed, `"JTT_MEGA"` (matches
    `"K2P_PHYLIP"`). Rust: `DistModel::Poisson`, `DistModel::JttMega`.
  - **Site filter wire shape:** `{ "kind": "pairwise" | "complete" | "partial",
    "cutoff_pct": <integer 0–100> }`; `cutoff_pct` is present only for `partial`.
    Rust: `SiteFilter::{Pairwise, Complete, Partial { cutoff_pct: u8 }}`.
  - **Partial coverage is integer arithmetic:** a column is kept when
    `present * 100 >= cutoff_pct * n` (no floats), unless Task 2's boundary fixture
    shows MEGA uses strict `>`; then the comparison flips and the fixture note says why.
  - **Library datasets in links:** a library dataset is linked as `ds=<id>`, not
    embedded as `d=` data; an unknown `ds` id is a restore error with a message, like
    the existing `d=` failures.
  - **The pair panel** is where removed columns are shown (NeoPhylo has no
    whole-alignment view; spec §6.2).

## Conductor: act as the neophylo-conductor GitHub App (owner request, 2026-10-28)

- **What:** the conductor and every Devin session act on GitHub as the GitHub App
  `neophylo-conductor[bot]` (app 5503160, installed on this repository only), not as the
  owner. `scripts/conductor/app-token.sh` mints 1-hour installation tokens from a private key
  kept outside the repo (`~/.config/neophylo-conductor/`); `scripts/conductor/bin/gh` and
  `bin/git-credential-neophylo` fetch a fresh token per call, so long sessions never expire;
  `app-env.sh` (sourced by `devin.sh`, `status-comment.sh`, `as-app.sh`, `start.sh`) sets
  them up and authors commits as the bot. The owner's own shell is unaffected.
- **Permissions:** Contents, Pull requests, Issues, Actions read/write; Checks, Commit
  statuses, Metadata read. No Administration, Workflows, Secrets or Environments, so the app
  cannot change settings, rules or `.github/workflows/`.
- **Why:** under the owner's account the owner could not approve agent PRs (GitHub forbids
  self-approval; Devin's "APPROVE" on #111 became a comment), received no notifications for
  escalations, and `/inbox` could not tell owner commands from agent comments by author.
- **Owner-only settings** (`docs/conductor/rulesets/apply.sh`, run by the owner): `main`
  requires a PR with one Code Owner approval not by the last pusher; `v*` tags only by the
  owner; the `production` environment requires the owner's approval, because the app's Actions
  permission could otherwise deploy through a dispatch on `main`.
- **`.github/CODEOWNERS`:** `* @dorrabbkhan` added first, so every PR needs the owner.
- **`/inbox`** (local, `.claude/` is gitignored): a command counts only from `dorrabbkhan` with
  association OWNER; comments by the bot are never commands. `status-comment.sh` edits only
  the bot's own sticky comment.
- **CLA:** commits by the bot are the owner's agents acting on the owner's behalf; no CLA
  signature is needed for them.

## Conductor: track .claude/settings.json and .claude/commands/ (owner request, 2026-10-28)

- **What:** `.gitignore` no longer ignores all of `.claude/`; only `.claude/settings.local.json`
  and `.claude/worktrees/` stay untracked. `.claude/settings.json` (the conductor's allow/deny
  list) and `.claude/commands/{conduct,inbox,run-plan}.md` are committed as they stand on the
  conductor machine, including the owner-only command check added to `/inbox` with the GitHub
  App (`dorrabbkhan` + association OWNER; the bot's comments are never commands).
- **Why:** they are the conductor's guardrails and were invisible to review and lost on a new
  checkout; `CONDUCTOR-SETUP.md` already said to commit them, and babelgate tracks the same
  files. With `* @dorrabbkhan` in CODEOWNERS, any change to them needs the owner's approval.

## Conductor: SessionStart hook sets the app identity (owner request, 2026-10-28)

- **What:** `.claude/settings.json` gains a SessionStart hook running
  `scripts/conductor/session-env.sh`, which writes absolute `export` lines (git identity and
  credential helper, the `gh` wrapper first on PATH, `NEOPHYLO_ACTOR`) to `$CLAUDE_ENV_FILE`. Every
  Claude Code session opened in this repo therefore acts as `neophylo-conductor[bot]`, however it
  was started; `start.sh` stays but is optional. On a machine without the app's config the
  hook writes nothing. CLAUDE.md and CONDUCTOR-SETUP.md describe it, with the fallback check
  (`printenv NEOPHYLO_ACTOR` empty → use `as-app.sh`).
- **Why:** in a plain `claude` session, the conductor's own `gh` calls (escalations, /inbox
  acknowledgements) went out as the owner, who gets no notification for their own comments.
- **Shell:** export lines rather than sourcing `app-env.sh`, which is bash-only; the owner's
  shell is zsh. Verified with a fresh headless session: commits authored by the bot.

## v1.4b Task 2: MEGA-CC oracle and first fixtures (fixture PR)

- **What:** `fixtures/mega/{mao,*.json,README.md}` — 54 `.mao` files (DNA
  p/JC69/K2P and protein p/Poisson/JTT × pairwise/complete/partial95 × dist/NJ/UPGMA),
  `generate_mega.sh`, per-input JSON for every `inputs/*.fasta` and `inputs/protein/*.fasta`,
  new `inputs/gaps_boundary.fasta` (20 taxa: one 95%- and one 90%-coverage column), and
  `worked/mega-notes.md` recording the MEGA-CC 12.1.4 oracle findings.
- **Key decisions (fix round 1, owner option A):** (1) hand-written `.mao` files whose key
  is `Gaps/Missing Data Treatment` are echoed but silently ignored — only GUI-serialized
  files work — so `dist_dna_p_complete.mao`/`dist_dna_p_partial95.mao` are the owner's
  verbatim MEGA Prototype files and the other 52 are derived from them (same key names,
  order, sections, comment header and `ver` line; for NJ/UPGMA the tree block —
  `Analysis = Phylogeny Reconstruction`, `Scope = All Selected Taxa`, `Statistical
  Method`, `Phylogeny Test`/`Test of Phylogeny = None` — is derived from a real GUI
  NJ serialization plus `strings megacc`; for protein `Substitutions to Include =
  Not Applicable`); (2) megacc now applies the declared treatment itself on the
  unfiltered input — proven per setting: 3-taxon complete gives 9 sites (a–b
  0.11111111), `jc8_gaps` reports 365 vs 500 sites under dist/NJ/UPGMA with different
  trees per treatment, a gapped protein alignment reports 38 vs 40 the same way, each
  model differs from p on a divergent input, NJ and UPGMA differ on a non-ultrametric
  input — and the generator keeps an assert-only kept-site check against `No. of
  Sites` instead of pre-filtering; (3) partial-cutoff boundary `>=` is now observed
  from MEGA's own output: `gaps_boundary` reports 1,000 → 999 (partial95, the 95%
  column kept) and → 998 (complete), same on a 20-taxon protein control; (4) MEGA's
  JTT diverges from `Jtt` (max 0.1779 on p12_100) → `JttMega` needed; (5) branch
  lengths are printed to ~16 significant digits with trailing zeros trimmed, so
  comparisons are per-printed-value half-ulp, recorded as max decimals.
- **All numbers identical to round 0:** megacc applies the treatments to the same
  column set the old pre-filter removed, so every `distances`/`trees`/`precision`
  entry is byte-identical (largest |diff| = 0 for complete and partial95); only
  `generator.note`/`mao_sha256` changed in each JSON.
- **Files outside the Files block:** `fixtures/ref/gaps_boundary.json` (ape ref for
  the new input, added in this PR) and `docs/decisions.md` itself (this entry, per
  workflow).
- **Open items answered:** megacc version 12.1.4 build 12261022; printed precision 8 dp
  distances / ~16 sig-digit branch lengths; bootstrap filters sites before resampling
  (manual: removed "before the analysis begins"); `N` is missing under all treatments;
  JTT verdict `JttMega` needed.

## v1.4b Task 3: engine site filter (complete/partial deletion), filtered bootstrap

- **What:** `site_filter.rs` adds `SiteFilter { Pairwise, Complete, Partial {
  cutoff_pct } }` (serde `tag = "kind"`, snake_case; `Default = Pairwise`),
  `SiteMask { weights, removed }` and `site_mask`; `dist.rs` gains
  `compute_filtered` (= `site_mask` + `compute_weighted`); bootstrap gains
  `bootstrap_batch_filtered` and `replicate_detail_filtered`, with `bootstrap_batch`
  / `replicate_detail` delegating at `Pairwise`; `NeoError` gains `NoSitesKept {
  filter }`.
- **Decisions taken (from Task 2's `mega-notes.md`, not guessed):** the partial
  boundary is `present*100 >= cutoff_pct*n` in `u64` — MEGA keeps the exact-95%
  column in `gaps_boundary` (1,000 → 999 kept; complete keeps 998); "missing" is
  the existing per-pair rule (`is_base` for DNA, `protein_index` for protein);
  MEGA removes sites before the analysis begins, so filtered replicates draw
  `resample_weights(seed, i, kept.len())` over the kept columns — `Pairwise` is
  therefore bit-identical to the old path and every replicate golden is
  unchanged.
- **Error shapes:** `cutoff_pct > 100` → `InvalidExercise { field:
  "site_filter.cutoff_pct" }`; a filter that removes every column → `NoSitesKept`
  with `filter` exactly `"complete"` or `"partial {cutoff}%"` and Display
  "every site was removed by {filter} deletion". A zero-column alignment is not
  "removed", so `Pairwise` stays bit-identical even there.
- **`replicate_detail_filtered`:** `weights` stays one entry per alignment column
  (removed columns are 0 and count in `undrawn`, matching the field's doc), and
  the "original" tree is built on the filtered distances so replicate and
  original are compared under the same treatment.
- **Files outside the Files block:** `crates/neophylo-core/src/bootstrap/mod.rs`
  (re-export the two new functions — the Files block lists tally.rs/resample.rs
  only); `web/src/engine/generated/{SiteFilter,SiteMask,NeoError}.ts`
  (ts-rs output regenerated by `cargo test … export_bindings`, committed as
  produced, never hand-edited); `web/src/explain/errors.ts` and
  `web/src/explain/errors.test.ts` (its `never`-exhaustive switch makes a
  `NeoError` variant without a friendly message a compile error — the minimal
  web change the new variant forces; no other web file touches `NoSitesKept`);
  `crates/neophylo-core/tests/site_filter_props.
  proptest-regressions` (auto-written shrunk counterexample, committed per the
  file's own header and the `edit_props` precedent); `docs/decisions.md` (this
  entry).

## v1.4b Task 4: Poisson and MEGA parity

- **What:** `dist.rs` gains `DistModel::Poisson` (protein, `d = −ln(1 − p)`,
  saturated at `p ≥ 1`), wired through `compute_weighted`/`compute_filtered`
  and `supports`; `protein_dist.rs` gains `poisson_from_p`. `model.rs` is
  identical to main — `SpectralCtx` needed no changes.
- **Owner decision on #117 (2026-10-28): option D — no `JTT_MEGA`.** MEGA's
  JTT estimator is not shipped, because no acceptable or working source for
  MEGA's JTT table exists: the only constants that reproduced MEGA were
  copied from the MEGA binary — rejected as a source (the plan commits
  nothing from MEGA and its licence is unresolved); PHYLIP 3.69's
  `protdist.c` carries Tillier's decomposition, not MEGA's table; and an
  independent derivation from PAML `jones.dat` (JTT92 exchangeabilities,
  3-decimal frequencies, mean rate 0.01) misses MEGA by 9e-3 to 1.5e-1
  against the required 5e-9 on every protein fixture. `DistModel::JttMega`,
  `jtt_mega_constants.rs`, `jtt_mega_spectral`, `mega_newton`/`jtt_mega_ml`
  and the `"JTT_MEGA"` wire name were removed entirely; `model.rs` was
  reverted to main.
- **Pinned JTT divergence (replaces the dropped model's parity):** our `Jtt`
  (PHYLIP 3.697 spectral data) vs MEGA's printed `JTT/<filter>` matrices —
  measured per-input max |diff|, identical under all three filters since the
  protein inputs carry no gaps: p6_150 0.029497, p8_250 0.003641,
  p10_400 0.048638, p12_100 0.177891. `jtt_diverges_from_mega` asserts a
  > 1e-3 gap on every protein fixture/filter;
  `every_fixture_key_is_handled` fails on any fixture key that is neither
  parity-compared (p, JC69, K80, Poisson) nor JTT-divergence-covered. JTT
  tree keys get the printed-matrix topology+labels check only — the tree
  algorithm is ours either way, but MEGA's JTT branch lengths are
  unreproducible because the input matrix itself differs by up to ~0.18.
- **Branch-length parity premise and `len_tol` approved by the owner on
  #117.** `fixtures/mega/*.json` trees were generated on MEGA's
  *full-precision* internal matrix, not the 8-decimal printed one: two
  independent NJ implementations agree bit-for-bit on the printed matrix
  yet sit ~±3e-9 from MEGA's printed branch lengths on every edge —
  exactly the ±5e-9 cell-rounding propagation. No implementation can
  satisfy a half-ulp bound against the rounded matrix. The parity test
  therefore (a) asserts topology+labels from NJ/UPGMA on the printed
  matrix, and (b) compares branch lengths for the tree built on the
  engine's own matrix (which equals MEGA's internal matrix to ~1e-15,
  verified) at `len_tol = max(0.5·10^-d, 8·f64::EPSILON·max(1, |v|))`
  per printed value — the Task-4-notes formula; measured worst |diff|
  4.5e-15.
- Owner sign-off: MEGA parity compares branch lengths on the engine's own matrix at
  `len_tol = max(0.5·10^-d, 8·f64::EPSILON·max(1, |v|))` and topology only on MEGA's printed matrix
  (MEGA builds trees on its unrounded matrix); no JTT_MEGA model (option D), with Jtt's divergence
  from MEGA's JTT pinned by `jtt_diverges_from_mega`. Confirmed by owner 2026-10-28.
- **Follow-up for Task 13's guide:** "NeoPhylo's JTT follows PHYLIP; MEGA's
  JTT differs by up to ~0.18 on saturated pairs; use Poisson or p to match
  MEGA exactly."
- **Files outside the Files block:** `web/src/engine/generated/DistModel.ts`
  (regenerated by ts-rs, never hand-edited); `web/src/state/analysis.ts`
  (`DIST_LABEL` is a total `Record<DistModelName, _>` — the `Poisson`
  variant is a compile error without a label entry; menus in `CORRECTIONS`
  are untouched, that is Task 10); `web/src/editor/exerciseFile.ts`
  (`correctionName`'s exhaustive switch fails `tsc` without the `Poisson`
  arm — the minimal `never`-style exhaustiveness fix, mapping to its
  `DistModel::name()` wire string); `docs/roadmap.md`, the v1.4b spec and
  plan (the conditional model's mentions annotated with the owner decision —
  required so no `JttMega`/`JTT_MEGA`/`jtt_mega` string remains outside this
  file and the untouchable `fixtures/` notes);
  `docs/decisions.md` (this entry).
- Fixture notes updated in the stacked follow-up PR (fixture guard keeps
  `fixtures/` edits out of #117).

## v1.4b Task 5: .meg parser and writer

- **Plan correction — label mapping:** the plan said `write_meg` writes
  labels with spaces "with `_`, the same name mapping `phylip.rs`
  uses", but `phylip.rs` has no such mapping (its `NameMode` is a
  *read* rule: Strict pads/trims 10 chars, Relaxed splits at the first
  whitespace). `write_meg` therefore maps each whitespace character in
  a label to `_`, refuses two labels that collide after the mapping
  (`a b` vs `a_b`), empty labels and labels containing `"` (which would
  open a comment on re-parse). `parse_meg` keeps names literally, never
  mapping `_` back to a space, so the writer→parser identity holds only
  for labels without whitespace — stated as such in
  `tests/meg_props.rs` and the `meg` fuzz target.
- **Same-line sequence data:** a `#name` line may carry sequence data
  after the name (MEGA's own manual writes `#Human   ACTGACTGAC`). The
  name runs from after `#` to the first whitespace; the tail goes
  through the same `data()` path as data lines, with `col_base` set so
  error columns point at the right column of the line.
- **Files outside the Files block:** `web/src/engine/generated/MegFile.ts`
  (ts-rs output, committed as produced, never hand-edited);
  `crates/neophylo-core/fuzz/seeds/meg/*` (seed copies of
  `tests/meg_inputs`, following the existing `fuzz/seeds/<target>/`
  layout); `scripts/ci/fuzz.sh` (the `meg` target added to the nightly
  fuzz loop, fix round on #119); `docs/decisions.md` (this entry).
- **Fix round (#119):** `!Format` pairs tolerate whitespace around `=`
  (`DataType = Distance` is refused as a matrix file rather than
  falling through to sequence parsing; a trailing `key=` absorbs only
  a bare value, never the next `k=v` pair).
- **Fuzz:** the `meg` target was run by the conductor outside the
  sandbox (wasm/sandbox limits): 60 s, 2.52M runs, no crash.

## v1.4b Task 6: exercise schema 4 (analysis.site_filter, "Poisson")

- **What:** `CURRENT_SCHEMA_VERSION` is now 4 and `load_exercise`
  accepts 1–4. `Analysis` gains `site_filter: Option<SiteFilter>`
  (`serde default` + `skip_serializing_if`, `#[ts(optional)]`) — `None`
  means `Pairwise`, so v2/v3 exercises load and serialize unchanged.
  `AnalysisFile` reads the file's `site_filter` as
  `Option<Option<serde_json::Value>>` through the existing `present`
  helper (the serde null/array gap, learned on v1.4 Task 6 #92): an
  explicit `"site_filter": null` is refused at `analysis.site_filter`
  (never read as absent) and in a v2/v3 file — where presence alone
  trips the gate — refused with "requires schema_version 4", matching
  schema.json's `not: { required: ["site_filter"] }` on the same
  versions. `site_filter_file` validates the object by hand so each bad
  piece names its own path: non-object → `analysis.site_filter`;
  unknown/missing/non-string `kind` → `analysis.site_filter.kind`;
  `cutoff_pct` must be a JSON integer 0–100 — `u8` would accept
  101–255, `f64` a fraction, so `as_u64` + range check refuses 101, −1,
  2.5, `"95"`, `null` and `[]` at `analysis.site_filter.cutoff_pct`;
  `partial` without it and `cutoff_pct` on `pairwise`/`complete` are
  refused there too. `"Poisson"` maps to the existing
  `DistModel::Poisson` (no MEGA-JTT identifier — #117), gated to
  schema_version 4 at `analysis.correction`, and on DNA it gives the
  same `ModelAlphabetMismatch` `"Kimura"`/`"JTT"` get today (their
  behavior is unchanged).
- **Normalization decision (per conductor note, documented here):** a
  file that writes `{ "kind": "pairwise" }` explicitly keeps
  `Some(SiteFilter::Pairwise)` so the file round-trips; `None` and
  `Some(Pairwise)` analyse identically —
  `absent_and_explicit_pairwise_analyse_identically` asserts both run
  `compute` bit-for-bit through `unwrap_or_default()` +
  `compute_filtered`.
- **schema.json:** `schema_version` enum `[2, 3, 4]`; correction enum
  gains `"Poisson"`; new `siteFilter`/`cutoffForPartial` defs
  (`cutoff_pct` integer 0–100, required only for `partial`, forbidden
  otherwise — null and array values fail `type: object`/`integer`); a
  `v4Identifiers` gate refuses `site_filter` (any value, null included)
  and `"Poisson"` under schema_version 2–3. ajv and `loadExercise`
  agree on every `v4-*`/`v3-bad-*` fixture except Poisson-on-DNA,
  documented as a semantic-only check like the F84 sum-to-1 rule.
- **Existing tests:** all pass unmodified except TWO conductor-approved
  edits in `tests/exercise_v3.rs` — `current_schema_version_is_3` →
  `current_schema_version_is_4` (asserts 4) and
  `unknown_schema_version_reports_all_three` →
  `unknown_schema_version_reports_all_four` (writes version 5, asserts
  "schema_version must be 1, 2, 3 or 4, got 5"). Version-boundary
  assertions updated for v4, conductor-approved; no tolerance or
  premise changed. No `schema_version` was bumped in any existing
  exercise or lab file; `web/src/editor/exerciseFile.ts` (the editor's
  own CURRENT_SCHEMA_VERSION = 3) is untouched — its v4 fields are
  later tasks.
- **Files outside the Files block:** `crates/neophylo-core/tests/
  exercise_v3.rs` (the two approved edits above);
  `web/src/engine/generated/{Analysis,Exercise}.ts` (ts-rs output
  regenerated by `cargo test … export_bindings`, committed as
  produced, never hand-edited); `web/src/lessons/schema_v4.test.ts`
  and `web/src/lessons/__fixtures__/{v3-bad-site-filter,
  v3-bad-site-filter-null, v3-bad-poisson, v4-*}.json` (the
  schema/engine agreement test the conductor note requires, modeled on
  `schema_v3.test.ts`; no new bindings — it uses the existing
  `engine.loadExercise`); `docs/decisions.md` (this entry).
- **Known gaps, deferred (conductor ruling):**
  - `web/src/state/lesson.ts` `correctionValidFor` does not know
    `"Poisson"` (not in `CORRECTIONS.protein`), so `reconcileModels`
    rewrites a v4 exercise's `Poisson` correction to `Jtt` on
    load/sandbox/alphabet switch. Deferred to Task 10 (model menu adds
    Poisson; the v1.4 F84 equivalent was fixed in Task 10). Task 10 must
    pin a test that a loaded Poisson protein exercise keeps `Poisson`.
  - The editor (`web/src/editor/draft.ts` `PreservedFields` /
    `exerciseToDraft`, `exerciseFile.ts` writing schema_version 3) drops
    `analysis.site_filter` when a v4 file is imported and saved.
    Deferred to Task 11 (editor model/filter options), which must carry
    `site_filter` through import→save and write schema_version 4 when
    used.
  Neither is reachable in production before the v1.4b release tag; no
  repository exercise uses them.

## Task 8 (v1.4b) data library

- **MAFFT version resolved:** pinned at **7.525** (`--auto`), matching the
  v1.1 task-12 cytochrome-c alignment build; `build_library.py` refuses
  any other `mafft --version`.
- **Accession-line format extended** beyond the plan's
  `<accession> <display label>`: an optional third `slice` field —
  `<start>-<end>` (1-based inclusive genomic range, efetch
  `seq_start`/`seq_stop`) or `gene:<name>:<a>-<b>` (codons a..b of the
  CDS annotated `/gene="<name>"`). Needed because the records the spec
  asks for exceed the 2,000-site cap: primate-mtdna slices the Horai
  (1995) complete genomes to their annotated D-loop/control-region
  feature, and sars-cov-2-spike slices codon-anchored spike residues
  319–541 (the RBD), which absorbs the NTD indels that shift absolute
  genome coordinates between variants.
- **primate-mtdna region:** MEGA's `mtCDNA.meg` is the whole ~16.5 kb
  hominoid mtDNA alignment — over the cap — so the dataset is the
  control region (the segment the classic hominoid studies used), from
  the same public accessions.
- **sars-cov-2-spike region:** the whole spike CDS (~3,822 nt) is over
  the cap, so the dataset is the receptor-binding domain (S residues
  319–541, 669 nt unaligned / 690 aligned).
- **Provenance JSON adds `id` and `title`** to the spec's listed keys
  (the schema `oneOf` still pins `aligner` xor `published_alignment`).
- **`web/public/licenses.html` is generated** at build time from
  `THIRD_PARTY_NOTICES.md` and is gitignored (`web/scripts/licenses.ts`),
  so the Files-block "modify licenses.html" is satisfied by the
  notices-file edit alone.
- **Files outside the Files block:** `docs/decisions.md` (this entry —
  the workflow requires decisions in the same PR).
- **rights_check (2026-10-29):** all 50 NCBI records in
  `scripts/data/accessions/{16s-rrna,primate-mtdna,sars-cov-2-spike}.txt`
  were re-fetched as full GenBank flat files (efetch `rettype=gb`,
  `tool=neophylo-build`) and searched case-insensitively — COMMENT,
  REFERENCE/JOURNAL/REMARK, KEYWORDS, DBLINK and FEATURES notes — for
  rights language (copyright, ©, patent, "all rights", license/licence,
  "intellectual property", restricted, "not for", permission,
  "terms of use", "data use", embargo) and patent-sequence markers
  (JOURNAL "Patent:", KEYWORDS "patent", division PAT). No rights
  statements found: no record matched any term, all divisions are
  BCT/PRI/VRL, and the only adjacent text is X97707's standard DDBJ
  courtesy note asking users to cite the entry — a citation request,
  not a use restriction.

## Task 9 (v1.4b) MEGA fixtures on library datasets, bootstrap, .meg round trip

- **Bootstrap `.mao` serialization (MEGA 12):** the `njboot_*` files are
  derived from the GUI-serialized `nj_*` files, keeping key names and
  order, with the `Phylogeny Test` block replaced by
  `Test of Phylogeny = Bootstrap method`,
  `Approach = Standard Bootstrap (slow)`,
  `Bootstrap Replicates = 100`. MEGA 12 binds `Bootstrap Replicates`;
  the older `No. of Bootstrap Replications` key is echoed but ignored
  (the run dies at "tree display setup" with `Bootstrap Rep #: 0/-1`).
  Proof that the files take effect, before the fixtures were trusted:
  support values appear on the original tree, 10 vs 100 replicates give
  different granularity, and `No. of Sites` follows the gap treatment.
  Full evidence in `fixtures/worked/mega-notes.md`.
- **Support source:** taken from MEGA's ORIGINAL NJ tree (`<out>.nwk`
  BCL labels, proportions like `0.9800`), never the `_consensus.nwk`
  view; every split is cross-checked against the `-pfc 0.0` partition
  list (exact percent match required by the generator).
- **Poisson bootstrap added to globins** (beyond the plan's JTT): MEGA's
  JTT is not our `Jtt` (#117), so JTT support is not a parity target;
  `Poisson` is the protein bootstrap oracle. `nj/Poisson/{pairwise,
  complete}` fixtures are generated alongside the plan's `nj/JTT/*`.
- **Split keys:** canonical side = the side NOT containing the dataset's
  first label, sorted labels joined by `|` (same rule as
  `fixtures/consensus/`); documented in `fixtures/mega/README.md`.
- **Bootstrap blocks are not byte-reproducible** (megacc has no seed
  option; two runs differ). The generator never compares them on rerun;
  said so in the README.
- **Library data referenced, not copied:** `"input"` is
  `../web/public/library/<id>.fasta`, resolved relative to `fixtures/`
  like the existing `"inputs/<file>"` convention (this is what
  `parity_mega.rs`'s `load_alignment` expects).
- **Files outside the Files block:** `fixtures/tools/write_meg/` (new
  standalone crate — the plan's `cargo run --example write_meg` would
  touch `crates/` and fail the CI fixture guard, which forbids fixture
  and code changes in one PR; it is its own crate with an empty
  `[workspace]`, a path dependency on `crates/neophylo-core` and a copy
  of the root `Cargo.lock`, and calls only
  `neophylo_core::{parse_fasta, write_meg}`);
  `fixtures/mega/mao/njboot_*.mao` (six new bootstrap .mao files the
  bootstrap fixtures need); `fixtures/worked/mega-notes.md` (the task's
  own evidence record — serialization findings, output formats, no seed
  option, underscored-name printing); `docs/decisions.md` (this entry).

## v1.4b Task 9: owner ruling on #126 (option A) — MEGA bootstrap fixtures at 1,000 replicates

- **Ruling:** on #126 the owner chose option A — the Step 3 MEGA
  bootstrap parity test compares against MEGA-CC results at **1,000
  replicates** under the unchanged v1.2 §8.3 5-point rule. This PR is
  part (a): fixtures only. `parity_mega_library.rs` follows in a later
  code PR (the CI fixture guard forbids mixing fixtures and code).
- **No existing fixture changed.** `fixtures/mega/library/*.json`
  (their 100-replicate bootstrap blocks stay as the handout values),
  `fixtures/mega/roundtrip/` and `fixtures/mega/*.json` are
  byte-identical. Because megacc's bootstrap is unseeded, a full
  generator rerun would rewrite the 100-replicate blocks, so
  `generate_mega.sh` gained a `--boot1000-only` flag that runs only the
  new phase (documented in its header).
- **New files:** `fixtures/mega/mao/njboot1000_*.mao` (six files,
  identical to `njboot_*` except `Bootstrap Replicates = 1000`) and
  `fixtures/mega/library/boot1000/{primate-mtdna,16s-rrna,globins}.json`
  (`generator`/`input`/`alphabet`/`bootstrap` only; same runs and
  canonical split keys as the 100-replicate blocks, support at the
  0.1-percent granularity 1,000 replicates give).
- **Generator assertions for the new phase:** settings echo,
  `No. of Sites`, `No_of_bootstrap_reps=1000` in the partition file,
  every tree split within 1 pp of its integer-printed partition
  frequency, at least one non-integer percent per run (proof the count
  took effect), and the split set equal to the 100-replicate block's
  (same deterministic original NJ tree).
- **Run-to-run check:** the original NJ tree is reproducible. The
  conductor ran `16s-rrna`/`nj/K80/complete` 15 times on megacc 12.1.4
  (4 plain NJ, 4 bootstrap at 100 replicates, 5 at 1,000 replicates,
  plus the committed runs) and the split set equaled the committed one
  every time; across the five 1,000-replicate reruns the largest
  per-split support difference from the committed values was 2.2–6.1 pp
  per run (binomial noise of two 1,000-replicate samples, ~2.2 pp SD
  at 50%). Recorded in `fixtures/worked/mega-notes.md` together with
  the globins ties.
- **Files outside the Files block:** `docs/decisions.md` (this entry —
  the workflow requires decisions in the same PR).

## v1.4b Task 9 Step 3: MEGA library parity test (owner ruling on #126, option A — implementation)

- **Bootstrap at 1,000 replicates:** `bootstrap_support_within_sampling_noise`
  compares `fixtures/mega/library/boot1000/<id>.json` under the unchanged
  5-pp rule (v1.2 spec §8.3), our side at 1,000 replicates from the fixed
  seed 1 — never another seed, bound or count. The 100-replicate
  `bootstrap` blocks in `library/*.json` stay the handout values: only
  their split sets are asserted (equal to our NJ splits), never their
  support numbers.
- **Identical-sequence exclusions are computed, never listed:** a split
  is excluded iff one side is a set of ≥ 2 taxa all pairwise identical
  over the sites the run's filter keeps. `Chimp_HBB|Human_HBB`
  (globins, under both filters) is the only exclusion — it differs by
  ~33–35 pp because with two identical sequences the cherry's replicate
  support is a tie-break artifact; `identical_sequence_exclusions_are_exactly`
  pins the set.
- **UPGMA is tie-aware only where a tie exists:** the exact comparison
  runs first; only on failure is MEGA's tree replayed on the engine's
  full-precision matrix — every merge must be a minimum-distance pair
  under exact `==` on the engine's f64 values, every cluster height
  half that distance within `len_tol`, and the replay must see at least
  one step with more than one minimal pair. It engages for exactly the
  six `globins upgma/{p,Poisson}/{pairwise,complete,partial95}` keys
  (`upgma_tie_resolutions_are_exactly`). NJ stays exact everywhere.
- **Files outside the Files block:** `docs/decisions.md` (this entry)
  and `docs/conductor/notes/v1.4b/task13.md` (the handout-2 warning the
  owner ruling requires).

## v1.4b Task 10: Web state and sandbox controls (gap treatment, new models, URL fields)

- **`CORRECTIONS` holds the full list; the lesson menu filters.** The
  plan asks for the v1.4b models in `CORRECTIONS` (appended at the end
  so the first-non-`P` default and menu order are unchanged) but for
  built-in lessons to hide them. Controls gets a `sandbox` flag: the
  sandbox menu is the full list; a lesson's menu drops
  `SANDBOX_MODELS` (F84, K2P_PHYLIP, Poisson) and still shows them as
  the conditional option when the exercise prescribes one — same
  mechanism as v1.4's F84 display.
- **`K2P_PHYLIP` κ rides in `analysis.kappa` and the enum.** Selecting
  it in the sandbox dispatches
  `{ correction: { K2pPhylip: { ratio: κ } }, kappa: κ }` so the file
  semantics ("always Some then") hold in state, links and exports;
  the κ field refuses ≤ 0, non-finite and empty input with a message
  and keeps the last valid value.
- **`NumberField` gained `errorMessage`** for the κ field only —
  refused input shows the message and the last valid value stays. The
  cutoff field does NOT share `NumberField`: `GapControl` keeps its
  own inline input with the same local-text-copy pattern (a prop
  change re-syncs it, an out-of-range or non-integer value is
  refused with "Enter a whole number from 0 to 100."). The `integer`
  prop added for it was never passed — removed as dead code (fix
  round 2).
- **Gap control and removed-column markup read the same engine mask:**
  `engine.siteMask(alignment, filter)` in App, memoized; a filter
  error counts every column as removed. `bootstrapClient.start`/
  `.detail` and the sync replicate detail all take
  `analysis.site_filter`; absent is pairwise — bit-identical calls.
- **`o=`/`#x=` overrides validate `site_filter` and κ** — an invalid
  value is a restore error with a reason, matching the `d=` rule.
- **Files outside the Files block:** `web/src/state/session.ts`
  (+3 re-export lines — `SANDBOX_MODELS`, `siteFilterName`,
  `CorrectionMenuName` — so callers keep importing from `state/session`);
  `web/src/views/App.tsx` (passes
  `analysis.site_filter` to `bootstrapClient.start`/`.detail`, calls
  `engine.replicateDetailFiltered`, computes the shared `siteMask` and
  renders `GapControl` only in sandbox — conductor note 4);
  `web/src/state/lesson.ts` (`correctionValidFor` simplified now that
  Poisson/F84 are list members — fixes the Task 6 deferred
  Poisson-rewrite bug; conductor note);
  `web/src/views/App.bootstrap.test.tsx` (the named pins that the
  sandbox bootstrap gets the filter and that a complete-deletion run's
  original tree equals the shown tree; no other file can reach the
  App wiring); `web/src/index.css` (`.gap-control`, `.field-error`,
  `.pair-col.removed` hatch, `.pair-removed-note`, coarse-pointer
  40×40 floors — only token values used);
  `web/src/state/__fixtures__/v3-urls.json` is in the Files block but
  was generated by a throwaway capture test (deleted after the run),
  matching the v1/v2 capture workflow;
  `web/src/views/ImportPanel.tsx` and `web/src/views/ImportPanel.test.tsx`
  (fix round 2 review: the hint under the import box claimed pairwise
  behavior under every treatment — it now follows the active site
  filter via `siteFilterName`, pinned by a named test per kind; and
  the panel's error line puts the title's period inside the bold like
  the bootstrap/replicate panels do, so NoSitesKept's title and body
  no longer run together).
- **Owner decision (2026-10-30): pair-panel numbers follow the gap
  treatment (option A, in this PR).** Previously the pair panel marked
  removed columns ∅ but its p, Kimura, JTT, counts and likelihood
  curve came from `jtt_pair_detail` over all columns while the matrix
  cell used `distances_filtered`. The engine gains
  `jtt_pair_detail_filtered(aln, i, j, filter)` (shared
  `pair_detail_from_counts` assembly; unfiltered error order then the
  filter's own errors then `InsufficientOverlap`; `Pairwise`
  bit-identical, pinned with `to_bits`), the matching wasm export and
  `jttPairDetailFiltered` TS wrapper, and `App.tsx` passes
  `analysis.site_filter` (absent → pairwise). `TeachingNotices`'s
  saturation-chart p-points use `distancesFiltered` with the same
  filter. The panel's non-comparable dimming and "comparable sites"
  math line now mean kept-comparable sites (removed columns keep the
  ∅ marker); pinned by App-driven tests in `PairPanel.test.tsx` and
  `TeachingNotices.test.tsx`. **Files outside the Files block:**
  `crates/neophylo-core/src/protein_dist.rs` and `src/lib.rs` (the new
  core function and its root export — the Files block covers only
  `web/`; the science must live in Rust), `crates/neophylo-wasm/
  src/lib.rs` (the boundary export, no logic),
  `crates/neophylo-core/tests/pair_detail_filtered.rs` (new test file;
  the plan's Test list names only `web/` files and the rule "don't
  edit existing test files" rules out `tests/protein_dist.rs`),
  `web/src/engine/index.ts` and `web/src/engine/index.test.ts` (the
  `jttPairDetailFiltered` wrapper and its test, next to
  `jttPairDetail`), `web/src/views/TeachingNotices.tsx` and
  `TeachingNotices.test.tsx` (the chart p-points and their pin —
  `chartPoints` belongs to this file, not `analysis.ts`), and
  `web/src/engine/pkg` (regenerated by `scripts/build-wasm.sh`;
  `web/src/engine/generated/` regenerated by the project generator
  shows no diff — `PairDetail` and `SiteFilter` already existed).
- **Owner decision (2026-10-30): initial-JS budget unchanged;
  lazy-load `ReplicatePanel` (v1.3 Task 14 precedent); new v1.4b
  sheets (DatasetSheet, MegaHelp) are lazy from the start.** The Task
  10 additions pushed initial JS to 121,283 B gz against the 120,168 B
  budget. `ReplicatePanel` now loads via `React.lazy` + `Suspense` in
  `App.tsx` exactly like `PhylipHelp` (fetched on first open; the SW
  `**/*.js` precache keeps it offline after first load; the only test
  change is awaiting the panel's first paint). Result: initial JS
  119,963 B gz (`index` 118,482 + `rolldown-runtime` 541 + `tokens`
  940) vs the 120,168 B limit; the new `ReplicatePanel` chunk is
  4,044 B raw / 1,708 B gz and sits in the precache manifest.
  (`web/src/views/ReplicatePanel.test.tsx` is outside the Files block:
  one `getByRole` → `findByRole` so the test awaits the lazy chunk's
  first paint — awaiting only, no assertion changed.) The
  1024×768 `replicate-panel` snapshot shot on this branch is
  byte-identical to the same scene on the base commit, so the panel's
  pixels are unchanged; local baseline diffs in that scene trace to
  system-fallback glyphs (`◀ ▶ ≈ ✕` are outside the bundled latin
  subsets) and appear identically on the base commit — CI's visual
  job is authoritative.
- **`gaps.spec.ts` fixes discovered on first e2e run** (the previous
  gate died at the bundle-size check before e2e ever ran): the matrix
  comparison reads each SVG cell's `aria-label` like `minCell` does —
  `innerText` is empty on a `<g>`; the coarse-pointer test opens the
  Settings drawer because the controls live there below 1024 px; and
  the partial-95 assertion now encodes the real semantics — with 8
  taxa one missing character is 87.5 % coverage, so partial 95 and
  complete remove the same 135 columns and the matrices coincide
  (asserted equal), while cutoff 80 keeps the one-missing columns and
  removes only 21. `web/e2e/gaps.spec.ts` is a Files-block test file,
  so no entry was strictly required, but the changed assertions are
  recorded here for the reviewer.
- Baselines regenerated (owner-approved 2026-10-30): four-taxa and weak-support at 1920×1080, both themes. The sandbox controls column gains the gap control; no other baseline changed. Pinned playwright v1.64.1-noble image, targeted --grep.
- **Wrap, don't shrink (replaces the min-width fix from c4f9ea8):**
  the controls-column clip was never sandbox-only — on main the
  "Correction" select laid out at its widest option
  ("K2P (dnadist, κ = 2.0)") and its box ran past the 230 px column
  edge (right edge ~271 px, ~41 px over) clipping its dropdown arrow,
  and the same overflow clipped menus in the 1920×1080 lesson/editor
  frames. Shrinking the control (`min-width: 0`, the c4f9ea8 fix) kept
  the arrow inside but ellipsized the selected text
  ("Neighbor-Joinin") — the same class of bug one layer down, caught
  by the new truncation check. `index.css` now sets
  `flex-wrap: wrap` on `.controls .field`: a control too wide for the
  space next to its label wraps onto its own line at natural width,
  while `max-width: 100%` still caps anything wider than the column
  itself (the `.newick-name-mode` select keeps its deliberate clamp —
  its longest option exceeds the column by design). `gaps.spec.ts`
  gains a second check inside the same named test: every
  `.controls select` must keep its natural (clone-measured) width, not
  just stay inside the column — it fails on c4f9ea8's shrunk menus and
  passes on this fix. **16 baselines regenerated, owner-approved
  2026-10-30** (pinned `playwright:v1.64.1-noble` image, targeted
  `--grep`):
  `four-taxa-1920x1080-{dark,light}`,
  `weak-support-1920x1080-{dark,light}`,
  `cytc-rooted-1920x1080-{dark,light}`,
  `cytc-computed-1920x1080-{dark,light}`,
  `replicate-panel-1920x1080-{dark,light}`,
  `bootstrap-basics-final-1920x1080-{dark,light}`,
  `editor-preview-1920x1080-{dark,light}`,
  `editor-preview-1280x800-{dark,light}`. The other 73 scene/viewports
  re-rendered byte-identical or within the image's run-to-run AA noise
  (~0–50 px scattered in headers/footers — the same signature
  reproduces at HEAD without this change and between two same-code
  runs), so their baselines are untouched; the full visual project
  passes 89/89 without updating.
- Pre-existing `LikelihoodCurve` tick-label clip fixed in this PR at
  the owner's request (2026-10-31): the y-tick labels were
  right-aligned at x = 33 against `PAD_L = 36`, so "-852.721" (48.5
  units of ink) ran ~15.5 units off the svg's left edge and rendered
  as "52.721"; the left pad is now sized from the label strings (8
  units/char bound at the pinned 12 px axis font → padL = 64 for this
  pair, leaving the label ~12.5 units inside the edge), and the
  `log L(d)` title and `d̂` label baselines move inside the top edge
  (they clipped ~3.5 units there). `LikelihoodCurve.test.tsx`
  unchanged — no assertion depended on the old padding.

## Post-v1.4b-Task-10 follow-ups (owner request 2026-11-01)

- **`d̂` peak label no longer uses U+0302:** "d̂ = x.xxx" put the
  combining circumflex on the `d`'s upright stroke and read as "â".
  The text is now `d = x.xxx` and the hat is a small filled-wedge
  `path.axis-label` centred over the d's bowl above the ascender
  (the only path carrying the axis-label class; the e2e checks it
  sits inside the d glyph's box and above it). The aria-label and
  the `toFixed(3)` format are unchanged.
- **`d` axis title moved off the axis's right end:** it sat at
  (W − PAD_R, axisY − 3), where pair 2–3's curve ends inside its
  box. It now sits centred in the bottom tick row (`axisLabel(W / 2,
  H - 8, "d", "middle")`), clear of the `0` and right-edge tick
  labels; a chromium test maps every `polyline.curve` vertex through
  the svg's screen CTM and requires none inside the label's box
  grown by 2 px.
- **LikelihoodCurve DOM consolidated to fit the initial-JS budget**
  (120,168 gz; main was 120,154): the hat had to share bytes, so the
  x-axis and its two tick lines are one `path.axis`, the below-range
  markers are one `path.below-range-mark` (class `below-range` kept
  for the tests), the peak group is a fragment with `data-peak` on
  the `peak-line`, and `TITLE_Y`/`LABEL_STYLE`/`yOk`/`xMax` were
  inlined or tightened. No visual change; the y-axis stays a
  `line.axis` because `LikelihoodCurve.test.tsx` locates it.
- **Share-link limit resolved to 32,000** — see the dated line under
  the v1.4 Task 7 "Owner decision pending" entry above.
- **Review polish (fix round 1, 2026-11-01):** outside the original
  Files block — `web/src/views/editor/EditorPanel.tsx` now formats the
  limit as `SHARE_LINK_MAX_LENGTH.toLocaleString("en-US")` so the
  notice reads "32,000"; the two `editor.spec.ts` regexes use
  `[\d,]+`, and `exerciseFile.test.ts` asserts the exercise glob is
  non-empty (≥9 files) before the loop. Initial JS 120,164 B
  (+1 B: the entry chunk embeds the lazy EditorPage chunk's content
  hash); budget unchanged.
- **Fix round 2 (owner request 2026-11-02):** two LikelihoodCurve
  label collisions, both in `web/src/views/LikelihoodCurve.tsx`.
  (A) A peak at the top of the window put the `d = …` label's
  baseline (peak.py − 8 ≈ 18) and hat on the `log L(d)` title's row,
  and with padL = 36 + d̂ ≈ 0 the left clamp (padL + 9 = 45) started
  the label inside the title's ink (≈ x 48). The clamp gains a fixed
  floor `2 + CHAR_W * "log L(d)".length + 4` = 70 — the title
  measures 42.4 units in pinned chromium, so the CHAR_W bound covers
  Firefox too, and the right clamp still wins for wide estimates.
  (B) The bottom tick row (`0`, right-edge value, centred `d`)
  moved from baseline `H − 8` (132) to `H − 4` (136): the below-range
  markers span axisY + 1 … axisY + 5 (121–125) and the old baseline
  put digit ink at ≈ y 123, touching them; at 136 the ink stays
  ≥ 1 unit clear of the markers and inside the 140 edge. PAD_B, H
  and the marker geometry are unchanged. Tests first (fail on
  90017f8): `LikelihoodCurve.test.tsx` asserts the padL = 36
  scenario and the ≥ 70 floor, and that every bottom-row baseline
  − 10 clears axisY + 5 with the baseline ≤ H − 1. The `geometry`
  helper's y-axis lookup was extracted as `yAxisLine` (equivalent).
  Initial JS 120,161 B (−3 B); visual project 89/89 without
  baseline changes.

## Lazy PairPanel (owner request 2026-11-02)

- **Why:** initial JS sat at 120,161 B of the 120,168 B gz budget —
  7 B of headroom before v1.4b Task 11. `App.tsx` imported
  `PairPanel` eagerly, pulling `LikelihoodCurve`, `explain/pair` and
  `MathLine` into the entry chunk.
- **What:** `PairPanel` is now a `React.lazy` chunk on the
  `PhylipHelp` (v1.3 Task 14) / `ReplicatePanel` (v1.4b Task 10)
  precedent — fetched on first open, rendered under
  `<Suspense fallback={null}>` so Sheet's mount-time focus contract
  still runs when the chunk resolves; the SW `**/*.js` precache keeps
  it working offline. Props and open conditions unchanged; `MathLine`
  and `ModeToggle` stay in the entry chunk via `ExplanationPanel` /
  `BootstrapPanel` (left as-is).
- **Sizes:** initial JS 120,161 B (main) → 118,143 B; new
  `PairPanel-*.js` chunk 2,542 B gz (6.05 kB raw), not modulepreloaded
  from `index.html`.
- **Tests adjusted:** none — no unit test renders `App` and opens the
  pair panel, so nothing needed an `await`/`findBy` change;
  `PairPanel.test.tsx` untouched. Pinned-image chromium e2e covering
  the panel: pair-panel, gaps, tour, presenter, protein-lessons,
  sheets, theme, a11y (72/72) and bootstrap (9/9, incl. the offline SW
  test); visual 89/89 with no baseline changes.

## v1.4b Task 11: `.meg` import/export, dataset library, `ds=` links, editor options

- **Files outside the Files block:**
  - `web/src/export/meg.ts` (new) — the plan's `.meg` item needs a
    lazy export chunk on the `phylip.ts`/`rscript.ts` precedent
    (conductor note 3 keeps the writer out of the initial bundle);
    the Files block named no export module.
  - `web/src/state/actions.ts`, `web/src/state/analysis.ts`,
    `web/src/state/lesson.ts`, `web/src/state/session.ts` — the `ds=`
    link needs to know the alignment is an unmodified library file:
    the `importDataset` action and the `libraryDataset` /
    `alignmentName` session fields (cleared by every data-changing
    action, so links fall back to `d=`). `alignmentName` also feeds
    the `.meg` `!Title` (the "dataset or file name" the interface
    line requires — file imports pass the picked file's name).
  - `web/src/views/App.tsx` — the sheet mounts at shell level as a
    `React.lazy` chunk (the conductor's initial-JS note) with the
    unsaved-work confirm flag, the `importDataset` dispatch, the
    `ds=` toast detail and the `.meg` title prop.
  - `web/src/editor/draft.ts` + `draft.test.ts`,
    `web/src/editor/exerciseFile.ts` + `exerciseFile.test.ts` — the
    deferred Task-6 hole (conductor note 7): `site_filter` and
    `Poisson` now round-trip import → save, and `schema_version` is 4
    exactly when a v4 field is used.
  - `web/e2e/visualScenes.ts` (the block names `visual.spec.ts`) —
    the scene registry lives in this separate module; the three new
    scenes land where every other scene is defined.
  - `web/src/index.css` — the sheet's row/link styles and the
    ≥ 40×40 coarse-pointer rules for rows, buttons and the
    provenance `<a>` (conductor note 8); `visual.spec.ts` untouched.
  - `web/e2e/a11y.spec.ts` — Step 1 explicitly says "extend
    `web/e2e/a11y.spec.ts`".
- **Provenance "source" column:** `index.json` carries no `source`
  field, so the sheet reads each dataset's `<id>.json` (same origin)
  via `loadProvenance` (conductor note 2, option a).
- **Unsaved-work predicate:** "unsaved sandbox work" =
  `hasImportedData(session)` — the same condition the sandbox→lesson
  `window.confirm` uses; declining keeps alignment, model and filter
  exactly (the confirm only gates the dispatch).
- **`ds=` + `o=`:** analysis overrides are re-applied after the
  dataset lands — the resolve-time merge could otherwise reconcile
  e.g. `Poisson` back to the default lesson's DNA alphabet before the
  protein file arrives (pinned test). Sim overrides stay
  exercise-level; a dataset never re-simulates.
- **`.meg` title order:** `session.alignmentName` (file name, dataset
  title or sample name) → `session.exercise.title` → `"neophylo"`.
- **Matrix-file refusal as notice:** `parseMeg`'s Parse error
  `distance-matrix .meg files are not supported yet (planned for
  v1.4c)` is a recognized format, not malformed input, so it renders
  in the notice area instead of the error line.
- 22 existing `editor-*` baselines regenerated for the required Gap
  treatment row in the editor settings (owner chose option A on
  #133); no other baseline changed.

## v1.4b Task 12: MEGA labs framework, "Coming from MEGA?", Guides menu

- **Files outside the Files block:**
  - `web/src/views/App.tsx` — MegaHelp is a `React.lazy` chunk on the
    PhylipHelp precedent (initial-JS budget); the open guide lives in
    one `guide` state so the cross-links swap sheets.
  - `web/src/views/SettingsDrawer.tsx` — the owner's "Labs" rename
    covers the drawer's 1024–1279 lab link (owner decision
    2026-11-02: "Guides" menu, "Labs" rename, re-baselined 1920/1024
    header frames).
  - `web/src/views/editor/EditorPanel.tsx` — the editor's lab-picker
    button, sheet title and close label renamed "Labs"; the sheet now
    lists both families.
  - `web/src/index.css` — `.guides-menu` styles reusing the
    More-menu pattern, the link-styled `.guide-link` cross-link
    button, and ≥40×40 coarse-pointer floors for the guide sheets'
    plain links (not covered by the generic rule).
  - `web/src/labs/__fixtures__/*.json` (13 new) — the fixture MEGA lab
    plus the refusal pins (`tool` null/array, `mega_note_md`
    null/array, `mega_menu`/`mega_setting` null/array, MEGA `chain`
    item null/array, phylip lab missing `phylip_note_md`); fixture
    labs join only under the e2e flag, per conductor note 2. The
    `mega_setting` and `mega_note_md`-array/chain-item pins are fix
    round 1 — the plan's Global Constraints want a null and an array
    pin on every new key.
  - `web/src/labs/labs.test.tsx`,
    `web/src/views/{Header,MoreMenu,PhylipHelp,Tour,Wordmark}.test.tsx`,
    `web/e2e/{labs,sheets,perf-load,a11y}.spec.ts` — new coverage and
    the name/path updates the owner's header decision requires;
    no assertion removed or weakened.
  - `web/e2e/__screenshots__/` — regenerated the header-bearing
    1920×1080/1024×768 frames (owner-approved re-baselining,
    2026-11-02) plus, beyond the enumerated set: every `editor-*`
    frame (the lab-picker button is a navigation entry the rename
    covers — it opens a sheet that lists MEGA labs) and
    `editor-preview-1280x800` (the popup shows the app header at the
    wide breakpoint). `bootstrap-basics-final-presenter-1920x1080`
    regenerated: presenter mode hides only the Settings button and
    controls column, not the header, so the Guides menu is visible
    there. No `lab-*-print` frame changed.
  - `docs/conductor/notes/v1.4b/task13.md` — the owner-deferred Task
    13 time-estimate note (fix round 2).
- **`GuidesMenu` lives in `MoreMenu.tsx`:** the Files block already
  names that file; it shares a parameterized `MenuButton` with
  `MoreMenu` so the menu-button contract (keyboard, Escape, focus
  return, `role="menu"`) is literally the same code, not a copy —
  and the initial-JS cost stays small (budget 120,168 B gz;
  measured 120,073 B after fix round 1).
- **Lab index "time estimates":** spec §7.3 lists them but the lab
  schema carries no time field and the three shipped packs may not be
  edited this task — the index shows the existing card content
  (objectives, settings, chain) grouped by tool. The owner deferred it
  to Task 13 handout 1 (an optional `minutes` field on the lab block;
  see the Task 13 conductor note).
- **MEGA lab note/table text:** heading is exactly "What MEGA shows
  you vs what NeoPhylo shows you"; columns "Option", "MEGA menu",
  "MEGA setting", "NeoPhylo". PHYLIP labs render the same DOM as
  before (existing assertions unmodified).
- **MegaHelp numbers:** names only what the parity tests pin — p,
  JC69, K80 and Poisson distances under all three gap treatments;
  JTT is validated against PHYLIP's protdist, not MEGA (#117: no
  MEGA-JTT model ships); bootstrap agrees only within sampling noise
  (different RNGs; sites removed before resampling). No tolerance or
  decimal-count literals; support never called a probability.
- **More/Guides menu clip (fix round 1):** the open More list fell off
  the viewport's left edge below 1024 — a wrapped row puts the button
  on the left edge while `.more-menu-list { right: 0 }` right-aligned
  the list to it. Pre-existing on main (the conductor reproduced it
  there) but now the list is the only <1024 path to the MEGA guide.
  Fixed in CSS only: the header is the list's containing block where
  the header can wrap, so the list anchors to the header's content
  edge wherever the button sits; the Guides list gets the same
  treatment at 1024–1279 and in presenter mode. Pinned by a
  `sheets.spec.ts` bounding-box e2e at four viewports; no snapshot
  scene opens a menu, so no baseline changed.

## v1.4b ad-hoc: NJ concept line names Q (owner request 2026-11-03)

- **Why:** the generic Neighbor-Joining step line in the Concept
  panel said the joined pair "are the closest pair", which is false
  whenever NJ's Q picks a pair that is not the matrix minimum — on
  the MEGA handout-1 data the orangutans join first while the two
  chimpanzees are the closest pair.
- **Old → new:** "`{a}` and `{b}` are joined next: after accounting
  for how far each is from everything else, they are the closest
  pair." → "`{a}` and `{b}` are joined next: they have the lowest Q,
  their distance corrected for how far each sits from everything
  else." The tie lines, the final three-way join text and the UPGMA
  line (which really does join the closest pair) are unchanged.
- **Expectations:** `web/src/explain/concept.test.ts` updated to the
  new string verbatim; no e2e spec asserts the line (no "joined next"
  match in `web/e2e` — `lesson.spec.ts` only carries comments about
  the premise). Exercises that mention "the closest pair"
  (`nj-basics`, `upgma-fails`, the three PHYLIP lab reveals/handouts)
  all rely on the closest-pair-vs-Q distinction and are consistent
  with the new wording; none were edited.
- **Baselines regenerated (owner-approved for frames showing this
  line only):** `editor-preview-{1920x1080,1280x800}-{light,dark}`,
  `dataset-sheet-1920x1080-{light,dark}`,
  `gap-partial-1920x1080-{light,dark}` and
  `pair-panel-removed-1920x1080-{light,dark}` — 10 frames, all at
  ≥1280 px where the Concept panel is visible (below that it sits in
  the Settings drawer). Each failing diff was opened and confirmed to
  touch only the Concept panel's NJ line before regenerating; the
  full `visual` project then passed 107/107 in the pinned image.
- **Files outside the Files block:** this entry
  (`docs/decisions.md`).

## Lazy BootstrapPanel (owner request 2026-11-03)

- **Why:** on PR #136's head the initial JS sat at 120,160 B of the
  120,168 B gz budget — 8 B of headroom. `App.tsx` imported
  `BootstrapPanel` eagerly even though it first renders only when a
  run reaches its final step — it hosts the "Run bootstrap" button —
  so it is never in the first frame of any view.
- **What:** `BootstrapPanel` is now a `React.lazy` chunk on the
  `PhylipHelp` (v1.3 Task 14) / `ReplicatePanel` (v1.4b Task 10) /
  `PairPanel` (owner request 2026-11-02) precedent — fetched when a
  run reaches its final step, rendered under
  `<Suspense fallback={null}>` inside the `bootstrapPanel` prop.
  Props and the `atFinal && inferred !== null` condition unchanged;
  the SW `**/*.js` precache keeps it working offline after first
  load.
- **Candidates measured** (initial JS gz, main → lazy):
  `BootstrapPanel` 120,067 → 119,139 (saved 928 B; chunk
  `BootstrapPanel-*.js` 1,745 B gz, not modulepreloaded — a shared
  `engine-*.js` chunk it pulls into initial JS eats part of the
  entry-chunk saving); `ConsensusTabs` → 119,730 (saved 337 B);
  `Tour` → 119,200 (saved 867 B; eligible — `visual.spec.ts` seeds
  `neophylo.tourSeen`, so it never renders in a snapshot scene's
  first frame). `BootstrapPanel` won, so only it went lazy.
- **Tests adjusted:** three synchronous queries that are the first in
  their file to reach the panel now `await screen.findByRole` —
  `App.bootstrap.test.tsx` ("shows the panel only at the final
  stepper position": the "How sure are we?" heading),
  `ConsensusTabs.test.tsx` (`renderDoneRun` helper: the
  /Run bootstrap/ button), `ReplicatePanel.test.tsx` ("the
  Strict-consensus view does not feed the count": the
  /Run bootstrap/ button). Later `getByRole` calls in the same files
  stay synchronous because `React.lazy` resolves the chunk once per
  module registry. No assertion loosened or deleted.
- **Verification:** initial JS 120,067 B (main) → 119,139 B.
  Pinned-image chromium e2e reaching the panel: bootstrap,
  bootstrap-lesson, bootstrap-sequencing, perf-bootstrap, tour,
  presenter, sheets, a11y — 78/79, the one failure being
  perf-bootstrap's 30% ETA budget under 11-way worker contention
  (estimate inflated, not a code regression; it passed in isolation
  at 13.7% error). The offline SW tests (a11y, bootstrap) pass, so
  the precache covers the lazy chunk. `visual` 107/107, no baseline
  changed.
- **Fix round 2:** the `perf-load` export-writer spec now asserts the
  final step fetches exactly the `BootstrapPanel` chunk (and no
  writer), then counts writer chunks against a post-step snapshot —
  separating the final-step `BootstrapPanel` fetch from the
  export-writer count.

## v1.4b Task 13 (handout 1): MEGA lab "JC69 vs K2P" + `lab.minutes`

- **Files outside the Files block:**
  - `exercises/schema.json` — the owner-deferred §7.3 time-estimate
    field: optional `lab.minutes` (integer 5–180) on either lab tool
    (owner decision 2026-11-02, per-task note).
  - `web/src/labs/registry.ts`, `web/src/labs/registry.test.ts` —
    `minutes` on `LabBlock`/`LabSummary` and the refusal pins for
    `null`, `[]`, `2.5`, `4`, `181` and `"30"` (each naming `minutes`),
    matching every other lab key's pin set.
  - `web/src/labs/__fixtures__/mega-lab-*-minutes.json` (6 new) — the
    refusal fixtures those pins read.
  - `web/src/views/labs/LabIndex.tsx`, `web/src/views/labs/labs.css` —
    "About N min" on the index card when `minutes` is declared and no
    line when it is not; the lab page is untouched, so the printed
    handout (and every `lab-*-print` frame) does not change.
  - `web/src/labs/labs.test.tsx` — the card-estimate unit test and the
    shipped-listing updates (a MEGA lab now lists without the e2e
    flag, so the group's coming-soon line is gone).
  - `exercises/labs/{dnadist-neighbor,protdist-neighbor,seqboot-consense}.json`
    — content-only `minutes` additions on the shipped PHYLIP packs
    (25, 25, 40), the same estimate scale the per-task note asks the
    MEGA handouts to use; no other byte changed.
  - `web/e2e/labs.spec.ts`, `web/e2e/a11y.spec.ts` — the conductor
    note's Review Focus 5/7 coverage: the shipped handout lists under
    "MEGA labs" without the flag, "Load this lab" loads JC69 + NJ +
    pairwise into the sandbox and replays the fixture's printed
    JC69/pairwise row, the unsaved-work confirmation keeps a declined
    draft, the coarse-pointer ≥40×40 pass covers the handout page, and
    axe scans the real lab page.
  - `docs/decisions.md` — this entry.
- **Gap treatment:** the handout's runs use pairwise deletion —
  MEGA's own default and the treatment the cited `.mao` files declare.
- **Dataset wording:** `primate-mtdna` is the mitochondrial control
  region (D-loop) of the Horai (1995) accessions — the same public
  records as MEGA's example data, not that file's whole mtDNA
  alignment (over the library's site cap). The handout says so and
  routes the cross-check through a `.meg` export opened in MEGA; the
  `mtCDNA` token never appears (test-pinned).
- **Comparison tolerances:** the packs test reuses the
  `parity_mega_library.rs` rule verbatim — distances within 0.5 ulp of
  MEGA's 8-decimal print; NJ on MEGA's printed matrix is topology-only
  (the fixture trees were computed at full precision, so 8-decimal
  rounding propagates ~1e-9); NJ on the engine's own matrix is full
  parity, per-value `max(0.5·10^-d, 8·EPSILON·max(1,|v|))` lengths.
- **`minutes` values:** 30 for this handout (two distance runs + two
  NJ builds + questions at ~25 PHYLIP-pack scale plus the model
  switch); the owner judges the scale.

### Fix round 1 (review)

- **Files outside the Files block:**
  - `web/src/views/MatrixHeatmap.tsx` — the axis-label clipping fix:
    row and rotated column labels used to overflow a fixed 90 px band
    ("Pan_troglodytes" lost leading characters on the left, the last
    column's rotated "Hylobates_lar" ran off the viewBox's right
    edge). The bands are now reserved from the longest label's width
    using the layout code's 0.62em/char estimate (conservative for the
    bundled faces, so the bands only ever over-reserve — a
    DOM-measuring variant was dropped when it pushed the initial-JS
    bundle 191 B over the v1.3 budget; the estimate variant costs
    ~90 B). The shipped 90 px band stays the floor — margins grow
    only where a label's reserved extent overflows its old room, so
    every already-fitting label set keeps the exact old geometry and
    no visual baseline moves.
  - `web/e2e/matrix-labels.spec.ts` — the pin: on the shipped MEGA
    handout at 1920×1080, 1366×768 and 768×1024 every row-label and
    column-label bounding box must lie inside the heatmap svg's own
    rect and inside the viewport. Verified to fail without the fix.
- **Settings table:** the "nothing is left to a default" claim now
  holds — the NJ run's `.mao`-declared options (Analysis, Scope, the
  bootstrap count, Substitutions Type, Substitutions to Include,
  Rates among Sites, Pattern among Lineages) were added as rows in
  `.mao` order. A packs test now parses each `.mao`'s
  `[AnalysisSettings]` section and requires every non-administrative
  option (section separators and the execution-time cap excluded) to
  appear as a row of its own menu family — for both run families.

### Fix round 2 (owner request on #136)

- New visual scene `lab-mega-jc69-vs-k2p-print` (4 new baselines, spec
  §8 print view), added at the owner's request on #136; no existing
  baseline changed.

## v1.4b Task 13 (handout 2): MEGA lab "NJ vs UPGMA" on globins

- **Files outside the Files block:**
  - `web/src/labs/registry.test.ts` — the shipped-list pin gains
    `mega-nj-vs-upgma` (sorted between `mega-jc69-vs-k2p` and
    `protdist-neighbor`).
  - `web/src/labs/labs.test.tsx` — the shipped-listing UI test
    asserts the new card lists without the e2e flag.
  - `web/e2e/labs.spec.ts` — the conductor note's Review Focus 5/7
    coverage: the index lists both MEGA handouts without the flag,
    "Load this lab" loads Poisson + NJ + pairwise into the sandbox
    and replays the fixture's printed Poisson/pairwise row, the
    unsaved-work confirmation keeps a declined draft on the new lab,
    and the coarse-pointer ≥40×40 pass covers the new page.
  - `web/e2e/a11y.spec.ts` — axe on the new lab page.
  - `web/e2e/visualScenes.ts` — the `lab-mega-nj-vs-upgma-print`
    scene the owner asked for on #136 (same fullPage print view as
    the other handouts); new baselines only, none existing changed.
  - `docs/decisions.md` — this entry.
- **Starting method:** `analysis.method` is NJ — the handout's first
  tree run and the title order (NJ vs UPGMA); the predict_pair
  reveal (closest pair ≠ first join) is an NJ lesson, and step 4
  switches the Method control to UPGMA for the second run.
- **Gap treatment:** pairwise deletion — MEGA's own default and the
  treatment the cited `.mao` files declare (same rule as handout 1).
- **Model:** Poisson, not JTT — MEGA's own JTT estimator differs
  from every JTT NeoPhylo ships (fixtures/worked/mega-notes.md "JTT
  verdict", #117); the handout's "Why Poisson, not JTT" section says
  so in one paragraph, consistent with the "Coming from MEGA?"
  guide's wording.
- **Tie-aware UPGMA comparison:** `packs.test.ts` ports
  `parity_mega_library.rs`'s `replay_mega_upgma` to TypeScript —
  exact comparison first (rooted-clade topology on MEGA's printed
  matrix, then topology plus per-value `lenTol` lengths on the
  engine's own matrix); on failure, MEGA's tree is replayed on the
  engine's full-precision matrix requiring every merge to be a
  minimum-distance pair (exact `===`, the ties are exact rationals)
  and the replay to have seen a step with more than one minimal
  pair. The test additionally pins that the exact comparison fails
  for `globins upgma/Poisson/pairwise`, matching the Rust
  `upgma_tie_resolutions_are_exactly` pin (the HBA three-way tie is
  real). NJ stays exact everywhere — verified: the engine's NJ tree
  equals the fixture's split set exactly under all three filters.
- **Tree claims in the text:** the closing note (step 21, the last
  NJ join) names its groupings — the six alpha globins, the ten
  mammalian beta globins (mouse and rat excluded, their pair the
  next split out to make twelve), the identical human–chimp betas,
  the mouse–rat pair, the cow–sheep pair — each an exact computed
  split of the engine's NJ tree under every pickable model × every
  gap treatment, and of the fixture NJ trees (fix round 1 widened
  the pin from Poisson × filters to models × filters × methods and
  fixed the ten-vs-twelve count). The prompts' claims are scoped to
  the run they describe — prompts fire at stepper positions under
  whichever method/model/filter the student has selected (verified
  in the app: the at_step-1 prompt shows at UPGMA step 0 and the
  step-21 note at UPGMA position 20, mid-run) — so the reveal names
  Human_HBA–Horse_HBA under "NJ on the Poisson matrix", Cow_HBA–
  Human_HBA under JTT, and the identical betas under UPGMA, and the
  closing note says the UPGMA run is mid-run there, never "the tree
  is complete". The handout never states the NJ-vs-UPGMA outcome
  before the student builds the second tree (questions only), never
  calls the UPGMA trees identical, and explains the tie where it
  discusses agreement — all test-pinned.
- **Drawing claim (fix round 1):** the mega_note's "NeoPhylo draws
  each tree as computed: NJ unrooted" was wrong — the tree view
  draws the finished NJ tree as a rectangular phylogram from an
  arbitrary root (verified by screenshot at the final step), the
  same convention as MEGA's NJ display; the note now says so and
  tells the student to read it as unrooted. The "unestimable cell
  shows ∞" claim is verified in code (MatrixHeatmap renders
  saturated cells as ∞).
- **`minutes`:** 30 — one distance run plus two tree builds and a
  23-taxon comparison, on the same scale as handout 1's 30 (two
  distance runs + two NJ builds on 7 taxa); the owner judges the
  scale.

## Rendering follow-up (owner, 2026-11-04)

Owner-requested rendering fixes after the PR #139 review; branch
`conductor/render-heatmap-scale-node-labels`.

- **Heatmap text cap (bug 1):** `.matrix-wrap > svg` was `width:100%`
  with only the `--matrix-w` min-width floor, so a small late-step
  matrix stretched to the 560 px wrap and rendered its authored 12 px
  text past the type scale's 32 px max (globins UPGMA's 2-taxon steps
  drew at ~35 px). The svg now also caps at `--matrix-max` =
  `floor(natural width × size.lg / FONT)` (= 5/3 × natural; the cap
  was size.xxl = 8/3 until owner decision B on #140 lowered it to
  20 px), floored so 12·scale ≤ 20 exactly. It binds only where the
  stretch already exceeded the cap — every frame inside the scale is
  pixel-identical — and the `--matrix-w` / coarse-pointer
  `--matrix-min` floors are untouched (40/34 ≈ 1.18 < 5/3 ≈ 1.67, so
  the floors always fit under the cap).
  `margin-inline:auto` keeps a capped svg centered; it is a no-op
  whenever the svg fills or overflows the wrap.
- **Internal-node names (bug 2):** highlighted u-names used to draw
  unconditionally right of their node and could land on a child
  marker or another name (globins NJ's u20 ended on the Cow_HBB
  marker). `src/layout/internalNames.ts` now places each name against
  the same obstacles the support pills avoid (markers, leaf names,
  "0" markers, placed names): resting right of the node, ±6 px
  nudges then ascent ≤10 px on each side (right first, then the
  mirrored left; up first because plates move toward rows painted
  earlier, so later-drawn child segments can't strike through them),
  and only an unresolved collision earns a dashed
  leader — the pills' own ladder, factored into the new shared
  `src/layout/labelCollision.ts`. Branch segments and connectors are
  deliberately NOT obstacles: each name rides a `.node-name-plate`
  halo filled with the `bg` token (no border, so it can't read as a
  support value) that masks the lines beneath — the pill convention.
  Exports never draw names (no `highlight` is passed), so the
  SVG/PNG path is unchanged and consistent with the screen.
- **Files outside a task's Files block (all required by the fix):**
  - `web/src/layout/labelCollision.ts` (new) — the collision
    machinery both placers share, moved verbatim out of
    `supportLabels.ts` (its suite still passes).
  - `web/src/layout/internalNames.ts` (new) — the name placer.
  - `web/src/layout/internalNames.test.ts` (new) — placement
    invariants over colliding/adjacent/cladogram/zero-marker trees.
  - `web/e2e/matrix-scale.spec.ts`, `web/e2e/internal-names.spec.ts`
    (new) — the pinned rendered-size and non-overlap checks.
  - `web/src/index.css` — `.matrix-wrap > svg` cap +
    `.node-name-plate` / `.node-name-leader` rules.
  - `web/e2e/__screenshots__/` — the baselines listed in the PR: 20
    under the first cap (9d815e6), 35 after owner decision B lowered
    it (334b87b): the matrix cap shrink (all scenes) plus name
    plates/relocated names where highlighted internals show
    (four-taxa, replicate-panel, cytc-*, bootstrap-basics-final
    trees).
- **Test interpretation:** the brief's "4-taxon lesson matrix" — no
  4-taxon lesson ships, so the e2e check uses the checkpoint-11
  4-taxon FASTA through the Sandbox (the same block visualScenes
  drives).

### Fix round 1 (owner decision B on #140)

- **Cap lowered to `size.lg` (20 px):** `--matrix-max` is now
  `floor(natural width × size.lg / FONT)` = 5/3 × natural, floored so
  12·scale ≤ 20 exactly (was size.xxl = 8/3 ≤ 32 px). Verified in
  code: the coarse-pointer `--matrix-min` floor is
  `ceil(natural × 40/34)` ≈ 1.18 × natural < 5/3 ≈ 1.67, so it still
  fits under the cap — and even where it could not, CSS gives
  `min-width` precedence over `max-width`, keeping the §6.5 40 px
  cell floor. `e2e/matrix-scale.spec.ts` now asserts 12 ≤ size ≤ 20
  on every measured text at both viewports, with the globins UPGMA
  step-20 frame (the ~30 px render the owner saw) pinned as its own
  named test next to the final-step and 4-taxon cases.
- **Presenter mode left as is:** the heatmap never reads the
  presenter scale — `MatrixHeatmap` takes no `presenter` prop and
  computes `--matrix-max` from the raw `size.lg` JS token, its
  authored text is fixed `FONT`/`LABEL_FONT` svg units, and no
  `:root[data-presenter]` rule touches `.matrix-wrap` — so there is
  no token-scaled cap to follow (presenter mode does not change the
  heatmap's geometry at all).

## v1.4b Task 13 (handout 3): MEGA lab "100 bootstrap replicates" on 16S rRNA

- **Files outside the Files block:**
  - `web/src/labs/registry.test.ts` — the shipped-list pin gains
    `mega-bootstrap-100` (sorted first of the MEGA ids).
  - `web/src/labs/labs.test.tsx` — the shipped-listing UI test
    asserts the new card lists without the e2e flag.
  - `web/e2e/labs.spec.ts` — the conductor note's Review Focus 5
    coverage: the index lists all three MEGA handouts without the
    flag, "Load this lab" loads K80 + NJ + pairwise into the sandbox
    and replays the fixture's printed K80/pairwise row plus the
    Replicates/Seed controls at the final step, the unsaved-work
    confirmation keeps a declined draft on the new lab, and the
    coarse-pointer ≥40×40 pass covers the new page.
  - `web/e2e/a11y.spec.ts` — axe on the new lab page.
  - `web/e2e/visualScenes.ts` — the `lab-mega-bootstrap-100-print`
    scene, mirroring `lab-mega-nj-vs-upgma-print` (fullPage, 1920×1080
    and 768×1024); new baselines only, none existing changed.
  - `docs/decisions.md` — this entry.
- **Runs:** two `Phylogeny → Construct/test NJ tree` runs, both K2P /
  NJ / bootstrap×100, differing only in `Gaps/Missing Data` — the
  `.mao` pair `njboot_dna_k2p_{pairwise,complete}.mao`, which is also
  what the fixture's `bootstrap["nj/K80/{pairwise,complete}"]` blocks
  record. No distance-run rows: MEGA's tree run computes the matrix
  inside it, matching handouts 1–2's rule that every cited setting
  comes from a run the handout reproduces.
- **Gap treatment:** the lab loads pairwise deletion — MEGA's own
  default — and the handout's step 5 switches complete deletion in;
  both rows are cited so the "nothing is left to a default" pin
  covers both `.mao` files.
- **Seed:** `bootstrap.seed = 8675309` (the seqboot chain's seed —
  consistent with the only other seeded lab pack). The settings table
  carries a "Resample seed" row whose `mega_setting` is
  "no MEGA setting — MEGA's bootstrap is unseeded": MEGA-CC has no
  seed flag (`fixtures/worked/mega-notes.md`), so it is the one row
  that cannot cite a `.mao` key — the packs test requires exactly
  one such row. Nothing is `locked`: the handout needs the student
  to change the gap treatment, and every prompt claim is pinned under
  all pickable models × filters instead of by locking the panel.
- **Support is split-set only:** per the #126 ruling the engine's NJ
  splits under each filter are asserted equal to the 100-replicate
  block's labelled splits and the fixture tree's splits; MEGA's
  support numbers are never compared to NeoPhylo's. The "same tree,
  moving supports" premise is pinned off the fixture alone (same
  split set under both filters; ≥5 supports move ≥20 points, max 55).
- **Scoped claims:** the pairwise==complete split-set equality holds
  under K80 only (P and Jc69 legitimately differ), so the handout
  poses the comparison as a question scoped to its own runs. The
  closing note's six named groupings are exact splits under every
  pickable model (P, JC69, K80) × every gap treatment × both methods'
  trees, so the note stays true under anything the student selects;
  prompt texts never state the pairwise-vs-complete outcome, quote a
  support value, or read support as a probability (the "never a
  probability" disclaimer is pinned, not just present).
- **`minutes`:** 35 — two full bootstrap runs plus a 27-taxon
  tree-and-support comparison, between the handout-1/2 scale (30:
  two-to-three non-bootstrap runs) and seqboot's 40 (a four-program
  chain); the owner judges the scale.
- **Fix round 1 (PR #141):** the at_step-26 note pointed at handout
  step 6 for the gap-treatment switch (it is step 5 — step 6 is the
  comparison), the pairwise-deletion sentence claimed all 1,628
  columns stay "available to each pair", the 1,628/1,199 site counts
  were unpinned, and `mega_note_md`'s "Compare supports only within
  one gap treatment" contradicted step 6's between-treatments
  question (it meant NeoPhylo-vs-MEGA within a treatment). Reworded
  all three; a new packs test pins every "step N" reference to the
  handout step whose text names that action and a second pins both
  site counts to `engine.siteMask`; the e2e load test asserts
  "429 of 1,628 sites removed by complete deletion"; the four
  `lab-mega-bootstrap-100-print` baselines regenerated in the pinned
  image (no other frame moved — full visual project green).

## v1.4b Task 13 (handout 4): MEGA lab "Interpreting support" on 16S rRNA

- **Owner decision 2026-11-04:** no MEGA fixture for the weak-support
  sample; handout 4 uses it for NeoPhylo-only reading, all MEGA
  comparisons use the 16S fixtures. The handout says so plainly
  ("no recorded MEGA run for it", "never a MEGA comparison and never
  a number to match"), the sample part asks questions only, and a
  packs test pins that no support value is stated anywhere in the
  pack text.
- **Files outside the Files block:**
  - `web/src/labs/registry.test.ts` — the shipped-list pin gains
    `mega-interpreting-support` (sorted between `mega-bootstrap-100`
    and `mega-jc69-vs-k2p`).
  - `web/src/labs/labs.test.tsx` — the shipped-listing UI test
    asserts the new card lists without the e2e flag.
  - `web/e2e/labs.spec.ts` — the conductor note's Review Focus 5/7
    coverage: the index lists all four MEGA handouts (`.lab-card`
    count 4 in the MEGA region), "Load this lab" loads K80 + NJ +
    pairwise + 100 reps + the seed and replays the fixture's printed
    K80/pairwise row, the unsaved-work confirmation keeps a declined
    draft on the new lab, the handout's weak-support step is followed
    literally (Sandbox → "Weak-support example (DNA)" → run →
    `data-weak` markers visible → "Back to the lesson" returns to the
    lab), and the coarse-pointer ≥40×40 pass covers the new page.
  - `web/e2e/a11y.spec.ts` — axe on the new lab page.
  - `web/e2e/visualScenes.ts` — the `lab-mega-interpreting-support-print`
    scene (same fullPage print view as the other handouts); new
    baselines only, none existing changed.
  - `docs/decisions.md` — this entry.
- **Same analysis as handout 3's first run:** `K80` + NJ + pairwise
  deletion + 100 replicates + the same seed `8675309` — deliberate:
  the handout's premise is that this lab's first run IS the run the
  previous handout performed, so its outcome is the same run's.
- **Second run is a seed change, not 1,000 replicates:** the
  handout's step 6 has the student change the Seed rather than raise
  Replicates to 1,000 — a 27-taxon × 1,000-replicate run is allowed
  by the UI but too slow for a student (and for e2e); the
  1,000-replicate comparison uses MEGA's recorded `boot1000` fixture
  instead, and the settings row says so.
- **Claims pinned to the fixtures, not asserted:** "same groupings
  at both replicate counts" is pinned as equal split sets across the
  100-replicate block, the 1,000-replicate block, the fixture tree
  and the engine's NJ splits (the #126 split-set rule — no support
  values compared). "The same two groupings sit under 50 at both
  counts" is pinned as the two identical under-50 splits in both
  recorded blocks, also both blocks' two weakest. The borderline
  claim — a third grouping just over 50 in both MEGA runs and just
  under in the seeded run — is pinned the same way (fixture ≥50 <60
  at both counts; the engine-internal seeded run puts exactly those
  three under 0.5).
- **`predict_branch` anchors the prediction:** the prompt asks for
  the branch the student expects to be weakest before the run and
  the verdict names the actual weakest after it — reveal text stays
  generic so it holds under every seed the student picks for run 2.
- **`*` convention matches the code:** the handout's "under 50" is
  pinned against `supportText()` — `s < 0.5` draws the marker
  (`web/src/layout/supportLabels.ts`), so the stated convention
  cannot drift from the renderer; it is described as NeoPhylo's own
  flag, not a significance test or a MEGA feature.
- **`minutes`:** 30 — one bootstrap run, a seeded re-run, the MEGA
  comparison (read-only on the NeoPhylo side) and the short
  weak-support sample run; the previous handout's two full runs
  scored 35, this one's second "run" is a seed change; the owner
  judges the scale.
- **Fix round 1 (PR #142):** wording only — `mega_note_md` and
  question 4 no longer state the seeded run's `*` outcome (a new
  packs test pins every student-facing field against "your … run
  flags/shows/marks"), step 9 asks "which groupings, if any", the
  first-run note says "if you have not yet", and the second-run note
  says the counts CAN move; the four
  `lab-mega-interpreting-support-print` baselines regenerated.

## v1.4b Task 14: release checkpoint, roadmap, CITATION

- **Files outside the Files block:** this entry (`docs/decisions.md`),
  as every task records.
- **Checkpoint:** `docs/checkpoints/v1.4b-release.md`, modeled on
  `v1.4-release.md`. Every number it asks the owner to compare in
  MEGA's GUI is taken from the committed MEGA-CC 12.1.4 fixtures
  (`fixtures/mega/library/*.json`, `boot1000/16s-rrna.json`), not
  written from memory; per-item automated coverage is cited
  (`parity_mega_library.rs` test names). Items only a human can do —
  real MEGA GUI comparisons, printing, the Safari pass, deploy-preview
  spot-checks, sign-offs, the tag — are left unchecked and say so.
- **`docs/roadmap.md`:** the Status line — v1.4b joins the "released
  or releasing" list, next becomes v1.4c, and the revision date moves
  to today (2026-11-04). No section content changed.
- **`CITATION.cff`:** `version: 1.4.1`; `date-released` set to
  2026-11-05 at the owner's request on 2026-11-05 (change it if the
  tag lands on another day).
- **Tag name ambiguity resolved as `v1.4.1`:** the milestone is named
  v1.4b but production deploys only on `v*.*.*` tags
  (`.github/workflows/ci.yml`), and roadmap v1.5 is a different
  milestone (classroom delivery), so the release tag/CITATION version
  is `v1.4.1`. The owner confirmed the tag name on 2026-11-05 — the
  tag itself is owner-only.
- **Resolved rulings restated, open issue flagged:** the checkpoint's
  §12 records #126 (bootstrap noise/ties, option A — #127 fixtures +
  #128 test) and #117 (no `JTT_MEGA`) as resolved, and carries open
  issue #135 (header overflow at 375 px) for the owner to weigh
  against the tag.
- **E2E not run in this sandbox:** `E2E=1 ./scripts/check.sh` cannot
  run here (docker/Playwright image unreliable in the agent sandbox,
  same as the v1.4 checkpoint task); `./scripts/check.sh` was run —
  e2e coverage comes from CI, and the checkpoint lists checking the
  `main` push run's full browser matrix as a gate item.
- **Owner-requested fix for issue #135 in this PR (files outside the
  Files block):** `web/e2e/narrow.spec.ts` (new spec),
  `web/src/views/labs/LabPage.tsx`, `web/src/views/labs/LabIndex.tsx`,
  `web/src/views/labs/labs.css`, `docs/checkpoints/v1.4b-release.md`.
  Conductor measurements on this branch: the header itself is already
  inside `[0, viewport width]` with every control ≥40×40 on Lesson,
  Sandbox, `?labs` and `?lab=<id>` at 320/360/375 px — the sideways
  scroll came from `table.lab-settings` (`?lab=mega-jc69-vs-k2p` and
  `?lab=mega-interpreting-support` at 375×812: scrollWidth 450/463)
  and from lab cards reaching right=336 on `?labs` at 320 px. Fixed
  by wrapping each settings table in `.lab-settings-scroll`
  (`overflow-x: auto`, `role="region"`, `tabIndex={0}`, named; the
  index cards' regions are labelled per lab so names stay unique),
  `min-width: 0` on `.lab-card` so the grid item can shrink past its
  min-content, `overflow-wrap: anywhere` on `.lab-chain`, and
  `overflow: visible` on the region in `@media print` so the whole
  table still prints. `narrow.spec.ts` pins (a) on-screen
  `header.app-header`/`header.lab-page-head` controls inside
  `[0, width]` at ≥40×40 and (b) `scrollWidth <= innerWidth` on the
  Lesson view, Sandbox view, `?labs` and every shipped `?lab=<id>` at
  375×812 with `hasTouch`, plus `?labs` at 320×640. Playwright does
  not run in this sandbox — the spec's expected pre-fix failures are
  the conductor's own scrollWidth and card-edge measurements; CI runs
  the e2e.

### Fix round (owner request 2026-11-13)

- **Lab index printed dark from a dark session (files outside the
  Task 14 Files block, owner request):** `web/src/views/labs/LabIndex.tsx`,
  `web/e2e/labs.spec.ts`, `web/src/views/labs/LabPrintStyles.tsx`
  (header comment). `LabIndex` rendered `.lab-print` but never
  rendered `LabPrintStyles`, so `?labs` kept the session's dark
  tokens under `@media print` while the lab pages printed light. The
  index now renders `<LabPrintStyles />` exactly like `LabPage` does;
  the new e2e test pins light paper + dark text under a stored dark
  theme on both `?labs` and `?lab=mega-jc69-vs-k2p`.
- **Release-checkpoint runbook and helpers (files outside the Files
  block, owner request):** `docs/release-checkpoint.md`,
  `docs/checkpoints/v1.4b-release.md` (runbook pointer paragraph),
  `scripts/checkpoint/` (`run.sh`, `preflight.sh`, `browser.sh`,
  `mega_verify.py`, `report.py`, `browser/`). Local release tooling —
  never run in CI; the browser checker lives under `scripts/` and is
  staged next to `web/node_modules` at run time. The obsolete copy at
  `web/checkpoint/` and `web/playwright.checkpoint.config.ts` was
  removed without being committed.
- **`CITATION.cff`:** `date-released: "2026-11-13"` — the owner's
  planned tag date.

### Fix round (owner finding 2026-11-14)

- **Dark paper below/around printed handouts (files outside the Task
  14 Files block, owner finding):** `web/src/views/labs/LabPrintStyles.tsx`,
  `web/e2e/labs.spec.ts`. `LabPrintStyles` re-mapped the tokens to
  light only on `.lab-print` under `@media print`, so index.css's
  `:root { background: var(--color-bg) }` still resolved the session's
  dark `--color-bg` — the printed PDF was dark below the handout's
  last line and between page blocks on all 7 lab pages and `?labs`.
  The component now emits the same light map on
  `:root:has(.lab-print)` (with `color-scheme: light`), so `<html>`,
  `<body>` and `#root` resolve light on paper; the dark-theme e2e test
  also asserts every `.lab-print` ancestor prints transparent or at
  luminance > 0.85.
- **Checker checks the paper, not only the handout (files outside the
  Files block):** `scripts/checkpoint/browser/audit.ts`
  (`printColors` also returns `page`, the minimum luminance of
  `<html>`, `<body>` and the printed block's ancestors),
  `scripts/checkpoint/browser/release.spec.ts` (asserts `page` > 0.85
  on every lab and the index), `docs/release-checkpoint.md` (the new
  "First run" bullet).

## v1.4c Task 1: spec, plan, market check, roadmap changes

- **Spec:** `docs/superpowers/specs/2026-11-14-neophylo-v1.4c-matrix-and-library-design.md`;
  plan `docs/superpowers/plans/2026-11-14-neophylo-v1.4c-plan.md`; market check
  `docs/market/2026-11-14-market-check.md`.
- **Roadmap changes (owner, brainstorming 2026-11-14):**
  - v1.4c narrowed to distance-matrix input (files, paste, grid, matrix exercises, editor)
    plus the lesson library, generated worksheets with engine-computed answer keys behind
    an "I'm an instructor" step, and the instructor guide.
  - **Accession fetch moves to v1.9**, next to alignment: fetched sequences are unaligned,
    so fetch in v1.4c would lead to a dead end. Its privacy/CORS questions move with it.
  - **v1.5 gains a WCAG 2.1 AA self-audit and a published Accessibility Conformance Report
    (VPAT):** US public universities must meet WCAG 2.1 AA under ADA Title II by
    2027-04-26 and review embedded/LTI tools. The independent audit stays in v3.2.
  - **Outreach and pilots deferred** by the owner until the product is solid and
    impressive; revisit at v1.5 and v2.0.
  - v1.4c checks MEGA 12's "Adaptive" bootstrap option against the 100-replicate handout.
- **Decided in this plan:** see the plan's "Decided in this plan" list (`DistModel::Supplied`,
  `DistanceInput`, matrix exercise shape with no `correction`, `meta`, the one changed
  `.meg` message assertion, `detect_matrix_format`, 3–30-taxon grid, paper sheets for
  ≤ 8 taxa, routes `?library`/`?worksheet`/`?key`/`?guide`, the session-storage gate,
  `imported.matrix` in URLs with `v` still 3, lesson ids `nj-by-hand` and
  `upgma-vs-nj-matrix`).

## v1.4c Task 2: matrix fixtures; ambiguous-tie ruling

- **The identity:** at four active NJ nodes the complementary pairs share the
  minimum Q identically — Q(i,j) = Q(k,l) = d(i,j) + d(k,l) − S, where S is the
  sum of all six active distances — so every NJ run on n ≥ 5 taxa has a tie at
  its last pairwise join. The plan's original premise ("no tie at any NJ join")
  is unsatisfiable.
- **Owner ruling (option A, 2026-11-14):** "tie-free" means *no ambiguous tie*
  (no two minimum-Q pairs that give different splits); the four-active
  complement tie is allowed because joining either pair yields the same split
  with identical branch lengths. Option B (ship `nj_wikipedia5` as the lesson
  matrix) was rejected — its answer is one search away. Option C (change the
  engine `tie` flag) was rejected — the flag stays unchanged; worksheets and
  keys report the benign case via the new `JoinFacts.tie_same_split` (Task 6).
- **Side note:** the existing explanation panel already shows "Tie: chosen by
  input order." at every last pairwise join, so nothing changes there in
  v1.4c Task 2; worksheets and answer keys follow the updated spec §7.2 ("A
  four-active complement tie is shown as 'either pair gives the same tree'").
- **Files outside the Files block:** the spec
  (`docs/superpowers/specs/2026-11-14-neophylo-v1.4c-matrix-and-library-design.md`)
  and the plan (`docs/superpowers/plans/2026-11-14-neophylo-v1.4c-plan.md`)
  carry the ruling's wording (this entry); `docs/decisions.md` carries the
  entry itself; `fixtures/mega/README.md` documents the new `mao/matrix_*.mao`
  files, `mega/matrix/` layout and `--matrix-only` flag (fixture docs for the
  same feature — the plan's Files block covered only `fixtures/README.md`).

## v1.4c Task 3: distance-matrix input and additive matrices

- **`validate_input` order of checks (conductor's call):** taxon count
  (`TooFewTaxa`/`TooManyTaxa` with `MAX_TAXA`) → `lower` length → names →
  values; the first problem found is the one reported. A name that is empty
  after trimming is refused naming its position; duplicates compare exact
  strings (PHYLIP is case-sensitive) and are refused with `row` = `col` = the
  name and both positions in `msg`. NaN, ±infinity and `< 0` are refused
  naming the cell (`row`/`col` = the two taxon names); `−0.0` and zero
  off-diagonal values are accepted.
- **`additive_matrix` (conductor's call):** names in `tree.leaf_labels()`
  order; a missing branch length is `InvalidMatrix` naming the leaf whose
  path needed it; the result is passed through `validate_input`, which is
  what refuses duplicate/empty leaf labels and trees over `MAX_TAXA`.
  `round_decimals` > 6 is `InvalidMatrix` before any work.
- **Files outside the Files block:** `web/src/engine/generated/{DistModel.ts,
  NeoError.ts,DistanceInput.ts}` are regenerated by `cargo test -p
  neophylo-core export_bindings` — generated types must stay in sync with
  the engine or CI's wasm job fails on the diff. The regeneration breaks
  four exhaustive TypeScript sites, each fixed minimally (conductor's
  notes): `web/src/state/analysis.ts` (`DIST_LABEL` gains
  `Supplied: "supplied"`, matching `name()`; it is never in `CORRECTIONS`),
  `web/src/explain/errors.ts` (a `case "InvalidMatrix"`: title "This
  distance matrix has a problem", body `e.msg` or `Cell (row, col): msg`),
  `web/src/explain/errors.test.ts` (one `InvalidMatrix` variant with a cell
  plus its title), and `web/src/editor/exerciseFile.ts` (`correctionName`
  gains `case "Supplied" → "supplied"` so the exhaustive switch still
  compiles; the matrix exercise file shape lands in Task 5).
- **Fix round 1 (conductor's call):** `InvalidMatrix` Display — and the
  mirrored errors.ts body — prints "distance matrix taxon '{name}': {msg}"
  / `Taxon {name}: {msg}` when exactly one of `row`/`col` is set or when
  `row == col` (a duplicate); two distinct names still print as a cell.

## v1.4c Task 4: matrix parsers, writer, detection, parity

- **Paste grammar (conductor's call, mirroring the module doc):**
  `parse_pasted_matrix` tries `parse_phylip_matrix` first, then a
  tabular reading — rows are lines, cells split on whitespace runs
  (NBSP included) and, unless `decimal_comma`, on commas (trailing
  empty cells from spreadsheet trailing commas are dropped). When
  every non-blank line contains a tab the paste is a spreadsheet
  copy: cells split on tabs only (each trimmed of spaces/NBSP), so
  names may contain spaces. Errors name a row by its real name or
  line number, never by a generated A/B/C label. Unicode
  minus U+2212 is normalised to `-` before number parsing. The value
  block reads as square (`n` cells/row), lower+diagonal (`i+1` — a
  square with a blank upper triangle), or strict lower (`i`) only
  when a name column is present; without names a triangle is
  lower+diagonal and taxa are named A, B, C, … (notice). Each
  `PasteOptions` field left `None` is resolved by trying both
  readings; `MatrixAmbiguous` is returned only when two readings
  survive, the header question before the name-column question. A
  comma inside a dot-free numeric token (`0,25`) asks `DecimalComma`
  whenever the option is unset; under `decimal_comma` a comma is
  never split into two cells. When no reading survives, the error
  reported is the one that got furthest (header/name structure <
  shape < non-numeric value cell < value checks/validation). A
  header row supplies names when its cell count is `n` or `n+1`
  (corner cell), and when a name column is also present the two must
  agree or the reading fails.
- **PHYLIP name handling (builder's call):** under `Relaxed` a row's
  name is the first whitespace-delimited token of its first line.
  `Strict` reads the whole file twice if needed: first with the exact
  PHYLIP rule — the name is the first 10 characters of every row's
  first line (chars, not bytes, so multi-byte characters are never
  sliced), trimmed of trailing whitespace, and values start at
  character 11, so a 10-character name may be glued to its first
  value (`Pan_troglo1.0`, as `dnadist`/`protdist` write when a name
  fills its 10 columns), and a shorter first line is a name alone
  whose values wrap. Only when that whole-file reading fails is the
  overflow reading tried — a first token longer than 10 characters is
  then the whole name and values follow it normally — and when both
  fail the exact-rule reading's error is reported. A strict name's
  identity is its first 10 characters; the truncation-collision
  refusal applies when the effective mode is Strict — i.e.
  `NameMode::Strict`, or `Auto` where Relaxed failed and the Strict
  fallback succeeded.
- **PHYLIP shape pick (builder's call):** square is tried before
  lower-triangular; when both fail, the error comes from the shape
  the first row suggests (a name line carrying values looks square;
  a name alone looks lower), ties broken by which parse saw more
  lines.
- **`.meg` positional rows (builder's call):** `#name` lines may be
  interleaved with data rows and a `#name` line's tail counts as one
  data row; the `n−1` data rows then fill the declared triangle in
  order (LowerLeft row `r` = taxon `r+1` with `r+1` values;
  UpperRight row `r` = taxon `r` with `n−1−r` values). `!Title` is
  kept, other commands become notices, a missing `DataFormat` reads
  as `LowerLeft` with a notice, and a declared `NTaxa` must equal the
  name count.
- **`.meg` refusal message (plan-sanctioned):** the alignment parser
  `parse_meg` now refuses distance files with exactly `this .meg
  file holds a distance matrix; open it as a distance matrix`,
  asserted in `tests/meg.rs` and `web/e2e/meg.spec.ts`.
- **Files outside the Files block:** `web/e2e/meg.spec.ts`,
  `web/src/engine/index.test.ts` and
  `web/src/views/ImportPanel.test.tsx` — the plan sanctions updating
  every assertion of the old refusal text (`web/e2e/meg.spec.ts`
  explicitly; the other two pinned the same message and fail without
  the update — expected-string changes only);
  `web/src/views/ImportPanel.tsx` — the `importMeg` refusal-vs-error
  branch matched the message by prefix (`startsWith("distance-matrix")`);
  the prefix is updated to the new text so the refusal still reads as
  a notice, not an error (CI e2e caught this; no behavior change
  beyond the sanctioned message);
  `web/src/engine/generated/{NeoError.ts,PasteQuestion.ts,
  MatrixFile.ts,MatrixFormat.ts,PasteOptions.ts,PhylipMatrixOptions.ts}`
  regenerated by `cargo test -p neophylo-core export_bindings`;
  `web/src/explain/errors.ts` and `web/src/explain/errors.test.ts`
  gained the minimal `MatrixAmbiguous` case the `never`-exhaustive
  switch requires (title "This distance matrix needs a choice",
  body naming the question in plain words) — additions only;
  `scripts/ci/fuzz.sh` — the three matrix targets added to the
  fuzz loop (the plan names the targets but not the CI script) — and
  `crates/neophylo-core/fuzz/seeds/{matrix_phylip,matrix_meg,
  matrix_paste}/` — copies of the hand-written
  `tests/matrix_inputs/` files, per the plan's "seeded from
  `tests/matrix_inputs/`".

## v1.4c Task 5: exercise schema 5 — matrix data and lesson metadata

- **Matrix analysis carries `DistModel::Supplied`:** a matrix file's
  `analysis` holds `method` only; the loader sets `correction` to
  `Supplied` itself. `correction`, `kappa` and `site_filter` keys —
  including explicit `null` — are refused with their
  `analysis.*` path, a top-level `bootstrap` at `bootstrap`, and a
  `predict_branch` prompt at its `prompts.N.type` path. On non-matrix
  data a written `correction` of `"Supplied"`/`"supplied"` stays an
  `unknown correction` refusal at `analysis.correction` (the Task 3
  test pins this), while an absent correction still reports
  `analysis.correction` required — `AnalysisFile.correction` is now
  presence-aware (`Option<Option<String>>`) so the two cases stay
  distinguishable.
- **Presence-aware new keys (builder's call, per the conductor
  note):** `meta` and the matrix `data` fields are parsed from raw
  `serde_json::Value`s with explicit object/array checks before any
  struct derive runs, so `meta: null`, `meta: []`, `data: [...]` and
  per-field nulls all refuse at the named path instead of
  deserialising through serde's struct-from-seq leniency — matching
  what `schema.json` (which requires objects) reports. `meta` in a
  v4-or-earlier file — even `meta: null` — refuses with the
  requires-schema-5 message at `meta`.
- **Files outside the Files block:**
  `crates/neophylo-core/tests/exercise_v3.rs` — the version-pin test
  updated to 5 and the unknown-version test to 6 (the same
  sanctioned edit v1.4b Task 6 made when bumping to 4);
  `web/src/engine/generated/{Exercise.ts,ExerciseData.ts}` modified
  and `{ExerciseMeta.ts,Level.ts}` new — regenerated by
  `cargo test -p neophylo-core export_bindings`, never hand-edited;
  `web/src/lessons/__fixtures__/v{4,5}-*.json` (35 new) — the
  ajv-vs-engine agreement fixtures `schema_v5.test.ts` iterates,
  following the `schema_v4.test.ts` convention;
  `web/src/editor/exerciseFile.ts` — the minimal type-level changes
  the new `ExerciseData` union member forces: `meta` joins
  `EXERCISE_KEYS`, the `data` ternary gains the `matrix` branch,
  `analysisToFile` omits `correction` when the wire model is
  `Supplied`, and the written `schema_version` is 5 for a matrix
  exercise (4 for a v4 field, else today's version — unchanged for
  existing data kinds); `web/src/lessons/lessons.test.ts` — the
  `else` branch that assumed "not simulated ⇒ embedded" narrowed to
  `kind === "embedded"` for `matrix` (tsc exhaustiveness; the matrix
  branch `continue`d in the original commit and was changed to a
  loud `expect.fail` in fix round 1);
  `web/src/state/lesson.ts` — `applyImportTree`'s alphabet pick
  re-keyed from `kind === "embedded"` to `kind === "simulated"` so
  `data.sim` is only read on the simulated branch (identical
  behaviour for both existing kinds; a matrix exercise falls back to
  the declared alphabet until Task 7 owns matrix state);
  `crates/neophylo-core/fuzz/fuzz_targets/exercise.rs` — the
  exhaustive `ExerciseData` match gains a `Matrix` arm that feeds the
  supplied matrix through `to_distance_matrix` into build_tree/rf/
  reroot (caught by the CI fuzz-build job; the matrix path has no
  alignment, matching the loader's bootstrap refusal).
- **Fix round 1 (review of the PR):**
  - A present top-level `bootstrap` key — including
    `bootstrap: null` — is refused on a matrix exercise at
    `bootstrap`: `ExerciseFile.bootstrap` is now presence-aware
    (`Option<Option<BootstrapFile>>`, the `present` pattern) so a
    null key no longer reads as absent. On simulated/embedded data a
    stray `bootstrap: null` still loads as absent — that
    pre-existing serde gap is unchanged and listed as a follow-up.
  - `meta.minutes` / `meta.hand_steps` accept any integral JSON
    number in `1..=4294967295` — `5.0` and `4e3` load as u32, while
    `1.5`, `0` and `5e9` refuse at the field path — and schema.json
    gained `"maximum": 4294967295` on both (conductor's call).
  - The editor writes `schema_version: 5` whenever `meta` is written
    or `data.kind` is `"matrix"`; a v4 field still writes 4 and
    everything else 3 (builder's call — `CURRENT_SCHEMA_VERSION` in
    `exerciseFile.ts` is the minimum version, not the highest).
  - `lessons.test.ts` fails loudly (`expect.fail`) on a matrix
    lesson instead of `continue`-ing past the lesson-content checks,
    so the first Task 10 matrix lesson forces the check to be
    written (builder's call).
  - `matrix_field` maps `InvalidMatrix` structurally instead of by
    `msg.contains("name")` (builder's call — the review's optional
    item): a dedicated lower-length check runs before
    `validate_input` whenever the taxa count is in range —
    preserving its count → length → names → values first-error
    order — so a names error always has `row == col` (empty for a
    blank name, the shared string for a duplicate) and a cell error
    never does.
  - New files outside the Files block (fix round 1): the five new
    `web/src/lessons/__fixtures__/v5-*.json` agreement fixtures
    (`v5-matrix-bootstrap-null`, `v5-meta-minutes-5-0`, `-4e3`,
    `-5e9`, `v5-meta-hand-steps-2-0`) and the "schema 5 save"
    describe block in `web/src/editor/exerciseFile.test.ts`. The
    `minutes: 1.5` and `hand_steps: 0` refusal cases the round
    called for were already covered by the existing
    `v5-meta-minutes-float.json` and `v5-meta-hand-steps-zero.json`
    fixtures.

## v1.4c Task 6: worksheet facts, matrix + worksheet wasm bindings

- **`JoinFacts.final_join` + the NJ final entry (conductor's call,
  v1.4c Task 6 notes; owner confirmed 2026-11-15):** the plan's
  `worksheet_facts` shape cannot
  represent NJ's three-way `NjFinal`, yet Step 1 requires a 3-taxon
  matrix to give one `JoinFacts`. Resolved: NJ returns one `JoinFacts`
  per `NjStep` plus one appended entry for `NjFinal` — `final_join:
  true` marks it; 5 taxa → 3 entries, 3 taxa → 1. UPGMA returns one
  per `UpgmaStep` (n − 1; 3 taxa → 2). The final entry reads
  `NjFinal`'s own values: `step` = last step + 1, `chosen` = (a, b),
  `tied` = [(a, b)] (no real choice at three nodes — the three pairs
  are not listed), `row_sums` = row sums of `NjFinal.distance` in a,
  b, c order, `len_i`/`len_j` = `la`/`lb`, `new_distances` = [(c,
  `lc`)], `closest`/`chosen_is_closest` computed normally from the
  3×3 distances, `tie_same_split` = false.
- **Facts come from the trace, never recomputed (conductor's call):**
  `worksheet_facts` runs `build_tree(m, method, trace)` and reads
  `chosen`, `row_sums` (= `NjStep.r`), `len_i`, `len_j` and
  `new_distances` (= `new_row` paired with the remaining active nodes'
  names in trace order) straight from the trace. `tied` and `closest`
  apply the engine's exact `==` minimum rule over the trace's own `q`
  (NJ) / `distance` (UPGMA) in lexicographic `(i, j)` scan order — no
  epsilon — so `tied[0] == chosen` always. `tie_same_split` is true
  iff `tied` is exactly two disjoint pairs over four active nodes, the
  same rule for both methods. Node names match
  `state/names.ts::nodeName`: leaf labels or `u<id − leaves + 1>`
  (pinned by `names_match_stepper` and the Vitest stepMatrix check).
- **Tour lazy chunk (owner decision 2026-11-15, option A on PR
  #152):** `web/src/views/App.tsx` is outside Task 6's Files block;
  the task commit pushed initial JS to 120222 gz, 54 over the 120168
  budget, and the owner kept the budget unchanged and made `Tour` a
  lazy chunk on the PhylipHelp / ReplicatePanel / PairPanel /
  BootstrapPanel precedent — the static `import { Tour }` became
  `lazy(() => import("./Tour")…)` and the render sits inside
  `<Suspense fallback={null}>` under the `tourStep !== null`
  condition, so the chunk fetches only when a tour runs. Fresh build:
  initial JS 120222 → 119309 gz; Tour chunk 1398 gz.
- **Files outside the Files block:** none in the task commit — the
  only generated file, `web/src/engine/generated/JoinFacts.ts`, is
  covered by the block's "`web/src/engine/generated/` (regenerated)"
  line. Fix round 1 added `web/src/views/App.tsx` (the Tour lazy chunk
  above).

## v1.4c Task 7: matrix sessions in state and links

- **Conductor's calls implemented (v1.4c Task 7 notes):**
  `longLinkNotice`/`LONG_LINK_CHARS` live in `url.ts` as pure state
  code (no share button exists); `importMatrix` drops every reference
  (lesson or imported); `bootstrapRequested`/autorun is a no-op when
  `!hasAlignment(s)` and `sessionUrlState` never writes `ran: true`
  for a matrix session; `setAnalysis` applies only `method` on a
  matrix session (correction/kappa/site_filter patches are inert and
  the model stays `Supplied`); `sessionUrlState` writes no sim
  override and no correction/kappa/site_filter for a matrix session,
  and a matrix link that carries `sim`, `analysis.correction`,
  `analysis.kappa` or `analysis.site_filter` is a restore error
  naming the field; `importTree` on a matrix exercise keeps the
  exercise's matrix and uses the tree as the comparison reference,
  like embedded data (conductor's call, fix round 1) — on a
  sandbox-imported matrix it still clears `matrixInput` and leaves
  the session like an imported alignment; every transition out of
  the matrix origin clears
  `matrixInput` and every transition in sets `alignment: null`,
  `libraryDataset: null`, step 0 and a reset bootstrap.
- **`imported.matrix + imported.trueTree` in one link is allowed
  (builder's call):** the plan names only `alignment` and `dataset`
  as mutually exclusive with `matrix`. `applyUrlState` replays the
  tree first, then `importMatrix` — which drops the reference — so
  the matrix deterministically wins; `sessionUrlState` can never emit
  that combination (an imported reference always clears `matrixInput`).
- **A matrix session's `alphabet` resets to the exercise's declared
  alphabet (conductor's call, Task 7 notes):** the UI badge shows
  "Distance matrix" for matrix data anyway; `setAlphabet` is a no-op
  there.
- **`matrixIsImported` compares `matrixInput` against `exercise.data`
  value-by-value (builder's call):** a matrix lesson or an unedited
  `#x=` matrix exercise is lesson data — no `imported.matrix` is
  written (`?lesson=`/`#x=` already carry it); an imported or
  grid-edited matrix is user data and travels verbatim.
- **`editMatrix` shares `importMatrix`'s shape (conductor's call:
  "recomputes like `importMatrix` but keeps the name"):** reference,
  `libraryDataset` and bootstrap state clear the same way; it keeps
  `alignmentName` and `source` and does not flip to sandbox.
- **Files outside the Files block:** `web/src/state/lesson.ts` (the
  `apply*` data-transition helpers live there — `applyImportMatrix`,
  `applyEditMatrix`, the `matrixInput` transitions on
  `importAlignment`/`importTree`, the `setAlphabet`/`setAnalysis`
  matrix guards, the
  matrix guard in `reconcileModels`, and the matrix clause of
  `hasImportedData`) and `web/src/state/bootstrap.ts`
  (`bootstrapRequested` must no-op on `!hasAlignment(ctx)`, conductor
  note 3). Both are inside the task's `web/src/state/*` scope.
- **Corpus is generated, not hand-written (builder's call):**
  `v3-matrix-urls.json`'s three cases (a sandbox matrix, a `#x=`
  matrix exercise, a matrix with UPGMA at step 2) were captured by
  driving real sessions through `sessionUrlState` + `encode`, so the
  `matrix` blobs are the engine's `DistanceMatrix` output. The matrix
  carries `0.1+0.2` (0.30000000000000004) and a zero distance, which
  round-trip bitwise through JSON.
- **Fix round 1 (review REQUIRED):** reconciliation now follows the
  session's origin, not `exercise.data.kind` — `Supplied` is never
  touched while the session's data is the matrix, and an action that
  lands the session on alignment data (`importAlignment`,
  `importDataset`) reconciles `Supplied` to the alphabet's default
  with the standard notice instead of stranding a
  ModelAlphabetMismatch. "A matrix link" now means a link that
  restores into a matrix session — `imported.matrix`, or a matrix
  exercise (`#x=`/`?lesson=`) carrying no `imported.alignment` and no
  `ds=` — so a matrix exercise plus imported data restores with its
  reconciled correction. `migrate` carries `dataset` for custom
  (`#x=`) library links and refuses `dataset`+`imported` like the
  `ds=`+`d=` query path (builder's call — a custom exercise's
  `importDataset` session could not otherwise round-trip).
- **`editMatrix(null)` writes no matrix to the link (builder's
  call):** the restore lands on the exercise's own data while the
  screen shows an empty grid; Task 8 owns grid drafts.

## v1.4c Task 8: matrix import UI, matrix sessions, exports

- **Changed existing assertions (conductor's call, v1.4c Task 8
  notes):** the two places allowed, both now assert the matrix route —
  `web/e2e/meg.spec.ts` "ignored commands and a matrix file show
  notices" expects the matrix parser's "expected 1 matrix rows for 2
  taxa, got 2" instead of the old "holds a distance matrix" refusal
  notice, and `web/src/views/ImportPanel.test.tsx` got the same change
  in its ".meg refusal doesn't leak its name" case plus the parametric
  `.meg` test (a detected matrix `.meg` asserts a matrix session or
  the matrix error; the refusal-notice branch is gone). No other
  existing assertion changed.
- **Files outside the Files block:** `web/src/index.css` (the
  `.import-tabs` tab strip styles — the tabs are import-panel chrome,
  not matrix CSS); `web/src/views/matrix/matrix.css` (grid/import
  styling, beside the new components); `web/e2e/meg.spec.ts` (the
  conductor-authorized assertion change);
  `web/src/views/App.matrix.test.tsx` (the new App smoke tests beside
  App); `web/src/views/ImportPanel.test.tsx` (the authorized
  assertion changes, beside ImportPanel); `web/src/export/rscript.test.ts`
  (the matrix R-script pins, beside rscript.ts);
  `web/e2e/__screenshots__/matrix-*.png` — the 12 new baselines the
  plan's Step 4 sanctions.
- **All matrix-only code lazy-loads (conductor's call, v1.4c Task 8
  notes):** `MatrixImport` (which pulls `MatrixGrid`, the question UI
  and `matrix.css`) is a `React.lazy` chunk from `ImportPanel`, and
  `exportMatrixR`, `megMatrix` and the PHYLIP matrix writer are
  dynamic imports inside the export handlers — the initial-JS budget
  keeps its headroom; no existing component had to be deferred.
  (Fix round 1 then deferred `ImportPanel` itself — see below.)
- **Grid commit model (builder's call):** the grid emits on every
  committed edit — `editMatrix` in a matrix session, a local draft
  elsewhere — and only its "Build tree" button turns a draft into
  `importMatrix`. Raw cell text is kept per cell so half-typed input
  is never clobbered by a reseed; `onChange(null)` for an incomplete
  or invalid grid writes nothing to the link, so a reload of an
  incomplete grid shows the exercise's (or last committed) matrix
  reseeded into the grid, not the draft.
- **Ambiguity loop cap = 3 (conductor's call, v1.4c Task 8 notes):**
  questions chain (header before name column) and each is answered
  with one click; after three answers the UI shows "couldn't settle
  the matrix layout" rather than guessing.
- **`!Title`/filename precedence (builder's call):** the matrix
  session's display name is `file.title ?? <picked filename minus
  extension>`; a pasted matrix has no name.
- **Square-name mode is Auto (conductor's call, v1.4c Task 8
  notes):** the matrix UI passes `names: "Auto"` to
  `parsePhylipMatrix` — the strict/relaxed choice stays in the
  alignment import's hands.
- **No grid draft on the link (Task 7 decision, confirmed):**
  `editMatrix(null)` emits `imported` with no matrix, so reload lands
  on the exercise's own matrix while the screen reseeds it.
- Baselines regenerated for the import-panel tabs (owner decision
  relayed by the conductor, PR #154, option A):
  dataset-sheet-1920x1080-light, dataset-sheet-1920x1080-dark,
  gap-partial-1920x1080-light, gap-partial-1920x1080-dark,
  gap-partial-1024x768-light, gap-partial-1024x768-dark,
  gap-partial-768x1024-light, gap-partial-768x1024-dark,
  pair-panel-removed-1920x1080-light,
  pair-panel-removed-1920x1080-dark.

### Fix round 1

- **ImportPanel is a lazy chunk now (builder's call):** the measured
  initial JS was 121,157 B gz, 989 over the 120,168 budget. The
  matrix-only moves — `MatrixSession` (the §6.2 line and the
  empty-tree reason, fetched only inside a matrix session) and
  `MatrixExportItems` (the three matrix export items, fetched only
  while a matrix session renders the menu) — plus the tab-pattern
  rework left the entry chunk over; `ImportPanel` is sandbox-only UI,
  so it rides the standing lazy-sheet precedent (v1.3 Task 14 /
  v1.4b) and is fetched on a sandbox session's first render, not
  with the app. Result: 119,134 B gz. No other existing component
  was deferred.
- **Files outside the Files block (fix round 1):**
  `web/src/export/download.ts` — the blob-download helper, shared by
  `ExportMenu` and the lazy `MatrixExportItems` instead of a private
  copy; `web/src/views/matrix/MatrixExportItems.tsx` and
  `web/src/views/matrix/MatrixSession.tsx` — the two new lazy matrix
  chunks; `web/src/views/matrix/MatrixImport.test.tsx` — the
  `parse_pasted_matrix` engine pin; `web/e2e/matrix.spec.ts` and
  `web/e2e/visualScenes.ts` — the new checks and the scene fix.
- **MatrixGrid's reseed bookkeeping is state, not a ref (review fix
  1):** `emittedKey` became state following the documented "adjust
  state during render" pattern — `react-hooks/refs` forbids ref
  reads/writes in render. Semantics are identical: a round-tripped
  emit serializes equal and never reseeds; a new committed value
  reseeds; a null echo leaves the draft alone.
- **Baselines regenerated again for the reworked import tabs
  (same 10 frames, owner's option A, conductor's call):**
  dataset-sheet-1920x1080-light, dataset-sheet-1920x1080-dark,
  gap-partial-1920x1080-light, gap-partial-1920x1080-dark,
  gap-partial-1024x768-light, gap-partial-1024x768-dark,
  gap-partial-768x1024-light, gap-partial-768x1024-dark,
  pair-panel-removed-1920x1080-light,
  pair-panel-removed-1920x1080-dark.
  (Correction, fix round 2: this bullet said "side-by-side" — wrong.
  The tabs have always stacked one per row, full-width, in the
  320 px drawer and the sidebar; `flex: 1 1 auto` wraps them. No
  tab CSS or import-section layout changed in fix round 2.)
- **Existing tests edited mechanically (no expectation changed):**
  `.import-panel input[type=file]` → `.import-file input[type=file]`
  in a11y/alphabet/gaps/meg/pair-panel/perf-protein/theme specs;
  App.bootstrap/lessons/sandbox/url tests await the lazy ImportPanel
  (`findBy…`).

### Fix round 2

- **The matrix tabpanel mounts whenever the tab is selected (review
  fix A):** the origin-change effect selects the matrix tab when a
  file/paste import lands a matrix session, but `matrixOpened` only
  tracked clicks — the selected tabpanel rendered empty. The panel
  now renders `MatrixImport` whenever `tab === "matrix"` however it
  was selected (click, keyboard, origin change, initial render, URL
  restore).
- **The typing grid moved into a `Sheet` (builder's call — the
  conductor's recommended option):** a 5-taxon table cannot fit the
  200–282 px import column or the 320 px drawer at any viewport, so
  the tab keeps file + paste and gains a "Type a matrix…" button
  that opens the grid in the shared `Sheet` component
  (`MatrixGridSheet`, a lazy chunk inside the already-lazy
  `MatrixImport`, `width: min(760px, calc(100vw - 32px))` — 10 taxa
  fit without horizontal scrolling at 1920×1080, 1024×768 and
  768×1024; wider grids scroll inside the grid's own region). The
  sheet stays mounted once opened (`hidden` while closed) because
  the draft lives only in grid state — an unmount would destroy it.
- **One remove control (builder's call — conductor's first
  suggestion):** a per-row Remove button widened every row; the
  actions row now carries a `Taxon to remove` select plus one
  `Remove taxon` button, no per-row control.
- **Grid commit model, take 2 (review fixes B+C):** every cell,
  name or taxon change emits `onChange(null)` — in a matrix session
  `editMatrix(null)` drops the session's matrix, tree and stepper to
  "complete the matrix" — and only Build tree emits the finished
  `DistanceInput` (`editMatrix` in a session, `importMatrix` outside
  one). The old "emit the complete input on every keystroke" model
  rebuilt the tree on each edit, so the rebuild hint could never be
  true. This supersedes the earlier "Grid commit model" bullet.
- **The rebuild hint only names a real drift (review fix C):** the
  grid remembers the last matrix it committed or was seeded with;
  "The matrix changed — press Build tree to rebuild." shows exactly
  while the on-screen draft differs from that matrix. The old
  unconditional "Taxa changed — press Build tree to rebuild." is
  gone — a fresh fill shows no hint.
- **Files outside the Files block (fix round 2):**
  `web/src/views/matrix/MatrixGridSheet.tsx` — the sheet host
  (new); `web/e2e/visualScenes.ts` — the `matrix-grid` scene now
  shoots the open sheet across the whole viewport instead of the
  grid block element; `web/e2e/narrow.spec.ts` and
  `web/e2e/a11y.spec.ts` — the coarse-pointer and axe checks follow
  the grid into the sheet; `docs/decisions.md` — this entry.
- **Baselines regenerated (only the 12 this PR adds, owner's
  standing rule):** `matrix-grid-*` and `matrix-session-*` at all
  three viewports × both themes — the scene changed shape (open
  sheet instead of the inline grid block; the matrix tabpanel now
  mounts its content on an origin-driven selection).

## v1.4c Task 9: editor matrix route and derive-from-tree

- **Tree changed after deriving → visible warning, not live re-derive
  (conductor's call, per-task notes):** a committed matrix carries
  `derivedFrom` — `engine.writeNewick` of the drawn tree at derive
  time (null for anything typed, pasted or loaded). When the marker
  no longer matches the tree's canonical Newick the form shows "The
  drawn tree changed since this matrix was derived — press Derive
  from the drawn tree again to refresh it." The alternative (the
  matrix silently re-deriving on every accepted edit) was rejected:
  it would overwrite a pasted matrix with no visible change and make
  a committed matrix the user typed something into vanish on the
  next tree edit. A stale matrix is never silently saved — the
  warning stays up until the author re-derives or switches back.
- **A fresh matrix's `data.alphabet` is the selected model preset's**
  (builder's call; the spec requires the field but says only that it
  "describes the distances' source data"): the hidden Model select
  still picks it — JC69/K80/F84/K2P_PHYLIP write `dna`, the protein
  presets write `protein`. An imported matrix file keeps its own
  declared alphabet; a paste, grid or derive commit takes the
  preset's.
- **`meta.hand_steps` needs an existing meta block (builder's
  call):** the editor never fabricates objectives, minutes or level,
  so a hand-worked-joins count on a meta-less file is a clear form
  error, not a silently dropped value. Blank removes only the
  `hand_steps` key; the rest of `meta` rides through `preserved`
  byte-identical.
- **`predict_branch` prompts and preserved bootstrap settings block
  the matrix route** (Review Focus 1 — the form shows what save
  refuses): both are `settingsProblems` errors naming the fix
  (remove the prompt; switch back to simulated data), never silent
  drops of file data.
- **The paste path is a shared hook (conductor's note — "reuse it,
  don't re-implement"):** `web/src/views/matrix/matrixPaste.ts`
  extracts the detect → parse → MatrixAmbiguous-question loop from
  `MatrixImport.tsx` verbatim; the editor's `MatrixData` and the
  import tab both call `useMatrixPaste`, so ambiguity answers,
  the asymmetric-square offer and the 3-question cap are one
  implementation.
- **Files outside the Files block:**
  - `web/src/views/editor/MatrixData.tsx` — the editor's matrix
    route component (new): paste, "Type a matrix…" sheet launch,
    derive + "Round to", the stale-derive line.
  - `web/src/editor/draft.test.ts` — the draft-level tests the
    task's Test block didn't name (matrix serialization, meta,
    hand_steps, mode switching).
  - `web/src/views/editor/SettingsForm.test.tsx` — the form's new
    props (`tree`, `prompts`, `preserved`) needed host updates.
  - `web/src/views/matrix/matrixPaste.ts` — the extracted paste
    hook (new; shared with the editor).
  - `web/src/views/matrix/MatrixImport.tsx` — refactored onto the
    hook; also removed the dead `!tooManyTaxa` guard (optional
    leftover from Task 8).
  - `web/src/views/matrix/MatrixGrid.tsx` — `onChange` emits a
    `draftReady` flag with every null emit, and the stale
    commit-model JSDoc was corrected (optional leftover).
  - `web/src/views/matrix/MatrixGridSheet.tsx` — the `onChange`
    prop type follows the grid's.
  - `web/src/views/matrix/MatrixSession.tsx` — `MatrixEmpty` takes
    `draftReady` so a complete-but-unbuilt draft says "Press Build
    tree to rebuild." instead of "Complete the distance matrix"
    (optional leftover).
  - `web/src/views/matrix/matrix.css` — `.matrix-data` /
    `.matrix-derive-row` spacing inside the editor's settings form.
  - `web/src/state/actions.ts`, `web/src/state/session.ts`,
    `web/src/state/lesson.ts`, `web/src/state/analysis.ts` — the
    `editMatrix` action carries `draftReady` and the session holds
    `matrixDraftReady` for the differentiated empty state.
  - `web/src/views/App.tsx` — passes `session.matrixDraftReady`
    to `MatrixEmpty`.
  - `web/src/index.css` — the `.import-tabs` comment now describes
    the real stacking behaviour (comment-only leftover from Task 8;
    no CSS changed).
  - `web/src/state/matrix.test.ts`, `web/src/views/App.matrix.test.tsx`,
    `web/src/views/matrix/MatrixGrid.test.tsx` — fix round 1 tests
    pinning `draftReady`/`matrixDraftReady` end to end (grid emit →
    `editMatrix` → the empty-state line).
  - `docs/decisions.md` — this entry.
  - `docs/roadmap.md` — the v1.5 editor-autosave bullet (owner
    ruling below).
- **Unsaved matrix drafts ride the existing in-memory draft, not a
  new autosave:** `draftSnapshot` (the dirty-check baseline) already
  serializes `settings`, and the matrix is inside `EditorSettings`,
  so the unsaved-work question and a lab-load decline keep an
  unsaved matrix exactly like any other draft field. No
  localStorage path exists or was added (the task note's "draft.ts
  autosave" is this in-memory draft model).
- **Owner ruling (2026-11-16, PR #155):** the plan's "an unsaved
  matrix draft survives reload" assumed an editor autosave that does
  not exist on main; accepted as not applicable for v1.4c — the
  save/load round trip is pinned instead; editor autosave added to
  the roadmap.
- **Owner ruling (2026-11-16, PR #155):** the hand-worked joins
  field shows only for files that already carry `meta` (schema 5
  requires objectives/minutes/level/prepares_for); custom exercises
  use the default rule.
- **Baselines regenerated for the editor matrix route (owner
  decision, PR #155, option 1A):**
  editor-default-768x1024-light-linux,
  editor-default-768x1024-dark-linux,
  editor-f84-1920x1080-light-linux,
  editor-f84-1920x1080-dark-linux,
  editor-f84-1024x768-light-linux,
  editor-f84-1024x768-dark-linux,
  editor-f84-768x1024-light-linux,
  editor-f84-768x1024-dark-linux,
  editor-f84-1280x800-light-linux,
  editor-f84-1280x800-dark-linux,
  editor-prompts-1920x1080-light-linux,
  editor-prompts-1920x1080-dark-linux,
  editor-prompts-1024x768-light-linux,
  editor-prompts-1024x768-dark-linux,
  editor-prompts-768x1024-light-linux,
  editor-prompts-768x1024-dark-linux,
  editor-prompts-1280x800-light-linux,
  editor-prompts-1280x800-dark-linux — regenerated in the pinned CI
  Playwright image; no other baseline changed.

## v1.4c owner ruling 2A (PR #156, 2026-11-16): heatmap cell digits fit the cell

- **Owner ruling 2A:** the matrix heatmap printed every cell at 3
  decimals, so values ≥ 10 ("15.000") clipped the 34 px cell in matrix
  sessions. `cellDecimals` picks ONE decimal count per displayed
  matrix: 0 when every finite value is an integer; otherwise the
  largest d ≤ 3 such that EVERY finite value's `toFixed(d)` string —
  sign included — is at most 5 characters (fall back to 0 when no
  d ≤ 3 fits). The 5-glyph cap is the fit proxy: measured in the real
  app (pinned-image Chromium, Inter 12 px) every 5-glyph string fits
  the 34 px cell (worst "-9999" at 33.6 px) while 6-glyph strings run
  32.4–37.2 px — "-114.5" fits but "-144.0" doesn't, so the cap is on
  character count, not measured width. Every matrix with all values
  in [0, 10) and not all integers keeps 3 decimals byte-identically;
  saturated cells keep "∞"; the aria-label uses the displayed text.
- **Sign fix (PR #157 review round 1):** the first cut bucketed on
  |v| and never saw the minus sign, so non-integer negatives
  ("-82.50" ≈ 37 px, "-148.5" ≈ 35 px — the normal shape of a Q view
  for a pasted non-integer matrix) still overflowed. The rule above
  counts the sign via `toFixed(d)` length; as a side effect it also
  fixes the pre-existing "-0.450" overflow in alignment Q views
  (now "-0.45"). The e2e cell-width check gained a pasted .5 matrix
  whose Q view holds non-integer negatives (all steps, both views;
  `nonadditive6.phy` was rejected — its Q view is all-integer) and an
  nj-basics lesson pass in Q view.
- **Files:** `web/src/views/matrix/cellDecimals.ts` (new — the lint
  rule `react-refresh/only-export-components` forbids a non-component
  export from `MatrixHeatmap.tsx`), `web/src/views/MatrixHeatmap.tsx`,
  `web/src/views/MatrixHeatmap.test.tsx`, `web/src/views/App.test.tsx`
  (the Q-toggle assertion now formats at `cellDecimals` instead of a
  hard-coded 3), `web/e2e/matrix.spec.ts`,
  `web/e2e/__screenshots__/matrix-session-{1024x768,768x1024,1920x1080}-{light,dark}-linux.png`
  — all 6 frames regenerated in the pinned CI image: the four
  1024×768/768×1024 frames in the original commit,
  matrix-session-1920x1080-light-linux and
  matrix-session-1920x1080-dark-linux in fix round 1 (they had changed
  within the 0.001 tolerance and were regenerated explicitly), this
  entry.

## v1.4c Task 10: matrix lessons, lesson metadata, numbers-in-text test

- **`lesson_premises.rs` is a new test file** (conductor note: no
  lesson-premise test existed under `crates/neophylo-core/tests/`):
  matrix lessons build their `DistanceMatrix` through
  `DistanceInput::to_distance_matrix`; simulated/embedded lessons keep
  the parse → simulate/compute path. `saturation` fails `compute` by
  design (deliberately saturated sim), so `adding_meta_changes_nothing_else`
  compares the whole `Result` — both sides fail identically.
- **The complement-tie join uses a `note`, not `predict_pair`
  (conductor's decision):** `PromptCard`'s grader accepts only the
  engine's chosen pair, so at nj-by-hand join 2 (two tied pairs, same
  split) a `predict_pair` would mark a correct alternative wrong. The
  tied join gets a `note` placed at the join explaining that two pairs
  tie and both give the same tree; `predict_pair` sits only at joins
  whose engine step has `tie: false` (join 1), never at the final
  three-way join. Pinned by
  `predict_pair_prompts_target_tie_free_non_final_joins`. The note's
  "first tied pair in scan order" sentence is kept only because
  `nj_by_hand_tied_join_picks_the_first_pair_in_scan_order` pins the
  engine's chosen pair at join 2 to the first tied pair in
  lexicographic scan order (fix round 1). Owner
  question: add a tie-aware grader in a later task?
- **The catalog carries only `id`/`title`/`summary`** (owner ruling —
  the initial-JS budget is never raised): `catalog.ts` now uses named
  JSON imports (`import { id, title, summary } from "../../exercises/x.json"`),
  which tree-shake the file bodies out of the initial chunk; `loadLesson`
  still fetches `/exercises/<id>.json` at pick time.
- **`meta` for the six lessons:** objectives written from each lesson's
  own prompts; minutes/level estimated (intro 15–25 min, intermediate
  15–25 min). `prepares_for` per the plan: `nj-basics` → `dnadist-neighbor`;
  `bootstrap-basics` → `seqboot-consense`, `mega-bootstrap-100`;
  `protein-models` → `protdist-neighbor`; `cytochrome-c` → `protdist-neighbor`;
  `saturation` → `mega-jc69-vs-k2p`; `upgma-fails` → `upgma-vs-nj-matrix`,
  `mega-nj-vs-upgma`. New lessons: `nj-by-hand` intro 20 min → `nj-basics`,
  `dnadist-neighbor`; `upgma-vs-nj-matrix` intro 20 min →
  `mega-nj-vs-upgma`. `every_prepares_for_id_exists` pins every id.
- **`upgma-vs-nj-matrix` notes stay true after the switch:** the
  invite-to-switch note is conditioned on "with NJ, …" phrasing so it
  does not assert NJ's result once the student may already be on UPGMA.
- **Existing tests edited** (the one allowed kind — strip only `meta`,
  set the version the test already sets, nothing else differs):
  - `exercise_v2.rs::v1_lessons_identical` — `meta` deleted from the
    parsed doc before the v1 comparison.
  - `exercise_v3.rs::repo_exercises_v3_twins_load_identically` — `meta`
    deleted before the v3 twin load.
  - `exercise_v4.rs::repo_exercises_load_as_v4_unchanged` — `meta`
    deleted before the v4 load.
  - `exercise_v5.rs::repo_exercises_load_and_reserialize_unchanged` —
    `meta` deleted before the load (the test still asserts no `meta`
    is fabricated on serialize); the two new lessons added to the list.
  - `schema.test.ts::every exercises/*.json declares schema_version 5` —
    assertion renamed 2 → 5: the test pins repo lessons at the current
    schema version, which is now 5.
  - `exerciseFile.test.ts` `round-trips exercises/%s` — `meta` stripped,
    non-matrix files reloaded at 3, matrix lessons round-trip at 5;
    `no v4 fields saves schema 3 as today` — `meta` stripped, reloaded
    at 3.
  - `draft.test.ts` `import → save preserves uneditable fields` — matrix
    exercises pass a placeholder Newick to `buildExerciseState`; the
    drawn tree is unused on the matrix save route.
  - `catalog.test.ts` ORDER — the two new lesson ids added in teaching
    order (nj-by-hand first, upgma-vs-nj-matrix after upgma-fails).
  - `lessons.test.ts` — the matrix `expect.fail` branch replaced with
    real checks (leaf count from `names`, final-join and prompt-range
    checks); not a skip.
  - `LessonsMenu.test.tsx`, `App.lessons.test.tsx` — positional menu
    expectations re-pointed at the same lessons in the 8-item order.
  - `Controls.test.tsx::keeps every built-in exercise's model menus
    unchanged` — matrix exercises pass `alignmentOrigin: "matrix"` and
    assert the simulation/correction menus are absent (matrix sessions
    hide them); non-matrix assertions unchanged.
- **Files outside the Files block:**
  - `crates/neophylo-core/tests/{exercise_v2,exercise_v3,exercise_v4,exercise_v5}.rs` —
    the allowed meta-stripping edits above (the task names the file
    family, not each test file).
  - `web/src/lessons/schema.test.ts`, `web/src/lessons/catalog.test.ts` —
    schema-version pin and catalog ORDER for the new lessons.
  - `web/src/editor/exerciseFile.test.ts`, `web/src/editor/draft.test.ts` —
    save-path tests that reload repo lessons now at v5.
  - `web/src/views/LessonsMenu.test.tsx`, `web/src/views/App.lessons.test.tsx`,
    `web/src/views/Controls.test.tsx` — menu order and matrix-origin
    fallout from adding two lessons.
  - `web/e2e/lesson-picker.spec.ts` — its ORDER list names every lesson
    in teaching order, so the two new lessons had to be added there
    (same fallout as `catalog.test.ts` ORDER).
  - `docs/decisions.md` — this entry.

### Task 10 — fix round 2 (PR #156)

- **Owner ruling (2026-11-16):** `nj-by-hand` keeps `predict_pair` only
  at join 1; the complement-tie join 2 stays a `note`. A tie-aware
  `predict_pair` grader (accept any min-Q pair with `tie_same_split`,
  from the engine) is deferred — added to `docs/roadmap.md` under v1.5.
- **Owner ruling (2026-11-16):** the matrix heatmap's clipped two-digit
  values get a small view fix in a separate PR, not this one.
- **Owner ruling (2026-11-16):** `nj-by-hand` has no reference tree; the
  "No true tree" comparison placeholder stays.
- **Owner ruling (2026-11-16):** the lessons menu order stays —
  `nj-by-hand` first, `upgma-vs-nj-matrix` right after `upgma-fails`.

### Task 11 — worksheets, answer keys and instructor gate

- **QR encoder:** uqr 0.1.3 from npm (exact pin; owner decision on
  PR #158), MIT, recorded in `THIRD_PARTY_NOTICES.md` (and therefore in
  the generated `licenses.html`). Encoding is verified against a
  known-good published test vector rather than an installed decoder.
- **Files outside the Files block:**
  - `web/src/worksheets/qr.ts` — thin local wrapper over the uqr
    encoder plus the text fallback rule; kept out of `build.ts` per the
    single-purpose/≈400-line file rule.
  - `web/package.json`, `web/package-lock.json` — the uqr 0.1.3
    dependency pin (added in fix round 2 per the owner decision).
  - `web/src/views/worksheets/blocks.tsx` — the matrix/blank/QR render
    primitives shared by `WorksheetPage` and `KeyPage`; without it both
    pages would duplicate the block markup and exceed ~400 lines.
  - `web/src/views/worksheets/load.ts` — lesson/lab/custom-exercise
    resolution and canonical link building shared by both pages.
  - `web/src/views/worksheets/steps.ts` — per-join rendering context
    (active clusters, per-step matrix, Q table) derived from the engine
    trace; shared by sheet and key so the two stay aligned.
  - `web/src/views/worksheets/instructor.ts` — the gate's storage
    contract (`neophylo.instructor` = "1" in sessionStorage); kept out
    of `InstructorGate.tsx` per the single-purpose rule (missed in the
    original list; added in fix round 1).
  - `web/src/views/worksheets/worksheets.css` — worksheet/key page
    styles including print blank sizing.
  - `web/src/views/worksheets/worksheets.test.tsx` — page-level unit
    tests (gate session rule, storage failure, no-answer-leak DOM
    checks); the plan named only `build.test.ts`.
  - `web/e2e/visualScenes.ts` — new scene definitions live there; the
    Files block listed only the `*.spec.ts` runners.
  - `web/e2e/__screenshots__/worksheet-*` — the 32 new snapshot
    baselines those scenes require (no existing baseline changed).
  - `docs/decisions.md` — this entry.
- **Deviations from the plan template (fix round 1):**
  - Mistake lines carry a "Join N:" prefix ("Join 1: picking d–e
    because their distance is smallest.") where the plan's template
    has none — the prefix names which join the mistake belongs to.
  - The sheet's finish line is conditional: when every join is
    hand-worked it says "check your tree in NeoPhylo" instead of
    "let it run the remaining joins" (no remaining joins exist).
  - A closest pair that is one of the join's `tied` pairs is a
    correct answer: the key's verdict says "tied with the join, also
    correct" and such pairs produce no mistake line; the plan's
    mistake rule only named "the closest pair" as the wrong pick.

### Task 12 — library page and `?labs`

- **Conductor's calls, as implemented:**
  - The closed app header is pixel-identical: the ≥ 1280 `Labs` link is
    untouched, and the "Library" entry is an action item inside the
    Lessons dropdown and the More menu only — both closed in every
    existing frame. `Header.tsx` gained only prop wiring.
  - "Open dataset" on a card is a plain `?ds=<id>` link — the same
    restore path as a shared link. The unsaved-work question lives
    where work can actually be lost: the in-app Lessons/More menu
    Library entry asks "Leave your unsaved work?" (DatasetSheet's
    Sheet and keep/confirm pair, worded for a leave since nothing is
    replaced) only while the sandbox holds user data; a clean
    session navigates directly. The plan's
    "including the unsaved-work prompt" for card opens resolves this
    way because a `?ds=` navigation lands on a fresh page with nothing
    to lose.
  - The library header links to `?guide`; the route itself is Task 13,
    so no `GuidePage` or `?guide` route exists yet — the link goes live
    when Task 13 lands.
  - `?labs` keeps its short URL until the visitor changes a filter;
    the filter state then rewrites to the canonical `?library&…` via
    `history.replaceState`. The heading reads "Labs" while the type
    set is exactly {phylip, mega} and "Library" otherwise.
  - Unknown filter values are ignored: a non-empty `type=` list with
    no valid entries (`type=foo`) falls back to every type, and an
    unknown `level=` means "all". The explicit empty `type=` the page
    writes when all four type boxes are unticked is the exception —
    it means "no types" and round-trips through a reload; a filter
    state with zero matches shows "No items match these filters."
  - Lesson `meta` reaches the page through an eager `?raw` glob inside
    the lazy chunk (the same pattern as `labs/registry.ts`), so
    `lessons/catalog.ts` keeps its three-string imports and the initial
    bundle keeps its budget; "follows" is derived at runtime as the
    reverse of `prepares_for` over lessons and labs, and both lines
    link to the targets' `?lesson=`/`?lab=` routes.
  - Items without a `level` (every lab and dataset today) are hidden
    by any level filter other than "all"; items without minutes are
    hidden by "≤ 30 min" — pinned by unit tests.
  - `LabIndex` is a thin wrapper: `?labs` renders `LibraryPage` with
    `{phylip, mega}` preselected; `LabPickList` is unchanged for the
    editor, and `LabPrintStyles`/`lab-print` keep the dark-session
    print behaviour byte-for-byte. No `labs.spec.ts` expectation was
    weakened — the two added assertions only pin the new worksheet/key
    actions on a lab card.
- **Files outside the Files block:**
  - `web/src/views/library/items.ts` — the registry→card assembly and
    the URL filter helpers; split from `LibraryPage.tsx` under the
    single-purpose/≈400-line rule.
  - `web/src/views/library/library.css` — the filter bar, tag and
    dataset-line styles; a page stylesheet like every other view.
  - `web/src/views/App.tsx` — the conductor-note unsaved-work confirm
    sheet and the `onOpenLibrary` callback the header wiring calls.
  - `web/e2e/perf-load.spec.ts` — the conductor-required "library
    chunk is not in the initial load" assertion (Task 11 pattern).
  - `web/e2e/sheets.spec.ts` — the More-menu item list assertion
    names every menuitem; "Library" joined it between Labs and the
    tour (a one-line addition, no expectation weakened).
  - `web/e2e/visualScenes.ts` — the new `library` and `library-labs`
    scene definitions live there; `visual.spec.ts` consumes them.
  - `web/e2e/__screenshots__/library-*` — the 12 new snapshot
    baselines for the two new scenes (no existing baseline changed).
  - `docs/decisions.md` — this entry.

#### Task 12 — fix round 1 (PR #159)

- `parseFilters` treated the explicit empty `type=` the page writes
  for the all-boxes-unticked state as "no valid entries → every
  type", so a reload lost the empty selection. Empty now decodes to
  no types and any zero-match filter state shows "No items match
  these filters."; a `type=` of only unknown values (`type=foo`)
  still falls back to every type.
- The in-app unsaved-work prompt was reworded for a leave, not a
  replace: heading "Leave your unsaved work?", buttons "Leave and
  open the library" / "Keep my work". DatasetSheet's own "Replace
  your unsaved work?" is unchanged.
- `web/e2e/visualScenes.ts` added to the files-outside list above
  (the scene definitions live there; `visual.spec.ts` consumes
  them).
- `web/src/views/library/items.test.ts` — new unit file for the
  parseFilters/filtersQuery round-trips; outside the Files block
  like the other test files.

#### Task 12 — fix round 2 (PR #159)

- Owner request (2026-11-17, chat via conductor): lab settings tables
  collapse in the library, open on ?labs, print expanded.

### Task 13 — instructor guide; MEGA Adaptive note

- **Conductor's calls, as implemented:**
  - `?guide` is a lazy route like `?library`: the raw guide markdown
    (Vite `?raw`, `docs/instructor-guide.md`), the item registries it
    reads minutes from and ajv all defer until the route is visited —
    the initial bundle gains only the Root.tsx import stub. The
    outside-`web/` import needs no config change: exercises JSON and
    lab `?raw` globs already import from the repo root the same way.
  - The handout renderer (`Md`/`MdBlock`/`inline`) moved verbatim out
    of `LabPage.tsx` into `web/src/views/labs/Md.tsx` so the guide
    renders "like handouts". LabPage output is byte-identical: the
    unit suite plus a registry pin (no shipped `handout_md`/note field
    contains `](`) keep it that way.
  - The renderer learned `[text](href)` — for internal hrefs only.
    `web/src/links.ts` whitelists exactly the app's own routes
    (`?lesson=`/`?lab=`/`?worksheet=`/`?key=` with id and `kind`,
    `?library` with the filter params `filtersQuery` writes, `?labs`,
    `?editor`); every other target — `http:`, `javascript:`, `data:`,
    `//`, bare paths, unknown params — renders as literal text. No
    `dangerouslySetInnerHTML` anywhere.
  - The plan lists carry no typed minutes: GuidePage detects the
    all-link ordered list in each plan section (`planItemHrefs`),
    reads each item's minutes through the same `buildItems()`
    resolution the library cards use (`meta.minutes` for lessons,
    `lab.minutes ?? meta.minutes` for labs), shows it inside the
    item's link and appends a computed `Total: N min` line. The
    §8.2 numbers-in-text scan was extended to the guide file; the
    only allowed constants are the plan headings' "50-minute" and
    "3-hour".
  - 50-minute class plan: upgma-fails (15) + nj-by-hand (20) +
    upgma-vs-nj-matrix (20) = 55 (within ±5). 3-hour lab plan:
    nj-basics (20) + dnadist-neighbor (25) + seqboot-consense (40) +
    mega-bootstrap-100 (35) + mega-interpreting-support (30) +
    mega-nj-vs-upgma (30) = 180.
  - Touch: plan items are whole-row block links (≥40×40 under
    `(pointer: coarse)`). Inline prose links cannot take block height
    in a paragraph, so their hit area grows with vertical padding on
    the inline box instead — measured ≥40×40 in the hasTouch e2e.
  - The guide's `##` sections become the page's h2s (the markdown's
    `#` is the h1); handout-level h3/h4 mapping stays a lab-markdown
    concern. Plan `ol`s are named by their section heading via
    `aria-labelledby`.
- **MEGA Adaptive check (conductor's check — NOT an owner sign-off):**
  - MEGA 12.1.4 (build 12261022, Linux): the analysis-preferences
    pick lists compiled into the GUI binary (`/usr/lib/mega/mega`)
    give Neighbor-Joining's "Test of Phylogeny" the options "None",
    "Bootstrap method", "Interior-branch test"
    (`TestBootIntBranchPickList`). The Adaptive options appear only
    in the Maximum Likelihood lists: `StdAdaptiveBootPickList`
    ("None", "Standard Bootstrap (slow)", "Adaptive Bootstrap
    (fast)") and `LittleBootPickList` (… "Adaptive Bootstrap
    (medium)", "Little Bootstraps (fast)"). MEGA's bundled help
    ("What's New") describes the adaptive bootstrap as applying "when
    using the Maximum Likelihood approach".
  - `mega-bootstrap-100` is an NJ lab, so the GUI offers no Adaptive
    replicate option on its run step → no handout sentence is added;
    `exercises/labs/mega-bootstrap-100.json` is unchanged.
  - Pending: the owner confirms in the MEGA 12 GUI (Phylogeny →
    Construct/Test Neighbor-Joining Tree → Test of Phylogeny list) at
    this PR's gate. If the GUI shows Adaptive for NJ after all, the
    one-sentence handout note is a follow-up.
- **Files outside the Files block:**
  - `web/src/links.ts` + `web/src/links.test.ts` — the internal-href
    whitelist the renderer shares with the guide tests, plus the
    `mdBlocks`/`markdownLinks`/`planItemHrefs` markdown helpers.
  - `web/src/views/labs/Md.tsx` + `web/src/views/labs/Md.test.tsx` —
    the extracted shared renderer and its link/keep-out tests.
  - `web/src/views/labs/LabPage.tsx` — now imports `Md` from the
    shared module (rendered output unchanged).
  - `web/src/views/guide/guide.css` + `web/src/views/guide/links.test.ts`
    — the page's stylesheet and the §7.5 link-resolution/plan-timing
    test.
  - `web/src/lessons/content.test.ts` — the §8.2 numbers-in-text scan
    extended to `docs/instructor-guide.md`.
  - `web/e2e/labs.spec.ts` — `?guide` added to the dark-session
    light-print loop (the same print-colour checks the handouts use).
  - `web/e2e/narrow.spec.ts` — the guide's 375/320 px header-controls
    and no-sideways checks (the conductor note's "record if needed").
  - `web/e2e/perf-load.spec.ts` — the "guide chunk is not in the
    initial load" assertion (the Task 11/12 lazy-route pattern).
  - `web/e2e/library-page.spec.ts` — the `?guide` click-through and
    the guide's ≥40×40 coarse-pointer check.
  - `web/e2e/visualScenes.ts` — the new `guide` scene definition;
    `visual.spec.ts` consumes it unchanged.
  - `web/e2e/__screenshots__/guide-*` — the 6 new snapshot baselines
    for the new scene (3 viewports × 2 themes; no existing baseline
    changed).
  - `docs/decisions.md` — this entry.

#### Task 13 — fix round 1 (PR #160)

- R1: the 50-minute plan ran 5 over its slot — third item swapped to
  `saturation` (15+20+15 = 50, intro rewritten to match; a conductor's
  call pending the owner's guide review) and links.test.ts now pins
  each plan's registry total to slot−5 ≤ total ≤ slot.
- R2: the library bullet claimed every card carries level/minutes/
  objectives/worksheet/key links — corrected: lesson and lab cards do,
  dataset cards show source and license and open the dataset.
- R3: one worked worksheet/key pair linked in "What an answer key
  contains" (`?worksheet=nj-by-hand&kind=paper` /
  `?key=nj-by-hand&kind=paper` — the Task 13 Interfaces forms, already
  whitelisted in links.ts).
- S1: GuidePage.test.tsx iterates the markdown's `## ` blocks for the
  section-heading assertions (all six now covered, gate section
  included) instead of a typed list.
- S2: the editor bullet reworded — the derived thing is the matrix,
  not the tree.
- S3: the Round-to bullet now says what the UI does — the warning
  shows whenever a rounding is set (MatrixData.tsx), not only when the
  distances stop fitting.
- S4: `.guide-md h2` set to `--size-lg` so `##` headings out-rank the
  body text (guide.css only; the h2 moved inside `.guide-md`; lab
  pages untouched).
- S5: the guide header's two nav links grouped in `.guide-nav-links`
  on the right (guide only; LabPage/LibraryPage headers unchanged).

## v1.4c Task 14: release checkpoint, roadmap, CITATION

- **Release tag:** `v1.4.2` proposed in the checkpoint and
  `CITATION.cff`; `date-released` untouched (2026-11-14) — the owner
  confirms the name and tags.
- **The WebKit `d=` race (main CI run 44070866339, `e2e (webkit, 2)`,
  `matrix.spec.ts:720`)** — fixed in fix round 1: the share URL was
  written by a passive `useEffect` (`history.replaceState` in
  `web/src/views/App.tsx`) after the render that painted the tree, so
  a matrix session could show its tree while the address bar still
  held the previous link. The sync is now a `useLayoutEffect` — the
  URL is written during the commit, before the new view paints — with
  no change to the deps or the guard. Nothing in the app reads
  `window.location` in a way that relied on the old ordering:
  `urlRestore.resolveInitial` and the tour's `#x=` check read it
  inside the mount-time restore effect (always before any write, since
  the sync early-returns while `session === null`), the long-link
  notice reads the memoized `urlText` not `location`, and
  `worksheets/load.ts` runs on the worksheet/key routes where `App`
  never mounts. The ordering is pinned by
  `web/src/views/App.urlSync.test.tsx`: a `<Profiler onRender>`
  callback runs during the commit — after the subtree's layout
  effects, before passive effects — so reading `window.location`
  there is the jsdom stand-in for the painted frame (any `act`-flushed
  trigger fires passive effects too early to tell the two apart;
  verified failing on `useEffect`, passing on `useLayoutEffect`). The
  e2e `toHaveURL` waits stay as the deterministic wait for the settled
  link. No longer a v1.5 owner decision — see checkpoint §15.
- **Fix round 1 follow-ups:** the checkpoint §15/runbook wording now
  names the Chromium-only items — the §6 and §12 `.meg` downloads and
  the §2/§14 worksheet/key PDFs (S2 also listed §6 explicitly; §12 is
  the same describe-level `test.skip`, named too for accuracy). §2/§14
  in `scripts/checkpoint/browser/release.spec.ts` follows the sibling
  lab print tests: the `emulateMedia('print')`/luminance checks run on
  every engine and only `page.pdf` is Chromium-gated. The
  `preflight.sh` usage comment names the current release like
  `run.sh`. §6's ticked item cites
  `matrix_parse.rs`/`matrix_parse_props.rs` for the
  `write_meg_matrix` round trip — `meg.rs` is the sequence-`.meg`
  suite; every other cited test name was grep-verified.
- **Paper-worksheet id list:** the eight ids in the checkpoint's §2
  are the `paperSheet` rule (printable matrix, ≤ 8 taxa) resolved over
  the committed exercises — verified with a scratch vitest enumeration
  of `buildItems`/`paperSheet` (removed afterwards); every other id's
  `kind=paper` route asserts its own in-app-only message, so a
  drifting set flags itself in the checker.
- **Files outside the Files block:**
  - `web/e2e/matrix.spec.ts` — the mandated WebKit investigation's
    fix: every immediate `page.url()` assertion after a state change
    now waits on `toHaveURL` (the `replaceState` effect could lag the
    paint on WebKit before fix round 1). Fix round 1 updated the
    comment only — the wait stays.
  - `web/e2e/share.spec.ts` — the same read-once pattern after the
    step advance; now waits for `lesson=nj-basics&s=1` in the URL.
    Fix round 1 updated the comment only — the wait stays.
  - `web/e2e/presenter.spec.ts` — fix round 1, comment only: the URL
    sync is no longer a post-render effect.
  - `web/src/views/App.tsx` — fix round 1: the mandated product fix,
    the URL sync moved to `useLayoutEffect`.
  - `web/src/views/App.urlSync.test.tsx` — fix round 1: the mandated
    regression test.
  - `scripts/checkpoint/browser/release.spec.ts` — fix round 1: §2/§14
    print checks on every engine, `page.pdf` Chromium-only.
  - `scripts/checkpoint/preflight.sh` — fix round 1: usage comment
    names the current release.
  - `docs/release-checkpoint.md` — the runbook's "This release" table,
    commands, owner-pass items, release fields and the "Automation
    map" repointed at `v1.4c-release.md` (its own header invites the
    per-release update). Fix round 1 updated the Chromium-only wording
    and dropped the stale-link ruling row.
  - `docs/decisions.md` — this entry.

### Fix round 2

- **A thrown worksheet/key load lands in the error state, never an
  unhandled rejection (product fix, checkpoint §2):** Firefox's pass
  logged `pageerror: NetworkError when attempting to fetch resource`
  when the checker clicked the §2 gate and navigated to the next key
  before the gated page's lesson fetch finished — the abort rejected
  the async effect in `KeyPage`/`WorksheetPage`, which had no
  `catch`. Both pages now land the rejection in their existing
  "could not be loaded" error state while the page lives and drop it
  after unmount; `web/e2e/worksheets.spec.ts` pins it by aborting the
  wasm fetch and asserting the error UI with zero page errors.
- **Files outside the Files block (fix round 2):**
  `web/src/views/worksheets/KeyPage.tsx` and
  `web/src/views/worksheets/WorksheetPage.tsx` — the product fix
  above; `web/e2e/worksheets.spec.ts` — its test;
  `scripts/checkpoint/browser/playwright.config.ts` — an optional
  `CHECKPOINT_PROXY` env setting so a sandboxed run can route the
  browsers through a filtering proxy (direct stays the default).
  `docs/decisions.md` — this entry.

### Fix round 3 (owner-approved, 2026-11-17)

- **K4/K5 engine change — approved exception to "Task 14 is not an
  engine task":** `write_meg_matrix` in
  `crates/neophylo-core/src/matrix_parse.rs` now writes MEGA's own
  layout (the owner's control file B: `!Title:` with a colon, a
  `!Description` block, `[i] #name` labels, the bracketed column-index
  header and `[i]`-prefixed rows) because the GUI crashed on the old
  layout; `parse_meg_matrix` strips `[…]` comments like MEGA does, so
  it reads both layouts. `mega_verify.py`'s matrix reader accepts
  both. Exact-output assertions that changed only for the new layout:
  `write_meg_matrix_round_trips` (matrix_parse.rs test, extended to
  pin the new lines) and the `!Title wiki5_lower;` → `!Title:
  wiki5_lower;` assertion in `web/e2e/matrix.spec.ts`.
- **K1/K2 print fit and page margins:** `TreeView` gains a `printFit`
  prop — while print media is active the finished tree on answer keys
  refits inside the A4 printable width (680 px = 180 mm, the shared
  15 mm `@page` in `LabPrintStyles`) at the same ≥12 px text floor;
  index.css's `@media print` rule is the scale-down net behind it.
  `LabPrintStyles` now emits `@page { size: A4; margin: 15mm; }` for
  every print page (worksheets, keys, lab pages, lab index, library,
  guide), and the checker's `page.pdf` calls set
  `preferCSSPageSize: true`.
- **Files outside the Files block (fix round 3):**
  `crates/neophylo-core/src/matrix_parse.rs` and
  `crates/neophylo-core/tests/matrix_parse*.rs` — the approved engine
  exception above; `web/src/views/TreeView.tsx`, `web/src/index.css` —
  the shared print fit; `web/src/views/labs/LabPrintStyles.tsx` — the
  shared `@page`; `web/src/views/worksheets/KeyPage.tsx`,
  `web/src/views/worksheets/WorksheetPage.tsx`,
  `web/src/views/worksheets/worksheets.test.tsx` — K1 prop wiring and
  K7; `web/src/views/matrix/MatrixGrid.tsx`,
  `web/src/views/matrix/MatrixGrid.test.tsx` — K3;
  `web/e2e/worksheets.spec.ts`, `web/e2e/matrix.spec.ts` — the new and
  updated e2e assertions; `web/e2e/visualScenes.ts` — the
  worksheet-key-print scene now waits out the print refit before the
  frame, so the snapshot can't race it; `printFit` also reconciles
  `matchMedia("print").matches` on a light interval because emulated
  print media doesn't always dispatch the query's change event.
  `scripts/checkpoint/browser/release.spec.ts` — the K1 print
  assertion, K2 `preferCSSPageSize` and K6 `visitPage` font settle;
  `scripts/checkpoint/mega_verify.py` — the both-layouts matrix
  reader; `docs/decisions.md` — this entry.
- **Snapshot frames regenerated (fix round 3):**
  `web/e2e/__screenshots__/matrix-grid-*-{light,dark}-linux.png` at
  all three viewports (K3 — the new hint line above the grid) and
  `worksheet-key-print-1920x1080-light-linux.png` (K1 — the printed
  finished tree now refits to the page). The other three
  worksheet-key-print frames were not rewritten: their captures
  passed inside `maxDiffPixelRatio: 0.001` against the committed
  baselines. Those baselines still showed the pre-fit wide tree —
  corrected in fix round 4; the claim here that they "already showed
  the print-fit appearance" was wrong (the refit region is too small
  a share of the full-page frame to trip the tolerance). No other
  frame changed. `matrix-grid-1920x1080-light-linux.png` was
  regenerated a second time inside the pinned CI image
  (`playwright:v1.64.1-noble@sha256:7852dc5a…`): the first capture was
  shot on the host, whose textarea line-wrap differs from the image's
  by a few pixels, and the visual job flagged it. All 185 frames pass
  in the image after the regen.

### Fix round 4 (owner-approved, 2026-11-17)

- **N1 stale baselines — three more key-print frames regenerated in
  the pinned CI image:** `worksheet-key-print-1920x1080-dark-linux.png`
  and `worksheet-key-print-768x1024-{light,dark}-linux.png` were
  byte-identical to their pre-round-3 baselines and still showed the
  pre-fit wide finished tree; the full-page frames passed only
  because the refit region stayed under `maxDiffPixelRatio: 0.001`.
  All three were re-shot inside
  `playwright:v1.64.1-noble@sha256:7852dc5a…` (the round-3 wording
  above corrected in the same PR).
- **N2 duplicate grid hint merged:** `MatrixGrid`'s caption and the
  round-3 row-1 hint said nearly the same thing on two lines; they
  are now one line — "…each row holds one taxon's distances to the
  taxa above it; the first row is just a name." — which is both the
  table's `aria-labelledby` and its `aria-describedby` target.
  `MatrixGrid.test.tsx` updated. All six `matrix-grid-*` frames were
  regenerated in the pinned image (the merged caption shifts the
  sheet in every viewport × theme).
- **N3 records only:** checkpoint §16 now lists the lab-print
  scale-down floor (very wide lab trees can print under 12 px via
  the CSS `max-width` fallback — deferred to v1.5, owner
  2026-11-17), the `bootstrap: null` deferral and the §15 WebKit
  ruling (no Apple device; the automated WebKit pass covers it; the
  box stays unticked). `docs/roadmap.md` gained the v1.5 bullet for
  the lab-print refit.
- **Files outside the Files block (fix round 4):**
  `web/src/views/matrix/MatrixGrid.tsx`,
  `web/src/views/matrix/MatrixGrid.test.tsx` — N2;
  `web/e2e/__screenshots__/` — the regenerated frames listed above;
  `docs/checkpoints/v1.4c-release.md`, `docs/roadmap.md` — N3;
  `docs/decisions.md` — this entry.

### Fix round 7 (owner finding, 2026-11-18)

- **G1 matrix `.meg` blank line crashes the MEGA 12 GUI:**
  `write_meg_matrix` emitted one empty line after the
  `!Description … ;` block (the round-3 K4 layout). The owner's hand
  check isolated the GUI hang/crash to exactly that line — the file
  with only that line removed opens and builds NJ, while re-padded
  6-wide columns with the line kept still crash. MEGA-CC accepts the
  line either way, so the automated matrix checks never saw it. The
  writer now ends the description with a single `\n` and emits no
  blank lines anywhere; the parser is unchanged and still reads
  pre-round-7 files. New tests in
  `crates/neophylo-core/tests/matrix_parse.rs`:
  `write_meg_matrix_wiki5_exact_bytes` (the owner-confirmed wiki5
  output, byte for byte), `write_meg_matrix_emits_no_blank_lines`
  (wiki5 plus every matrix oracle) and
  `parse_meg_matrix_reads_blank_line_variant` (old and new output
  both round-trip).
- **Files outside the Files block (fix round 7):**
  `crates/neophylo-core/src/matrix_parse.rs` and
  `crates/neophylo-core/tests/matrix_parse.rs` — the same engine
  exception as fix round 3 (owner-approved MEGA-layout work);
  `docs/checkpoints/v1.4c-release.md` (§16 bullet),
  `docs/decisions.md` — this entry.
- **Follow-up for the owner (not done):** `write_meg` (the alignment
  `.meg`) also emits one empty line after its `!Format` command —
  it has no `!Description` block, and §12's earlier hand check
  passed, so it was left alone; flagging in case the owner wants it
  stripped too.

## conductor Task 0a: judge script, waits, prompt builder, usage report

- **Port, not copy:** `scripts/conductor/*` is ported from the read-only
  Epiora reference (`.conductor-ref/epiora/scripts-conductor/`). Check ids,
  order, patterns and paths are NeoPhylo's from the plan: `fixtures`,
  `numbers`, `assertions`, `skips`, `files-block`, `engine-rules`,
  `content-numbers`, `protected-paths`, `secrets`, `diff-stat`, `pr-events`,
  `owner-gate` — exactly those 12, in that order, on stdout; the
  parsed-file count and any diff-fetch error go in the report header.
- **`node --test scripts/conductor/` does not run on Node 24**: Node treats
  the directory itself as a test file — it tries to run it and reports one
  failing test; it never scans the directory. `scripts/check.sh` runs the
  equivalent `node --test "scripts/conductor/*.test.ts"`.
- **`wait-ci.sh` additions over the Epiora port:** polls until checks
  register (empty check-runs is not "green"), detects a moved head SHA or a
  merged-PR mid-wait and exits 3 with `HEAD MOVED`, and on failure prints
  failing job names plus the last 40 lines of each failed log.
- **`devin.sh` keeps `DEVIN_CMD`, the `REPO` default and `app-env.sh`
  sourcing unchanged** (per task notes). It now wraps the body in `main()`,
  rejects an empty prompt before invoking Devin, saves prompt + full output
  under `~/neophylo-conductor/<version>-task<N>/`, prints only the last 30
  lines plus de-duplicated `PR_URL:`/`STOP:` lines, and restores the
  starting checkout only when the tree has no tracked changes.
- **Usage baseline is transcribed, not regenerated:** the numbers in
  `docs/conductor/usage-baseline-2026-11-18.md` are copied from
  `.conductor-ref/usage-baseline.{txt,json}` (the authoritative supplied
  baseline). The doc notes that Task-0a attribution keys on
  `devin.sh`/`build-prompt.sh`/`neophylo-conductor` paths (E6), so a re-run's
  task columns can differ from the Epiora-script run.
- **Files outside the Files block:**
  `scripts/conductor/conductor-shell.test.ts` — the Files block names only
  `judge.test.ts`; the shell-wrapper tests (wait-ci/build-prompt/devin
  stubs on PATH) were split out to keep every file under the ~400-line
  rule, same split the reference keeps between its test files.

## conductor Task 0b: lean context, bounded waits, headless per-task runs

- **Port, not copy:** `run-plan.sh`, `wait-for.sh`, `result.sh`,
  `headless-tools.txt`, `.claude/agents/log-reader.md` and the
  `run-plan.test.ts` suite are ported from the read-only Epiora reference
  (`.conductor-ref/epiora/`); `~/neophylo-conductor` paths, the
  `*neophylo-<v>-*.md` plan glob and NeoPhylo's allow list replace
  Epiora's.
- **`/inbox` between tasks:** the plan adds a headless `/inbox` session on
  Sonnet before each next task (absent in the reference). A nonzero
  inbox rc stops the run and notifies — a missed `conductor: hold` is
  worse than a stopped loop.
- **First-turn context, measured by the conductor on 2026-11-18** (plain
  CLI, `claude -p "Reply with OK only." --model opus --output-format
  json --settings <file>`, input + cache-write + cache-read of the first
  turn, main at 3c95cd1; transcribed from the task's pending notes, not
  re-measured — the `claude` CLI is not in the Devin sandbox):
  - current settings: **46,351** (2 + 21,718 + 24,631)
  - + `disableClaudeAiConnectors: true` + `enabledPlugins
    {"superpowers@synced": false}`: **39,263** (−7.1k)
  - + deny `Artifact`, `Workflow`, `ScheduleWakeup`, `ReportFindings`,
    `ShareOnboardingGuide`, `ListAgents`: **21,096** (−18.2k more;
    −54.5 % total)

  `claude -p "/context"` breakdown, current → final: total 34.3k →
  12.5k; System tools 16.9k → 0.7k; System tools (deferred) 23.1k →
  16.3k; MCP tools 0.6k → 0; MCP server instructions 2.4k → 0; MCP
  tools (deferred) 30.2k → 0; Skills 6.1k → 5.1k; System prompt
  2.8k → 2.5k; Memory files 4.2k → 4.2k.

  What settings cannot remove in T3 Code: T3's own system-prompt
  sections (runtime info, PR-linking and orchestration instructions) and
  the `t3-code` MCP server's ~80 deferred tools; user-level
  skills/plugins (graphify, ste80-humanizer) and memory files. To be
  confirmed in the first T3 Code session after merge (plan Target).
- **0a follow-up (owner-approved, PR #163):** `judge` `diff-stat` unions
  the `git diff --stat` blocks of ALL saved
  `~/neophylo-conductor/<v>-task<N>/{task,fix}-*.out.md` for the task, not
  only the newest, so files from earlier commits don't FLAG after a fix
  round; `review-*.out.md` is never scanned (a running review session
  has no stat block yet). A file in the PR claimed by no session, or
  claimed but absent from the PR, still FLAGs; an unparseable or
  abbreviated stat block is a FLAG naming the .out.md, never a PASS.
- **Files outside the Files block (the 0a follow-up):**
  `scripts/conductor/judge.ts`, `scripts/conductor/judge-checks.ts`,
  `scripts/conductor/judge-checks-gates.ts` (the diff-stat section moved
  here to keep judge-checks.ts under the ~400-line rule),
  `scripts/conductor/judge.test.ts`,
  `scripts/conductor/fixtures/judge/claimed-abbreviated.out.md`,
  `scripts/conductor/fixtures/judge/claimed-unparseable.out.md`.
- **Files outside the Files block (fix round 1):**
  `scripts/conductor/footer.md` and `scripts/conductor/build-prompt.sh` —
  a bare `git diff --stat` abbreviates long paths as `.../…`, which the
  diff-stat check FLAGs, so both now ask for
  `git diff --stat=400 --stat-name-width=400`;
  `scripts/conductor/conductor-shell.test.ts`
  covers the prompt text. The files-block bare-name fix touches the 0a
  follow-up's `scripts/conductor/judge-checks.ts`,
  `scripts/conductor/judge.test.ts`,
  `scripts/conductor/fixtures/judge/plan.md` (new fixture Task 4) and the
  new `scripts/conductor/fixtures/judge/bare-root-pass.diff` /
  `scripts/conductor/fixtures/judge/bare-root-flag.diff`.

## v1.4d Task 1: skills map, decisions, architecture

- **Spec:** `docs/superpowers/specs/2026-11-18-neophylo-v1.4d-tree-reading-design.md`;
  plan `docs/superpowers/plans/2026-11-18-neophylo-v1.4d-plan.md`; market and
  viability check `docs/market/2026-11-18-market-and-viability.md`.
- **Roadmap changes (owner, 2026-11-18):** tree reading moved before v1.5 as
  **v1.4d** — intro biology is the largest market, tree reading is the
  easiest work to auto-grade, and research favours reading trees before
  building them; the **v1.6 slot is now empty**.
- **Decided in this plan:** see the plan's "Decided in this plan" list —
  `CladeKey` (a node's sorted, deduplicated tip labels as a JSON array;
  `"root"` resolves to the full tip set); module layout
  `reading/{mod,query,traits,set,answer,variant}.rs` with `ChaCha8Rng`;
  `NeoError::InvalidReading` naming item and field; limits of 3–40 tips per
  tree, 1–4 trees per item, tips-up trees ≤ 12 tips, 1–60 items per set,
  ≤ 20 traits per tree; item text refers to taxa only through `{a}`/`{b}`/
  `{c}`/`{set}` placeholders; explanations built in Rust from fixed English
  templates; labels over 18 characters abbreviated by the layout; 300 ms
  rotation animation (none under `prefers-reduced-motion`); ids `trees-…` and
  `cov-…`, routes `?read=`, `#r=`, `?library&type=reading`, and
  `?worksheet=`/`?key=` accepting reading ids, extension
  `.neophylo-reading.json`; library `TypeKey` gains `"reading"`; R oracle
  scope (`ape`/`phangorn` plus a `nodepath`-based script) — built-in content
  is checked by engine tests, not by fixtures.

## v1.4d Task 3: engine tree queries and trait states

- **Query semantics pinned by tests and the oracle:** `find_clade` matches
  leaves too (a single-label key names that tip), so `is_clade` treats a
  single tip as a clade like `ape::is.monophyletic`; `is_ancestor` is a
  *proper* ancestor test; `restrict` roots at the kept tips' MRCA and
  suppresses unary nodes (dropping lengths — every reading tree is a
  cladogram); `order_consistent` without ages accepts every linear
  extension of the ancestry order and with ages requires non-increasing
  ages keyed by `CladeKey` (a node missing from the map refuses the
  order); `origins_shared` is true when one gain's `on` clade contains
  both tips.
- **Files outside the Files block:**
  - `scripts/ci/fixture-guard.sh` — owner-requested follow-up to Task 2
    (PR #166): the `FIXTURES=1` regeneration step also runs
    `Rscript fixtures/generate_reading.R` and names
    `fixtures/ref/reading` and `fixtures/inputs/reading` in the
    `git diff --exit-code` and untracked-file checks, so the reading
    oracle is byte-stability checked in CI like the other fixtures. No
    workflow or fixture edits.
  - `web/src/engine/generated/NeoError.ts` — regenerated by the ts-rs
    `export_bindings` tests (not hand-edited): `NeoError` gained the
    `InvalidReading` variant, and `scripts/ci/wasm.sh`'s
    `git diff --exit-code web/src/engine/generated` requires the
    committed file to match the generated output.
  - `crates/neophylo-core/tests/reading_query_props.proptest-regressions`
    — proptest's saved-seed file for the new props target; committed per
    the file's own recommendation and the existing `*_props.*-regressions`
    convention.
  - `web/src/explain/errors.ts` and `web/src/explain/errors.test.ts` —
    the generated `NeoError` union gained `InvalidReading`, and the
    explainer's exhaustive `never` check requires a case (and its test
    entries) for every variant (fix round 1).
  - `docs/decisions.md` — this entry.

## v1.4d Task 4: reading sets — format, answers, check, variants

- **Files outside the Files block:**
  - `scripts/ci/fuzz.sh` — added `reading_set` to the fuzz target list so
    the `FUZZ=1` smoke covers the new target.
  - `crates/neophylo-core/tests/lesson_premises.rs` — widened the
    exercise-scan skip from `"schema.json"` to `*.schema.json`: the plan
    pins `exercises/reading.schema.json` as a second non-lesson JSON in
    `exercises/`, and the premise scan assumed every `.json` file there
    is a lesson (`doc["id"].as_str().unwrap()` panicked on the schema).
    The premise itself is unchanged.
  - `web/src/engine/generated/*.ts` (20 files: `Accepted`, `AnswerKey`,
    `Item`, `NodeAge`, `NodeLetter`, `Point`, `PointAt`, `Question`,
    `ReadingMode`, `ReadingSet`, `ReadingTree`, `RelForm`, `Response`,
    `Shape`, `Statement`, `Style`, `TipSide`, `TraitAsk`, `TraitDef`,
    `Verdict`) — regenerated by the ts-rs `export_bindings` tests, not
    hand-edited; `Times` has no export (manual serde; the `times` field
    carries an inline `#[ts(type)]`).
  - `crates/neophylo-core/src/reading/mod.rs` — wired the three new
    modules and re-exports; the Files block lists only the new files,
    but they are unreachable without it.
  - `web/src/editor/{draft,exerciseFile}.test.ts`,
    `web/src/lessons/{catalog,content,lessons,schema}.test.ts`,
    `web/src/state/session.test.ts`,
    `web/src/views/Controls.test.tsx` — same one-line widening as
    `lesson_premises.rs`: each scanned `exercises/*.json` while
    excluding only `schema.json`, so the new `reading.schema.json` was
    loaded as a lesson/exercise. Changed `f !== "schema.json"` to
    `!f.endsWith("schema.json")`; no assertions changed.
  - `web/e2e/library-page.spec.ts`, `web/e2e/worksheets.spec.ts`,
    `web/src/views/library/LibraryPage.test.tsx`,
    `scripts/checkpoint/browser/release.spec.ts` — the same widening
    again in fix round 2: each still excluded only `schema.json`, so
    `reading.schema.json` was counted as a lesson (e.g. the library
    spec's `.lib-card` count expected 21, received 20). Changed
    `f !== "schema.json"` / `f === "schema.json"` to
    `endsWith("schema.json")`; no assertions changed.
  - `docs/decisions.md` — this entry.
- **Ambiguities resolved:**
  - `rotate` flips a seeded coin per internal node and reverses its
    children; `shuffle_tip_order` applies a seeded Fisher–Yates shuffle
    per internal node (spec §5.4 pins determinism and answer invariance,
    not the exact permutation method).
  - `relabel` permutes each `taxa_pool` list itself (bijection on the
    pool's names) with a seeded shuffle; a name in several pools takes
    the first pool's image (map order), names in no pool are fixed.
    Authored `Statement::text` is not rewritten.
  - Choice-index conventions pinned in `answer.rs`: `which_differs`
    options are `trees[0..n]` plus "all show the same" at index `n`;
    `is_clade` 0/1; `by_trait` 0=mono/1=para/2=poly;
    `ancestral_or_derived` 0/1; `homologous` 0/1.
  - `Accepted`/`Response` serialize adjacently (`{"kind":…,"value":…}` /
    `{"kind":…,fields}`) — serde's internal tag cannot hold a bare
    `CladeKey` payload.
  - `node_desc` picks the two child subtrees with the smallest minimum
    leaf labels for "the node joining x and y", so explanations are
    byte-identical under `rotate`/`shuffle_tip_order` (required by the
    §5.5 invariance property on whole `AnswerKey`s).
- **Fix round 1 (PR #169 review):**
  - `gained_within` on one shared branch follows the listed-order
    semantics `tip_states` already uses: the statement is true when
    `outer`'s gain is listed before `inner`'s on that branch, false when
    `inner` comes first.
  - `taxa_pool` lists must be disjoint and duplicate-free — relabelling
    would merge taxa otherwise (`relabel_map` also refuses a
    non-injective map defensively for sets that never went through
    `load_reading_set`). Refusals name `taxa_pool.<pool>`.
  - `which_fits.small` needs 2–4 entries (spec §4.3 "Given 2–4 small
    rooted trees"); `exercises/reading.schema.json`'s `minItems` matches
    and `sem-fits-none.json` now lists two small trees so it still tests
    the zero-fitting-candidates refusal.
  - `place_taxon` requires exactly one `at:"branch"` point on the answer
    clade's stem branch (field `sister`, the same bare-field convention
    as `mrca`'s `options` uniqueness check).
- **Fix round 3 (PR #169 owner-requested refactor):**
  - `crates/neophylo-core/src/reading/set.rs` was split into `set.rs`
    (file types, limits, error helpers, clade-key serde),
    `question.rs` (`Question`/`RelForm`/`Statement`/`TraitAsk`),
    `resolve.rs` (`ResolvedTree`, `resolve`, `resolve_tips`,
    `resolve_raw`, `normalize`, `item_trees`), `load.rs` (`scan*`/`take`/
    `load_reading_set`), `validate.rs` (item/question validation) and
    `validate_statement.rs` (statement/ask validation); `answer.rs` into
    `response.rs` (wire types), `answer.rs` (`answer`/`answer_question`
    and the small helpers), `differs.rs`, `trait_answer.rs`,
    `statement.rs` and `check.rs`. Pure move for AGENTS.md's ~400-line
    rule, at the owner's request; only visibility keywords
    (`pub(crate)`) and `use` blocks changed, plus three rustfmt
    signature re-wraps. These file names sit outside the plan's
    `{mod,query,traits,set,answer,variant}.rs` module layout.
  - `crates/neophylo-core/src/reading/variant.rs` — its
    `use crate::reading::set::{Question, Statement, TraitAsk, …}` import
    had to follow `Question`/`Statement`/`TraitAsk` into
    `crate::reading::question` (import-only change, forced by the move).
- **Fix round 4 (PR #169 fuzz smoke):**
  - `crates/neophylo-core/fuzz/seeds/reading_set/*` — outside the Files
    block; the six `valid-*.json` test inputs copied byte-for-byte as
    committed seeds so `scripts/ci/fuzz.sh`'s `seeds/reading_set` arg
    resolves.

## v1.4d Task 6: layout for the reading styles

- **Files outside the Files block:**
  - `web/src/layout/readingGeom.ts` — shared internals for the two
    placement files (padding/radius constants, the rotated label-box
    helper, name abbreviation, nice tick steps, clade keys). Split out
    under AGENTS.md's ~400-line / one-algorithm-per-file rule:
    `readingLayout.ts` alone would be ~460 lines.
  - `web/src/layout/readingCircular.ts` — the rooted circular
    placement (330° arc, radial labels), a distinct algorithm from the
    flat rectangular/diagonal placement; called by `readingLayout`.
  - `docs/decisions.md` — this entry.
- **Ambiguities resolved:**
  - Tips-up/down tip labels are drawn at ±80° off horizontal
    (`TIP_LABEL_SLANT_DEG`), satisfying §6's slanted-label rule for
    tips-up diagonal trees while staying upright enough to avoid
    overlapping neighbours; the leaf spacing grows to the widest
    rotated label box plus a gap so boxes never collide.
  - `axis.ticks[].at` is the screen coordinate along the depth axis:
    an x for tips-right/left, a y for tips-up/down; circular trees get
    no axis (a linear axis has no meaning on a radial drawing).
  - `marks[].angle` is the branch's direction in degrees (0 = toward
    +x): the mark's bar is drawn across it; `points[].x/y` is the node
    position for `at:"node"` and the stem midpoint for `at:"branch"`.
  - `scroll` is `width > box.width`; tips-right/left shrink the depth
    scale to fit like `phylogram.ts`, tips-up/down and circular keep
    their natural size and scroll when they exceed the box (spec §6:
    never squeeze text below 12 px).
  - `node.label` in the figure is only a tip's (abbreviated) name;
    internal nodes are identified by `letter`, matching the view's own
    split.

## v1.4d Task 7: tree-reading tree component

- **Files outside the Files block:**
  - `web/src/views/reading/reading.css` — the component's styles
    (scoped `rt-*` classes; the plan's file list does not name a
    stylesheet, but the token-discipline rule forbids inline literals).
  - `web/src/views/reading/readingDraw.tsx` — the visible draw layer
    (edges, node dots and letter badges, tip labels, points, trait
    marks, axis). Split out under AGENTS.md's ~400-line /
    single-purpose rule: `ReadingTree.tsx` alone would be ~860 lines.
  - `web/src/views/reading/readingHelpers.ts` — shared non-component
    helpers (hit-pad constants, `anim`/`animD` transitions,
    `pointOffsets`, `describe`); kept out of the component files
    because eslint's react-refresh rule only allows component exports.
  - `web/src/views/reading/readingHits.tsx` — the point and branch hit
    layers (same reason as readingDraw).
  - `web/e2e/reading-harness.html`,
    `web/src/readingHarness{,App}.tsx` — a dev-server-only harness page
    (`/e2e/reading-harness.html`) that mounts `ReadingTree` through
    the real engine path (`loadReadingSet` + `readingTree`). The
    component has no route until Task 8, and Vite's only build input
    is `index.html`, so neither the harness nor the component can
    enter the initial bundle (§8.2 budget preserved by construction).
  - `web/e2e/__screenshots__/rt-*.png` — 50 new baselines for the nine
    new scenes, generated inside the pinned Playwright image as the
    plan requires; no existing baseline was touched.
  - `docs/decisions.md` — this entry.
- **Files the block lists as Modify but unchanged:**
  - `web/e2e/visual.spec.ts` — the scene matrix already covers the new
    scenes (name × viewport × theme loop is driven by
    `visualScenes.ts`); no change was needed.
- **Ambiguities resolved:**
  - "8-tip tree in each shape × side" is one `rt-styles` grid scene
    showing all twelve shape × tip-side combos of the same 8-tip
    showcase tree, rather than twelve separate scenes; per-feature
    scenes (letters, points, marks, both axes, polytomy, fossil) are
    separate.
  - The vertical (tips-up/down) axis fits its 30 px reserved strip by
    keeping numbers horizontal and rotating the unit/older/younger
    captions along the strip; the horizontal axis keeps horizontal
    captions.
  - Rotation animates node positions and edge `d` at 300 ms
    ease-in-out, skipped under prefers-reduced-motion; hit groups ride
    the same transform so targets stay under the pointer mid-rotate.
  - A point letter stacked on a lettered node is offset perpendicular
    off the tip axis with a leader line (the layout returns both at
    the same coordinates and collision is not its job).
  - Hit pads are 40.05 px — WebKit quantizes layout to 1/64 px, so an
    exact 40 measures back as 39.99 (same trick as TreeView's pads).
  - Post-CI fix: `fig` is laid out on every render (as in TreeView)
    instead of a mount-time `useMemo`, because the memoised figure
    could be computed with fallback font metrics before the bundled
    faces resolved — four first-pass `rt-*` baselines had captured the
    fallback layout and failed in CI. A Vitest regression test pins
    "no layout before the fonts gate opens".

## v1.4d Task 8: reading trees area

- **Files outside the Files block:**
  - `web/e2e/visualScenes.ts` — the scene table `visual.spec.ts`
    iterates; the block names `visual.spec.ts` but the scenes
    themselves are declared in `visualScenes.ts`, so the new
    `reading-*` scenes and the `readItem`/`gotoReadItem` helpers were
    added there (same split Task 7 used).
  - `web/src/views/reading/ItemView.tsx` — the item screen
    (trees, controls, verdict, nav) extracted from `ReadingPage.tsx`;
    the page file would be ~480 lines against AGENTS.md's ~400 rule.
  - `web/src/views/reading/QuestionControlsTree.tsx` — the
    pick-on-the-tree controls (order_nodes builder, selection list)
    extracted from `QuestionControls.tsx` for the same line rule.
  - `web/src/reading/errors.ts` — the reading-area NeoError text
    (`InvalidReading` field + message, LabPage's InvalidExercise
    convention), shared by the page and the item view.
  - `web/src/views/reading/reading.css` — the `.read-*` page, control
    and summary styles are appended to the reading area's existing
    stylesheet rather than a new file; also carries the `<600px`
    `.read-trees` `flex-wrap: nowrap` fix (a wrapping column flex let
    the figure escape the viewport).
  - `web/e2e/__screenshots__/reading-*.png` — 62 new baselines for the
    15 new scenes, generated inside the pinned Playwright image; no
    existing baseline was touched.
  - `docs/decisions.md` — this entry.
- **Files the block lists as Modify but unchanged:**
  - `web/e2e/visual.spec.ts` — the scene matrix already covers the new
    scenes (name × viewport × theme loop driven by `visualScenes.ts`).
- **Ambiguities resolved:**
  - "Question screen per type" is 13 `reading-q-*` scenes (one per
    `Question` kind in the demo set) plus `reading-feedback` (practice
    verdict + explanation + note_after), `reading-summary` (test-mode
    results), and the owner-requested
    `reading-tipsup-12-long-names-360` — each at 360×740 and 1024×768
    in both themes except the owner scene, which is 360×740 only per
    the request. All scenes navigate the real `/?read=` route, not
    the dev harness.
  - `?read=<id>` loads a built-in set through the registry's lazy JSON
    import; `#r=<compressed>` decodes an lz-string payload
    `{ v: 1, set }` — both land in the same `ReadingPage` chunk, which
    is lazy-imported in `Root.tsx` so the initial-JS budget is
    unchanged.
  - Selection responses are stored as clade keys / point ids, not
    screen positions, so `rotate` inside `ReadingTree` keeps a picked
    biological clade selected without the page tracking orientation.
  - Two-tier responses are stored as a local `ResponseDraft` — the
    engine's `Response` except `first` may be `null`, "inner
    unanswered" (`Response::Pairwise` has no untouched value; "B" is
    a real answer). `submittable` gates Check on `first !== null`,
    and `effectiveResponse` — the only draft→`Response` path — maps
    any draft still holding the marker to `null`, so the marker can
    never reach `readingCheck`; the summary treats those items as
    unanswered. (Fix round 1: the earlier `emptyResponse` inner
    placeholder fabricated `Pairwise("B")` and pre-selected the "B"
    radio.)
  - `trees-demo.json` has `id: "trees-demo"` and is excluded from
    `listReadingSets()` so it never appears in the library (Task 9).

### Fix round (owner-ordered, 2026-11-20): shared-branch trait marks

- **Layout rule for marks sharing one branch** (`readingMarks.ts`,
  called from `readingLayout.ts`): marks on the same resolved node are
  grouped in input order. A branch with exactly one mark keeps the
  historical midpoint placement — identical `x`/`y`/`angle` and the
  same `MARK_HALF + 4` label offset — so lone-mark figures are
  bit-identical. For n ≥ 2 marks on a stem, `placeMarks` spreads them
  deterministically along the stem direction (diagonal = straight
  parent–child segment, rectangular = the node's horizontal or
  vertical stem per tip side, circular = the radial segment), spacing
  them by measured adjacent label widths plus glyph clearance and
  clamping to the usable stem extent. When the stem cannot fit the
  same-row spacing, labels stack perpendicular to the stem instead of
  overlapping. Every mark now carries `labelX`, `labelY` and a
  `labelBox` (the existing `Box`/`intersects` measure used by tip
  labels); `readingDraw.tsx` renders the text at the layout-provided
  anchor instead of the fixed offset. If stacked labels or left-of-pad
  labels leave the figure, `placeMarks` reports a growth/shift and
  `readingLayout` translates all geometry (nodes, marks, circular
  centre, axes) and grows `width`/`height` — `scroll` semantics are
  unchanged (still natural width vs box width).
- **Baselines regenerated (the only scenes containing ≥2 marks on one
  branch):** `reading-q-trait-{360x740,1024x768}-{light,dark}-linux.png`
  (4 files) — trees-demo item 14's `traits` tree puts `hair` and `fur`
  gains on the same (bat,cat,dog) stem. A full pinned-image run of all
  `rt-*` and `reading-*` scenes against the committed baselines before
  regenerating showed these four as the only diffs; no `rt-*` baseline
  changed (`rt-marks` has one mark per branch).
- **New baselines (allowed, new scenes only):**
  `reading-marks-same-branch{,-up}-360x740-{light,dark}-linux.png`
  (4 files) — a new `#r=` scene set renders the traits tree through the
  real reading area with three marks on one stem (`hair`/`fur` gains +
  `claws` loss, plus a lone `wings` on `bat`), tips-right and tips-up
  at 360×740 in both themes. The scene setup asserts 4 marks and
  pairwise non-overlapping label bounding boxes on screen.
- **Files outside the Files block:**
  - `web/src/layout/readingLayout.ts` — the shared-branch grouping
    call, the `labelX`/`labelY`/`labelBox` fields on figure marks, and
    the growth/shift application (owner explicitly ordered the fix
    here; the earlier "do not touch readingLayout" note was scoped out
    by the owner's override).
  - `web/src/layout/readingMarks.ts` — new file: the mark-placement
    algorithm, extracted so `readingLayout.ts` stays near the ~400-line
    single-purpose rule.
  - `web/src/layout/readingGeom.ts` — `MARK_HALF`/`MARK_GLYPH`
    moved here from `readingDraw.tsx` so the layout module can compute
    mark extents without importing the renderer.
  - `web/src/layout/readingLayout.test.ts` — new test functions only
    (no existing assertion edited): 2- and 3-mark groups on one branch
    across every shape × tip side on an 8-tip tree (pairwise distinct
    anchors, non-intersecting `labelBox`es, input order preserved), a
    lone-mark placement test (`x`/`y`/`angle` = `branchMid`), a
    different-branch regression test, and the trees-demo `traits`
    six-mark case asserting hair/fur separation, in-bounds labels and
    no label overlap.
  - `web/src/views/reading/readingDraw.tsx` — only the label anchor:
    text now uses `m.labelX - m.x`, `m.labelY - m.y` (identical to the
    old fixed offset for lone marks); constants now imported from
    `readingGeom.ts`.
  - `web/e2e/visualScenes.ts` — the `reading-marks-same-branch{,-up}`
    scenes and their `marksSharedBranch` setup helper.

### Fix round 2 (owner-ordered): mark labels beside their own glyphs

- **Placement rule replaces the stack** (`readingMarks.ts`): the prior
  round's fallback stacked a shared branch's labels perpendicular to
  the stem when the stem could not hold the slots — on a short
  vertical stem the labels climbed away from their glyphs
  (`reading-marks-same-branch-up` showed `fur` ~25 px and `claws`
  ~60 px from their marks, `hair` drawn through `fur`'s arrowhead).
  Now every shared mark gets its own slot along the stem and its label
  sits BESIDE the stem level with that glyph — above a horizontal
  stem, toward the roomier figure edge of a vertical or diagonal one —
  offset so the label box's facing edge is exactly `LABEL_GAP` off the
  glyph's projected extent. When the stem cannot hold n slots plus a
  node-clear margin, `placeMarks` reports `stretch` and
  `readingLayout` re-runs node placement with the extra depth extent
  (flat shapes) or extra tip radius (`readingCircular.ts`'s new
  `extraRadius`); the figure grows and `scroll` keeps its
  width-vs-box meaning. A stem the depth scale cannot lengthen still
  falls back to the `grow` shift/widen. Lone marks keep the midpoint +
  `MARK_HALF + 4` label offset bit-identically.
- **Glyph boxes are real geometry:** `markGlyphBox` (exported for the
  tests) builds the mark's AABB from the same constants the renderer
  draws — `MARK_HALF` bar, `MARK_GLYPH * 1.6` gain arrowhead,
  `MARK_GLYPH` loss circle — rotated by the stem angle.
- **Tests strengthened, no existing assertion edited**
  (`readingLayout.test.ts`): 2- and 3-mark groups (gain/loss mixes)
  on one branch across all 12 shape × tip-side combinations on both
  the 8-tip tree and the trees-demo `traits` topology assert (i) no
  label box intersects any glyph box, (ii) every label's nearest glyph
  is its own, (iii) shared labels never overlap another mark's label,
  (iv) every mark and label stays inside the figure; a vertical-stem
  test pins labels level with their glyphs on one side.
- **Baselines regenerated — only the allowed families:**
  `reading-marks-same-branch{,-up}-360x740-{light,dark}-linux.png`
  (4 files) and `reading-q-trait-360x740-dark-linux.png` (1 file). A
  pinned spec run showed all other baselines unchanged: `rt-marks`
  (all lone marks) stays pixel-identical in all six frames, and the
  three other `reading-q-trait` frames and both
  `reading-tipsup-12-long-names-360{,-end}` scenes diff under the 0.001
  ratio (the traits stem's hair/fur labels shift a few px).
- **Files outside the Files block:**
  - `web/src/layout/readingCircular.ts` — `extraRadius` input and the
    used tip radius `R` returned for the stretch re-layout.
  - `web/e2e/visualScenes.ts` — `marksSharedBranch` now waits for the
    300 ms swap transition (`document.getAnimations()` empty) before
    the on-screen label-overlap check, so it sees settled positions
    instead of mid-flight ones.
- **Pre-existing, unchanged:** a lone mark on a vertical stem still
  centres its label on the stem (`wings` in the tips-up scene sits on
  the branch line) — the single-mark path is byte-identical and
  `rt-marks`/`reading-q-trait` baselines confirmed it is the
  historical placement, not part of this fix.
## v1.4d Task 9: entry points — header and library

- **Header link placement** (ambiguity resolved against the plan's
  "header link 'Reading trees' → ?library&type=reading (in MoreMenu
  below 1024 px)"): read literally the link is direct at ≥ 1024, but
  the measured min-content of the header row at 1024 became 1050 px
  with the ~114 px chip (the `.app` grid column stretched to fit,
  pushing `.prompt-card` 2 px past the viewport — the same break the
  v1.4c Task-11 fix round found for "PHYLIP labs"). The link is
  therefore direct only at ≥ 1280, like the Labs chip and owner
  decision B's one-path-per-width rule: the More menu owns it below
  1024 (the plan's stated placement), and the Lessons menu's action
  row carries the same target at every width, both routed through
  `onOpenReading` so the unsaved-work question runs identically.
  Fix round 1: the direct link keeps its `href` for modified clicks
  (open in a new tab) and routes plain primary clicks through
  `onOpenReading`, so it asks over unsaved work like the Library
  entry rather than leaving a dirty sandbox silently.
- **Files outside the Files block:**
  - `web/src/views/App.tsx` — the guarded navigation target: the
    `libraryAsk` confirm state now stores the destination string
    (`?library` or `?library&type=reading`) instead of a boolean, so
    one "Leave your unsaved work?" sheet serves both entries;
    `onOpenLibrary`/`onOpenReading` are thin wrappers over a shared
    `openLibrary(target)` and `onOpenReading` is passed to `Header`.
  - `web/src/index.css` — `.reading-link` shares the `.labs-link`
    chip styles, and `a.reading-link` joins the coarse-pointer
    ≥40×40 floor (`[role="menuitem"]` already covers the menu rows).
  - `web/e2e/sheets.spec.ts` — the More-menu item-list assertion
    gains "Reading trees" between "Library" and "Take the tour"
    (CI caught the stale expectation; the spec is the menu's
    canonical order oracle).
  - `docs/decisions.md` — this entry.
- **Files the block lists as Modify but unchanged:**
  `web/e2e/visual.spec.ts` — the scene/viewport matrix needed no
  change; only its baselines moved.
- **Baselines** (regenerated in the pinned image, the only task that
  changes existing frames): the app-header frames at 1920×1080 —
  11 scenes × light/dark plus `bootstrap-basics-final-presenter`
  (23 files) — both library scenes at all three viewports
  (12 files), and `editor-preview`'s two wide frames × light/dark
  (4 files; its popup shows the header, and `EDITOR_VIEWPORTS`
  adds 1280×800 — CI caught the missed scene). The link is absent
  below 1280, so every app scene's
  1024 and 768 frames stay byte-identical to main's (the few the
  first pass rewrote were pixel noise; main's bytes pass — same
  finding the v1.4c Task-11 round recorded).

## v1.4d Task 10: editor reading mode

- **Files outside the Files block:** the block names three `.tsx`
  components, but the ~400-line / single-purpose rule and the task's
  helper surface (draft↔set shaping, tap→field mapping, annotate
  tools) forced a split inside the same `reading/` directory:
  - `web/src/views/editor/reading/readingDraft.ts` — draft types,
    `buildWireSet`/`draftFromSet`, the one-item `probeSetJson` probe
    that powers `resolveTreeView`, and `canvasClade` (canvas node id
    → tip labels → `readingCladeOf`).
  - `web/src/views/editor/reading/readingItems.ts` — the question
    type catalogue, `newQuestion`/`newItem` shells, `pickTargetsFor`
    and `applyPick`.
  - `web/src/views/editor/reading/readingExtras.ts` — the annotate
    tools (`letter`, `age`, `mark`, `point-node`, `point-branch`)
    and `applyExtra`.
  - `web/src/views/editor/reading/fields.tsx` — shared field
    controls (`Field`, `Text`, `Num`, `CsvField`, `PickedField`).
  - `web/src/views/editor/reading/QuestionFields.tsx` — per-question
    -type item fields (the `ItemForm` sub-form).
  - `web/src/views/editor/reading/StatementFields.tsx` — the
    select_true statements editor.
  - `web/src/views/editor/reading/TraitAskFields.tsx` — the trait
    ask editor.
  - `web/src/views/editor/reading/TraitDefsForm.tsx` — trait display
    names (split out of `TreeExtrasForm`).
  - `web/src/views/editor/reading/TreeSlot.tsx` — one stored tree's
    card (split out of `ReadingEditor`).
  - `web/src/views/editor/reading/SetBasicsForm.tsx` — the actions
    row, notice, global error and Set fields (split out of
    `ReadingEditor`).
  - `web/src/index.css` — `.editor-mode` (the mode radio group) and
    the `.rde-*` form styles, matching `.prompt-item`/`.settings-form`
    conventions.
  - `docs/decisions.md` — this entry.
- **Ambiguities resolved:**
  - `loadReadingSet` refuses an empty `items` array ("a set needs
    1–60 items"), so Share/Save/Preview gate on the whole set
    loading, and a fresh draft stays disabled until its first valid
    item — same gate pattern as the exercise editor's
    `settingsProblems`.
  - An `InvalidReading` with a non-empty `item` is shown inside that
    item's card; item-less refusals (tree probes, set-level fields)
    surface once at the top, and each tree card separately probes
    its own extras so letters/marks on missing clades flag beside
    the tree they belong to.
  - The share/preview URL is `?read=` plus the `#r=` fragment — the
    fragment alone routes to `ReadingPage`, but the explicit query
    keeps the link meaningful if the hash is ever stripped.
  - Canvas↔stored-tree sync is explicit and button-driven ("Edit on
    the canvas" / "Use canvas tree") so imports and typing never
    clobber in-progress canvas work; canvas taps arm the extras form
    that last chose a tool.
  - `DrawCanvas` gained only the `onNodeTap` callback (fired from
    `toggleSel` for node hits, covering click and Enter/Space); all
    gesture and keyboard behaviour is unchanged.
- **Baselines:** owner approved regenerating `editor-default`,
  `editor-f84`, `editor-prompts` (24 files) because the mode switch
  changes the editor layout (conductor note of the owner's decision).
- `ReadingEditor.test.tsx` and `readingDraft.test.ts` are covered by
  the Files block's "and tests" (no deviation).
- **Fix round 2:** both editors stay mounted (inactive one `hidden`)
  so toggling the mode never discards unsaved work.

## v1.4d Task 11: tree-reading lessons

Four built-in reading sets (`trees-reading-a-tree`, `trees-rotation`,
`trees-closest-relatives`, `trees-clades-traits`), their provenance in
`exercises/reading/SOURCES.md`, and the content oracle
`crates/neophylo-core/tests/reading_content.rs`.

- **Baselines:** owner approved regenerating the `library` scene (6
  files) because the four lessons add Tree reading cards (conductor
  note of the owner's decision):
  `library-1920x1080-light-linux.png`,
  `library-1920x1080-dark-linux.png`,
  `library-1024x768-light-linux.png`,
  `library-1024x768-dark-linux.png`,
  `library-768x1024-light-linux.png`,
  `library-768x1024-dark-linux.png`.
- **Files outside the task's Files block:**
  - `web/e2e/visualScenes.ts` (owner-approved): the `library` scene
    waits for the four `.lib-card[data-kind="reading"]` cards and
    counts `Answer key` links only on non-dataset, non-reading cards —
    reading cards have no key link until Task 13.
  - `web/src/views/library/LibraryPage.tsx` (bug fix the new wait
    exposed): the reading-sets effect called `listReadingSets()`
    without awaiting `initEngine()` first — a wasm call before init
    throws, the `.catch` then stores `[]`, and the Tree reading cards
    stay empty for the session. It now chains `initEngine()` first,
    the same pattern `paperFlags` already uses. Harmless while only
    trees-demo shipped (an empty list was the baseline anyway); real
    sets make the race visible.
  - `web/e2e/library-page.spec.ts`: two stale "no reading cards"
    assumptions — `TOTAL` (fed `allCards`) now includes the shipped
    listed reading sets, and the `level=intro` filter test now counts
    the intro-level reading cards (`READING_INTRO`, read from the
    JSONs' meta, never re-typed) since reading items carry level and
    minutes like lessons.
  - `web/src/views/library/LibraryPage.test.tsx`: comment only — the
    `listReadingSets` stub's "empty default matches today" note was
    stale now that real sets ship; the tests themselves were already
    dynamic.
  - `docs/decisions.md` — this entry.
- **Content decisions:** every tree uses `"times": "schematic"` (no
  numeric ages); all relationships are textbook-settled and avoid the
  owner's debated-placement list (no animal root, no placental root,
  no bat/turtle/tardigrade placements, no Neoaves order). `SOURCES.md`
  names the Open Tree of Life synthesis each topology follows, lists
  every simplification (dropped taxa, the rodents polytomy, common
  names) and marks the citations for the owner's phylogeneticist
  check.
- **Ambiguities resolved:**
  - `order_nodes` on a schematic tree accepts every order consistent
    with ancestry; the lesson-one item's `note_after` tells the
    student cross-lineage orders (C and P) can't be resolved, and the
    content test pins both accepted orders plus a descendant-first and
    an incomplete rejection.
  - The rotation lesson's `which_differs` items keep one genuinely
    different topology (human grouped with gorilla instead of chimp)
    so "rotate to check" is a real task, not a trick.
  - The ocean tree groups dolphin with the penguin+chicken pair
    (tetrapods) rather than with the fish — the resemblance
    distractor the lesson teaches against.
- **Fix round 1:**
  - `trees-clades-traits` splits its tree: `amniotes` is the bare
    Newick for the three clade items (`q-clade-yes`, `q-clade-no`,
    `q-two`, which now also carry the lesson's diagonal and circular
    styles and `q-clade-no`'s rotate tool); `amniotes-traits` is the
    same topology with the marks, used by every mark item, all drawn
    rectangular tips-right (`q-mono` keeps its rotate tool). Same
    topology, so every computed answer is unchanged; `SOURCES.md`
    names both trees.
  - **Follow-ups noticed:** mark labels collide in diagonal, tips-up
    and circular layouts when several marks sit on short branches
    (seen on the amniotes tree); the lesson draws marked trees
    rectangular only; layout fix left for a later task.
  - Residual even rectangular: the "amniotic egg" label is ~2 px
    wider than its one-level stem, so its last glyph touches the
    child-drop vertical at the amniote node at 1024×768 and 360×740
    (checked geometrically; every other mark label is clear). A
    label-vs-other-branch clearance is a layout fix, not content —
    same follow-up.
  - **Files outside the task's Files block:** `web/src/reading/state.ts`
    (new `fillPlaceholders`, shared by `fillItemText`),
    `web/src/views/reading/ItemView.tsx`,
    `web/src/views/reading/TestSummary.tsx` and their tests
    (`web/src/reading/state.test.ts`,
    `web/src/views/reading/ReadingPage.test.tsx`,
    `web/src/views/reading/TestSummary.test.tsx`) — `note_after`
    placeholders were rendered raw (`{set}`, `{a}`); found while
    checking the lessons.
- **Fix round 2:**
  - **Baselines:** owner approved regenerating the reading frames
    changed by the tip-only highlight (conductor note of the owner's
    decision): `reading-q-is-clade-{1024x768,360x740}-{light,dark}`,
    `reading-q-place-taxon-{1024x768,360x740}-{light,dark}`,
    `reading-q-two-tier-{1024x768,360x740}-{light,dark}` and
    `reading-tipsup-12-long-names-360-360x740-{light,dark}` — 14
    files, every `reading-*` frame whose pixels changed (the three
    question screens whose `tips` form a clade, and the 12-tip
    tips-up scene). Frames whose `tips` are not a clade were already
    byte-identical (a non-clade lit only terminals under the old code
    too), so e.g. `reading-q-mrca` needed no new baseline.
  - **Files outside the task's Files block:**
    `web/src/views/reading/readingDraw.tsx`, `reading.css` and
    `ReadingTree.test.tsx` — the tip highlight lit every edge whose
    tips were all listed and ringed the node whose clade equalled the
    set, so `is_clade` and `mrca` answers were drawn before the
    student answered; found while checking the lessons. Now only each
    listed tip's own terminal branch is highlighted and the
    `.rt-hl-ring` is gone (the `.rt-sel-ring` selection marker is
    unchanged); no text/ARIA path names or marks the clade/MRCA of the
    highlighted tips.
  - `trees-clades-traits` renames the trait "amniotic egg" to
    "amnion" (placental mammals do not lay eggs) in the marks, the
    `traits` entry, `by_trait`, the q-mono text and the q-synap
    statements; the topologies and tip sets are untouched so every
    computed answer is unchanged. The shorter label also clears the
    fix-round-1 residual where "amniotic egg" touched the child drop
    line.
  - `trees-rotation` `q-two-same` tree 2 and `trees-clades-traits`
    `q-two` switch from circular to `rectangular`/`tips-up`: the
    circular layout of the 5- and 7-tip trees was cramped (crossing
    arcs near the centre, labels larger than branches). Both lessons
    still draw ≥2 styles (rectangular + diagonal + tips-up variants).
  - `SOURCES.md`: the rodents trichotomy now cites Blanga-Kanfi et
    al. 2009 (*BMC Evol Biol* 9:71), which reports the three major
    clades supported and their basal relationships unresolved, instead
    of the Fabre et al. 2012 diversification-rate paper; DOIs added
    for Betancur-R. et al. 2013 and Prado-Martinez et al. 2013; the
    "no DOIs on purpose" sentence replaced by the records-checked
    note (checked 2026-11-20).
  - **Follow-ups noticed:** circular layout is cramped for trees
    under about 10 tips (crossing arcs near the centre); lessons
    avoid it; layout follow-up.
- **Fix round 3:** topologies checked against the Open Tree of Life
  synthesis opentree16.1 on 2026-11-20 by the conductor
  (owner-approved third round, documentation only); no conflicts;
  rodents polytomy kept deliberately.

## v1.4d follow-up (owner request 2026-11-20): scroll cue only on the side with hidden content

The `.rt-canvas` scroll cue no longer follows the layout's `fig.scroll`
flag alone. `ReadingTree` tracks the canvas's real scroll metrics
(`scrollLeft > 1` ⇒ hidden content on the left;
`scrollLeft + clientWidth < scrollWidth - 1` ⇒ on the right), updates
on the passive `scroll` event — wheel, touch and keyboard focus
scrolling alike — and re-reads the metrics after every render, which
also covers panel resizes (the existing ResizeObserver drives the
re-render). The result renders as `data-cue="left" | "right" | "both"`
(absent when nothing hides), with the same inset-shadow look mirrored
per edge, so at the scroll end the shadow sits on the left edge
instead of over the last labels. `fig.scroll` stays in the layout
(`readingLayout` tests use it); no geometry changes. Covers the Task 9
parked follow-up "the scroll cue on `.rt-canvas` stays visible at the
scroll end".

- **Baselines:** owner approved regenerating the visual frames whose
  scroll-cue rendering changes because of this fix (conductor note of
  the owner's decision, 2026-11-20). A `reading-*`/`rt-*`-scoped run in
  the pinned image (`playwright:v1.64.1-noble@sha256:7852dc5a…`)
  showed exactly one scene differing — the scroll-end frame, where the
  cue moved from the right edge to the left; every scroll-0 frame is
  pixel-identical because its right-edge cue is unchanged. Regenerated
  with `--grep "reading-tipsup-12-long-names-360-end"
  --update-snapshots`, then the whole `visual` project passed
  (303 frames):
  - `web/e2e/__screenshots__/reading-tipsup-12-long-names-360-end-360x740-light-linux.png`
  - `web/e2e/__screenshots__/reading-tipsup-12-long-names-360-end-360x740-dark-linux.png`
- **Files outside `web/src/views/reading/`** (this follow-up has no
  plan Files block; the touched set is listed instead):
  - `web/e2e/reading.spec.ts` — the new cue-state e2e (right → left →
    both → absent on viewport widen) and the existing
    `data-scroll` assertion updated to `data-cue`.
  - `web/e2e/visualScenes.ts` — the same `data-scroll` assertion
    updated, plus a `data-cue="left"` pin on the scroll-end scene.
  - `web/e2e/__screenshots__/` — the two regenerated baselines above.
  - `docs/decisions.md` — this entry.

## v1.4d Task 12: forms A and B, format-coverage set (owner review)

Two before/after forms (`trees-form-a`, `trees-form-b`, `mode:
"test"`, 12 items each, same misconception-category list, each with a
trait-loss item, familiar and unfamiliar taxa) and the format-coverage
sets under `exercises/reading/coverage/` — `cov-styles`,
`cov-relatedness`, `cov-structural`, `cov-traits`, `cov-statements` —
plus `manifest.json` mapping every §8.3 bullet to the items that carry
it and listing the deferred format gaps. The content oracle
`crates/neophylo-core/tests/reading_content.rs` now stores the
expected answer of every form and coverage item, the per-item
misconception categories, and the manifest↔spec coverage checks; the
coverage e2e `web/e2e/reading-coverage.spec.ts` renders every set in
its manifest styles and round-trips three coverage items through the
Task-10 editor.

- Baselines: owner approved regenerating the `library` scene (6
  files) because forms A and B add Tree reading cards
  - `web/e2e/__screenshots__/library-1920x1080-light-linux.png`
  - `web/e2e/__screenshots__/library-1920x1080-dark-linux.png`
  - `web/e2e/__screenshots__/library-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/library-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/library-768x1024-light-linux.png`
  - `web/e2e/__screenshots__/library-768x1024-dark-linux.png`
- **Files outside the task's Files block:**
  - `web/e2e/visualScenes.ts` (owner-approved): the `library` scene's
    reading-card count is now computed from the shipped
    `exercises/reading/*.json` files minus `trees-demo` (6 after this
    task) instead of the literal 4.
  - `web/src/views/reading/ReadingTree.tsx`: the figure element now
    carries `data-shape`/`data-tips` so the coverage e2e asserts the
    styles the manifest lists against the rendered DOM rather than
    the JSON alone.
  - `exercises/reading/SOURCES.md`: provenance for the new form and
    coverage trees (same pattern as Task 11).
  - `docs/decisions.md`: this entry.
- **Follow-ups noticed:** the editor's `has_not` ask fields are
  tap-only readouts that capture the tapped *tip* name, but the wire
  ask expects trait names — a `has_not` item cannot currently be
  authored correctly through the reading editor (the round-trip e2e
  uses `homologous` for its trait-mark item instead). **Fixed
  2026-11-21 in the Task 15 checkpoint PR (§21(d), fix round 2c):**
  every trait-name field is a select offering the item's first tree's
  trait names; see the round-2c entry below.
- **Fix round 1 (owner review):** `cetartiodactyls` ages re-set to
  cited estimates (R 70 / W 60 — Hassanin et al. 2012 Table 1 means;
  C 45, N 35, basilosaurus 37 — fossil literature, all in SOURCES.md
  with DOIs) and `q-ages` thresholds moved to 30/65 so every
  `lineage_at_least` statement reads the same under the fossil-bound
  and drawn-split readings; a new oracle test
  (`lineage_at_least_statements_agree_with_the_drawn_split_age`)
  checks that equivalence for every such statement in every set. The
  spoiler clause was removed from the 30-Ma statement text.
  `q-mrca-points` options now cover tip, branch and internal-node
  points (`W,Y,Z,V,X`) with a new kind-coverage test. Mark-heavy
  items drawn rectangular (`cov-traits/q-have`, form B `q-evolved`,
  form A `q-clade`; manifest updated — `diagonal:right`/`up` coverage
  kept by other entries). Form A now mixes in unfamiliar taxa on the
  new `arthropods` tree (`q-sea`, `q-smallest` — OTL-checked,
  SOURCES entry) and ginkgo in `plants` (`q-clade`); a test comment
  names the unfamiliar-taxa items in each form.
- **Fix round 2 (owner-approved):** Hassanin et al. 2012 table
  reference corrected to Table 1.

## v1.4d Task 13: reading worksheets and keys

`?worksheet=<id>&kind=paper` and `?key=<id>&kind=paper` now resolve
built-in and `#r=` custom reading sets: the sheet draws every shown
tree in its authored style through the real `ReadingTree` and gives
each question type its paper answer space (options to circle or tick,
order slots, number and write-in blanks); the key renders every
item's `readingAnswer` — explanation verbatim, accepted answer as
text, the `order_nodes` order rule and the "authored answer" label —
behind the existing instructor gate. The library's Tree reading
cards now link both.

- Baselines: owner approved regenerating the `library` scene (6
  files) because reading cards gain worksheet and key links; the
  reading worksheet/key frames are new
  - `web/e2e/__screenshots__/library-1920x1080-light-linux.png`
  - `web/e2e/__screenshots__/library-1920x1080-dark-linux.png`
  - `web/e2e/__screenshots__/library-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/library-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/library-768x1024-light-linux.png`
  - `web/e2e/__screenshots__/library-768x1024-dark-linux.png`
  - new: `worksheet-reading*`-`*` frames (sheet, sheet-print, key,
    key-print, form sheet, form-print × viewports × themes)
- **Files outside the task's Files block:**
  - `web/src/views/worksheets/ReadingSheetView.tsx` (new): the sheet
    view — kept out of WorksheetPage.tsx, which is already at the
    ~400-line rule.
  - `web/src/views/worksheets/ReadingKeyView.tsx` (new): the key view,
    same reason.
  - `web/src/views/worksheets/worksheets.css`: the answer-space,
    option/order and key styles plus the print rules that stack the
    figures and refit them inside the A4 printable width.
  - `web/src/views/worksheets/worksheets.test.tsx`: the unknown-id
    message now names "no lesson, lab or reading set".
  - `web/src/views/library/LibraryPage.tsx`: the card actions render
    `items.ts`'s `cardActions` (the plan's "activate the reading card
    actions" lives there).
  - `web/src/views/library/LibraryPage.test.tsx` (owner-approved):
    the "activate in Task 13" assertions now expect the Paper
    worksheet and Answer key links on every shipped card, counted
    from disk.
  - `web/e2e/visualScenes.ts` (owner-approved): the `library` scene's
    Answer-key count drops the reading exclusion — every non-dataset
    card has one — plus the six new worksheet-reading scenes.
  - `web/e2e/library-page.spec.ts`: the e2e's own "activate in
    Task 13" assertions — `allCards`' Answer-key count now includes
    the listed reading sets, and the reading-card test expects the
    Paper worksheet and Answer key links instead of none.
  - `web/e2e/__screenshots__/worksheet-reading*-linux.png`: the new
    baselines named above.
  - `docs/decisions.md`: this entry.
- **Not done here:** `?worksheet=<reading-id>&kind=app` and
  `?key=<reading-id>&kind=app` point at the paper kind — a reading
  set's in-app work is the reading area itself.
- **Fix round 1:** key names true statements by text — the
  `select_true` accepted answer renders each true statement's filled
  text ("; "-joined) instead of an index the unnumbered sheet never
  shows; the `worksheet-reading-key*` baselines (10 files) were
  regenerated for it.

## v1.4d Task 14: instructor guide — tree-reading section

The guide gains a **Teaching tree reading** section (the four lessons,
forms A and B with their paper sheets and keys, building a reading set
in the editor, and measuring learning with the spec §8.4 citations and
caveats plus the manifest's five known gaps) and a second `##` plan,
**A 50-minute tree-reading class plan** (form A → Clades and shared
traits → form B, the owner-approved pick — the other three lessons are
named as extensions for longer slots). `?read=<id>` and the library's
`type=reading` filter value are new allowed link forms, so the
guide's `?read=`, `?library&type=reading`, `?worksheet=`/`?key=`
reading links render and resolve.

- Baselines: owner approved regenerating the `guide` scene (6
  files) because the guide gains a tree-reading section
  - `web/e2e/__screenshots__/guide-1920x1080-light-linux.png`
  - `web/e2e/__screenshots__/guide-1920x1080-dark-linux.png`
  - `web/e2e/__screenshots__/guide-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/guide-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/guide-768x1024-light-linux.png`
  - `web/e2e/__screenshots__/guide-768x1024-dark-linux.png`
- **Files outside the task's Files block:**
  - `web/src/links.ts`: `read` joins the id routes (`?read=<id>`,
    single-param like `?lesson=`), and `reading` joins the library
    `type=` values — both forms the guide now links.
  - `web/src/views/library/items.ts`: the `SHIPPED_META` glob adds
    `exercises/reading/*.json` so `exerciseMetas()` also serves
    reading-set metas; `buildItems()` itself is unchanged.
  - `web/src/views/guide/GuidePage.tsx`: plan minutes merge
    `exerciseMetas()` after `buildItems()` — reading cards resolve
    asynchronously in the library, so the page reads the same
    `meta.minutes` off the shipped files to stay synchronous.
  - `web/src/views/guide/GuidePage.test.tsx`: section count 6 → 8,
    plan count 2 → 3, and assertions that the tree-reading plan shows
    the registry minutes and computed total.
  - `web/src/lessons/content.test.ts`: the guide no-digits guard's
    allowlist adds the §8.4 citation strings' years (Baum et al.
    2005; Kummer et al. 2019; Furrow & Hsu 2019) and the manifest's
    deferred-milestone tokens `v2.<n|x>` — both required prose, not
    computed data numbers.
  - `docs/decisions.md`: this entry.
- **Noted, not fixed (parked in the task notes):** the guide tells
  instructors that the paper sheets keep the screen-authored "Tap…"
  wording, that a test-mode sheet's scan-the-code block opens the
  test itself, and that mark labels can crowd on form A's printed
  trait tree. The editor's `has_not` limit is described as a current
  limit.

## v1.4d Task 15: release checkpoint

- **Files outside the task's Files block:**
  - `docs/release-checkpoint.md`: the runbook is per-version — its
    "This release" table, command examples, owner-pass steps, release
    notes draft and the "Automation map" all still named v1.4c/v1.4.2.
    The task's Files block covers `scripts/checkpoint/` plus "the
    checklist's Automation map", and the Automation map lives in this
    file; updated to v1.4d/v1.4.3 with the new §16–§23 rows rather
    than leaving the owner a stale v1.4c runbook at release time.
  - `docs/decisions.md`: this entry.
- `CITATION.cff`: `version` bumped to `1.4.3` only; `date-released`
  stays `2026-11-18` on purpose — the owner sets it on the tag day.
- No engine, fixture, exercise-content, snapshot-baseline or product
  `web/src` changes in this task: the checkpoint extensions live in
  `scripts/checkpoint/browser/release.spec.ts` and are data-driven
  from the committed reading JSON.
- Parked for owner triage (listed in the checkpoint §21, not fixed):
  mark-label collisions on short branches (a), cramped circular
  layouts under ~10 tips (b), the practice-mode "try again" design
  point (c), the editor's `has_not` authoring limit (d, still open on
  main — `TraitAskFields` reads tip readouts while the wire ask wants
  trait names), the `select_true` "statements 1 are true." wording
  (e), paper-sheet "Tap…"/test-QR wording (f), and the editor mode-box
  alignment at 1280 px (g, needs owner approval — 24 baselines). Two
  warts found while running the new checker locally are recorded at
  §21(h)/(i): `decompressFromEncodedURIComponent` throws on an
  undecodable `#r=` fragment (surfaces as the generic engine-load
  alert), and Share/copy's `void navigator.clipboard?.writeText(…)`
  leaves an unhandled rejection when clipboard-write is denied.
- The new checker ran end to end before this commit (the v1.4c
  lesson): `CHECKPOINT_LOCAL=1 PLAYWRIGHT_BROWSERS_PATH=$PWD/.tmp-pw
  scripts/checkpoint/browser.sh http://localhost:4173 /tmp/cp-v14d
  --project=chromium` against `npm run build` + `vite preview` —
  **99 passed / 0 failed** (all carried §1–§15 plus new §2/§4/§5
  reading checks and §16–§20). Two first-run bugs in the new tests
  were fixed and re-verified (a fragment-only goto reusing the stale
  alert; the clipboard `pageerror` under plain http).

## v1.4d Task 15 fix round 2a (owner decision 2026-11-21: fix all §21 items before tag, follow the conductor's recommendations)

Session 2a covered §21 (c) practice feedback, (e) select_true
wording, (h) undecodable `#r=`, (i) clipboard rejections and (j)
dots sliding on item change.

- **`select_true` explanation grammar (e):** the count wording now
  agrees — `"statement 1 is true."` for one, `"statements … are
  true."` (unchanged `join_and`) for several, `"no statement is
  true."` for none. Engine test
  `select_true_explanation_matches_the_true_count` pins all three
  strings against the same item's statement list.
- **§7.4 practice-feedback deviation (c) — conductor's
  recommendation, owner-approved.** The spec reads "After Check:
  correct or not, the engine explanation, and the item's
  `note_after`. A student can retry." — which made "try again"
  meaningless because the explanation was already on screen. Practice
  mode now stages it: the first wrong verdict is "Not quite — try
  again." with no explanation, no `note_after` and no revealing
  highlight; a second Check or the new **Show answer** button
  resolves the item (explanation + `note_after`, Check still
  available). Correct-first-answer behaviour, test mode and the live
  region are unchanged. `ReadingSession` gains `attempts` and
  `revealed` arrays (Back/Next preserves both) and `ReadingAction`
  gains `reveal`. `docs/instructor-guide.md` gained a staged-feedback
  paragraph.
- **`#r=` decode throw (h):** `decodeReadingLink` wraps
  `decompressFromEncodedURIComponent` in a `try`; an undecodable
  fragment (`#r=zzz`) refuses with the same link-naming message the
  invalid-JSON path uses instead of surfacing as the generic
  engine-load alert.
- **Clipboard rejections (i):** `.catch(() => undefined)` on all
  three `navigator.clipboard.writeText` call sites —
  `EditorPanel.tsx`, `ReadingEditor.tsx`, `ErrorBoundary.tsx`. The
  share notice still shows the link; `grep` found no other call sites
  under `web/src`.
- **Item-change sliding (j):** `ReadingTree.tsx` draws a render whose
  `view` prop changed — an item switch — with the transition off, so
  elements land at final coordinates in one commit. Devin's call,
  deviating from the prescribed index-in-key remount: `.rt-figure` is
  a flex item sized by its own content, so `box.width` (measured) and
  `fig.width` (drawn) form a feedback loop — a remount restarts the
  measurement near zero and visibly converges narrower (proved by the
  `reading-q-count-clades` baseline diffing only with the remount in).
  Suppression produces the same student-visible outcome without the
  relayout drift. A panel resize slid dots the same way (a width
  change rewrites every live transform, which the CSS transition
  animates), so `ReadingTree.tsx` also suppresses the transition on a
  width-only relayout; rotation within a stable width still
  animates.
- **Files outside the task's Files block:**
  - `web/e2e/reading-editor.spec.ts`, `web/e2e/editor.spec.ts`:
    denied-clipboard Share tests for §21(i) — the Files block names
    `web/e2e/reading.spec.ts` for e2e, but the two Share handlers
    under test live on the editor pages, whose specs are these.
  - `docs/instructor-guide.md`: the §21(c) item requires updating
    the guide's practice-feedback text in the same PR.
  - `docs/decisions.md`: this entry.

## v1.4d Task 15 fix round 2b (owner decision 2026-11-21: fix all §21 items before tag, follow the conductor's recommendations)

Session 2b covered §21 (a) mark-label collisions, (b) cramped
circular layout, (f) paper wording + test-form QR and (k) the
figure-width feedback loop (conductor finding, fixed in this
session). The guide's known-gaps list was re-checked against
`exercises/reading/coverage/manifest.json` — still the same five
deferred formats.

- **Mark-label collisions (a):** `placeMarks` keeps only the labels
  of marks sharing one branch apart. The new
  `resolveMarkLabels` (`web/src/layout/readingMarkLabels.ts`)
  re-places any mark label that touches a tip label, a node- or
  point-letter badge, another mark's glyph or another mark's label:
  a deterministic ladder of directions beside the branch (the stem's
  mirror side first), each keeping the LABEL_GAP construction off
  the mark's own glyph, never nearer another mark's glyph than its
  own. Lone marks keep their established placement — a label's own
  glyph is never counted as its obstacle (the corpus scan flagged
  exactly that false positive, which would have moved every lone
  label). A resolved label that escapes the figure reports the same
  grow/shift contract `placeMarks` already used, applied to every
  placed element.
- **Circular layout (b) — cause found first:** every parent→child
  edge drew an arc at the parent's radius from the parent's angle to
  the child's; at a polytomy the outer child's arc swept through a
  middle child's radial junction. The fix keeps the circular model
  but draws it differently: a child's edge is only its radial spoke,
  and an internal node's fan is one arc spanning its children's full
  angle range, appended to that node's own edge path. Internal radii
  are now resolved bottom-up in `readingCircular.ts`: the age
  coordinate is floored at the cladistic-depth ring
  (`depth/maxDepth` of the arc radius — the stated minimum step is
  R/maxDepth) and capped just below the shallowest descendant, so an
  age-compressed ancestor can neither collapse onto the centre nor
  sit on or past a shallow fossil tip's ring.
- **Paper wording + test-form QR (f):** `paperText`
  (`web/src/worksheets/reading.ts`) re-verbs sentence-initial screen
  instructions through a table (`Tap …` → `Circle …`, the
  lettered-order instruction → `Write the letters of the nodes in
  order…`, `Select every true statement` → `Tick every true
  statement`, `Rotate nodes freely` → `Rotating a node changes
  nothing`) and drops the app-only ", or arrange the list" clause; a
  sentence starting with an instruction verb the table doesn't cover
  throws, so new screen wording fails the corpus test instead of
  printing. The app keeps the authored text. A `mode: "test"` sheet
  prints "Hand this sheet to your instructor." instead of the
  link + QR block (`ReadingSheet.test`; `ReadingSheetView.tsx`).
  Devin's call: `Rotate nodes freely` is re-verbed rather than
  dropped so the printed question still explains why the odd tree
  can be found on paper.
- **Figure width (k):** `.rt-figure` was a content-sized flex item
  whose measured width fed `ReadingTree`'s `box.width`, so drawn
  width and measured width formed a feedback loop — the same item
  converged to different widths by mount order (session 2a's
  transition commit already observed the loop; the conductor saw
  `cov-styles` item 4 draw ~560 px vs ~200 px at the same viewport).
  `.rt-figure` now takes `flex: 1 1 0` — an equal,
  content-independent share of the row — so the figure box depends
  only on the container and the tree; the stacked layouts (≤600 px
  media query, worksheet print column) restore `flex: none` so
  figures return to content height there.
  **Follow-on the flex change exposed (fixed here):** the §21(j)
  suppression latched on `view` identity or width change, but
  ItemView's `views` map is keyed by tree name — two items can hand
  the SAME view object to one ReadingTree under a different
  `styleIndex` (trees-reading-a-tree items 1→2). The width half of
  the latch used to catch that because the content-sized figure
  re-converged on every item change; with a constant share it
  didn't, and the dots slid again. `ReadingTree`'s `prev` now
  mirrors `style.shape`/`style.tips` by value alongside `view` and
  width, so every non-rotation relayout snaps; the e2e check "an
  item change lands the trees at their final spots" covers it.
- **Shared `LETTER_R`:** the node-/point-letter badge radius moved
  to `web/src/layout/readingGeom.ts` (re-exported from
  `readingHelpers.ts`) so the layout pass can obstacle-badge boxes
  without importing the view layer.
- **Files outside the task's Files block** (the Task 15 block names
  only `docs/checkpoints/v1.4d-release.md`, `docs/roadmap.md`,
  `CITATION.cff` and `scripts/checkpoint/`; the owner decision
  authorises product code, tests and docs for the listed items, and
  this entry names them):
  - `web/src/layout/readingLayout.ts`, `web/src/layout/readingCircular.ts`,
    `web/src/layout/readingGeom.ts`, `web/src/layout/readingMarkLabels.ts`
    (new), `web/src/layout/readingCorpus.test.ts` (new): items (a)
    and (b).
  - `web/src/views/reading/readingHelpers.ts`: `LETTER_R` re-export.
  - `web/src/views/reading/reading.css`: the §21(k) flex fix.
  - `web/src/views/reading/ReadingTree.tsx`: the style-by-value
    suppression follow-on in the same bullet.
  - `web/src/worksheets/reading.ts`, `web/src/worksheets/reading.test.ts`,
    `web/src/views/worksheets/ReadingSheetView.tsx`,
    `web/src/views/worksheets/worksheets.css`: item (f) and the print
    side of (k).
  - `web/e2e/reading.spec.ts`, `web/e2e/worksheets.spec.ts`: the (a)
    DOM check, (f) hand-in/QR pair and (k) box-stability tests.
  - `docs/instructor-guide.md`: the §21 paragraph requires updating
    the guide in the same PR; the paper-caveats text now describes
    the paper re-verb, the test-form hand-in line and the practice
    QR. The `has_not` editor limit stays — §21(d) remains deferred.
  - `docs/decisions.md`: this entry.

**2b2 (2026-11-21):** the conductor's pixel-check of round 2b found
two required problems.

- **(a) still broken on form A's printed trait tree.** The 2b
  resolver only tested tip-label and badge boxes, so a label could
  sit on a branch line or cover a node dot untouched — on the whale
  tree "limbs"/"echolocation" lay on the hippo branch against its
  tip dot. The DOM check missed it twice over: it never emulated
  print media (the print stylesheet sets the figure width, and the
  label moves with it), and `getBBox()` on `.rt-mark-label` returns
  the translated `<g>`'s LOCAL frame — comparing boxes from
  different coordinate frames, so nothing ever "overlapped".
  `resolveMarkLabels` now also obstacles node dots, other marks'
  glyphs and every branch chain but the mark's own at a 3 px
  clearance (`MARK_CLEAR` in `readingGeom.ts`, `segBoxDist` in
  `labelCollision.ts`); `readingLayout` builds the real edge
  geometry per shape — rectangular elbow chains, diagonal segments,
  spokes plus sampled fan arcs for circular — exposes it as
  `edge.pts`, and resolves each mark's own branch through `find`
  (new `mark.on` on the figure). Candidate order keeps a shared
  branch's labels coherent: same-side at the construction distance,
  then floated along the row's own direction (stays level, same
  side), then anywhere, then a fine polar sweep for the
  tips-up/down "picket fence" case where no inside spot exists
  (the figure then grows, like placeMarks). The corpus test checks
  dots, branch segments and figure bounds; `expectLegibleMarks`
  asserts the exact LABEL_GAP construction only when the resolved
  label still sits within that bound — the 3 px rule is
  mathematically unsatisfiable inside it for dense tips-up/down
  trees (Devin's call: clearance wins over construction distance).
  The DOM check became "form A's trait tree: mark labels clear
  hippo (print + screen)" — the real print scene at 768×1024 with
  print media emulated plus the 1024 screen sheet, comparing
  `getBoundingClientRect()`s and sampling the rendered edge paths
  through `getScreenCTM()`.
- **(k) over-corrected: a lone tree stretched to ~950 px.**
  `flex: 1 1 0` made figures deterministic but content-independent
  in both directions — a single tree grew to fill the row.
  `READING_FIGURE_MAX = 560` (new token in
  `web/src/design/tokens.ts`, emitted as `--reading-figure-max`)
  caps `.read-trees > .rt-figure` at `min(100%, 560px)`; 560 sits
  just above the ~550 px widest single-tree figure in the approved
  Task 7/8 frames, so multi-tree rows share equally up to the cap
  and a lone tree keeps the compact look (Devin's call: the number,
  from the approved frames; the token mechanism was the conductor's
  recommendation, owner-approved). New test: "a single-tree item's
  figure stays within --reading-figure-max" at 1024 and 1920 px.
- **New files outside the task's Files block this round:**
  `web/src/design/tokens.ts` (the token), plus edits to
  `web/src/layout/labelCollision.ts` (`segBoxDist`, `segsMeet`,
  `Seg`), `readingGeom.ts` (`MARK_CLEAR`), `readingLayout.ts`
  (`edge.pts`, `edgeChains`, dots, `mark.on`),
  `readingMarkLabels.ts` (dot/segment obstacles, candidate order,
  polar sweep), `readingCorpus.test.ts` (dot/segment/bounds
  checks), `readingLayout.test.ts` (conditional gap bound),
  `reading.css` (the cap), `reading.spec.ts` (cap test) and
  `worksheets.spec.ts` (the rewritten DOM check).

## v1.4d Task 15 fix round 2c (owner decision 2026-11-21: fix all §21 items before tag, follow the conductor's recommendations)

Session 2c covered §21 (d) the editor's `has_not` authoring limit,
(g) the mode-box alignment, and the closing doc pass. With this
session every §21 item (a)–(k) is fixed in this PR.

- **`has_not` authoring (d) — conductor's recommendation,
  owner-approved.** The ask's `has`/`lacks` fields captured tapped
  *tip* names where the wire expects trait names. Every trait-name
  field the item form carries is now a `TraitNameField` select
  (`web/src/views/editor/reading/fields.tsx`) offering the item's
  first tree's trait names in the engine's `trait_names` order —
  trait defs first, then mark names (`traitNamesOf` in
  `readingItems.ts`, fed by `ItemForm` from the resolved
  `ReadingTreeView`). Covered: the ask's `trait_name` (which_have,
  how_many_changes, ancestral_or_derived, homologous), `has`/`lacks`,
  `is_clade`'s optional `by_trait`, and the select_true statements'
  `trait_name`/`inner`/`outer` ("any other trait-name field"). The
  bogus `ask-has`/`ask-lacks` tip-tap targets and their `applyPick`
  case are removed; homologous' `x`/`y` stay tip picks — the wire
  wants tips there. Devin's calls: the "Has trait"/"Lacks trait"
  labels; a text-input fallback when the tree knows no traits yet;
  an extra "(not on this tree)" option so an imported item holding
  an unknown name still shows it instead of silently displaying the
  placeholder; and "— none —" as `by_trait`'s empty label.
- **Mode-box alignment (g) — conductor's recommendation,
  owner-approved (baseline round).** `.editor-mode` now takes the
  editor column's own box (`max-width: 1100px; margin: 0 auto`, the
  cap `.editor-panel`/`.editor-page-head` already used), so its left
  edge and width match the column's at 1280 and 1920 px. At 1024 and
  768 the page is already narrower than the cap, so the box was
  aligned before and after — nothing moved there (the new e2e
  asserts all four widths anyway). Only `editor-default`'s two wide
  frames changed: `editor-f84` and `editor-prompts` scroll the mode
  box out of frame before shooting, so their baselines stayed
  byte-identical.
- **Doc pass:** the guide drops the `has_not` limit bullet, gains a
  trait-dropdown clause, and corrects the staged-feedback wording
  ("shows only"; a second *wrong* answer resolves; a correct second
  answer shows the explanation too). The checkpoint doc gains the
  §21(d)/(g) fix lines, a `has_not` item in the §19 owner pass, and
  the §7.4 deviation entry, and loses the §22 `has_not` bullet and
  the stale "nothing below is fixed" intro.
- **Every file round 2 (sessions 2a, 2b, 2b2, 2c) changed outside
  the Task 15 Files block** (`git diff --name-only 06e718ca..HEAD`;
  the block names `docs/checkpoints/v1.4d-release.md`,
  `docs/roadmap.md`, `CITATION.cff` and `scripts/checkpoint/` —
  in-block changes are not listed):
  - `crates/neophylo-core/src/reading/answer.rs`
  - `crates/neophylo-core/tests/reading_answer.rs`
  - `docs/instructor-guide.md`
  - `docs/decisions.md` (this entry and the 2a/2b ones)
  - `web/e2e/editor.spec.ts`
  - `web/e2e/reading-coverage.spec.ts`
  - `web/e2e/reading-editor.spec.ts`
  - `web/e2e/reading.spec.ts`
  - `web/e2e/worksheets.spec.ts`
  - `web/e2e/__screenshots__/editor-default-1280x800-dark-linux.png`
  - `web/e2e/__screenshots__/editor-default-1280x800-light-linux.png`
  - `web/e2e/__screenshots__/editor-default-1920x1080-dark-linux.png`
  - `web/e2e/__screenshots__/editor-default-1920x1080-light-linux.png`
  - `web/e2e/__screenshots__/guide-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/guide-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/guide-1920x1080-dark-linux.png`
  - `web/e2e/__screenshots__/guide-1920x1080-light-linux.png`
  - `web/e2e/__screenshots__/guide-768x1024-dark-linux.png`
  - `web/e2e/__screenshots__/guide-768x1024-light-linux.png`
  - `web/e2e/__screenshots__/reading-feedback-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/reading-feedback-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/reading-marks-same-branch-up-360x740-dark-linux.png`
  - `web/e2e/__screenshots__/reading-marks-same-branch-up-360x740-light-linux.png`
  - `web/e2e/__screenshots__/reading-q-closest-relative-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/reading-q-closest-relative-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/reading-q-concept-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/reading-q-concept-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/reading-q-count-clades-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/reading-q-count-clades-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/reading-q-is-clade-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/reading-q-is-clade-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/reading-q-mrca-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/reading-q-mrca-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/reading-q-order-nodes-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/reading-q-order-nodes-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/reading-q-place-taxon-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/reading-q-place-taxon-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/reading-q-select-true-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/reading-q-select-true-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/reading-q-smallest-clade-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/reading-q-smallest-clade-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/reading-q-trait-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/reading-q-trait-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/reading-q-trait-360x740-light-linux.png`
  - `web/e2e/__screenshots__/reading-q-two-tier-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/reading-q-two-tier-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/reading-q-which-differs-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/reading-q-which-differs-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/reading-q-which-fits-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/reading-q-which-fits-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-1920x1080-dark-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-1920x1080-light-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-768x1024-dark-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-768x1024-light-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-form-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-form-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-form-1920x1080-dark-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-form-1920x1080-light-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-form-768x1024-dark-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-form-768x1024-light-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-form-print-1920x1080-dark-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-form-print-1920x1080-light-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-form-print-768x1024-dark-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-form-print-768x1024-light-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-key-1024x768-dark-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-key-1024x768-light-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-key-1920x1080-dark-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-key-1920x1080-light-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-key-768x1024-dark-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-key-768x1024-light-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-key-print-1920x1080-dark-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-key-print-1920x1080-light-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-key-print-768x1024-dark-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-key-print-768x1024-light-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-print-1920x1080-dark-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-print-1920x1080-light-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-print-768x1024-dark-linux.png`
  - `web/e2e/__screenshots__/worksheet-reading-print-768x1024-light-linux.png`
  - `web/src/design/tokens.ts`
  - `web/src/index.css`
  - `web/src/layout/labelCollision.ts`
  - `web/src/layout/readingCircular.ts`
  - `web/src/layout/readingCorpus.test.ts` (new)
  - `web/src/layout/readingGeom.ts`
  - `web/src/layout/readingLayout.test.ts`
  - `web/src/layout/readingLayout.ts`
  - `web/src/layout/readingMarkLabels.ts` (new)
  - `web/src/reading/state.test.ts`
  - `web/src/reading/state.ts`
  - `web/src/reading/url.test.ts`
  - `web/src/reading/url.ts`
  - `web/src/views/editor/EditorPanel.tsx`
  - `web/src/views/editor/reading/fields.tsx`
  - `web/src/views/editor/reading/ItemForm.tsx`
  - `web/src/views/editor/reading/QuestionFields.tsx`
  - `web/src/views/editor/reading/ReadingEditor.tsx`
  - `web/src/views/editor/reading/readingItems.ts`
  - `web/src/views/editor/reading/StatementFields.tsx`
  - `web/src/views/editor/reading/TraitAskFields.test.tsx` (new)
  - `web/src/views/editor/reading/TraitAskFields.tsx`
  - `web/src/views/ErrorBoundary.test.tsx`
  - `web/src/views/ErrorBoundary.tsx`
  - `web/src/views/reading/ItemView.tsx`
  - `web/src/views/reading/reading.css`
  - `web/src/views/reading/readingHelpers.ts`
  - `web/src/views/reading/ReadingPage.test.tsx`
  - `web/src/views/reading/ReadingPage.tsx`
  - `web/src/views/reading/ReadingTree.tsx`
  - `web/src/views/worksheets/ReadingSheetView.tsx`
  - `web/src/views/worksheets/worksheets.css`
  - `web/src/worksheets/reading.test.ts`
  - `web/src/worksheets/reading.ts`

## v1.4d Task 15 fix round 2d (owner decision 2026-11-21: fix all §21 items before tag, follow the conductor's recommendations)

Session 2d covered the two follow-ups from CI and the round-2 review:
the lone-figure width cap forcing an unnecessary scroll (§21(k)) and
`paperText` throwing on user-authored shared sets (§21(f)).

- **Lone-figure width (R1, CI run 44927037765):** the 2b2 rule
  `max-width: min(100%, var(--reading-figure-max))` on
  `.read-trees > .rt-figure` capped a lone figure below its content's
  width, so `.rt-canvas` kept scrolling — and kept `data-cue` — even
  when the row had room (the 565 px long-name tips-up tree at 1024 px).
  `.read-trees > .rt-figure:only-of-type` now takes a content flex
  basis (`flex: 0 1 auto`) floored at the compact cap and ceiled at
  the row: width = min(row, max(drawing, READING_FIGURE_MAX)) — the
  cap still stops a figure stretching past its drawing, never forces
  a scroll, and multi-tree rows keep their equal share under the cap.
  Devin's call: scoping the content basis to `:only-of-type` — a
  `min()`/`clamp()` alternative on every figure would have let
  multi-tree rows give each figure its own max instead of the equal
  share the row contract wants, and a `min-width: fit-content` first
  attempt overflowed the 360 px row instead of scrolling inside the
  canvas (the scroll-cue e2e caught it). Mount-history independence
  is unchanged — the rule is pure CSS off the same row geometry.
- **`paperText` on user content (R2):** the unmapped-verb throw was
  right for shipped content but `?worksheet=custom`/`?key=custom`
  feed author-built sets through `#r=`, where an instruction like
  "Click…"/"Pick…" crashed the sheet into the error page. `paperText`
  now leaves an unmapped sentence's authored wording untouched;
  strictness moved to the corpus: `unmappedPaperSentences(item)`
  (new export) reports every sentence start hitting a screen verb
  the table doesn't map, and the built-in+coverage corpus test
  asserts it is empty for every shipped item. "Pick" joined
  `SCREEN_VERB` and the test's instruction regex.
- **No baselines regenerated:** the full `visual` project (333
  scenes) passed unchanged — every shot lone figure draws ≤ 560 px
  (the only >560 px figure in the baselined sets, trees-demo item
  24's long-name tips-up tree, is shot only at 360 px where it
  scrolls either way), so no frame moved.
- **Files this session changed outside the Task 15 Files block:**
  - `docs/decisions.md`: this entry.
  - `web/e2e/reading.spec.ts`, `web/e2e/worksheets.spec.ts`: the
    new §21(k) sweep and §21(f) custom-set e2e.
  - `web/src/views/reading/reading.css`
  - `web/src/worksheets/reading.ts`, `web/src/worksheets/reading.test.ts`

## v1.4d Task 15 checkpoint finding (owner decision 2026-11-22: fix the fragment-only `#r=` re-route before tag)

The §16 checkpoint run found that `web/src/Root.tsx` picks its route
once at module load, so a navigation that differed only in the
fragment never re-routed: a student on `/#r=<set A>` opening
`/#r=<set B>` in the same tab kept set A, and adding `#r=` to a
`?read=` URL never mounted the shared set (reproduced on the PR #182
deploy). The same race made the §16 corrupted-link test's
`goto("/")` + fragment-only goto flake on WebKit. A `hashchange`
watcher (`web/src/reading/hashWatch.ts`, installed by `main.tsx`)
now reloads the document when a fragment change crosses a `#r=`
boundary — one side carrying a shared set and the two fragments
differing — and leaves every other fragment change (the
Skip-to-content `#main-content` link) alone. The §16 corrupted-link
cases are true cold loads again (`about:blank`, not `/`).

- **Files this session changed outside the Task 15 Files block:**
  - `docs/decisions.md`: this entry.
  - `docs/checkpoints/v1.4d-release.md`: new §21 item (l).
  - `web/src/main.tsx`, `web/src/reading/hashWatch.ts` (new),
    `web/src/reading/hashWatch.test.ts` (new).
  - `web/e2e/reading.spec.ts`: the same-tab `#r=` re-route pair.
  - `scripts/checkpoint/browser/release.spec.ts`: cold-load fix
    (inside the block's `scripts/checkpoint/` entry).

## v1.4d Task 15 checkpoint findings (owner decision 2026-11-22: fix the two print findings before tag)

The v1.4.3 checkpoint run's `print/` PDFs showed two defects on the
reading paper sheets (§21(m)/(n)): a whole-item `break-inside:
avoid-page` pushed over-tall items past the header onto page 2 (blank
page 1), then split anyway and orphaned figure captions at page
bottoms; and Linux Chromium's hinted whole-pixel glyph advances made
printed letter spacing uneven, splitting words in `pdftotext` ("minut
es"). The item now breaks at piece level (figure = caption + drawing
unbreakable, question glued to the first figure, answer block
unbreakable and glued to the last figure) and print takes
`text-rendering: geometricPrecision` on `:root` — screen keeps
`optimizeLegibility`. The checkpoint gains a PDF text check
(`scripts/checkpoint/pdfcheck.py`, folded into `report.py`): page 1
carries item 1's prompt, every prompt is whole, and no page ends on a
lone `Tree N` caption — positions from `pdftotext -tsv`, with the
tail of an options run ("Circle one." → ○ Tree 1 / Tree 2) excluded
since a last-line "Tree 2" there is an option, not a caption. The
paper-text rebuild ports `PAPER_VERBS`/`{a,b,c,set}` filling from
`web/src/worksheets/reading.ts` + `web/src/reading/state.ts` into
Python; `test_pdfcheck.py` pins the table against the TS source.
Regenerated print-only visual baselines (48 `*-print-*` files) in the
pinned CI image; no screen baseline changed.

- **Files this session changed outside the Task 15 Files block:**
  - `docs/decisions.md`: this entry.
  - `docs/checkpoints/v1.4d-release.md`: §21 items (m)/(n), the §14
    automated-coverage line.
  - `web/src/index.css`, `web/src/views/worksheets/worksheets.css`:
    the print rules.
  - `web/e2e/worksheets.spec.ts`: the print-rules e2e.
  - `web/e2e/__screenshots__/`: 48 regenerated `*-print-*` baselines.

Follow-up (2026-11-23): `report.py` puts its own directory on `sys.path` before `import pdfcheck` — `run.sh`'s deliberate `python3 -I` drops it — with a `ReportIsolatedTest` regression in `test_pdfcheck.py`, now wired into `check.sh` (a ci.yml step needs the owner's `workflows` permission).

## v1.4d Task 15 checkpoint findings — fix round 2 (owner: "fix both in this pr", 2026-11-22)

The first round's after-PDFs still showed (a) prompts splitting across
pages or ending a page without their first figure — Chromium never
honoured `break-after: avoid` into the `.ws-read-trees` flex row —
and (b) `trees-form-b` ending on a footer-only page. The keep-together
is now structural: `.ws-lead` wraps prompt + first figure
(`display: contents` on screen, unbreakable block in print) and the
prompt itself gets `break-inside: avoid-page`. The footer/closing
block can't strand because the last item's `.ws-tail` wraps its
answer space + `.ws-end` (closing + footer) into one `inline-block`
in print — atomic content, since Blink fragments even `break-inside:
avoid` and `overflow: hidden` boxes inside an already-splitting
parent (verified empirically on trees-demo item 25). Same `.ws-end`
wrap on the lab paper sheet's finish section, the paper key's
finished-tree section and the lab page's note section; reading/lab
key items are `break-inside: avoid-page` in print (each is a small
question+answer+explanation block) and the reading key's footer
prints inside its last item. Screen layout is identical by
construction — every wrapper is `display: contents` or margin-matched
— and all 42 worksheet screen baselines re-verified unchanged in the
pinned image (the only regenerated files are the 8
`worksheet-reading(-form)-print` baselines). `pdfcheck.py` gained
(d) prompts wholly on one page and never their page's last text and
(e) a last page holding more than the footer/closing block — both
pinned against real `pdftotext` fixtures extracted from the bad
PDFs (`scripts/checkpoint/testdata/`).

- **Files this session changed outside the Task 15 Files block:**
  - `docs/decisions.md`: this entry.
  - `docs/checkpoints/v1.4d-release.md`: §21(m) follow-up text.
  - `web/src/views/worksheets/worksheets.css`,
    `web/src/views/labs/labs.css`: the print rules.
  - `web/src/views/worksheets/ReadingSheetView.tsx`,
    `ReadingKeyView.tsx`, `WorksheetPage.tsx`, `KeyPage.tsx`,
    `web/src/views/labs/LabPage.tsx`: the structural wrappers.
  - `web/e2e/worksheets.spec.ts`: the print-rules e2e.
  - `web/e2e/__screenshots__/`: 8 regenerated
    `worksheet-reading(-form)-print-*` baselines.

## v1.4d Task 15 checkpoint findings — fix round 3 (PR #182 firefox e2e, 2026-11-22)

PR CI's firefox shard failed the print e2e: `break-before: avoid`
computes to `auto` in Firefox (no `avoid` value), so the answer
block's glue to the last figure only held in Chromium — a real gap
for teachers printing from Firefox, not just a test issue. The glue
is now structural like `.ws-lead`'s: `.ws-trail` wraps each item's
last figure together with its `.ws-tail` (the answer space, and on
the last item the closing block + footer) — `display: contents` on
screen, `display: block; break-inside: avoid-page` in print. On a
single-figure item lead and trail merge (`.ws-lead.ws-trail`): prompt
+ figure + answer are one block. `break-before: avoid-page` stays as
a harmless extra; nothing depends on it. The e2e asserts the
structure (the last figure and the answer block share `.ws-trail`,
which keeps a `break-inside` starting with `avoid` in print), never
a computed `break-before`/`break-after` Firefox cannot produce — it
passes on Chromium and Firefox locally, plus a print-media DOM check
in Firefox on the cov-styles and trees-form-a sheets. `.ws-tail`
became a real flex line of the trees row on screen (the trail must
hold it), with the margins that used to collapse through it
re-pointed so the layout is pixel-identical — all 42 worksheet
screen baselines re-verified unchanged in the pinned image; the only
regenerated files are the 8 `worksheet-reading(-form)-print`
baselines. All 24 reading sheet/key PDFs were regenerated and are
clean under pdfcheck.

- **Files this session changed outside the Task 15 Files block:**
  - `docs/decisions.md`: this entry.
  - `docs/checkpoints/v1.4d-release.md`: §21(m) follow-up text.
  - `web/src/views/worksheets/worksheets.css`: the `.ws-trail`/screen
    tail rules.
  - `web/src/views/worksheets/ReadingSheetView.tsx`: the `.ws-trail`
    wrapper.
  - `web/e2e/worksheets.spec.ts`: structural print assertions.
  - `web/e2e/__screenshots__/`: 8 regenerated
    `worksheet-reading(-form)-print-*` baselines.

## v1.4d Task 15 checkpoint finding — fix round 4 (PR #182 Firefox flake, 2026-11-23)

`scripts/checkpoint/browser/release.spec.ts`: the §13 test and the
§8/§14 lab loop navigated by clicking "Load this lab" right after a raw
`page.goto`, aborting the lab page's in-flight font loads — Firefox logs
the NS_BINDING_ABORTED as a console error and `watchConsole` failed the
test (the §13 flake, 2/5 runs). Both clicks now await
`document.fonts.ready` first via the extracted `settleFonts` helper (the
same settle `visitPage`/`visitReading` already did inline; no
`watchConsole` ignore rule was added — a real font failure still fails).

- **Files this session changed outside the Task 15 Files block:**
  - `docs/decisions.md`: this entry.

## v1.4d Task 15 checkpoint finding — fix round 5 (PR #182 iPhone Safari Lessons menu, 2026-11-23)

The owner's real-iPhone pass found the header's "Lessons" menu broken
on iPhone Safari (~390 px) — reproduced in the pinned image on both
the v1.4.2 deploy and this branch, so pre-existing since v1.4c. Three
defects, three CSS causes in `web/src/index.css`:

1. Squashed rows: WebKit lets `<button>` flex items shrink below
   their content inside the capped, scrolling `.lessons-menu-list`,
   so a summary bled into the row below. `.lessons-menu-list > *` now
   takes `flex-shrink: 0` — every row (lesson picks and the Library /
   Reading trees / tour action rows) keeps its natural height and the
   list scrolls instead.
2. Painted under the header controls: `.header-toggles` carried
   `z-index: 40` at all times, but the raise exists only to beat an
   open sheet's scrim (z-index 10). It moved to
   `.app:has(> .sheet-backdrop) .header-toggles`, so an open menu
   paints above every header control while the sheet case is
   unchanged (the drawer scrim stays on top either way, z-index 50).
3. Off-screen left edge: the `right: 0`, `min-width: 300px` list under
   a mid-header button overflowed the viewport's left edge wherever
   the header can wrap. The More menu's established v1.4b fix
   (`position: static` on the menu so `.app-header` is the containing
   block, list anchored to the header's left content edge, viewport-
   capped width) now covers `.lessons-menu` too — below 1024 px and
   in presenter mode at any width; `min-width` yields to the cap at
   320 px so both side margins survive.

The More menu and the Settings drawer were checked for the same
three defects at 320/375/390 px in the pinned image and have none
(the More list already anchored to the header edge and has no height
cap; the drawer is a fixed full-height overlay at z-index 50). The
Guides menu shares the stacking fix and already had its own anchor
rule. New spec `web/e2e/header-menus.spec.ts` pins rows-keep-height /
list-inside-viewport / nothing-paints-over for the Lessons and More
menus at 320×640 and 390×844 under a coarse pointer (hasTouch, plus
isMobile where the engine implements it — Firefox has none) on every
browser project; it failed on the pre-fix code under WebKit and
passes after, on WebKit (pinned image) and Chromium. No snapshot
baseline shows an open menu, so none were regenerated.

- **Files this session changed outside the Task 15 Files block:**
  - `docs/decisions.md`: this entry.
  - `docs/checkpoints/v1.4d-release.md`: §21(o).
  - `web/src/index.css`: the three fixes.
  - `web/e2e/header-menus.spec.ts`: the regression pin.
## v1.4d Task 15 checkpoint finding — fix round 6 (PR #182 owner NVDA pass, 2026-11-23)

The owner's NVDA pass on `?read=trees-reading-a-tree` (Tab navigation)
found three gaps, recorded as §21(p): the question paragraph was never
voiced when Tab entered an answer control, "Show as text" exposed the
tree's text form without any way to reach it, and the first Check was
silent because the verdict `role="status"` mounted together with its
content (a live region inserted with content is never announced —
only later text changes inside it are).

- `.read-question` gets a stable id (`useId` in `ItemView`). Every
  answer control group names itself
  `aria-labelledby="<question id> <instruction id>"`: radio groups
  keep a visually-hidden instruction span (`.read-sr`, the `.rt-live`
  clip pattern) — "Choose one"/"Choose a trait"; checkbox lists gain
  `role="group"` with "Tick every option that applies"/"Tick every
  true statement"; the order builder and the tap-the-tree selection
  readout group under the question alone; the two-tier "Why?" group
  is the exception — see fix round 7 below: it is named by its
  caption alone and described by the question. The
  number input keeps its "Answer" name and carries the question via
  `aria-describedby`. The interactive tree's svg keeps its caption
  name and is described by the question plus the description list.
- `TreeDescription`: the toggle gets `aria-controls` to the list's
  region; the region is named "<label> as text" and `tabIndex={-1}`;
  opening focuses the region, closing returns focus to the toggle.
  The svg's `aria-describedby` points at the `<ul>` id, not the
  region — an accessible name on the referenced node would replace
  the list text in the svg's description. Closed stays clipped:
  browse mode still reaches the text.
- The verdict `role="status"` (practice mode) and the editor's
  engine-answer preview mount once and stay, so the first Check (and
  the retry verdict, the resolved verdict and the "Show answer"
  reveal — all content changes inside the persistent region) is
  announced once each. The `.rt-live` selection status was already
  persistent; `TestSummary` holds no live region. Empty status
  wrappers are unstyled divs — zero size, no baseline changes.
- Tests: group/input naming and `describedby` in
  `QuestionControls.test.tsx`; status persistence, page-level group
  name and svg description in `ReadingPage.test.tsx`; region naming,
  `aria-controls` and focus moves in `TreeDescription.test.tsx`;
  engine-answer status persistence in `ReadingEditor.test.tsx`; e2e
  "Tab reaches an answer group named by the question; the verdict
  region predates Check" in `web/e2e/reading.spec.ts` (runs on
  chromium/firefox/webkit).

- **Files this session changed outside the Task 15 Files block:**
  - `docs/decisions.md`: this entry.
  - `docs/checkpoints/v1.4d-release.md`: §21(p).
  - `web/src/views/reading/ItemView.tsx`: question id, describedBy,
    persistent verdict region.
  - `web/src/views/reading/QuestionControls.tsx`,
    `web/src/views/reading/QuestionControlsTree.tsx`: question-
    labelled groups and inputs.
  - `web/src/views/reading/ReadingTree.tsx`,
    `web/src/views/reading/TreeDescription.tsx`: svg describedby,
    named focusable region, toggle `aria-controls`.
  - `web/src/views/reading/reading.css`: `.read-sr`.
  - `web/src/views/editor/reading/ItemForm.tsx`: persistent
    engine-answer status.
  - `web/src/views/reading/QuestionControls.test.tsx`,
    `web/src/views/reading/ReadingPage.test.tsx`,
    `web/src/views/reading/TreeDescription.test.tsx`,
    `web/src/views/editor/reading/ReadingEditor.test.tsx`,
    `web/e2e/reading.spec.ts`: the §21(p) pins.

## v1.4d Task 15 checkpoint finding — fix round 7 (PR #182 two-tier name collision, 2026-11-23)

The round-6 naming scheme broke e2e on CI (chromium + firefox,
"q-two: wrong then right verdict"): a two-tier item's question text
itself ends "— and why?", so the first tier's name "…and why?
Choose one" already contains a "why?" substring, and the Why? tier's
"…and why? Why?" matched the same `name: "Why?"` locator — `.first()`
picked a first-tier radio, the reason was never answered and Check
stayed disabled.

- The two-tier "Why?" group is now named by its visible caption
  alone (`aria-labelledby=<caption id>`) and carries the question
  via `aria-describedby` — the name is exactly "Why?", the
  screen-reader experience is unchanged (description is voiced on
  entry like the name was). Every other group keeps
  `aria-labelledby="<question> <instruction>"`.
- `web/e2e/reading.spec.ts` targets the group with
  `{ name: "Why?", exact: true }`: the product names are now right,
  but the item text itself still ends "— and why?", so a substring
  match would keep hitting the first tier.

- **Files this session changed outside the Task 15 Files block:**
  - `docs/decisions.md`, `docs/checkpoints/v1.4d-release.md`: this
    entry and the §21(p) mechanism note.
  - `web/src/views/reading/QuestionControls.tsx`: the `RadioList`
    `labelId` branch.
  - `web/src/views/reading/QuestionControls.test.tsx`: the naming
    pin.
  - `web/e2e/reading.spec.ts`: the exact-name locator.

## v1.4d Task 15 checkpoint finding — fix round 8 (owner command 2026-11-23: "add the MEGA thread-count tip to §22 and the instructor guide")

Docs only, no product code: §22 of `v1.4d-release.md` records the
owner-verified MEGA 12.1.4 GUI crash — *Phylogeny → Construct/Test
Neighbor-Joining Tree* on a distance matrix with fewer taxa than
MEGA's saved "Number of Threads" closes the GUI, the dialog itself
can't change the count, and MEGA-CC is unaffected (a MEGA bug, not
NeoPhylo's) — and `docs/instructor-guide.md` carries the
teacher-facing workaround after the 3-hour lab plan ("MEGA twelve"
spelled out to keep the guide's no-data-digits rule). The paragraph
lengthens the guide page, so the six `guide-*` snapshot baselines
were regenerated in the pinned image — no other baseline changed.

- **Files this session changed outside the Task 15 Files block:**
  - `docs/decisions.md`: this entry.
  - `docs/instructor-guide.md`: the MEGA thread-count tip.
  - `web/e2e/__screenshots__/guide-768x1024-{light,dark}-linux.png`,
    `guide-1024x768-{light,dark}-linux.png`,
    `guide-1920x1080-{light,dark}-linux.png`: regenerated for the
    longer guide page.

## v1.5 Task 1: skills map, decisions, architecture, CHANGELOG, Devin model column

- **Spec:** `docs/superpowers/specs/2026-11-18-neophylo-v1.5-classroom-assessment-design.md`
  (revised and approved 2026-11-23); plan
  `docs/superpowers/plans/2026-11-23-neophylo-v1.5-plan.md`; market update
  `docs/market/2026-11-23-market-update.md`.
- **Roadmap changes (owner, 2026-11-23):** the **v1.6** slot — left empty when
  tree reading moved forward as v1.4d — is filled by the **landing page and
  adoption kit**; the **navigation redesign and UI polish pass is v1.5
  milestone 1**, so the new assignment and Grade pages are built in the new
  style and the accessibility audit covers the final UI; development now
  outruns feedback, so **v1.9 and v2.0 wait for the first pilot's feedback**
  (they may be reordered by it); **outreach emails start from about
  2027-01-05** (after v1.6, when instructors finalize spring syllabi); **no
  think-alouds before outreach** (not feasible in December — each early
  pilot's onboarding call serves as one instead).
- **Devin model column:** the plan's Task Index gained a fifth column,
  **Devin**, the model passed to `devin --model` for that task's task, review
  and fix sessions — `swe-2-max` for every v1.5 task (SWE-2 is free and
  unlimited on the owner's plan). `scripts/conductor/plan-index.sh devin
  <version> <task>` prints it (empty when the plan has no Devin column);
  `devin.sh` passes `--model "$DEVIN_MODEL"` when `DEVIN_MODEL` is set, else
  the plan's value, else nothing — an explicit env wins, which is how the
  conductor's one-time Opus fallback (`claude-opus-5-5-high`, counting toward
  the two-round limit and recorded in the status comment) works.
- **Devin is only ever the worker, never the conductor (owner, 2026-11-23):**
  the owner rescoped Task 1 before it ran — Claude conducts every v1.5 task
  (`Opus`/`Sonnet` per the Task Index's Conductor column; `Devin` stays an
  invalid Conductor value and `run-plan.sh` exits 2 on it). The
  Devin-conductor design the plan originally carried (the `neophylo-conduct`
  skill, the `Devin` Conductor value, the `/pixel-check` visual hand-off and
  the fallback rerun, and the post-merge spike) was dropped before
  implementation: its declared "accepted risk" — one model family writing,
  reviewing and judging the same code — is a risk the owner chose not to
  take, so conducting stays with Claude on every task while SWE-2 does the
  task, review and fix work. The plan file was edited in this PR to match.
- **Decided in this plan:** see the plan's "Decided in this plan" list —
  FNV-1a 64-bit written out in `assess/hash.rs` (variant seed, retry seeds,
  `content_hash`, the 20-bit assignment fingerprint; pinned by
  known-answer tests); CRC-16/CCITT-FALSE appended as 4 base32 symbols
  detects any single changed code symbol; code text `NP1-` + Crockford
  base32 grouped by 5, versions first; module layout
  `assess/{mod,hash,assignment,premise,variant,task,precision,code,grade}.rs`
  with `NeoError::InvalidAssignment` and `NeoError::InvalidCode`;
  `assess/precision.rs` holds the display-precision table exported to TS
  (round half away from zero); `GENERATOR_VERSION: u8 = 1` with golden
  variants in `crates/neophylo-core/tests/assess_golden/` (owner gate on
  change); routes `#a=` (lz-compressed like `#x=`/`#r=`), `?grade`, `?embed`
  (also set when `window.top !== window.self`), extension
  `.neophylo-assignment.json`, storage prefixes `neophylo:a:` and
  `neophylo:draft:`; one ~20-symbol outline icon sprite at
  `web/public/icons/ui.svg` (drawn for NeoPhylo or Lucide/ISC, which would
  be listed in THIRD_PARTY_NOTICES and the Licenses page;
  `web/public/icons.svg` deleted); `CHANGELOG.md` at the repo root in
  Keep-a-Changelog format, `## [Unreleased]` for v1.5.
- **Deviations from the plan's text:**
  - The new test is `scripts/conductor/plan-index.test.ts`, not
    `plan-index.test.mjs`: the existing `node --test
    "scripts/conductor/*.test.ts"` line in `scripts/check.sh` and CI picks
    it up unchanged (owner direction; `.github/workflows/` is also outside
    the app's push permissions, so no CI edit was possible anyway).
- **Files outside the Files block:**
  - `docs/superpowers/plans/2026-11-23-neophylo-v1.5-plan.md` — edited to
    match the owner's rescope (Devin conductor removed; Conductor column of
    Tasks 6, 7, 9 and 12 set to `Sonnet`; test renamed `.test.ts`; Task 1
    row and steps retitled).
  - `docs/decisions.md` — this entry.

## v1.5 Task 2: header and navigation redesign

- **Spec:** `docs/superpowers/specs/2026-10-15-neophylo-design.md`
  §16.2–16.3, §16.5, §1 criterion 8; plan
  `docs/superpowers/plans/2026-11-23-neophylo-v1.5-plan.md`; conductor's
  calls in `docs/conductor/notes/v1.5/task2.md` (authoritative where the
  plan file's text differs).
- **Compact layout is M2, as spec §16.3 and the plan's Step 4 say:**
  the <768 header is wordmark, title and one Menu button only; the
  sheet carries every destination, the **Lesson | Sandbox** Mode row
  (the ≥768 pill's same `radiogroup` semantics) and the Dark/Presenter
  rows. task2.md never pinned M1 — the earlier "M1 per task2.md" entry
  was a misread, corrected in fix round 1 by moving the switch into
  the sheet (`PhoneMenuSheet` gained `source`/`onSelectMode` props for
  the Mode row; `Header` no longer renders a pill at compact).
- **`--color-surface-2`, not `--color-surface2`:** nav.css named the
  token with `tokens.ts`'s camel key instead of the generated kebab
  property (fix round 1) — the tray, Menu button and every sheet
  surface silently painted transparent. The sheet panel also gained
  an explicit `background: var(--color-bg)` so nothing from the page
  reads through it; header-nav.spec.ts now asserts these surfaces'
  computed backgrounds are never `rgba(0, 0, 0, 0)`.
- **1024–1279 More contents (the conductor's-call overflow):** Labs,
  Reading trees and the two guides (PHYLIP/MEGA) move behind a "medium"
  `MoreMenu` variant; Lessons, Library, Settings and the toggles stay
  direct. Every destination at ≥768 keeps the same activation count it
  had on main (guides were a 2-activation menu path on main at
  1024–1279 too; Library drops to one activation — "at most today's
  number" allows fewer). Below 768 the sheet's Menu→tile→item flow is
  the path task2.md spells out verbatim.
- **`.app` gained `grid-template-columns: minmax(0, 1fr)`** (index.css):
  the compact header is `flex-wrap: nowrap` so the title ellipsizes, and
  an `auto` grid column sized to content blew the document out to ~545 px
  sideways scroll at ≤390. The pinned column caps every row at the
  container width.
- **Icons:** Lucide 0.469.0 (ISC) glyphs where one fits, hand-drawn
  same-style symbols for the rest, all in the one static sprite
  `web/public/icons/ui.svg` (25 `<symbol>`s, 24 px grid, 1.8 stroke,
  round caps, `currentColor`, no fills). Lucide's ISC notice added to
  `THIRD_PARTY_NOTICES.md`; the generated Licenses page picks it up on
  the next `npm run build` (no generator edit needed). `icons.svg`
  deleted per the task.
- **Long-press tooltip:** pointer events + one 500 ms timer only —
  coarse-pointer tap activates immediately; a ≥500 ms hold shows the
  label and swallows the following click/context-menu (conductor's
  call, §16.3).
- **Label reveal is a pure clip-slide — no opacity fade:** the label's
  `opacity` snaps 0→1 while `max-width` animates. A fading frame paints
  partially transparent text — WebKit's axe run in
  `theme.spec.ts` ("axe is clean in both themes") caught a transient
  `color-contrast` violation on the pressed Dark-mode toggle's
  mid-fade label; opacity-snapping removes the sub-4.5:1 frame
  entirely rather than teaching the test to wait the race out.
  header-label-expanded's baselines were regenerated and came out
  byte-identical — the settled end state is unchanged.
- **Test files the plan named but did not create as separate files:**
  `NavTray.test.tsx` and `Icon.test.tsx` are not separate files — the
  per-breakpoint destination/action matrix the step text describes lives
  in `Header.test.tsx` (the tray is only rendered through Header), and
  Icon is covered through NavItem's render assertions.
- **Rewritten old-header tests (intent kept, structure re-pinned):**
  - `Header.test.tsx` — the tour-button absence, Guides-at-≥1280-only,
    Labs/Reading-links-at-≥1280 and unsaved-work click-routing tests are
    kept word-for-word in intent; "Guides at ≥1024" was split into
    "guides behind More at 1024–1279, behind the Menu sheet <768" (the
    medium variant owns them now); added compact-mode M2 structure
    (Menu only — no header pill), sheet open/close, the sheet's Mode
    row switching, in-sheet Lessons list and tile activation coverage.
  - `MoreMenu.test.tsx` — added the "medium" variant's four-item
    inventory (the two guides, Labs, Reading trees — nothing else) so a
    stray item can't reappear at 1024–1279.
  - `header-menus.spec.ts` — the iPhone-Safari regression pin was
    re-pointed from the old <768 dropdown lists to the phone sheet: same
    three checks (rows keep content height, list inside the viewport
    with ≥8 px margins, nothing paints over an item) on the in-sheet
    Lessons list and the tile grid at 320×640 and 390×844.
  - `narrow.spec.ts` — <768 paths that used to reach Settings, the
    matrix import and Reading trees through header chips now enter via
    Menu → tile → same destination; assertions on the destination are
    unchanged. The two 375 px mode-switch paths (Lesson-view check,
    Sandbox-view and the coarse-pointer matrix case) flip the sheet's
    Mode row instead of a header pill (fix round 1, M2) — same checked
    radio assertion, one open closer.
  - `sheets.spec.ts` — the 1024 "Guides list inside the viewport" case
    now opens More (Guides moved behind it at 1024–1279); the 375 px
    More-list case was dropped as superseded by header-menus' phone-
    sheet checks (same surfaces, new structure).
  - `tour.spec.ts` — `HEADER_HEIGHT` updated to the measured 65 px (the
    tray header is one row at ≥1024); the compact reopen path is
    Menu → Take the tour (was More → Take the tour); comments re-stated.
  - `labs.spec.ts` — the guides-opening helper opens More below 1280,
    the Guides button at ≥1280 (was: Guides button at ≥1024).
  - `layout.spec.ts` — the header-controls count pin was updated to the
    new inventories (7 at ≥1280, 8 at 1024–1279, 7 at 768–1023; links
    checked separately); the click-every-control loop now detects
    navigation with waitForURL + a load-state settle instead of trusting
    `page.url()` read timing (Library/Sandbox navigate via
    `location.assign` — the old goBack approach landed on about:blank
    after a round trip), and restores a toggle it clicked (Presenter
    mode hides Settings, which shifted the remaining indices);
    `revealByPageScroll`'s minimal-delta scroll now rounds to an integer
    px toward visibility — WebKit truncates fractional scrollTop, which
    wedged a 0.27 px remainder at 640×400×2 forever.
  - `visualScenes.ts` — three new scenes appended:
    `header-label-expanded`, `header-menu-open`, `phone-sheet-open`
    (360×740). `header-label-expanded` polls the label's settled end
    state (computed `max-width` reaches the 140 px target) rather than
    a fixed sleep; all other frames settle via the existing
    `animations: "disabled"` + `settleFrame`.
- **Files outside the Files block:**
  - `web/src/main.tsx` — imports `design/nav.css` (after index.css so the
    tray overrides win at equal specificity).
  - `web/src/views/Header.test.tsx`, `web/src/views/MoreMenu.test.tsx` —
    the block lists the components but not their test files; both were
    rewritten/extended per Step 5.
  - `web/e2e/labs.spec.ts`, `web/e2e/layout.spec.ts`,
    `web/e2e/sheets.spec.ts` — outside the block's named spec list; each
    change is listed above and only re-pins the moved navigation paths
    or fixes the scroll/nav races the new header exposed.
  - `web/e2e/theme.spec.ts` — the two axe-after-toggle tests now wait
    for the toggle's 120 ms `background-color` transition to finish
    (`getAnimations` → `playState === "finished"`) before analyzing:
    WebKit's axe samples mid-transition colors and reported the new
    tray label — and an untouched pair-panel button — as low contrast.
    The assertions are unchanged; the sampled state is the settled
    theme the test always meant to check.
  - `docs/decisions.md` — this entry.
- **Not done on purpose:** `presenter.spec.ts` and `a11y.spec.ts` were in
  the modify list but needed no edits — presenter-hides-Settings and the
  axe coverage hold under the new structure unchanged.

## v1.5 Task 3: UI polish pass

- **Spec:** `docs/superpowers/specs/2026-11-18-neophylo-v1.5-classroom-assessment-design.md`
  §16.4–16.5; plan `docs/superpowers/plans/2026-11-23-neophylo-v1.5-plan.md`;
  conductor's calls in `docs/conductor/notes/v1.5/task3.md` (authoritative
  where the plan file's text differs).
- **What counts as a "button" for the four-class sweep (conductor's call,
  verbatim):** `<button>` elements and `<a>` elements styled as buttons.
  Excluded — they keep their own component styling, and must still use
  tokens and a visible focus ring — elements with `role` `menuitem`,
  `menuitemradio`, `tab`, `radio`, `switch` or `option`, form
  inputs/sliders, and links that read as text links. The rule is encoded
  as the named constant `SWEPT_BUTTON` in `web/e2e/polish.spec.ts`, and
  controls that read as text links carry the marker class `.text-link`
  (`.guide-link`, `.revisit`), which the selector excludes.
- **The header, tray, More/Lessons menus, mode pill and phone sheet stay
  Task 2's (owner-approved):** the sweep's `OUT_OF_SCOPE` selector skips
  `.app-header` and `.phone-sheet` descendants. The pair panel and
  replicate panel are likewise outside this pass's reach (`.pair-panel`
  — unless it is one of the two guide sheets, which reuse that class —
  and `.replicate-panel`); their sheet chrome still adopts the classes
  so every sheet's close button and nav share the one look.
- **Variants used:** `btn-primary` for each group's forward action
  (Import, the confirm's requested action, the stepper's Play, the
  prompt's Continue, the tour's Next); `btn-secondary` for the bordered
  default; `btn-ghost` for quiet affordances (dataset rows, prompt
  Show pair, replicate nav, tour Back/Skip); `btn-icon` for the square
  36 px sheet-close buttons. Added glyphs come only from the existing
  `ui.svg` sprite (prev/play/pause/next, download, close, labs, back)
  and are `aria-hidden` beside unchanged label text.
- **Controls column:** "How sure are we?" and "Export" keep their
  existing `<h2>` wording and become equal-width stacked groups
  (`.bootstrap-actions`, `.export-buttons` → column flex, stretch);
  polish.spec.ts asserts widths equal within 1 px and no mid-word
  label wraps at 1024/1280/1920.
- **Token rule enforced in CI:** `design/buttonsCss.test.ts` fails on
  any `var(--…)` in the touched stylesheets that `tokens.ts` does not
  define (the `--color-surface2` regression from Task 2). Deeper
  hover/active shades use `color-mix()` on `--color-accent`, the
  allowed derivation — no new colours, no font changes.
- **Motion:** hover lift is `translateY(-1px)` over 120 ms; the
  `prefers-reduced-motion: reduce` block repeats the `:not(:disabled)`
  guards so its `transform: none`/`transition-duration: 0s` beats the
  live-state rules on specificity.
- **Files outside the Files block:**
  - `web/src/design/buttonsCss.test.ts` — the conductor's-call token
    unit test (the task's Create list names only the two files above).
  - `web/src/main.tsx` — imports `design/buttons.css` after index.css so
    equal-specificity rules win, the Task-2 nav.css pattern.
  - `web/src/views/App.tsx` — hosts the reroot toggle and the
    leave-for-library confirm's buttons; both are swept surfaces.
  - `web/src/views/{AlphabetBadge,ExplanationPanel,ImportPanel,
    ModeToggle,PromptCard,TeachingNotices,ErrorBoundary}.tsx` — buttons
    on the swept `?lesson`/sandbox surfaces (the block names the
    stepper alone; the sweep covers every page-content button).
    `ImportPanel` is a controls-column section; `ModeToggle`'s radios
    are sweep-excluded but keep the token styling.
  - `web/src/views/{PairPanel,ReplicatePanel,PhylipHelp}.tsx` — sheet
    chrome: `×` → sprite `close` icon buttons, replicate nav to
    `btn-ghost`, the PHYLIP guide's text links marked. PhylipHelp is a
    guide sheet — in reach under "guides" though the block names only
    MegaHelp.
  - `web/src/views/matrix/**` — the matrix session's controls column
    and its sheets, swept on `?lesson` matrix sessions and the grid
    dialog.
  - `web/e2e/helpers.ts` — `waitForApp`'s visibility timeout raised to
    30 s: a cold dev server in the pinned container compiles the
    route's modules on first hit and can outlast the 5 s default.
  - `web/src/views/Sheet.tsx` — one selector character, `a[href]` for
    the old bare `[href]` in `FOCUSABLE`: icons put `<use href>` inside
    buttons, and the bare selector picked the unfocusable `<use>` of a
    disabled button as the "first focusable" — focus never entered the
    replicate sheet and Esc could not close it.
  - `docs/decisions.md` — this entry.

**Fix round 1 (PR #186):**

- `web/public/icons/ui.svg` — Task 2 drew the sprite and the Files
  block does not name it, but the `next` symbol shipped broken
  (`m9 18 6-6 6-6`, a straight diagonal — visible as a "/" slash in
  the stepper, replicate panel and tour once this task stamped it);
  corrected to the mirror of `prev`, `m9 18 6-6-6-6`.
- `web/src/design/sprite.test.ts` — new unit test pinning the `prev`
  and `next` path data exactly.
- `web/e2e/visualScenes.ts`, `web/e2e/visual.spec.ts` — baselines must
  show the rest state: `parkPointer` moves the mouse to a scanned
  non-interactive, non-header point before every shot (the
  editor-prompts baseline had captured "Add note" lifted on hover);
  `header-label-expanded` carries `keepHover` because its frame IS the
  tray item's hover slide.
- `web/src/index.css` — `.dataset-list .dataset-open` gains
  `align-items/justify-content: flex-start` and `text-align: start`:
  the rows are list items, not centred buttons (the title, size line
  and description had centred under `.btn`'s centering). DatasetSheet
  is a named Modify file; its row rule lives in index.css.
- Assertions added to `web/e2e/polish.spec.ts` (a Create file): the
  open dataset sheet asserts each row's title `getBoundingClientRect()
  .left` equals the row's content-box left within 2 px. No existing
  assertion was removed or rewritten.

## v1.5 Task 4: engine assess module (variants, premises, gradable tasks)

- **Spec:** `docs/superpowers/specs/2026-11-18-neophylo-v1.5-classroom-assessment-design.md`
  §4, §5.1–5.3, §5.6 (engine side); plan
  `docs/superpowers/plans/2026-11-23-neophylo-v1.5-plan.md` Task 4;
  conductor's calls in `docs/conductor/notes/v1.5/task4.md`
  (authoritative where the plan file's text differs).
- **`premises` on `Exercise` and `ReadingSet` is a `Vec<Premise>`, not
  `Option`:** the conductor called for `#[serde(default,
  skip_serializing_if = "Vec::is_empty")]` plus `#[ts(optional)]` "as
  `meta` does", but ts-rs 12 accepts `optional` only on `Option`
  fields. The fields use `#[ts(as = "Option<Vec<Premise>>", optional)]`
  — the generated TS is `premises?: Array<Premise>` on both types,
  the same wire shape the conductor's wording aimed for.
- **`TaskAnswer::Number` / `AcceptedAnswer::Number` stay `i64`:**
  `#[ts(type = "number")]` sits inside the variant parens (the
  `Pairwise` pattern in `reading/response.rs`); placing it on the
  variant itself is silently ignored and emits `bigint`, which
  `crates/neophylo-wasm/tests/native.rs::generated_types_have_no_bigint`
  (spec §4) refuses.
- **`PRECISION` is not exported to TS in this task:** the plan's
  `const PRECISION` exists as `&[(Quantity, u8)]` in
  `assess/precision.rs`; the conductor reserves the TS export and the
  web formatter-agreement test for Task 6.
- **The minimal `Assignment` model** (`assignment.rs`: `IdPrompt`,
  `Mode`, `GradedTask`, `Assignment::variant_for`) implements spec
  §5.1's engine side only — id normalisation plus per-student variant
  production. Completion-code encoding, grading and golden files are
  Task 5; wasm bindings are Task 6.
- **`predict_pair` on a `tie_same_split` join accepts every pair in
  `tied`, and on an ambiguous tie accepts every tied pair too**
  (conductor's call); `ClosestRaw` refuses an ambiguous closest-pair
  tie with `InvalidAssignment`.
- **Files outside the Files block:**
  - `crates/neophylo-core/src/exercise.rs` — the `premises` field on
    `Exercise`, its `ExerciseFile` mirror (presence-aware, v5-only)
    and the `premises_file` hand validator (conductor-named).
  - `crates/neophylo-core/src/reading/set.rs` — the `premises` field
    on `ReadingSet` (conductor-named).
  - `crates/neophylo-core/src/reading/load.rs` — `premises` `take` and
    the duplicate-name refusal (the reading loader's existing error;
    conductor-named).
  - `exercises/schema.json` — the `premises` key (v5-only via the
    `v5Identifiers` rule's `allOf`; conductor-named).
  - `exercises/reading.schema.json` — the `premises` key
    (conductor-named).
  - `web/src/editor/exerciseFile.ts` — `"premises"` in
    `EXERCISE_KEYS`, emitted by `exerciseToFile` when non-empty, and
    a schema-5 bump when premises are present (mirrors `meta`;
    required by `exerciseFile.test.ts`'s import→save round-trip —
    the "existing tests pass unmodified" rule).
  - `web/src/editor/draft.ts` — `premises` on `PreservedFields`/
    `EMPTY_PRESERVED`/`preservedFieldNames`/`settingsFromExercise`/
    `buildExerciseState` (verbatim carry-through + schema-5 bump;
    required by `draft.test.ts`'s deep-equal round-trip).
  - `web/src/views/editor/reading/readingDraft.ts` — `premises` on
    `ReadingDraft`, carried verbatim through `buildWireSet` and
    `draftFromSet` (mirrors `meta`).
  - `web/src/explain/errors.ts` — `errorMessage` cases for the new
    `InvalidAssignment`/`InvalidCode` kinds (the `never`
    exhaustiveness check makes this a compile error otherwise).
  - `web/src/explain/errors.test.ts` — `VARIANTS`/`TITLES` entries for
    the same two kinds (`TITLES` is `Record<NeoError["kind"], _>` —
    forced, not a semantics change).
  - `web/src/engine/generated/*.ts` — regenerated ts-rs output:
    `Premise`, `TaskRef`, `TaskAnswer`, `AcceptedAnswer`,
    `PairRole`, `Quantity`, `Content`, `Variant`, `Assignment`,
    `GradedTask`, `IdPrompt`, `IdRule`, `Mode`, plus `premises?` on
    `Exercise`/`ReadingSet` and `InvalidAssignment`/`InvalidCode` on
    `NeoError` (generated by the engine; not hand-edited).
  - `docs/decisions.md` — this entry.

### v1.5 Task 4 fix round 1 (PR #187 review)

- **Derived-matrix variants are exactly additive:** `random_tree`
  rounds every drawn branch length to the author's decimals
  (`author_decimals`) at generation, floored at `10^-d`, and
  `transform_derived_matrix` builds the variant's `lower` with
  `additive_matrix(&tree, None)` — the matrix *is* the reference
  tree's path-length matrix, so the lesson note "every distance in
  the cells is the exact path between two tips of that tree" stays
  true and the reference panel shows the author's decimals.
- **`bootstrap` carry:** the variant's bootstrap seed is the attempt
  seed masked to `sim::MAX_SEED` (2^53 − 1), so the TS `number`
  survives a JS round trip. Every served variant — `vary == false`,
  any retry, `fell_back` — carries it: `Variant.seed` is the masked
  value, and an exercise with an alignment (`Simulated`, `Embedded`,
  labs) additionally gets `content.bootstrap = { replicates:
  min(base or 100, 200), seed }` injected (the block the app's panel
  reads). `predict_branch` reads replicates and seed from
  `content.bootstrap` only (single source), falling back to the app
  defaults (100, 1) when a hand-built variant lacks the block.
  Matrix exercises keep `bootstrap: None`; reading sets have no
  block.
- **Existing-test updates the carry forces:**
  `impossible_premise_falls_back_to_base` and
  `vary_false_returns_base_with_seed` now compare served content to
  the base with the injected `bootstrap` stripped — a variant's
  content is "the base" apart from that block.

## v1.5 Task 5: completion codes, grading, golden variants

- **Spec:** `docs/superpowers/specs/2026-11-18-neophylo-v1.5-classroom-assessment-design.md`
  §5.4, §5.5, §5.7, §5.8, §11; plan
  `docs/superpowers/plans/2026-11-23-neophylo-v1.5-plan.md` Task 5;
  conductor's calls in `docs/conductor/notes/v1.5/task5.md`
  (authoritative where the plan file's text differs).
- **Derived-matrix variants serve the author's decimals (owner call,
  2026-11-25, done before any golden file):**
  `transform_derived_matrix` builds the served matrix with
  `additive_matrix(&tree, Some(d))` at the author's decimals `d`, not
  `None` — the generated branch lengths are already rounded to `d`, so
  this only strips binary float noise from the path sums (a served
  cell is `0.3`, not `0.30000000000000004`). Supersedes the `None`
  choice recorded under Task 4 fix round 1. The built-in known answers
  (`d = 0`) are unchanged; `tests/assess_variant.rs` pins `d = 2`.
- **Packed answers are index form, not `TaskAnswer` (deviation from
  the plan's `Attempt { first: TaskAnswer }`, conductor-approved):**
  `TaskAnswer::Branch` and reading `Response`s carry taxon names and
  letters as strings, which cannot fit 250 chars, and `decode_code`
  has no assignment to map names with. `PackedAnswer` carries tip and
  letter indices, bitmask tip sets and a Lehmer-coded order over the
  variant's **name table** (`name_table(variant)`: exercise → the
  distance-matrix label order; reading set → sorted unique labels
  across all its trees), plus `Skipped`. `pack_answer`/`unpack_answer`
  convert via that table; `Attempt` stores `first`, an optional
  `last` (omitted when equal) and `attempts`; `TaskResult.{first,last}`
  are `Option<TaskAnswer>` — `None` on skip or unpack failure (wrong,
  never a grading error).
- **Limits** (conductor): `MAX_ID_BYTES = 64` on the *normalised* id —
  `encode_code` refuses a longer one with `InvalidCode "length"` and
  `normalise_id` itself is unchanged (Task 8 refuses long ids at
  entry). Numeric answers must fit `i32` (`"malformed"` otherwise);
  `attempts` clamps at 15 (4 bits, documented); `retry` 0..=50;
  `finished_min` is 24 bits; `MAX_TASKS = 15`.
- **Wire layout** (module doc in `code.rs`): `NP1-` + Crockford base32
  in groups of 5 — format 1, generator 1 (`GENERATOR_VERSION`), 20-bit
  fingerprint, length-prefixed UTF-8 id, retry, task count, per task
  one kind tag + first body + has-last bit + last body + attempts,
  `finished_min`, then CRC-16/CCITT-FALSE byte-aligned. The decoder is
  lenient (case-insensitive, `i`/`l`→`1`, `o`→`0`, ignores separators,
  finds `np1-` inside pasted text) and never panics; every rejection
  is `InvalidCode` with one of the spec's five reasons.
- **Fingerprint:** low 20 bits of `fnv1a64` over `serde_json::to_vec`
  of the assignment **with `content` replaced by the recorded
  `content_hash` string when one is recorded** (a built-in reference),
  else the full assignment — so an edited embedded exercise grades
  `AssignmentMismatch` while a changed built-in grades
  `ContentChanged`.
- **`Assignment` gained two fields** (conductor): `content_hash:
  Option<String>` (recorded at authoring; `#[serde(default,
  skip_serializing_if)]`, `#[ts(optional)]`) and `served_content_hash:
  Option<String>` (`#[serde(skip)]`, `#[ts(skip)]`, set by Task 6's
  loader); `grade` adds `ContentChanged` when both are `Some` and
  differ. `content_hash(bytes)` in `assess/hash.rs` is the 16-hex
  `fnv1a64` digest.
- **Grading:** `decode_code` errors propagate as `Err(InvalidCode)`;
  fingerprint, task-count or retry mismatch → `Ok` score 0, empty
  `tasks`, `AssignmentMismatch` (never guess); `lms_id` is normalised
  and compared → `IdMismatch` (an un-normalisable LMS id flags, never
  errors). `Flag::{Checksum, Duplicate, Missing}` exist for Task 9's
  class checks and are documented as such. `Rule::Weighted { partial }`
  outside `0..=1` or non-finite → `InvalidAssignment { field: "rule" }`.
- **Golden files** live in `crates/neophylo-core/tests/assess_golden/`
  (6 assignments × 5 ids incl. `" Ana.Lopez@Uni.edu "`, `josé`, a
  64-byte id), generated once by `#[ignore]`d `regen_assess_golden`
  and verified by a second `golden_variants_recompute_exactly` run;
  each records the assignment inline, `generator`, normalised id,
  seed-as-string, `retry`, `fell_back`, the `content_hash` data digest,
  a readable excerpt (taxon order, first matrix row) and every task's
  accepted answer.
- **Files outside the Files block:**
  - `crates/neophylo-core/src/assess/mod.rs` — module wiring and
    re-exports for `code`/`grade`/`content_hash`.
  - `crates/neophylo-core/src/assess/assignment.rs` — the two
    `Assignment` fields above (conductor-named).
  - `crates/neophylo-core/src/assess/variant.rs` — the
    `additive_matrix(&tree, Some(d))` owner decision.
  - `crates/neophylo-core/src/assess/hash.rs` — `content_hash`
    (conductor-named).
  - `crates/neophylo-core/tests/assess_variant.rs` — the `d = 2`
    derived-matrix test (owner-required).
  - `crates/neophylo-core/fuzz/Cargo.toml` and `scripts/ci/fuzz.sh` —
    `code` target registration (conductor: "registered wherever the
    other targets are"; the nightly workflow enumerates none, so no
    workflow file needed a change).
  - `web/src/engine/generated/*.ts` — regenerated ts-rs output
    (`Rule`, `Flag`, `TaskResult`, `GradeResult`, `content_hash?` on
    `Assignment`; generated by the engine, not hand-edited).
    `PackedAnswer`/`Attempt`/`CodePayload` stay engine-side: their
    `u64` mask/rank fields would emit `bigint`, which the no-bigint
    guard refuses — TS consumers see `TaskAnswer`, not the wire form.
  - `docs/decisions.md` — this entry.

### v1.5 Task 5 fix round 1 (PR #188 review)

- **Content-sized widths (review item 1):** the fixed 16-bit tip
  index, 64-bit masks/ranks and 8-bit option indices are gone — a
  70-tip clade could not encode at all and 15 `predict_pair` tasks
  cost 411 chars. The header gains the name-table size `names`
  (8 bits, 1..=`MAX_NAME_TABLE` = 200) right after `task_count`, and
  `grade` scores `AssignmentMismatch` when it differs from the
  rebuilt variant's table size. A tip index is `tip_bits(n) =
  max(1, ⌈log₂N⌉)` bits; a tip set/clade mask is exactly `N` bits;
  reading multi-picks self-delimit (`Choices`: 8-bit mask width `m`
  + `m` mask bits; `Order`: 7-bit count `k` + `k` positions of
  `idx_bits(k)` bits — the `u64` Lehmer rank is gone, so orders above
  ~21 nodes encode); single picks and two-tier reasons carry the
  index as `w−1` in 3 bits + `w` bits (`w = idx_bits(i+1)`, 1..=8).
  `max_code_len` prices the content's own table and each item's
  option/node counts (`content_name_table`, `index_domain`,
  `trait_domain`), still an exact worst case. Numbers stay
  `|n| ≤ 2³¹−1` — the quantity scale pins real answers to ±2·10⁹,
  and a wider bound would only buy room no content can reach.
  Layout stays `format = 1`, `generator = 1`: nothing is released,
  so no version bump (the golden files' `generator` field is the
  constant, and only `numeric-tasks.json` changed this round).
- **Impossible ids refused at decode (item 2):** `id_len == 0` or
  `> MAX_ID_BYTES` in the wire header is `InvalidCode "length"` — a
  code no real finish flow can emit. `grade` maps a `normalise_id`
  failure on the code's (decodable) id to `InvalidCode "malformed"`,
  not `InvalidAssignment` — e.g. a 3-byte blank id.
- **Numeric golden covers every quantity and role (item 3):** the
  `numeric-tasks` assignment grew from 3 to 8 tasks —
  `corrected_distance`/`q_value` × `chosen`/`closest_raw`,
  `new_distance`/`closest_raw` at step 3 (a member stays active for
  all five ids — steps 1–2 don't), and `branch_length` ×
  `chosen_first_to_new`/`chosen_second_to_new`. Only
  `numeric-tasks.json` regenerated; the other five golden files are
  byte-identical (the packed-answer layout is not part of their
  content, and `names`-aware packing doesn't change variant data).
- **TwoTier cannot nest (item 4):** `read_answer`'s tag-9 recursion
  had no depth limit — a crafted code with ~6,000 nested tags
  overflowed a wasm-sized stack. The inner answer of a TwoTier may
  not be `TwoTier` or `Skipped` (validated content never produces
  either) — the decoder refuses at the inner tag with `"malformed"`,
  and the encoder refuses to write one, keeping
  `decode(encode)` an identity. A committed fuzz seed carries the
  crafted code (`fuzz/seeds/code/nested_two_tier.txt`).
- **Serde gap pins for `Assignment.content_hash` (item 6):**
  `"content_hash": null` parses as `None` — serde's `Option` rules
  make an explicit null the same as an absent key, and the builder
  never writes it (`skip_serializing_if`) — while `[]`/`["x"]` fail
  at parse (the key is typed). `"served_content_hash"` in input JSON
  is ignored (`#[serde(skip)]`; the Task 6 loader sets it from file
  bytes). Pinned in `tests/assess_code.rs`.
- **Files outside the Files block this round:** none new — the
  changes land in `assess/code.rs`/`grade.rs` and the
  `tests/assess_{code,code_props,grade,golden}.rs` files the task
  already touched, plus `fuzz/seeds/code/nested_two_tier.txt` and
  `numeric-tasks.json` (the item-3 regeneration the notes approve).

### v1.5 Task 5 fix round 2 (PR #188 status comment)

- **Per-student tip (row) order — owner decision 2026-11-25, option
  A:** rotation alone kept every cherry at fixed matrix positions
  (in `nj-basics`, step 1's pair sat at positions (2,3) for all five
  golden ids), so students could share "join rows 3 and 4". Variants
  now also shuffle the tip order. `SimSpec` gains
  `tip_order: Option<Vec<String>>` — a permutation of the variant
  tree's leaf labels that `simulate` applies after drawing rows, so
  the per-taxon sequences (and RNG draw order) are unchanged, only
  the emitted row order differs. `transform_simulated` fills it with
  a Fisher–Yates shuffle seeded by `sub_seed(seed, "order")`, and
  `transform_derived_matrix` permutes `names`/`lower` the same way
  after `additive_matrix` (reference tree unchanged, `Some(d)`
  rounding kept). `None` keeps the old preorder emission, so every
  authored file, parity test, sim golden hash and fixture stays
  byte-identical. The modal step-1 index-pair share over 200 ids
  dropped to 10 % (`nj-basics`) and 9.5 % (`upgma-vs-nj-matrix`);
  the 1,000-id sweep still has 0 fallbacks on all 14 exercises.
- **`tip_order` file format:** `sim.tip_order` is a v5-only key on
  the `sim` object — a JSON array of unique strings, validated at
  load as a permutation of the tree's leaf labels (`InvalidExercise`,
  never a panic); `null`, non-arrays, non-string members, duplicates
  and missing/extra names are refused. In-file it is presence-aware
  (`Option<Option<Value>>`, same serde gap as `site_filter`): absent
  → `None`; explicit `null` → refused (`"sim.tip_order"`), since the
  engine's own `SimSpec` would read a served `null` as absent.
- **Files outside the Files block this round:** `sim.rs` (the field,
  `check_tip_order`, the reorder in `simulate`), `exercise.rs`
  (`SimFile.tip_order`), `exercises/schema.json` (the v5 key +
  v2–4 refusal), regenerated `web/src/engine/generated/SimSpec.ts`,
  and the `SimSpec` literal updates in `tests/sim*.rs`,
  `tests/seed_scan.rs` and `neophylo-wasm/tests/parity.rs`.
  Regenerated golden files: `simulated-lesson`, `derived-matrix`,
  `numeric-tasks`, `bootstrap-predict-branch`; `fixed-data-lab` and
  `reading-set` are byte-identical (verified by two golden runs).

### v1.5 Task 6 (assignment format, bindings and `#a=` links)

- **Link refusals are `NeoError` values, not a new `LinkError` type:**
  the plan's `decodeAssignmentLink(hash): Assignment | LinkError` is
  realized as the repo's `Result<Assignment>` envelope — a pre-engine
  refusal is `InvalidAssignment { field: "link" }` so the page renders
  link and load failures identically. `#a=zzz` reports "the assignment
  could not be decompressed", never the engine's load message
  (checkpoint §21(h)).
- **`builtin` wire shape:** the authored file carries
  `content: { builtin, content_hash }`; the resolver (`assess/url.ts`)
  injects the served text as `content.file` before `loadAssignment`
  runs, so `Assignment.served_content_hash` is set on every load and
  grading flags `ContentChanged` for a stale recorded hash. The file
  bytes never ride in the link — that is what makes the staleness flag
  possible. Builtin resolution globs `exercises/*.json`, `labs/*.json`,
  `reading/**/*.json` by stem (lazy `?raw`, like the lab/reading
  registries); an id with path separators can never match a glob key.
- **`EncodeAttempt` wasm-side struct:** `encodeCode` takes one record
  per graded task (`first`/`last` as `TaskAnswer | null`, `attempts`)
  and the engine packs via `pack_answer` — packing never happens in
  TypeScript (spec §5.4). Length mismatch → `InvalidAssignment` naming
  `attempts`.
- **Interface spellings vs the plan's:** the plan's `PRECISION`
  constant is exposed as `engine.precision()` returning
  `[Quantity, number][]` — a `const` cannot cross wasm-bindgen — and
  `decodeAssignmentLink` is `async` because builtin content resolves
  through lazy `?raw` globs.
- **Files outside the Files block this round:**
  `crates/neophylo-core/src/assess/{load,prose}.rs` (new modules — the
  block lists `assignment.rs` only; `load_assignment` and
  `prose_names_taxa` live in their own files per the one-file-one-job
  rule), `assess/mod.rs` (wiring), `assess/code.rs` (`Serialize +
  Deserialize + TS` on `PackedAnswer`/`Attempt`/`CodePayload` so the
  wasm bindings can cross them — all fields are JS-safe widths),
  `exercises/content-hashes.json` (the Step-3 artefact, 27 builtin
  ids), `web/src/views/{assignment/AssignmentStart,grade/GradePage}.tsx`
  (the stub pages `Root.tsx` lazy-loads), the regenerated
  `generated/{Attempt,CodePayload,EncodeAttempt,PackedAnswer}.ts`, and
  `web/src/assess/precision.test.ts` (new — pins the web formatter
  against the engine `PRECISION` table). The fix round also touched
  `web/src/test/setup.ts` and `web/src/engine/worker.ts` — every
  engine wrapper now calls the raw `init()`/`initSync` exports
  (`bindWasmExports` seeds them), so all wasm-bindgen param
  marshalling glue is tree-shaken out of the initial bundle (§8.2).
  `content-hashes.json` also needed an exclusion in every enumerator
  that filters only `*schema.json` out of `exercises/*.json`:
  `tests/lesson_premises.rs`, `web/src/lessons/{schema,catalog,lessons,content}.test.ts`
  (content's `EXEMPT`), `web/src/editor/{draft,exerciseFile}.test.ts`,
  `web/src/state/session.test.ts`, `web/src/views/Controls.test.tsx`,
  `web/src/worksheets/build.test.ts`, `web/e2e/{library-page,worksheets}.spec.ts`
  and `scripts/checkpoint/browser/release.spec.ts`.
- **Sandbox note:** `wasm-pack` could not write its
  `~/.cache/.wasm-pack` temp dir in this environment; the pkg was
  rebuilt with `WASM_PACK_CACHE` pointed at a pre-seeded copy of the
  same cache. No repo files change — the env only redirects
  wasm-bindgen/wasm-opt lookup.

### v1.5 Task 7 (assignment builder and editor autosave)

- **`builtinText` is exported from `assess/url.ts`:** the plan's
  Files block lists it as private, but the builder resolves
  `builtin` content through the same lazy `?raw` glob the link
  resolver uses — exporting the one function keeps a single stem
  glob instead of a second copy (one-file-one-job; the id→text map
  belongs to the URL module).
- **`builder.ts` holds the builder's model:** the Files block names
  three `.tsx` components; the pure helpers (content resolution,
  the authored-file shape, refusal wording, task labels, the
  draft's `validate`/`draftForParam`) live in a sibling module so
  the components stay view-only and the helpers unit-test without
  a DOM (same split `readingDraft.ts` uses for the reading editor).
- **Autosave keys and payloads:** `neophylo:draft:exercise|matrix|
  reading|assignment`, one object per kind. Exercise/matrix drafts
  are the compact wire form (`{v,n,s,p,x,r}`) — the Newick and
  file extras round-trip through the same conversion `applyLoaded`
  already uses; the assignment draft is the builder's full
  `BuilderDraft` including the generated `id` (variant seeds key
  off it, so a restored draft must keep the id it was born with or
  the sample students shift under the instructor's feet).
- **One draft slot each for exercise and matrix:** the editor has
  one live tree; a matrix-session save clears the exercise slot
  and vice versa, so a restore never resurrects the *other* kind's
  stale draft over the one the instructor was actually editing.
- **The exercise restore is initialization, not an `applyLoaded`
  call:** `react-hooks/set-state-in-effect` (eslint-plugin-
  react-hooks 7) forbids the mount-time `applyLoaded` an effect
  would need, so the draft is rebuilt in the `useState` initializer
  and seeds `settings`/`prompts`/`fileExtras`/`preserved`/the dirty
  baseline directly; the lone effect only puts the stored tree on
  the canvas after an `editValidate` precheck. The blocked-storage
  flag is read through `useSyncExternalStore(autosave.subscribe)`
  for the same reason (the `NewickView` render-phase-adjustment
  precedent).
- **EditorPage keeps all three editors mounted after a visit:**
  the Assignment mode follows the same `hidden`-div pattern the
  exercise/reading switch already uses — toggling modes never
  loses in-progress work (that invariant predates autosave; the
  draft is a reload-backup, not the mode-switch mechanism).
- **Files outside the Files block this round:** `assess/url.ts`
  (the `builtinText` export, above), `index.css` (the builder's
  `.builder-*` classes — the Files block names no stylesheet and
  the builder's samples/tasks/prompt rows need real layout),
  `EditorPanel.tsx` + `EditorPanel.test.tsx` (the exercise/matrix
  autosave wiring and the `localStorage.clear()` the pre-autosave
  tests now need for isolation — drafts persisted across tests
  restored over each new render's tree), `reading/ReadingEditor.tsx`
  + `reading/ReadingEditor.test.tsx` (same wiring, same isolation),
  `reading/readingDraft.ts` (the `storedDraft` validator export —
  the builder's reading-draft content path and the editor's own
  restore share it), and `e2e/visualScenes.ts` (the two `builder-*`
  scenes whose baselines the task creates).
- **Full-suite timing:** `App.bootstrap.test.tsx`'s two 60-taxa
  scenes and `EditorPage`'s mode-switch test are marginal against
  vitest's default 5 s timeout under full parallel load (this box
  runs >35 load-average during other sessions); all pass
  standalone and in `--maxWorkers=4` runs. Unrelated to this diff —
  noted so a red CI run isn't misread as this task's regression.
