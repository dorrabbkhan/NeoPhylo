// One reading item's edit form (v1.4d plan Task 10, spec §7.5): the
// shared fields (id, text, trees, style, rotate tool), a live
// pick-by-tapping preview of the item's first tree — taps fill the
// target the "Pick by tapping" select names — and the per-type
// fields from QuestionFields. The engine's answer (or the
// InvalidReading naming this item) shows live at the bottom.

import { useState } from "react";

import type { AnswerKey } from "../../../engine/generated/AnswerKey";
import type { Item } from "../../../engine/generated/Item";
import type { ReadingTreeView } from "../../../engine/generated/ReadingTreeView";
import type { Shape } from "../../../engine/generated/Shape";
import type { TipSide } from "../../../engine/generated/TipSide";
import type { ReadingStyle } from "../../../layout/readingLayout";

import { ReadingTree } from "../../reading/ReadingTree";

import { QuestionFields } from "./QuestionFields";
import {
  applyPick,
  newQuestion,
  pickTargetsFor,
  QUESTION_TYPES,
  traitNamesOf,
  type PickTarget,
} from "./readingItems";

const SHAPES: Shape[] = ["rectangular", "diagonal", "circular"];
const SIDES: TipSide[] = ["right", "up", "left", "down"];

const DEFAULT_STYLE: ReadingStyle = { shape: "rectangular", tips: "right" };

export interface ItemFormProps {
  item: Item;
  /** Every tree name in the set. */
  treeNames: string[];
  /** Resolved stored trees, by name (missing when a tree fails its
   *  probe — the preview then shows a text note). */
  treeViews: Map<string, ReadingTreeView>;
  /** The engine's answer key when the whole set loads, else null. */
  answer: AnswerKey | null;
  /** The InvalidReading naming this item, when the set fails. */
  error: string | null;
  onChange: (item: Item) => void;
  onRemove: () => void;
}

export function ItemForm({
  item,
  treeNames,
  treeViews,
  answer,
  error,
  onChange,
  onRemove,
}: ItemFormProps) {
  const targets = pickTargetsFor(item.question);
  const [target, setTarget] = useState<PickTarget | null>(null);
  const active =
    target !== null && targets.some((t) => t.id === target.id)
      ? target
      : (targets[0] ?? null);

  const previewName = item.trees[0] ?? treeNames[0];
  const view =
    previewName === undefined ? undefined : treeViews.get(previewName);
  // The ask's trait fields validate against the item's first tree —
  // offer exactly its trait names.
  const traitNames = view === undefined ? [] : traitNamesOf(view);
  const style: ReadingStyle =
    item.style === undefined
      ? DEFAULT_STYLE
      : { shape: item.style.shape, tips: item.style.tips };

  /** The clades to ring on the preview for the active target — the
   *  picked values drawn as selections. */
  const selected: string[][] = (() => {
    if (view === undefined || active === null) return [];
    const q = item.question;
    switch (active.id) {
      case "tips":
        return item.tips.map((t) => [t]);
      case "a":
        return item.a === undefined ? [] : [[item.a]];
      case "b":
        return item.b === undefined ? [] : [[item.b]];
      case "c":
        return item.c === undefined ? [] : [[item.c]];
      case "sister":
        return q.type === "place_taxon" && q.sister.length > 0
          ? [q.sister]
          : [];
      case "mrca-options":
        if (q.type !== "mrca" || q.options === undefined) return [];
        return view.points
          .filter((p) => q.options!.includes(p.letter))
          .map((p) => p.on);
      case "order-nodes":
        if (q.type !== "order_nodes") return [];
        return q.nodes
          .map((l) => view.nodes.find((n) => n.letter === l)?.clade)
          .filter((c): c is string[] => c !== undefined);
      default:
        return [];
    }
  })();

  const onTreeTap = (clade: string[]) => {
    if (view === undefined || active === null) return;
    onChange(applyPick(item, active.id, clade, view));
  };

  return (
    <section
      className="rde-item"
      role="group"
      aria-label={`Item ${item.id}`}
    >
      <div className="rde-item-head">
        <label className="field">
          <span>Item id</span>
          <input
            type="text"
            value={item.id}
            onChange={(e) => onChange({ ...item, id: e.target.value })}
          />
        </label>
        <button
          type="button"
          className="rde-chip-x btn btn-ghost"
          aria-label={`Remove item ${item.id}`}
          onClick={onRemove}
        >
          Remove item
        </button>
      </div>
      <label className="field">
        <span>Question text</span>
        <textarea
          rows={2}
          value={item.text}
          placeholder="Use {a} {b} {c} for named tips, {set} for the tip list"
          onChange={(e) => onChange({ ...item, text: e.target.value })}
        />
      </label>
      <label className="field">
        <span>Note after answering (optional)</span>
        <textarea
          rows={1}
          value={item.note_after ?? ""}
          onChange={(e) =>
            onChange({
              ...item,
              note_after:
                e.target.value === "" ? undefined : e.target.value,
            })
          }
        />
      </label>
      <fieldset className="rde-checks">
        <legend>Show in trees</legend>
        {treeNames.map((n) => (
          <label key={n} className="rde-check">
            <input
              type="checkbox"
              checked={item.trees.includes(n)}
              onChange={(e) =>
                onChange({
                  ...item,
                  trees: e.target.checked
                    ? [...item.trees, n]
                    : item.trees.filter((x) => x !== n),
                })
              }
            />
            {n}
          </label>
        ))}
      </fieldset>
      <div className="rde-item-row">
        <label className="field">
          <span>Question type</span>
          <select
            value={item.question.type}
            onChange={(e) =>
              onChange({
                ...item,
                question: newQuestion(e.target.value as Item["question"]["type"]),
              })
            }
          >
            {QUESTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Drawing shape</span>
          <select
            value={item.style?.shape ?? "rectangular"}
            onChange={(e) =>
              onChange({
                ...item,
                style: {
                  shape: e.target.value as Shape,
                  tips: item.style?.tips ?? "right",
                  per_tree: item.style?.per_tree ?? [],
                },
              })
            }
          >
            {SHAPES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Tips point</span>
          <select
            value={item.style?.tips ?? "right"}
            onChange={(e) =>
              onChange({
                ...item,
                style: {
                  shape: item.style?.shape ?? "rectangular",
                  tips: e.target.value as TipSide,
                  per_tree: item.style?.per_tree ?? [],
                },
              })
            }
          >
            {SIDES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </label>
        <label className="rde-check">
          <input
            type="checkbox"
            checked={item.rotate_tool}
            onChange={(e) =>
              onChange({ ...item, rotate_tool: e.target.checked })
            }
          />
          Rotate tool
        </label>
      </div>
      <QuestionFields
        q={item.question}
        onChange={(question) => onChange({ ...item, question })}
        treeNames={treeNames}
        traitNames={traitNames}
      />
      {targets.length > 0 && view !== undefined && (
        <div className="rde-pick">
          <label className="field">
            <span>Pick by tapping</span>
            <select
              value={active?.id ?? ""}
              onChange={(e) =>
                setTarget(
                  targets.find((t) => t.id === e.target.value) ?? null,
                )
              }
            >
              {targets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <ReadingTree
            view={view}
            style={style}
            selectable={active?.selectable ?? "none"}
            selected={selected}
            onSelect={onTreeTap}
            highlight={item.tips}
            rotatable={false}
            onRotate={() => {}}
            label={`Pick tree for item ${item.id}`}
          />
        </div>
      )}
      {error !== null && (
        <p role="alert" className="editor-error">
          {error}
        </p>
      )}
      {/* The engine's answer is announced like a verdict: the status
          region exists from mount (empty div, no space) so the first
          answer it ever fills is announced, not just later edits
          (checkpoint §21(p)). */}
      <div role="status" aria-label="Engine answer">
        {answer !== null && (
          <p className="rde-answer">
            <strong>Answer:</strong> {answer.explanation}
            {answer.authored && (
              <span className="rde-authored"> (authored answer)</span>
            )}
          </p>
        )}
      </div>
    </section>
  );
}
