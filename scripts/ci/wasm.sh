#!/usr/bin/env bash
# Wasm checks: wasm-pack parity tests, engine build + generated types are
# up to date, bundle size.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
step() { printf '\n== %s\n' "$1"; }

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
