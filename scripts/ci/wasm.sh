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
  # WASM_PKG_HIT=true (set by CI when its crates/**+Cargo.lock-keyed cache
  # restored pkg/) skips the rebuild. The generated-types diff still runs:
  # it also verifies the restored files match the committed ones.
  if [ "${WASM_PKG_HIT:-}" = "true" ]; then
    step "wasm: pkg cache hit — skipping rebuild"
  else
    step "wasm: build + generated types up to date"
    scripts/build-wasm.sh
  fi
  git diff --exit-code web/src/engine/generated
fi

if [ -x scripts/check-bundle-size.sh ]; then
  step "wasm: bundle size"; scripts/check-bundle-size.sh
fi
