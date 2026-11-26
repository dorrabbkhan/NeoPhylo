// Reading-set assignment flow (v1.5 plan Task 8, spec §5.6):
// the variant's set runs through the reading area's own ItemView
// and reducer — the assignment layer wraps dispatch to record
// each Check as an attempt on the graded item's task and to turn
// Finish into the flow's commit + code issue, never the set's own
// summary. Graded items carry a "Graded" chip.
//
// The set is served under the ASSIGNMENT's mode (spec §5.1): a
// test assignment shows no verdicts even when the set file says
// practice — the mode flag is display-only and never reaches the
// engine (reading_check ignores it).

import { useMemo, useReducer } from "react";

import type { Mode } from "../../engine/generated/Mode";
import type { ReadingSet } from "../../engine/generated/ReadingSet";
import type { TaskAnswer } from "../../engine/generated/TaskAnswer";
import {
  effectiveResponse,
  initSession,
  readingReducer,
  type ReadingAction,
} from "../../reading/state";

import { ItemView } from "../reading/ItemView";

export interface AssignmentReadingProps {
  /** The variant's reading set — mode is overridden below. */
  set: ReadingSet;
  /** The assignment's mode — the set's own mode is ignored. */
  mode: Mode;
  /** Graded item index → task index in the assignment list. */
  graded: ReadonlyMap<number, number>;
  /** A Check press on a graded item — records an attempt. */
  onCheck: (taskIndex: number, answer: TaskAnswer) => void;
  /** Finish pressed: the argument maps each graded item's task
   *  index to its current response (null = unanswered) so the
   *  caller can commit and issue the code. */
  onFinish: (answers: ReadonlyMap<number, TaskAnswer | null>) => void;
  /** The caller's per-task record for a reading item's current
   *  state (committed marks are rendered as a chip). */
  committed: (taskIndex: number) => boolean;
}

export function AssignmentReading({
  set,
  mode,
  graded,
  onCheck,
  onFinish,
  committed,
}: AssignmentReadingProps) {
  const displaySet = useMemo<ReadingSet>(
    () => ({ ...set, mode }),
    [set, mode],
  );
  const [s, baseDispatch] = useReducer(readingReducer, displaySet, initSession);
  const item = displaySet.items[s.index];
  const taskIndex = graded.get(s.index);

  const dispatch = (a: ReadingAction) => {
    if (a.type === "check" && taskIndex !== undefined && item !== undefined) {
      const r = effectiveResponse(item, s.responses[s.index]);
      if (r !== null) onCheck(taskIndex, { kind: "reading", value: r });
    }
    if (a.type === "finish") {
      const answers = new Map<number, TaskAnswer | null>();
      graded.forEach((tIdx, itemIdx) => {
        const it = displaySet.items[itemIdx];
        const r =
          it === undefined
            ? null
            : effectiveResponse(it, s.responses[itemIdx] ?? null);
        answers.set(
          tIdx,
          r === null ? null : { kind: "reading", value: r },
        );
      });
      onFinish(answers);
      return;
    }
    baseDispatch(a);
  };

  return (
    <div className="assess-reading">
      {taskIndex !== undefined && (
        <p className="assess-graded-chip">
          Graded task{committed(taskIndex) ? " — answer recorded" : ""}
        </p>
      )}
      <ItemView set={displaySet} s={s} dispatch={dispatch} />
    </div>
  );
}
