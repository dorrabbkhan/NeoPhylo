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
# merges a second opinion into ref/protein/<name>.json (written by
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
# order): the protdist JTT matrices are read back from ref/protein/*.json
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
  ref_path <- file.path(outdir, "protein", paste0(name, ".json"))
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

  # dist.ml is an iterative optimizer: its last ~1e-14 differs between
  # BLAS/R builds, so second_opinion is rounded to 8 decimals to keep
  # regeneration byte-stable across environments (still far finer than
  # the residual it cross-checks, spec §6.2).
  m_jtt <- round(as.matrix(dist.ml(as.phyDat(aln), model = "JTT")), 8)
  m_p <- round(as.matrix(dist.aa(as.matrix(aln),
                                 pairwise.deletion = TRUE,
                                 scaled = TRUE)), 8)

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

# --- consensus fixture sets (v1.2) ---------------------------------------
# Seeded tree sets for the bootstrap support/consensus oracles (spec
# §8.1): three unrooted ape::rmtree sets for NJ splits, two rooted sets
# for UPGMA clusters, and two ape::boot.phylo replicate sets of committed
# alignments (DNA JC69, protein Kimura). Each JSON carries the trees, a
# reference tree and ape::prop.clades counts; generate_phylip.sh merges
# the PHYLIP consense results into the same files. A committed `consense`
# block is preserved only when the regenerated trees are identical to the
# committed ones, so regeneration stays order-stable either way (when a
# set's trees change, run generate.R BEFORE generate_phylip.sh so consense
# is merged onto the fresh trees).

consdir <- file.path(fixdir, "consensus")
dir.create(consdir, showWarnings = FALSE, recursive = TRUE)

# Canonical grouping side: for unrooted splits the side NOT containing the
# first label (taxon 0) — the side consense prints; for rooted sets the
# clade itself. `idx` indexes `plabs` (prop.part's own label order).
canon_side <- function(idx, plabs, labs, rooted) {
  side <- plabs[idx]
  if (!rooted && labs[1] %in% side) side <- setdiff(labs, side)
  sort(side)
}

# Distinct groupings + counts across a list of phylo trees (clades for
# rooted trees, canonical-side bipartitions for unrooted ones).
# Returns an env keyed by the sorted labels -> list(labels, count).
grouping_inventory <- function(trees, labs, rooted) {
  pp <- do.call(prop.part, unname(trees))
  plabs <- attr(pp, "labels")
  num <- attr(pp, "number")
  stopifnot(!is.null(plabs), !is.null(num), setequal(plabs, labs))
  inv <- new.env(parent = emptyenv())
  for (i in seq_along(pp)) {
    side <- canon_side(pp[[i]], plabs, labs, rooted)
    s <- length(side)
    # Trivial groupings: unrooted, either side may hold <2 taxa; rooted,
    # an n-1 clade is real — only <2 and the full set go.
    if (rooted) { if (s < 2 || s == length(labs)) next }
    else if (min(s, length(labs) - s) < 2) next
    key <- paste(side, collapse = "\x1f")
    if (exists(key, envir = inv, inherits = FALSE)) {
      inv[[key]]$count <- inv[[key]]$count + num[i]
    } else {
      inv[[key]] <- list(labels = side, count = num[i])
    }
  }
  inv
}

# Grouping compatibility: unrooted splits are compatible iff one of the
# four side intersections is empty; rooted clades iff disjoint or nested.
grp_compat <- function(a, b, n, rooted) {
  if (rooted) {
    i <- length(intersect(a, b))
    return(i == 0 || i == length(a) || i == length(b))
  }
  ab <- length(intersect(a, b))
  min(ab, length(a) - ab, length(b) - ab, n - length(a) - length(b) + ab) == 0
}

# TRUE iff no extended-majority decision is tied (spec §3.5, plan Global
# Constraints): walking the sub-majority groupings by decreasing count,
# two candidates at the same count that are each compatible with the
# accepted set but incompatible with each other would make the result
# order-dependent. Extension — and therefore the check — stops once the
# tree is fully resolved (n-3 splits unrooted, n-2 clades rooted).
extension_unambiguous <- function(inv, total, n, rooted) {
  sets <- as.list(inv)
  counts <- vapply(sets, `[[`, numeric(1), "count")
  acc <- sets[counts > total / 2]
  resolved <- if (rooted) n - 2 else n - 3
  for (c in sort(unique(counts[counts <= total / 2]), decreasing = TRUE)) {
    if (length(acc) == resolved) return(TRUE)
    cand <- sets[counts == c]
    cand <- Filter(function(s) all(vapply(acc, function(t)
      grp_compat(s$labels, t$labels, n, rooted), TRUE)), cand)
    if (length(cand) > 1) {
      for (x in seq_len(length(cand) - 1)) {
        for (y in (x + 1):length(cand)) {
          if (!grp_compat(cand[[x]]$labels, cand[[y]]$labels, n, rooted))
            return(FALSE)
        }
      }
    }
    acc <- c(acc, cand)
  }
  TRUE
}

# Engine-equivalent protein Kimura distance (protein_dist.rs):
# x = 1 - p - 0.2 p^2; d = -ln x; saturated when x <= 0 (then we retry the
# set with the next seed — the fixture keeps only fully built replicates).
kimura_aa <- function(z) {
  n <- nrow(z); m <- matrix(0, n, n,
                          dimnames = list(rownames(z), rownames(z)))
  for (i in seq_len(n - 1)) {
    for (j in (i + 1):n) {
      p <- mean(z[i, ] != z[j, ])
      x <- 1 - p - 0.2 * p * p
      if (x <= 0) stop("saturated protein pair ", i, ",", j)
      m[i, j] <- m[j, i] <- -log(x)
    }
  }
  m
}

gen_random <- function(n, nt, rooted) function(seed) {
  set.seed(seed)
  list(trees = rmtree(nt, n, rooted = rooted,
                      tip.label = paste0("t", seq_len(n))))
}
gen_boot_dna <- function(f, model, b) function(seed) {
  aln <- read.dna(file.path(indir, f), format = "fasta")
  ref <- nj(dist.dna(aln, model = model, pairwise.deletion = TRUE))
  set.seed(seed)
  trees <- boot.phylo(ref, aln, quiet = TRUE, trees = TRUE, B = b,
                      FUN = function(z) nj(dist.dna(z, model = model,
                                           pairwise.deletion = TRUE)))$trees
  list(trees = trees, ref = ref, labs = labels(aln))
}
gen_boot_aa <- function(f, b) function(seed) {
  aa <- as.matrix(read.FASTA(file.path(indir, f), type = "AA"))
  ref <- nj(as.dist(kimura_aa(aa)))
  set.seed(seed)
  trees <- boot.phylo(ref, aa, quiet = TRUE, trees = TRUE, B = b,
                      FUN = function(z) nj(as.dist(kimura_aa(z))))$trees
  list(trees = trees, ref = ref, labs = rownames(aa))
}

cons_specs <- list(
  list(name = "rmtree_6_20",   rooted = FALSE, seed0 = 20261,
       gen = gen_random(6, 20, FALSE)),
  list(name = "rmtree_8_100",  rooted = FALSE, seed0 = 20262,
       gen = gen_random(8, 100, FALSE)),
  list(name = "rmtree_12_200", rooted = FALSE, seed0 = 20263,
       gen = gen_random(12, 200, FALSE)),
  list(name = "rmtree_6_20_rooted",  rooted = TRUE, seed0 = 20264,
       gen = gen_random(6, 20, TRUE)),
  list(name = "rmtree_8_100_rooted", rooted = TRUE, seed0 = 20265,
       gen = gen_random(8, 100, TRUE)),
  list(name = "boot_jc12_jc69_100", rooted = FALSE, seed0 = 20266,
       gen = gen_boot_dna("jc12.fasta", "JC69", 100),
       input = file.path("inputs", "jc12.fasta")),
  list(name = "boot_p8_kimura_100", rooted = FALSE, seed0 = 20267,
       gen = gen_boot_aa(file.path("protein", "p8_250.fasta"), 100),
       input = file.path("inputs", "protein", "p8_250.fasta"))
)

for (spec in cons_specs) {
  out <- file.path(consdir, paste0(spec$name, ".json"))
  g <- NULL
  for (seed in spec$seed0 + 0:499) {
    g <- tryCatch(spec$gen(seed), error = function(e) e)
    if (inherits(g, "error")) next
    labs <- if (!is.null(g$labs)) g$labs else g$trees[[1]]$tip.label
    ref <- if (!is.null(g$ref)) g$ref else g$trees[[1]]
    inv <- grouping_inventory(g$trees, labs, spec$rooted)
    if (extension_unambiguous(inv, length(g$trees), length(labs),
                              spec$rooted))
      break
    g <- NULL
  }
  if (is.null(g))
    stop(spec$name, ": no seed in ", spec$seed0, "..", spec$seed0 + 499,
         " gave an unambiguous extended-majority extension")

  # prop.clades of the reference against the set; labels come from
  # prop.part(ref) (same order, same trivial leading part) and are
  # cross-checked against the raw inventory.
  rpp <- prop.part(ref)
  rplabs <- attr(rpp, "labels")
  rcnt <- prop.clades(ref, g$trees, rooted = spec$rooted)
  stopifnot(!is.null(rplabs), setequal(rplabs, labs),
            length(rpp) == length(rcnt))
  pcl <- lapply(seq_along(rpp), function(i)
    list(labels = canon_side(rpp[[i]], rplabs, labs, spec$rooted),
         count = unname(rcnt[i])))
  pcl <- Filter(function(x) length(x$labels) >= 2 &&
                  length(x$labels) < length(labs), pcl)
  for (x in pcl) {
    k <- paste(x$labels, collapse = "\x1f")
    stopifnot(exists(k, envir = inv, inherits = FALSE),
              inv[[k]]$count == x$count)
  }

  fixture <- list(
    name = spec$name,
    generator = GENERATOR,
    seed = seed,
    rooted = spec$rooted,
    labels = labs
  )
  if (!is.null(spec$input)) fixture$input <- spec$input
  fixture$trees <- vapply(g$trees, newick, "")
  fixture$reference <- newick(ref)
  fixture$prop_clades <- pcl

  # Preserve the consense block generate_phylip.sh wrote into the
  # committed file, but only while the trees are identical — changed
  # trees get their consense merged on the next generate_phylip.sh run.
  if (file.exists(out)) {
    old <- fromJSON(out)
    if (identical(unname(old$trees), unname(fixture$trees)) &&
        identical(old$rooted, fixture$rooted) &&
        !is.null(old$consense)) {
      fixture$consense <- old$consense
    }
  }
  writeLines(toJSON(fixture, auto_unbox = TRUE, digits = NA,
                    pretty = TRUE), out)
  cat(sprintf("%s: %d taxa, %d trees, seed %d -> %s\n",
              spec$name, length(labs), length(g$trees), seed, out))
}
