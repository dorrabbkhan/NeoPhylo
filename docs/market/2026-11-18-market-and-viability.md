# Market, competitors and viability, 2026-11-18

A wider pass than the 2026-11-14 check (`2026-11-14-market-check.md`), made before the v1.5 spec. Web
search only; nobody was contacted. Items marked *unverified* could not be confirmed from a source.

## Competitors

| Name | Type | Price | Shows algorithm steps | Grading | LMS | Notes |
|---|---|---|---|---|---|---|
| Labster (tree-of-life labs) | Commercial virtual labs | Institution quote, per unique student/yr | No | Yes | Yes | No distance-method lab; story-style, 15–20 min |
| LearnSci Phylogenetics Smart Worksheet | Commercial worksheet | Quote | No (tree anatomy, rooting) | Yes, per-student data | Yes (Canvas, Blackboard, Moodle, Sakai, Brightspace) | Closest to v1.5 grading, but paid and no algorithm |
| SimBio EvoBeaker / SimUText | Commercial simulations | Per student | Partial (tree thinking) | Yes | *unverified* | Tree thinking, not distance methods |
| HHMI BioInteractive "Creating Phylogenetic Trees from DNA Sequences" | Free Click & Learn | Free | Partial (no NJ arithmetic) | Worksheet only | No | v2.0.1, 2024 |
| Phylogeny.fr (2026 redesign), NGPhylogeny.fr, Galaxy | Free pipelines | Free | No | No | No | Used by large classes; run tools, explain nothing |
| MEGA 12 + **MEGA-GPT** | Research tool + built-in AI assistant | Free | Explains in chat | No | No | Keeps MEGA central to teaching |
| MetricGate NJ/UPGMA calculator | Commercial web calculator | Freemium *unverified* | Yes (merge/join steps) | No | No | Nearest "steps visible" rival; matrix only, no lessons |
| Rosalind / Compeau–Pevzner | Coding problems | Free | Students implement NJ | Auto-checked answers | No | CS audience; overlaps v1.8 "check your implementation" |
| IIT Virtual Labs "NJ Algorithm" | Free government lab | Free | Partial (static) | Pre/post test | No | |
| iTOL, Geneious Prime, DNA Subway 2.0, Jalview, SeaView | Adjacent | Mixed | No | No | No | Visualization or pipelines |

**Gap:** no free, maintained tool combines step-by-step NJ/UPGMA, numbers matching PHYLIP and MEGA, and
grading. The paid tools grade but teach tree reading only; the free tools compute but don't explain.

## Market signals

- US intro biology for majors: several hundred thousand students a year (medium confidence).
- Hands-on distance-tree courses (bioinformatics, molecular evolution, biochemistry): low thousands of
  US courses (low confidence, extrapolated from NIBLSE surveys of ~1,260 and ~509 educators).
- MEGA bootstrap handouts are common; **no PHYLIP handout dated 2024–2026 was found**. PHYLIP labs are a
  shrinking niche; the MEGA companion matters more than PHYLIP completeness.
- Instructor pain points: time to rework a course, students lacking prerequisites, loaned laptops and
  locked-down machines that can't install software (NeoPhylo's no-install model answers the last one).
- AI: a 2026 *Science* survey (95,000+ students, 20 universities) found about a third use AI regularly on
  assignments; authors recommend redesigning assessment. Supports per-student variants.
- Accessibility: ADA Title II WCAG 2.1 AA deadline 2027-04-26 (smaller entities 2028); universities ask
  for a VPAT even for free tools. No free competitor publishes one.
- Funding: NSF terminated 839 education-directorate grants ($888M) by 2025-05; IUSE's 2026 status
  *unverified*. Grant-funded adoption paths are weaker.
- Pedagogy: one study found tree *interpretation* teaches tree thinking better than tree *building*.

## Ratings (conductor's judgement, out of 10)

| | Score | Reason |
|---|---|---|
| Technical credibility | 9 | Every number validated against PHYLIP, MEGA-CC and R |
| Attractiveness, molecular-evolution / bioinformatics instructors | 7 | Unique free niche; runs on Chromebooks and locked lab machines |
| Attractiveness, intro biology | 4 | Largest market; needs tree reading first |
| Usability | 6, *unverified* | No instructor or student has used it; three instructor think-alouds would tell more than any feature |
| Viability (adoption) | 6 | Real but small niche; single owner; no users yet; weaker grants |
| Revenue, next 2 years | 2 | Expected: paid tier waits for 3 letters of intent |

## Potential, ranked

1. Free per-student variants with auto-checking and instructor bulk grading, plus a VPAT (v1.5): what
   Labster and LearnSci charge for, aimed at the AI-cheating problem.
2. Tree reading: opens intro biology, the largest market, and is easy to auto-grade.
3. A CourseSource/QUBES lesson: no 2025–26 distance-tree lesson in that slot.
4. MEGA companion: MEGA-GPT keeps MEGA central; pitch "do it yourself, then check against MEGA".
5. Likelihood and Bayesian step-throughs (v2.1+): nobody offers them; smaller upper-level market.
6. PHYLIP completeness: shrinking; no longer a v2.0 target.

## Threats

MEGA-GPT and general chatbots explaining NJ; MetricGate showing join steps; Phylogeny.fr's modern
redesign for the free no-install crowd; weaker grant funding; zero real users so far.

## Sources

Labster: https://labster.com/simulations/evolution-taxonomic-tree-of-life-new · https://labster.com/pricing ·
LearnSci: https://www.learnsci.com/resources/phylogenetics ·
SimBio: https://simbioactivelearning-instructor.zendesk.com/hc/en-us/articles/33789896794523-Ordering-Information-College ·
BioInteractive: https://media.hhmi.org/biointeractive/click/Phylogenetic_Trees/supporting.html ·
Phylogeny.fr: https://arxiv.org/abs/2608.01960 · NGPhylogeny.fr: https://academic.oup.com/nar/article/47/W1/W260/5480904 ·
MEGA-GPT: https://megasoftware.net/pdfs/AllardKumar2025_1.pdf ·
MetricGate: https://metricgate.com/calculator/phylogenetic-tree-construction ·
Rosalind: https://rosalind.info/about/ · IIT Virtual Labs: https://iba-amrt.vlabs.ac.in/exp/nj-tree/theory.html ·
iTOL: https://itol.embl.de/pricing.cgi · Geneious: https://geneious.com/free-course-license ·
DNA Subway: https://dnasubway.cyverse.org/sunset ·
Intro bio enrollment: https://par.nsf.gov/biblio/10583074 ·
NIBLSE surveys: https://www.biorxiv.org/content/10.1101/204420.full.pdf · https://www.frontiersin.org/articles/10.3389/feduc.2023.1317191/full ·
Lab hardware barrier: https://www.frontiersin.org/articles/10.3389/feduc.2021.711535/full ·
PHYLIP handout example: https://si.biostat.washington.edu/sites/default/files/modules//2016_SISG_19_6.pdf ·
AI and assessment: https://news.cornell.edu/stories/2026/05/widespread-ai-misuse-means-higher-ed-must-rethink-assessment ·
ADA Title II: https://statescoop.com/doj-delays-state-local-digital-accessibility-deadline-by-one-year/ ·
VPAT procurement: https://procurement.ua.edu/procuring-digital-content-and-technology/ ·
LTI 1.3 adoption: https://www.webull.com/news/15661549438501888 ·
NSF cuts: https://cossa.org/?p=24311 · Interpretation vs building: https://scholarsarchive.byu.edu/etd/6276 ·
Tool drop-off: https://colorado.edu/sei/content/use-research-based-instructional
