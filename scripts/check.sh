#!/usr/bin/env bash
# Local replacement for CI. Run from anywhere in the repo: ./scripts/check.sh
# Each section only runs once the thing it checks exists, so this works from Task 1 onward.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
step() { printf '\n== %s\n' "$1"; }

step "fixture guard"
if git rev-parse --verify -q main >/dev/null; then
  base=$(git merge-base HEAD main)
  changed=$(git diff --name-only "$base")   # committed + uncommitted changes on this branch
  if grep -q '^fixtures/' <<<"$changed" && grep -qE '^(crates|web)/' <<<"$changed"; then
    echo "FAIL: fixtures/ changed together with engine or web code. Split into separate branches."
    exit 1
  fi
fi
echo ok

if [ -f Cargo.toml ]; then
  step "rust: fmt";    cargo fmt --all --check
  step "rust: clippy"; cargo clippy --workspace --all-targets -- -D warnings
  step "rust: tests";  cargo test --workspace
fi

if [ -d crates/neophylo-wasm/tests ]; then
  step "wasm: parity tests"; wasm-pack test --node crates/neophylo-wasm
fi

if [ -x scripts/build-wasm.sh ]; then
  step "wasm: build + generated types up to date"
  scripts/build-wasm.sh
  git diff --exit-code web/src/engine/generated
fi

if [ -x scripts/check-bundle-size.sh ]; then
  step "wasm: bundle size"; scripts/check-bundle-size.sh
fi

if [ -f web/package.json ]; then
  step "web: lint, test, build"
  ( cd web
    [ -d node_modules ] || npm ci
    npm run lint
    npm test
    npm run build )
fi

if [ -f web/playwright.config.ts ] && [ "${E2E:-0}" = "1" ]; then
  step "web: e2e (E2E=1)"; ( cd web && npx playwright test )
fi

if [ -f web/scripts/r-parity.mjs ] && [ "${RPARITY:-0}" = "1" ]; then
  step "R export parity (RPARITY=1)"; ( cd web && node scripts/r-parity.mjs )
fi

printf '\nALL CHECKS PASSED\n'
