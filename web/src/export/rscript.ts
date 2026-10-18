// R script export (plan Task 24, spec §6.6, §8.6; protein added in v1.1
// Task 13, spec §5.6). Produces a runnable script that reproduces the
// current analysis in R: the alignment is embedded as a FASTA string,
// distances come from ape::dist.dna (DNA) or ape::dist.aa /
// phangorn::dist.ml (protein), and the tree from ape::nj or
// phangorn::upgma. Protein scripts also print the distance matrix as
// text — the parity job (scripts/r-parity.mjs) compares it, since
// phangorn's JTT variant differs from protdist's by ~1–1.7% relative.
// CI (scripts/r-parity.mjs) runs the script and checks the result
// matches the engine's.

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
  if (alignment.alphabet === "protein") {
    return exportProtein(alignment, correction, method);
  }
  const model = APE_MODEL[correction as keyof typeof APE_MODEL];
  if (model === undefined) {
    // Protein corrections have no ape::dist.dna equivalent.
    throw new Error(`R export not supported for correction ${correction}`);
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

/**
 * Protein export (v1.1 spec §5.6). p and Kimura come from
 * `ape::dist.aa` (pairwise deletion, scaled = proportion); JTT is
 * `phangorn::dist.ml` — a different JTT variant than NeoPhylo's
 * (protdist's), agreeing to ~1–1.7% relative (docs/decisions.md Task 6).
 * The distance matrix is printed after the tree so the parity job can
 * compare it: engines mark unestimable cells Saturated while R writes
 * NaN/-Inf, and a 1–2% relative difference would sink a tree-level
 * check at the DNA tolerance.
 */
function exportProtein(
  alignment: Alignment,
  correction: DistModel,
  method: Method,
): string {
  let dist: string;
  switch (correction) {
    case "P":
      dist = `d <- ape::dist.aa(as.matrix(aln), pairwise.deletion = TRUE,
                  scaled = TRUE)`;
      break;
    case "Kimura":
      // Kimura (1983): d = -ln(1 - p - p²/5) from the p proportion.
      dist = `p <- as.matrix(ape::dist.aa(as.matrix(aln),
                                 pairwise.deletion = TRUE, scaled = TRUE))
d <- as.dist(-log(1 - p - 0.2*p^2))`;
      break;
    case "Jtt":
      // phangorn's JTT differs from NeoPhylo's (protdist's) variant by
      // ~1–1.7% relative across all distance bands (systematic variant
      // difference, not error; measured in docs/decisions.md Task 6).
      dist = `# phangorn's JTT is a different variant than protdist's; distances
# agree with NeoPhylo within ~2% relative (docs/decisions.md Task 6).
d <- phangorn::dist.ml(phangorn::phyDat(as.character(aln),
                                    type = "AA"), model = "JTT")`;
      break;
    default:
      throw new Error(
        `R export not supported for correction ${correction} on protein`,
      );
  }
  const fasta = escapeR(toFasta(alignment));
  const build = method === "Upgma" ? "phangorn::upgma(d)" : "ape::nj(d)";
  return `# NeoPhylo export — reproduce this analysis in R (ape / phangorn)
fa <- "${fasta}"
aln <- ape::read.FASTA(textConnection(fa), type = "AA")
${dist}
m <- as.matrix(d)
tree <- tryCatch(${build}, error = function(e) e)
# Unestimable distances (NaN) leave the tree unbuildable; the distance
# matrix below still reproduces NeoPhylo's output.
if (inherits(tree, "error")) {
  cat("# tree building failed:", conditionMessage(tree), "\n")
} else {
  ape::write.tree(tree)
}
write.table(format(m, digits = 15), file = stdout(), sep = " ",
            row.names = FALSE, col.names = FALSE, quote = FALSE)
`;
}
