// Token contract (v1.3 spec §3): cssVariables() emits a --color-<kebab>
// var for every ColorTokens key in both themes, the type scale holds
// the spec's ≥12 px minimum, and the discipline script keeps literals
// out of everything but tokens.ts (§3.4).

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { color, cssVariables, font, radius, size, space } from "./tokens";
import type { ThemeName } from "./tokens";

const THEMES: ThemeName[] = ["light", "dark"];

const kebab = (key: string): string =>
  key.replace(/([a-z0-9])([A-Z0-9])/g, "$1-$2").toLowerCase();

describe("design tokens", () => {
  it("cssVariables emits --color-<kebab key> for every color token, both themes", () => {
    for (const theme of THEMES) {
      const vars = cssVariables(theme);
      for (const [key, value] of Object.entries(color[theme])) {
        expect(vars[`--color-${kebab(key)}`]).toBe(value);
      }
    }
  });

  it("emits size/space/radius/font vars as CSS values", () => {
    const vars = cssVariables("light");
    for (const [key, v] of Object.entries(size)) {
      expect(vars[`--size-${key}`]).toBe(`${v}px`);
    }
    for (const n of space) {
      expect(vars[`--space-${n}`]).toBe(`${n}px`);
    }
    for (const [key, v] of Object.entries(radius)) {
      expect(vars[`--radius-${key}`]).toBe(`${v}px`);
    }
    expect(vars["--font-ui"]).toBe(font.ui);
    expect(vars["--font-mono"]).toBe(font.mono);
  });

  it("every type-scale value is ≥ 12 px (spec §3.2 minimum)", () => {
    for (const v of Object.values(size)) {
      expect(v).toBeGreaterThanOrEqual(12);
    }
  });

  it("no literal colors or font sizes outside tokens.ts (spec §3.4)", () => {
    // import.meta.url is an http URL under vitest's jsdom env — fall
    // back to the cwd (web/) like src/test/setup.ts does.
    const url = new URL(
      "../../scripts/check-token-discipline.mjs",
      import.meta.url,
    );
    const script =
      url.protocol === "file:"
        ? fileURLToPath(url)
        : resolve("scripts/check-token-discipline.mjs");
    const res = spawnSync(process.execPath, [script], { encoding: "utf8" });
    expect(res.status, res.stdout + res.stderr).toBe(0);
  });
});
