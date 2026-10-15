#!/usr/bin/env bash
# Local replacement for CI. Run from anywhere in the repo: ./scripts/check.sh
# Each section only runs once the thing it checks exists, so this works from Task 1 onward.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
step() { printf '\n== %s\n' "$1"; }

step "fixture guard"
if [ "${ALLOW_FIXTURE_CHANGE:-0}" = "1" ]; then
  echo "SKIPPED: human override (ALLOW_FIXTURE_CHANGE=1)"
elif git rev-parse --verify -q main >/dev/null; then
  base=$(git merge-base HEAD main)
  # Existing fixtures modified/deleted/renamed. Adding new fixture files is allowed.
  fixtures_touched=$(git diff --name-only --diff-filter=MDR "$base" -- fixtures/ || true)
  code_touched=$(git diff --name-only "$base" -- crates/ web/ || true)
  if [ -n "$fixtures_touched" ] && [ -n "$code_touched" ]; then
    echo "FAIL: existing fixtures changed together with code:"; echo "$fixtures_touched"
    exit 1
  fi
  echo ok
fi

if [ -f fixtures/generate.R ] && [ "${FIXTURES:-0}" = "1" ]; then
  step "fixtures: regenerate (FIXTURES=1)"
  Rscript fixtures/generate.R
  bash fixtures/generate_phylip.sh
  git diff --exit-code fixtures/ref
  # also catch new/stray files under ref/
  if [ -n "$(git status --porcelain fixtures/ref)" ]; then
    echo "FAIL: fixtures/ref changed after regeneration"; git status --porcelain fixtures/ref; exit 1
  fi
fi

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

if [ -d crates/neophylo-core/fuzz/fuzz_targets ] && [ "${FUZZ:-0}" = "1" ]; then
  step "fuzz: smoke, 60 s per target (FUZZ=1, nightly)"
  for t in fasta newick exercise; do
    # corpus/ is gitignored; seeds/ is committed.
    mkdir -p "crates/neophylo-core/fuzz/corpus/$t"
    ( cd crates/neophylo-core/fuzz && cargo +nightly fuzz run "$t" "corpus/$t" "seeds/$t" -- -max_total_time=60 )
  done
fi

if [ -f web/playwright.config.ts ] && [ "${E2E:-0}" = "1" ]; then
  step "web: e2e (E2E=1)"; ( cd web && npx playwright test )
fi

if [ -f web/scripts/r-parity.mjs ] && [ "${RPARITY:-0}" = "1" ]; then
  step "R export parity (RPARITY=1)"; ( cd web && node scripts/r-parity.mjs )
fi

printf '\nALL CHECKS PASSED\n'
