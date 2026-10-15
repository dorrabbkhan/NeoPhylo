# generate.R — produce ape/phangorn reference fixtures for NeoPhylo.
#
# For every alignment in fixtures/inputs/*.fasta this script computes the
# raw (p), JC69 and K80 distance matrices with ape::dist.dna
# (pairwise.deletion = TRUE), builds NJ trees with ape::nj and a UPGMA tree
# with phangorn::upgma, and writes one JSON file per input to fixtures/ref/.
#
# The engine's corpus test (Task 10) replays these files, so the script also
# re-runs every join step in R and fails if any join has a tied minimum —
# reference tools break ties differently and ties would make fixtures
# meaningless.
#
# Usage: Rscript fixtures/generate.R     (from anywhere; paths are resolved
# relative to this file)

suppressPackageStartupMessages({
  library(ape)
  library(phangorn)
  library(jsonlite)
})

# Resolve fixtures/ regardless of the working directory.
args <- commandArgs(trailingOnly = FALSE)
file_arg <- sub("^--file=", "", grep("^--file=", args, value = TRUE))
fixdir <- if (length(file_arg) == 1) dirname(normalizePath(file_arg)) else "fixtures"
indir <- file.path(fixdir, "inputs")
outdir <- file.path(fixdir, "ref")
dir.create(outdir, showWarnings = FALSE, recursive = TRUE)

GENERATOR <- sprintf("ape %s / phangorn %s",
                     packageVersion("ape"), packageVersion("phangorn"))

# --- tie checking -------------------------------------------------------

# Re-run the NJ joins on a full square matrix d and stop if any step has
# more than one minimum-Q pair. Mirrors spec 4.5 steps 1-4.
assert_no_nj_ties <- function(d, name, model) {
  d <- as.matrix(d)
  while (nrow(d) > 3) {
    n <- nrow(d)
    r <- rowSums(d)
    q <- (n - 2) * d - outer(r, r, `+`)
    diag(q) <- Inf                      # exclude the diagonal from the minimum
    m <- min(q)
    hits <- which(q == m, arr.ind = TRUE)
    pairs <- unique(t(apply(hits, 1, sort)))
    if (nrow(pairs) != 1) {
      stop(sprintf("tied NJ minimum in %s (%s) at %d active nodes: %d pairs share Q = %g",
                   name, model, n, nrow(pairs), m))
    }
    i <- hits[1, 1]; j <- hits[1, 2]
    # new row: d(u,k) = (d(i,k) + d(j,k) - d(i,j)) / 2
    du <- (d[i, ] + d[j, ] - d[i, j]) / 2
    keep <- setdiff(seq_len(n), c(i, j))
    d <- d[keep, keep, drop = FALSE]
    d <- cbind(d, du[keep])
    d <- rbind(d, c(du[keep], 0))
  }
}

# Re-run the UPGMA joins and stop if any step has a tied minimum pair.
assert_no_upgma_ties <- function(d, name, model) {
  d <- as.matrix(d)
  sizes <- rep(1, nrow(d))
  while (nrow(d) > 1) {
    diag(d) <- Inf
    m <- min(d)
    hits <- which(d == m, arr.ind = TRUE)
    pairs <- unique(t(apply(hits, 1, sort)))
    if (nrow(pairs) != 1) {
      stop(sprintf("tied UPGMA minimum in %s (%s) at %d active clusters: %d pairs share d = %g",
                   name, model, nrow(d), nrow(pairs), m))
    }
    i <- hits[1, 1]; j <- hits[1, 2]
    si <- sizes[i]; sj <- sizes[j]
    keep <- setdiff(seq_len(nrow(d)), c(i, j))
    du <- (si * d[i, keep] + sj * d[j, keep]) / (si + sj)
    d <- d[keep, keep, drop = FALSE]
    sizes <- c(sizes[keep], si + sj)
    if (length(keep) > 0) {
      d <- cbind(d, du)
      d <- rbind(d, c(du, 0))
    } else {
      break
    }
  }
}

# --- main -----------------------------------------------------------------

inputs <- sort(list.files(indir, pattern = "\\.fasta$", full.names = TRUE))
stopifnot(length(inputs) >= 1)

newick <- function(t) write.tree(t, digits = 16)

for (f in inputs) {
  name <- sub("\\.fasta$", "", basename(f))
  aln <- read.dna(f, format = "fasta")
  labels <- labels(aln)

  mats <- list(
    raw  = as.matrix(dist.dna(aln, model = "raw",  pairwise.deletion = TRUE)),
    JC69 = as.matrix(dist.dna(aln, model = "JC69", pairwise.deletion = TRUE)),
    K80  = as.matrix(dist.dna(aln, model = "K80",  pairwise.deletion = TRUE))
  )

  # Tie check on every distance matrix the corpus test exercises.
  assert_no_nj_ties(mats$JC69, name, "JC69")
  assert_no_nj_ties(mats$K80,  name, "K80")
  assert_no_upgma_ties(mats$JC69, name, "JC69")

  nj_jc <- nj(as.dist(mats$JC69))
  nj_k80 <- nj(as.dist(mats$K80))
  upg_jc <- upgma(as.dist(mats$JC69))

  fixture <- list(
    name = name,
    generator = GENERATOR,
    labels = labels,
    input = file.path("inputs", basename(f)),
    distances = list(
      raw  = unname(mats$raw),
      JC69 = unname(mats$JC69),
      K80  = unname(mats$K80)
    ),
    nj = list(JC69 = newick(nj_jc), K80 = newick(nj_k80)),
    upgma = list(JC69 = newick(upg_jc)),
    precision = NA          # full precision; serializes as null
  )

  out <- file.path(outdir, paste0(name, ".json"))
  writeLines(toJSON(fixture, auto_unbox = TRUE, digits = NA, pretty = TRUE), out)
  cat(sprintf("%s: %d taxa -> %s\n", name, length(labels), out))
}
