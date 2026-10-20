// Bootstrap explanation text (v1.2 plan Task 11, spec §6.6): the
// Concept and Math layers are spec-verbatim, so the tests pin them.

import { describe, expect, it } from "vitest";

import { bootstrapConcept, bootstrapMathTex } from "./bootstrap";

describe("bootstrap explanations (spec §6.6)", () => {
  it("concept text is the spec's verbatim wording", () => {
    expect(bootstrapConcept()).toBe(
      "87 means this group appeared in 87 of 100 resampled datasets. " +
        "It measures how consistently the data supports the group, not " +
        "the probability that the group is true.",
    );
  });

  it("math lines carry the support formula and the never-drawn chance", () => {
    const lines = bootstrapMathTex();
    // support = count / successful replicates
    expect(
      lines.some(
        (l) => l.includes("support") && l.includes("count"),
      ),
    ).toBe(true);
    // The chance a given column is never drawn: (1 − 1/L)^L ≈ e⁻¹ ≈ 36.8%.
    const joined = lines.join(" ");
    expect(joined).toContain("(1 - 1/L)^L");
    expect(joined).toContain("e^{-1}");
    expect(joined).toContain("36.8");
    // Columns are drawn with replacement.
    expect(joined.toLowerCase()).toContain("replacement");
  });
});
