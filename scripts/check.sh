#!/usr/bin/env bash
# Local replacement for CI. Run from anywhere in the repo.
#
#   ./scripts/check.sh        full local gate (minus e2e): run once before
#                             pushing, same checks the PR workflow runs
#   ./scripts/check.sh quick  iteration gate: fmt + clippy always, tests
#                             only for changed areas, wasm rebuild only
#                             when crates/** or Cargo.lock changed
#
# Thin runner: each step lives in scripts/ci/ and is standalone (set -euo
# pipefail, cd to repo root). The env gates are unchanged — E2E=1, RPARITY=1,
# FUZZ=1 opt into their steps (e2e stays opt-in locally; CI runs it);
# FIXTURES=1 regenerates fixtures; BASE overrides the fixture-guard base
# commit; ALLOW_FIXTURE_CHANGE=1 skips it (human only).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

mode="${1:-}"
case "$mode" in
  ""|quick) ;;
  *) echo "usage: $0 [quick]" >&2; exit 2 ;;
esac

if [ "$mode" = "quick" ]; then
  scripts/ci/fixture-guard.sh
  scripts/ci/quick.sh
  printf '\nQUICK CHECKS PASSED (run ./scripts/check.sh before pushing)\n'
  exit 0
fi

scripts/ci/fixture-guard.sh
scripts/ci/rust.sh
scripts/ci/wasm.sh
scripts/ci/web.sh
scripts/ci/fuzz.sh
scripts/ci/e2e.sh
scripts/ci/r-parity.sh

printf '\nALL CHECKS PASSED\n'
