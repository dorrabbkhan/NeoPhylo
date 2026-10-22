// Vite plugin (v1.3 spec §3.1): renders tokens.ts into
// src/design/tokens.css — custom properties under
// :root[data-theme="light"] / :root[data-theme="dark"], with the bare
// :root getting light as the default. Written at dev-server start and
// build start; the output is gitignored, never committed or
// hand-edited. index.css @imports it.
//
// Theme fallback keeps today's behavior: without an explicit
// data-theme the OS's prefers-color-scheme still picks the palette —
// Task 6 makes light the default regardless and wires the toggle.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

import { cssVariables } from "./tokens.ts";

/** Output path relative to the Vite root (web/). */
export const TOKENS_CSS = "src/design/tokens.css";

/** The whole generated stylesheet. */
export function tokensCss(): string {
  const light = cssVariables("light");
  const dark = cssVariables("dark");
  // Vars identical in both themes (fonts, scales, scrim, the unthemed
  // aa tints) are emitted once under :root; the rest are per-theme.
  const shared: string[] = [];
  const themed: string[] = [];
  for (const name of Object.keys(light) as `--${string}`[]) {
    (light[name] === dark[name] ? shared : themed).push(name);
  }
  const decls = (
    vars: Record<`--${string}`, string>,
    names: string[],
    indent = "  ",
  ) =>
    names
      .map((n) => `${indent}${n}: ${vars[n as `--${string}`]};`)
      .join("\n");
  return (
    "/* Generated from src/design/tokens.ts by tokensCssPlugin — do not edit. */\n\n" +
    `:root {\n${decls(light, shared)}\n}\n\n` +
    `:root,\n:root[data-theme="light"] {\n${decls(light, themed)}\n}\n\n` +
    `:root[data-theme="dark"] {\n${decls(dark, themed)}\n}\n\n` +
    "@media (prefers-color-scheme: dark) {\n" +
    `  :root:not([data-theme]) {\n${decls(dark, themed, "    ")}\n  }\n}\n`
  );
}

export function tokensCssPlugin(): Plugin {
  let outFile = "";
  const write = () => {
    mkdirSync(dirname(outFile), { recursive: true });
    writeFileSync(outFile, tokensCss());
  };
  return {
    name: "neophylo-tokens-css",
    configResolved(config) {
      outFile = resolve(config.root, TOKENS_CSS);
    },
    buildStart: write,
    configureServer: write,
  };
}
