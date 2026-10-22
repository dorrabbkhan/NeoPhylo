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

import type { NoteAfter } from "../engine/generated/NoteAfter";
import type { Prompt } from "../engine/generated/Prompt";
import type { StepMatrix } from "../views/stepMatrix";
import {
  afterSatisfied,
  CONTINUE_ADVANCES,
  gatingPrompt,
  leafClusterIndex,
  promptsAt,
} from "./prompts";

/** Shared empty prompt list — the loading-session default (identity
 * must be stable across renders, see the module docstring). */
const NO_PROMPTS: Prompt[] = [];

/** The scored prediction as first computed — locked thereafter
 * (owner note): reruns never re-score. */
export interface BranchVerdict {
  correct: boolean;
  weakest: string[];
  supportPct: number;
}

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
  /** v1.2 §7.1: the shown unanswered predict_branch prompt, or null.
   * Branch prompts never gate the stepper — they gate the bootstrap
   * panel's Run button. */
  branchGating: Prompt | null;
  /** The clicked internal branch's split key for the prompt at step
   * `at`, if answered. */
  pickedBranch: (at: number) => string | null;
  /** True when the student clicked a terminal edge while a
   * predict_branch prompt is open — the card explains leaf branches
   * can't be the answer (v1.2 spec §7.1). */
  terminalPick: boolean;
  /** Record an internal-branch click (split key) as the answer to the
   * shown predict_branch prompt. */
  onPickBranch: (splitKey: string) => void;
  /** Record a terminal-edge click against the shown predict_branch
   * prompt — not an answer, just the "joins two or more taxa" hint. */
  onPickTerminal: () => void;
  /** The locked verdict for the prompt at step `at` — null until the
   * first completed run after answering scored it. */
  branchVerdictFor: (at: number) => BranchVerdict | null;
  /** Score the prompt's pick once (owner note: "evaluate the
   * prediction once, on the first completed run after answering").
   * A second call for the same prompt keeps the first verdict. */
  recordBranchVerdict: (at: number, v: BranchVerdict) => void;
  /** A Continue handler for a sequenced note (bootstrap-basics round
   * 3) whose click unlocks the next stage, or null when the note has
   * no pending Continue — already clicked, or its successor is already
   * unlocked by a run. */
  continueFor: (p: Prompt) => (() => void) | null;
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
  runs = 0,
  longRun = false,
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
  /** Completed bootstrap runs under the current data
   * (session.bootstrap.completedRuns) — the `first_run` /
   * `continue_or_second_run` note triggers (round 3). */
  runs?: number;
  /** A completed run at Length ≥ LONGER_RUN_SITES happened — the
   * `longer_run` trigger (round 3). */
  longRun?: boolean;
}): PromptGate {
  // Stable default: never `[]` inline — see the module docstring.
  const promptList = prompts ?? NO_PROMPTS;

  const [answered, setAnswered] = useState<
    ReadonlyMap<number, [string, string]>
  >(new Map());
  // v1.2 §7.1: predict_branch answers — prompt at_step → clicked
  // branch's canonical split key.
  const [branchAnswered, setBranchAnswered] = useState<
    ReadonlyMap<number, string>
  >(new Map());
  const [terminalPick, setTerminalPick] = useState(false);
  const [leafPick, setLeafPick] = useState<string | null>(null);
  // predict_branch verdicts — the first completed run's scoring,
  // frozen per prompt (owner note: later reruns never change it).
  const [branchVerdicts, setBranchVerdicts] = useState<
    ReadonlyMap<number, BranchVerdict>
  >(new Map());
  // Round 3 sequencing: `continued` records Continue clicks per note
  // stage, `unlocked` the `after` stages already satisfied — sticky,
  // so a later data change that resets the run count never hides a
  // note the student has seen ("once shown it stays").
  const [continued, setContinued] = useState<ReadonlySet<NoteAfter>>(
    new Set(),
  );
  const [unlocked, setUnlocked] = useState<ReadonlySet<NoteAfter>>(
    new Set(),
  );

  // A new exercise (new prompts array) forgets all answers; a position
  // change abandons a half-finished leaf pick.
  const [lastPrompts, setLastPrompts] = useState(promptList);
  const [lastPosition, setLastPosition] = useState(position);
  if (promptList !== lastPrompts) {
    setLastPrompts(promptList);
    setAnswered(new Map());
    setBranchAnswered(new Map());
    setTerminalPick(false);
    setLeafPick(null);
    setBranchVerdicts(new Map());
    setContinued(new Set());
    setUnlocked(new Set());
  }
  if (position !== lastPosition) {
    setLastPosition(position);
    setTerminalPick(false);
    setLeafPick(null);
  }

  // Newly satisfied `after` stages join `unlocked` — the
  // adjust-during-render pattern converges because the union stops
  // growing at three stages.
  const fresh = new Set(unlocked);
  for (const after of [
    "first_run",
    "continue_or_second_run",
    "longer_run",
  ] as const) {
    if (afterSatisfied(after, runs, longRun, continued)) fresh.add(after);
  }
  if (fresh.size !== unlocked.size) setUnlocked(fresh);

  const shown = lessonMode
    ? promptsAt(promptList, position).filter(
        (p) => p.after === null || fresh.has(p.after),
      )
    : [];
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
  // The predict_branch prompt shown now and still unanswered gates the
  // bootstrap Run button, not the stepper.
  const branchGating =
    shown.find(
      (p) => p.type === "predict_branch" && !branchAnswered.has(p.at_step),
    ) ?? null;
  const onPickBranch = (splitKey: string) => {
    if (branchGating === null) return;
    setBranchAnswered((m) => new Map(m).set(branchGating.at_step, splitKey));
    setTerminalPick(false);
  };
  // A leaf edge is never the answer: flag the miss so the card can
  // explain, but leave the prompt unanswered (Run stays gated).
  const onPickTerminal = () => {
    if (branchGating === null) return;
    setTerminalPick(true);
  };
  // Guarded one-time write: the updater returns the SAME map when the
  // prompt is already scored, so calling it during render (the
  // adjust-during-render pattern this hook already uses) converges.
  const recordBranchVerdict = (at: number, v: BranchVerdict) => {
    setBranchVerdicts((m) => (m.has(at) ? m : new Map(m).set(at, v)));
  };
  // A sequenced note offers Continue while its stage is unclicked and
  // its successor isn't already unlocked by the run history — the
  // button is never a dead end.
  const continueFor = (p: Prompt): (() => void) | null => {
    if (p.after === null) return null;
    const next = CONTINUE_ADVANCES[p.after];
    if (next === undefined || continued.has(p.after) || fresh.has(next)) {
      return null;
    }
    const stage = p.after;
    return () => setContinued((s) => new Set(s).add(stage));
  };
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
    continueFor,
    branchGating,
    pickedBranch: (at) => branchAnswered.get(at) ?? null,
    terminalPick,
    onPickBranch,
    onPickTerminal,
    branchVerdictFor: (at) => branchVerdicts.get(at) ?? null,
    recordBranchVerdict,
    leafPick,
    onPickCell,
    onPickLeaf,
  };
}
