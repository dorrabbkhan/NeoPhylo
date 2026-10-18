#!/usr/bin/env Rscript
# compare_app.R — compare a distance matrix exported by NeoPhylo
# ("PHYLIP matrix (for neighbor)" export) against R's ape/phangorn
# implementation of the same model (v1.1 plan Task 14, spec §5.6).
#
# Usage:
#   Rscript scripts/compare/compare_app.R <alignment> <matrix> <model>
#
#   <alignment>  FASTA or PHYLIP-sequential alignment file
#   <matrix>     the app's PHYLIP square-matrix export (Strict or
#                Relaxed names are auto-detected)
#   <model>      p | JC69 | K80 (DNA) or p | Kimura | JTT (protein)
#
# Prints a per-model PASS/FAIL summary and finishes with "ALL PASS"
# (exit 0) or "FAIL" (exit 1). Protein models need the phangorn package;
# DNA models need ape only.
#
# Tolerances: the app prints 6 decimals (max rounding error 5e-7), so
# p/JC69/K80/Kimura are compared at 1e-5 absolute. JTT is phangorn's
# variant, which differs from NeoPhylo's protdist-derived JTT by
# ~1–1.7% relative (docs/decisions.md Task 6) — the JTT check is 2%
# relative with a 1e-4 absolute floor. The app's "-1.000000" saturated
# cells must match a non-finite R distance (NaN/Inf).

options(warn = 1)

ABS_TOL <- 1e-5 # absolute tolerance for exact (non-JTT) models
JTT_REL_TOL <- 0.02 # relative tolerance for phangorn-vs-protdist JTT
JTT_ABS_FLOOR <- 1e-4 # absolute slack on top of the relative check

usage <- function() {
  cat("usage: compare_app.R <alignment> <matrix> <model>\n",
      "  model: p | JC69 | K80 | Kimura | JTT\n", sep = "")
  quit(status = 2)
}

args <- commandArgs(trailingOnly = TRUE)
if (length(args) != 3) usage()
aln_path <- args[[1]]
mat_path <- args[[2]]
model <- args[[3]]
if (!model %in% c("p", "JC69", "K80", "Kimura", "JTT")) usage()

## ---- alignment ----

# Reads a FASTA or PHYLIP-sequential alignment into a character matrix
# (rownames = sequence names). Parsed directly rather than via ape so
# the alphabet is detected from content, as the app does.
read_alignment <- function(path) {
  lines <- readLines(path, warn = FALSE)
  lines <- lines[nzchar(trimws(lines))]
  first <- lines[[1]]
  if (startsWith(first, ">")) {
    # FASTA
    names <- character(0)
    seqs <- character(0)
    cur <- ""
    for (ln in lines) {
      if (startsWith(ln, ">")) {
        if (length(names) > 0) seqs[length(names)] <- cur
        names <- c(names, sub("^>\\s*", "", sub("\\s.*$", "", ln)))
        cur <- ""
      } else {
        cur <- paste0(cur, gsub("\\s", "", ln))
      }
    }
    seqs[length(names)] <- cur
  } else {
    # PHYLIP sequential: `n sites` header, then `name seq` rows
    # (strict 10-char or relaxed whitespace-separated names).
    hdr <- strsplit(trimws(first), "\\s+")[[1]]
    n <- as.integer(hdr[1])
    if (is.na(n)) stop("alignment is neither FASTA nor PHYLIP")
    names <- character(n)
    seqs <- character(n)
    for (i in seq_len(n)) {
      ln <- lines[[i + 1]]
      tok <- strsplit(trimws(ln), "\\s+")[[1]]
      if (length(tok) >= 2) {
        # Relaxed: first token is the name, the rest is the sequence.
        names[i] <- tok[1]
        seqs[i] <- paste0(tok[-1], collapse = "")
      } else {
        # Strict: name is columns 1-10, sequence follows.
        names[i] <- trimws(substr(ln, 1, 10))
        seqs[i] <- gsub("\\s", "", substr(ln, 11, nchar(ln)))
      }
    }
  }
  chars <- do.call(rbind, strsplit(toupper(seqs), ""))
  rownames(chars) <- names
  chars
}

# The app's detection rule (spec §3.1): protein when any sequence
# character is outside the DNA alphabet {A C G T U N} plus ambiguity
# codes, gaps and missing data.
DNA_CHARS <- strsplit("ACGTUNRYSWKMBDHV-?", "")[[1]]
is_protein <- function(chars) {
  any(!unique(c(chars)) %in% DNA_CHARS)
}

## ---- app matrix (PHYLIP square, Strict or Relaxed names) ----

read_app_matrix <- function(path) {
  lines <- readLines(path, warn = FALSE)
  lines <- lines[nzchar(trimws(lines))]
  n <- as.integer(lines[[1]])
  if (is.na(n)) stop("matrix header is not a taxon count")
  rows <- lines[-1]
  if (length(rows) < n) stop("matrix has ", length(rows), " rows for n=", n)

  parse_relaxed <- function(line) {
    tok <- strsplit(trimws(line), "\\s+")[[1]]
    vals <- suppressWarnings(as.numeric(tok[-1]))
    if (length(vals) == n && !any(is.na(vals))) {
      list(name = tok[1], vals = vals)
    } else {
      NULL
    }
  }
  parse_strict <- function(line) {
    # Strict mode: name occupies columns 1-10, values follow.
    name <- trimws(substr(line, 1, 10))
    vals <- suppressWarnings(
      as.numeric(strsplit(trimws(substr(line, 11, nchar(line))), "\\s+")[[1]]))
    if (nchar(name) > 0 && length(vals) == n && !any(is.na(vals))) {
      list(name = name, vals = vals)
    } else {
      NULL
    }
  }

  relaxed <- lapply(rows[seq_len(n)], parse_relaxed)
  mode <- if (!any(vapply(relaxed, is.null, logical(1)))) {
    relaxed
  } else {
    lapply(rows[seq_len(n)], parse_strict)
  }
  if (any(vapply(mode, is.null, logical(1)))) {
    stop("could not parse matrix rows as Strict or Relaxed PHYLIP names")
  }
  names <- vapply(mode, `[[`, character(1), "name")
  mat <- do.call(rbind, lapply(mode, `[[`, "vals"))
  dimnames(mat) <- list(names, names)
  mat
}

## ---- R distances ----

r_distances <- function(chars, model, protein) {
  if (protein) {
    p <- as.matrix(ape::dist.aa(chars, pairwise.deletion = TRUE,
                                scaled = TRUE))
    if (model == "p") return(p)
    if (model == "Kimura") {
      # Kimura (1983): d = -ln(1 - p - p^2/5) on the p-distance.
      return(-log(1 - p - 0.2 * p^2))
    }
    # JTT via phangorn — a different JTT variant than NeoPhylo's
    # protdist-derived one; compared at JTT_REL_TOL (see header).
    pd <- phangorn::phyDat(chars, type = "AA")
    return(as.matrix(phangorn::dist.ml(pd, model = "JTT")))
  }
  dna <- ape::as.DNAbin(chars)
  ape_model <- switch(model,
    p = "raw", JC69 = "JC69", K80 = "K80",
    stop("unreachable"))
  as.matrix(ape::dist.dna(dna, model = ape_model,
                          pairwise.deletion = TRUE))
}

## ---- compare ----

aln <- read_alignment(aln_path)
protein <- is_protein(aln)
if (protein != (model %in% c("Kimura", "JTT")) && model != "p") {
  cat("FAIL: model", model, "does not match the detected alphabet",
      if (protein) "(protein)" else "(DNA)", "\n")
  quit(status = 1)
}
app <- read_app_matrix(mat_path)
r <- r_distances(aln, model, protein)

# Align by name: the app's matrix order follows the alignment, but the
# comparison should not depend on it.
if (!setequal(rownames(app), rownames(r))) {
  cat("FAIL: taxon names differ between alignment and matrix\n")
  quit(status = 1)
}
r <- r[rownames(app), colnames(app)]

n <- nrow(app)
sat_app <- app == -1.0
sat_r <- !is.finite(r)

mismatch_sat <- which(sat_app != sat_r, arr.ind = TRUE)
val <- !sat_app & !sat_r
diff <- abs(app - r)
rel <- diff / pmax(abs(r), .Machine$double.eps)

if (model == "JTT") {
  bad <- which(val & diff > pmax(JTT_ABS_FLOOR, JTT_REL_TOL * abs(r)),
               arr.ind = TRUE)
  tol_desc <- sprintf("%.1f%% relative (+ %g absolute floor)",
                      100 * JTT_REL_TOL, JTT_ABS_FLOOR)
} else {
  bad <- which(val & diff > ABS_TOL, arr.ind = TRUE)
  tol_desc <- sprintf("%g absolute", ABS_TOL)
}

cat(sprintf("%s: %d taxa, %d comparable cells, max |diff| %.3g, max rel %.3g, %d saturated (app) vs %d non-finite (R)\n",
            model, n, sum(val),
            if (any(val)) max(diff[val]) else 0,
            if (any(val)) max(rel[val]) else 0,
            sum(sat_app), sum(sat_r)))

ok <- nrow(mismatch_sat) == 0 && nrow(bad) == 0
if (nrow(mismatch_sat) > 0) {
  cat("FAIL: saturated/non-finite cells disagree at",
      nrow(mismatch_sat), "cells\n")
}
if (nrow(bad) > 0) {
  cat("FAIL:", nrow(bad), "cells exceed tolerance", tol_desc, "\n")
}
cat(if (ok) "ALL PASS\n" else "FAIL\n")
quit(status = if (ok) 0 else 1)
