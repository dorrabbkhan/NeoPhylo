// R script export (plan Task 24, spec §6.6, §8.6). Produces a runnable
// script that reproduces the current analysis in R: the alignment is
// embedded as a FASTA string, distances come from ape::dist.dna and the
// tree from ape::nj or phangorn::upgma. CI (scripts/r-parity.mjs) runs
// the script and checks the result matches the engine's.

import type { Alignment } from "../engine/generated/Alignment";
import type { DistModel } from "../engine/generated/DistModel";
import type { Method } from "../engine/generated/Method";

const APE_MODEL: Record<Extract<DistModel, "P" | "Jc69" | "K80">, string> = {
  P: "raw",
  Jc69: "JC69",
  K80: "K80",
};

/** Escape a string for embedding in a double-quoted R string literal. */
export function escapeR(s: string): string {
  return s
    .replaceAll("\\", "\\\\")
    .replaceAll('"', '\\"')
    .replaceAll("\n", "\\n")
    .replaceAll("\r", "\\r")
    .replaceAll("\t", "\\t");
}

/** Alignment as multi-line FASTA text (labels + ACGT- sequences). */
function toFasta(aln: Alignment): string {
  const lines: string[] = [];
  aln.labels.forEach((label, i) => {
    lines.push(`>${label}`);
    lines.push(String.fromCharCode(...aln.seqs[i]));
  });
  return lines.join("\n");
}

/**
 * The equivalent analysis as an R script. `write.tree` prints the
 * Newick tree on stdout, which is what the parity job compares.
 */
export function exportR(
  alignment: Alignment,
  correction: DistModel,
  method: Method,
): string {
  const model = APE_MODEL[correction as keyof typeof APE_MODEL];
  if (model === undefined) {
    // Protein corrections have no ape::dist.dna equivalent; the UI can't
    // reach this until the protein workflow lands (v1.1 plan Task 7+).
    throw new Error(`R export not yet supported for correction ${correction}`);
  }
  const fasta = escapeR(toFasta(alignment));
  const build = method === "Upgma" ? "phangorn::upgma(d)" : "ape::nj(d)";
  return `# NeoPhylo export — reproduce this analysis in R (ape / phangorn)
fa <- "${fasta}"
aln <- ape::read.dna(textConnection(fa), format = "fasta")
d <- ape::dist.dna(aln, model = "${model}", pairwise.deletion = TRUE)
tree <- ${build}
ape::write.tree(tree)
`;
}
