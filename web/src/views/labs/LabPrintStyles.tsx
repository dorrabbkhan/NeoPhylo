// Print styling for the lab pages and the lab index (v1.4 plan Task
// 11, spec §6.2): a lab handout — and the `?labs` index, which also
// renders `.lab-print` — prints in LIGHT colors whatever the screen
// theme is; paper is white. This component re-maps every token
// variable to its light-theme value under `@media print`, so the
// palette can never drift from tokens.ts (no literal colors
// anywhere). The map lands in two places: on `.lab-print` itself and
// on `:root:has(.lab-print)` — index.css paints `<html>` with
// `background: var(--color-bg)`, so without the root remap a dark
// session's dark `--color-bg` still covered the paper below and
// around the handout (owner finding 2026-11-14). labs.css's own
// `@media print` block then hides the controls and shows the
// print-only masthead — the vars this emits are what those rules
// resolve to.

import { cssVariables } from "../../design/tokens";

const PRINT_VARS = Object.entries(cssVariables("light"))
  .map(([name, value]) => `  ${name}: ${value};`)
  .join("\n");

const CSS = `@media print {\n:root:has(.lab-print) {\n${PRINT_VARS}\n  color-scheme: light;\n}\n.lab-print {\n${PRINT_VARS}\n  color-scheme: light;\n  background: var(--color-bg);\n  color: var(--color-text);\n}\n}`;

export function LabPrintStyles() {
  return <style>{CSS}</style>;
}
