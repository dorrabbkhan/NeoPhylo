#!/usr/bin/env bash
# Quick iteration gate (scripts/check.sh quick). Always runs fmt + clippy;
# runs tests only for changed areas; rebuilds the wasm pkg only when its
# inputs (crates/**, Cargo.lock) changed. Skips e2e, R parity and fuzz —
# the default ./scripts/check.sh covers those before pushing.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
step() { printf '\n== %s\n' "$1"; }

# "Changed" = branch diff vs merge-base with main + uncommitted + untracked.
# If there is no merge-base (detached HEAD, no main) fall back to uncommitted
# changes only.
base="$(git merge-base HEAD main 2>/dev/null || true)"
changed="$( { if [ -n "$base" ]; then git diff --name-only "$base"; fi; \
             git status --porcelain=v1 | sed 's/^...//'; } | sort -u )"
crates_changed="$(grep -E '^(crates/|Cargo\.(toml|lock)$)' <<<"$changed" || true)"
web_changed="$(grep -E '^web/' <<<"$changed" || true)"

step "rust: fmt"
cargo fmt --all --check
step "rust: clippy"
cargo clippy --workspace --all-targets -- -D warnings

# Same local default as scripts/ci/rust.sh; PROPTEST_CASES stays overridable.
PROPTEST_CASES="${PROPTEST_CASES:-64}"
export PROPTEST_CASES

# Cache key: content hash of every crates/** source file plus Cargo.lock.
wasm_hash() {
  git ls-files -z -c -o --exclude-standard -- crates Cargo.lock \
    | sort -z | xargs -0 sha256sum | sha256sum | cut -d' ' -f1
}
hash_file="web/src/engine/pkg/.source-hash"
new_hash="$(wasm_hash)"
pkg_fresh=false
if [ -f "$hash_file" ] && [ "$(cat "$hash_file")" = "$new_hash" ]; then
  pkg_fresh=true
fi

if [ -n "$crates_changed" ]; then
  if command -v cargo-nextest >/dev/null 2>&1; then
    step "rust: tests (nextest, crates changed)"
    cargo nextest run --workspace
  else
    step "rust: tests (crates changed)"
    cargo test --workspace
  fi
else
  step "rust: tests — skipped (no crates/ changes)"
fi

if [ "$pkg_fresh" = false ]; then
  step "wasm: rebuild (crates/** or Cargo.lock changed, or no cache)"
  scripts/build-wasm.sh
  echo "$new_hash" > "$hash_file"
  git diff --exit-code web/src/engine/generated
  step "wasm: parity tests"
  wasm-pack test --node crates/neophylo-wasm
  scripts/check-bundle-size.sh
else
  step "wasm: pkg cache hit (${new_hash:0:12}) — skipping rebuild"
fi

if [ -n "$web_changed" ]; then
  step "web: unit tests for changed files"
  (cd web && { [ -d node_modules ] || npm ci; } && \
   npx vitest run --changed "${base:-HEAD}" --passWithNoTests)
else
  step "web: tests — skipped (no web/ changes)"
fi
