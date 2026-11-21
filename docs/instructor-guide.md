# Instructor guide

NeoPhylo is a browser-based teaching tool for distance-based phylogenetics. Everything runs in the student's browser — no account, no server, nothing to install.

## How NeoPhylo is organised

- The **sandbox** is the app itself: it opens an exercise and walks through it step by step — the data, the distance matrix, the running totals and the growing tree — with a prompt at each step the exercise marks.
- **Lessons** are the shipped exercises in the Lessons menu; each opens on a `?lesson=` link. **Labs** are printable PHYLIP and MEGA handouts that reproduce a real tool run and name the matching NeoPhylo settings; the lab index is `?labs`.
- The [library](?library) lists every lesson, lab, tree-reading set and dataset on one page and links back here from its header: lesson, lab and tree-reading cards carry level, minutes and objectives plus worksheet and answer-key links; dataset cards show the source and license and open the dataset.
- The **reading trees** area is the separate, tap-only space where students answer tree-reading questions — see **Teaching tree reading** below.
- **Worksheets** give an exercise an in-app companion sheet and, for small matrices, a printable paper sheet. **Answer keys** hold the engine's answers for each.
- The [editor](?editor) builds a custom exercise from a tree drawn on the canvas or pasted as Newick — or from a matrix typed, pasted or derived from the tree — and shares it as a link or a file.

## A 50-minute class plan

UPGMA's limit first, then Neighbor-Joining by hand, then why the raw distances need correcting.

1. [When UPGMA fails: the molecular clock](?lesson=upgma-fails)
2. [Neighbor-Joining, by hand](?lesson=nj-by-hand)
3. [Saturation and distance correction](?lesson=saturation)

## A 3-hour lab plan

A computer-lab session that runs the PHYLIP chain first, then repeats the analysis in MEGA. The lesson is the warm-up; the rest are labs.

1. [How Neighbor-Joining works](?lesson=nj-basics)
2. [dnadist → neighbor (F84)](?lab=dnadist-neighbor)
3. [seqboot → dnadist → neighbor → consense](?lab=seqboot-consense)
4. [MEGA: 100 bootstrap replicates on 16S rRNA](?lab=mega-bootstrap-100)
5. [MEGA: Interpreting bootstrap support on 16S rRNA](?lab=mega-interpreting-support)
6. [MEGA: NJ vs UPGMA on vertebrate globins](?lab=mega-nj-vs-upgma)

## What an answer key contains

Every key is computed by the engine when the page renders, at the precision the page displays — the values always match what the app computes for the same exercise.

- The **paper key** fills in the distance matrix and works every join the sheet asks for by hand: the step's matrix (the Q table for NJ), row sums or cluster sizes, the joined pair with every tied pair, whether picking the smallest distance would have been right, the branch lengths and the new distances. The joins the sheet leaves to the app are answered too, the finished tree is printed, and a common-mistake line names each join where the smallest distance is not the pair that joins. When a tie's pairs lead to the same tree the key says so. For UPGMA the tables are labelled as cluster averages.
- The **in-app key** answers each prompt — predicted pairs (every tied pair, plus which one NeoPhylo joins), the least-supported grouping for a bootstrap question, and a resampling step's support counts from the seeded run. Writing prompts have no engine answer.
- An exercise with a bootstrap run also carries the caption that a student's own MEGA or PHYLIP numbers will differ by sampling noise.

For one worked example, the [paper worksheet](?worksheet=nj-by-hand&kind=paper) and its [answer key](?key=nj-by-hand&kind=paper) cover the Neighbor-Joining-by-hand exercise — the library lists worksheet and key links like these for every lesson and lab.

## The answer-key gate is not access control

The answer-key links ask you to confirm you are an instructor before the key opens. That step is a signal, not a lock: anyone can click **I'm an instructor**, and the key is computed in the same browser your students use. There are no accounts — keep the printed keys out of students' hands yourself.

## Making and sharing a matrix exercise

In the [editor](?editor), set **Exercise data** to **Start from a matrix** — the drawn tree stops being the data and becomes a derive source.

- **Type a matrix…** opens a grid for typing distances; the paste box takes a lower-triangle or square matrix (PHYLIP, `.meg`, or a plain table with the taxon names first).
- **Derive from the drawn tree** computes the tree's additive distances into the matrix; **Round to** rounds them — while a rounding is set, a warning notes the rounded distances may no longer fit the tree exactly.
- Only the method setting survives the switch: pick Neighbor-Joining or UPGMA.

**Save file** writes a validated exercise file; **Share link** copies a `#x=` URL that a student opens directly. **Preview** opens the exercise as the student sees it, and the editor's **Import a file or #x= link** field takes either form back for later edits. The paper worksheet exists only for matrices of eight taxa or fewer — a larger exercise still gets the in-app worksheet and key.

## Teaching tree reading

The **reading trees** area is a separate, tap-only space where students answer tree-reading questions — relatedness, common ancestors, clades, rotation, node order and trait marks — on real-organism trees drawn in several styles. Every answer is computed by the engine; the only hand-keyed items are concept questions, labelled "authored answer" wherever they appear. Students reach it from the **Reading trees** header link or the Tree reading cards in the [library](?library&type=reading); every set also opens directly on a `?read=` link — handy for an LMS or a projected starter — and ships a printable paper worksheet plus an answer key behind the usual instructor step.

### The four lessons

Four practice-mode sets, all intro level, in teaching order:

- [Reading a tree](?read=trees-reading-a-tree) — the parts of a tree and the direction of time.
- [Rotation changes nothing](?read=trees-rotation) — the same relationships drawn in different styles; tip order carries no meaning.
- [Who is closest?](?read=trees-closest-relatives) — relatedness read from shared ancestry, not from tip proximity or resemblance.
- [Clades and shared traits](?read=trees-clades-traits) — monophyly and trait marks, including losses.

### Using forms A and B

[Tree reading — form A](?read=trees-form-a) and [Tree reading — form B](?read=trees-form-b) are parallel test-mode sets: the same misconception categories on different trees and taxa, so a class can sit one before teaching and the other after. Test mode shows no per-item feedback; the Finish screen gives the score with each item's explanation. Both are labelled "NeoPhylo's own questions, not a validated instrument" — see **Measuring learning** below.

Both forms also print — [form A's paper worksheet](?worksheet=trees-form-a&kind=paper) with its [answer key](?key=trees-form-a&kind=paper), and [form B's worksheet](?worksheet=trees-form-b&kind=paper) with its [key](?key=trees-form-b&kind=paper) — for rooms without screens. Three paper caveats: the item wording is written for the screen ("Tap every tip that has…"), so read it as an instruction to mark the sheet; each sheet ends in a scan-the-code block that opens the live set — on a test-mode form that is the test itself, not an answer check, so keep the printed key for marking; and on form A's trait tree the mark labels can crowd each other in print — the on-screen set is unaffected.

### Building a reading set in the editor

In the [editor](?editor), choose the **Tree reading set** mode. Give the set an id, title and summary and pick **practice** or **test** mode.

- Each stored tree takes pasted Newick — polytomies enter through Newick only; the shared draw canvas stays binary. **Edit on the canvas** loads a stored tree onto it, **Use canvas tree** stores the canvas back.
- Annotations are made by tapping: pick the annotate tool — letter, age, mark or point — tap a clade on the preview (or a node on the canvas) and apply. Letters name nodes for items to reference, ages drive a numeric time axis, marks record trait gains and losses on branches, and points mark positions on nodes or branches; the times axis and trait display names live in the same panel.
- Items are added by question type, and their tips, nodes and points are chosen by tapping — never by editing JSON. The engine re-checks the whole set after every change: a refusal names the item and the field, and **Save file**, **Share link** and **Preview** stay disabled until the set loads. Each item shows its engine-computed answer as you build.
- **Share link** copies a `?read=` URL that carries the set in its `#r=` fragment; **Save file** writes a `<id>.neophylo-reading.json` file; **Preview** opens exactly what the student sees; **Import a file or #r= link** takes either form back for later edits.
- One current limit: the "has one trait, lacks another" trait question cannot be authored correctly yet — its fields capture tips where the format expects trait names — so leave that type out of sets you build.

### Measuring learning

Forms A and B are the before/after pair. Instructors who need a validated measure should reach for the published instruments: Baum et al. 2005's tree-thinking quizzes, Naegle's Tree-Thinking Concept Inventory (Gibson & Hoefnagels), and Kummer et al. 2019's Evolutionary Tree Concept Inventory (ETCI); Furrow & Hsu 2019 reviews evolution concept inventories more broadly. The coverage sets under `exercises/reading/coverage/` re-express each listed format in NeoPhylo's own wording, and a manifest there names the instrument and format each mirrors. They are not in the library but open directly: [Coverage — drawing styles and tree equivalence](?read=cov-styles), [Coverage — relatedness and what trees mean](?read=cov-relatedness), [Coverage — lettered nodes, points, clades and subtrees](?read=cov-structural), [Coverage — statements, node order and time](?read=cov-statements) and [Coverage — trait marks, gains, losses and groups](?read=cov-traits).

Read NeoPhylo's scores with every one of these caveats:

- NeoPhylo's items are new and unvalidated — form scores cannot be compared with published instrument results.
- A subset or reordering of any validated instrument loses its validity evidence.
- Multiple-choice guessing inflates a single score — compare before and after, not against a cut-off.
- Students do better on familiar than unfamiliar taxa, and trait loss is harder than gain — the forms deliberately mix both.
- Some instruments are available only from their authors (the ETCI) or carry no reuse licence (Baum's supplement reuses publishers' figures) — cite them, and ask the authors before typing their items into NeoPhylo.

**Known gaps.** The coverage manifest defers five formats, each until the named milestone:

- Character-matrix fit and most-parsimonious placement — v2.0; needs the matrix view and parsimony scoring.
- Branch lengths drawn to a scale bar and V-shaped unrooted trees — v2.0; reading sets carry topology only.
- Colour-mapped ancestral-state reconstructions and counting migrations on a map — v2.7; needs the planned geographic and ancestral-state renderer.
- Support values on branches — v2.x; reading trees have no support-value field yet.
- Error bars on node ages and external event lines on the axis — v2.6; needs age ranges and event markers on the time axis.

## A 50-minute tree-reading class plan

Form A cold, one lesson, then Form B. Only one lesson fits between the forms inside the slot; [Clades and shared traits](?read=trees-clades-traits) is the pick because it rehearses the two skill families the forms lean on most — clade membership and trait marks, including losses — on top of the relatedness the rest of each form probes.

1. [Tree reading — form A](?read=trees-form-a)
2. [Clades and shared traits](?read=trees-clades-traits)
3. [Tree reading — form B](?read=trees-form-b)

For a longer slot, the other three lessons slot between the forms in teaching order — Reading a tree, Rotation changes nothing, Who is closest? — or run as follow-up sessions.
