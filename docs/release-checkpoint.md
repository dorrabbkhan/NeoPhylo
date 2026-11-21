# Release checkpoint and release runbook

Follow this top to bottom for every release. Most checks are scripted in
`scripts/checkpoint/`. What's left for you is the part only a person can
judge, plus the owner-only GitHub steps: merge, tag, release. The
per-version checklist (for this release,
`docs/checkpoints/v1.4d-release.md`) remains the record of what was
verified. This runbook is how you fill it in.

## This release

| Field | Value |
|---|---|
| Milestone | v1.4d: tree reading |
| Release tag | `v1.4.3` (proposed; the owner confirms the name) |
| Previous tag | `v1.4.2` |
| Checkpoint PR | the `[OWNER GATE] v1.4d Task 15` PR |
| RC branch | `m1.4d/task-15-release-checkpoint` |
| Checklist | `docs/checkpoints/v1.4d-release.md` |
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
   you will tag. It is set to `2026-11-18`; if you tag on a later day,
   change it first. Commit it on the RC branch (or say
   `conductor: fix set CITATION date-released to <date>` on the PR).
3. **Full CI matrix on the RC.** PR CI skips WebKit, `@perf`, R parity and
   the fuzz build. Dispatch the full matrix on the RC branch:

   ```sh
   gh workflow run ci.yml --ref m1.4d/task-15-release-checkpoint
   ```

   A dispatch from a non-`main` branch deploys nothing, so it costs no
   Netlify credits. Preflight finds the run and checks that its WebKit
   jobs passed.

## Step 2: Run the automated checkpoint (20–30 min, unattended)

```sh
scripts/checkpoint/run.sh --pr <PR> --tag v1.4.3 --milestone v1.4d \
  --checklist docs/checkpoints/v1.4d-release.md --boot
```

The output lands in `~/neophylo-checkpoint/v1.4.3-<timestamp>/`:

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
scripts/checkpoint/preflight.sh --pr <PR> --tag v1.4.3 --milestone v1.4d --checklist docs/checkpoints/v1.4d-release.md
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
   join by hand — plus one reading sheet and its key checked against
   the app's `?read=` results.
3. **Real Safari, 5 min (macOS or iPad).** WebKit automation isn't Safari's
   own print dialog or download handling. On the deploy preview:
   - tap one reading set through on a real touchscreen (iPad or iPhone)
   - import a matrix by file, by paste and by grid
   - print a paper worksheet and a reading sheet from Safari's print dialog
   - open the library on an iPad-width window, `?library&type=reading`
4. **Exercise editor round-trip, 5 min (not scripted).**
   1. Open `?editor` → **Tree reading set**, build a small set (a stored
      tree, an item or two — marks by tapping the preview), Share it,
      and reopen the `#r=` link (§19). Save the file too.
   2. Still in the editor: switch a draft to the matrix data tab and
      give it a matrix (file, paste or grid).
   3. Save the file and check it says `"schema_version": 5`.
   4. Import that file again, save it again, and diff the two files: they
      should be identical.
   5. A non-matrix draft without a v4/v5-only field still saves as 3.
5. **NVDA, keyboard and real devices (§17).** One reading set under
   NVDA on the Windows VM (the item text, "Show as text" figure
   description and the verdict live region), one set keyboard-only,
   and one on a real phone.
6. **MEGA GUI.** Unchanged from v1.4c — open at least one exported
   `matrix_<name>.meg` in the MEGA GUI (it reads as a distance file)
   and run one NJ tree on it. MEGA-CC covers the numbers either way.
7. **Content sign-offs (§23).** The lesson, editor, worksheet,
   coverage-manifest and guide reviews on this milestone's PRs are the
   record — plus the §21 triage dispositions — these are judgments only
   you can make.

## Step 4: Record the result (5 min)

1. Post the report on the PR as the checkpoint evidence:
   `gh pr comment <PR> --body-file ~/neophylo-checkpoint/v1.4.3-<ts>/report.md`.
2. Tick the checklist boxes and add a `Findings (<date>):` line per
   section. Either edit `docs/checkpoints/v1.4d-release.md` yourself, or
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
| Commit message title | leave the default: `Merge pull request <PR> from dorrabbkhan/m1.4d/task-15-release-checkpoint` |
| Commit message body | leave the default (the PR title) |
| After merge | **Delete branch** |

### 5.2 Wait for `main` to go green on the full matrix

The push to `main` runs every job, WebKit and `@perf` included, and
deploys the free `main--neophylo.netlify.app` staging alias.

```sh
gh run list --workflow ci.yml --branch main -L 1
gh run watch <run-id> --exit-status
scripts/checkpoint/preflight.sh --pr <PR> --tag v1.4.3 --milestone v1.4d
```

After the merge, preflight checks the merge commit's push run, WebKit
jobs included.

### 5.3 Tag, which triggers the production deploy

Tag the merge commit you just checked, not whatever `main` is by then:

```sh
git fetch origin
git switch --detach origin/main
git log -1 --format='%H %s'          # must be "Merge pull request <PR> …"
git tag -a v1.4.3 -m "NeoPhylo v1.4.3: tree reading"
git push origin v1.4.3
```

- The tag push runs the full CI matrix again. The `deploy` job then
  deploys to production (`environment: production`, whose branch policy
  allows `main` and `v*.*.*` tags; no reviewer approval is configured).
- Watch it with `gh run list --workflow ci.yml --branch v1.4.3 -L 1`,
  then `gh run watch <id> --exit-status`.
- If a job fails, production is not touched. Fix forward on `main` and
  tag `v1.4.4`; never move a pushed tag.

### 5.4 Smoke-test production (5 min)

```sh
scripts/checkpoint/browser.sh https://neophylo.netlify.app ~/neophylo-checkpoint/v1.4.3-prod \
  --project=chromium --grep "§0|§1|§4|§5|§11 16S|§16"
```

Then by hand: hard-reload https://neophylo.netlify.app (the service worker
may serve the old build once). Open `?library`, `?read=trees-reading-a-tree`, a paper worksheet, and a
matrix import.

### 5.5 GitHub release

Go to **Releases → Draft a new release** and fill in:

| Field | Value |
|---|---|
| Choose a tag | `v1.4.3` (existing) |
| Target | greyed out, because the tag already exists |
| Previous tag | `v1.4.2` |
| Release title | `NeoPhylo v1.4.3: Tree reading` |
| Description | the notes below |
| Attach binaries | none (the app is the website; GitHub adds the source archives) |
| Set as a pre-release | **off** |
| Set as the latest release | **on** |
| Create a discussion | off |

Then press **Publish release**, not "Save draft".

Release notes (paste as-is; the style matches `v1.4.0`):

```markdown
## NeoPhylo v1.4.3: Tree reading

NeoPhylo now teaches reading trees before building them — clades, most recent common ancestors, relatedness, rotation invariance and trait gains/losses — on the same tree drawings, with engine-checked answers. Instructors get ready-made sets, parallel test forms, an editor mode for their own sets, share links, printable worksheets and answer keys, and a coverage manifest against the published tree-thinking instruments. Existing lessons, results and shared links are unchanged.

### Tree reading sets
- **Reading sets** (`?read=`): six authored sets — four lessons (reading a tree, rotation, closest relatives, clades and shared traits) plus parallel test forms A and B — in practice and test modes, each item answered on the drawing itself.
- Every item type is engine-checked: multiple choice, select-all, true statements, "tap a tip / mark the tips", and trait readouts — with the accepted answer, a wrong-answer explanation and an optional `note_after` all computed by the engine.
- Twelve drawing styles (rectangular, diagonal and circular trees, tip-side right/up/left/down) so students see the same tree drawn differently — the "rotating branches doesn't change relationships" misconception is exercised, not just stated.

### Instructor kit for reading
- The **editor** builds reading sets: stored or per-item trees, marks and labels placed by tapping the preview, {set} tips picked the same way — then Share produces a `#r=` link carrying the whole set.
- **Paper worksheets and answer keys** for every set (`?worksheet=<id>&kind=paper`, `?key=<id>&kind=paper`): the student sheet carries no key text; the key prints the engine's answers and explanations behind the instructor gate.
- The **coverage manifest** (`exercises/reading/coverage/`) maps every published instrument format the sets mirror (Baum et al. quizzes, Kummer et al.'s ETCI) and lists what's deferred; the instructor guide's tree-reading section explains it.

### Unchanged
- All v1/v2/v3/matrix share links and every lesson, lab, worksheet and dataset open as before; every committed exercise is byte-for-byte the same.

Full release checklist: `docs/checkpoints/v1.4d-release.md`. Decisions and deviations: `docs/decisions.md`.
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
  no matrix input, no tree reading. Suggested additions:
  - abstract: "…, reproduce standard MEGA and PHYLIP lab assignments with
    the same numbers, open curated real datasets, start from a distance
    matrix, and practise reading trees."
  - keywords: `MEGA`, `bootstrap`, `distance matrix`, `tree thinking`.

  GitHub's "Cite this repository" box reads this file.

### 5.7 After the release

- Roadmap: mark v1.4d **released (v1.4.3, <date>)** in the next docs PR.
- Check the `main` nightly and the tag run's `@perf` timings once.
- The open follow-ups start the v1.5 cycle: the serde `null` gap on old
  optional keys, the boot1000 binomial bound, lab print fit, the `write_meg`
  blank line (§22), and whatever §21's triage dispositions decided.

## Rollback

Production is whatever Netlify last published with `--prod`. If the
release is broken:

1. **Fastest:** Netlify → Site → Deploys. Pick the previous production
   deploy (`v1.4.2`'s) and click **Publish deploy**. This takes effect
   instantly and needs no CI.
2. Then fix forward: a fix PR → merge → tag `v1.4.4`. Never delete or move
   `v1.4.3` once pushed. Edit the GitHub release notes to point to
   `v1.4.4`.

## Automation map: v1.4d checklist (`docs/checkpoints/v1.4d-release.md`)

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
| 16 | Every `?read=` set opens and walks to results; coverage sets open | **Auto** (`§16`, all three engines) |
| 16 | `#r=` link round-trips a set + custom worksheet; bad ids/links refuse | **Auto** (`§16`, `§19`); one second-browser open is **owner** |
| 17 | Phone and tablet taps (coarse pointer, ≥40px pads, to results) | **Auto** (`§17`) + **gallery**; real hardware is **owner** |
| 17 | Laptop mouse-only; keyboard-only through every set | **Auto** (`§16` walk; `§17` keyboard) |
| 17 | NVDA screen reader | **Manual (owner)** — Step 3.5 |
| 18 | All twelve drawing styles, both themes | **Auto** (`§18`) + **gallery** |
| 19 | Editor reading mode builds, shares, reopens via `#r=` | **Auto** (`§19`); a real multi-item set is **owner** (Step 3.4) |
| 20 | Guide known-gaps == manifest gaps | **Auto** (`§20`); manifest vs the two instruments is **owner** |
| 21 | Triage dispositions | **Manual (owner)** |
| 22 | `bootstrap: null` serde gap; boot1000 bound; lab print fit; `write_meg` blank line | **Known issues, not fixed** — the record in §22 |
| 23 | Hand key-checks, GUI open, devices/NVDA, manifest read, triage, tag | **Manual (owner)** |

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
