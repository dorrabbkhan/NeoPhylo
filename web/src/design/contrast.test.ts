// Contrast contract (v1.3 plan Task 6, spec §3.3): every token pair the
// UI uses for text, focus and graphics meets WCAG 2.2 AA — 4.5:1 for
// text, 3:1 for interface components and graphics — in both themes.

import { describe, expect, it } from "vitest";

import { contrastRatio } from "./contrast";
import { color } from "./tokens";
import type { ThemeName } from "./tokens";

const THEMES: ThemeName[] = ["light", "dark"];

describe("contrastRatio", () => {
  it("is 21 for black on white and 1 for a color on itself", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
  });

  it("is symmetric and accepts #rgb", () => {
    expect(contrastRatio("#fff", "#000")).toBeCloseTo(21, 5);
  });
});

describe("theme token contrast (spec §3.3)", () => {
  it.each(THEMES)("%s: text on bg ≥ 4.5:1", (theme) => {
    const c = color[theme];
    expect(contrastRatio(c.text, c.bg)).toBeGreaterThanOrEqual(4.5);
  });

  it.each(THEMES)("%s: muted text on surface ≥ 4.5:1", (theme) => {
    const c = color[theme];
    expect(contrastRatio(c.textMuted, c.surface)).toBeGreaterThanOrEqual(
      4.5,
    );
  });

  it.each(THEMES)(
    "%s: focus, accent, weak-support and wrong-clade on bg ≥ 3:1",
    (theme) => {
      const c = color[theme];
      expect(contrastRatio(c.focus, c.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.accent, c.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.supportWeak, c.bg)).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(c.wrongClade, c.bg)).toBeGreaterThanOrEqual(3);
    },
  );

  it.each(THEMES)("%s: semantic text colors on bg ≥ 4.5:1", (theme) => {
    const c = color[theme];
    // .prompt-verdict and error/warning text paint these as body-size
    // text — the 4.5:1 text ratio applies, not the 3:1 graphics one.
    expect(contrastRatio(c.success, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.danger, c.bg)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(c.accentContrast, c.bg)).toBeGreaterThanOrEqual(
      4.5,
    );
    expect(contrastRatio(c.textMuted, c.bg)).toBeGreaterThanOrEqual(4.5);
  });
});
