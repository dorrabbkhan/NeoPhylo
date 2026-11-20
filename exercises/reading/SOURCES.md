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
| cheetah | *Acinonyx jubatus* |
| puma | *Puma concolor* |
| leopard | *Panthera pardus* |
| jaguar | *Panthera onca* |
| moss | *Physcomitrium patens* |
| fern | *Pteridium aquilinum* |
| pine | *Pinus sylvestris* |
| oak | *Quercus robur* |
| cactus | *Carnegiea gigantea* |
| camel | *Camelus dromedarius* |
| pig | *Sus scrofa* |
| hippo | *Hippopotamus amphibius* |
| ostrich | *Struthio camelus* |
| duck | *Anas platyrhynchos* |
| albatross | *Diomedea exulans* |
| opossum | *Didelphis virginiana* |
| quoll | *Dasyurus viverrinus* |
| kangaroo | *Macropus rufus* |
| koala | *Phascolarctos cinereus* |
| wombat | *Vombatus ursinus* |
| rice | *Oryza sativa* |
| wheat | *Triticum aestivum* |
| corn | *Zea mays* |
| earthworm | *Lumbricus terrestris* |
| sparrow | *Passer domesticus* |
| cow | *Bos taurus* |
| whale | *Megaptera novaeangliae* |
| basilosaurus | *Basilosaurus isis* |
| blue whale | *Balaenoptera musculus* |
| lemur | *Lemur catta* |
| galago | *Otolemur garnettii* |
| tarsier | *Carlito syrichta* |
| marmoset | *Callithrix jacchus* |
| aotus | *Aotus azarae* |
| macaque | *Macaca mulatta* |
| baboon | *Papio anubis* |

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

## trees-form-a

Recorded 2026-11-20. The new topologies below were checked against
the Open Tree of Life synthetic tree `opentree16.1` on 2026-11-20
(`tnrs/match_names`, with approximate matching only where noted,
then `tree_of_life/induced_subtree`; each rooted clade set compared
with the induced subtree pruned to the queried taxa).

### `cats`, `cats-rot`, `cats-diff`, `cats-lettered`

`((cheetah,puma),(lion,tiger,leopard,jaguar));`

- **Topology:** the felid backbone — the *Acinonyx* + *Puma* lineage
  (Acinonychinae) sister to *Panthera*. The four *Panthera* species
  are drawn as an honest polytomy.
- **Source:** the Open Tree of Life synthetic tree (CC0).
- **Simplifications:** six species only; the *Panthera* radiation is
  drawn unresolved (the synthesis resolves it; the polytomy is a
  deliberate simplification, not a claim); common names.
- `cats-rot` is the same topology with rotated child orders;
  `cats-lettered` is the same topology plus display letters;
  `cats-diff` resolves a different pairing inside *Panthera* and is
  the intentional distractor (not checked).
- OTL check (opentree16.1, 2026-11-20): no conflict; the synthesis
  resolves the *Panthera* split drawn here as a polytomy.

### `plants`

`(moss,(fern,(pine,(oak,cactus))));`

- **Topology:** bryophyte (moss) sister to the vascular plants;
  ferns sister to seed plants; gymnosperm (pine) sister to the
  angiosperms (oak + cactus, both eudicots/angiosperms) — settled.
- **Source:** the Open Tree of Life synthetic tree (CC0).
- **Simplifications:** five species only; common names. The moss
  common name stands for *Physcomitrium patens*; OTL matches it via
  its synonym *Physcomitrella patens*.
- OTL check (opentree16.1, 2026-11-20): exact match (moss matched
  approximately via *Physcomitrella patens*, ott 821359).

### `whales`

`(shark,(frog,(camel,(pig,(hippo,dolphin)))));`

- **Topology:** the cetartiodactyl chain — hippo sister to dolphin
  (Whippomorpha/Cetancodonta), pig next, then camel, inside
  tetrapods with frog and shark as successive outgroups — settled.
- **Source:** the Open Tree of Life synthetic tree (CC0); the
  hippo–whale relationship also follows Gatesy J., Hayashi C.,
  Cronin M. A., Arctander P. 1996, "Evidence from milk casein genes
  that cetaceans are close relatives of hippopotamid artiodactyls",
  *Molecular Biology and Evolution* 13:954–963, doi:10.1093/
  oxfordjournals.molbev.a025663.
- **Simplifications:** six species only; common names.
- OTL check (opentree16.1, 2026-11-20): exact match.

## trees-form-b

Recorded and checked as for `trees-form-a` (2026-11-20,
`opentree16.1`).

### `birds`, `birds-rot`, `birds-diff`, `birds-lettered`

`(lizard,(ostrich,((chicken,duck),(penguin,albatross))));`

- **Topology:** lizard (lepidosaur) as outgroup to birds; ostrich
  (paleognath) sister to the neognaths; within neognaths chicken +
  duck (Galloanserae) versus penguin + albatross (both waterbird
  clade Aequornithes/Neoaves) — the early splits are settled, the
  deep neoavian pairing is a simplification (Neoaves resolution is
  still researched).
- **Source:** the Open Tree of Life synthetic tree (CC0).
- **Simplifications:** six species only; the penguin + albatross
  pairing follows the synthesis (both core waterbirds); common names.
- `birds-rot` is the same topology rotated; `birds-lettered` adds
  display letters; `birds-diff` pairs chicken with penguin and is
  the intentional distractor (not checked).
- OTL check (opentree16.1, 2026-11-20): no conflict.

### `marsupials`

`(opossum,(quoll,(kangaroo,(koala,wombat))));`

- **Topology:** didelphid (opossum) sister to the other sampled
  marsupials; dasyurid (quoll) next; diprotodontians (kangaroo,
  koala, wombat) together with koala + wombat (Vombatiformes)
  sister — settled.
- **Source:** the Open Tree of Life synthetic tree (CC0).
- **Simplifications:** five species only; common names.
- OTL check (opentree16.1, 2026-11-20): exact match.

### `grasses`

`(oak,(rice,wheat,corn));`

- **Topology:** oak (eudicot outgroup) sister to the three grasses
  (Poaceae). The rice (BEP clade), wheat (BEP) and corn (PACMAD)
  split is drawn as a polytomy — a simplification; the synthesis
  resolves rice + wheat (both BEP).
- **Source:** the Open Tree of Life synthetic tree (CC0).
- **Simplifications:** four species only; the grass trichotomy is
  drawn unresolved for teaching (the item only asks which tip is
  sister to the clade / outside it); common names.
- OTL check (opentree16.1, 2026-11-20): no conflict; the synthesis
  resolves rice + wheat, drawn here as a polytomy.

## coverage/

Recorded and checked as for `trees-form-a` (2026-11-20,
`opentree16.1`). Abstract lettered trees (`st-a`, `st-b`, `st-c`,
`letters8`, `ref8`, `small-1`, `small-2`, `cand-ok`, `cand-bad`,
`conf-c`, `beasties`) are teaching constructs — the same convention
as `trees-demo`; they carry letters, not taxa, and need no source.
`cand-bad`, `st-c` and `conf-c` are intentional distractors.
`rodents` is the same tree and source as in
`trees-closest-relatives` above.

### `mammals6` (cov-relatedness)

`(earthworm,(frog,((lizard,sparrow),(cow,whale))));`

- **Topology:** annelid outgroup; frog (amphibian) sister to
  amniotes; sauropsids (lizard + sparrow) sister to mammals
  (cow + whale) — settled.
- **Source:** the Open Tree of Life synthetic tree (CC0).
- **Simplifications:** six species only; common names.
- OTL check (opentree16.1, 2026-11-20): exact match.

### `primates`, `primates-rot`, `primates-diff` (cov-styles)

`((lemur,galago),(tarsier,((marmoset,aotus),((macaque,baboon),(gibbon,(orangutan,(gorilla,(human,chimp))))))));`

- **Topology:** strepsirrhines (lemur + galago) sister to
  haplorhines; tarsier sister to anthropoids; platyrrhines
  (marmoset + aotus) sister to catarrhines; cercopithecoids
  (macaque + baboon) sister to hominoids; gibbon, orangutan,
  gorilla, human + chimp successively — settled.
- **Source:** the Open Tree of Life synthetic tree (CC0).
- **Simplifications:** twelve species only; common names.
- `primates-rot` is the same topology rotated (the circular-style
  comparison tree); `primates-diff` resolves (human,gorilla)+chimp
  and is the intentional distractor (not checked).
- OTL check (opentree16.1, 2026-11-20): exact match.

### `cetartiodactyls` (cov-statements)

`(cow,(hippo,(basilosaurus,('blue whale',dolphin))));`

- **Topology:** the whale backbone with the fossil *Basilosaurus*
  on the cetacean stem: cow sister to hippo + whales; basilosaurus
  sister to crown whales (blue whale + dolphin) — settled for the
  extant taxa; basilosaurus as a stem cetacean follows the cited
  fossil literature.
- **Source:** the Open Tree of Life synthetic tree (CC0) for the
  extant taxa; the basilosaurus placement follows Uhen M. D. 1998,
  "Middle to late Eocene basilosaurines and dorudontines", in
  Thewissen J. G. M. (ed.) *The Emergence of Whales*, Plenum,
  pp. 29–61, doi:10.1007/978-1-4899-0159-0_2.
- **Simplifications:** five species only; *Basilosaurus* is a fossil
  tip drawn as a sampled stem lineage; common names.
- OTL check (opentree16.1, 2026-11-20): exact match for the extant
  taxa; *Basilosaurus isis* is pruned from the synthesis (fossil),
  so its placement is sourced to the literature.
