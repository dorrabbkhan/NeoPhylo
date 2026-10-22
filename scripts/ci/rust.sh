#!/usr/bin/env bash
# Rust checks: fmt, clippy, workspace tests.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
step() { printf '\n== %s\n' "$1"; }

# Property tests read PROPTEST_CASES (proptest's own env var): 64 cases is
# enough for local iteration; CI keeps the full default count (256). Tests
# with an explicit `with_cases(...)` (the JTT weighted test) are unaffected.
if [ -z "${PROPTEST_CASES:-}" ]; then
  if [ "${CI:-}" = "true" ]; then PROPTEST_CASES=256; else PROPTEST_CASES=64; fi
fi
export PROPTEST_CASES

if [ -f Cargo.toml ]; then
  step "rust: fmt";    cargo fmt --all --check
  step "rust: clippy"; cargo clippy --workspace --all-targets -- -D warnings
  if command -v cargo-nextest >/dev/null 2>&1; then
    step "rust: tests (nextest)"; cargo nextest run --workspace
    # nextest skips doctests; keep them covered (currently 0 tests).
    step "rust: doctests"; cargo test --doc --workspace
  else
    step "rust: tests";  cargo test --workspace
  fi
fi

if [ -f scripts/gen_models.py ]; then
  step "rust: model constants"
  if ! python3 -c 'import numpy' 2>/dev/null; then
    python3 -m pip install 'numpy==2.4.6'
  fi
  python3 scripts/gen_models.py --check
fi
