#!/usr/bin/env bash
# Usage: judge.sh <PR> <version> <task> — run the mechanical judgment rules
# (conductor efficiency plan Task 0a) against the PR's diff. Extra args pass
# through to judge.ts (e.g. --claimed, --events, --report-dir).
set -euo pipefail
if [ "$#" -lt 3 ]; then
  echo "usage: judge.sh <PR> <version> <task> [--claimed <out.md> …] [--events <json|file>] …" >&2
  exit 2
fi
cd "$(git rev-parse --show-toplevel)"
exec node scripts/conductor/judge.ts --pr "$1" --version "$2" --task "$3" "${@:4}"
