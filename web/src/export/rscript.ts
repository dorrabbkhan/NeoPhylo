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

/** The bootstrap settings a finished run used (v1.2 spec §6.8):
 * replicate count and the run's seed — the exported script passes it
 * to set.seed() before its resample loop. */
export interface ExportBootstrap {
  replicates: number;
  seed: number;
}

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
 * The equivalent analysis as an R script. `cat(write.tree(tree))`
 * prints the bare Newick line on stdout, which the parity job reads.
 * With `bootstrap` the script adds an ape::boot.phylo run on the same
 * distance + method and a phangorn::plotBS support plot (v1.2 §6.8).
 */
export function exportR(
  alignment: Alignment,
  correction: DistModel,
  method: Method,
  bootstrap?: ExportBootstrap,
): string {
  if (alignment.alphabet === "protein") {
    return exportProtein(alignment, correction, method, bootstrap);
  }
  const model = APE_MODEL[correction as keyof typeof APE_MODEL];
  if (model === undefined) {
    // Protein corrections have no ape::dist.dna equivalent.
    throw new Error(`R export not supported for correction ${correction}`);
  }
  const fasta = escapeR(toFasta(alignment));
  const build = method === "Upgma" ? "phangorn::upgma(d)" : "ape::nj(d)";
  const boot =
    bootstrap === undefined
      ? ""
      : bootstrapBlock(
          "x <- aln",
          `distOf <- function(xx) ape::dist.dna(xx, model = "${model}", pairwise.deletion = TRUE)`,
          method,
          bootstrap,
        );
  return `# NeoPhylo export — reproduce this analysis in R (ape / phangorn)
fa <- "${fasta}"
aln <- ape::read.dna(textConnection(fa), format = "fasta")
d <- ape::dist.dna(aln, model = "${model}", pairwise.deletion = TRUE)
tree <- ${build}
cat(ape::write.tree(tree), "\\n")
${boot}`;
}

/**
 * The bootstrap block (v1.2 spec §6.8, checkpoint 15). The loop
 * mirrors NeoPhylo's replicate rule (spec §3.3): resample columns of
 * x with replacement, recompute the same distance, and skip the
 * replicate when any off-diagonal value is non-finite (saturated or
 * unestimable — ape::boot.phylo cannot express that rule: it aborts
 * on the first FUN error, which is how p6_150 Kimura crashed). `xLine`
 * names the data resampled; `distDef` defines distOf(xx), the same
 * distance the main analysis computes. Support is prop.clades over
 * the kept trees, printed as node-label percents — plus the boot
 * tree's Newick so the parity job can read the values back.
 */
function bootstrapBlock(
  xLine: string,
  distDef: string,
  method: Method,
  boot: ExportBootstrap,
): string {
  const build = method === "Upgma" ? "phangorn::upgma" : "ape::nj";
  return `${xLine}
${distDef}
# Bootstrap, mirroring NeoPhylo (spec §3.3): every replicate resamples
# columns of x with replacement, recomputes the same distance and
# rebuilds the tree with the same method. A replicate whose distance
# has a non-finite off-diagonal value (saturated/unestimable) is
# skipped — ape::boot.phylo cannot express that rule.
# R's random draws differ from NeoPhylo's; support values vary by a few percent.
set.seed(${boot.seed})
B <- ${boot.replicates}
trees <- vector("list", B)
kept <- 0L
skipped <- 0L
for (i in seq_len(B)) {
  xx <- x[, sample.int(ncol(x), replace = TRUE)]
  d_i <- tryCatch(distOf(xx), error = function(e) NULL)
  if (is.null(d_i)) { skipped <- skipped + 1L; next }
  m_i <- as.matrix(d_i)
  if (any(!is.finite(m_i[lower.tri(m_i)]))) { skipped <- skipped + 1L; next }
  tr <- tryCatch(${build}(d_i), error = function(e) NULL)
  if (is.null(tr)) { skipped <- skipped + 1L; next }
  kept <- kept + 1L
  trees[[kept]] <- tr
}
trees <- trees[seq_len(kept)]
class(trees) <- "multiPhylo"
cat(sprintf("Skipped (saturated): %d of %d\\n", skipped, B))
if (skipped / B > 0.1) {
  warning(sprintf("%d of %d bootstrap replicates skipped (saturated distances)", skipped, B))
}
if (kept == 0L) {
  stop("every bootstrap replicate was skipped (saturated distances); no support values")
}
# Support on the original tree: share of kept replicates containing
# each grouping, shown as node-label percents.
tree$node.label <- sprintf("%.0f", 100 * ape::prop.clades(tree, trees) / kept)
plot(tree, show.node.label = TRUE)
cat(ape::write.tree(tree), "\\n")
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
  bootstrap?: ExportBootstrap,
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
  // The bootstrap loop resamples columns of x, so for protein x is
  // the alignment as a plain character matrix of letters (rbinding
  // as.character(aln) gives residue letters; lapply-ing as.character
  // element-wise yields raw-byte hex codes phyDat rejects) — each
  // replicate's distOf then redoes the same distance (dist.aa
  // proportion, the Kimura transform or phangorn's JTT) as the main
  // analysis above.
  let fun: string;
  switch (correction) {
    case "P":
      fun =
        "function(xx) ape::dist.aa(xx, pairwise.deletion = TRUE, scaled = TRUE)";
      break;
    case "Kimura":
      fun = `function(xx) {
  p <- as.matrix(ape::dist.aa(xx, pairwise.deletion = TRUE,
                              scaled = TRUE))
  as.dist(-log(1 - p - 0.2 * p^2))
}`;
      break;
    case "Jtt":
      fun = `function(xx) phangorn::dist.ml(phangorn::phyDat(xx, type = "AA"), model = "JTT")`;
      break;
    default:
      throw new Error(
        `R export not supported for correction ${correction} on protein`,
      );
  }
  const boot =
    bootstrap === undefined
      ? ""
      : `if (!inherits(tree, "error")) {
${bootstrapBlock(
  "x <- do.call(rbind, as.character(aln))",
  `distOf <- ${fun}`,
  method,
  bootstrap,
)}}\n`;
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
  cat(ape::write.tree(tree), "\\n")
}
write.table(format(m, digits = 15), file = stdout(), sep = " ",
            row.names = FALSE, col.names = FALSE, quote = FALSE)
${boot}`;
}
