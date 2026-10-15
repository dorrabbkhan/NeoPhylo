#!/usr/bin/env bash
# Build the wasm package into web/src/engine/pkg/ and regenerate the
# TypeScript types in web/src/engine/generated/ (plan Task 12).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

wasm-pack build crates/neophylo-wasm --release --target web --out-dir ../../web/src/engine/pkg

# ts-rs #[ts(export)] tests write web/src/engine/generated/*.ts. Core types
# live in neophylo-core; WasmResult lives in neophylo-wasm (AGENTS.md).
cargo test -p neophylo-core export_bindings
cargo test -p neophylo-wasm export_bindings
