#!/usr/bin/env bash
# Check the wasm bundle stays under the 1 MB gzipped budget (spec §5).
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"

WASM=web/src/engine/pkg/neophylo_wasm_bg.wasm
LIMIT=1048576

if [ ! -f "$WASM" ]; then
  echo "FAIL: $WASM not found; run scripts/build-wasm.sh first" >&2
  exit 1
fi

size=$(gzip -c "$WASM" | wc -c)
echo "$WASM gzipped: $size bytes (limit $LIMIT)"
if [ "$size" -ge "$LIMIT" ]; then
  echo "FAIL: wasm bundle exceeds the 1 MB gzipped budget" >&2
  exit 1
fi
