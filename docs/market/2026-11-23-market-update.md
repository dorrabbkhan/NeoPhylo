# Market update, 2026-11-23 (after v1.4d)

A short update on `2026-11-18-market-and-viability.md`, made after v1.4d (tree reading) shipped and
before v1.5 is finalized. Web search only; nobody was contacted. Only changes since 2026-11-18 are
listed; everything else in that file still stands.

## Competitors: what is new

| Name | What changed | Effect on NeoPhylo |
|---|---|---|
| **PhyloGPU** (preprint, Oct 2026, MIT, Rust/egui desktop) | New tree viewer/editor that builds NJ/UPGMA trees from alignments or matrices; says it is for "exploratory analysis, teaching and figure preparation" | Small. Desktop install, no step-by-step view, no lessons, no grading. Overlaps the v1.8 tree-handling items (reroot, rotate, ladderize, collapse), not v1.5 |
| **eGPS-oneBuilder** (Genomics Communications, 2026) | GUI+CLI joining distance, ML, Bayesian and parsimony with tree interpretation | None for teaching; research tool |
| **MEGA 12.1** (J. Mol. Evol. letter, 2026) | Native macOS (Intel and Apple silicon) and modern Linux builds | MEGA gets easier to install on student Macs; Chromebooks and locked lab machines are still not served. The MEGA companion becomes more relevant, not less |
| Labster, LearnSci, SimBio | No new phylogenetics content or AI tutor found | Gap unchanged: the paid tools grade tree reading but do not teach distance methods |
| *evolved* R package (JOSE, Feb 2026) | Open-source teaching package for evolutionary biology | Shows JOSE (Journal of Open Source Education) is a working venue for a NeoPhylo paper, next to JOSS |

**Gap still open:** no free, maintained tool combines step-by-step NJ/UPGMA, numbers that match PHYLIP
and MEGA, tree-reading exercises and grading.

## Market signals: what is new

- **Accessibility, wider than we assumed.** DOJ deadline for public universities: **2027-04-26**
  (confirmed; smaller public entities 2028). Separately, **HHS's Section 504 rule** gives every college
  that receives HHS funding, private ones included, until **2027-05-11** (recipients with < 15
  employees 2028). Institutions stay responsible for the tools they choose or embed, even when a vendor
  built them. So the VPAT matters for most US universities, public and private, from spring 2027.
- **AI and assessment.** Universities are dropping AI-text detectors as unreliable (AFP, Oct 2026).
  Faculty report that redesigning assignments takes a lot of unpaid work (Chronicle, Jun 2026). Both
  favour per-student variants that need no rework from the instructor: v1.5's pitch.
- **AI tutors teach little on their own.** A study of 241 students found ChatGPT gave only a slight
  gain in evolution knowledge (Kassel, 2025); ChatGPT Study Mode was judged not yet a tutor replacement
  (Edutopia, Feb 2026). MEGA-GPT is a documentation helper for MEGA workflows, not a teaching tool.
- **CourseSource/QUBES.** Still no 2024–2026 lesson on distance trees or tree reading with an
  interactive tool. The slot for a NeoPhylo lesson stays open.

## Ratings (changes only)

No score changes. Viability stays at 6/10: there are still no users, and no rival closed the gap.

## Sources

PhyloGPU: https://www.preprints.org/manuscript/202610.0767 ·
eGPS-oneBuilder: https://www.maxapress.com/data/article/gcomm/preview/pdf/gcomm-0026-0015.pdf ·
MEGA 12.1: https://kumarlab.net/downloads/papers/StecherKumar26.pdf ·
LearnSci: https://www.learnsci.com/resources/phylogenetics · Labster: https://labster.com/simulations/evolution ·
*evolved* (JOSE): https://www.theoj.org/jose-papers/jose.00300/10.21105.jose.00300.pdf ·
DOJ/HHS deadlines: https://er.educause.edu/articles/2026/6/doj-and-hhs-extend-web-accessibility-deadlines-to-2027-2028 ·
https://www.govinfo.gov/content/pkg/FR-2026-04-20/html/2026-07663.htm ·
https://www.govinfo.gov/content/pkg/FR-2026-05-11/html/2026-09266.htm ·
Third-party tool responsibility: https://www.bsk.com/news-events-videos/digital-accessibility-upcoming-compliance-deadlines-for-public-institutions-and-considerations-for-private-institutions ·
AI detectors: https://thejakartapost.com/world/2026/10/06/grappling-with-homework-scams-us-universities-shun-ai-detectors ·
Faculty redesign load: https://www.chronicle.com/article/with-ai-in-the-classroom-professors-are-walking-a-tightrope ·
Kassel study: https://www.uni-kassel.de/uni/en/aktuelles-aus-der-universitaet/sitemap-detail-news/2025/08/20/ki-im-biologieunterricht-studie-sieht-nur-geringe-lernerfolge-und-warnt-vor-risiken.html ·
Study Mode: https://www.edutopia.org/article/putting-chatgpts-study-mode-through-its-paces/ ·
MEGA-GPT: https://megasoftware.net/pdfs/AllardKumar2025_1.pdf ·
QUBES phylogenetics: https://qubeshub.org/tags/phylogenetics/publications?sort=date
