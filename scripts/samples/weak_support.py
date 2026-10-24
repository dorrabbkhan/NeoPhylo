#!/usr/bin/env python3
"""Regenerate web/public/samples/weak-support.fasta deterministically.

6 taxa A-F, 120 sites, seed 5. The sequences are evolved along a fixed
tree whose internal branches carry almost no signal against long
pendant branches, so a seeded bootstrap run leaves at least one
grouping under 50% — the weak-support display the sample exists to
show. Usage:

    python3 scripts/samples/weak_support.py

writes web/public/samples/weak-support.fasta, byte-identical every
run. Standard library only.
"""

import math
import os
import random

SEED = 5
SITES = 120
BASES = "ACGT"

# The true tree as (parent, branch_length, label) rows in preorder:
# cherries (A,B) and (E,F) plus lone C and D around a near-polytomous
# centre. Pendant edges at 0.18 expected substitutions scatter noise
# across the competing resolutions while the internal edges at 0.005
# contribute almost no real signal — that is the weak support.
TREE = [
    (None, 0.0, None),      # 0: root
    (0, 0.005, None),       # 1: (A,B) internal
    (1, 0.18, "A"),         # 2
    (1, 0.18, "B"),         # 3
    (0, 0.005, None),       # 4: (C,(D,(E,F))) internal
    (4, 0.18, "C"),         # 5
    (4, 0.005, None),       # 6: (D,(E,F)) internal
    (6, 0.18, "D"),         # 7
    (6, 0.18, None),        # 8: (E,F) internal
    (8, 0.18, "E"),         # 9
    (8, 0.18, "F"),         # 10
]

OUT = os.path.normpath(
    os.path.join(
        os.path.dirname(__file__),
        "..", "..", "web", "public", "samples", "weak-support.fasta",
    )
)


def mutate(seq, length, rng):
    """JC69: per-site probability of ending on a different base."""
    p_change = 0.75 * (1.0 - math.exp(-4.0 * length / 3.0))
    return "".join(
        c if rng.random() > p_change else rng.choice(BASES) for c in seq
    )


def main():
    rng = random.Random(SEED)
    seqs = {0: "".join(rng.choice(BASES) for _ in range(SITES))}
    leaves = []
    for i, (parent, length, label) in enumerate(TREE):
        if parent is None:
            continue
        seqs[i] = mutate(seqs[parent], length, rng)
        if label is not None:
            leaves.append((i, label))
    with open(OUT, "w") as f:
        for i, label in leaves:
            f.write(">%s\n%s\n" % (label, seqs[i]))
    print("wrote", OUT)


if __name__ == "__main__":
    main()
