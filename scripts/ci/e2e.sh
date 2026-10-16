#!/usr/bin/env bash
# Playwright e2e tests. Only runs with E2E=1.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
step() { printf '\n== %s\n' "$1"; }

if [ -f web/playwright.config.ts ] && [ "${E2E:-0}" = "1" ]; then
  # Extra args pass through to playwright test (CI uses them to select one
  # browser project per matrix leg and to request the HTML report).
  step "web: e2e (E2E=1)"; ( cd web && npx playwright test "$@" )
fi
