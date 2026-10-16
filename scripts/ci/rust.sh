#!/usr/bin/env bash
# Rust checks: fmt, clippy, workspace tests.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
step() { printf '\n== %s\n' "$1"; }

if [ -f Cargo.toml ]; then
  step "rust: fmt";    cargo fmt --all --check
  step "rust: clippy"; cargo clippy --workspace --all-targets -- -D warnings
  step "rust: tests";  cargo test --workspace
fi
