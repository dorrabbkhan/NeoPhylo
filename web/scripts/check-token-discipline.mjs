#!/usr/bin/env node
// Token discipline (v1.3 spec §3.4): literal colors and font sizes live
// only in src/design/tokens.ts. This scans web/src/**/*.css plus
// style={{…}} literals in web/src/**/*.{ts,tsx} for `#hex`, `rgb(`,
// `hsl(` and `font-size: <n>px` (also the `font:` shorthand form).
// Offenders are printed as file:line — the run exits 1 if any exist.

import { readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = fileURLToPath(new URL("../src", import.meta.url));

// tokens.ts is the allowed home of literals; tokens.css is generated
// from it by tokensCssPlugin (never committed); the wasm pkg and
// ts-rs-generated types aren't app styling.
const EXCLUDED = new Set([
  "design/tokens.ts",
  "design/tokens.css",
]);
const EXCLUDED_DIRS = ["engine/pkg", "engine/generated"];

const PATTERNS = [
  /#[0-9a-fA-F]{3,8}\b/g,
  /\brgba?\s*\(/g,
  /\bhsla?\s*\(/g,
  /\bfont-size\s*:\s*[0-9.]+px/g,
  // `font: 15px/145% …` smuggles a size literal past the font-size rule.
  /\bfont\s*:\s*[0-9.]+px/g,
];

/** All files under dir (recursive), paths relative to SRC, "/" sep. */
function* walk(dir, rel = "") {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const r = rel === "" ? entry.name : `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (!EXCLUDED_DIRS.includes(r)) yield* walk(join(dir, entry.name), r);
    } else if (!EXCLUDED.has(r)) {
      yield r;
    }
  }
}

/** Line number (1-based) of offset `i` in `text`. */
function lineOf(text, i) {
  let line = 1;
  for (let k = 0; k < i; k++) if (text.charCodeAt(k) === 10) line++;
  return line;
}

/** Spans of `style={{ … }}` object literals: [start, end) of the inner
 * object braces' contents. Attribute strings and JSX props elsewhere are
 * presentation attributes, not inline styles. */
function styleLiteralSpans(text) {
  const spans = [];
  let at = 0;
  for (;;) {
    const start = text.indexOf("style={{", at);
    if (start < 0) return spans;
    // Match braces from the first `{` of `{{`.
    const open = text.indexOf("{", start);
    let depth = 0;
    let i = open;
    for (; i < text.length; i++) {
      const ch = text[i];
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) break;
      }
    }
    spans.push([open, i]);
    at = i + 1;
  }
}

/** Patterns that apply inside a style={{}} object: the CSS ones plus
 * `fontSize: <number>` (React numeric fontSize renders as px). */
const STYLE_PATTERNS = [...PATTERNS, /\bfontSize\s*:\s*[0-9.]+\b/g];

const offenders = [];
for (const rel of walk(SRC)) {
  const text = readFileSync(join(SRC, rel), "utf8");
  if (rel.endsWith(".css")) {
    for (const re of PATTERNS) {
      re.lastIndex = 0;
      for (let m; (m = re.exec(text)) !== null; ) {
        offenders.push(`${rel}:${lineOf(text, m.index)}  ${m[0]}`);
      }
    }
  } else if (rel.endsWith(".ts") || rel.endsWith(".tsx")) {
    for (const [open, close] of styleLiteralSpans(text)) {
      const inner = text.slice(open, close);
      for (const re of STYLE_PATTERNS) {
        re.lastIndex = 0;
        for (let m; (m = re.exec(inner)) !== null; ) {
          offenders.push(`${rel}:${lineOf(text, open + m.index)}  ${m[0]}`);
        }
      }
    }
  }
}

if (offenders.length > 0) {
  console.error(
    `token discipline: ${offenders.length} literal color/font-size ` +
      `outside src/design/tokens.ts (spec §3.4):`,
  );
  for (const o of offenders) console.error(`  ${o}`);
  process.exit(1);
}
console.log("token discipline: clean");
