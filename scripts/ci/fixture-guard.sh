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
  Rscript fixtures/generate.R
  bash fixtures/generate_phylip.sh
  git diff --exit-code fixtures/ref
  # also catch new/stray files under ref/
  if [ -n "$(git status --porcelain fixtures/ref)" ]; then
    echo "FAIL: fixtures/ref changed after regeneration"; git status --porcelain fixtures/ref; exit 1
  fi
fi
