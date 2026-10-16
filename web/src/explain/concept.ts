// Concept layer for the explanation panel (plan Task 18, spec §6.2):
// one plain-language sentence per step type, built from the same trace
// record the Math layer uses. The templates are verbatim from the plan;
// a tie adds the fixed notice required by spec §6.3.

import type { Trace } from "../engine/generated/Trace";

import { fmt } from "./math";

/** Display name of NodeId `id`; `labels[id]` is the leaf label or the
 * internal node's u-name (state/names.ts `nodeName`). */
function at(labels: string[], id: number): string {
  return labels[id] ?? `#${id}`;
}

const TIE_LINE = "Tie: chosen by input order.";

/**
 * The plain-language explanation of the join shown at position `step`.
 *
 * `step` follows the stepper convention (position k discusses join
 * steps[k]); NJ's extra final position describes the three-way join and
 * positions past the end keep showing it. UPGMA clamps to its last join.
 */
export function conceptText(
  trace: Trace,
  step: number,
  labels: string[],
): string {
  const k = Math.max(0, step);
  if ("Nj" in trace) {
    const steps = trace.Nj.steps;
    if (k >= steps.length) {
      const f = trace.Nj.final_join;
      return (
        `${at(labels, f.a)}, ${at(labels, f.b)} and ${at(labels, f.c)} ` +
        "are joined to the central node: when three clusters remain, " +
        "Neighbor-Joining connects all three to one new node and the " +
        "unrooted tree is complete."
      );
    }
    const s = steps[k];
    const a = at(labels, s.active[s.chosen[0]]);
    const b = at(labels, s.active[s.chosen[1]]);
    const text =
      `${a} and ${b} are joined next: after accounting for how far each ` +
      "is from everything else, they are the closest pair.";
    return s.tie ? `${text}\n${TIE_LINE}` : text;
  }
  const steps = trace.Upgma.steps;
  if (steps.length === 0) return "";
  const s = steps[Math.min(k, steps.length - 1)];
  const a = at(labels, s.active[s.chosen[0]]);
  const b = at(labels, s.active[s.chosen[1]]);
  const text =
    `${a} and ${b} are joined next because they are the closest pair; ` +
    `the new group sits halfway between them at height ${fmt(s.height)}.`;
  return s.tie ? `${text}\n${TIE_LINE}` : text;
}
