// Guided-lesson prompt card (plan Task 21, spec §6.2 "Guided lessons").
// Pure render — App owns the pick state and hands this component the
// prompt, the picked pair (cluster labels, null while unanswered) and
// the correct pair. A predict_pair prompt asks the question until a pick
// arrives, then shows the verdict plus the concept/math text; a note
// prompt only displays.

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
}

/** Pair equality ignores order — a join is a set of two clusters. */
const samePair = (a: [string, string], b: [string, string]) =>
  (a[0] === b[0] && a[1] === b[1]) || (a[0] === b[1] && a[1] === b[0]);

export function PromptCard({ prompt, mode, picked, answer }: PromptCardProps) {
  const predicting =
    prompt.type === "predict_pair" && picked === null && answer !== null;
  const answered =
    prompt.type === "predict_pair" && picked !== null && answer !== null;

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
      <p className="prompt-concept">{prompt.concept}</p>
      {answered && prompt.reveal !== null && (
        <p className="prompt-reveal">{prompt.reveal}</p>
      )}
      {predicting && (
        <p className="prompt-hint">
          Pick a cell in the matrix, or two leaves in a tree.
        </p>
      )}
      {mode === "math" && prompt.math !== null && (
        <p className="prompt-math">{prompt.math}</p>
      )}
    </div>
  );
}
