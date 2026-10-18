# Provenance: `exercises/cytochrome-c.json`

Retrieval date: **2026-10-18** — **owner: verify species, accessions and the classification Newick before merge.**

Species set revised at the owner gate: the original mammal-heavy set
(4 near-identical mammals + yeast) put yeast next to the primates and
gave RF 8/10 — a misleading showcase. The replacement set follows
Fitch & Margoliash (1967): two vertebrate-adjacent mammals are gone in
favour of deep divergences (insect, plant, second fungus).

## Sequences

Eight reviewed (Swiss-Prot) cytochrome c sequences, fetched from the UniProt
REST API as `https://rest.uniprot.org/uniprotkb/<accession>.fasta`:

| Label | Species | Accession | UniProt entry | Group |
|---|---|---|---|---|
| human | *Homo sapiens* | P99999 | CYC_HUMAN | mammal |
| horse | *Equus caballus* | P00004 | CYC_HORSE | mammal |
| chicken | *Gallus gallus* | P67881 | CYC_CHICK | bird |
| zebrafish | *Danio rerio* | Q6IQM2 | CYC_DANRE | fish |
| drosophila | *Drosophila melanogaster* | P04657 | CYC1_DROME | insect |
| wheat | *Triticum aestivum* | P00068 | CYC_WHEAT | plant |
| yeast | *Saccharomyces cerevisiae* | P00044 | CYC1_YEAST | fungus |
| neurospora | *Neurospora crassa* | P00048 | CYC_NEUCR | fungus |

Notes:

- For *Drosophila*, `P04657` (cytochrome c-1, gene Cyt-c-d) was chosen over
  `P84029` (cytochrome c-2, gene Cyt-c-p): Cyt-c-d is the constitutively
  expressed somatic isoform; Cyt-c-p is enriched in larval/testis tissue.
- For the plant, wheat `P00068` (single canonical cytochrome c, present in
  the original Fitch & Margoliash alignment) was chosen over Arabidopsis,
  which has two reviewed paralogues (CYTC-1 `O23138`, CYTC-2 `Q9T0G2`).
- For the second fungus, *N. crassa* `P00048` (also in the original
  Fitch & Margoliash set) was chosen over Candida entries, which are not
  all reviewed Swiss-Prot.
- For yeast, `P00044` is isoform 1 (CYC1), the canonical cytochrome c.
- Full UniProt canonical sequences, unedited.

## Alignment

- Command: `mafft --auto all.fasta > aligned.fasta`
- MAFFT version: **v7.525 (2024/Mar/13)** (conda package `bioconda::mafft`)
- Result: 112 aligned columns; gaps are terminal only — short N-terminal
  extensions in wheat and the two fungi, small C-terminal differences.
- The FASTA embedded in the lesson reorders MAFFT's output rows for display
  (vertebrates, insect, plant, fungi); the aligned columns are untouched.

## Reference tree (kind: classification)

```newick
((yeast:1,neurospora:1):1,(wheat:1,(drosophila:1,(zebrafish:1,(chicken:1,(horse:1,human:1):1):1):1):1):1);
```

- Written as a **rooted ladder for display**, with the fungi as the
  outgroup: fungi | (plant, (insect, (fish, (chicken, (horse, human))))).
- **Unit branch lengths** — the display is topological only; no lengths are
  known or implied.
- As an unrooted tree (how the engine's RF reads it) it carries five
  clades: {fungi}, {animals}, {vertebrates}, {amniotes = chicken+mammals},
  {mammals}.

Source for the classification: standard textbook eukaryote phylogeny as
encoded by the NCBI Taxonomy database (ncbi.nlm.nih.gov/taxonomy).

## Behavior the lesson asserts

- `engine.loadExercise` accepts the file; NJ on JTT joins
  yeast+neurospora first — the smallest Q, deliberately *not* the smallest
  distance (the predict prompt makes this point: horse–chicken at 0.119 is
  the matrix minimum but loses on Q).
- The NJ/JTT tree recovers all three deep groups — fungi together,
  animals together, vertebrates together — and differs from the
  classification in **1 clade** (RF = 2/10): the inferred tree pairs
  chicken with zebrafish instead of placing chicken next to the mammals
  (missing clade {chicken, mammals}, extra clade {chicken, zebrafish}).
- Predict prompts target join 1 only; there are no ties on joins 1–5.
- The stepper's closing readout is "differs from the accepted
  classification in 1 clade"; the closing note explains it.

## License

UniProtKB is distributed under CC BY 4.0
(uniprot.org/help/license); the attribution text is in the lesson's first
prompt and `source` block.
