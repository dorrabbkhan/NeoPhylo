#!/usr/bin/env bash
# Create (or remove) one git worktree per task for parallel agent sessions.
# Usage: parallel-worktrees.sh setup 12 13 15     |     parallel-worktrees.sh cleanup 12 13 15
set -euo pipefail
ACTION="${1:?setup|cleanup}"; shift
REPO="${REPO:-$HOME/NeoPhylo}"
cd "$REPO"

case "$ACTION" in
  setup)
    git fetch origin
    for t in "$@"; do
      dir="$REPO-task$t"
      if [ -d "$dir" ]; then echo "exists: $dir (skipping)"; continue; fi
      git worktree add --detach "$dir" origin/main      # detached: avoids the "main already checked out" error
      echo "installing web dependencies in $dir ..."
      (cd "$dir/web" && npm ci --silent)
    done
    git worktree list ;;
  cleanup)
    for t in "$@"; do
      dir="$REPO-task$t"
      [ -d "$dir" ] && git worktree remove --force "$dir" && echo "removed $dir"
    done
    git worktree prune
    git worktree list ;;
  *) echo "usage: $0 setup|cleanup <task numbers>"; exit 1 ;;
esac