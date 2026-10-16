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
# For every alignment in fixtures/inputs/protein/*.fasta it additionally
# merges a second opinion into ref/protein_<name>.json (written by
# generate_phylip.sh, which must run FIRST — see scripts/ci/fixture-guard.sh):
# the NJ tie check runs on protdist's own JTT matrix, then
# phangorn::dist.ml(model = "JTT") and ape::dist.aa(pairwise.deletion =
# TRUE, scaled = TRUE) are recorded under "second_opinion".
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
      # At four actives a pair and its algebraic complement always tie
      # (Q(i,j) = Q(k,l) for complementary pairs identically), and joining
      # either gives the same split with identical branch lengths, so the
      # tie cannot bias a fixture. Only a tie between different splits is
      # ambiguous.
      benign <- n == 4 && nrow(pairs) == 2 &&
        length(unique(as.vector(pairs))) == 4
      if (!benign) {
        stop(sprintf("tied NJ minimum in %s (%s) at %d active nodes: %d pairs share Q = %g",
                     name, model, n, nrow(pairs), m))
      }
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

# --- protein second opinion ----------------------------------------------
# Runs AFTER generate_phylip.sh (scripts/ci/fixture-guard.sh holds that
# order): the protdist JTT matrices are read back from ref/protein_*.json
# for the NJ tie check, then the phangorn/ape results are merged into the
# same files as "second_opinion".

pdir <- file.path(indir, "protein")
pinputs <- if (dir.exists(pdir)) {
  sort(list.files(pdir, pattern = "\\.fasta$", full.names = TRUE))
} else {
  character(0)
}

for (f in pinputs) {
  name <- sub("\\.fasta$", "", basename(f))
  ref_path <- file.path(outdir, paste0("protein_", name, ".json"))
  if (!file.exists(ref_path)) {
    stop(sprintf("%s not found; run fixtures/generate_phylip.sh first",
                 ref_path))
  }
  fixture <- fromJSON(ref_path)
  aln <- read.FASTA(f, type = "AA")
  stopifnot(identical(unname(names(aln)), unname(fixture$labels)))

  # Tie check on protdist's own JTT matrix, not a recomputation — the
  # engine is tested against exactly this matrix.
  assert_no_nj_ties(fixture$distances$JTT, name, "JTT")

  m_jtt <- as.matrix(dist.ml(as.phyDat(aln), model = "JTT"))
  m_p <- as.matrix(dist.aa(as.matrix(aln),
                           pairwise.deletion = TRUE, scaled = TRUE))

  fixture$second_opinion <- list(
    generator = sprintf("phangorn %s / ape %s",
                        packageVersion("phangorn"), packageVersion("ape")),
    # Defensive relabeling into the fixture's label order (both distance
    # calls already preserve input order).
    JTT = unname(m_jtt[fixture$labels, fixture$labels]),
    p   = unname(m_p[fixture$labels, fixture$labels])
  )
  writeLines(toJSON(fixture, auto_unbox = TRUE, digits = NA, pretty = TRUE),
             ref_path)
  cat(sprintf("protein_%s: second opinion merged -> %s\n", name, ref_path))
}
