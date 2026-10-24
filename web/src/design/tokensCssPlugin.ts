// Vite plugin (v1.3 spec §3.1): renders tokens.ts into
// src/design/tokens.css — custom properties under
// :root[data-theme="light"] / :root[data-theme="dark"], with the bare
// :root getting light as the default (spec §3.3: light regardless of
// the OS setting; the index.html inline script sets data-theme before
// first paint). Written at dev-server start and build start; the
// output is gitignored, never committed or hand-edited. index.css
// @imports it.
//
// Each themed block also sets color-scheme so UA chrome (scrollbars,
// form controls) matches the theme instead of the OS default.

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { Plugin } from "vite";

import { cssVariables, presenterCssVariables } from "./tokens.ts";

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
  // Presenter mode (§6.6): data-presenter on <html> scales the type
  // and spacing vars 1.5× — one block after the themes so it wins in
  // either.
  const presenter = presenterCssVariables();
  return (
    "/* Generated from src/design/tokens.ts by tokensCssPlugin — do not edit. */\n\n" +
    `:root {\n${decls(light, shared)}\n}\n\n` +
    `:root,\n:root[data-theme="light"] {\n  color-scheme: light;\n${decls(light, themed)}\n}\n\n` +
    `:root[data-theme="dark"] {\n  color-scheme: dark;\n${decls(dark, themed)}\n}\n\n` +
    `:root[data-presenter] {\n${decls(presenter, Object.keys(presenter) as `--${string}`[])}\n}\n`
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
