// Button-system token resolution (v1.5 Task 3, spec §16.4 — conductor's
// call): every var(--…) referenced by the stylesheets this task owns must
// resolve to a token tokens.ts actually defines (or to a documented
// component-scoped var set inline in TSX). Task 2's --color-surface2
// (camelCase where the emitted var is --color-surface-2) painted the tray
// transparent — this test fails on the next dangling name instead.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { cssVariables, presenterCssVariables } from "./tokens";

/** Stylesheets v1.5 Tasks 3 and 8 write or touch. Paths are
 * repo-relative to web/src/ so the scan runs under vitest's jsdom cwd. */
const CSS_FILES = [
  "design/buttons.css",
  "index.css",
  "views/labs/labs.css",
  "views/library/library.css",
  "views/guide/guide.css",
  "views/assignment/assignment.css",
];

/** Custom properties legitimately defined outside tokens.ts — scoped to
 * a component and set inline from TSX (or media-queried in the sheet
 * itself). Each entry names its setter site. */
const COMPONENT_VARS = new Set([
  "--lessons-menu-top", // LessonsMenu.tsx sets it on open
  "--matrix-w", // MatrixHeatmap.tsx: natural width
  "--matrix-min", // MatrixHeatmap.tsx: 40 px cell floor
  "--matrix-max", // MatrixHeatmap.tsx: upscale cap
  "--font-body", // prompt textarea opt-in (falls back to inherit)
]);

function definedTokens(): Set<string> {
  const vars = new Set<string>();
  for (const theme of ["light", "dark"] as const) {
    for (const key of Object.keys(cssVariables(theme))) vars.add(key);
  }
  for (const key of Object.keys(presenterCssVariables())) vars.add(key);
  return vars;
}

describe("button-system stylesheets resolve every var(--…) to a token", () => {
  const tokens = definedTokens();

  for (const file of CSS_FILES) {
    it(`${file} uses only defined tokens`, () => {
      // No new URL(rel, import.meta.url) here — vite's asset transform
      // rewrites a dynamic URL pattern and breaks the path. dirname +
      // resolve on the module's own URL is stable.
      const path = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "..",
        file,
      );
      const css = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
      const used = new Set<string>();
      for (const m of css.matchAll(/var\(\s*(--[a-zA-Z][a-zA-Z0-9-]*)/g)) {
        used.add(m[1]);
      }
      const missing = [...used].filter(
        (name) => !tokens.has(name) && !COMPONENT_VARS.has(name),
      );
      expect(missing, `${file}: vars not defined by tokens.ts`).toEqual([]);
    });
  }
});
