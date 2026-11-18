#!/usr/bin/env bash
# Usage: run-plan.sh <version> <from-task> <to-task>
# Runs one fresh headless Claude Code session per plan task (conductor
# efficiency plan Task 0b):
#
#   claude -p "/conduct <version> <id>" --model <opus|sonnet> \
#     --allowedTools "<specs from headless-tools.txt>"
#
# Task order and ids come from the plan's Task Index table (ids like 0b,
# 11, 7a); <from>/<to> select a contiguous range by table position. The id
# column is "#" when present, else "Task". The model comes from the
# Conductor column (Opus → opus, Sonnet → sonnet); a plan with no
# Conductor column defaults to opus with a warning, and any other value
# is an error. The plan file is the docs/superpowers/plans/*neophylo-<version>-*.md
# whose Task Index contains both ids; PLAN_FILE=<path> overrides it (used
# by the dry-run fixtures under fixtures/run-plan/).
#
# After each session the script reads the last non-empty line of the
# region this session appended to the task's
# ~/neophylo-conductor/<version>-task<id>/conductor-log.md (the line count
# is recorded before the session; a stale RESULT from an earlier run, or
# an appended region of only blank lines, does not count) — and treats it
# as a RESULT only if it starts with "RESULT: ":
#   RESULT: READY <PR>              → poll `gh pr view <PR> --json state`
#                                     every RUN_PLAN_POLL_S (default 300)
#                                     seconds until MERGED, then run
#                                     /inbox headless on sonnet, then the
#                                     next task; any state other than
#                                     OPEN/MERGED/CLOSED (UNKNOWN, or gh
#                                     failing) for 3 consecutive polls
#                                     stops the run
#   RESULT: ESCALATED|GATE|FAILED   → notify.sh and stop
#   missing/unparseable             → notify.sh and stop
# It never merges and never starts a session while a previous task's PR is
# still open.
#
# DRY_RUN=1 prints the `claude -p` command(s) it would run and exits 0
# without starting sessions, polling, or notifying.
set -euo pipefail
if [ "$#" -ne 3 ]; then
  echo "usage: run-plan.sh <version> <from-task> <to-task>" >&2
  echo "  env: PLAN_FILE=<plan.md> override, DRY_RUN=1 print only," >&2
  echo "       RUN_PLAN_POLL_S=<n> merge-poll interval (default 300)," >&2
  echo "       RUN_PLAN_DIR=<dir> session dir override (default ~/neophylo-conductor)" >&2
  exit 2
fi
VER="$1"; FROM="$2"; TO="$3"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(git -C "$HERE" rev-parse --show-toplevel)"
cd "$ROOT"
TOOLS="$HERE/headless-tools.txt"
POLL_S="${RUN_PLAN_POLL_S:-300}"

# --- the Task Index table as "id<TAB>model<TAB>has-conductor" per row ---
# Columns are located by header name, so extra columns (Gate, Depends on,
# …) can sit anywhere. The id column is "#" when the table has one, else
# "Task".
parse_index() {
  awk '
    /^##[[:space:]]+Task Index/ { inix=1; next }
    inix && /^[[:space:]]*\|/ {
      n = split($0, f, "|")
      if (!hdr) {
        for (i = 1; i <= n; i++) {
          h = f[i]; gsub(/^[ \t]+|[ \t]+$/, "", h)
          if (h == "#") cid = i
          if (h == "Task") ctask = i
          if (h == "Conductor") cmod = i
        }
        if (!cid) cid = ctask
        hdr = 1; next
      }
      id = f[cid]; gsub(/^[ \t]+|[ \t]+$/, "", id)
      if (id ~ /^-+$/) next
      mod = cmod ? f[cmod] : ""
      gsub(/^[ \t]+|[ \t]+$/, "", mod)
      printf "%s\t%s\t%s\n", id, mod, (cmod ? 1 : 0)
      next
    }
    inix && hdr { exit }
  ' "$1"
}

# --- resolve the plan file (PLAN_FILE override, else the *neophylo-<VER>-*
#     plan whose Task Index contains both ids) ---
if [ -n "${PLAN_FILE:-}" ]; then
  PLAN="$PLAN_FILE"
  [ -f "$PLAN" ] || { echo "run-plan.sh: PLAN_FILE $PLAN does not exist" >&2; exit 2; }
else
  PLAN=""
  shopt -s nullglob
  for f in "$ROOT"/docs/superpowers/plans/*neophylo-"$VER"-*.md; do
    ids="$(parse_index "$f" | cut -f1)"
    if grep -qx "$FROM" <<<"$ids" && grep -qx "$TO" <<<"$ids"; then
      if [ -n "$PLAN" ]; then
        echo "run-plan.sh: tasks $FROM and $TO appear in the Task Index of more than one plan ($PLAN, $f)" >&2
        exit 2
      fi
      PLAN="$f"
    fi
  done
  shopt -u nullglob
  if [ -z "$PLAN" ]; then
    echo "run-plan.sh: no plan under docs/superpowers/plans/*neophylo-$VER-*.md has both $FROM and $TO in its Task Index" >&2
    exit 2
  fi
fi
[ -f "$TOOLS" ] || { echo "run-plan.sh: $TOOLS missing" >&2; exit 2; }

mapfile -t INDEX < <(parse_index "$PLAN")
[ "${#INDEX[@]}" -gt 0 ] || { echo "run-plan.sh: no Task Index table in $PLAN" >&2; exit 2; }
HASCOL="${INDEX[0]##*$'\t'}"

IDS=(); MODS=()
for row in "${INDEX[@]}"; do
  IDS+=("${row%%$'\t'*}")
  rest="${row#*$'\t'}"
  MODS+=("${rest%%$'\t'*}")
done
pos() { local want="$1" i; for i in "${!IDS[@]}"; do [ "${IDS[$i]}" = "$want" ] && { echo "$i"; return 0; }; done; return 1; }
PI="$(pos "$FROM")" || { echo "run-plan.sh: task id '$FROM' not in $PLAN Task Index (${IDS[*]})" >&2; exit 2; }
QI="$(pos "$TO")"   || { echo "run-plan.sh: task id '$TO' not in $PLAN Task Index (${IDS[*]})" >&2; exit 2; }
[ "$QI" -ge "$PI" ] || { echo "run-plan.sh: '$TO' comes before '$FROM' in the Task Index" >&2; exit 2; }

if [ "$HASCOL" != "1" ]; then
  echo "run-plan.sh: $PLAN Task Index has no Conductor column; defaulting every task to opus" >&2
fi
model_for() {
  if [ "$HASCOL" != "1" ]; then echo opus; return 0; fi
  case "$1" in
    Opus|opus) echo opus ;;
    Sonnet|sonnet) echo sonnet ;;
    *) return 1 ;;
  esac
}

# Comment/blank lines in headless-tools.txt are documentation; join the rest.
ALLOWED="$(grep -vE '^[[:space:]]*(#|$)' "$TOOLS" | paste -sd, -)"
DIR_BASE="${RUN_PLAN_DIR:-$HOME/neophylo-conductor}"

stop_with() {
  "$HERE/notify.sh" "run-plan $VER: $1" || true
  echo "run-plan.sh: $1" >&2
  exit 1
}

for ((i = PI; i <= QI; i++)); do
  ID="${IDS[$i]}"; COND="${MODS[$i]}"
  MODEL="$(model_for "$COND")" \
    || { echo "run-plan.sh: task $ID Conductor column is '$COND', expected Opus or Sonnet" >&2; exit 2; }
  CMD=(claude -p "/conduct $VER $ID" --model "$MODEL" --allowedTools "$ALLOWED")
  TASKDIR="$DIR_BASE/$VER-task$ID"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  OUT="$TASKDIR/headless-$STAMP.out"

  if [ "${DRY_RUN:-}" = "1" ]; then
    printf 'DRY_RUN: claude -p "/conduct %s %s" --model %s --allowedTools "%s" > %s\n' \
      "$VER" "$ID" "$MODEL" "$ALLOWED" "$OUT"
    continue
  fi

  # Before each next task: process owner commands headless on Sonnet.
  # A failed inbox means "conductor: hold" could be missed — stop rather
  # than start the next task blind.
  if [ "$i" -gt "$PI" ]; then
    INBOXDIR="$DIR_BASE/$VER-inbox"; mkdir -p "$INBOXDIR"
    IOUT="$INBOXDIR/inbox-$STAMP.out"
    echo "run-plan.sh: running /inbox (sonnet) → $IOUT"
    set +e
    ( cd "$ROOT" && claude -p "/inbox" --model sonnet --allowedTools "$ALLOWED" ) >"$IOUT" 2>&1
    irc=$?
    set -e
    [ "$irc" -eq 0 ] || stop_with "inbox session before task $ID exited $irc (output $IOUT)"
  fi

  mkdir -p "$TASKDIR"
  LOG="$TASKDIR/conductor-log.md"
  LINES_BEFORE=0
  { [ -f "$LOG" ] && LINES_BEFORE="$(wc -l <"$LOG")"; } || true
  echo "run-plan.sh: starting task $ID ($MODEL) → $OUT"
  set +e
  ( cd "$ROOT" && "${CMD[@]}" ) >"$OUT" 2>&1
  rc=$?
  set -e
  echo "run-plan.sh: task $ID session exited $rc"

  LINES_AFTER=0
  { [ -f "$LOG" ] && LINES_AFTER="$(wc -l <"$LOG")"; } || true
  [ "$LINES_AFTER" -gt "$LINES_BEFORE" ] \
    || stop_with "task $ID: no new RESULT: line in $LOG (session rc=$rc, output $OUT)"
  LAST="$(tail -n "+$((LINES_BEFORE + 1))" "$LOG" | awk 'NF{l=$0} END{print l}')"
  RESULT=""
  case "$LAST" in "RESULT: "*) RESULT="$LAST" ;; esac
  case "$RESULT" in
    "RESULT: READY "*)
      PR="${RESULT#RESULT: READY }"; PR="${PR%%[[:space:]]*}"
      [ -n "$PR" ] || stop_with "task $ID: 'RESULT: READY' without a PR"
      echo "run-plan.sh: task $ID ready, waiting for PR $PR to merge (poll ${POLL_S}s)"
      UNKNOWN_POLLS=0
      while :; do
        state="$(gh pr view "$PR" --json state --jq .state 2>/dev/null || echo UNKNOWN)"
        case "$state" in
          MERGED) echo "run-plan.sh: PR $PR merged"; break ;;
          CLOSED) stop_with "task $ID: PR $PR closed without merge" ;;
          OPEN) UNKNOWN_POLLS=0; sleep "$POLL_S" ;;
          *)
            UNKNOWN_POLLS=$((UNKNOWN_POLLS + 1))
            [ "$UNKNOWN_POLLS" -lt 3 ] || stop_with "task $ID: PR $PR state '$state' for $UNKNOWN_POLLS consecutive polls"
            sleep "$POLL_S" ;;
        esac
      done
      ;;
    "RESULT: READY"*)     stop_with "task $ID: 'RESULT: READY' without a PR" ;;
    "RESULT: ESCALATED"*) stop_with "task $ID escalated (see $LOG)" ;;
    "RESULT: GATE"*)      stop_with "task $ID stopped at an owner gate (see $LOG)" ;;
    "RESULT: FAILED"*)    stop_with "task $ID failed (see $LOG)" ;;
    *) stop_with "task $ID: no RESULT: line in $LOG (session rc=$rc, output $OUT)" ;;
  esac
done

[ "${DRY_RUN:-}" = "1" ] || echo "run-plan.sh: tasks $FROM..$TO of $VER done"
exit 0
