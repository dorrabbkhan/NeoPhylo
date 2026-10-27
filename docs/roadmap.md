# NeoPhylo roadmap

**Status:** v1.0, v1.1 (protein support, PHYLIP I/O), **v1.2 (bootstrap, consensus, reference
rooting)**, **v1.3 (design system and polish)** and **v1.4 (instructor kit and PHYLIP lab packs)**
released or releasing; **next: v1.4b** (MEGA companion and data library). Last revised 2026-10-27.

**Positioning, two modes:**
- **PHYLIP labs: a standalone replacement.** NeoPhylo runs the classic PHYLIP teaching workflows
  (`dnadist`/`protdist` → `neighbor`, `seqboot` → `consense`, later `dnapars`/`protpars`) end to end,
  reproduces PHYLIP's numbers with its default settings, reads and writes PHYLIP formats, and explains
  every step.
- **MEGA and IQ-TREE labs: a companion.** Students *understand* a method in NeoPhylo, then *do* it in
  the research tool, with matching numbers and handouts that bridge the two.

Each version is one spec → plan → agent cycle. Size, for part-time agent-driven work: **S** ≈ 2–3 weeks,
**M** ≈ 4–6 weeks, **L** ≈ 2–3 months. Every version ships with at least one lesson and the same
validation discipline: an independent oracle, property tests and fuzzing.

| Milestone | After | Meaning |
|---|---|---|
| 🟡 Early-adopter pilots | **v1.5** | An instructor can run a full lab, author exercises, and get basic grading support |
| 🟢 **POWERHOUSE** | **v2.0** | A complete intro-course companion, interpretation through parsimony; instructors seek it out |
| 💰 Paid tier | **v3.0** | Only after 3 departments sign letters of intent |

---

## Phase 1: Complete the common lab and make it adoptable (v1.2–v1.5)

### v1.2 Bootstrap, consensus and reference rooting (L) · *done*
- Bootstrap with visible resampling, support on the original tree, strict/majority/extended consensus,
  background worker with progress and cancel, "Watch one replicate", NJ trees drawn rooted like the
  reference, `bootstrap-basics` lesson with sequenced notes.
- Validated: `consense` exact, `prop.clades` exact, `boot.phylo` within sampling noise.
- Exports: Newick with support (Compatible/Exact names), consensus Newick, SVG/PNG from the screen layout,
  R scripts mirroring the bootstrap.
- Lessons learned for later versions: check exported figures against the screen; test on fonts other than
  CI's; never let panels squeeze trees; keep the reviewer's comparison on the computed tree.

### v1.3 Design system and polish (M–L)
- **Design system:** tokens, type scale, spacing, component library, consistent light and dark themes,
  presenter font sizes.
- **Bundled font:** one OFL-licensed font for all tree text, on screen and **embedded in exported SVGs**,
  so label placement is identical on every machine and in every viewer; re-layout on
  `document.fonts.ready`; listed in THIRD_PARTY_NOTICES and the Licenses page. Resolves the v1.2 known
  limitation about SVG fonts.
- **Responsive layout:** narrow windows and tablets reflow instead of clipping (a v1.1/v1.2 known
  limitation); trees always keep their natural height.
- **State refactor:** split `web/src/state/session.ts` (~1,000 lines) into focused modules (lesson,
  analysis, bootstrap, URL) before more state arrives; no behavior change, guarded by the existing tests and
  the old-link corpora.
- **Lesson UX:** saturation fixes show progress feedback ("Still saturated at length 100: 2 pairs remain");
  first-run onboarding; empty and loading states.
- **Performance:** lazy-load KaTeX; bundle-size pass.
- **Visual QA built in:** a standard screenshot set (cytochrome-c rooted/computed, weak-support data,
  4-taxon tree, replicate panel, bootstrap-basics final step, narrow width) generated in CI and attached
  to every UI PR.

### v1.4 Instructor kit and PHYLIP lab packs (L)
- **Exercise editor in the UI:** draw or paste a true tree, set the model, seed and length, add prompts,
  preview, share a link. No JSON editing.
- **PHYLIP parity models:** F84 (`dnadist`'s default) and PHYLIP's Kimura 2-parameter variant
  (user-set transition/transversion ratio, default 2.0, as `dnadist` computes it; see v1 spec §8.1),
  validated against `dnadist` to its printed precision, as JTT was against `protdist`. The existing K80
  (closed-form, as in ape and MEGA) stays.
- **PHYLIP lab packs (standalone replacement):** ready-made labs replacing the classic PHYLIP sequences
  (`dnadist` → `neighbor`, `protdist` → `neighbor`, `seqboot` → `dnadist` → `neighbor` → `consense`),
  each with a handout, the settings that match PHYLIP's defaults, and a "what PHYLIP's outfile showed
  you vs what NeoPhylo shows you" note.

### v1.4b MEGA companion and data library · *new — gets its own spec*
- **MEGA companion:**
  - 3–4 ready-made lab handouts mirroring the standard MEGA assignments (JC69 vs K2P, NJ vs UPGMA,
    100 bootstrap replicates, interpreting support): understand each step in NeoPhylo, then reproduce
    it in MEGA.
  - A "Coming from MEGA?" guide next to "Coming from PHYLIP?".
  - **MEGA file import** (`.meg`).
  - **MEGA as a validation oracle:** fixtures generated with MEGA's command-line version (MEGA-CC),
    so instructors can be told "same numbers as MEGA."
- **Curated data library:** one-click datasets with provenance and licensing (globins, cytochrome c,
  primate mtDNA, 16S rRNA, a small SARS-CoV-2 set); fetch by UniProt/NCBI accession.
- Sandbox correction menu offers `F84` and `K2P_PHYLIP` (v1.4 shows them only in the editor and in
  exercises that prescribe them); built-in lessons stay unchanged.
- Lesson library page with learning objectives; printable worksheets with instructor answer keys;
  an instructor guide (50-minute and 3-hour lab plans).

### v1.5 Classroom delivery and basic assessment (M) · 🟡 EARLY-ADOPTER PILOT POINT
- Embed mode (iframe-friendly) for LMS pages; presenter mode; an offline "lab pack" download.
- **Basic assessment, no accounts:**
  - randomized per-student variants from one assignment link (each student a different seed)
  - auto-checked tasks (predict the pair, compute a Q-value, identify the weakest-supported group)
  - signed completion codes students paste into the LMS, verifiable by the instructor offline
- Per-lesson "copy assignment text" for the LMS.

> **🟡 After v1.5:** an instructor can replace a full distance-plus-bootstrap lab, author their own
> exercises, give each student their own variant, and verify completion. Serious outreach should already
> be running by now (it starts during v1.2).

---

## Phase 2: Reach the whole intro course (v1.6–v2.0)

### v1.6 Tree interpretation (M) · *new*
- Reading trees before building them, addressing documented "tree thinking" misconceptions:
  - rotating branches doesn't change relationships
  - the order of tips doesn't mean "more evolved"
  - common ancestors, clades and monophyly
  - relatedness is read from shared ancestry, not tip proximity
- Interactive exercises on the existing tree drawings: rotate nodes, identify the most recent common
  ancestor, mark a group, decide whether two trees show the same relationships.
- Pre/post questions an instructor can use to measure learning (NeoPhylo's own items).
- Opens **intro biology**, the largest market. Research suggests introducing trees through interpretation
  works better than starting with building.

### v1.7 Model breadth (M)
- DNA: Tamura-Nei, LogDet (F84 and PHYLIP-style Kimura already arrive in v1.4). Protein: PAM (DCMut)
  and PMB, completing `protdist`'s model menu. Pure data on the `model` module.
- Gamma rate variation for distances.
- A "model explorer" view (rate heatmap, P(t) evolving).
- Lesson: "Why rate variation matters."

### v1.8 More tree methods, tree handling, "check your implementation" (M)
- Fitch-Margoliash least squares, minimum evolution / BIONJ, with step views.
- Rerooting by a user-chosen outgroup and midpoint; collapse, rotate, ladderize (support stays on the
  right branches).
- Unrooted (radial) drawing.
- **Check your implementation:** export the step-by-step trace (JSON/CSV); a student uploads their own
  NJ or bootstrap output and NeoPhylo shows the first step where it diverges. For algorithm courses that
  have students implement NJ.

### v1.9 Alignment step-through (L) · "raw sequences → tree" complete
- Pairwise alignment (Needleman–Wunsch / Smith–Waterman) as an animated dynamic-programming grid, with
  BLOSUM/PAM scoring and gap penalties as controls.
- Simple progressive multiple alignment (≤ 20 sequences) guided by an NJ tree.
- Pasting unaligned sequences offers "Align them" instead of an error.
- Lesson: "Alignment is a hypothesis." Oracle: published DP examples, Biostrings/Clustal/MEGA outputs.

### v2.0 Parsimony and course pack (L) · 🟢 POWERHOUSE
- Fitch parsimony step by step, site by site; tree length; comparing trees by parsimony score;
  exhaustive search for ≤ 7 taxa; informative vs uninformative sites. Oracle: PHYLIP
  `dnapars`/`protpars`, `phangorn::parsimony`, MEGA.
- **Course pack:** a 10-lab syllabus (interpreting trees → alignment → distances → NJ → bootstrap →
  models → rooting → parsimony …), each lab with objectives, worksheet, instructor notes and its MEGA
  follow-up, mapped to standard textbooks.

> **🟢 POWERHOUSE: after v2.0.** NeoPhylo covers an intro phylogenetics or biochem-evolution course
> from reading trees to parsimony. As a **standalone PHYLIP replacement** it runs about 90% of typical
> PHYLIP teaching use (distances with PHYLIP's defaults, `neighbor`, `seqboot`/`consense`, `fitch`/`kitsch`,
> `dnapars`/`protpars`, `retree`/`drawtree`). As a **MEGA companion** it's compatible (import, matching numbers, companion handouts),
> with assessment support, an editor, embed and presenter modes, a data library and a course pack. Every
> step is visible and validated, and there's nothing to install. Target by then: 10+ courses using it, a
> published CourseSource/QUBES lesson with classroom data, and a JOSS or *BAMBED* paper.

---

## Phase 3: Advanced teaching nobody else offers (v2.1–v2.7)

### v2.1 Likelihood I: Felsenstein pruning (L)
Per-site partial likelihoods flowing up a 4–6-taxon tree (DNA and protein, on the `model` module);
comparing topologies by likelihood. Oracle: `phangorn::pml`, PHYLIP `dnaml`, MEGA.

### v2.2 Likelihood II: optimization and model choice (M)
The branch-length likelihood surface; likelihood-ratio tests and AIC; gamma in likelihood.

### v2.3 Tree search landscapes (M)
NNI and SPR moves animated and scored; local optima; long-branch attraction (parsimony fooled,
likelihood not).

### v2.4 Bayesian intro (M)
MCMC on a tiny tree (proposals, trace plot, posterior over topologies); posterior vs bootstrap support.

### v2.5 Assessment II (M)
More auto-checked task types across all modules (alignment scores, parsimony length, likelihood
comparisons); question banks per lesson; exportable results for instructors (still no accounts).

### v2.6 Rooting, clocks and dating (M)
Ultrametric vs additive trees; clock tests; simple calibration-based dating.

### v2.7 Character evolution and coalescent (L)
Ancestral state reconstruction painted on the tree; gene trees inside species trees; incomplete
lineage sorting.

---

## Phase 4: Institutional tier and reach (v3.0–v3.3)

### v3.0 Institutional tier (L) · 💰 ONLY AFTER 3 LETTERS OF INTENT
Accounts and SSO; LTI 1.3 with grade passback (building on v1.5/v2.5 assessment); class dashboards;
private department lesson libraries; compliance pack (DPA, accessibility report, security
questionnaire). The free student tool stays free and AGPL.

### v3.1 Instructor analytics (M)
Misconception maps from prompt answers; lesson effectiveness across sections and terms.

### v3.2 Localization and accessibility certification (M)
Spanish, Portuguese, French, German and Chinese; an independent WCAG 2.2 AA audit.

### v3.3 Research bridge (M)
Hand off the same data to MEGA, IQ-TREE or Galaxy; compare classroom trees with research-grade
results; notebook export (Jupyter/R Markdown).

---

## Running alongside the versions

| When | Track |
|---|---|
| From v1.2 onward | Outreach: lab-handout search (`protdist`, `neighbor`, `seqboot`, `consense`, and MEGA labs), personalized emails with each lab's data loaded, about 10 per week; one phylogeneticist reviewer |
| Spring 2027 term | First 2–3 pilots (on v1.2–v1.5) |
| After the first pilot | **Submit one lesson to CourseSource/QUBES** with the pilot's classroom data |
| After a few pilots | JOSS paper; first education or open-source grant application |
| After v2.0 | *BAMBED* paper with classroom data; conference demos (evolution or biochem education meetings) |
| Before v3.0 | Letters of intent from 3 departments, or don't build the paid tier |

Overall horizon (from 2026-10-21): v2.0 (powerhouse) in roughly 9–13 months of steady part-time work; v3.3 in roughly
24 months. **Re-plan after every pilot:** real classroom feedback outranks this list.
