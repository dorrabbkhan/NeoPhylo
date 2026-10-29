# v1.4b Task 13 notes (conductor)

- Handout 1 dataset is not MEGA's example file (follows PR #124, the data library): `primate-mtdna`
  is the D-loop/control region (7 taxa, 1,138 aligned sites) of the same Horai (1995) hominoid
  accessions MEGA's `mtCDNA.meg` uses, not that file's whole ~16.5 kb mtDNA alignment (over the
  2,000-site cap). The handout text must not say or imply that the student will get the same numbers
  by opening MEGA's own `mtCDNA` example. It may say the taxa come from the same public records. The
  cross-check route is: export the dataset from NeoPhylo as `.meg`, open that file in MEGA, and use
  the cited settings; those are the numbers Task 9's fixtures pin (MEGA-CC on the library dataset and
  on the exported `.meg`). Name the region ("mitochondrial control region (D-loop)") where the dataset
  is introduced. Review: grep each handout for `mtCDNA` and "example" and check every mention against
  this rule.
- Likewise for `sars-cov-2-spike` if a handout uses it: it is the spike receptor-binding domain
  (S residues 319–541), not the whole spike gene.
- Handout 2 (globins, NJ vs UPGMA): the UPGMA tree has exact ties among Human_HBA,
  Horse_HBA and Cow_HBA — a 3-way tie at 17/142 under pairwise deletion, a 2-way tie at
  16/138 under complete/partial95 (`fixtures/worked/mega-notes.md` "Ties in globins").
  NeoPhylo and MEGA may join a different pair there and both trees are valid UPGMA trees;
  the handout must not claim the UPGMA trees are identical. Where it says the trees match,
  it explains the tie, and its test uses the tie-aware comparison from
  `parity_mega_library.rs`. The same applies to support for `Chimp_HBB|Human_HBB`
  (identical sequences over the kept sites) if a handout mentions it.
