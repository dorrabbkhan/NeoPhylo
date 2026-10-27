#!/usr/bin/env bash
# Fixture guard: existing fixtures may not change in the same commit as code.
# The base commit comes from $BASE (default: merge-base of HEAD with main;
# the whole guard is skipped when neither is available). Adding new fixture
# files is allowed. ALLOW_FIXTURE_CHANGE=1 skips the guard (human only).
# Also regenerates fixtures when FIXTURES=1.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
step() { printf '\n== %s\n' "$1"; }

step "fixture guard"
if [ "${ALLOW_FIXTURE_CHANGE:-0}" = "1" ]; then
  echo "SKIPPED: human override (ALLOW_FIXTURE_CHANGE=1)"
elif [ -n "${BASE:-}" ] || git rev-parse --verify -q main >/dev/null; then
  base="${BASE:-$(git merge-base HEAD main)}"
  # Existing fixtures modified/deleted/renamed. Adding new fixture files is allowed.
  fixtures_touched=$(git diff --name-only --diff-filter=MDR "$base" -- fixtures/ || true)
  code_touched=$(git diff --name-only "$base" -- crates/ web/ || true)
  if [ -n "$fixtures_touched" ] && [ -n "$code_touched" ]; then
    echo "FAIL: existing fixtures changed together with code:"; echo "$fixtures_touched"
    exit 1
  fi
  echo ok
fi

if [ -f fixtures/generate.R ] && [ "${FIXTURES:-0}" = "1" ]; then
  step "fixtures: regenerate (FIXTURES=1)"
  # generate_phylip.sh runs first: generate.R merges the phangorn second
  # opinion into the protdist-produced ref/protein_*.json files and
  # tie-checks protdist's JTT matrices, so it needs them on disk.
  # (generate_phylip.sh also invokes generate_consensus.sh, which merges
  # consense into fixtures/consensus/*.json and worked/consensus_hand.json;
  # generate.R then regenerates those files and preserves the consense
  # block while the trees are identical, so committed output is stable.
  # generate_phylip.sh ends with generate_lab_chain.sh, which writes
  # phylip/chain/*_boot*.json.)
  bash fixtures/generate_phylip.sh
  Rscript fixtures/generate.R
  # fixtures/phylip (f84, k2p, chain) is diffed too: everything the
  # regeneration writes must be byte-stable.
  git diff --exit-code fixtures/ref fixtures/consensus fixtures/worked fixtures/phylip
  # also catch new/stray files under the regenerated dirs
  if [ -n "$(git status --porcelain fixtures/ref fixtures/consensus fixtures/worked fixtures/phylip)" ]; then
    echo "FAIL: fixtures changed after regeneration"; git status --porcelain fixtures/ref fixtures/consensus fixtures/worked fixtures/phylip; exit 1
  fi
fi
