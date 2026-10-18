// Text layer for the pair panel (v1.1 plan Task 11, spec §5.2 "How was
// this distance computed?"). Produces the Concept sentence and the KaTeX
// Math lines from one `PairDetail` — every number is read out of the
// engine's detail, never recomputed.

import type { PairDetail } from "../engine/generated/PairDetail";

import { fmt } from "./math";

/**
 * The panel's one-sentence Concept — the spec §5.2 wording, identical
 * for every pair.
 *
 * `detail` is part of the Produces signature so the sentence can grow
 * pair-specific numbers later; today the spec fixes it verbatim.
 */
export function pairConcept(detail: PairDetail): string {
  void detail;
  return (
    "JTT picks the distance that makes these two sequences most " +
    "probable, given how often each amino acid is replaced by " +
    "each other."
  );
}

/**
 * KaTeX source lines for the panel's Math section (spec §5.2): the
 * log-likelihood formula, the comparable-site count, and d̂ at the v1
 * precision (fmt: 3 decimals, trailing zeros trimmed). A saturated pair
 * has no estimate — it says so instead of printing a number.
 */
export function pairMathTex(detail: PairDetail): string[] {
  const dHat =
    detail.d_hat === null
      ? "\\text{can't estimate}"
      : `= ${fmt(detail.d_hat)}`;
  return [
    "\\log L(d) = \\sum_{x,y} N_{xy}\\,\\ln\\!\\left(\\pi_x\\,P_{xy}(d)\\right)",
    `\\text{comparable sites} = ${detail.comparable}` +
      ` \\quad (\\text{${detail.differences} differ})`,
    `\\hat{d} ${dHat}`,
  ];
}
