// The finish screen (v1.4d plan Task 8, spec §4.4): score plus each
// item's engine explanation. In test mode this is the first place the
// student ever sees correctness — nothing leaks earlier because the
// reducer only sets `checked` in practice mode. Verdicts and
// explanations come from `readingCheck`/`readingAnswer` here too;
// the summary recomputes nothing itself.

import { engine } from "../../engine/index";
import { effectiveResponse, fillItemText, submittable } from "../../reading/state";
import type { ReadingSet } from "../../engine/generated/ReadingSet";
import type { Response } from "../../engine/generated/Response";

export interface TestSummaryProps {
  set: ReadingSet;
  responses: (Response | null)[];
  onRestart: () => void;
}

interface Row {
  item: string;
  text: string;
  answered: boolean;
  correct: boolean;
  explanation: string;
  noteAfter?: string;
}

function rows(set: ReadingSet, responses: (Response | null)[]): Row[] {
  return set.items.map((item, i) => {
    const r = responses[i] ?? null;
    const answered = r !== null;
    // An unanswered item has no response to check: correctness is
    // false by definition and the explanation is the answer key's
    // own text (engine-computed like everything else).
    if (!answered && !submittable(item, null)) {
      const key = engine.readingAnswer(set, i);
      return {
        item: item.id,
        text: fillItemText(item),
        answered,
        correct: false,
        explanation: key.ok
          ? key.value.explanation
          : "This item's answer could not be computed.",
        noteAfter: item.note_after,
      };
    }
    const v = engine.readingCheck(set, i, effectiveResponse(item, r));
    return {
      item: item.id,
      text: fillItemText(item),
      answered,
      correct: v.ok ? v.value.correct : false,
      explanation: v.ok
        ? v.value.explanation
        : "Your answer could not be checked.",
      noteAfter: item.note_after,
    };
  });
}

export function TestSummary({ set, responses, onRestart }: TestSummaryProps) {
  const results = rows(set, responses);
  const score = results.filter((r) => r.correct).length;
  return (
    <section className="read-summary" aria-label="Results">
      <h1>{set.title} — your results</h1>
      <p className="read-score">
        You answered {score} of {results.length} correctly.
      </p>
      <ol className="read-summary-list">
        {results.map((r, i) => (
          <li key={r.item} className="read-summary-item">
            <p className="read-summary-q">
              <strong>
                {i + 1}. {r.text}
              </strong>
            </p>
            <p
              className={
                r.correct ? "read-verdict-good" : "read-verdict-bad"
              }
            >
              {r.correct
                ? "Correct."
                : r.answered
                  ? "Not correct."
                  : "Not answered."}{" "}
              {r.explanation}
            </p>
            {r.noteAfter !== undefined && (
              <p className="read-note">{r.noteAfter}</p>
            )}
          </li>
        ))}
      </ol>
      <button type="button" className="read-nav-btn" onClick={onRestart}>
        Start again
      </button>
    </section>
  );
}
