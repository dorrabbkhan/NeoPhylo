#!/usr/bin/env bash
# Usage: devin.sh <kind: task|review|fix> <version> <task> [extra prompt file]
# Runs a fresh, non-interactive local Devin session; saves prompt + output;
# prints only the trimmed tail (conductor efficiency plan Task 0a, E5).
# DEVIN_DETACH=1 starts the session detached (setsid nohup), writes <out>.md
# then <out>.rc on exit, prints the .out.md path and returns at once — join
# it with wait-for.sh <out.md> (bounded waits, conductor efficiency plan
# Task 0b). VERIFY the flags below with `devin --help` on your version and
# adjust DEVIN_CMD once.
set -euo pipefail
# The body lives inside main(): bash parses a function completely before it
# runs, so a session that edits devin.sh itself can't corrupt the running
# script mid-read.
main() {
  HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  DEVIN_CMD=(devin --sandbox --permission-mode bypass -p)
  # Restore messages go to stderr AND the end of the saved output, so a caller that discards
  # stderr still sees them when it reads the .out.md file.
  note() { echo ">>> devin.sh: $*" | tee -a "$OUT" >&2; }
  # Devin checks its task branch out in the shared checkout and leaves it there. Put the checkout
  # back on the branch it started on, so the conductor and the next session start from there.
  # Only when no tracked file is modified: never discard or carry over a session's work.
  restore_checkout() {
    local now
    now="$(git -C "$REPO_DIR" symbolic-ref --short -q HEAD || git -C "$REPO_DIR" rev-parse HEAD)"
    [ "$now" = "$ORIG" ] && return 0
    if [ -n "$(git -C "$REPO_DIR" status --porcelain --untracked-files=no)" ]; then
      note "left on $now (tracked changes present), not restoring $ORIG"
    elif git -C "$REPO_DIR" checkout -q "$ORIG" 2>/dev/null; then
      note "checkout restored from $now to $ORIG"
    else
      note "could NOT restore $ORIG (left on $now); another worktree probably holds it"
    fi
  }
  run_devin() {
    set +e
    ( cd "$REPO_DIR" && "${DEVIN_CMD[@]}" --prompt-file "$PROMPT" ) >"$OUT" 2>&1
    SESSION_RC=$?
    set -e
  }
  # Internal: --detached-worker <repo_dir> <orig> <prompt> <out> — the
  # detached half of a DEVIN_DETACH=1 call; runs the session, restores the
  # checkout and writes <out>.rc. Never invoke directly.
  if [ "${1:-}" = "--detached-worker" ]; then
    REPO_DIR="$2"; ORIG="$3"; PROMPT="$4"; OUT="$5"
    # The parent resolved the session model and hands it down as
    # DEVIN_MODEL (the same env an operator can set to override).
    [ -n "${DEVIN_MODEL:-}" ] && DEVIN_CMD+=(--model "$DEVIN_MODEL")
    trap restore_checkout EXIT
    run_devin
    note "model: ${DEVIN_MODEL:-<devin default — no --model flag>}"
    restore_checkout
    trap - EXIT
    printf '%s\n' "$SESSION_RC" >"$OUT.rc"
    exit "$SESSION_RC"
  fi
  KIND="$1"; VER="$2"; N="$3"; EXTRA="${4:-}"
  DIR="$HOME/neophylo-conductor/${VER}-task${N}"; mkdir -p "$DIR"
  STAMP="$(date +%Y%m%d-%H%M%S)"
  PROMPT="$DIR/${KIND}-${STAMP}.prompt.md"
  if [ -n "$EXTRA" ]; then cp "$EXTRA" "$PROMPT"; else cat > "$PROMPT"; fi
  # build-prompt.sh | devin.sh: when build-prompt.sh fails (unknown version or task) the pipe
  # delivers nothing — never start a session on an empty prompt.
  if [ ! -s "$PROMPT" ]; then
    echo "devin.sh: empty prompt (did build-prompt.sh fail?), not starting a session" >&2
    rm -f "$PROMPT"; exit 2
  fi
  # Devin acts as the neophylo-conductor GitHub App, never as the owner.
  # shellcheck disable=SC1091
  source "$(dirname "$0")/app-env.sh"
  # --model for the session: an explicit DEVIN_MODEL wins (the conductor's
  # one-time Opus fallback), else the plan's Devin column via
  # plan-index.sh, else nothing — devin's own default (v1.5 plan Task 1).
  MODEL="${DEVIN_MODEL:-$("$HERE/plan-index.sh" devin "$VER" "$N" || true)}"
  [ -n "$MODEL" ] && DEVIN_CMD+=(--model "$MODEL")
  REPO_DIR="${REPO:-$HOME/NeoPhylo}"
  ORIG="$(git -C "$REPO_DIR" symbolic-ref --short -q HEAD || git -C "$REPO_DIR" rev-parse HEAD)"
  OUT="$DIR/${KIND}-${STAMP}.out.md"
  if [ "${DEVIN_DETACH:-}" = "1" ]; then
    # A foreground tool call is capped at ~10 minutes and headless `claude
    # -p` has no t3_background_wait: the session runs detached and
    # wait-for.sh <out.md> joins it (plan Task 0b).
    DEVIN_MODEL="$MODEL" setsid nohup bash "$HERE/devin.sh" \
      --detached-worker "$REPO_DIR" "$ORIG" "$PROMPT" "$OUT" \
      </dev/null >/dev/null 2>&1 &
    printf '%s\n' "$OUT"
    exit 0
  fi
  trap restore_checkout EXIT
  run_devin
  note "model: ${MODEL:-<devin default — no --model flag>}"
  restore_checkout
  trap - EXIT
  printf '%s\n' "$SESSION_RC" >"$OUT.rc"
  # Stdout is only the session's last 30 lines plus its PR_URL:/STOP: lines;
  # the full output stays in the saved .out.md (conductor efficiency plan
  # Task 0a, evidence E5).
  { tail -30 "$OUT"; grep -E '^(PR_URL|STOP):' "$OUT" || true; } | awk '!seen[$0]++'
  exit "$SESSION_RC"
}
main "$@"
exit
