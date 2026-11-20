# Sources for the built-in reading sets

Every tree in `exercises/reading/*.json` (except the dev-only
`trees-demo`, an abstract showcase) lists its provenance here: the
source the topology follows, the date it was recorded and every
simplification — taxa dropped, polytomies drawn unresolved and common
names standing in for binomials.

**Recorded 2026-11-20.** Bibliographic records (authors, year,
title, journal, DOI) were checked against publisher and PubMed
records on 2026-11-20. The topologies were checked against the Open
Tree of Life synthetic tree `opentree16.1` (synthesis of
2025-12-20) on 2026-11-20 through its public API —
`tnrs/match_names` without approximate matching for the species in
the table below, then `tree_of_life/induced_subtree` — comparing
each lesson tree's rooted clade set with the induced synthetic
subtree. The result is noted per tree below: exact match
everywhere except `rodents` (no conflict; the synthesis resolves
one split the lesson deliberately draws as a polytomy). `apes-c`,
the intentional distractor, was not checked.

All trees are drawn as cladograms (branch lengths ignored). Every
tree's `times` axis is schematic — direction of time only, no numeric
ages — so no age citation is needed. Common names stand in for
binomials as a simplification for intro students; in the lessons
each common name stands for its whole genus or family as drawn,
which does not change any relationship on these trees. The
binomials used for the OTL check:

| Common name | Binomial |
| --- | --- |
| shark | *Carcharodon carcharias* |
| salmon | *Salmo salar* |
| frog | *Rana temporaria* |
| cat | *Felis catus* |
| dog | *Canis lupus* |
| human | *Homo sapiens* |
| chimp | *Pan troglodytes* |
| gorilla | *Gorilla gorilla* |
| orangutan | *Pongo abelii* |
| gibbon | *Hylobates lar* |
| lion | *Panthera leo* |
| tiger | *Panthera tigris* |
| wolf | *Canis lupus* |
| fox | *Vulpes vulpes* |
| rabbit | *Oryctolagus cuniculus* |
| mouse | *Mus musculus* |
| rat | *Rattus norvegicus* |
| squirrel | *Sciurus vulgaris* |
| guinea pig | *Cavia porcellus* |
| penguin | *Aptenodytes forsteri* |
| chicken | *Gallus gallus* |
| dolphin | *Tursiops truncatus* |
| lizard | *Lacerta agilis* |
| snake | *Python bivittatus* |

## trees-reading-a-tree

### `vertebrates`, `vertebrates-lettered`

`(shark,(salmon,(frog,((cat,dog),(human,chimp)))));`

- **Topology:** standard vertebrate phylogeny — cartilaginous fishes
  (Chondrichthyes) sister to bony vertebrates (Osteichthyes);
  ray-finned fishes (Actinopterygii) sister to lobe-fins plus
  tetrapods; amphibians sister to amniotes; Carnivora and Primates
  both placental mammals.
- **Source:** the Open Tree of Life synthetic tree (CC0); the
  fish–tetrapod backbone also follows Betancur-R. R., Broughton R. E.,
  Wiley E. O., Carpenter K., López J. A., Li C., et al. 2013, "The
  tree of life and a new classification of bony fishes", *PLOS
  Currents Tree of Life* 5,
  doi:10.1371/currents.tol.53ba26640df0ccaee75bb165c8c26288.
- **Simplifications:** only seven of the tens of thousands of OTL
  vertebrate tips are kept; every other lineage is dropped; common
  names are used for binomials.
- `vertebrates-lettered` is the same tree plus display letters R, T,
  A, C and P on internal nodes, and carries the same source.
- OTL check (opentree16.1, 2026-11-20): exact match.

## trees-rotation

### `apes-a`, `apes-b`, `apes-c`

- **Topology:** hominoid ladder — gibbon (Hylobatidae) sister to the
  great apes; orangutan (Pongo) next; gorilla; human + chimpanzee
  sister (Hominini). `apes-a` and `apes-b` are the same topology
  written with different child orders; `apes-c` deliberately resolves
  human + gorilla instead, the classic wrong answer, so exactly one
  tree differs.
- **Source:** the Open Tree of Life synthetic tree (CC0); the
  human–chimpanzee sister relationship also follows Prado-Martinez J.,
  Sudmant P. H., Kidd J. M., Li H., Kelley J. L., et al. 2013, "Great
  ape genetic diversity and population history", *Nature* 499:471–475,
  doi:10.1038/nature12228.
- **Simplifications:** five ape genera only (all other hominoids and
  outgroups dropped); common names used; `apes-c` is an intentional
  distractor, not a claimed topology.
- OTL check (opentree16.1, 2026-11-20): exact match for `apes-a` and
  `apes-b` (same topology); `apes-c` is the intentional distractor
  and was not checked.

## trees-closest-relatives

### `carnivores`

`((lion,tiger),(wolf,fox));`

- **Topology:** Felidae (lion + tiger, both Panthera) versus Canidae
  (wolf + fox) — the feliform/caniform split of Carnivora.
- **Source:** the Open Tree of Life synthetic tree (CC0).
- **Simplifications:** four genera only; common names.
- OTL check (opentree16.1, 2026-11-20): exact match.

### `rodents`

`(cat,(rabbit,((mouse,rat),squirrel,'guinea pig')));`

- **Topology:** Lagomorpha (rabbit) sister to Rodentia (together,
  Glires), cat (a laurasiathere) as the outgroup — settled. **Inside
  the rodents the three-way split between the mouse lineage
  (Myomorpha), squirrel lineage (Sciuromorpha) and guinea-pig lineage
  (Hystricomorpha/Ctenohystrica) is drawn as an honest polytomy**:
  the "rodent trichotomy" is famously unresolved, so the tree takes no
  position on it. Mouse + rat resolve because both are murids.
- **Source:** the Open Tree of Life synthetic tree (CC0); for the
  unresolved trichotomy see Blanga-Kanfi S., Miranda H., Penn O.,
  Pupko T., DeBry R. W., Huchon D. 2009, "Rodent phylogeny revised:
  analysis of six nuclear genes from all major rodent clades", *BMC
  Evolutionary Biology* 9:71, doi:10.1186/1471-2148-9-71 (the three
  major clades are well supported; their basal relationships are
  unresolved).
- **Simplifications:** one genus per lineage; the polytomy is real
  (the literature genuinely does not resolve the order), not a
  dropped-resolution artefact; common names.
- OTL check (opentree16.1, 2026-11-20): no conflict; the synthesis
  resolves mouse + rat with guinea pig, drawn here as an unresolved
  polytomy (see source above).

### `ocean`

`(shark,(salmon,((penguin,chicken),dolphin)));`

- **Topology:** the same vertebrate backbone as `vertebrates` —
  chondrichthyan, ray-finned fish, then amniotes: birds (penguin +
  chicken, both neognaths) versus a placental mammal (dolphin).
  Dolphin is therefore closer to penguin than to any fish — the
  resemblance distractor.
- **Source:** the Open Tree of Life synthetic tree (CC0); the
  fish–tetrapod backbone follows Betancur-R. R. et al. 2013 (full
  citation above).
- **Simplifications:** five genera only; common names.
- OTL check (opentree16.1, 2026-11-20): exact match.

## trees-clades-traits

### `amniotes`, `amniotes-traits`

`(shark,(frog,((human,mouse),(chicken,(lizard,snake)))));`

`amniotes-traits` is the same topology carrying the trait marks
below; `amniotes` is the bare tree for the items that do not ask
about marks.

- **Topology:** amphibian (frog) sister to amniotes; mammals
  (human + mouse) sister to sauropsids; within sauropsids, chicken
  (archosaur) versus squamates (lizard + snake, Lepidosauria) —
  settled. Shark is the outgroup.
- **Source:** the Open Tree of Life synthetic tree (CC0).
- **Simplifications:** seven genera only; common names.
- OTL check (opentree16.1, 2026-11-20): exact match.
- **Trait marks** are textbook teaching states, not a published
  character matrix: the amnion gains on the amniote stem
  (monophyletic); limbs gain on the tetrapod stem and are lost on the
  snake branch (paraphyletic group); endothermy gains independently on
  the mammal stem and the chicken branch (polyphyletic group); hair
  gains on the human + mouse clade. The "limb loss in snakes"
  simplification follows standard textbook usage (snakes descend from
  limbed squamate ancestors).
