// Guided-lesson prompt card (plan Task 21, spec §6.2 "Guided lessons").
// Pure render — App owns the pick state and hands this component the
// prompt, the picked pair (cluster labels, null while unanswered) and
// the correct pair. A predict_pair prompt asks the question until a pick
// arrives, then shows the verdict plus the concept/math text; a note
// prompt only displays.
//
// v1.2 spec §7.1: a `predict_branch` prompt asks the student to click
// the internal branch they expect to be weakest before running the
// bootstrap. `branch.picked` is the clicked edge's split key (null while
// unanswered); `branch.verdict` arrives with the run's results and reads
// "Correct" or names the weakest grouping with its support. The reveal
// text — the "why" — shows only with the verdict, never before the run
// (it is part of the answer).

import type { Prompt } from "../engine/generated/Prompt";
import type { Session } from "../state/session";

export interface PromptCardProps {
  prompt: Prompt;
  /** Global explanation mode; math text is added in "math" mode. */
  mode: Session["mode"];
  /** Cluster labels the student picked; null while unanswered. */
  picked: [string, string] | null;
  /** The joining pair's cluster labels; null when this position has no
   * pair (the card then renders like a note). */
  answer: [string, string] | null;
  /** predict_branch state (v1.2 §7.1): the clicked internal branch's
   * split key, whether the student last clicked a terminal edge, and —
   * once a run lands — the verdict against the weakest grouping. */
  branch?: {
    picked: string | null;
    terminalPicked?: boolean;
    verdict: {
      correct: boolean;
      weakest: string[];
      supportPct: number;
    } | null;
  };
  /** Opens the pair-detail dialog for the prompt's `reveal_pair`
   * (checkpoint 12); the card only shows the button when this is set. */
  onShowPair?: (pair: [string, string]) => void;
  /** Sequenced notes only (bootstrap-basics round 3): the note offers
   * "Continue" to unlock the next stage; unset means no button — the
   * stage was already continued or its successor unlocked by a run. */
  onContinue?: () => void;
}

/** Pair equality ignores order — a join is a set of two clusters. */
const samePair = (a: [string, string], b: [string, string]) =>
  (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

export function PromptCard({
  prompt,
  mode,
  picked,
  answer,
  branch,
  onShowPair,
  onContinue,
}: PromptCardProps) {
  const predicting =
    prompt.type === "predict_pair" && picked === null && answer !== null;
  const answered =
    prompt.type === "predict_pair" && picked !== null && answer !== null;
  // predict_branch (v1.2 §7.1): unanswered → pick hint; answered → wait
  // for the run; verdict → score the pick against the weakest grouping.
  const isBranch = prompt.type === "predict_branch";
  const branchPicked = isBranch && branch?.picked != null;
  const verdict = isBranch ? (branch?.verdict ?? null) : null;

  return (
    <div className="prompt-card" aria-live="polite">
      {answered && (
        <p
          className={
            samePair(picked, answer)
              ? "prompt-verdict correct"
              : "prompt-verdict wrong"
          }
        >
          {samePair(picked, answer)
            ? "Correct"
            : `Not quite: the answer is ${answer[0]} and ${answer[1]}.`}
        </p>
      )}
      {verdict !== null && (
        <p
          className={
            verdict.correct ? "prompt-verdict correct" : "prompt-verdict wrong"
          }
        >
          {verdict.correct
            ? "Your prediction: Correct"
            : `Your prediction: Not quite — the weakest group was (${verdict.weakest.join(
                ", ",
              )}) at ${verdict.supportPct}%.`}
        </p>
      )}
      <p className="prompt-concept">{prompt.concept}</p>
      {((answered && prompt.type === "predict_pair") ||
        (verdict !== null && isBranch)) &&
        prompt.reveal !== null && (
          <p className="prompt-reveal">{prompt.reveal}</p>
        )}
      {answered && prompt.reveal_pair !== null && onShowPair !== undefined && (
        <button
          type="button"
          className="prompt-show-pair"
          onClick={() => onShowPair(prompt.reveal_pair as [string, string])}
        >
          Show {prompt.reveal_pair[0]} vs {prompt.reveal_pair[1]}
        </button>
      )}
      {predicting && (
        <p className="prompt-hint">
          Pick a cell in the matrix, or two leaves in a tree.
        </p>
      )}
      {isBranch && !branchPicked && !branch?.terminalPicked && (
        <p className="prompt-hint">
          Click an internal branch of the inferred tree — terminal branches
          don't count.
        </p>
      )}
      {isBranch && !branchPicked && branch?.terminalPicked === true && (
        <p className="prompt-hint">
          Pick a branch that joins two or more taxa.
        </p>
      )}
      {isBranch && branchPicked && verdict === null && (
        <p className="prompt-hint">Prediction saved — run the bootstrap.</p>
      )}
      {mode === "math" && prompt.math !== null && (
        <p className="prompt-math">{prompt.math}</p>
      )}
      {onContinue !== undefined && (
        <button
          type="button"
          className="prompt-continue"
          onClick={onContinue}
        >
          Continue
        </button>
      )}
    </div>
  );
}
