#!/usr/bin/env bash
# Usage: wait-ci.sh <PR> — block until the PR's checks finish (conductor
# efficiency plan Task 0a). The --watch output stays in a temp file (gh
# reprints the whole table each interval in non-TTY mode); we print the
# final `gh pr checks` table once and, for each failing job, the last 40
# lines of its failed log. Prints the head SHA it waited on and exits 3
# with HEAD MOVED if the head changed or the PR merged meanwhile, or with
# HEAD UNKNOWN if the head SHA/state cannot be read before or after the
# wait — a green table for a stale or unread head is not a result. Exits
# 5 with NO CHECKS when no check registers within WAIT_CI_MAX_S; exit 3
# stays reserved for HEAD MOVED/UNKNOWN. WAIT_CI_DEADLINE_S (conductor
# efficiency plan Task 0b, bounded waits) kills the watch at the deadline
# and exits 4 — a re-call resumes the wait.
set -euo pipefail
if [ "$#" -lt 1 ]; then
  echo "usage: wait-ci.sh <PR>" >&2
  exit 2
fi
pr="$1"
head_state() { gh pr view "$pr" --json headRefOid,state --jq '.headRefOid + " " + .state' 2>/dev/null || echo "? ?"; }
read -r sha0 state0 <<<"$(head_state)"
if [ -z "$sha0" ] || [ "$sha0" = "?" ] || [ -z "$state0" ] || [ "$state0" = "?" ]; then
  echo "wait-ci: HEAD UNKNOWN — could not read PR #$pr head SHA/state; not waiting"
  exit 3
fi
echo "wait-ci: PR #$pr waiting on ${sha0} (${state0})"
# Right after a push no checks are registered yet and --watch exits at once
# ("no checks reported"). Poll until at least one check exists, for at most
# WAIT_CI_MAX_S (default 300) at WAIT_CI_POLL_S (default 10) intervals.
# `gh pr checks --json` needs gh >= 2.50; older gh lacks it, so fall back
# to the statusCheckRollup length (same "checks registered" count).
poll_s="${WAIT_CI_POLL_S:-10}"
max_s="${WAIT_CI_MAX_S:-300}"
waited=0
while :; do
  n="$(gh pr checks "$pr" --json name --jq length 2>/dev/null \
    || gh pr view "$pr" --json statusCheckRollup --jq '.statusCheckRollup | length' 2>/dev/null \
    || echo 0)"
  [ "${n:-0}" -gt 0 ] 2>/dev/null && break
  if [ "$waited" -ge "$max_s" ]; then
    echo "wait-ci: NO CHECKS — no checks registered after ${max_s}s" >&2
    exit 5
  fi
  sleep "$poll_s"
  waited=$((waited + poll_s))
done
log="$(mktemp -t wait-ci.XXXXXX)"
rc=0
if [ -n "${WAIT_CI_DEADLINE_S:-}" ]; then
  # Bounded waits (conductor efficiency plan Task 0b): a foreground tool
  # call is capped at ~10 minutes. Watch in the background; at the
  # deadline kill the watch and exit 4 — a re-call resumes the wait.
  gh pr checks "$pr" --watch --fail-fast=false >"$log" 2>&1 &
  watch_pid=$!
  start=$SECONDS
  while kill -0 "$watch_pid" 2>/dev/null; do
    if [ $((SECONDS - start)) -ge "$WAIT_CI_DEADLINE_S" ]; then
      kill "$watch_pid" 2>/dev/null || true
      wait "$watch_pid" 2>/dev/null || true
      rm -f "$log"
      echo "wait-ci: deadline ${WAIT_CI_DEADLINE_S}s reached; the PR's checks are still running — re-call to resume" >&2
      exit 4
    fi
    sleep "$poll_s"
  done
  wait "$watch_pid" || rc=$?
else
  gh pr checks "$pr" --watch --fail-fast=false >"$log" 2>&1 || rc=$?
fi
gh pr checks "$pr" || true
read -r sha1 state1 <<<"$(head_state)"
if [ -z "$sha1" ] || [ "$sha1" = "?" ] || [ -z "$state1" ] || [ "$state1" = "?" ]; then
  echo "wait-ci: HEAD UNKNOWN — could not read PR #$pr head SHA/state after the wait; the table above may be stale"
  rm -f "$log"
  exit 3
fi
if [ "$state1" = "MERGED" ]; then
  echo "wait-ci: HEAD MOVED — PR #$pr merged while waiting (was ${sha0})"
  rm -f "$log"
  exit 3
fi
if [ "$sha1" != "$sha0" ]; then
  echo "wait-ci: HEAD MOVED — PR #$pr head was ${sha0}, now ${sha1} (${state1}); the table above is stale"
  rm -f "$log"
  exit 3
fi
if [ "$rc" -ne 0 ]; then
  # Same gh < 2.50 limit as the poll above: `pr checks` has no --json, so
  # the failing rows come from the plain non-TTY table (name, status,
  # elapsed, link — tab-separated).
  fails="$(gh pr checks "$pr" 2>/dev/null | awk -F'\t' '$2=="fail"{print $1"\t"$4}' || true)"
  if [ -n "$fails" ]; then
    echo "--- failing checks:"
    printf '%s\n' "$fails" | cut -f1
    printf '%s\n' "$fails" | cut -f2 | grep -oE 'job/[0-9]+' | sort -u | while read -r j; do
      job="${j#job/}"
      echo "--- job $job: last 40 failed-log lines"
      gh run view --job "$job" --log-failed 2>&1 | tail -40
    done
  fi
fi
rm -f "$log"
exit "$rc"
