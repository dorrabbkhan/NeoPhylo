#!/usr/bin/env python3
"""Generate the protein test alignments in fixtures/inputs/protein/.

For each (taxa, sites) size, sequences are evolved down a random binary
tree with branch lengths drawn uniformly from [0.05, 0.4]. The model is
equal-rate replacement among the 20 standard amino acids: per site per
branch, substitution events arrive as Poisson(branch length) and each
event resamples the residue uniformly over all 20 states (an event may
re-pick the current state). The generator only needs plausible data —
the parity oracles are PHYLIP and phangorn, not this script.

Deterministic: numpy's PCG64 bit generator seeded with 2026. Re-running
produces byte-identical FASTA files.

Usage: python3 fixtures/make_protein_inputs.py   (from anywhere)
Requires: python3 + numpy.
"""

from pathlib import Path

import numpy as np

SEED = 2026
AA = "ARNDCQEGHILKMFPSTWYV"          # protein state order, spec §1
SIZES = [(6, 150), (8, 250), (10, 400), (12, 100)]
BRANCH_LO, BRANCH_HI = 0.05, 0.4

OUTDIR = Path(__file__).resolve().parent / "inputs" / "protein"


def random_tree(rng, n):
    """Random rooted binary tree over n leaves.

    Returns (nodes, root): nodes[i] is None for leaves, else the tuple
    (child1, bl1, child2, bl2). Built by repeatedly merging two random
    active nodes; every new edge gets a uniform [0.05, 0.4] length.
    """
    nodes = [None] * n               # leaves are nodes 0..n-1
    active = list(range(n))
    while len(active) > 1:
        i, j = rng.choice(len(active), size=2, replace=False)
        a, b = active[i], active[j]
        bl_a, bl_b = rng.uniform(BRANCH_LO, BRANCH_HI, size=2)
        nodes.append((a, bl_a, b, bl_b))
        for k in sorted((int(i), int(j)), reverse=True):
            active.pop(k)
        active.append(len(nodes) - 1)
    return nodes, active[0]


def mutate(rng, seq, bl):
    """Evolve seq down one branch of length bl (equal-rate replacement)."""
    out = seq.copy()
    for s in range(seq.shape[0]):
        # Only whether >=1 event occurred matters: each event resamples
        # uniformly over all 20 states, so the post-event state is
        # uniform regardless of the count.
        if rng.poisson(bl) >= 1:
            out[s] = rng.integers(0, len(AA))
    return out


def make_alignment(rng, taxa, sites):
    nodes, root = random_tree(rng, taxa)
    seqs = [None] * taxa

    def evolve(node, seq):
        children = nodes[node]
        if children is None:
            seqs[node] = "".join(AA[c] for c in seq)
            return
        a, bl_a, b, bl_b = children
        evolve(a, mutate(rng, seq, bl_a))
        evolve(b, mutate(rng, seq, bl_b))

    evolve(root, rng.integers(0, len(AA), size=sites))
    return [f"P{i + 1:02d}" for i in range(taxa)], seqs


def main():
    rng = np.random.default_rng(SEED)
    OUTDIR.mkdir(parents=True, exist_ok=True)
    for taxa, sites in SIZES:
        labels, seqs = make_alignment(rng, taxa, sites)
        path = OUTDIR / f"p{taxa}_{sites}.fasta"
        with path.open("w") as fh:
            for label, seq in zip(labels, seqs):
                fh.write(f">{label}\n{seq}\n")
        print(f"{path}: {taxa} taxa x {sites} sites")


if __name__ == "__main__":
    main()
