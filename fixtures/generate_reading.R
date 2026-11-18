# generate_reading.R — tree-reading oracle fixtures for NeoPhylo (v1.4d).
#
# Writes the committed inputs under fixtures/inputs/reading/ and the oracle
# answers under fixtures/ref/reading/. Everything is deterministic: each
# corpus section runs under its own fixed seed, so re-running the script
# rewrites identical files.
#
# Corpus:
#   corpus_binary.nwk    40 seeded ape::rtree rooted binary cladograms
#                        (4–12 tips, labels t1…tn); the seed is the first
#                        one (searched upward from SEED$corpus_binary) whose
#                        same-tip-count pairs contain a `same` = true case
#   corpus_polytomy.nwk  20 trees (5–12 tips) each with at least one
#                        polytomy (non-root internal branches zeroed then
#                        collapsed by ape::di2multi, so roots stay binary);
#                        the last is the previous tree written in a
#                        different child order — a guaranteed `same` = true
#   rotations.nwk        10 trees each written three times with different
#                        child orders (30 lines; lines 3i..3i+2 are one tree)
#   traits.nwk           10 trees whose gain/loss marks are recorded in
#                        queries.json
#
# Queries (recorded in queries.json, answers in ref/reading/*.json):
#   mrca            ape::getMRCA, stored as the MRCA node's sorted tip set
#   monophyletic    ape::is.monophyletic
#   sister          the tip sets under the tip's parent, minus the tip's own
#                   lineage (for a polytomy, every other child's tips)
#   restrict        ape::keep.tip (unary nodes suppressed), stored as Newick
#   ancestor_pairs  pairs where the first clade is a proper ancestor of the
#                   second, stored as sorted tip sets
#   clade_count     phy$Nnode (internal nodes including the root)
#   same            phangorn::RF.dist(rooted = TRUE) == 0, cross-checked
#                   against ape::all.equal.phylo(use.edge.length = FALSE);
#                   the script stops if the two disagree
#   traits          tip states computed by walking ape::nodepath from the
#                   root to each tip, applying each branch's marks in the
#                   order listed; changes counts marks per trait
#
# Tip lists everywhere are sorted in Unicode code-point order (CladeKey
# order). All trees are cladograms — branch lengths are ignored by every
# query, so none are written.
#
# Usage: Rscript fixtures/generate_reading.R   (paths resolve relative to
# this file; R 4.5.2 + ape 5.8.1 + phangorn 2.12.1 + jsonlite when written)

suppressPackageStartupMessages({
  library(ape)
  library(phangorn)
  library(jsonlite)
})

args <- commandArgs(trailingOnly = FALSE)
file_arg <- sub("^--file=", "", grep("^--file=", args, value = TRUE))
fixdir <- if (length(file_arg) == 1) dirname(normalizePath(file_arg)) else "fixtures"
indir <- file.path(fixdir, "inputs", "reading")
outdir <- file.path(fixdir, "ref", "reading")
dir.create(indir, showWarnings = FALSE, recursive = TRUE)
dir.create(outdir, showWarnings = FALSE, recursive = TRUE)

GENERATOR <- list(
  R = paste(R.version$major, R.version$minor, sep = "."),
  ape = as.character(packageVersion("ape")),
  phangorn = as.character(packageVersion("phangorn"))
)

SEEDS <- list(corpus_binary = 20261118L,
              corpus_polytomy = 20261118L,
              rotations = 20261118L,
              traits = 20261118L)

# --- helpers ---------------------------------------------------------------

# Sort labels in Unicode code-point order (the CladeKey order), independent
# of the host locale's collation.
sort_cp <- function(x) {
  x[order(vapply(x, function(s) {
    paste(formatC(utf8ToInt(enc2utf8(s)), width = 7, flag = "0"), collapse = " ")
  }, character(1)))]
}

root_of <- function(phy) setdiff(phy$edge[, 1], phy$edge[, 2])

# sample(x, k) treats a length-1 numeric x as the population 1:x; sample
# indices instead (still errors on an empty x, which should never happen).
pick1 <- function(x) x[sample(length(x), 1)]
pickk <- function(x, k) x[sample(length(x), k)]

children_of <- function(phy, node) phy$edge[phy$edge[, 1] == node, 2]

descendants_of <- function(phy, node) {
  out <- integer(0)
  stack <- children_of(phy, node)
  while (length(stack)) {
    u <- stack[1]
    stack <- stack[-1]
    out <- c(out, u)
    stack <- c(stack, children_of(phy, u))
  }
  out
}

# Sorted tip labels at or below `node` (the node's CladeKey; a tip's own
# clade is itself).
tips_below <- function(phy, node) {
  desc <- c(node, descendants_of(phy, node))
  sort_cp(phy$tip.label[desc[desc <= Ntip(phy)]])
}

all_nodes <- function(phy) seq_len(Ntip(phy) + phy$Nnode)

nonroot_internal <- function(phy) intersect(unique(phy$edge[, 1]), phy$edge[, 2])

# Reorder the children of every internal node; permfun(parent, k) returns a
# permutation of 1:k. Rewrites edge[, 2] within each parent's row set.
permute_children <- function(phy, permfun) {
  E <- phy$edge
  for (p in unique(E[, 1])) {
    rows <- which(E[, 1] == p)
    E[rows, 2] <- E[rows[permfun(p, length(rows))], 2]
  }
  phy$edge <- E
  phy
}

# Rooted topological equality: phangorn::RF.dist(rooted = TRUE) is the
# oracle; ape::all.equal.phylo(use.edge.length = FALSE) (rotation-aware)
# cross-checks it. The script stops if the two disagree. Every corpus tree
# keeps a binary root so ape/phangorn always treat it as rooted (ape's
# is.rooted is a root-degree heuristic). capture.output + suppressMessages
# muffle phangorn's "not binary" chatter.
same_topology <- function(a, b) {
  rf <- suppressWarnings(suppressMessages({
    invisible(capture.output(v <- RF.dist(a, b, rooted = TRUE)))
    v
  }))
  ae <- isTRUE(all.equal.phylo(a, b, use.edge.length = FALSE))
  if ((rf == 0) != ae) {
    stop(sprintf(paste0("same-topology disagreement: RF.dist = %g but ",
                        "all.equal.phylo = %s\n  %s\n  %s"),
                 rf, ae, write.tree(a), write.tree(b)))
  }
  rf == 0
}

# All unordered `same` pairs between trees sharing a tip set, 0-based.
same_pairs <- function(trees) {
  ns <- vapply(trees, Ntip, integer(1))
  out <- list()
  for (g in split(seq_along(trees), ns)) {
    if (length(g) < 2) next          # combn(scalar, 2) means seq_len(scalar)
    for (ij in combn(g, 2, simplify = FALSE)) {
      out[[length(out) + 1]] <- list(
        a = ij[1] - 1L, b = ij[2] - 1L,
        value = same_topology(trees[[ij[1]]], trees[[ij[2]]]))
    }
  }
  out
}

random_binary <- function(n) {
  tr <- rtree(n, tip.label = paste0("t", seq_len(n)), rooted = TRUE)
  tr$edge.length <- NULL
  tr
}

# A rooted binary tree with 1-2 internal branches collapsed into
# polytomies. Only branches whose parent is NOT the root are collapsed, so
# the root stays binary (needs n >= 5: at four tips the only internal
# branch hangs off the root).
random_polytomy <- function(n) {
  tr <- rtree(n, tip.label = paste0("t", seq_len(n)), rooted = TRUE)
  tr$edge.length <- rep(1, nrow(tr$edge))
  root <- root_of(tr)
  internal_edges <- which(tr$edge[, 2] > n & tr$edge[, 1] != root)
  if (!length(internal_edges)) {
    stop("no non-root internal branch to collapse; needs n >= 5")
  }
  k <- pick1(seq_len(min(2, length(internal_edges))))
  tr$edge.length[pickk(internal_edges, k)] <- 0
  tr <- di2multi(tr, tol = 1e-8)
  tr$edge.length <- NULL
  if (max(table(tr$edge[, 1])) < 3) {
    stop("polytomy generation produced a binary tree")
  }
  tr
}

# Tip sets under the parent's other children (the sister group of `tip`).
sister_tips <- function(phy, tip) {
  tn <- match(tip, phy$tip.label)
  parent <- phy$edge[phy$edge[, 2] == tn, 1]
  sib <- setdiff(children_of(phy, parent), tn)
  sort_cp(unlist(lapply(sib, function(s) tips_below(phy, s))))
}

# The query set asked on each corpus tree. NULL-safe against star trees
# (a polytomy corpus can produce a root-only tree with no non-root clade).
pick_queries <- function(phy) {
  n <- Ntip(phy)
  labs <- phy$tip.label
  nri <- nonroot_internal(phy)
  clade <- function() if (length(nri)) tips_below(phy, pick1(nri)) else NULL
  rnd <- function() sample(labs, pick1(2:min(4, n)))

  mrca <- Filter(Negate(is.null),
                 list(sample(labs, 2), sample(labs, min(3, n)), clade(),
                      sort_cp(labs)))
  mono <- Filter(Negate(is.null), list(clade(), rnd(), sort_cp(labs)))
  restrict <- Filter(Negate(is.null), list(clade(), rnd()))

  allnr <- setdiff(all_nodes(phy), root_of(phy))
  ancestor_pairs <- list(list(sort_cp(labs), tips_below(phy, pick1(allnr))))
  if (length(nri)) {
    a <- pick1(nri)
    ancestor_pairs[[2]] <- list(tips_below(phy, a),
                                tips_below(phy, pick1(descendants_of(phy, a))))
    a <- pick1(nri)
    ancestor_pairs[[3]] <- list(tips_below(phy, a),
                                tips_below(phy, pick1(intersect(
                                  descendants_of(phy, a), seq_len(n)))))
  } else {
    ancestor_pairs[[2]] <- list(sort_cp(labs), tips_below(phy, pick1(allnr)))
    ancestor_pairs[[3]] <- list(sort_cp(labs), tips_below(phy, pick1(allnr)))
  }

  list(mrca = lapply(mrca, sort_cp),
       monophyletic = lapply(mono, sort_cp),
       sister = as.list(sample(labs, 2)),
       restrict = lapply(restrict, sort_cp),
       ancestor_pairs = ancestor_pairs)
}

# A smaller query set for rotations.nwk lines: the SAME sets are asked on
# all three serializations of a base tree, so equal answers double as a
# rotation-invariance check.
pick_queries_light <- function(phy) {
  labs <- phy$tip.label
  n <- Ntip(phy)
  nri <- nonroot_internal(phy)
  clade <- if (length(nri)) tips_below(phy, pick1(nri)) else sort_cp(labs)
  allnr <- setdiff(all_nodes(phy), root_of(phy))
  list(mrca = lapply(list(sample(labs, 2), clade), sort_cp),
       monophyletic = list(clade),
       sister = as.list(sample(labs, 1)),
       restrict = lapply(list(sample(labs, pick1(2:(n - 1)))), sort_cp),
       ancestor_pairs = list(list(sort_cp(labs),
                                  tips_below(phy, pick1(allnr)))))
}

# Oracle answers for one tree's query set -> one `trees` ref entry.
# The tree is first reparsed from its written Newick: permuted edge
# matrices (rotations) are valid for write.tree but corrupt keep.tip's
# internal reorder. Reparsing gives the canonical order for exactly the
# same serialization, so every answer matches the committed .nwk line.
oracle_entry <- function(phy, q) {
  phy <- read.tree(text = write.tree(phy))
  list(
    newick = write.tree(phy),
    mrca = lapply(q$mrca, function(s) {
      list(tips = I(s), clade = I(tips_below(phy, getMRCA(phy, s))))
    }),
    monophyletic = lapply(q$monophyletic, function(s) {
      list(tips = I(s), value = is.monophyletic(phy, s))
    }),
    sister = lapply(q$sister, function(tp) {
      list(tip = tp, sisters = I(sister_tips(phy, tp)))
    }),
    restrict = lapply(q$restrict, function(s) {
      list(tips = I(s), newick = write.tree(keep.tip(phy, s)))
    }),
    ancestor_pairs = lapply(q$ancestor_pairs, function(p) {
      list(ancestor = I(p[[1]]), descendant = I(p[[2]]))
    }),
    clade_count = phy$Nnode
  )
}

# Per-traits-tree marks. T1 gains once; T2 gains then loses inside the
# gained clade; T3 is convergent (two disjoint gains) on trees 1–5 and a
# gain -> loss -> re-gain chain (three changes) on trees 6–10.
pick_marks <- function(phy, idx) {
  n <- Ntip(phy)
  root <- root_of(phy)
  nri <- nonroot_internal(phy)
  allnr <- setdiff(all_nodes(phy), root)
  marks <- list()
  add <- function(node, trait, change) {
    marks[[length(marks) + 1]] <<- list(on = tips_below(phy, node),
                                      trait = trait, change = change)
  }
  internal_desc <- function(g) {
    d <- intersect(descendants_of(phy, g), nri)
    d[vapply(d, function(x) length(descendants_of(phy, x)) > 0, TRUE)]
  }
  convergent_pair <- function() {
    cl <- lapply(allnr, function(u) tips_below(phy, u))
    repeat {
      ij <- sample(length(allnr), 2)
      if (!any(cl[[ij[1]]] %in% cl[[ij[2]]])) return(ij)
    }
  }

  add(if (length(nri)) pick1(nri) else pick1(allnr), "T1", "gain")

  if (!length(nri)) stop("traits tree has no internal node below the root")
  repeat {
    g2 <- pick1(nri)
    if (length(descendants_of(phy, g2))) break
  }
  add(g2, "T2", "gain")
  add(pick1(descendants_of(phy, g2)), "T2", "loss")

  chain <- nri[vapply(nri, function(g) length(internal_desc(g)) > 0, TRUE)]
  if (idx <= 5 || !length(chain)) {
    ij <- convergent_pair()
    add(allnr[ij[1]], "T3", "gain")
    add(allnr[ij[2]], "T3", "gain")
  } else {
    g3 <- pick1(chain)
    d1 <- pick1(internal_desc(g3))
    add(g3, "T3", "gain")
    add(d1, "T3", "loss")
    add(pick1(descendants_of(phy, d1)), "T3", "gain")
  }
  marks
}

# Tip states from marks: walk ape::nodepath root -> tip, applying each
# branch's marks in the order listed (spec 5.6).
tip_states <- function(phy, marks) {
  traits <- unique(vapply(marks, `[[`, "", "trait"))
  root <- root_of(phy)
  clades <- lapply(all_nodes(phy), function(nd) tips_below(phy, nd))
  states <- vector("list", Ntip(phy))
  names(states) <- phy$tip.label
  for (tp in seq_len(Ntip(phy))) {
    st <- setNames(rep(FALSE, length(traits)), traits)
    for (nd in setdiff(nodepath(phy, root, tp), root)) {
      for (mk in marks) {
        if (identical(mk$on, clades[[nd]])) st[mk$trait] <- mk$change == "gain"
      }
    }
    states[[tp]] <- st
  }
  states
}

json_marks <- function(marks) {
  lapply(marks, function(m) list(on = I(m$on), trait = m$trait, change = m$change))
}

write_json <- function(x, path) {
  writeLines(toJSON(x, auto_unbox = TRUE, digits = NA, pretty = TRUE), path)
  cat(sprintf("wrote %s\n", path))
}

# --- corpus_binary ----------------------------------------------------------
# 40 random rooted binary trees; seed searched upward until the corpus
# contains at least one `same` = true pair (same topology, different trees).

seed <- SEEDS$corpus_binary
repeat {
  set.seed(seed)
  cb_trees <- lapply(seq_len(40), function(i) random_binary(sample(4:12, 1)))
  cb_same <- same_pairs(cb_trees)
  if (any(vapply(cb_same, `[[`, TRUE, "value"))) break
  seed <- seed + 1L
}
SEEDS$corpus_binary <- seed
cb_queries <- lapply(cb_trees, pick_queries)
stopifnot(all(vapply(cb_trees, function(t) max(table(t$edge[, 1])), integer(1)) == 2))

# --- corpus_polytomy --------------------------------------------------------
# 20 trees each with >= 1 polytomy; tree 20 is tree 19 written in a
# different child order (a guaranteed `same` = true pair).

set.seed(SEEDS$corpus_polytomy)
cp_trees <- lapply(seq_len(19), function(i) random_polytomy(sample(5:12, 1)))
cp_trees[[20]] <- permute_children(cp_trees[[19]], function(p, k) rev(seq_len(k)))
stopifnot(write.tree(cp_trees[[19]]) != write.tree(cp_trees[[20]]))
cp_queries <- lapply(cp_trees, pick_queries)
cp_same <- same_pairs(cp_trees)
stopifnot(all(vapply(cp_trees, function(t) max(table(t$edge[, 1])), integer(1)) >= 3))

# --- rotations ---------------------------------------------------------------
# 10 base trees, each written three times with different child orders.

set.seed(SEEDS$rotations)
rot_base <- lapply(seq_len(10), function(i) random_binary(sample(5:10, 1)))
rot_base[[3]] <- random_polytomy(sample(6:9, 1))
rot_base[[8]] <- random_polytomy(sample(6:9, 1))
rot_trees <- list()
rot_queries <- list()
for (base in rot_base) {
  versions <- list(
    base,
    permute_children(base, function(p, k) rev(seq_len(k))),
    permute_children(base, function(p, k) sample(k))
  )
  s <- vapply(versions, write.tree, "")
  if (s[3] %in% s[1:2]) {
    # reverse all child orders except the root's: distinct from both the
    # plain tree and the all-reversed one whenever a non-root internal node
    # exists (always true at >= 5 tips).
    versions[[3]] <- permute_children(base, function(p, k) {
      if (p == root_of(base)) seq_len(k) else rev(seq_len(k))
    })
    s[3] <- write.tree(versions[[3]])
  }
  if (length(unique(s)) != 3) stop("rotation variants are not distinct")
  stopifnot(same_topology(versions[[1]], versions[[2]]),
            same_topology(versions[[1]], versions[[3]]),
            same_topology(versions[[2]], versions[[3]]))
  q <- pick_queries_light(base)
  for (v in versions) {
    rot_trees[[length(rot_trees) + 1]] <- v
    rot_queries[[length(rot_queries) + 1]] <- q
  }
}
rot_same <- same_pairs(rot_trees)

# --- traits -------------------------------------------------------------------

set.seed(SEEDS$traits)
tt_trees <- lapply(seq_len(10), function(i) {
  n <- sample(6:10, 1)
  if (i %in% c(3L, 7L)) random_polytomy(n) else random_binary(n)
})
tt_marks <- lapply(seq_along(tt_trees), function(i) pick_marks(tt_trees[[i]], i))
stopifnot(any(vapply(tt_marks, function(m) {
  any(vapply(m, `[[`, "", "change") == "gain")
}, TRUE)),
  any(vapply(tt_marks, function(m) {
    any(vapply(m, `[[`, "", "change") == "loss")
  }, TRUE)),
  any(vapply(tt_marks, function(m) {
    any(table(vapply(m, `[[`, "", "trait")) > 1)
  }, TRUE)))

# --- write inputs --------------------------------------------------------------

writeLines(vapply(cb_trees, write.tree, ""), file.path(indir, "corpus_binary.nwk"))
writeLines(vapply(cp_trees, write.tree, ""), file.path(indir, "corpus_polytomy.nwk"))
writeLines(vapply(rot_trees, write.tree, ""), file.path(indir, "rotations.nwk"))
writeLines(vapply(tt_trees, write.tree, ""), file.path(indir, "traits.nwk"))

queries <- list(
  generator = GENERATOR,
  seeds = SEEDS,
  corpus_binary = list(
    trees = lapply(cb_queries, function(q) list(
      mrca = lapply(q$mrca, I),
      monophyletic = lapply(q$monophyletic, I),
      sister = I(unlist(q$sister)),
      restrict = lapply(q$restrict, I))),
    same = lapply(cb_same, function(p) c(p$a, p$b))),
  corpus_polytomy = list(
    trees = lapply(cp_queries, function(q) list(
      mrca = lapply(q$mrca, I),
      monophyletic = lapply(q$monophyletic, I),
      sister = I(unlist(q$sister)),
      restrict = lapply(q$restrict, I))),
    same = lapply(cp_same, function(p) c(p$a, p$b))),
  rotations = list(
    trees = lapply(rot_queries, function(q) list(
      mrca = lapply(q$mrca, I),
      monophyletic = lapply(q$monophyletic, I),
      sister = I(unlist(q$sister)),
      restrict = lapply(q$restrict, I))),
    same = lapply(rot_same, function(p) c(p$a, p$b))),
  traits = list(
    trees = lapply(tt_marks, function(m) list(
      marks = json_marks(m),
      root_states = as.list(setNames(rep(FALSE, length(unique(
        vapply(m, `[[`, "", "trait")))), unique(vapply(m, `[[`, "", "trait")))))))
)
write_json(queries, file.path(indir, "queries.json"))

# --- write refs -----------------------------------------------------------------

write_json(list(
  generator = GENERATOR,
  trees = Map(oracle_entry, cb_trees, cb_queries),
  same = lapply(cb_same, function(p) list(a = p$a, b = p$b, value = p$value))
), file.path(outdir, "corpus_binary.json"))

write_json(list(
  generator = GENERATOR,
  trees = Map(oracle_entry, cp_trees, cp_queries),
  same = lapply(cp_same, function(p) list(a = p$a, b = p$b, value = p$value))
), file.path(outdir, "corpus_polytomy.json"))

write_json(list(
  generator = GENERATOR,
  trees = Map(oracle_entry, rot_trees, rot_queries),
  same = lapply(rot_same, function(p) list(a = p$a, b = p$b, value = p$value))
), file.path(outdir, "rotations.json"))

traits_out <- lapply(seq_along(tt_trees), function(i) {
  states <- tip_states(tt_trees[[i]], tt_marks[[i]])
  counts <- table(vapply(tt_marks[[i]], `[[`, "", "trait"))
  list(tree = i - 1L,
       states = lapply(states, as.list),
       changes = as.list(counts))
})
write_json(list(
  generator = GENERATOR,
  trees = lapply(seq_along(tt_trees), function(i) {
    list(newick = write.tree(tt_trees[[i]]),
         marks = json_marks(tt_marks[[i]]),
         clade_count = tt_trees[[i]]$Nnode)
  }),
  traits = traits_out
), file.path(outdir, "traits.json"))
