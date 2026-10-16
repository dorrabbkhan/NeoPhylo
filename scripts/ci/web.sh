#!/usr/bin/env bash
# Web checks: lint, unit tests, build.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
step() { printf '\n== %s\n' "$1"; }

if [ -f web/package.json ]; then
  step "web: lint, test, build"
  ( cd web
    [ -d node_modules ] || npm ci
    npm run lint
    npm test
    npm run build )
fi
