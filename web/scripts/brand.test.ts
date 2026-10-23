// Brand asset checks (v1.3 plan Task 8, spec §5). The committed files
// in web/public/brand/ are the build-time output of
// scripts/brand/generate.ts (Playwright-rendered from the chosen
// icon.svg); these tests pin their container formats and exact pixel
// sizes, and the og-image HTML template's tagline.
//
// The generator itself lives at the repo root and runs under Node
// (not vitest), so the template assertion reads its source: the
// OG_TAGLINE constant is the string that is rendered into
// og-image.png.

import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

// Vitest runs with cwd = web/ (and rewrites import.meta.url), so the
// repo root is simply its parent.
const BRAND = resolve(process.cwd(), "public/brand");
const GENERATOR = resolve(process.cwd(), "../scripts/brand/generate.ts");

const EXPECTED = [
  "favicon.ico",
  "apple-touch-icon.png",
  "icon-192.png",
  "icon-512.png",
  "icon-maskable-512.png",
  "og-image.png",
];

/** PNG IHDR dimensions (width/height are big-endian u32 at 16/20). */
function pngSize(name: string): { w: number; h: number } {
  const buf = readFileSync(join(BRAND, name));
  expect(buf.subarray(1, 4).toString("ascii")).toBe("PNG");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

describe("generated brand assets", () => {
  it("exist", () => {
    for (const name of EXPECTED) {
      expect(existsSync(join(BRAND, name)), name).toBe(true);
    }
  });

  it("packs 16/32/48 px PNGs into favicon.ico", () => {
    const ico = readFileSync(join(BRAND, "favicon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // icon type
    const count = ico.readUInt16LE(4);
    const sizes: number[] = [];
    for (let i = 0; i < count; i += 1) {
      const entry = 6 + i * 16;
      const w = ico.readUInt8(entry) || 256;
      const h = ico.readUInt8(entry + 1) || 256;
      expect(w).toBe(h);
      sizes.push(w);
      // Each entry embeds a PNG payload.
      const len = ico.readUInt32LE(entry + 8);
      const off = ico.readUInt32LE(entry + 12);
      expect(ico.subarray(off + 1, off + 4).toString("ascii")).toBe("PNG");
      expect(off + len).toBeLessThanOrEqual(ico.length);
    }
    expect(sizes.sort((a, b) => a - b)).toEqual([16, 32, 48]);
  });

  it("renders each PNG at its exact size", () => {
    expect(pngSize("apple-touch-icon.png")).toEqual({ w: 180, h: 180 });
    expect(pngSize("icon-192.png")).toEqual({ w: 192, h: 192 });
    expect(pngSize("icon-512.png")).toEqual({ w: 512, h: 512 });
    expect(pngSize("icon-maskable-512.png")).toEqual({ w: 512, h: 512 });
    expect(pngSize("og-image.png")).toEqual({ w: 1200, h: 630 });
  });

  it("keeps the maskable mark inside a >=10% safe margin", () => {
    // The generator's inset fraction is the safe padding; the e2e spec
    // verifies it against the rendered pixels.
    const src = readFileSync(GENERATOR, "utf8");
    const m = src.match(/MASKABLE_MARGIN\s*=\s*([0-9.]+)/);
    expect(m, "MASKABLE_MARGIN in generate.ts").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(0.1);
  });

  it("renders the og tagline from the HTML template", () => {
    const src = readFileSync(GENERATOR, "utf8");
    expect(src).toContain(
      '"Learn how phylogenetic trees are built, step by step"',
    );
  });
});
