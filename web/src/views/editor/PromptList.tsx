// Editor prompt list (v1.4 plan Task 10, spec §5.3): adds, orders and
// removes the exercise's step-gated teaching prompts — the EXISTING
// prompt types only (`predict_pair`, `note`, `predict_branch`); new
// prompt types are out of scope. Every prompt shows its gate: the
// 1-based join step it hangs on, or the bootstrap panel for
// `predict_branch`.
//
// Every action is a real button — the keyboard path is Tab + Enter,
// matching the rest of the editor; no prompt operation is pointer-only.

import { useState } from "react";

import type { NoteAfter } from "../../engine/generated/NoteAfter";
import type { Prompt } from "../../engine/generated/Prompt";
import type { PromptType } from "../../engine/generated/PromptType";

export interface PromptListProps {
  prompts: Prompt[];
  /** The main component's leaf labels — the only valid reveal_pair
   * values (the engine checks them against the alignment). */
  taxa: string[];
  onChange: (next: Prompt[]) => void;
}

const TYPE_LABEL: Record<PromptType, string> = {
  predict_pair: "Pair prediction",
  note: "Note",
  predict_branch: "Branch prediction",
};

const AFTER_LABEL: Record<NoteAfter, string> = {
  first_run: "the first completed run",
  continue_or_second_run: "a second run or a Continue",
  longer_run: "a longer run or a Continue",
};

function newPrompt(type: PromptType, atStep: number): Prompt {
  return {
    at_step: atStep,
    type,
    concept: "",
    math: null,
    reveal: null,
    reveal_pair: null,
    after: null,
  };
}

/** Gate text shown beside each prompt — "join 3" or the bootstrap
 * panel a predict_branch anchors to. */
function gateLabel(p: Prompt): string {
  return p.type === "predict_branch"
    ? "the “How sure are we?” panel"
    : `join ${p.at_step}`;
}

export function PromptList({ prompts, taxa, onChange }: PromptListProps) {
  // reveal_pair needs BOTH taxa to be valid; a half-picked pair lives
  // here (never in the prompt, so an incomplete pair can never reach
  // the saved file).
  const [pendingPairs, setPendingPairs] = useState<
    Record<number, [string, string]>
  >({});
  const set = (i: number, p: Prompt) =>
    onChange(prompts.map((q, k) => (k === i ? p : q)));
  const move = (i: number, d: -1 | 1) => {
    const j = i + d;
    if (j < 0 || j >= prompts.length) return;
    const next = [...prompts];
    [next[i], next[j]] = [next[j], next[i]];
    onChange(next);
  };

  const patch = (i: number, p: Partial<Prompt>) =>
    set(i, { ...prompts[i], ...p });

  const changeType = (i: number, type: PromptType) => {
    const p = prompts[i];
    // Keep the texts every type shares; drop what the new type can't
    // show so nothing stale reaches the file.
    set(i, {
      ...p,
      type,
      at_step: p.at_step < 1 ? 1 : p.at_step,
      reveal: type === "note" ? null : p.reveal,
      reveal_pair: type === "predict_pair" ? p.reveal_pair : null,
      after: type === "note" ? p.after : null,
    });
  };

  return (
    <div className="prompt-list">
      {prompts.length === 0 && (
        <p className="editor-hint">
          No prompts yet — a prompt is a step-gated card the student sees
          while building the tree.
        </p>
      )}
      {prompts.map((p, i) => (
        <fieldset className="prompt-item" key={i}>
          <legend>
            Prompt {i + 1} — {TYPE_LABEL[p.type]}, at {gateLabel(p)}
          </legend>
          <div className="prompt-item-head">
            <label className="field">
              <span>Type</span>
              <select
                aria-label={`Prompt ${i + 1} type`}
                value={p.type}
                onChange={(e) =>
                  changeType(i, e.target.value as PromptType)
                }
              >
                {(
                  Object.keys(TYPE_LABEL) as PromptType[]
                ).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            {p.type === "predict_branch" ? (
              <p className="editor-hint prompt-gate">
                Shows with the “How sure are we?” panel.
              </p>
            ) : (
              <label className="field prompt-step">
                <span>Join step</span>
                <input
                  type="number"
                  min={1}
                  aria-label={`Prompt ${i + 1} join step`}
                  value={p.at_step}
                  onChange={(e) => {
                    const v = Math.round(Number(e.target.value));
                    patch(i, {
                      at_step: Number.isFinite(v) && v >= 1 ? v : 1,
                    });
                  }}
                />
              </label>
            )}
            <div className="prompt-actions">
              <button
                type="button"
                aria-label={`Move prompt ${i + 1} up`}
                disabled={i === 0}
                onClick={() => move(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                aria-label={`Move prompt ${i + 1} down`}
                disabled={i === prompts.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                aria-label={`Remove prompt ${i + 1}`}
                onClick={() => onChange(prompts.filter((_, k) => k !== i))}
              >
                Remove
              </button>
            </div>
          </div>
          <label className="field">
            <span>Concept — what the card says</span>
            <textarea
              aria-label={`Prompt ${i + 1} concept`}
              value={p.concept}
              onChange={(e) => patch(i, { concept: e.target.value })}
            />
          </label>
          <label className="field">
            <span>Math (shown in math mode, optional)</span>
            <textarea
              aria-label={`Prompt ${i + 1} math`}
              value={p.math ?? ""}
              onChange={(e) =>
                patch(i, {
                  math: e.target.value === "" ? null : e.target.value,
                })
              }
            />
          </label>
          {p.type !== "note" && (
            <label className="field">
              <span>Reveal after the student answers (optional)</span>
              <textarea
                aria-label={`Prompt ${i + 1} reveal`}
                value={p.reveal ?? ""}
                onChange={(e) =>
                  patch(i, {
                    reveal: e.target.value === "" ? null : e.target.value,
                  })
                }
              />
            </label>
          )}
          {p.type === "predict_pair" && (
            <div className="prompt-pair">
              <span className="field-label">
                Reveal pair — taxa the answered card compares (optional)
              </span>
              {[0, 1].map((slot) => (
                <select
                  key={slot}
                  aria-label={`Prompt ${i + 1} reveal pair ${slot === 0 ? "first" : "second"} taxon`}
                  value={
                    pendingPairs[i]?.[slot] ?? p.reveal_pair?.[slot] ?? ""
                  }
                  onChange={(e) => {
                    const cur: [string, string] = [
                      pendingPairs[i]?.[0] ?? p.reveal_pair?.[0] ?? "",
                      pendingPairs[i]?.[1] ?? p.reveal_pair?.[1] ?? "",
                    ];
                    cur[slot] = e.target.value;
                    if (cur[0] === "" || cur[1] === "") {
                      setPendingPairs({ ...pendingPairs, [i]: cur });
                      if (prompts[i].reveal_pair !== null) {
                        patch(i, { reveal_pair: null });
                      }
                    } else {
                      const rest = { ...pendingPairs };
                      delete rest[i];
                      setPendingPairs(rest);
                      patch(i, { reveal_pair: cur });
                    }
                  }}
                >
                  <option value="">—</option>
                  {taxa.map((t) => (
                    <option key={t} value={t}>
                      {t}
                    </option>
                  ))}
                </select>
              ))}
            </div>
          )}
          {p.type === "note" && (
            <label className="field">
              <span>Show after</span>
              <select
                aria-label={`Prompt ${i + 1} sequencing`}
                value={p.after ?? ""}
                onChange={(e) =>
                  patch(i, {
                    after:
                      e.target.value === ""
                        ? null
                        : (e.target.value as NoteAfter),
                  })
                }
              >
                <option value="">with its step</option>
                {(Object.keys(AFTER_LABEL) as NoteAfter[]).map((a) => (
                  <option key={a} value={a}>
                    {AFTER_LABEL[a]}
                  </option>
                ))}
              </select>
            </label>
          )}
        </fieldset>
      ))}
      <div className="prompt-add-row">
        <button
          type="button"
          onClick={() =>
            onChange([...prompts, newPrompt("predict_pair", 1)])
          }
        >
          Add pair prediction
        </button>
        <button
          type="button"
          onClick={() => onChange([...prompts, newPrompt("note", 1)])}
        >
          Add note
        </button>
        <button
          type="button"
          onClick={() =>
            onChange([...prompts, newPrompt("predict_branch", 1)])
          }
        >
          Add branch prediction
        </button>
      </div>
    </div>
  );
}
