# Provenance: `exercises/cytochrome-c.json`

Retrieval date: **2026-10-18** — **owner: verify species, accessions and the classification Newick before merge.**

## Sequences

Eight reviewed (Swiss-Prot) cytochrome c sequences, fetched from the UniProt
REST API as `https://rest.uniprot.org/uniprotkb/<accession>.fasta`:

| Label | Species | Accession | UniProt entry | Group |
|---|---|---|---|---|
| human | *Homo sapiens* | P99999 | CYC_HUMAN | mammal (primate) |
| macaque | *Macaca mulatta* | P00002 | CYC_MACMU | mammal (primate) |
| mouse | *Mus musculus* | P62897 | CYC_MOUSE | mammal (rodent) |
| cow | *Bos taurus* | P62894 | CYC_BOVIN | mammal (ungulate) |
| chicken | *Gallus gallus* | P67881 | CYC_CHICK | bird |
| frog | *Xenopus tropicalis* | Q640U4 | CYC1_XENTR | amphibian |
| zebrafish | *Danio rerio* | Q6IQM2 | CYC_DANRE | fish |
| yeast | *Saccharomyces cerevisiae* | P00044 | CYC1_YEAST | fungus |

Notes:

- For *Xenopus*, `Q640U4` (cytochrome c, somatic) was chosen over
  `Q6PBF4` (testis-specific) so every sequence is the somatic isoform.
- For yeast, `P00044` is isoform 1 (CYC1), the canonical cytochrome c.
- Sequences were used whole (mature form); no residues were edited.

## Alignment

- Command: `mafft --auto all.fasta > aligned.fasta`
- MAFFT version: **v7.525 (2024/Mar/13)** (conda package `bioconda::mafft`)
- Result: 110 aligned columns; the only gaps are 5 leading positions in the
  seven animal sequences (yeast carries a short N-terminal extension) and one
  trailing gap in zebrafish and yeast.
- The FASTA embedded in the lesson reorders MAFFT's output rows for display;
  the aligned columns are untouched.

## Reference tree (kind: classification)

```newick
((zebrafish:1,yeast:1):1,frog:1,(chicken:1,(cow:1,(mouse:1,(human:1,macaque:1):1):1):1):1);
```

Unrooted accepted grouping (unit branch lengths — the display is
topological only):

- primates: (human, macaque)
- Euarchontoglires: (primates, rodent) = (human, macaque, mouse), sister to
  laurasiatherian cow within mammals
- amniotes: mammals + chicken, sister to amphibian frog
- vertebrates: tetrapods + zebrafish, yeast is the outgroup
  (the unrooted cherry `(zebrafish,yeast)` encodes the deepest split —
  outgroups vs tetrapods — not a fish/fungus clade)

Source for the classification: standard textbook vertebrate phylogeny as
encoded by the NCBI Taxonomy database (ncbi.nlm.nih.gov/taxonomy).

## Behavior the lesson asserts

- `engine.loadExercise` accepts the file; NJ on JTT joins
  human+macaque first (d = 0.010, the matrix minimum).
- The NJ/JTT tree recovers the primates but differs from the classification
  in **4 clades** (RF = 8/10): inferred cherries are (frog,zebrafish),
  (cow,mouse) and (yeast,(human,macaque)); the closing note discusses this
  agreement/disagreement explicitly.
- NJ join 5 is a tie under JTT, so no predict prompt targets it
  (predicts are only at join 1).

## License

UniProtKB is distributed under CC BY 4.0
(uniprot.org/help/license); the attribution text is in the lesson's first
prompt and `source` block.
