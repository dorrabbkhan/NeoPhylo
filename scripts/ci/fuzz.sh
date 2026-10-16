#!/usr/bin/env bash
# Fuzz smoke: 60 s per target on nightly. Only runs with FUZZ=1.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
step() { printf '\n== %s\n' "$1"; }

if [ -d crates/neophylo-core/fuzz/fuzz_targets ] && [ "${FUZZ:-0}" = "1" ]; then
  step "fuzz: smoke, 60 s per target (FUZZ=1, nightly)"
  for t in fasta newick exercise; do
    # corpus/ is gitignored; seeds/ is committed.
    mkdir -p "crates/neophylo-core/fuzz/corpus/$t"
    ( cd crates/neophylo-core/fuzz && cargo +nightly fuzz run "$t" "corpus/$t" "seeds/$t" -- -max_total_time=60 )
  done
fi
