#!/usr/bin/env bash
# generate_phylip.sh — produce PHYLIP reference fixtures for NeoPhylo.
#
# Runs PHYLIP dnadist (Jukes-Cantor and Kimura 2-parameter) and neighbor
# (NJ and UPGMA) on two of the committed FASTA inputs, then parses
# outfile/outtree into ref/<name>_phylip.json. Values keep only PHYLIP's
# printed precision, so "precision" records the decimal count and the
# corpus test compares within half an ulp of that.
#
# PHYLIP has no raw/p distance, so these fixtures carry JC69 and K80 only.
#
# Protein path (v1.1): every inputs/protein/*.fasta goes through protdist
# (JTT default, then Kimura — the P toggle count is read off the menu
# output, not assumed) and neighbor NJ on the JTT matrix, parsed into
# ref/protein/<name>.json (a subdirectory: the corpus test flat-globs
# ref/*.json and cannot replay protein inputs until the engine learns
# them). generate.R then adds the phangorn second opinion to those files,
# so it must run AFTER this script (scripts/ci/fixture-guard.sh holds
# that order).
#
# Consensus path (v1.2): fixtures/consensus/*.json and
# worked/consensus_hand.json get their `consense` block (strict, majority
# and extended-majority runs plus the group tables) merged in by
# fixtures/generate_consensus.sh, invoked at the end of this script.
#
# Usage: bash fixtures/generate_phylip.sh   (from anywhere)
# Requires: dnadist, protdist, neighbor + consense (on PATH or
# /usr/lib/phylip/bin), Rscript with jsonlite + ape.

set -euo pipefail

FIXDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUTS="jc6 k80_10"          # the two gap-free inputs PHYLIP mirrors

find_phylip() {
  if command -v "$1" >/dev/null 2>&1; then command -v "$1";
  elif [ -x "/usr/lib/phylip/bin/$1" ]; then echo "/usr/lib/phylip/bin/$1";
  else echo "missing PHYLIP binary: $1 (install the phylip package)" >&2; exit 1; fi
}
DNADIST="$(find_phylip dnadist)"
PROTDIST="$(find_phylip protdist)"
NEIGHBOR="$(find_phylip neighbor)"

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT
cd "$TMPD"

# FASTA -> strict PHYLIP: first line "n sites", then 10-char name + sequence.
# Sequences stay on one line; dnadist/protdist read them fine in
# sequential order. $1 = path to the FASTA file.
fasta_to_phylip() {
  Rscript - "$1" "$TMPD/infile" <<'RS'
a <- commandArgs(trailingOnly = TRUE)
seqs <- list(); cur <- NULL
for (ln in readLines(a[1])) {
  if (startsWith(ln, ">")) { cur <- sub("^>", "", ln); seqs[[cur]] <- "" }
  else seqs[[cur]] <- paste0(seqs[[cur]], toupper(trimws(ln)))
}
n <- length(seqs); s <- nchar(seqs[[1]])
stopifnot(all(nchar(unlist(seqs)) == s), all(nchar(names(seqs)) <= 10))
cat(sprintf("%5d %5d\n", n, s), file = a[2])
for (nm in names(seqs)) cat(sprintf("%-10s%s\n", nm, seqs[[nm]]), file = a[2], append = TRUE)
RS
}

run_dnadist() { # $1 = model: J (Jukes-Cantor) or K (Kimura); writes outfile
  rm -f outfile
  if [ "$1" = "J" ]; then printf 'D\nD\nY\n' | timeout 120 "$DNADIST" > phylip.log 2>&1
  else printf 'D\nY\n' | timeout 120 "$DNADIST" > phylip.log 2>&1; fi
  [ -f outfile ] || { cat phylip.log; echo "dnadist produced no outfile" >&2; exit 1; }
}

run_neighbor() { # $1 = method: N (NJ) or U (UPGMA); $2 = matrix file; writes outtree
  cp "$2" infile; rm -f outfile outtree
  if [ "$1" = "U" ]; then printf 'N\nY\n' | timeout 120 "$NEIGHBOR" > phylip.log 2>&1
  else printf 'Y\n' | timeout 120 "$NEIGHBOR" > phylip.log 2>&1; fi
  [ -f outtree ] || { cat phylip.log; echo "neighbor produced no outtree" >&2; exit 1; }
}

VER=""
for name in $INPUTS; do
  fasta_to_phylip "$FIXDIR/inputs/$name.fasta"

  run_dnadist J; cp outfile "mat_${name}_jc.txt"
  [ -n "$VER" ] || VER="$(grep -o 'version [0-9.]*' phylip.log | head -1 | awk '{print $2}')"
  run_dnadist K; cp outfile "mat_${name}_k80.txt"

  run_neighbor N "mat_${name}_jc.txt";  cp outtree "nj_${name}_jc.nwk"
  run_neighbor N "mat_${name}_k80.txt"; cp outtree "nj_${name}_k80.nwk"
  run_neighbor U "mat_${name}_jc.txt";  cp outtree "upgma_${name}_jc.nwk"

  # Parse the run's outputs into ref/<name>_phylip.json.
  FIXDIR="$FIXDIR" NAME="$name" GEN="phylip $VER" Rscript - <<'RS'
suppressPackageStartupMessages(library(jsonlite))
name <- Sys.getenv("NAME"); fixdir <- Sys.getenv("FIXDIR")

# dnadist outfile: first line is n; each row starts with a 10-char name and
# may wrap onto continuation lines (which begin with a space).
parse_dnadist <- function(path) {
  lines <- readLines(path); lines <- lines[nzchar(trimws(lines))]
  n <- as.integer(trimws(lines[1]))
  labels <- character(n); vals <- vector("list", n); row <- 0
  for (ln in lines[-1]) {
    if (substr(ln, 1, 1) == " ") {
      vals[[row]] <- c(vals[[row]], scan(text = ln, quiet = TRUE))
    } else {
      row <- row + 1
      labels[row] <- trimws(substr(ln, 1, 10))
      vals[[row]] <- scan(text = substring(ln, 11), quiet = TRUE)
    }
  }
  stopifnot(row == n, all(lengths(vals) == n))
  list(labels = labels, m = do.call(rbind, vals))
}

read_nwk <- function(path) gsub("\\s+", "", paste(readLines(path), collapse = ""))

# printed decimals, e.g. "0.025747" -> 6, ":0.02575" -> 5
decimals <- function(txt, pat) {
  m <- regmatches(txt, gregexpr(pat, txt))[[1]]
  min(nchar(sub(".*\\.", "", m)))
}

d_jc <- parse_dnadist(paste0("mat_", name, "_jc.txt"))
d_k80 <- parse_dnadist(paste0("mat_", name, "_k80.txt"))
nwks <- c(read_nwk(paste0("nj_", name, "_jc.nwk")),
          read_nwk(paste0("nj_", name, "_k80.nwk")),
          read_nwk(paste0("upgma_", name, "_jc.nwk")))

prec <- min(
  decimals(paste(d_jc$m, collapse = " "), "[0-9]+\\.[0-9]+"),
  decimals(paste(d_k80$m, collapse = " "), "[0-9]+\\.[0-9]+"),
  decimals(paste(nwks, collapse = " "), ":[0-9]+\\.[0-9]+")
)

fixture <- list(
  name = paste0(name, "_phylip"),
  generator = Sys.getenv("GEN"),
  labels = d_jc$labels,
  input = file.path("inputs", paste0(name, ".fasta")),
  distances = list(JC69 = unname(d_jc$m), K80 = unname(d_k80$m)),
  nj = list(JC69 = nwks[1], K80 = nwks[2]),
  upgma = list(JC69 = nwks[3]),
  precision = prec
)
out <- file.path(fixdir, "ref", paste0(name, "_phylip.json"))
writeLines(toJSON(fixture, auto_unbox = TRUE, digits = NA, pretty = TRUE), out)
cat(sprintf("%s: %d taxa, precision %d -> %s\n", name, length(d_jc$labels), prec, out))
RS
done

# --- protein path ---------------------------------------------------------
# protdist's P option cycles through its substitution models; the Kimura
# toggle count is read off the menu output each run instead of assumed.

run_protdist() { # $1 = jtt|kimura; infile must exist; writes outfile
  rm -f outfile
  if [ "$1" = jtt ]; then
    printf 'Y\n' | timeout 120 "$PROTDIST" > phylip.log 2>&1
  else
    found=""
    for k in 0 1 2 3 4 5 6 7 8; do
      rm -f outfile
      { for _ in $(seq "$k" 2>/dev/null); do printf 'P\n'; done; printf 'Y\n'; } \
        | timeout 120 "$PROTDIST" > phylip.log 2>&1
      [ -f outfile ] || { cat phylip.log; echo "protdist produced no outfile" >&2; exit 1; }
      model="$(grep 'Use JTT' phylip.log | tail -1 | sed 's/^.*model? *//')"
      if [ "$model" = "Kimura formula" ]; then
        echo "  protdist: P toggled $k time(s) -> $model"
        found=1; break
      fi
      # Stop once the cycle wraps back to JTT without hitting Kimura.
      [ "$k" -gt 0 ] && [ "$model" = "Jones-Taylor-Thornton matrix" ] && break
    done
    [ -n "$found" ] || { echo "protdist: no P-toggle count reached 'Kimura formula'" >&2; exit 1; }
  fi
  [ -f outfile ] || { cat phylip.log; echo "protdist produced no outfile" >&2; exit 1; }
}

for fasta in "$FIXDIR"/inputs/protein/*.fasta; do
  [ -e "$fasta" ] || continue
  name="$(basename "$fasta" .fasta)"
  fasta_to_phylip "$fasta"

  run_protdist jtt; cp outfile "mat_${name}_jtt.txt"
  [ -n "$VER" ] || VER="$(grep -o 'version [0-9.]*' phylip.log | head -1 | awk '{print $2}')"
  run_protdist kimura; cp outfile "mat_${name}_kimura.txt"

  run_neighbor N "mat_${name}_jtt.txt"; cp outtree "nj_${name}_jtt.nwk"

  FIXDIR="$FIXDIR" NAME="$name" GEN="phylip $VER" Rscript - <<'RS'
suppressPackageStartupMessages(library(jsonlite))
name <- Sys.getenv("NAME"); fixdir <- Sys.getenv("FIXDIR")

# protdist outfile: same shape as dnadist's (first line is n; each row
# starts with a 10-char name; continuation lines begin with a space).
parse_dnadist <- function(path) {
  lines <- readLines(path); lines <- lines[nzchar(trimws(lines))]
  n <- as.integer(trimws(lines[1]))
  labels <- character(n); vals <- vector("list", n); row <- 0
  for (ln in lines[-1]) {
    if (substr(ln, 1, 1) == " ") {
      vals[[row]] <- c(vals[[row]], scan(text = ln, quiet = TRUE))
    } else {
      row <- row + 1
      labels[row] <- trimws(substr(ln, 1, 10))
      vals[[row]] <- scan(text = substring(ln, 11), quiet = TRUE)
    }
  }
  stopifnot(row == n, all(lengths(vals) == n))
  list(labels = labels, m = do.call(rbind, vals))
}

read_nwk <- function(path) gsub("\\s+", "", paste(readLines(path), collapse = ""))

decimals <- function(txt, pat) {
  m <- regmatches(txt, gregexpr(pat, txt))[[1]]
  min(nchar(sub(".*\\.", "", m)))
}

d_jtt <- parse_dnadist(paste0("mat_", name, "_jtt.txt"))
d_kim <- parse_dnadist(paste0("mat_", name, "_kimura.txt"))
stopifnot(identical(d_jtt$labels, d_kim$labels))
nwk <- read_nwk(paste0("nj_", name, "_jtt.nwk"))

prec <- min(
  decimals(paste(d_jtt$m, collapse = " "), "[0-9]+\\.[0-9]+"),
  decimals(paste(d_kim$m, collapse = " "), "[0-9]+\\.[0-9]+"),
  decimals(nwk, ":[0-9]+\\.[0-9]+")
)

fixture <- list(
  name = paste0("protein_", name),
  generator = Sys.getenv("GEN"),
  alphabet = "protein",
  labels = d_jtt$labels,
  input = file.path("inputs", "protein", paste0(name, ".fasta")),
  distances = list(JTT = unname(d_jtt$m), Kimura = unname(d_kim$m)),
  nj = list(JTT = nwk),
  precision = prec
  # second_opinion is merged in by fixtures/generate.R (runs after this
  # script; see scripts/ci/fixture-guard.sh).
)
out <- file.path(fixdir, "ref", "protein", paste0(name, ".json"))
dir.create(dirname(out), showWarnings = FALSE, recursive = TRUE)
writeLines(toJSON(fixture, auto_unbox = TRUE, digits = NA, pretty = TRUE), out)
cat(sprintf("protein_%s: %d taxa, precision %d -> %s\n",
            name, length(d_jtt$labels), prec, out))
RS
done

# --- consensus path (v1.2) -------------------------------------------------
# consense merges live in their own script so this file stays single-purpose;
# see fixtures/generate_consensus.sh for the driver and the R assertions.
bash "$FIXDIR/generate_consensus.sh"
