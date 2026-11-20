// Per-question-type fields for the reading-set editor's item form
// (v1.4d plan Task 10). Every option the author edits here lands in
// the item's `question` (or its a/b/c bindings); tips and clades are
// readouts — they're set by tapping the preview tree (ItemForm owns
// the pick plumbing), not by typing. The select_true statements and
// the trait ask have their own files.

import { useId } from "react";

import type { Question } from "../../../engine/generated/Question";

import { Field, PickedField, Text } from "./fields";
import { newQuestion, QUESTION_TYPES } from "./readingItems";
import { StatementsEditor } from "./StatementFields";
import { TraitAskFields } from "./TraitAskFields";

export interface QuestionFieldsProps {
  q: Question;
  onChange: (q: Question) => void;
  /** Every tree name in the set (which_fits' small trees, the
   *  which_differs reference). */
  treeNames: string[];
}

export function QuestionFields({
  q,
  onChange,
  treeNames,
}: QuestionFieldsProps) {
  const reasonGroup = useId();
  switch (q.type) {
    case "which_differs":
      return (
        <Field label="Reference tree (optional)">
          <select
            value={q.reference ?? ""}
            onChange={(e) =>
              onChange(
                e.target.value === ""
                  ? { type: "which_differs" }
                  : { type: "which_differs", reference: e.target.value },
              )
            }
          >
            <option value="">No reference tree</option>
            {treeNames.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </Field>
      );
    case "which_fits":
      return (
        <fieldset className="rde-checks">
          <legend>Small trees the big tree must agree with</legend>
          {treeNames.map((n) => (
            <label key={n} className="rde-check">
              <input
                type="checkbox"
                checked={q.small.includes(n)}
                onChange={(e) =>
                  onChange({
                    ...q,
                    small: e.target.checked
                      ? [...q.small, n]
                      : q.small.filter((x) => x !== n),
                  })
                }
              />
              {n}
            </label>
          ))}
        </fieldset>
      );
    case "mrca":
      return (
        <p className="editor-hint">
          The student taps the MRCA of the {`{set}`} tips. To answer
          with lettered options instead, pick “lettered options” above
          and tap the tree’s points.
        </p>
      );
    case "place_taxon":
      return (
        <>
          <Text
            label="New taxon name"
            value={q.name}
            onChange={(name) => onChange({ ...q, name })}
          />
          <PickedField
            label="Sister set"
            value={q.sister.length > 0 ? q.sister : undefined}
            onClear={() => onChange({ ...q, sister: [] })}
          />
        </>
      );
    case "is_clade":
      return (
        <Text
          label="Trait that defines the group (optional)"
          value={q.by_trait ?? ""}
          onChange={(v) =>
            onChange(
              v === ""
                ? { type: "is_clade" }
                : { type: "is_clade", by_trait: v },
            )
          }
        />
      );
    case "closest_relative":
      return (
        <>
          <Field label="Form">
            <select
              value={q.form}
              onChange={(e) =>
                onChange({
                  ...q,
                  form: e.target.value as typeof q.form,
                })
              }
            >
              <option value="closest">Closest relative</option>
              <option value="most_distant">Most distant</option>
              <option value="pairwise">Closer to b or to c</option>
            </select>
          </Field>
          <p className="editor-hint">
            Pick tips on the preview tree: a always, b and c for the
            pairwise form.
          </p>
        </>
      );
    case "order_nodes":
      return (
        <p className="editor-hint">
          Pick “lettered nodes” above and tap the nodes in the tree to
          list the letters the student will order.
        </p>
      );
    case "select_true":
      return (
        <StatementsEditor
          statements={q.statements}
          onChange={(statements) => onChange({ ...q, statements })}
        />
      );
    case "trait":
      return (
        <TraitAskFields
          ask={q.ask}
          onChange={(ask) => onChange({ ...q, ask })}
        />
      );
    case "concept":
      return (
        <div className="rde-statements">
          <p className="editor-hint">
            The concept answer is authored — it is labelled “authored
            answer” wherever shown.
          </p>
          {q.options.map((o, i) => (
            <div className="rde-option" key={i}>
              <label className="field">
                <span>Option {i + 1}</span>
                <input
                  type="text"
                  value={o}
                  onChange={(e) =>
                    onChange({
                      ...q,
                      options: q.options.map((x, j) =>
                        j === i ? e.target.value : x,
                      ),
                    })
                  }
                />
              </label>
              <label className="rde-check">
                <input
                  type="checkbox"
                  checked={q.correct.includes(i)}
                  onChange={(e) =>
                    onChange({
                      ...q,
                      correct: e.target.checked
                        ? [...q.correct, i].sort()
                        : q.correct.filter((x) => x !== i),
                    })
                  }
                />
                Correct
              </label>
              <button
                type="button"
                className="rde-chip-x"
                onClick={() =>
                  onChange({
                    ...q,
                    options: q.options.filter((_, j) => j !== i),
                    correct: q.correct
                      .filter((x) => x !== i)
                      .map((x) => (x > i ? x - 1 : x)),
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...q, options: [...q.options, ""] })}
          >
            Add option
          </button>
        </div>
      );
    case "two_tier":
      return (
        <div className="rde-statements">
          <Field label="First question type">
            <select
              value={q.first.type}
              onChange={(e) => {
                const t = e.target.value as Question["type"];
                onChange({
                  ...q,
                  first: t === "two_tier" ? q.first : newQuestion(t),
                });
              }}
            >
              {QUESTION_TYPES.filter((x) => x.value !== "two_tier").map(
                (x) => (
                  <option key={x.value} value={x.value}>
                    {x.label}
                  </option>
                ),
              )}
            </select>
          </Field>
          <QuestionFields
            q={q.first}
            onChange={(first) => onChange({ ...q, first })}
            treeNames={treeNames}
          />
          {q.reasons.map((r, i) => (
            <div className="rde-option" key={i}>
              <label className="field">
                <span>Reason {i + 1}</span>
                <input
                  type="text"
                  value={r}
                  onChange={(e) =>
                    onChange({
                      ...q,
                      reasons: q.reasons.map((x, j) =>
                        j === i ? e.target.value : x,
                      ),
                    })
                  }
                />
              </label>
              <label className="rde-check">
                <input
                  type="radio"
                  name={reasonGroup}
                  checked={q.correct_reason === i}
                  onChange={() => onChange({ ...q, correct_reason: i })}
                />
                Correct reason
              </label>
              <button
                type="button"
                className="rde-chip-x"
                onClick={() =>
                  onChange({
                    ...q,
                    reasons: q.reasons.filter((_, j) => j !== i),
                    correct_reason:
                      q.correct_reason === i
                        ? 0
                        : q.correct_reason > i
                          ? q.correct_reason - 1
                          : q.correct_reason,
                  })
                }
              >
                Remove
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => onChange({ ...q, reasons: [...q.reasons, ""] })}
          >
            Add reason
          </button>
        </div>
      );
    default:
      return null;
  }
}
