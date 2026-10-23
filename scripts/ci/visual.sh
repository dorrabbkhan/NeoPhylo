#!/usr/bin/env bash
# Visual snapshot matrix (v1.3 Task 5, spec §8.3): the `visual`
# Playwright project — Chromium only, scenes × viewports × themes
# against the owner-approved baselines in web/e2e/__screenshots__/.
# Regenerate baselines with --update-snapshots (owner approval needed
# for the resulting diff).
set -euo pipefail
# Same git-rev-parse cd as the other ci scripts: in the job container
# (foreign-owned workspace, HOME=/root) the substitution may come back
# empty, and `cd ""` is a no-op there — the step's cwd is already the
# repo root, so both cases land correctly.
cd "$(git rev-parse --show-toplevel)"
step() { printf '\n== %s\n' "$1"; }

step "web: visual snapshots"
( cd web && npx playwright test e2e/visual.spec.ts --project=visual "$@" )
