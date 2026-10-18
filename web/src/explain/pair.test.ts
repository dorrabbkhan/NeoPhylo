// Tests for the pair panel's Concept/Math text (v1.1 plan Task 11,
// spec §5.2). The Concept sentence is verbatim from the spec; the Math
// lines must carry the log L(d) formula, the comparable-site count and
// d̂, and every line must be valid KaTeX.

import { describe, expect, it } from "vitest";
import katex from "katex";

import type { PairDetail } from "../engine/generated/PairDetail";

import { pairConcept, pairMathTex } from "./pair";

const DETAIL: PairDetail = {
  a: 0,
  b: 1,
  comparable: 9,
  differences: 3,
  p: 1 / 3,
  kimura: { Value: 0.397 },
  jtt: { Value: 0.412 },
  counts: [
    [0, 0, 6],
    [3, 4, 3],
  ],
  curve: Array.from({ length: 60 }, (_, k) => [k / 59, -30 + k * 0.01]),
  d_hat: 0.412,
  logl_hat: -29.5,
};

describe("pairConcept", () => {
  it("is the exact spec §5.2 sentence", () => {
    expect(pairConcept(DETAIL)).toBe(
      "JTT picks the distance that makes these two sequences most " +
        "probable, given how often each amino acid is replaced by " +
        "each other.",
    );
  });
});

describe("pairMathTex", () => {
  it("includes the log L(d) formula and the comparable-site count", () => {
    const lines = pairMathTex(DETAIL);
    expect(lines.some((l) => l.includes("\\log L(d)"))).toBe(true);
    expect(lines.some((l) => l.includes("9"))).toBe(true);
  });

  it("states d-hat, and says it can't be estimated when saturated", () => {
    const lines = pairMathTex(DETAIL);
    expect(lines.some((l) => l.includes("\\hat{d}"))).toBe(true);
    const sat = pairMathTex({ ...DETAIL, d_hat: null, logl_hat: null });
    expect(sat.some((l) => l.includes("can't estimate"))).toBe(true);
  });

  it("produces only valid KaTeX", () => {
    for (const line of pairMathTex(DETAIL)) {
      expect(() => katex.renderToString(line)).not.toThrow();
    }
    const sat = { ...DETAIL, d_hat: null, logl_hat: null };
    for (const line of pairMathTex(sat)) {
      expect(() => katex.renderToString(line)).not.toThrow();
    }
  });
});
