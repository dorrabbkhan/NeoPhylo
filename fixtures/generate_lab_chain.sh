#!/usr/bin/env bash
# generate_lab_chain.sh — PHYLIP's real seqboot -> dnadist -> neighbor ->
# consense chain on one committed alignment (v1.4 lab pack 3, spec §6.1).
#
# NeoPhylo's own resampling cannot reproduce seqboot's replicates (its RNG
# differs), so pack 3's oracle is PHYLIP's whole chain committed verbatim:
# seqboot bootstraps inputs/k80_10.fasta (J Bootstrap and R = 100 are the
# menu defaults; after Y it asks "Random number seed (must be odd)?"),
# dnadist computes F84 distances for the 100 data sets (M -> D -> 100, all
# other options default), neighbor builds the 100 NJ trees (M -> 100 —
# neighbor's M then asks "Random number seed (must be odd)?" and the menu
# answers J "Yes (random number seed = <seed>)": giving M a seed turns on
# input-order randomization, one jumble per data set; both reads are
# asserted off the menu), and consense summarizes the trees three ways
# exactly as generate_consensus.sh does (extended majority = default,
# strict = one C, majority rule = two C; toggles read off the menu).
#
# The seed walks odd values from SEED_START upward (+2) until consense's
# extended-majority run on that seed's trees has no tied decision — the
# same deterministic search the consensus fixtures record. Validation and
# the JSON write live in lab_chain_checks.R; it prints "TIE" for a tied
# candidate, otherwise writes the fixture and prints a summary.
#
# The result is committed as phylip/chain/<input>_boot<REPS>.json — its own
# directory, so no existing glob (ref/*.json, ref/protein/*.json,
# phylip/{f84,k2p}/*.json, consensus/*.json) picks it up. Nothing in
# crates/ reads it yet; the pack 3 PR adds the reader.
#
# Not wired into generate_phylip.sh yet (PR #103 edits that file); add the
# call there in a later PR, like generate_consensus.sh is invoked today.
#
# Usage: bash fixtures/generate_lab_chain.sh   (from anywhere)
# Requires: seqboot, dnadist, neighbor, consense (on PATH or
# /usr/lib/phylip/bin), Rscript with jsonlite + ape.

set -euo pipefail

FIXDIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
INPUT="k80_10"            # same alignment lab pack 1 uses (phylip/f84)
REPS=100                  # seqboot's menu default for R
SEED_START=8675309        # first odd seed tried
SEED_MAX=8675499          # give up if every candidate ties

find_phylip() {
  if command -v "$1" >/dev/null 2>&1; then command -v "$1";
  elif [ -x "/usr/lib/phylip/bin/$1" ]; then echo "/usr/lib/phylip/bin/$1";
  else echo "missing PHYLIP binary: $1 (install the phylip package)" >&2; exit 1; fi
}
SEQBOOT="$(find_phylip seqboot)"
DNADIST="$(find_phylip dnadist)"
NEIGHBOR="$(find_phylip neighbor)"
CONSENSE="$(find_phylip consense)"

TMPD="$(mktemp -d)"
trap 'rm -rf "$TMPD"' EXIT
cd "$TMPD"

phylip_version() { grep -o 'version [0-9.]*' "$1" | head -1 | awk '{print $2}'; }

# FASTA -> strict PHYLIP: first line "n sites", then 10-char name + sequence.
# Same conversion generate_phylip.sh uses; duplicated because that file is
# edited by another open PR.
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

# --- the four program drivers; every setting asserted off the menu --------

run_seqboot() { # $1 = odd seed; ./infile must exist; produces ./outfile
  rm -f outfile
  printf 'Y\n%d\n' "$1" | timeout 300 "$SEQBOOT" > seqboot.log 2>&1
  [ -f outfile ] || { cat seqboot.log; echo "seqboot produced no outfile" >&2; exit 1; }
  local jline rline
  jline="$(grep 'Bootstrap, Jackknife, Permute, Rewrite?' seqboot.log | tail -1)"
  case "$jline" in *"Bootstrap") : ;; *)
    cat seqboot.log; echo "seqboot: expected Bootstrap default, got: $jline" >&2; exit 1 ;; esac
  rline="$(grep 'How many replicates?' seqboot.log | tail -1)"
  case "$rline" in *"  $REPS") : ;; *)
    cat seqboot.log; echo "seqboot: expected R = $REPS default, got: $rline" >&2; exit 1 ;; esac
  grep -q 'Random number seed (must be odd)?' seqboot.log || {
    cat seqboot.log; echo "seqboot: seed prompt not seen" >&2; exit 1; }
}

run_dnadist_m() { # $1 = replicate file; produces ./outfile (REPS matrices)
  cp "$1" infile; rm -f outfile
  printf 'M\nD\n%d\nY\n' "$REPS" | timeout 600 "$DNADIST" > dnadist.log 2>&1
  [ -f outfile ] || { cat dnadist.log; echo "dnadist produced no outfile" >&2; exit 1; }
  local dline mline
  dline="$(grep 'Distance (F84, Kimura' dnadist.log | head -1)"
  case "$dline" in *"F84") : ;; *)
    cat dnadist.log; echo "dnadist: expected F84 default, got: $dline" >&2; exit 1 ;; esac
  grep -q 'Multiple data sets or multiple weights' dnadist.log || {
    cat dnadist.log; echo "dnadist: M did not ask data sets vs weights" >&2; exit 1; }
  grep -q 'How many data sets?' dnadist.log || {
    cat dnadist.log; echo "dnadist: M did not ask the set count" >&2; exit 1; }
  mline="$(grep 'Analyze multiple data sets?' dnadist.log | tail -1)"
  case "$mline" in *"Yes, $REPS data sets") : ;; *)
    cat dnadist.log; echo "dnadist: M = $REPS did not land: $mline" >&2; exit 1 ;; esac
}

run_neighbor_m() { # $1 = matrix file, $2 = odd seed; produces ./outtree (REPS trees)
  cp "$1" infile; rm -f outfile outtree
  # neighbor's M asks "How many data sets?" then "Random number seed (must
  # be odd)?" inside the option, before the menu returns for the Y.
  printf 'M\n%d\n%d\nY\n' "$REPS" "$2" | timeout 600 "$NEIGHBOR" > neighbor.log 2>&1
  [ -f outtree ] || { cat neighbor.log; echo "neighbor produced no outtree" >&2; exit 1; }
  local nline jline mline
  nline="$(grep 'Neighbor-joining or UPGMA tree?' neighbor.log | tail -1)"
  case "$nline" in *"Neighbor-joining") : ;; *)
    cat neighbor.log; echo "neighbor: expected NJ default, got: $nline" >&2; exit 1 ;; esac
  jline="$(grep 'Randomize input order' neighbor.log | tail -1)"
  case "$jline" in *"Yes (random number seed = $2)") : ;; *)
    cat neighbor.log; echo "neighbor: jumble seed did not land: $jline" >&2; exit 1 ;; esac
  grep -q 'How many data sets?' neighbor.log || {
    cat neighbor.log; echo "neighbor: M did not ask the set count" >&2; exit 1; }
  grep -q 'Random number seed (must be odd)?' neighbor.log || {
    cat neighbor.log; echo "neighbor: M did not ask for a random seed" >&2; exit 1; }
  mline="$(grep 'Analyze multiple data sets?' neighbor.log | tail -1)"
  case "$mline" in *"Yes, $REPS sets") : ;; *)
    cat neighbor.log; echo "neighbor: M = $REPS did not land: $mline" >&2; exit 1 ;; esac
}

# $1 = extended|strict|majority; ./intree must exist; produces ./outfile +
# ./outtree. Same toggle scheme as generate_consensus.sh; sets are always
# unrooted (these are NJ trees), so the R option is asserted to stay "No".
run_consense() {
  rm -f outfile outtree
  local keys=""
  case "$1" in
    extended) keys="Y\n" ;;
    strict)   keys="C\nY\n" ;;
    majority) keys="C\nC\nY\n" ;;
    *) echo "unknown consense kind: $1" >&2; exit 1 ;;
  esac
  printf "$keys" | timeout 120 "$CONSENSE" > "consense_$1.log" 2>&1
  [ -f outfile ] && [ -f outtree ] || {
    cat "consense_$1.log"; echo "consense produced no outfile/outtree" >&2; exit 1; }
  local tline rline
  tline="$(grep 'Consensus type' "consense_$1.log" | tail -1)"
  case "$1" in
    extended)
      case "$tline" in *":  Majority rule (extended)") : ;; *)
        cat "consense_$1.log"; echo "consense: expected extended majority, got: $tline" >&2; exit 1 ;; esac ;;
    strict)
      case "$tline" in *":  strict") : ;; *)
        cat "consense_$1.log"; echo "consense: expected strict, got: $tline" >&2; exit 1 ;; esac ;;
    majority)
      case "$tline" in *":  Majority rule") : ;; *)
        cat "consense_$1.log"; echo "consense: expected majority rule, got: $tline" >&2; exit 1 ;; esac ;;
  esac
  rline="$(grep 'treated as Rooted' "consense_$1.log" | tail -1)"
  case "$rline" in *No*) : ;; *)
    cat "consense_$1.log"; echo "consense: unexpected rooted setting: $rline" >&2; exit 1 ;; esac
}

# --- deterministic odd-seed search -----------------------------------------
# Walk odd seeds from SEED_START: first seed whose extended-majority run
# has no tied decision wins (lab_chain_checks.R prints "TIE" to reject a
# candidate, writes the fixture and prints a summary to accept it).
SEED=""; VER=""
for cand in $(seq "$SEED_START" 2 "$SEED_MAX"); do
  echo "chain candidate seed $cand"
  fasta_to_phylip "$FIXDIR/inputs/$INPUT.fasta"

  run_seqboot "$cand"; mv outfile boot.txt
  [ -n "$VER" ] || VER="$(phylip_version seqboot.log)"
  [ "$(phylip_version seqboot.log)" = "$VER" ] || {
    echo "seqboot version changed between runs" >&2; exit 1; }

  run_dnadist_m boot.txt; mv outfile dist.txt
  [ "$(phylip_version dnadist.log)" = "$VER" ] || {
    echo "dnadist $(phylip_version dnadist.log) != seqboot $VER" >&2; exit 1; }

  run_neighbor_m dist.txt "$cand"; mv outtree trees.nwk; mv outfile neighbor.txt
  [ "$(phylip_version neighbor.log)" = "$VER" ] || {
    echo "neighbor $(phylip_version neighbor.log) != seqboot $VER" >&2; exit 1; }

  cp trees.nwk intree
  for kind in extended strict majority; do
    run_consense "$kind"
    mv outfile "cons_$kind.out"; mv outtree "cons_$kind.nwk"
    [ "$(phylip_version "consense_$kind.log")" = "$VER" ] || {
      echo "consense $(phylip_version "consense_$kind.log") != $VER" >&2; exit 1; }
  done

  verdict="$(FIXDIR="$FIXDIR" INPUT="$INPUT" REPS="$REPS" SEED="$cand" \
             GEN="phylip $VER (seqboot -> dnadist -> neighbor -> consense)" \
             Rscript "$FIXDIR/lab_chain_checks.R" | tail -1)"
  case "$verdict" in
    TIE) echo "  seed $cand: tied decision, next odd seed" ;;
    *)   SEED="$cand"; echo "  $verdict"; break ;;
  esac
done
[ -n "$SEED" ] || {
  echo "no tie-free odd seed in [$SEED_START, $SEED_MAX]" >&2; exit 1; }
