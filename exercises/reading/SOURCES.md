# Sources for the built-in reading sets

Every tree in `exercises/reading/*.json` (except the dev-only
`trees-demo`, an abstract showcase) lists its provenance here: the
source the topology follows, the date it was recorded and every
simplification — taxa dropped, polytomies drawn unresolved and common
names standing in for binomials.

**Recorded 2026-11-20.** The agent had no network access, so no live
query of the Open Tree of Life synthetic tree (OpenTreeOfLife,
opentreeoflife.org; CC0) was possible. Every topology below is the
textbook-settled consensus the OTL synthesis also shows; each entry
names the synthesis and/or a peer-reviewed source. **All citations
need the owner's phylogeneticist check** before release (no DOIs or
page numbers are given on purpose — only authors, year, title and
journal).

All trees are drawn as cladograms (branch lengths ignored). Every
tree's `times` axis is schematic — direction of time only, no numeric
ages — so no age citation is needed. Common names ("human", "guinea
pig") stand in for binomials (Homo sapiens, Cavia porcellus) as a
simplification for intro students.

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
  Currents Tree of Life*.
- **Simplifications:** only seven of the tens of thousands of OTL
  vertebrate tips are kept; every other lineage is dropped; common
  names are used for binomials.
- `vertebrates-lettered` is the same tree plus display letters R, T,
  A, C and P on internal nodes, and carries the same source.

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
  ape genetic diversity and population history", *Nature*.
- **Simplifications:** five ape genera only (all other hominoids and
  outgroups dropped); common names used; `apes-c` is an intentional
  distractor, not a claimed topology.

## trees-closest-relatives

### `carnivores`

`((lion,tiger),(wolf,fox));`

- **Topology:** Felidae (lion + tiger, both Panthera) versus Canidae
  (wolf + fox) — the feliform/caniform split of Carnivora.
- **Source:** the Open Tree of Life synthetic tree (CC0).
- **Simplifications:** four genera only; common names.

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
  unresolved trichotomy see Fabre P.-H., Hautier L., Dimitrov D.,
  Douzery E. J. P. 2012, "A glimpse on the pattern of rodent
  diversification: a phylogenetic approach", *BMC Evolutionary
  Biology*.
- **Simplifications:** one genus per lineage; the polytomy is real
  (the literature genuinely does not resolve the order), not a
  dropped-resolution artefact; common names.

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
- **Trait marks** are textbook teaching states, not a published
  character matrix: amniotic egg gains on the amniote stem
  (monophyletic); limbs gain on the tetrapod stem and are lost on the
  snake branch (paraphyletic group); endothermy gains independently on
  the mammal stem and the chicken branch (polyphyletic group); hair
  gains on the human + mouse clade. The "limb loss in snakes"
  simplification follows standard textbook usage (snakes descend from
  limbed squamate ancestors).
