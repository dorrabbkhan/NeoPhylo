# Instructor guide

NeoPhylo is a browser-based teaching tool for distance-based phylogenetics. Everything runs in the student's browser — no account, no server, nothing to install.

## How NeoPhylo is organised

- The **sandbox** is the app itself: it opens an exercise and walks through it step by step — the data, the distance matrix, the running totals and the growing tree — with a prompt at each step the exercise marks.
- **Lessons** are the shipped exercises in the Lessons menu; each opens on a `?lesson=` link. **Labs** are printable PHYLIP and MEGA handouts that reproduce a real tool run and name the matching NeoPhylo settings; the lab index is `?labs`.
- The [library](?library) lists every lesson, lab and dataset on one page — cards with level, minutes and objectives, plus worksheet and answer-key links — and links back here from its header.
- **Worksheets** give an exercise an in-app companion sheet and, for small matrices, a printable paper sheet. **Answer keys** hold the engine's answers for each.
- The [editor](?editor) builds a custom exercise from a drawn, pasted or derived tree and shares it as a link or a file.

## A 50-minute class plan

UPGMA's limit first, then the Neighbor-Joining algorithm by hand, then the two methods on the same matrix.

1. [When UPGMA fails: the molecular clock](?lesson=upgma-fails)
2. [Neighbor-Joining, by hand](?lesson=nj-by-hand)
3. [UPGMA vs Neighbor-Joining, on a perfect matrix](?lesson=upgma-vs-nj-matrix)

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

## The answer-key gate is not access control

The answer-key links ask you to confirm you are an instructor before the key opens. That step is a signal, not a lock: anyone can click **I'm an instructor**, and the key is computed in the same browser your students use. There are no accounts — keep the printed keys out of students' hands yourself.

## Making and sharing a matrix exercise

In the [editor](?editor), set **Exercise data** to **Start from a matrix** — the drawn tree stops being the data and becomes a derive source.

- **Type a matrix…** opens a grid for typing distances; the paste box takes a lower-triangle or square matrix (PHYLIP, `.meg`, or a plain table with the taxon names first).
- **Derive from the drawn tree** computes the tree's additive distances into the matrix; **Round to** decides whether they stay exact — a warning appears when rounded distances no longer fit the tree exactly.
- Only the method setting survives the switch: pick Neighbor-Joining or UPGMA.

**Save file** writes a validated exercise file; **Share link** copies a `#x=` URL that a student opens directly. **Preview** opens the exercise as the student sees it, and the editor's **Import a file or #x= link** field takes either form back for later edits. The paper worksheet exists only for matrices of eight taxa or fewer — a larger exercise still gets the in-app worksheet and key.
