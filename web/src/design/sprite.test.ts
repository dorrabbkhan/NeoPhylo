// Sprite glyph invariants (v1.5 Task 3 fix round 1): the chevrons the
// stepper, replicate panel and tour stamp must be real chevrons —
// `next` shipped as `m9 18 6-6 6-6`, a straight diagonal that rendered
// as a "/" slash. Pin both directions by their exact path data so a
// mirror-broken glyph fails here instead of in a screenshot review.

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const SVG = readFileSync(
  resolve(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "..",
    "public",
    "icons",
    "ui.svg",
  ),
  "utf8",
);

/** The path data of one symbol, in document order. */
function symbolPaths(id: string): string[] {
  const m = new RegExp(`<symbol id="${id}"[\\s\\S]*?</symbol>`).exec(SVG);
  if (m === null) throw new Error(`no <symbol id="${id}"> in ui.svg`);
  return [...m[0].matchAll(/<path d="([^"]+)"/g)].map((p) => p[1]);
}

describe("ui.svg direction glyphs", () => {
  it("prev is the left chevron", () => {
    expect(symbolPaths("prev")).toEqual(["m15 18-6-6 6-6"]);
  });

  it("next is the right chevron — the mirror of prev, not a slash", () => {
    expect(symbolPaths("next")).toEqual(["m9 18 6-6-6-6"]);
  });
});
