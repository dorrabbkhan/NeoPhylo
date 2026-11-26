// The graded-task card (v1.5 plan Task 8, spec §5.6): sits at the
// stepper position of a predict_pair / numeric task, and at the
// bootstrap stage for predict_branch. It shows the task, the
// student's current answer, a Check button in practice mode
// (each press is an attempt), the verdict, and the locked-in
// state once committed ("cannot be changed after advancing").
//
// Right/wrong comes from the engine's `checkTask` — this card only
// displays the recorded verdict.

import { useState } from "react";

import type { Mode } from "../../engine/generated/Mode";
import type { TaskAnswer } from "../../engine/generated/TaskAnswer";
import type { TaskRef } from "../../engine/generated/TaskRef";

const QUANTITY_LABEL: Record<string, string> = {
  q_value: "Q-value",
  branch_length: "Branch length",
  new_distance: "New distance",
  corrected_distance: "Corrected distance",
};

function rolePhrase(role: string, step: number): string {
  switch (role) {
    case "closest_raw":
      return `the closest pair at step ${step}`;
    case "chosen_first_to_new":
      return `the first member's branch to the new node at step ${step}`;
    case "chosen_second_to_new":
      return `the second member's branch to the new node at step ${step}`;
    default:
      return `the pair joined at step ${step}`;
  }
}

/** The card's headline — the same phrasing the assignment builder's
 *  task list uses (builder.ts taskLabel, kept in step so the
 *  student sees what the instructor set). */
function gateLabel(task: TaskRef): string {
  switch (task.kind) {
    case "predict_pair":
      return `Predict the pair joined at step ${task.step}`;
    case "predict_branch":
      return "Predict the least-supported grouping";
    case "numeric":
      return `Work out the ${QUANTITY_LABEL[task.quantity] ?? task.quantity} of ${rolePhrase(task.role, task.step)}`;
    case "reading":
      return `Answer item ${task.item + 1}`;
  }
}

export interface GradedTaskGateProps {
  task: TaskRef;
  mode: Mode;
  /** Committed answers are locked ("cannot be changed after
   *  advancing") — the card turns read-only. */
  committed: boolean;
  /** The draft answer, if one is entered. */
  draft: TaskAnswer | null;
  /** The last Check verdict (practice only), or null. */
  verdict: boolean | null;
  /** Display text for the draft/committed answer (pair names,
   *  clade tips, the entered number) — produced by the caller,
   *  which owns the name tables. */
  answerText: string | null;
  /** Numeric tasks: decimals the engine displays (scaling
   *  precision). 0 for other kinds. */
  decimals?: number;
  /** Check the current draft (practice mode). */
  onCheck?: () => void;
  /** Numeric input handler — the caller parses + sets the draft. */
  onNumeric?: (text: string) => void;
}

export function GradedTaskGate({
  task,
  mode,
  committed,
  draft,
  verdict,
  answerText,
  decimals = 3,
  onCheck,
  onNumeric,
}: GradedTaskGateProps) {
  const [text, setText] = useState("");
  const practice = mode === "practice";
  const answered = draft !== null || committed;

  return (
    <div className="assess-gate" data-committed={committed || undefined}>
      <p className="assess-gate-label">
        <span className="assess-gate-tag">Graded task</span>{" "}
        {gateLabel(task)}.
      </p>
      {task.kind === "predict_pair" && !committed && (
        <p className="assess-gate-hint">
          Pick a cell on the matrix or two leaves on a tree.
        </p>
      )}
      {task.kind === "predict_branch" && !committed && (
        <p className="assess-gate-hint">
          Click an internal branch on the inferred tree, then run the
          bootstrap.
        </p>
      )}
      {task.kind === "numeric" && !committed && (
        <p className="assess-gate-numeric">
          <label className="assess-gate-field">
            Your answer{" "}
            <input
              type="text"
              inputMode="decimal"
              className="assess-gate-input"
              aria-label={`${gateLabel(task)} — your answer`}
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                onNumeric?.(e.target.value);
              }}
            />
          </label>{" "}
          as displayed ({decimals} decimals).
        </p>
      )}
      {answerText !== null && (
        <p className="assess-gate-answer">
          Your answer: <strong>{answerText}</strong>
        </p>
      )}
      {committed && (
        <p className="assess-gate-locked">Answer locked in.</p>
      )}
      {!committed && practice && (
        <p className="assess-gate-actions">
          <button
            type="button"
            className="btn btn-secondary assess-check"
            disabled={!answered}
            onClick={onCheck}
          >
            Check
          </button>
          {verdict !== null && (
            <span
              role="status"
              className={
                verdict ? "assess-verdict-good" : "assess-verdict-bad"
              }
            >
              {verdict ? "Correct." : "Not quite — try again."}
            </span>
          )}
        </p>
      )}
    </div>
  );
}
