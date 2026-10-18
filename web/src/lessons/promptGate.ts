// Guided-lesson prompt gate (plan Task 21, spec §6.2). A useState hook so
// App stays near the file-size guideline: it owns the answered picks and
// the half-finished two-leaf pick, and computes everything the render
// needs — which prompts show, whether the stepper is gated, and the
// answer pair. The *shown* matrix (correct pair unmarked, distance view
// pinned while a predict_pair question is open — the lowest Q would be
// the answer) is composed by App, which owns stepMatrix.
//
// Answers reset when `prompts` changes identity (a different exercise was
// loaded — the exercise object and its array are stable across
// recompute) and a pending leaf pick resets whenever the position
// changes; both use the adjust-state-during-render pattern, same as
// NumberField's text sync.
//
// `prompts` defaults to a shared EMPTY constant, NOT `?? []` at the call
// site: a fresh literal per render would make `prompts !== lastPrompts`
// true forever while `session` is null, looping setState during render
// ("Too many re-renders" — hit whenever anything re-renders App before
// the wasm load resolves, e.g. the ResizeObserver in treesRef).

import { useState } from "react";

import type { Prompt } from "../engine/generated/Prompt";
import type { StepMatrix } from "../views/stepMatrix";
import { gatingPrompt, leafClusterIndex, promptsAt } from "./prompts";

/** Shared empty prompt list — the loading-session default (identity
 * must be stable across renders, see the module docstring). */
const NO_PROMPTS: Prompt[] = [];

export interface PromptGate {
  /** Prompts to display at the current position (empty in sandbox mode). */
  shown: Prompt[];
  /** The unanswered predict_pair prompt gating this position, or null. */
  gating: Prompt | null;
  /** True while the stepper should be blocked. */
  gated: boolean;
  /** The pending join's cluster labels, or null when there is no pair. */
  answerPair: [string, string] | null;
  /** The student's pick for the prompt at join step `at`, if answered. */
  picked: (at: number) => [string, string] | null;
  /** First leaf of an in-progress two-leaf pick (for highlighting). */
  leafPick: string | null;
  /** Answer a predict prompt with matrix cell (i, j); ignores diagonal. */
  onPickCell: (i: number, j: number) => void;
  /** Leaf click during a predict prompt: first click arms, second picks. */
  onPickLeaf: (label: string) => void;
}

export function usePromptGate({
  prompts,
  position,
  lessonMode,
  sm,
  leafSets,
}: {
  /** The exercise's prompt list; identity changes mark a new exercise.
   * Undefined while the session is still loading. */
  prompts?: Prompt[];
  /** Stepper position; a prompt with `at_step` = s shows at s - 1. */
  position: number;
  /** Prompts are lesson UI — the sandbox never shows or gates on them. */
  lessonMode: boolean;
  /** The step matrix at `position`; supplies cluster labels and indices. */
  sm: StepMatrix | null;
  /** Leaf labels under each node id (resolves leaf picks to clusters). */
  leafSets: ReadonlyMap<number, ReadonlySet<string>>;
}): PromptGate {
  // Stable default: never `[]` inline — see the module docstring.
  const promptList = prompts ?? NO_PROMPTS;

  const [answered, setAnswered] = useState<
    ReadonlyMap<number, [string, string]>
  >(new Map());
  const [leafPick, setLeafPick] = useState<string | null>(null);

  // A new exercise (new prompts array) forgets all answers; a position
  // change abandons a half-finished leaf pick.
  const [lastPrompts, setLastPrompts] = useState(promptList);
  const [lastPosition, setLastPosition] = useState(position);
  if (promptList !== lastPrompts) {
    setLastPrompts(promptList);
    setAnswered(new Map());
    setLeafPick(null);
  }
  if (position !== lastPosition) {
    setLastPosition(position);
    setLeafPick(null);
  }

  const shown = lessonMode ? promptsAt(promptList, position) : [];
  // Gating needs a pending pair: NJ's three-way final join has none, so
  // a predict_pair prompt placed there displays like a note.
  const answerable = sm !== null && sm.active !== null && sm.chosen !== null;
  const gating =
    lessonMode && answerable
      ? gatingPrompt(promptList, position, answered)
      : null;
  const answerPair: [string, string] | null =
    sm !== null && sm.chosen !== null
      ? [sm.labels[sm.chosen[0]], sm.labels[sm.chosen[1]]]
      : null;
  const recordPick = (at: number, pair: [string, string]) => {
    setAnswered((m) => new Map(m).set(at, pair));
    setLeafPick(null);
  };

  // A matrix-cell pick records the cluster labels of the picked pair.
  const onPickCell = (i: number, j: number) => {
    if (gating === null || sm === null || i === j) return;
    recordPick(gating.at_step, [sm.labels[i], sm.labels[j]]);
  };

  // The first leaf click arms; the second resolves both leaves to their
  // active clusters. Two leaves inside one cluster (or an unknown leaf)
  // resolve to the leaf labels themselves — never the answer.
  const onPickLeaf = (label: string) => {
    if (gating === null || sm === null || sm.active === null) return;
    if (leafPick === null || leafPick === label) {
      setLeafPick(label);
      return;
    }
    const ia = leafClusterIndex(sm.active, leafSets, leafPick);
    const ib = leafClusterIndex(sm.active, leafSets, label);
    if (ia >= 0 && ib >= 0 && ia !== ib) {
      recordPick(gating.at_step, [sm.labels[ia], sm.labels[ib]]);
    } else {
      recordPick(gating.at_step, [leafPick, label]);
    }
  };

  return {
    shown,
    gating,
    gated: gating !== null,
    answerPair,
    picked: (at) => answered.get(at) ?? null,
    leafPick,
    onPickCell,
    onPickLeaf,
  };
}
