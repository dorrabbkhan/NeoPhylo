#!/usr/bin/env bash
# Usage: devin.sh <kind: task|review|fix> <version> <task> [extra prompt file]
# Runs a fresh, non-interactive local Devin session; saves prompt + output;
# prints only the trimmed tail (conductor efficiency plan Task 0a, E5).
# VERIFY the flags below with `devin --help` on your version and adjust
# DEVIN_CMD once.
set -euo pipefail
# The body lives inside main(): bash parses a function completely before it
# runs, so a session that edits devin.sh itself can't corrupt the running
# script mid-read.
main() {
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
  REPO_DIR="${REPO:-$HOME/NeoPhylo}"
  ORIG="$(git -C "$REPO_DIR" symbolic-ref --short -q HEAD || git -C "$REPO_DIR" rev-parse HEAD)"
  OUT="$DIR/${KIND}-${STAMP}.out.md"
  trap restore_checkout EXIT
  run_devin
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
