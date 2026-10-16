#!/usr/bin/env bash
# R export parity check. Only runs with RPARITY=1.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
step() { printf '\n== %s\n' "$1"; }

if [ -f web/scripts/r-parity.mjs ] && [ "${RPARITY:-0}" = "1" ]; then
  step "R export parity (RPARITY=1)"; ( cd web && node scripts/r-parity.mjs )
fi
