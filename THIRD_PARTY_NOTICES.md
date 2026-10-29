# Third-party notices

NeoPhylo is AGPL-3.0-only (see `LICENSE`). This file lists third-party
materials redistributed in this repository under their own licenses.

## PHYLIP — JTT spectral decomposition data

`data/models/jtt.dat` and the generated
`crates/neophylo-core/src/model/jtt_constants.rs` contain the JTT
spectral decomposition (the `jtteigs` and `jttprobs` arrays) transcribed
verbatim from `protdist.c` in PHYLIP 3.697 — numerical reference data
describing the Jones, Taylor & Thornton 1992 empirical amino-acid
replacement matrix (decomposition due to Elisabeth Tillier). PHYLIP
3.696 and later are distributed under the BSD-2-Clause license
(upstream: https://phylipweb.github.io/phylip/); the upstream copyright
notice and license text follow.

`fixtures/worked/protdist_doc_jtt.json` additionally reproduces the test
data set and published JTT distance matrix from PHYLIP's `protdist`
documentation, used as a reference fixture.

> Copyright (c) 1980-2014, Joseph Felsenstein
> All rights reserved.
>
> Redistribution and use in source and binary forms, with or without
> modification, are permitted provided that the following conditions are
> met:
>
> 1. Redistributions of source code must retain the above copyright
>    notice, this list of conditions and the following disclaimer.
>
> 2. Redistributions in binary form must reproduce the above copyright
>    notice, this list of conditions and the following disclaimer in the
>    documentation and/or other materials provided with the distribution.
>
> THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS
> "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT
> LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR
> A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT
> HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL,
> SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT
> LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE,
> DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER CAUSED AND ON ANY
> THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT
> (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
> OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.

## UniProtKB — cytochrome c sequences

`exercises/cytochrome-c.json` embeds eight cytochrome c sequences from
UniProtKB/Swiss-Prot (accessions P99999, P00004, P67881, Q6IQM2, P84029,
P00068, P00044, P00048), aligned with MAFFT (see
`docs/lessons/cytochrome-c-provenance.md`). UniProtKB is licensed under
Creative Commons Attribution 4.0 International (CC BY 4.0):
https://creativecommons.org/licenses/by/4.0/

Source: The UniProt Consortium, UniProt: the Universal Protein
Knowledgebase, https://www.uniprot.org (retrieved 2026-10-18).
Changes: sequences were aligned (gaps added); residues are unmodified.

## Library datasets — `web/public/library/`

The bundled datasets are rebuilt from public accessions by
`scripts/data/build_library.py` (accession lists and selection reasons in
`scripts/data/accessions/`); per-dataset accessions, citations and the
retrieval date are in `web/public/library/<id>.json`.

- **globins** and **cytochrome-c** (`globins.fasta`,
  `cytochrome-c.fasta`): reviewed UniProtKB/Swiss-Prot sequences,
  licensed CC BY 4.0: https://creativecommons.org/licenses/by/4.0/
  Source: The UniProt Consortium, UniProt: the Universal Protein
  Knowledgebase, https://www.uniprot.org (retrieved 2026-10-29).
  Changes: sequences were aligned with MAFFT (gaps added); residues are
  unmodified.
- **primate-mtdna** (`primate-mtdna.fasta`): D-loop slices of the
  Horai et al. (1995) hominoid mitochondrial genomes, NCBI Nucleotide
  (GenBank). Per the NCBI data policy
  (https://www.ncbi.nlm.nih.gov/home/about/policies/): "NCBI itself
  places no restrictions on the use or distribution of the data
  contained therein. Nevertheless, some submitters may claim patent,
  copyright, or other intellectual property rights in all or a portion
  of the data they have submitted."
  Changes: control-region subsequences aligned with MAFFT.
- **16s-rrna** (`16s-rrna.fasta`): NCBI RefSeq (NR_) 16S ribosomal RNA
  records; same NCBI data policy as above.
  Changes: sequences aligned with MAFFT.
- **sars-cov-2-spike** (`sars-cov-2-spike.fasta`): spike
  receptor-binding-domain slices (residues 319–541 of the S CDS) of
  SARS-CoV-2 genomes, NCBI Nucleotide / NCBI Virus (GenBank); same NCBI
  data policy as above.
  Changes: subsequence slices aligned with MAFFT.

## Inter — bundled font subsets

`web/public/fonts/inter-*.woff2` are subsets of the Inter font family,
produced from the upstream Inter 4.1 release by
`scripts/fonts/subset.sh` (see `web/public/fonts/README.md` for the
source URLs and hashes). Inter is licensed under the SIL Open Font
License, Version 1.1 (OFL-1.1); the license text ships in
`web/public/fonts/README.md` and upstream at
https://github.com/rsms/inter (`LICENSE.txt` in the release archive).

> Copyright (c) 2016 The Inter Project Authors
> (https://github.com/rsms/inter)

## JetBrains Mono — bundled font subsets

`web/public/fonts/jetbrains-mono-*.woff2` are subsets of the JetBrains
Mono font family, produced from the upstream JetBrains Mono 2.304
release by `scripts/fonts/subset.sh` (see `web/public/fonts/README.md`
for the source URLs and hashes). JetBrains Mono is licensed under the
SIL Open Font License, Version 1.1 (OFL-1.1); the license text ships in
`web/public/fonts/README.md` and upstream at
https://github.com/JetBrains/JetBrainsMono (`OFL.txt` in the release
archive).

> Copyright 2020 The JetBrains Mono Project Authors
> (https://github.com/JetBrains/JetBrainsMono)
