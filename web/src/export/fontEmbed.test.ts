/// <reference types="node" />
// Font-embedding tests (v1.3 plan Task 15, spec §4.3): fontFacesFor
// emits @font-face rules with the bundled subsets as base64 data URIs,
// picking exactly the subsets whose unicode-range (as declared in
// src/design/fonts.css — the one source for the range lists)
// intersects the figure's text, at exactly the requested weights.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { stubFontFetch } from "../test/fontFetch";

import { fontFacesFor, uncoveredChars } from "./fontEmbed";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The base64 payload of a committed subset file — the embedded bytes
 * must be identical (the export is deterministic). */
function fileBase64(name: string): string {
  return readFileSync(resolve("public", "fonts", name)).toString("base64");
}

describe("fontFacesFor", () => {
  it("embeds only the latin subset for latin text at the used weight", async () => {
    stubFontFetch();
    const css = await fontFacesFor(["human", "wheat"], [400], ["Inter"]);
    expect(css).toContain("@font-face");
    expect(css).toContain('font-family:"Inter"');
    expect(css).toContain("font-weight:400");
    expect(css).toContain("data:font/woff2;base64,");
    // Exactly one face — the latin subset at weight 400, no other
    // subset, weight or family.
    expect(css.match(/@font-face/g)).toHaveLength(1);
    expect(css).toContain(fileBase64("inter-400-latin.woff2"));
    expect(css).not.toContain("font-weight:500");
    expect(css).not.toContain("font-weight:600");
    expect(css).not.toContain("JetBrains Mono");
    // The rule keeps the declared latin unicode-range.
    expect(css).toContain("U+0000-00FF");
    expect(css).not.toContain("U+0370");
  });

  it("adds the greek subset when a name needs it", async () => {
    stubFontFetch();
    const css = await fontFacesFor(["Ωmega"], [400], ["Inter"]);
    const faces = css.match(/@font-face/g) ?? [];
    expect(faces).toHaveLength(2);
    expect(css).toContain(fileBase64("inter-400-greek.woff2"));
    // "mega" is latin, so the latin face stays.
    expect(css).toContain(fileBase64("inter-400-latin.woff2"));
  });

  it("skips subsets no text reaches", async () => {
    stubFontFetch();
    const css = await fontFacesFor(["Я"], [400], ["Inter"]);
    const faces = css.match(/@font-face/g) ?? [];
    expect(faces).toHaveLength(1);
    expect(css).toContain(fileBase64("inter-400-cyrillic.woff2"));
  });

  it("embeds each requested weight, no others", async () => {
    stubFontFetch();
    const css = await fontFacesFor(["abc"], [400, 500], ["Inter"]);
    const faces = css.match(/@font-face/g) ?? [];
    expect(faces).toHaveLength(2);
    expect(css).toContain(fileBase64("inter-400-latin.woff2"));
    expect(css).toContain(fileBase64("inter-500-latin.woff2"));
    expect(css).not.toContain("font-weight:600");
  });

  it("embeds JetBrains Mono only when the figure uses it", async () => {
    stubFontFetch();
    const mono = await fontFacesFor(["abc"], [400], ["JetBrains Mono"]);
    expect(mono).toContain('font-family:"JetBrains Mono"');
    expect(mono).toContain(fileBase64("jetbrains-mono-400-latin.woff2"));
    const inter = await fontFacesFor(["abc"], [400], ["Inter"]);
    expect(inter).not.toContain("JetBrains Mono");
  });

  it("is deterministic and returns an empty string for empty text", async () => {
    stubFontFetch();
    const a = await fontFacesFor(["wheat", "Ω"], [400, 500], ["Inter"]);
    const b = await fontFacesFor(["Ω", "wheat"], [500, 400], ["Inter"]);
    expect(a).toBe(b);
    expect(await fontFacesFor([], [400], ["Inter"])).toBe("");
  });
});

describe("uncoveredChars", () => {
  it("reports characters outside every bundled subset", () => {
    // 中文 (CJK), 🦋 (emoji) and عربي (Arabic) are outside latin,
    // latin-ext, greek and cyrillic (Review Focus 1).
    const out = uncoveredChars(["中文名", "🦋 Morpho", "عربي"]);
    expect([...out].sort()).toEqual(
      ["中", "名", "文", "🦋", "ع", "ر", "ب", "ي"].sort(),
    );
  });

  it("covers latin, latin-ext, greek and cyrillic names", () => {
    expect(uncoveredChars(["wheat", "fünf", "Ωmega", "Я"])).toEqual([]);
  });
});
