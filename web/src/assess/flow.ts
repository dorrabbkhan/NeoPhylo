// Student-flow state machine (v1.5 plan Task 8, spec §5.6):
// `start → working → finished`. The flow records per-task
// submissions — each Check press and each commit is one attempt;
// `first` keeps the first submission, `last` the final submission
// when it differs from the first — and packs them into the
// `EncodeAttempt[]` `encodeCode` consumes. Everything numeric or
// verdict-bearing stays in the engine; this module only tracks
// what was submitted.
//
// `commit` seals a task ("advancing past it commits the answer",
// "cannot be changed after advancing"). An unanswered task's
// commit is a no-op — the stepper refuses to pass it — and a task
// never answered encodes as `first: null` (skipped).

import type { EncodeAttempt } from "../engine/generated/EncodeAttempt";
import type { TaskAnswer } from "../engine/generated/TaskAnswer";
import type { TaskRef } from "../engine/generated/TaskRef";

/** One graded task's recorded submissions (spec §5.4's Attempt). */
export interface TaskRecord {
  /** The first submitted answer; null while the task is unanswered. */
  first: TaskAnswer | null;
  /** The final submission when it differs from `first`; else null. */
  last: TaskAnswer | null;
  /** Check presses plus commits that changed the answer — the
   *  submission count the code's 4-bit field clamps to 15. */
  attempts: number;
  /** Sealed: the student has advanced past / finished past it. */
  committed: boolean;
}

export interface FlowState {
  phase: "start" | "working" | "finished";
  /** One record per graded task, in assignment order. */
  tasks: TaskRecord[];
  /** The `NP1-…` code once `finish` has run. */
  code: string | null;
  /** Minutes since 2026-01-01 UTC stamped into the code. */
  finishedMin: number | null;
}

export function newFlow(taskCount: number): FlowState {
  return {
    phase: "start",
    tasks: Array.from({ length: taskCount }, () => ({
      first: null,
      last: null,
      attempts: 0,
      committed: false,
    })),
    code: null,
    finishedMin: null,
  };
}

export function startWork(f: FlowState): FlowState {
  return f.phase === "start" ? { ...f, phase: "working" } : f;
}

/** Structural equality — TaskAnswer is a small plain-data union. */
export function sameAnswer(a: TaskAnswer, b: TaskAnswer): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Record one submission (a Check press or a commit): bumps
 * `attempts` and updates `first`/`last` per the Attempt contract. */
export function submit(
  f: FlowState,
  index: number,
  answer: TaskAnswer,
): FlowState {
  const rec = f.tasks[index];
  if (rec === undefined) return f;
  const tasks = f.tasks.slice();
  tasks[index] = {
    ...rec,
    first: rec.first ?? answer,
    // `last` is the final submission only when it differs from the
    // first — the first submission itself leaves it null.
    last:
      rec.first === null || sameAnswer(rec.first, answer) ? null : answer,
    attempts: rec.attempts + 1,
  };
  return { ...f, tasks };
}

/** Seal the task at `index` — submits `answer` when it differs from
 *  the last submission (or nothing was submitted yet), then marks
 *  the task committed. `null` commits nothing: an unanswered task
 *  stays uncommitted (the stepper blocks before that anyway), and
 *  Finish leaves it skipped. */
export function commitTask(
  f: FlowState,
  index: number,
  answer: TaskAnswer | null,
): FlowState {
  const rec = f.tasks[index];
  if (rec === undefined) return f;
  let next = f;
  if (answer !== null) {
    const pending = rec.last ?? rec.first;
    if (pending === null || !sameAnswer(pending, answer)) {
      next = submit(next, index, answer);
    }
  }
  const tasks = next.tasks.slice();
  tasks[index] = { ...tasks[index], committed: true };
  return { ...next, tasks };
}

/** The last submitted answer of a task, or null when unanswered. */
export function lastSubmitted(rec: TaskRecord): TaskAnswer | null {
  return rec.last ?? rec.first;
}

/** Record the issued code and close the flow. */
export function finish(
  f: FlowState,
  code: string,
  finishedMin: number,
): FlowState {
  return { ...f, phase: "finished", code, finishedMin };
}

/** The `encodeCode` argument — one EncodeAttempt per graded task,
 *  in assignment order. Unanswered tasks encode as skipped. */
export function encodeAttempts(f: FlowState): EncodeAttempt[] {
  return f.tasks.map((t) => ({
    first: t.first,
    last: t.last,
    attempts: t.attempts,
  }));
}

/** Committed + committed-equivalent count for the progress line. */
export function answeredCount(f: FlowState): number {
  return f.tasks.filter((t) => t.first !== null).length;
}

// --- Step/position mapping ------------------------------------------------
//
// A stepper task (predict_pair / numeric) with `step: s` sits at
// stepper position s − 1, the same place prompts with `at_step: s`
// show — the pending join under discussion there.

/** The stepper position a graded task attaches to, or null for
 *  tasks that are not stepper tasks (predict_branch, reading). */
export function taskPosition(task: TaskRef): number | null {
  switch (task.kind) {
    case "predict_pair":
    case "numeric":
      return task.step - 1;
    default:
      return null;
  }
}

// --- Pick → TaskAnswer mapping --------------------------------------------
//
// A predict_pair pick names the two active clusters containing the
// picked tips. The engine resolves each picked tip index to the
// active cluster containing it and compares canonical members, so
// the web side reports the cluster's lowest tip index in the
// step-0 matrix's label order — the same tip_index table the
// engine builds (task.rs).

/** The canonical tip index of the active cluster `nodeId`: the
 *  lowest position of any of its leaf labels inside `tipOrder`
 *  (the step-0 matrix label order). -1 when nothing resolves. */
export function clusterTipIndex(
  tipOrder: string[],
  leafSets: ReadonlyMap<number, ReadonlySet<string>>,
  nodeId: number,
): number {
  const leaves = leafSets.get(nodeId);
  if (leaves === undefined) return -1;
  let best = -1;
  for (const label of leaves) {
    const idx = tipOrder.indexOf(label);
    if (idx >= 0 && (best < 0 || idx < best)) best = idx;
  }
  return best;
}

/** A matrix-cell pick (active indices i, j) as a Pair task answer,
 *  or null when either side fails to resolve. */
export function cellAnswer(
  tipOrder: string[],
  leafSets: ReadonlyMap<number, ReadonlySet<string>>,
  active: number[],
  i: number,
  j: number,
): TaskAnswer | null {
  if (i === j || active[i] === undefined || active[j] === undefined) {
    return null;
  }
  const a = clusterTipIndex(tipOrder, leafSets, active[i]);
  const b = clusterTipIndex(tipOrder, leafSets, active[j]);
  if (a < 0 || b < 0 || a === b) return null;
  return { kind: "pair", value: [a, b] };
}

/** A two-leaf tree pick as a Pair task answer: each leaf resolves
 *  to its containing active cluster's canonical tip. Two leaves in
 *  the same cluster are not a pair — null. */
export function leafAnswer(
  tipOrder: string[],
  leafSets: ReadonlyMap<number, ReadonlySet<string>>,
  active: number[],
  labelA: string,
  labelB: string,
): TaskAnswer | null {
  const clusterOf = (label: string): number => {
    const pos = active.findIndex((id) => leafSets.get(id)?.has(label) === true);
    return pos >= 0 ? clusterTipIndex(tipOrder, leafSets, active[pos]) : -1;
  };
  const a = clusterOf(labelA);
  const b = clusterOf(labelB);
  if (a < 0 || b < 0 || a === b) return null;
  return { kind: "pair", value: [a, b] };
}

/** A branch pick (the tree's `splitKey`, "|"-joined tip names) as a
 *  Branch task answer — the engine sorts the member list itself. */
export function branchAnswer(splitKey: string): TaskAnswer {
  return { kind: "branch", value: splitKey.split("|") };
}

/** Parse a typed decimal into its scaled integer at `decimals`
 *  display digits — exact string arithmetic, no float round-trip
 *  ("already scaled at the quantity's display precision", spec
 *  §5.3). Nonzero digits past the scale are a refusal: the
 *  displayed values never carry them. */
export function scaleNumericInput(
  text: string,
  decimals: number,
): number | null {
  const t = text.trim();
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(t);
  if (m === null) return null;
  const neg = m[1] === "-";
  const intPart = m[2].replace(/^0+/, "") || "0";
  const frac = (m[3] ?? "").padEnd(decimals, "0");
  if (frac.length > decimals && /[1-9]/.test(frac.slice(decimals))) {
    return null;
  }
  const digits = (intPart + frac.slice(0, decimals)).replace(/^0+/, "") || "0";
  const scaled = Number(`${neg ? "-" : ""}${digits}`);
  return Number.isSafeInteger(scaled) ? scaled : null;
}
