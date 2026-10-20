// Bootstrap explanation text (v1.2 plan Task 11, spec §6.6). The
// "How sure are we?" panel renders one of these under the session's
// Concept/Math mode. The concept wording is spec-verbatim; math lines
// are KaTeX source unless they carry no "=" (same convention as
// ExplanationPanel: formula lines render through KaTeX, the rest as
// plain text).

/** Concept layer (spec §6.6, verbatim). */
export function bootstrapConcept(): string {
  return (
    "87 means this group appeared in 87 of 100 resampled datasets. " +
    "It measures how consistently the data supports the group, not " +
    "the probability that the group is true."
  );
}

/** Math layer (spec §6.6): the support fraction and why resampling
 * leaves some columns undrawn. */
export function bootstrapMathTex(): string[] {
  return [
    "\\text{support} = \\frac{\\text{count}}{\\text{successful replicates}}",
    "Columns are drawn with replacement, so one column can be drawn several times or not at all.",
    "P(\\text{never drawn}) = (1 - 1/L)^L \\approx e^{-1} \\approx 36.8\\%",
  ];
}
