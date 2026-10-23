#!/usr/bin/env bash
# Visual snapshot matrix (v1.3 Task 5, spec §8.3): the `visual`
# Playwright project — Chromium only, scenes × viewports × themes
# against the owner-approved baselines in web/e2e/__screenshots__/.
# Regenerate baselines with --update-snapshots (owner approval needed
# for the resulting diff).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)/web"
npx playwright test e2e/visual.spec.ts --project=visual "$@"
