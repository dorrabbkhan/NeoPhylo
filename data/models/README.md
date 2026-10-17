# Substitution model source data

## `jtt.dat` — JTT (Jones, Taylor & Thornton 1992)

Byte-for-byte copy of `dat/jones.dat` from the PAML repository. The file
carries a 20×20 lower-triangular exchangeability matrix S (integer counts)
followed by 20 equilibrium frequencies π, both in amino-acid order
`ARNDCQEGHILKMFPSTWYV`; everything after the line
`// this is the end of the file` is PAML's own commentary (alternate
presentations of the same data), kept verbatim and ignored by
`scripts/gen_models.py`.

- Source URL: https://github.com/abacus-gene/paml/blob/master/dat/jones.dat
- Retrieved: 2026-10-17
- Upstream commit (last change to the file): `368238eeb467396c09dea301774f00c816a9d26f`
- SHA-256: `f7df96390900e22ee1a3b7d63bec10c227eca8ee5ca5a50b6d1978c7d2c74725`

The file itself contains no license grant. Its notice reads (verbatim):

> S_ij = S_ji and PI_i for the Jones model based on the SWISSPROT
> Version 22 data.
> Rate Q_ij=S_ij\*PI_j.
> The rest of the file is not used.
> Prepared by Z. Yang, March 1995.
>
> See the following reference for notation:
>
> Yang, Z., R. Nielsen and M. Hasegawa. 1998. Models of amino acid substitution and
> applications to mitochondrial protein evolution. Mol. Biol. Evol. 15:1600-1611.

The underlying data is the published Jones, Taylor & Thornton (1992)
empirical amino-acid replacement counts (CABIOS 8:275–282), which is
reference data, not PHYLIP or PAML code.

**License:** taken from the PAML repository at the commit above, which is licensed GPL-3.0
(older PAML releases were non-commercial; this copy is from the GPL-3.0 era). GPL-3.0 is compatible
with NeoPhylo's AGPL-3.0-only; owner confirmed (v1.1 Task 5). Note: GPL-3.0 material cannot be
included in a proprietary dual-licensed edition. Replace this source before any such licensing. — PAML itself is GPL-licensed; the constants we ship are derived from this published data file via `scripts/gen_models.py`, not copied from PHYLIP/PAML source.
