#!/usr/bin/env bash
# Usage: usage-report.sh [--since YYYY-MM-DD] [--version vX.Y[,vX.Z…]] [--json]
#   [--projects-dir <dir>]
# Per-session and per-task Claude Code usage from the session logs
# (conductor efficiency plan Task 0a). Aggregates only — never prompt text
# or tool inputs/outputs.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node scripts/conductor/usage-report.ts "$@"
