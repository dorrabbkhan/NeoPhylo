# Market check, 2026-11-14

A short scan before the v1.4c spec. Web search only; no tool was installed or run.

## Research tools (the "companion" side)

- **MEGA 12 / 12.1** (Kumar et al., *MBE* 2024; 12.1 adds native macOS/Linux builds). New since our
  MEGA handouts were written: an **Adaptive bootstrap** option that picks the replicate count itself,
  filtered model selection (fits six base models, drops the poor ones), faster ML, an improved Tree
  Explorer, and a TimeTree-linked calibration editor. Nothing that teaches *how* NJ or bootstrap work.
  → Roadmap: v1.4c checks the Adaptive option against the "100 replicates" handout.
- **IQ-TREE 3** (manual 3.0.0, May 2025; *MBE* 2026, msag117): mixture models, gene/site concordance
  factors, a sequence simulator; a web server for quick runs. Research-grade, not explanatory.
  → No change; concordance factors are a possible v3.3 "research bridge" item.
- **PHYLIP**: no new release found; classic labs still use it, which keeps the standalone-replacement
  mode relevant.

## Web tools for non-specialists

- **Phylogeny.fr v2** (beta; arXiv 2608.01960, 2026): a redesigned pipeline service (MUSCLE/MAFFT →
  PhyML/IQ-TREE/RAxML-NG/MrBayes/FastTree) with new React viewers. Closest "nothing to install" web
  alternative, but it runs tools and shows results; it does not show steps, check numbers against an
  oracle, or ship lessons. → Positioning unchanged; worth naming in outreach ("Phylogeny.fr runs it,
  NeoPhylo explains it").
- Small browser NJ/UPGMA builders (PrimerDigital, NRTech, MashtreeWebX for genomes): calculators, no
  pedagogy, no validation story.

## Teaching resources

- HHMI BioInteractive "Creating phylogenetic trees from DNA sequences", Berkeley *Understanding
  Evolution* tree-thinking materials, Galaxy Training Network tree-thinking tutorials, CourseSource
  activities (mostly 2019–2021 vintage), a 2026 LEGO tree-thinking activity. Good material for v1.6
  (tree interpretation); none is an interactive, validated tool. Opportunity unchanged.
- **AI:** no phylogenetics AI tutor found; literature is thin (ChatGPT-writes-R-code studies, 2023).
  The practical effect is on assessment: students can paste a fixed question into a chatbot.
  → Supports v1.5's per-student seeded variants and auto-checked numeric tasks; no AI feature planned.

## Adoption constraints

- **ADA Title II (US):** WCAG 2.1 AA for public universities; the DOJ interim final rule of
  2026-04-20 moved the date to **2027-04-26** (smaller entities 2028-04-26). Universities increasingly
  review LTI/embedded tools for accessibility before use. → Roadmap: v1.5 gains a WCAG 2.1 AA
  self-audit and a published Accessibility Conformance Report (VPAT); the independent WCAG 2.2 AA audit
  stays in v3.2.
- **European Accessibility Act** (in force June 2025) applies to private EdTech vendors selling in the
  EU; the free AGPL tool is not a vendor product today, but the v3.0 paid tier would be.

## Not verified here

- Whether NCBI E-utilities, UniProt REST and ENA send CORS headers that allow a browser fetch (decides
  the v1.4c accession-fetch design; to be checked with `curl -H 'Origin: …'` during the spec).
- The default state of MEGA 12's Adaptive bootstrap option in the GUI.

## Sources

- MEGA12: https://academic.oup.com/mbe/article/41/12/msae263/7930299
- IQ-TREE 3: https://github.com/iqtree/iqtree3 · https://doi.org/10.1093/molbev/msag117
- Phylogeny.fr v2: https://arxiv.org/pdf/2608.01960 · https://v2.phylogeny.fr/tools
- BioInteractive: https://www.biointeractive.org/classroom-resources/creating-phylogenetic-trees-dna-sequences
- Understanding Evolution: https://evolution.berkeley.edu/the-tree-room/trees-for-teachers/lessons-and-resources/
- ChatGPT in bioinformatics teaching: https://pmc.ncbi.nlm.nih.gov/articles/PMC10299548/
- ADA Title II extension: https://upcea.edu/doj-extends-accessibility-deadline-to-april-2027-policy-matters-april-2026/ ·
  https://titleii.org/deadlines
