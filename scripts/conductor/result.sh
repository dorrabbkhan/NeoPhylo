#!/usr/bin/env bash
# Usage: result.sh <version> <task> <READY <pr>|ESCALATED|GATE|FAILED>
# Appends exactly one "RESULT: <value>" line as the last line of the
# task's <dir>/<version>-task<id>/conductor-log.md (conductor efficiency
# plan Task 0b). Headless /conduct sessions have no echo/printf on the
# allow list, so the RESULT line goes through this script instead —
# covered by the existing Bash(scripts/conductor/*). The value is
# validated first: READY must carry a PR number; the only other accepted
# values are ESCALATED, GATE and FAILED. Anything else (or a missing
# argument) exits 2 with nothing written. RUN_PLAN_DIR overrides
# ~/neophylo-conductor for tests, as in run-plan.sh.
set -euo pipefail
if [ "$#" -lt 3 ]; then
  echo "usage: result.sh <version> <task> <READY <pr>|ESCALATED|GATE|FAILED>" >&2
  exit 2
fi
VER="$1"; TASK="$2"; shift 2
VALUE="$*"
case "$VALUE" in
  ESCALATED|GATE|FAILED)
    LINE="RESULT: $VALUE" ;;
  "READY "*)
    PR="${VALUE#READY }"
    case "$PR" in
      *[!0-9]*|"")
        echo "result.sh: READY needs a PR number, got '$VALUE'" >&2
        exit 2 ;;
    esac
    LINE="RESULT: READY $PR" ;;
  *)
    echo "result.sh: expected 'READY <pr>', ESCALATED, GATE or FAILED, got '$VALUE'" >&2
    exit 2 ;;
esac
DIR_BASE="${RUN_PLAN_DIR:-$HOME/neophylo-conductor}"
TASKDIR="$DIR_BASE/$VER-task$TASK"
mkdir -p "$TASKDIR"
printf '%s\n' "$LINE" >> "$TASKDIR/conductor-log.md"
