// Print styling for the lab pages (v1.4 plan Task 11, spec §6.2): a
// lab handout prints in LIGHT colors whatever the screen theme is —
// paper is white. This component re-maps every token variable to its
// light-theme value under `@media print`, scoped to `.lab-print`, so
// the palette can never drift from tokens.ts (no literal colors
// anywhere). labs.css's own `@media print` block then hides the
// controls and shows the print-only masthead — the vars this emits
// are what those rules resolve to.

import { cssVariables } from "../../design/tokens";

const PRINT_VARS = Object.entries(cssVariables("light"))
  .map(([name, value]) => `  ${name}: ${value};`)
  .join("\n");

const CSS = `@media print {\n.lab-print {\n${PRINT_VARS}\n  color-scheme: light;\n  background: var(--color-bg);\n  color: var(--color-text);\n}\n}`;

export function LabPrintStyles() {
  return <style>{CSS}</style>;
}
