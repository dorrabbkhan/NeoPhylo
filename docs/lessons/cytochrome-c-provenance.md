# Provenance: `exercises/cytochrome-c.json`

Retrieval date: **2026-10-18** — **owner: verify species, accessions and the classification Newick before merge.**

Species set revised at the owner gate: the original mammal-heavy set
(4 near-identical mammals + yeast) put yeast next to the primates and
gave RF 8/10 — a misleading showcase. The replacement set follows
Fitch & Margoliash (1967), spanning deep divergences (insect, plant,
two fungi). A second owner-gate pass corrected the rooting and the
Drosophila isoform (details below).

## Sequences

Eight reviewed (Swiss-Prot) cytochrome c sequences, fetched from the UniProt
REST API as `https://rest.uniprot.org/uniprotkb/<accession>.fasta`:

| Label | Species | Accession | UniProt entry | Group |
|---|---|---|---|---|
| human | *Homo sapiens* | P99999 | CYC_HUMAN | mammal |
| horse | *Equus caballus* | P00004 | CYC_HORSE | mammal |
| chicken | *Gallus gallus* | P67881 | CYC_CHICK | bird |
| zebrafish | *Danio rerio* | Q6IQM2 | CYC_DANRE | fish |
| drosophila | *Drosophila melanogaster* | P84029 | CYC2_DROME | insect |
| wheat | *Triticum aestivum* | P00068 | CYC_WHEAT | plant |
| yeast | *Saccharomyces cerevisiae* | P00044 | CYC1_YEAST | fungus |
| neurospora | *Neurospora crassa* | P00048 | CYC_NEUCR | fungus |

Isoform notes:

- For *Drosophila*, `P84029` (cytochrome c-2, gene Cyt-c-p) is used.
  UniProt expression data: P84029 is "expressed at varying, but
  relatively high levels throughout development" (Bgee: 300+ tissues) —
  the somatic form. P04657 (cytochrome c-1, Cyt-c-d) is "expressed at
  constant, but relatively low levels" (Bgee: testis spermatid + 34
  tissues) — the minor form, so it was rejected.
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
  extensions in wheat, the fungi and drosophila, small C-terminal
  differences.
- The FASTA embedded in the lesson reorders MAFFT's output rows for display
  (vertebrates, insect, plant, fungi); the aligned columns are untouched.

## Reference tree (kind: classification)

```newick
(wheat:1,((yeast:1,neurospora:1):1,(drosophila:1,(zebrafish:1,(chicken:1,(horse:1,human:1):1):1):1):1):1);
```

- Written as a **rooted ladder for display**, rooted on wheat (plant) as
  the outgroup: plants branched off first; animals and fungi are sister
  groups — the **Opisthokonta** — and inside the animals the ladder runs
  insect → fish → bird → mammals.
- **Unit branch lengths** — the display is topological only; no lengths are
  known or implied.
- As an unrooted tree (how the engine's RF reads it) it carries five
  clades: {fungi}, {animals}, {vertebrates}, {amniotes = chicken+mammals},
  {mammals}. The unrooted splits are identical to the earlier
  fungi-outgroup rooting, so re-rooting alone does not change the RF.

Source for the classification: standard textbook eukaryote phylogeny as
encoded by the NCBI Taxonomy database (ncbi.nlm.nih.gov/taxonomy).

## Behavior the lesson asserts

- `engine.loadExercise` accepts the file; NJ on JTT joins
  yeast+neurospora first — the smallest Q, deliberately *not* the smallest
  distance (the predict prompt makes this point: horse–chicken at 0.119 is
  the matrix minimum but loses on Q).
- The NJ/JTT tree **matches the classification exactly — RF = 0/10**:
  fungi together, animals together, vertebrates together, mammals together.
  NJ join 5 is a tie (flagged in the trace, broken by input order), which
  the closing note uses as the "close vertebrates are barely resolved"
  caveat. No predict prompt targets a tied or final join.
- The stepper's closing readout is "differs from the accepted
  classification in 0 clades".

## License

UniProtKB is distributed under CC BY 4.0
(uniprot.org/help/license); the attribution text is in the lesson's first
prompt and `source` block.
