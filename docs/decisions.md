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
