# Release checkpoint and release runbook

Follow this top to bottom for every release. Most checks are scripted in
`scripts/checkpoint/`. What's left for you is the part only a person can
judge, plus the owner-only GitHub steps: merge, tag, release. The
per-version checklist (for this release,
`docs/checkpoints/v1.4c-release.md`) remains the record of what was
verified. This runbook is how you fill it in.

## This release

| Field | Value |
|---|---|
| Milestone | v1.4c: matrix input, lesson library and worksheets |
| Release tag | `v1.4.2` (proposed; the owner confirms the name) |
| Previous tag | `v1.4.1` |
| Checkpoint PR | the `[OWNER GATE] v1.4c Task 14` PR |
| RC branch | `m1.4c/task-14-release-checkpoint` |
| Checklist | `docs/checkpoints/v1.4c-release.md` |
| Deploy preview | https://pr-<PR>--neophylo.netlify.app |
| Production | https://neophylo.netlify.app (deploys only on a `v*.*.*` tag) |
| MEGA-CC | 12.1.4 (build 12261022-x86_64), the fixture version |

For a later release, copy this table and change the values. The commands
below take them as flags.

## Who does what

- **Scripts / conductor (read-only):** preflight, browser pass, MEGA-CC
  verification, report, gallery. They never push, merge, tag, dispatch or
  publish.
- **Owner only:** merging the checkpoint PR, the tag, the GitHub release,
  deleting stale releases, repository settings, and the content and
  license sign-offs.

## Step 0: One-time setup (5 min)

- [ ] `megacc -v` prints 12.1.4 (it's in `/usr/bin/megacc` on this machine).
- [ ] Docker works without sudo: `docker info`. The browser pass runs in
      the same pinned Playwright image as CI, so no browser install is needed.
- [ ] `(cd web && npm ci)` so that `web/node_modules` exists.
- [ ] `gh auth status` succeeds as you (the scripts only read through `gh`).

## Step 1: Get the release candidate ready (10 min)

1. **Everything for the milestone is merged.** The plan's Task Index is
   all done. Preflight lists any other open `[OWNER GATE]` /
   `[OWNER REVIEW]` PR.
2. **CITATION date.** Set `date-released` in `CITATION.cff` to the day
   you will tag. It is set to `2026-11-14`; if you tag on a later day,
   change it first. Commit it on the RC branch (or say
   `conductor: fix set CITATION date-released to <date>` on the PR).
3. **Full CI matrix on the RC.** PR CI skips WebKit, `@perf`, R parity and
   the fuzz build. Dispatch the full matrix on the RC branch:

   ```sh
   gh workflow run ci.yml --ref m1.4c/task-14-release-checkpoint
   ```

   A dispatch from a non-`main` branch deploys nothing, so it costs no
   Netlify credits. Preflight finds the run and checks that its WebKit
   jobs passed.

## Step 2: Run the automated checkpoint (20–30 min, unattended)

```sh
scripts/checkpoint/run.sh --pr <PR> --tag v1.4.2 --milestone v1.4c \
  --checklist docs/checkpoints/v1.4c-release.md --boot
```

The output lands in `~/neophylo-checkpoint/v1.4.2-<timestamp>/`:

| File | What it is |
|---|---|
| `report.md` | One page: preflight, browser pass, MEGA-CC, each with ✅ / ⚠️ / ❌ |
| `gallery.html` | Every screenshot grouped by checklist section, plus links to the print PDFs |
| `playwright-report/` | Playwright's HTML report with traces for any failure (`cd web && npx playwright show-report <dir>/playwright-report`) |
| `meg/` | `.meg` files exported from the deploy (handout datasets + a spaces-in-names file + the seven matrix oracles) |
| `print/` | A4 PDFs of every lab page, the lab index, the guide, and every paper worksheet and key (printed from a dark-theme session) |
| `shots/` | Raw screenshots, `<name>--<browser>.png` |

What runs:

1. **`preflight.sh`** checks:
   - the tag name is valid and doesn't exist yet
   - PR state, mergeability and CI on its head
   - the full-matrix run on the RC commit, WebKit included
   - the working tree is clean
   - the `CITATION.cff` version and date
   - the roadmap mentions the milestone
   - `THIRD_PARTY_NOTICES.md` lists every library dataset
   - how many checklist boxes are still open
   - no other owner-gate PRs are open and there are no stray draft releases
   - the megacc, docker and node_modules versions
2. **`browser.sh`** runs `scripts/checkpoint/browser/release.spec.ts`
   against the deploy preview on Chromium, Firefox and WebKit. Every page
   it visits gets the same automatic checks:
   - no sideways scroll
   - no visible text under 12 px (SVG text measured at its on-screen size)
   - no tree leaf label clipped by its SVG, and none overlapping another
   - no console errors or uncaught exceptions
   - no `NaN` anywhere
3. **`mega_verify.py`** runs MEGA-CC with the committed `.mao` files on the
   `.meg` files the deploy exported, and compares against
   `fixtures/mega/library/`:
   - the alignment equals the library FASTA
   - every matrix matches cell for cell, and MEGA's `No. of Sites` equals a
     count computed independently from the FASTA
   - every NJ/UPGMA tree has the same clades and branch lengths
   - with `--boot`, the 1,000-replicate bootstraps match within 5 pp
   - negative controls must fail
4. **`report.py`** writes `report.md` and `gallery.html`.

Useful variants:

```sh
# re-run one part on one engine (any Playwright args pass through)
scripts/checkpoint/browser.sh https://pr-<PR>--neophylo.netlify.app /tmp/cp --project=webkit --grep "§1"
# MEGA only, on .meg files you exported yourself
python3 -I scripts/checkpoint/mega_verify.py --meg-dir ~/Downloads/megs --boot
# preflight only
scripts/checkpoint/preflight.sh --pr <PR> --tag v1.4.2 --milestone v1.4c --checklist docs/checkpoints/v1.4c-release.md
```

**Reading failures.** A ❌ in `report.md` blocks the release until it's
explained. For each one:

1. Open its trace in the Playwright report.
2. Decide whether it is a product bug or a checker bug:
   - **Product bug:** it goes back as a fix round on the checkpoint PR,
     or a `fix/` branch.
   - **Checker bug:** a selector or wording drift in
     `scripts/checkpoint/browser/`. Fix the checker in the same PR and
     say so in the PR.
3. Never relax a check to make it pass: no smaller font floor, no
   dropped assertion. Same rule as tolerances.

## Step 3: Owner pass (30–45 min)

This is what remains manual, in order. Tick the matching boxes in the
version checklist as you go (see "Automation map" below).

1. **Visual pass, `gallery.html`.** Go through every section and look for:
   - nothing clipped, cut off or overlapping
   - every leaf visible
   - dark theme legible
   - the library cards readable at 768 px in both themes
   - each paper worksheet's blanks looking like blanks, with no answer
     leaking onto the student sheet
   - the guide reading as written and its minutes looking plausible
   - old links looking like the lesson they name

   The script already measured font size and scrolling; your job is the
   look.
2. **Print PDFs (`print/`).** Open all of them. Each should be:
   - on a light page, even though the session was dark
   - free of buttons and navigation
   - free of "About N min" on the printed handouts and index
   - not cut off at the page edge
   Then print one paper worksheet and its key on real paper and work a
   join by hand.
3. **Real Safari, 5 min (macOS or iPad).** WebKit automation isn't Safari's
   own print dialog or download handling. On the deploy preview:
   - import a matrix by file, by paste and by grid
   - print a paper worksheet from Safari's print dialog
   - export a matrix `.meg` and check the download opens in MEGA
   - open the library on an iPad-width window
4. **Exercise editor round-trip, 5 min (not scripted).**
   1. Open `?editor`, switch a draft to the matrix data tab and give it a
      matrix (file, paste or grid).
   2. Save the file and check it says `"schema_version": 5`.
   3. Import that file again, save it again, and diff the two files: they
      should be identical.
   4. A non-matrix draft without a v4/v5-only field still saves as 3.
5. **MEGA GUI.** The alignment `.meg` pass was done on 2026-11-05; what's
   new this release is the **matrix** `.meg` — open at least one exported
   `matrix_<name>.meg` in the MEGA GUI (it reads as a distance file) and
   run one NJ tree on it. MEGA-CC covers the numbers either way.
6. **Content sign-offs (§17).** The lesson-library, worksheet, editor and
   guide reviews on this milestone's PRs are the record — these are
   judgments only you can make.

## Step 4: Record the result (5 min)

1. Post the report on the PR as the checkpoint evidence:
   `gh pr comment <PR> --body-file ~/neophylo-checkpoint/v1.4.2-<ts>/report.md`.
2. Tick the checklist boxes and add a `Findings (<date>):` line per
   section. Either edit `docs/checkpoints/v1.4c-release.md` yourself, or
   comment `conductor: fix tick the checkpoint boxes covered by the
   report in <comment link>; leave <list> open`.
3. Anything that needs a fix goes into the checkpoint PR as one fix
   round before the tag (pre-release fixes stay in the checkpoint PR).
   Then re-run Step 2 on the new preview.

## Step 5: Release (owner, 20 min plus CI time)

### 5.1 Merge the checkpoint PR

On the checkpoint PR, once preflight is clean and every box is ticked:

| Field | Value |
|---|---|
| Merge method | **Create a merge commit** (the repo's convention: `Merge pull request #160 …`) |
| Commit message title | leave the default: `Merge pull request <PR> from dorrabbkhan/m1.4c/task-14-release-checkpoint` |
| Commit message body | leave the default (the PR title) |
| After merge | **Delete branch** |

### 5.2 Wait for `main` to go green on the full matrix

The push to `main` runs every job, WebKit and `@perf` included, and
deploys the free `main--neophylo.netlify.app` staging alias.

```sh
gh run list --workflow ci.yml --branch main -L 1
gh run watch <run-id> --exit-status
scripts/checkpoint/preflight.sh --pr <PR> --tag v1.4.2 --milestone v1.4c
```

After the merge, preflight checks the merge commit's push run, WebKit
jobs included.

### 5.3 Tag, which triggers the production deploy

Tag the merge commit you just checked, not whatever `main` is by then:

```sh
git fetch origin
git switch --detach origin/main
git log -1 --format='%H %s'          # must be "Merge pull request <PR> …"
git tag -a v1.4.2 -m "NeoPhylo v1.4.2: matrix input, lesson library and worksheets"
git push origin v1.4.2
```

- The tag push runs the full CI matrix again. The `deploy` job then
  deploys to production (`environment: production`, whose branch policy
  allows `main` and `v*.*.*` tags; no reviewer approval is configured).
- Watch it with `gh run list --workflow ci.yml --branch v1.4.2 -L 1`,
  then `gh run watch <id> --exit-status`.
- If a job fails, production is not touched. Fix forward on `main` and
  tag `v1.4.3`; never move a pushed tag.

### 5.4 Smoke-test production (5 min)

```sh
scripts/checkpoint/browser.sh https://neophylo.netlify.app ~/neophylo-checkpoint/v1.4.2-prod \
  --project=chromium --grep "§0|§1|§4|§5|§11 16S"
```

Then by hand: hard-reload https://neophylo.netlify.app (the service worker
may serve the old build once). Open `?library`, a paper worksheet, and a
matrix import.

### 5.5 GitHub release

Go to **Releases → Draft a new release** and fill in:

| Field | Value |
|---|---|
| Choose a tag | `v1.4.2` (existing) |
| Target | greyed out, because the tag already exists |
| Previous tag | `v1.4.1` |
| Release title | `NeoPhylo v1.4.2: Distance matrices, lesson library and worksheets` |
| Description | the notes below |
| Attach binaries | none (the app is the website; GitHub adds the source archives) |
| Set as a pre-release | **off** |
| Set as the latest release | **on** |
| Create a discussion | off |

Then press **Publish release**, not "Save draft".

Release notes (paste as-is; the style matches `v1.4.0`):

```markdown
## NeoPhylo v1.4.2: Distance matrices, lesson library and worksheets

NeoPhylo now starts from a distance matrix — a file, pasted text, or a typed grid — so any lesson or lab can become a printed worksheet with an engine-computed answer key. A new library page lists every lesson, lab and dataset, and an instructor guide ties it together. Existing lessons, results and shared links are unchanged.

### Distance matrices
- Open a `.meg` or PHYLIP distance file, paste a matrix, or type one into the grid — three to two hundred taxa. Ambiguous pastes are asked about, never guessed.
- A matrix session builds the NJ or UPGMA tree directly: the badge reads "Distance matrix", alignment-only panels hide behind a one-line explanation, and the stepper still shows every join.
- Export the supplied matrix as PHYLIP or `.meg` (opens in MEGA), or as an R script.
- Share links carry the matrix (`d=`); a too-long link says so and offers the file instead.

### Lesson library and worksheets
- **Library** (`?library`): every lesson, lab and dataset on one page with level, minutes, objectives and prepares-for/follows lines; `?labs` opens the lab view directly.
- Every exercise gets an **in-app worksheet** and a gated **answer key** the engine computes; eight small exercises also get a **paper worksheet** — the printed matrix and blank join tables — with a worked key.
- The answer-key gate asks once per session. It is a signal, not a lock — the guide says so plainly.
- The **exercise editor** builds matrix exercises too (schema 5), and the **instructor guide** (`?guide`) collects the routes, the teaching notes and ready-made plans.

### Unchanged
- All v1/v2/v3 share links, including the new matrix links, open as before; every committed lesson and lab is byte-for-byte the same exercise.

Full release checklist: `docs/checkpoints/v1.4c-release.md`. Decisions and deviations: `docs/decisions.md`.
```

Check the notes against the shipped app before you publish. The claims
are taken from the spec, the roadmap and the checklist, and Step 2 and
Step 3 exercise each one.

### 5.6 Clean up and repository fields

- **Stale drafts.** Check **Releases** for any leftover draft releases;
  delete confirmed duplicates so the drafts list only holds real work.
- **About** (repo home → ⚙ next to About). Suggested values; they are
  public, so change them only if you agree:

  | Field | Suggested value |
  |---|---|
  | Description | `Learn how phylogenetic trees are built, step by step, in your browser: NJ/UPGMA, distance models, distance matrices, bootstrap, and PHYLIP/MEGA companion labs. Rust + WebAssembly.` |
  | Website | `https://neophylo.netlify.app` (already set) |
  | Topics | `phylogenetics` `bioinformatics` `neighbor-joining` `upgma` `bootstrap` `phylip` `mega` `science-education` `webassembly` `rust` `typescript` |
  | Releases / Deployments on the home page | on |

- **`CITATION.cff` content (optional, a separate small PR).** The
  abstract and keywords still describe v1.4: no MEGA, no data library,
  no matrix input. Suggested additions:
  - abstract: "…, reproduce standard MEGA and PHYLIP lab assignments with
    the same numbers, open curated real datasets, and start from a
    distance matrix."
  - keywords: `MEGA`, `bootstrap`, `distance matrix`.

  GitHub's "Cite this repository" box reads this file.

### 5.7 After the release

- Roadmap: mark v1.4c **released (v1.4.2, <date>)** in the next docs PR.
- Check the `main` nightly and the tag run's `@perf` timings once.
- The open follow-ups start the v1.5 cycle: the serde `null` gap on old
  optional keys (§16). The MEGA Adaptive Bootstrap sentence is resolved —
  the owner confirmed in the MEGA 12 GUI on 2026-11-17 that NJ's Test of
  Phylogeny has no Adaptive option, so the handout stays unchanged (§16).

## Rollback

Production is whatever Netlify last published with `--prod`. If the
release is broken:

1. **Fastest:** Netlify → Site → Deploys. Pick the previous production
   deploy (`v1.4.1`'s) and click **Publish deploy**. This takes effect
   instantly and needs no CI.
2. Then fix forward: a fix PR → merge → tag `v1.4.3`. Never delete or move
   `v1.4.2` once pushed. Edit the GitHub release notes to point to
   `v1.4.3`.

## Automation map: v1.4c checklist (`docs/checkpoints/v1.4c-release.md`)

"Auto" means a test in `scripts/checkpoint/browser/release.spec.ts` —
run on all three engines except the Chromium-only parts noted below
(the §6 and §12 `.meg` downloads, the §2/§14 worksheet/key PDFs and
the Chromium-only screenshots) — or `mega_verify.py` proves the item.
"Gallery" means the script measures it and you still look. "Manual" means
only you can do it.

| § | Item | How |
|---|---|---|
| 1 | Every oracle matrix as file (`.phy` + `.meg`), paste and grid → one Newick | **Auto** (`§1`, all three engines); engine parity in `parity_matrix.rs` |
| 1 | A matrix typed from a printed textbook page | **Manual (owner)** — the grid route itself is automated |
| 2 | Every worksheet/key renders, paper + app, fallbacks named | **Auto** (`§2`) |
| 2 | One sheet/key checked by hand against the app | **Manual (owner)** |
| 2 | Paper sheet carries no answers; prints light | **Auto** (checks) + **PDFs** (look) |
| 3 | Gate once per session; storage-blocked asks every time; plain caveat | **Auto** (`§3`); the guide read is owner (§5) |
| 4 | Library card counts, actions, every width × theme | **Auto** (`§4`) + **gallery** |
| 4 | `?labs` filtered; filter → `?library&type=…` | **Auto** (`§4`) |
| 5 | Guide renders; every link resolves; prints light | **Auto** (`§5`); content read is owner |
| 6 | Matrix `.meg` opens in MEGA | **Auto**, MEGA-CC (`mega_verify.py`); the GUI open is **owner** (Step 3.5) |
| 7 | Matrix session: badge, hidden panels, exports, non-additive note, leaving | **Auto** (`§7`) |
| 7 | Carried controls: correction menu, κ, gap refusals, `.meg` import | **Auto** (`§7`, `§11`) |
| 8 | v1/v2/v3/v3-matrix link corpora restore | **Auto** (`§8`) + gallery |
| 8 | Lessons load with no gap control / sandbox models | **Auto** (`§8`) |
| 9 | Editor matrix route; saves schema 5 / 4 as appropriate | **Manual (owner)** (Step 3.4); the editor's own spec is in CI's `editor.spec.ts` |
| 10 | Datasets at every width × theme; Licenses list | **Auto** (`§10`, carried) |
| 11 | Gap-treatment counts, marks, live region, never-NaN | **Auto** (`§11`, carried) |
| 12 | Alignment `.meg` → MEGA-CC parity | **Auto** (`§12` + `mega_verify.py`, carried) |
| 13 | Weak-support sample draws `*` | **Auto** (`§13`, carried) + owner look |
| 14 | Print: light, controls hidden, no minutes on handouts | **Auto** + **PDFs**; one real paper print is **owner** |
| 15 | WebKit pass | **Auto** (every § test runs on WebKit except the Chromium-only parts above) + 5 min real Safari (Step 3.3) |
| 15 | Stale-link window (`d=` written after paint) | **Fixed** — the URL sync is a `useLayoutEffect`, pinned by `App.urlSync.test.tsx`; see the note in the checklist |
| 16 | `bootstrap: null` serde gap | **Known issue, not fixed** — v1.5 owner decision |
| 16 | MEGA Adaptive Bootstrap sentence | **Resolved** — owner confirmed in the MEGA 12 GUI on 2026-11-17 that NJ has no Adaptive option; handout unchanged |
| 17 | Hand key-check, GUI open, printed matrix, sign-offs, tag | **Manual (owner)** |

**Note on §11 (pair panel):** the pair panel opens only in protein mode.
The checklist's "marks the removed columns" item on **16S rRNA (DNA)**
can't be done as written; the browser pass checks the ∅ marks on
**globins** instead (same ruling as v1.4b — a DNA pair panel is a v1.5
item, not a release blocker).

## First run on the v1.4.1 RC (2026-11-13, PR #143 preview, head `e19bd36`)

The browser pass was run without `--boot`.

- **Browser pass:** 88 passed, 3 failed, 8 skipped (Chromium-only
  downloads and PDFs). MEGA-CC: **87/87** on the `.meg` files exported
  from the preview (matrices, site counts 1,628 / 1,199 / 1,294, every
  NJ/UPGMA tree, negative controls).
- **Lab index printed dark from a dark session — fixed** (all three
  engines; `print/labs-index.pdf`). The lab pages printed light, but
  `?labs` kept the dark theme on paper — `LabIndex` rendered
  `.lab-print` without `LabPrintStyles`. Fixed in this fix round
  (`fix(labs): the lab index prints in light colors like the lab
  pages`) and pinned by the new `web/e2e/labs.spec.ts` test "a
  dark-theme session still prints the lab pages light" (luminance
  assertions on `?labs` and `?lab=mega-jc69-vs-k2p`). Checklist §10
  requires "light colors whatever the screen theme" for the lab index
  too.
- ❌→✅ Dark paper below/around printed handouts (owner, 2026-11-14):
  the handout block printed light but `<html>` kept the dark
  background; fixed in the 2026-11-14 fix round, pinned by the e2e
  test and by the checker's new paper check.
- **§6 wording:** the pair-panel item can't be done on 16S, because the
  pair panel is protein-only (see the note above). It is checked on
  globins instead.
- **§7 focus below 1,024 px:** "Open dataset…" closes the Settings drawer,
  so after Esc focus goes to the header's Settings toggle, not to the
  (gone) button. The checker accepts the toggle and rejects `<body>`.
  Decide whether that meets "returns focus".
- **Network:** the first owner run failed 26 tests with
  `NS_ERROR_NET_TIMEOUT`, `ERR_CONNECTION_TIMED_OUT`, `ENETUNREACH` and
  `SSL_ERROR_UNKNOWN`. Cause: Docker's bridge network has no IPv6 route,
  and Netlify resolves to IPv6 first here. `browser.sh` now uses
  `--network host`. The checker retries a test once and lists retried
  tests as flaky.
- **Screenshots** show the viewport: the app scrolls inside its panels,
  so long trees continue below the frame. The clipping and overlap checks
  still measure every leaf label.

## Maintaining the checker

- Keep `scripts/checkpoint/browser/release.spec.ts` in step with the
  version checklist: one `test` per checklist item a machine can judge,
  named with its `§`.
- It reads datasets, labs, lessons and link corpora from the repo, so
  new ones are picked up automatically.
- It is never run in CI. CI's own e2e suite (`web/e2e/`) remains the gate;
  this checker is the release-time pass against the real deploy.
- MEGA-CC stays local-only (closed source), like
  `fixtures/generate_mega.sh`.
