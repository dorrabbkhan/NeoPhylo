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
