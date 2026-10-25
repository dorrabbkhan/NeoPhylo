#!/usr/bin/env bash
# Bundle budgets:
#   * wasm ≤ 1 MB gzipped (spec §5) — always checked.
#   * initial JS (gzip) ≤ the v1.2 initial bundle minus KaTeX plus 5 KB
#     (v1.3 spec §8.2) — needs the built app, so it runs only when
#     web/dist/index.html exists (scripts/ci/web.sh invokes this script
#     right after `vite build`).
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

# --- Initial-JS budget -------------------------------------------------
#
# "Initial JS" = the gzipped total of the JS the entry HTML loads before
# any user action: the entry chunk plus its transitive static imports,
# i.e. the <script type=module> tag and <link rel=modulepreload> hrefs in
# dist/index.html, expanded through dist/.vite/manifest.json's `imports`
# closure when the manifest exists. It excludes the bootstrap worker
# chunk, lazy chunks (KaTeX) and the wasm binary.
#
# Measured at task start (v1.3 Task 14) with this script: tag v1.2.0's
# initial JS was the entry chunk index-NogIFoQJ.js (191432 gz) plus the
# registerSW.js script tag (140 gz) = 191572 bytes; KaTeX's shipped
# payload gzip is katex.min.js 76524 + katex.min.css 3636 = 80160
# bytes. Budget: 191572 - 80160 + 5120 = 116532.
# (For reference, main at 679e5f9 measured 196661 bytes.)
V120_INITIAL_JS_GZ=191572
KATEX_GZ=80160
JS_LIMIT=$((V120_INITIAL_JS_GZ - KATEX_GZ + 5120))   # = 116532

DIST=web/dist
if [ ! -f "$DIST/index.html" ]; then
  echo "initial JS check skipped: $DIST/index.html not found (run after vite build)"
  exit 0
fi

# Prints every initial .js file under dist, one per line.
INITIAL_JS=$(node --input-type=commonjs - <<'NODE'
const fs = require("fs");
const path = require("path");
const dist = path.join("web", "dist");

const seen = new Set();
const add = (f) => {
  let clean = f.replace(/^\//, "");
  // index.html paths carry the deploy base ("/<repo>/" on Pages); the
  // manifest's `file` values never do — normalize to the dist-relative
  // path so the two sources dedupe.
  const i = clean.indexOf("assets/");
  if (i >= 0) clean = clean.slice(i);
  if (clean.endsWith(".js")) seen.add(clean);
};

// The entry <script src> and <link rel=modulepreload href> tags.
const html = fs.readFileSync(path.join(dist, "index.html"), "utf8");
for (const m of html.matchAll(/(?:src|href)="([^"]+\.js)"/g)) add(m[1]);

// The manifest's static-import closure of every entry chunk covers
// transitive deps that index.html doesn't name directly.
const mf = path.join(dist, ".vite", "manifest.json");
if (fs.existsSync(mf)) {
  const manifest = JSON.parse(fs.readFileSync(mf, "utf8"));
  const byFile = new Map(Object.entries(manifest).map(([k, v]) => [v.file, v]));
  const stack = [...seen].filter((f) => byFile.has(f));
  for (const v of Object.values(manifest)) if (v.isEntry) stack.push(v.file);
  while (stack.length) {
    const file = stack.pop();
    if (!file.endsWith(".js")) continue;
    add(file);
    const chunk = byFile.get(file);
    for (const dep of chunk?.imports ?? []) stack.push(manifest[dep]?.file ?? dep);
  }
}
for (const f of seen) console.log(f);
NODE
)

total=0
for f in $INITIAL_JS; do
  sz=$(gzip -c "$DIST/$f" | wc -c)
  printf '  initial JS: %-45s %8d gz\n' "$f" "$sz"
  total=$((total + sz))
done
echo "initial JS total gzipped: $total bytes (limit $JS_LIMIT)"
if [ "$total" -gt "$JS_LIMIT" ]; then
  echo "FAIL: initial JS exceeds the v1.3 budget" >&2
  exit 1
fi
