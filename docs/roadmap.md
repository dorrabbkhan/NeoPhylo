# NeoPhylo roadmap: v1.2 → v3.3

Status: v1.0 and v1.1 (protein support, PHYLIP I/O) released; next: v1.2.

Each version is one spec → plan → agent cycle. Size is a rough guide for part-time, agent-driven work:
**S** ≈ 2–3 weeks, **M** ≈ 4–6 weeks, **L** ≈ 2–3 months. Every version ships with at least one new
lesson and the same validation discipline as v1/v1.1: an independent oracle (PHYLIP, R, published
examples), property tests and fuzzing.

"Teaching coverage" is a rough estimate of the share of typical intro phylogenetics and biochem lab
content NeoPhylo can run, not a count of PHYLIP programs.

| Milestone | Version | Meaning |
|---|---|---|
| 🟡 Early-adopter pilots | after **v1.5** | Enthusiastic instructors can run a full lab with it |
| 🟢 **POWERHOUSE** | after **v2.0** | Covers a whole intro course; instructors seek it out to pilot for free |
| 💰 Paid tier | **v3.0** | Only after 3 departments sign letters of intent |

---

## Phase 1: Complete the common lab (v1.2–v1.5)

### v1.2 Bootstrap & consensus (M) · coverage ≈ 65–70%
- Resampling visualized: watch columns drawn with replacement, and the replicate alignment built.
- N replicates → N trees (fast path, no per-step traces), with the progress shown.
- Majority-rule and strict consensus; support values on branches. These are branch attributes, which
  is the v1 data-model decision paying off.
- Support values mapped onto the original tree. A "why is this clade only 62%?" view shows the
  replicates that disagreed.
- Lesson: "How sure are we?" Fixtures: `seqboot` + `consense` (seeded) and R `ape::boot.phylo`.
- Draw the inferred tree rooted like the reference (display-only reroot on the reference outgroup),
  found at the v1.1 checkpoint with the cytochrome-c lesson.

### v1.3 Design system & polish (M)
- Design tokens, type scale, spacing, component library; consistent light and dark themes.
- Tablet and narrow-screen layout; a "presenter" font size for projectors.
- First-run onboarding (a 30-second guided tour); empty states; loading states.
- KaTeX lazy-loaded; bundle and performance pass.
- Narrow-window and tablet layout (content currently clips instead of reflowing; found at v1.1
  checkpoints).
- Saturation fixes show progress feedback when one click doesn't fully resolve saturation (found at
  the v1.1 release checkpoint).

### v1.4 Instructor kit (L)
- **Exercise editor in the UI:** draw or paste a true tree, set the model, seed and length, add
  prompts, preview, get a share link. No JSON editing.
- Lesson library page: browse lessons by topic and level; each lesson has learning objectives.
- Printable worksheet per lesson (PDF): prompts, blanks, answer key for the instructor.
- Instructor guide: suggested 50-minute and 3-hour lab plans per lesson.

### v1.5 Classroom delivery (S) · 🟡 EARLY-ADOPTER PILOT POINT
- Embed mode (iframe-friendly, minimal chrome) for LMS pages and course sites.
- Presenter mode: big fonts, step-through driven from the keyboard, hidden side panels.
- An offline "lab pack" download for rooms with unreliable Wi-Fi.
- Per-lesson "copy assignment text" for the LMS.

> **🟡 After v1.5**, an instructor can replace a full distance + bootstrap lab, author their own
> exercises, and deliver them in class. Enthusiastic early adopters will pilot from here. Start
> serious outreach no later than this point (ideally during v1.2).

---

## Phase 2: Breadth to cover the whole intro course (v1.6–v2.0)

### v1.6 Model breadth (M)
- DNA: F84 (PHYLIP's `dnadist` default), Tamura-Nei, LogDet. Protein: PAM (DCMut) and PMB. All are
  pure data on the `model` module.
- Gamma rate variation for distances (DNA and protein).
- A "model explorer" view: substitution rates as a heatmap, P(t) changing as t grows.
- Lesson: "Why rate variation matters."

### v1.7 More tree methods & tree handling (M)
- Fitch-Margoliash least squares and minimum evolution / BIONJ, with step views. Compare against NJ
  on the same data.
- Rerooting by outgroup and midpoint; collapse, rotate and ladderize. Supports stay on the right
  branches.
- Unrooted (radial) drawing next to the rectangular view.
- Lesson: "Rooting: where is the ancestor?"

### v1.8 Alignment step-through (L) · "raw sequences → tree" complete
- Pairwise alignment (Needleman-Wunsch / Smith-Waterman) as an animated dynamic-programming grid,
  with scoring matrices (BLOSUM/PAM) and gap penalties as controls.
- Simple progressive multiple alignment (≤ 20 sequences) guided by an NJ tree, showing why the guide
  tree matters.
- Pasting unaligned sequences now offers "Align them" instead of an error.
- Lesson: "Alignment is a hypothesis." Oracle: published DP examples and Biostrings/Clustal outputs.

### v1.9 Data library & integration (M)
- Fetch sequences by UniProt or NCBI accession (CORS-permitting APIs). One-click curated datasets:
  globins, cytochrome c, primate mtDNA, 16S rRNA, a small SARS-CoV-2 set. Each has provenance and
  licensing.
- Tip metadata (CSV): color and label tips by trait.
- Python script export alongside R (Biopython or scikit-bio, once parity-checked).

### v2.0 Parsimony + course pack (L) · coverage ≈ 85–90% · 🟢 POWERHOUSE
- Fitch parsimony stepped through site by site: state sets flowing up the tree, changes counted,
  tree length.
- Compare candidate trees by parsimony score; exhaustive search for ≤ 7 taxa, with all trees ranked.
- Informative vs uninformative sites highlighted.
- **Course pack:** a 10-lab syllabus (alignment → distances → NJ → bootstrap → models → rooting →
  parsimony …) with objectives, worksheets and instructor notes, mapped to standard textbooks.
- Oracle: PHYLIP `dnapars`/`protpars`, `phangorn::parsimony`.

> **🟢 POWERHOUSE: after v2.0.** NeoPhylo covers the full core of an intro phylogenetics or
> biochem-evolution course: alignment, distances, models, NJ, bootstrap, rooting, parsimony. It has
> an editor, worksheets, embed and presenter modes, a curated data library and a ready-made course
> pack. Every step is visible and validated, and there is nothing to install. At this point
> instructors seek it out: it's a complete free course companion that MEGA and web pipelines
> don't offer. Target: 10+ free courses by now, and a JOSS or *BAMBED* paper with pilot data.

---

## Phase 3: Advanced teaching nobody else offers (v2.1–v2.7)

### v2.1 Likelihood I: Felsenstein pruning (L)
- On 4–6 taxa: per-site partial likelihoods flowing up the tree, step by step, for DNA and protein
  (reusing the `model` module).
- Site likelihoods → tree log-likelihood; comparing topologies by likelihood.
- Lesson: "What does 'the most likely tree' mean?" Oracle: `phangorn::pml`, PHYLIP `dnaml` at fixed
  topology.

### v2.2 Likelihood II: optimization & model choice (M)
- Branch-length optimization visualized as a likelihood surface for one branch.
- Model comparison: likelihood-ratio test and AIC, visual and stepwise.
- Gamma in likelihood; "too simple vs too complex" lesson.

### v2.3 Tree search landscapes (M)
- NNI and SPR moves animated on small trees, scored by parsimony or likelihood.
- A score "landscape" view showing local optima, and why heuristic searches can get stuck.
- Lesson: long-branch attraction, with parsimony fooled and likelihood not (simulated on a known tree).

### v2.4 Bayesian intro (M)
- MCMC on a tiny tree: proposal → accept/reject animated; trace plot; posterior over topologies.
- Prior sensitivity; posterior support vs bootstrap support on the same data.
- Lesson: "Bootstrap ≠ posterior probability."

### v2.5 Assessment without accounts (M)
- Randomized per-student variants (each student a different seed) from one assignment link.
- Auto-checked tasks (predict the pair, compute a Q-value, find the parsimony length).
- Completion codes students paste into the LMS, verifiable by the instructor offline (signed codes),
  so no backend is needed.

### v2.6 Rooting, clocks & dating (M)
- Ultrametric vs additive trees; molecular-clock test.
- Simple dating with calibration points; rate-variation pitfalls.
- Lesson: "When did these lineages split?"

### v2.7 Character evolution & coalescent (L)
- Ancestral state reconstruction (parsimony and marginal likelihood) painted on the tree.
- Coalescent simulator: gene trees inside species trees; incomplete lineage sorting visualized.
- Lesson: "Why gene trees disagree."

---

## Phase 4: Institutional tier and reach (v3.0–v3.3)

### v3.0 Institutional tier (L) · 💰 ONLY AFTER 3 LETTERS OF INTENT
- Accounts and SSO; LTI 1.3 for Canvas, Moodle and Blackboard, with grade passback (builds on the
  v2.5 assessments).
- Class dashboards: completion, time on task, prompt accuracy.
- Private department lesson libraries and shared editing.
- Compliance pack: DPA (GDPR/FERPA), accessibility report (VPAT), security questionnaire answers
  (HECVAT). Status page and SLA.
- The free student tool stays free and AGPL.

### v3.1 Instructor analytics (M)
- Misconception maps: which prompts students get wrong, and what they picked instead.
- Lesson effectiveness across sections and terms; exportable reports.

### v3.2 Localization & accessibility certification (M)
- UI and lessons in Spanish, Portuguese, French, German and Chinese (community-assisted).
- An independent WCAG 2.2 AA audit.

### v3.3 Research bridge (M)
- "Run the real thing": hand off the same data to IQ-TREE (web server) or Galaxy; compare the
  student's NJ, parsimony and likelihood trees with the research-grade result.
- Notebook export (Jupyter/R Markdown) reproducing the lesson's analysis.
- Lesson: "From classroom methods to research pipelines."

---

## Running alongside the versions (not features, but they decide success)

| When | Track |
|---|---|
| From v1.2 onward | Outreach: lab-handout search, personalized emails, ~10 per week; one phylogeneticist reviewer |
| Spring 2027 term | First 2–3 pilots (on v1.3–v1.5) |
| After first pilots | JOSS paper; first education/open-source grant application |
| After v2.0 | *BAMBED* paper with classroom data; conference demos (evolution or biochem education meetings) |
| Before v3.0 | Letters of intent from 3 departments, or don't build the paid tier |

Overall horizon: v2.0 (powerhouse) in roughly 9–12 months of steady part-time work; v3.3 in
roughly 20–24 months. Re-plan after every pilot: real classroom feedback outranks this list.
