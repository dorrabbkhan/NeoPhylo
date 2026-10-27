# lab_chain_checks.R — validation and fixture writer for
# generate_lab_chain.sh (v1.4 lab pack 3). Run from the script's scratch
# dir where trees.nwk (neighbor's 100 outtree Newicks) and
# cons_{extended,strict,majority}.{out,nwk} (the three consense runs)
# exist. Env: FIXDIR, INPUT, REPS, SEED, GEN.
#
# Same parser, canonicalization and assertions as the R block in
# generate_consensus.sh (duplicated: that heredoc cannot be sourced).
# Asserts: each consense species table matches the input labels, the
# extended kind's included+excluded inventory equals ape::prop.part on
# `trees`, strict = unanimous sets, majority = >50% sets, the spec §3.5
# extended-majority simulation equals consense's included table, no
# extended-majority decision is tied (prints "TIE" and exits 0 instead),
# `groups` equals the non-trivial groupings of that kind's newick, and
# strict <= majority <= extended. On success writes
# phylip/chain/<input>_boot<REPS>.json and prints a summary line.

suppressPackageStartupMessages({library(ape); library(jsonlite)})
fixdir <- Sys.getenv("FIXDIR"); input <- Sys.getenv("INPUT")
reps <- as.integer(Sys.getenv("REPS"))
hdr <- readLines(file.path(fixdir, "inputs", paste0(input, ".fasta")))
labs <- sub("^>", "", hdr[startsWith(hdr, ">")])
rooted <- FALSE

# neighbor outtree: REPS Newicks, each wrapped over several lines, ending
# in ';'. Keep the printed text (whitespace collapsed) as `trees`.
tree_strings <- function(path) {
  parts <- strsplit(paste(readLines(path), collapse = ""), ";",
                    fixed = TRUE)[[1]]
  parts <- gsub("\\s+", "", parts)
  parts <- parts[nzchar(parts)]
  paste0(parts, ";")
}
trees_nwk <- tree_strings("trees.nwk")
trees <- lapply(trees_nwk, function(s) read.tree(text = s))
stopifnot(length(trees) == reps,
          identical(sort(trees[[1]]$tip.label), sort(labs)))

# consense outfile parser: "Species in order" maps mask positions to
# labels; "Sets included"/"Sets NOT included" hold `..*.**` rows + counts.
parse_outfile <- function(path) {
  lines <- readLines(path)
  i <- grep("Species in order", lines)[1]
  j2 <- grep("Sets included in the consensus tree", lines)[1]
  stopifnot(!is.na(i), !is.na(j2))
  sp <- character(0)
  for (ln in lines[(i + 1):(j2 - 1)]) {
    m <- regmatches(ln, regexec("^\\s*(\\d+)\\.\\s+(\\S+)\\s*$", ln))[[1]]
    if (length(m) == 3) sp[as.integer(m[2])] <- m[3]
  }
  stopifnot(!any(is.na(sp)))
  totals <- grep("How many times out of", lines, value = TRUE)
  stopifnot(length(totals) >= 1)
  total <- as.numeric(sub(".*out of\\s+", "", totals[1]))
  inc <- list(); exc <- list(); mode <- NULL
  for (ln in lines) {
    if (grepl("Sets included in the consensus tree", ln)) { mode <- "i"; next }
    if (grepl("Sets NOT included", ln)) { mode <- "o"; next }
    m <- regmatches(ln, regexec("^\\s*([*.]+(?: [*.]+)*)\\s{2,}([0-9.]+)\\s*$",
                              ln))[[1]]
    if (length(m) == 3 && !is.null(mode)) {
      mask <- strsplit(gsub(" ", "", m[2]), "", fixed = TRUE)[[1]]
      stopifnot(length(mask) == length(sp))
      g <- list(labels = sort(sp[mask == "*"]),
                count = round(as.numeric(m[3])))
      if (mode == "i") inc[[length(inc) + 1]] <- g
      else             exc[[length(exc) + 1]] <- g
    }
  }
  list(inc = inc, exc = exc, species = sp, total = total)
}

read_nwk <- function(path) gsub("\\s+", "", paste(readLines(path), collapse = ""))

# Canonical side for unrooted splits: the side NOT containing the first
# fixture label. consense prints the side not containing ITS species 1,
# so rows are re-canonicalized after parsing.
canon_side <- function(idx, plabs, labs, rooted) {
  side <- plabs[idx]
  if (!rooted && labs[1] %in% side) side <- setdiff(labs, side)
  sort(side)
}
grouping_inventory <- function(trees, labs, rooted) {
  pp <- do.call(prop.part, unname(trees))
  plabs <- attr(pp, "labels"); num <- attr(pp, "number")
  stopifnot(!is.null(plabs), !is.null(num), setequal(plabs, labs))
  inv <- new.env(parent = emptyenv())
  for (i in seq_along(pp)) {
    side <- canon_side(pp[[i]], plabs, labs, rooted)
    s <- length(side)
    if (rooted) { if (s < 2 || s == length(labs)) next }
    else if (min(s, length(labs) - s) < 2) next
    key <- paste(side, collapse = "\x1f")
    if (exists(key, envir = inv, inherits = FALSE)) {
      inv[[key]]$count <- inv[[key]]$count + num[i]
    } else inv[[key]] <- list(labels = side, count = num[i])
  }
  inv
}
grp_compat <- function(a, b, n, rooted) {
  if (rooted) {
    i <- length(intersect(a, b))
    return(i == 0 || i == length(a) || i == length(b))
  }
  ab <- length(intersect(a, b))
  min(ab, length(a) - ab, length(b) - ab, n - length(a) - length(b) + ab) == 0
}
key_of <- function(g) paste(g$labels, collapse = "\x1f")
in_keys <- function(o) vapply(o$inc, key_of, "")

check_ext <- function(o) {
  if (!setequal(o$species, labs) || length(o$species) != length(labs) ||
      o$total != reps) {
    cat("species:", o$species, "\nlabs:", labs,
        "\ntotal:", o$total, "ntrees:", reps, "\n")
    stop("consense species table does not match the input labels")
  }
  # Re-canonicalize unrooted sides (see the note above canon_side).
  for (fld in c("inc", "exc")) {
    o[[fld]] <- lapply(o[[fld]], function(g) {
      if (labs[1] %in% g$labels) g$labels <- sort(setdiff(labs, g$labels))
      g
    })
  }
  o
}

outs <- list(extended = check_ext(parse_outfile("cons_extended.out")),
             strict   = check_ext(parse_outfile("cons_strict.out")),
             majority = check_ext(parse_outfile("cons_majority.out")))
nwks <- list(extended = read_nwk("cons_extended.nwk"),
             strict   = read_nwk("cons_strict.nwk"),
             majority = read_nwk("cons_majority.nwk"))

inv <- grouping_inventory(trees, labs, rooted)
inv_keys <- ls(envir = inv, all.names = TRUE)
inv_counts <- vapply(inv_keys, function(k) inv[[k]]$count, numeric(1))
names(inv_counts) <- inv_keys
ntax <- length(labs); total <- reps

# The extended table (included + NOT included) is the full inventory.
ext <- c(outs$extended$inc, outs$extended$exc)
ext_counts <- vapply(ext, function(g) g$count, numeric(1))
names(ext_counts) <- vapply(ext, key_of, "")
if (!identical(sort(names(ext_counts)), sort(inv_keys)) ||
    !identical(ext_counts[sort(names(ext_counts))],
               inv_counts[sort(names(ext_counts))]))
  stop("consense group inventory does not match prop.part")

# strict = unanimous sets; majority = strictly more than half.
stopifnot(setequal(in_keys(outs$strict), inv_keys[inv_counts == total]),
          setequal(in_keys(outs$majority), inv_keys[inv_counts > total / 2]))

# Extended majority: simulate spec §3.5 on the inventory — majority sets,
# then remaining sets by decreasing count, adding each if compatible,
# stopping when the tree is fully resolved (n-3 splits unrooted) — and
# assert the result equals consense. A count whose compatible candidates
# are mutually incompatible is a tie: report it, don't fail — the caller
# retries with the next odd seed.
all_sets <- mget(inv_keys, envir = inv, inherits = FALSE)
acc <- all_sets[inv_counts > total / 2]
resolved <- ntax - 3
for (c in sort(unique(inv_counts[inv_counts <= total / 2]),
               decreasing = TRUE)) {
  if (length(acc) == resolved) break
  cand <- all_sets[inv_counts == c]
  cand <- Filter(function(s) all(vapply(acc, function(t)
    grp_compat(s$labels, t$labels, ntax, rooted), TRUE)), cand)
  if (length(cand) > 1) {
    for (x in seq_len(length(cand) - 1)) {
      for (y in (x + 1):length(cand)) {
        if (!grp_compat(cand[[x]]$labels, cand[[y]]$labels, ntax, rooted)) {
          cat("TIE\n")
          quit(save = "no", status = 0)
        }
      }
    }
  }
  acc <- c(acc, cand)
}
stopifnot(setequal(vapply(acc, key_of, ""), in_keys(outs$extended)))

# Per-kind assertions: groups is exactly the non-trivial groupings of the
# kind's newick and pairwise compatible; then strict <= majority <=
# extended.
tree_groups <- function(nwk) {
  pp <- prop.part(read.tree(text = nwk))
  plabs <- attr(pp, "labels")
  out <- new.env(parent = emptyenv())
  for (i in seq_along(pp)) {
    side <- canon_side(pp[[i]], plabs, labs, rooted)
    if (min(length(side), length(labs) - length(side)) < 2) next
    out[[paste(side, collapse = "\x1f")]] <- TRUE
  }
  ls(envir = out, all.names = TRUE)
}
for (kind in c("strict", "majority", "extended")) {
  o <- outs[[kind]]
  if (!setequal(in_keys(o), tree_groups(nwks[[kind]])))
    stop("consense.", kind, ": groups differ from newick groupings")
  if (length(o$inc) > 1) {
    for (x in seq_len(length(o$inc) - 1)) for (y in (x + 1):length(o$inc))
      if (!grp_compat(o$inc[[x]]$labels, o$inc[[y]]$labels, ntax, rooted))
        stop("consense.", kind, ": incompatible groups")
  }
}
stopifnot(all(in_keys(outs$strict) %in% in_keys(outs$majority)),
          all(in_keys(outs$majority) %in% in_keys(outs$extended)))

# Printed decimals counted on the raw outtree text, where trailing zeros
# survive (neighbor writes %8.5f branch lengths).
decimals <- function(txt, pat) {
  m <- regmatches(txt, gregexpr(pat, txt))[[1]]
  min(nchar(sub(".*\\.", "", m)))
}
tree_precision <- decimals(paste(readLines("trees.nwk"), collapse = " "),
                           ":[0-9]+\\.[0-9]+")

gen <- Sys.getenv("GEN")
fixture <- list(
  name = paste0(input, "_boot", reps),
  generator = gen,
  input = file.path("inputs", paste0(input, ".fasta")),
  seed = as.integer(Sys.getenv("SEED")),
  replicates = reps,
  labels = labs,
  trees = trees_nwk,
  consense = list(
    generator = gen,
    extended  = list(newick = nwks$extended, groups = outs$extended$inc,
                     not_included = outs$extended$exc),
    strict    = list(newick = nwks$strict, groups = outs$strict$inc,
                     not_included = outs$strict$exc),
    majority  = list(newick = nwks$majority, groups = outs$majority$inc,
                     not_included = outs$majority$exc)
  ),
  tree_precision = tree_precision
)
out <- file.path(fixdir, "phylip", "chain",
                 paste0(input, "_boot", reps, ".json"))
dir.create(dirname(out), showWarnings = FALSE, recursive = TRUE)
writeLines(toJSON(fixture, auto_unbox = TRUE, digits = NA, pretty = TRUE),
           out)
cat(sprintf("%s: %d taxa, %d trees, %d groupings, tree precision %d -> %s\n",
            fixture$name, ntax, total, length(inv_keys), tree_precision, out))
