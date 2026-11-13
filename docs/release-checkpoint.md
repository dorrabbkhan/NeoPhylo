# Release checkpoint and release runbook

Follow this top to bottom for every release. Most checks are scripted in
`scripts/checkpoint/`. What's left for you is the part only a person can
judge, plus the owner-only GitHub steps: merge, tag, release. The
per-version checklist (for this release,
`docs/checkpoints/v1.4b-release.md`) remains the record of what was
verified. This runbook is how you fill it in.

## This release

| Field | Value |
|---|---|
| Milestone | v1.4b: MEGA companion and data library |
| Release tag | `v1.4.1` (annotated, like `v1.4.0`) |
| Previous tag | `v1.4.0` |
| Checkpoint PR | #143 `[OWNER GATE] v1.4b Task 14: release checkpoint, roadmap, CITATION` |
| RC branch | `m1.4b/task-14-release-checkpoint` |
| Checklist | `docs/checkpoints/v1.4b-release.md` |
| Deploy preview | https://pr-143--neophylo.netlify.app |
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
   you will tag. It currently says `2026-11-05`; if you tag today, that's
   `2026-11-13`. Commit it on the RC branch (or say
   `conductor: fix set CITATION date-released to <date>` on #143).
3. **Full CI matrix on the RC.** PR CI skips WebKit, `@perf`, R parity and
   the fuzz build. Dispatch the full matrix on the RC branch:

   ```sh
   gh workflow run ci.yml --ref m1.4b/task-14-release-checkpoint
   ```

   A dispatch from a non-`main` branch deploys nothing, so it costs no
   Netlify credits. Preflight finds the run and checks that its WebKit
   jobs passed.

## Step 2: Run the automated checkpoint (20–30 min, unattended)

```sh
scripts/checkpoint/run.sh --pr 143 --tag v1.4.1 --milestone v1.4b \
  --checklist docs/checkpoints/v1.4b-release.md --boot
```

The output lands in `~/neophylo-checkpoint/v1.4.1-<timestamp>/`:

| File | What it is |
|---|---|
| `report.md` | One page: preflight, browser pass, MEGA-CC, each with ✅ / ⚠️ / ❌ |
| `gallery.html` | Every screenshot grouped by checklist section, plus links to the print PDFs |
| `playwright-report/` | Playwright's HTML report with traces for any failure (`cd web && npx playwright show-report <dir>/playwright-report`) |
| `meg/` | `.meg` files exported from the deploy (handout datasets + a spaces-in-names file) |
| `print/` | A4 PDFs of every lab page and the lab index (printed from a dark-theme session) |
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
scripts/checkpoint/browser.sh https://pr-143--neophylo.netlify.app /tmp/cp --project=webkit --grep "§6"
# MEGA only, on .meg files you exported yourself
python3 -I scripts/checkpoint/mega_verify.py --meg-dir ~/Downloads/megs --boot
# preflight only
scripts/checkpoint/preflight.sh --pr 143 --tag v1.4.1 --milestone v1.4b --checklist docs/checkpoints/v1.4b-release.md
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
   - the dataset sheet's rows readable at 768 px
   - the removed-column marks (∅) and gap counts where §6 says they are
   - the weak `*` marker drawn in §4
   - old links looking like the lesson they name

   The script already measured font size and scrolling; your job is the
   look.
2. **Print PDFs (`print/`).** Open all of them. Each should be:
   - on a light page, even though the session was dark
   - free of buttons and navigation
   - showing the handout and its settings table
   - free of "About N min" on the index
   - not cut off at the page edge
3. **Real Safari, 5 min (macOS or iPad).** WebKit automation isn't Safari's
   own print dialog or download handling. On the deploy preview:
   - print one MEGA handout from Safari's print dialog
   - export `16s-rrna` as `.meg` and check the download opens in MEGA
   - open the dataset sheet on an iPad-width window
4. **Exercise editor round-trip (v4), 5 min (not scripted).**
   1. Open `?editor`.
   2. Set the model to `Poisson` on a protein draft, or set a gap
      treatment.
   3. Save the file and check it says `"schema_version": 4`.
   4. Import that file again, save it again, and diff the two files: they
      should be identical.
   5. A draft without a v4-only field saves as 3.
5. **MEGA GUI.** Already done on 2026-11-05 (§1–§5 findings). Redo it only
   if the engine, the exporter or the fixtures changed since. MEGA-CC
   covers the numbers either way.
6. **Content and license sign-offs (§13).** Handouts #136, #139, #141,
   #142 and labs/"Coming from MEGA?" #134; dataset licenses #124; MEGA
   fixtures #115, #118, #126, #127. These are judgments only you can make.

## Step 4: Record the result (5 min)

1. Post the report on the PR as the checkpoint evidence:
   `gh pr comment 143 --body-file ~/neophylo-checkpoint/v1.4.1-<ts>/report.md`.
2. Tick the checklist boxes and add a `Findings (<date>):` line per
   section. Either edit `docs/checkpoints/v1.4b-release.md` yourself, or
   comment `conductor: fix tick the checkpoint boxes covered by the
   report in <comment link>; leave <list> open`.
3. Anything that needs a fix goes into #143 as one fix round before the
   tag (pre-release fixes stay in the checkpoint PR). Then re-run Step 2
   on the new preview.

## Step 5: Release (owner, 20 min plus CI time)

### 5.1 Merge the checkpoint PR

On #143, once preflight is clean and every box is ticked:

| Field | Value |
|---|---|
| Merge method | **Create a merge commit** (the repo's convention: `Merge pull request #142 …`) |
| Commit message title | leave the default: `Merge pull request #143 from dorrabbkhan/m1.4b/task-14-release-checkpoint` |
| Commit message body | leave the default (the PR title) |
| After merge | **Delete branch** |

### 5.2 Wait for `main` to go green on the full matrix

The push to `main` runs every job, WebKit and `@perf` included, and
deploys the free `main--neophylo.netlify.app` staging alias.

```sh
gh run list --workflow ci.yml --branch main -L 1
gh run watch <run-id> --exit-status
scripts/checkpoint/preflight.sh --pr 143 --tag v1.4.1 --milestone v1.4b
```

After the merge, preflight checks the merge commit's push run, WebKit
jobs included.

### 5.3 Tag, which triggers the production deploy

Tag the merge commit you just checked, not whatever `main` is by then:

```sh
git fetch origin
git switch --detach origin/main
git log -1 --format='%H %s'          # must be "Merge pull request #143 …"
git tag -a v1.4.1 -m "NeoPhylo v1.4.1: MEGA companion and data library"
git push origin v1.4.1
```

- The tag push runs the full CI matrix again. The `deploy` job then
  deploys to production (`environment: production`, whose branch policy
  allows `main` and `v*.*.*` tags; no reviewer approval is configured).
- Watch it with `gh run list --workflow ci.yml --branch v1.4.1 -L 1`,
  then `gh run watch <id> --exit-status`.
- If a job fails, production is not touched. Fix forward on `main` and
  tag `v1.4.2`; never move a pushed tag.

### 5.4 Smoke-test production (5 min)

```sh
scripts/checkpoint/browser.sh https://neophylo.netlify.app ~/neophylo-checkpoint/v1.4.1-prod \
  --project=chromium --grep "§0|§6 16S|§9 correction|at 1280 px, light"
```

Then by hand: hard-reload https://neophylo.netlify.app (the service worker
may serve the old build once). Open one MEGA handout, "Open dataset…", and
the Licenses page.

### 5.5 GitHub release

Go to **Releases → Draft a new release** and fill in:

| Field | Value |
|---|---|
| Choose a tag | `v1.4.1` (existing) |
| Target | greyed out, because the tag already exists |
| Previous tag | `v1.4.0` |
| Release title | `NeoPhylo v1.4.1: MEGA companion labs and data library` |
| Description | the notes below |
| Attach binaries | none (the app is the website; GitHub adds the source archives) |
| Set as a pre-release | **off** |
| Set as the latest release | **on** |
| Create a discussion | off |

Then press **Publish release**, not "Save draft".

Release notes (paste as-is; the style matches `v1.4.0`):

```markdown
## NeoPhylo v1.4.1: MEGA companion labs and data library

NeoPhylo now works as a companion to MEGA: students see each step of a standard MEGA assignment in NeoPhylo, then reproduce it in MEGA and get the same numbers. It also ships a small library of real, openly licensed datasets that open in one click. Existing lessons, results and shared links are unchanged.

### MEGA lab handouts
- Four ready-made labs that follow the standard MEGA assignments: **JC69 vs K2P** (primate mtDNA), **NJ vs UPGMA** (vertebrate globins), **100 bootstrap replicates** (bacterial 16S rRNA) and **interpreting support** (16S rRNA, plus a small weak-support example).
- Each lab lists MEGA's menu path and settings next to the matching NeoPhylo settings, has a "What MEGA shows you vs what NeoPhylo shows you" note, and prints cleanly.
- A **"Coming from MEGA?"** guide next to "Coming from PHYLIP?", both in a new Guides menu.

### Same numbers as MEGA
- Every expected value comes from MEGA-CC 12.1.4 runs that are committed as fixtures, not from NeoPhylo's own output. Distances match MEGA cell for cell at its printed precision, and NJ and UPGMA trees match in topology and branch lengths.
- Bootstrap support matches MEGA within sampling noise (checked against 1,000-replicate MEGA runs).
- **MEGA's gap treatments:** pairwise deletion (the default, unchanged), complete deletion, and partial deletion with a site-coverage cutoff. NeoPhylo shows how many columns were removed, and in protein mode the pair panel marks them.
- **Protein:** p-distance and the new **Poisson** model match MEGA exactly. JTT still follows PHYLIP `protdist`; MEGA's JTT is a different estimator, and the "Coming from MEGA?" guide explains the difference.

### MEGA files
- Import `.meg` sequence files (sequential or interleaved, with or without CRLF/BOM) next to FASTA and PHYLIP. Unsupported commands are skipped with a notice, and errors give the line number.
- Export any alignment as `.meg`. Names with spaces are written with underscores, with a notice. Exported files open in MEGA and give the same distances.
- Distance-matrix `.meg` files are not supported yet; they are planned for v1.4c.

### Data library
- **Open dataset…** in the sandbox: bacterial 16S rRNA, eukaryotic cytochrome c, vertebrate globins, hominoid mitochondrial D-loop, and a SARS-CoV-2 spike RBD set. Each shows its size, alphabet, source, license and provenance, and works offline.
- Share links can name a dataset (`ds=`).

### Sandbox
- The correction menu now offers `F84` and `K2P (dnadist)` for DNA and `Poisson` for protein. Built-in lessons are unchanged.

### Fixes
- Lab pages no longer scroll sideways on phones (≤ 375 px) (#135).

Full release checklist: `docs/checkpoints/v1.4b-release.md`. Decisions and deviations: `docs/decisions.md`.
```

Check the notes against the shipped app before you publish. The claims
are taken from the spec, the roadmap and the checklist, and Step 2 and
Step 3 exercise each one.

### 5.6 Clean up and repository fields

- **Stale draft.** A *draft* release for `v1.3.0` still exists next to the
  published one. Open it, confirm it is the duplicate, and **Delete** it,
  so the drafts list only holds real work.
- **About** (repo home → ⚙ next to About). Suggested values; they are
  public, so change them only if you agree:

  | Field | Suggested value |
  |---|---|
  | Description | `Learn how phylogenetic trees are built, step by step, in your browser: NJ/UPGMA, distance models, bootstrap, and PHYLIP/MEGA companion labs. Rust + WebAssembly.` |
  | Website | `https://neophylo.netlify.app` (already set) |
  | Topics | `phylogenetics` `bioinformatics` `neighbor-joining` `upgma` `bootstrap` `phylip` `mega` `science-education` `webassembly` `rust` `typescript` (currently none) |
  | Releases / Deployments on the home page | on |

- **`CITATION.cff` content (optional, a separate small PR).** The
  abstract and keywords still describe v1.4: no MEGA, no data library.
  Suggested additions:
  - abstract: "…, reproduce standard MEGA and PHYLIP lab assignments with
    the same numbers, and open curated real datasets."
  - keywords: `MEGA`, `bootstrap`.

  GitHub's "Cite this repository" box reads this file.

### 5.7 After the release

- Roadmap: mark v1.4b **released (v1.4.1, <date>)** in the next docs PR.
- Check the `main` nightly and the tag run's `@perf` timings once.
- The Dependabot PRs (#144, #145, #75, #76, and the majors #7 TypeScript 7
  and #4 rand_core 0.10) start the next cycle. None of them belongs in the
  release.

## Rollback

Production is whatever Netlify last published with `--prod`. If the
release is broken:

1. **Fastest:** Netlify → Site → Deploys. Pick the previous production
   deploy (`v1.4.0`'s) and click **Publish deploy**. This takes effect
   instantly and needs no CI.
2. Then fix forward: a fix PR → merge → tag `v1.4.2`. Never delete or move
   `v1.4.1` once pushed. Edit the GitHub release notes to point to
   `v1.4.2`.

## Automation map: v1.4b checklist (`docs/checkpoints/v1.4b-release.md`)

"Auto" means a test in `scripts/checkpoint/browser/release.spec.ts` (all
three engines unless noted) or `mega_verify.py` proves the item.
"Gallery" means the script measures it and you still look. "Manual" means
only you can do it.

| § | Item | How |
|---|---|---|
| 1–3 | MEGA matrices, NJ/UPGMA trees, site counts on exported `.meg` | **Auto**, MEGA-CC (`mega_verify.py`); GUI pass done 2026-11-05 |
| 3–4 | Bootstrap ×1000 splits and support | **Auto** with `--boot` |
| 4 | Weak-support sample opens and draws `*` | **Auto** (`§4`) + gallery |
| 5 | Export each handout dataset as `.meg`; MEGA reads it | **Auto** (Chromium download + MEGA-CC); Safari download is manual (Step 3.3) |
| 5 | Spaces in names → `_` + notice; MEGA prints them literally | **Auto** (notice + file); MEGA's literal print is recorded in `fixtures/worked/mega-notes.md` |
| 6 | "429 of 1,628 … complete", "334 of 1,628 … partial 95%" | **Auto** (`§6 16S`) |
| 6 | Removed columns marked in the pair panel | **Auto on globins** (`§6 globins`). See the note below |
| 6 | Count reaches screen readers | **Auto**: `aria-live="polite"` on the count. A real screen-reader listen is optional |
| 6 | Filter that keeps nothing / pair with no overlap → message, never NaN | **Auto** (`§6 a filter…`) |
| 7 | Five datasets: taxa × sites, alphabet, source, license, provenance link; one-click load | **Auto** (`§7`, 4 widths × 2 themes × 3 engines) |
| 7 | Below 1,024 px full-screen sheet; Esc closes and returns focus | **Auto** (`§7` at 768) |
| 7 | Unsaved work asks first; declining keeps it | **Auto** |
| 7 | No sideways scroll, nothing clipped/overlapping, text ≥ 12 px, no console errors | **Auto** (measured) + **gallery** (look) |
| 7 | Licenses page + `THIRD_PARTY_NOTICES.md` list all five | **Auto** (`§7 Licenses` + preflight) |
| 8 | v1/v2/v3 link corpora restore | **Auto**: every corpus link opens on the deploy without errors or NaN (CI already proves exact values) + gallery |
| 8 | Six lessons + three PHYLIP packs load | **Auto** (`§8`, lab tests) |
| 8 | v4 exercise round-trips through the editor | **Manual** (Step 3.4) |
| 8 | Built-in lessons: no gap control, no new models | **Auto** |
| 9 | Correction menus, κ default/refusal, Poisson → DNA fallback | **Auto** (`§9`); the fallback *message* wording is in the gallery |
| 9 | Cutoff 101 and 2.5 refused | **Auto** (`§6 16S`) |
| 9 | `.meg` import: CRLF+BOM, interleaved, matrix refusal, ignored commands, line numbers | **Auto** (`§9 .meg import`) |
| 9 | Editor offers the new models + site filter; saves v4 only when needed | **Manual** (Step 3.4); the editor's κ field is in CI's `editor.spec.ts` |
| 10 | Print: light, controls hidden, handout + settings table kept, no minutes, nothing clipped | **Auto** (checks) + **PDFs** (look) |
| 11 | WebKit pass | **Auto** (every test above runs on WebKit) + 5 min real Safari (Step 3.3) |
| 13 | Content, license and fixture sign-offs | **Manual (owner)** |
| 13 | `main` full matrix green; tag | Preflight + Step 5 |

**Note on §6 (pair panel):** the pair panel ("How was this distance
computed?") opens only in protein mode (`web/src/views/App.tsx`,
`onPickPairCell` / `pairDetail`). The checklist's "marks the removed
columns in the pair panel" item on **16S rRNA (DNA)** can't be done as
written. The browser pass checks the ∅ marks on **globins** under
complete deletion instead. Either tick the item with that note, or decide
that DNA should get a pair panel (a v1.4c item, not a release blocker).

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
