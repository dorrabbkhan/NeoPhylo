#!/usr/bin/env bash
# Usage: wait-for.sh <out.md> [max_s=540] — join a detached Devin session
# (conductor efficiency plan Task 0b, bounded waits). devin.sh
# DEVIN_DETACH=1 writes <out>.md while the session runs and <out>.rc when
# it exits; this blocks until <out>.rc exists, prints devin.sh's trimmed
# stdout (last 30 lines + every PR_URL:/STOP: line, de-duplicated) and
# exits with the session's rc. After max_s it prints "PENDING <n> lines"
# and exits 4 — a re-call resumes the wait (the session keeps running).
set -euo pipefail
if [ "$#" -lt 1 ]; then
  echo "usage: wait-for.sh <out.md> [max_s=540]" >&2
  exit 2
fi
OUT="$1"
MAX="${2:-${WAIT_FOR_MAX_S:-540}}"
POLL="${WAIT_FOR_POLL_S:-5}"
RC="$OUT.rc"
start=$SECONDS
while [ ! -f "$RC" ]; do
  if [ $((SECONDS - start)) -ge "$MAX" ]; then
    n=0
    { [ -f "$OUT" ] && n="$(wc -l <"$OUT")"; } || true
    echo "PENDING $n lines"
    exit 4
  fi
  sleep "$POLL"
done
{ tail -30 "$OUT"; grep -E '^(PR_URL|STOP):' "$OUT" || true; } | awk '!seen[$0]++'
exit "$(cat "$RC")"
