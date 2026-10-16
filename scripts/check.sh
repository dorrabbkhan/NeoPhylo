#!/usr/bin/env bash
# Local replacement for CI. Run from anywhere in the repo: ./scripts/check.sh
# Thin runner: each step lives in scripts/ci/ and is standalone (set -euo
# pipefail, cd to repo root). The env gates are unchanged — E2E=1, RPARITY=1,
# FUZZ=1 opt into their steps; FIXTURES=1 regenerates fixtures; BASE overrides
# the fixture-guard base commit; ALLOW_FIXTURE_CHANGE=1 skips it (human only).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

scripts/ci/fixture-guard.sh
scripts/ci/rust.sh
scripts/ci/wasm.sh
scripts/ci/web.sh
scripts/ci/fuzz.sh
scripts/ci/e2e.sh
scripts/ci/r-parity.sh

printf '\nALL CHECKS PASSED\n'
