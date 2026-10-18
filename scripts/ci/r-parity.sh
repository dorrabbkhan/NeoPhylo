#!/usr/bin/env bash
# R export parity check. Only runs with RPARITY=1.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
step() { printf '\n== %s\n' "$1"; }

if [ -f web/scripts/r-parity.mjs ] && [ "${RPARITY:-0}" = "1" ]; then
  # The parity script also round-trips the exported PHYLIP matrix
  # through `neighbor` (v1.1 Task 13): locate the binary the same way
  # fixtures/generate_phylip.sh does.
  if command -v neighbor >/dev/null 2>&1; then
    PHYLIP_NEIGHBOR="$(command -v neighbor)"
  elif [ -x /usr/lib/phylip/bin/neighbor ]; then
    PHYLIP_NEIGHBOR=/usr/lib/phylip/bin/neighbor
  else
    echo "missing PHYLIP binary: neighbor (install the phylip package)" >&2
    exit 1
  fi
  export PHYLIP_NEIGHBOR
  step "R export parity (RPARITY=1)"; ( cd web && node scripts/r-parity.mjs )
fi
