// Bundled-font file checks (v1.3 plan Task 4, spec §4.1/§4.4/§8.2):
// the woff2 subsets exist inside the 200 KB budget, fonts.css declares
// every face with font-display: block and the Google Fonts unicode
// ranges, and the generated licenses page lists both OFL-1.1 fonts.

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { buildLicensesHtml } from "../../scripts/licenses.ts";

const WEB = process.cwd(); // vitest runs in web/
const REPO = resolve(WEB, "..");
const FONTS_DIR = join(WEB, "public", "fonts");
const FONTS_CSS = join(WEB, "src", "design", "fonts.css");

const FACES: [string, number[]][] = [
  ["inter", [400, 500, 600]],
  ["jetbrains-mono", [400]],
];
const SUBSETS = ["latin", "latin-ext", "greek", "cyrillic"] as const;
const NAMES = FACES.flatMap(([fam, ws]) =>
  ws.flatMap((w) => SUBSETS.map((s) => `${fam}-${w}-${s}.woff2`)),
);

describe("bundled font files", () => {
  it("has all 16 weight × subset woff2 files", () => {
    const files = readdirSync(FONTS_DIR).filter((f) => f.endsWith(".woff2"));
    expect(files.sort()).toEqual(NAMES.sort());
    // Every file is a real woff2: magic "wOF2".
    for (const n of NAMES) {
      const head = readFileSync(join(FONTS_DIR, n)).subarray(0, 4).toString();
      expect(head, n).toBe("wOF2");
    }
  });

  it("totals at most 200 KB (spec §4.1 budget)", () => {
    const total = NAMES.reduce(
      (sum, n) => sum + statSync(join(FONTS_DIR, n)).size,
      0,
    );
    expect(total).toBeLessThanOrEqual(200 * 1024);
  });
});

describe("fonts.css", () => {
  const css = () => readFileSync(FONTS_CSS, "utf8");

  it("declares every face with block display and a unicode-range", () => {
    const rules = css().match(/@font-face\s*\{[^}]*\}/g) ?? [];
    expect(rules).toHaveLength(NAMES.length);
    for (const [fam, weights] of FACES) {
      const family = fam === "inter" ? "Inter" : "JetBrains Mono";
      for (const w of weights) {
        for (const s of SUBSETS) {
          const file = `${fam}-${w}-${s}.woff2`;
          const rule = rules.find((r) => r.includes(file));
          expect(rule, file).toBeDefined();
          expect(rule).toContain(`font-family: "${family}"`);
          expect(rule).toContain(`font-weight: ${w}`);
          expect(rule).toContain("font-display: block");
          expect(rule).toMatch(/unicode-range:\s*U\+/);
        }
      }
    }
  });
});

describe("font licensing", () => {
  it("lists Inter and JetBrains Mono as OFL-1.1 on the licenses page", () => {
    const html = buildLicensesHtml(REPO);
    expect(html).toContain("Inter");
    expect(html).toContain("JetBrains Mono");
    expect(html).toMatch(/SIL OPEN FONT LICENSE|Open Font License/i);
    expect(html).toMatch(/OFL/i);
  });
});
