// Guided-lesson prompt logic (plan Task 21, spec §6.2). Pure helpers so
// App stays lean and the step mapping is unit-testable.
//
// `at_step` is the 1-based join number (Prompt.ts: "1-based join step at
// which the prompt appears"). Join s is the pending join at stepper
// position s-1 — the matrix there shows that join's pre-join state — so
// a prompt with at_step = s appears while the stepper sits at s-1, and a
// predict_pair prompt's answer is steps[s-1].chosen. Under this mapping
// Task 23's nj-basics prompts (at_step 1 and 3 on a 6-taxon NJ) ask
// about joins 1 and 3, both real pair joins.

import type { Prompt } from "../engine/generated/Prompt";

/** The prompts attached to stepper position `k` (join number k+1). */
export function promptsAt(prompts: Prompt[], position: number): Prompt[] {
  return prompts.filter((p) => p.at_step - 1 === position);
}

/** The predict_pair prompt gating `position`, or null when none of the
 * prompts there is an unanswered predict. Callers must only consult this
 * when the position has a pending pair — at NJ's three-way final join
 * there is no answer, so a prompt placed there displays like a note
 * instead of gating forever. */
export function gatingPrompt(
  prompts: Prompt[],
  position: number,
  answered: ReadonlyMap<number, unknown>,
): Prompt | null {
  return (
    promptsAt(prompts, position).find(
      (p) => p.type === "predict_pair" && !answered.has(p.at_step),
    ) ?? null
  );
}

/**
 * The index into `active` of the cluster containing leaf `label`, or -1.
 * Active clusters partition the leaf set, so each leaf belongs to
 * exactly one cluster; -1 is defensive (unknown label).
 */
export function leafClusterIndex(
  active: number[],
  leafSets: ReadonlyMap<number, ReadonlySet<string>>,
  label: string,
): number {
  return active.findIndex((id) => leafSets.get(id)?.has(label) === true);
}
