// The answer control for one item (v1.4d plan Task 8, spec §4.3/§7.3):
// one control per `Question` type. The non-tree controls live here
// (radio choices, checkboxes, the number stepper, the two-tier "why"
// radios); the pick-on-the-tree pieces — the order_nodes builder and
// the removable selection list — are in QuestionControlsTree. This
// file only ever builds `Response` values; correctness is the
// engine's `readingCheck`, never computed here.

import { useId } from "react";

import {
  OrderBuilder,
  SelectionList,
} from "./QuestionControlsTree";
import { traitNames, type ResponseDraft } from "../../reading/state";
import type { Item } from "../../engine/generated/Item";
import type { Question } from "../../engine/generated/Question";
import type { ReadingTreeView } from "../../engine/generated/ReadingTreeView";

export interface QuestionControlsProps {
  item: Item;
  /** The first tree's resolved view — trait names and lettered nodes. */
  view: ReadingTreeView;
  response: ResponseDraft | null;
  onResponse: (r: ResponseDraft | null) => void;
  /** The question element's id — every group and input is labelled
   *  or described by the question so a screen reader voices it on
   *  Tab-entry, not just the bare control name (checkpoint §21(p)). */
  questionId: string;
}

export function QuestionControls({
  item,
  view,
  response,
  onResponse,
  questionId,
}: QuestionControlsProps) {
  return (
    <div className="read-control">
      <ControlBody
        question={item.question}
        item={item}
        view={view}
        response={response}
        onResponse={onResponse}
        questionId={questionId}
      />
    </div>
  );
}

interface BodyProps extends QuestionControlsProps {
  question: Question;
}

function ControlBody(props: BodyProps) {
  const { question: q, item, response, onResponse, questionId } = props;
  switch (q.type) {
    case "which_differs": {
      const last = q.reference !== undefined
        ? "All agree with the reference tree"
        : "All show the same relationships";
      return (
        <RadioList
          label="Choose one"
          options={[...item.trees.map((_, i) => `Tree ${i + 1}`), last]}
          selected={response?.kind === "choice" ? response.index : -1}
          onPick={(index) => onResponse({ kind: "choice", index })}
          questionId={questionId}
        />
      );
    }
    case "which_fits":
      return (
        <RadioList
          label="Choose one"
          options={item.trees.map((_, i) => `Tree ${i + 1}`)}
          selected={response?.kind === "choice" ? response.index : -1}
          onPick={(index) => onResponse({ kind: "choice", index })}
          questionId={questionId}
        />
      );
    case "is_clade": {
      const options =
        q.by_trait === undefined
          ? ["Yes — a clade", "No — not a clade"]
          : ["Monophyletic", "Paraphyletic", "Polyphyletic"];
      return (
        <RadioList
          label="Choose one"
          options={options}
          selected={response?.kind === "choice" ? response.index : -1}
          onPick={(index) => onResponse({ kind: "choice", index })}
          questionId={questionId}
        />
      );
    }
    case "closest_relative": {
      if (q.form === "pairwise") {
        return (
          <RadioList
            label="Choose one"
            options={[
              `Closer to ${item.b ?? "B"}`,
              `Closer to ${item.c ?? "C"}`,
              "Equally close",
            ]}
            selected={
              response?.kind === "pairwise"
                ? ["B", "C", "Equal"].indexOf(response.answer)
                : -1
            }
            onPick={(i) =>
              onResponse({
                kind: "pairwise",
                answer: (["B", "C", "Equal"] as const)[i],
              })
            }
            questionId={questionId}
          />
        );
      }
      return <SelectionList {...props} />;
    }
    case "concept":
      return (
        <CheckList
          label="Tick every option that applies"
          options={q.options}
          selected={response?.kind === "choices" ? response.indices : []}
          onChange={(indices) => onResponse({ kind: "choices", indices })}
          questionId={questionId}
        />
      );
    case "select_true":
      return (
        <CheckList
          label="Tick every true statement"
          options={q.statements.map((s) => s.text)}
          selected={response?.kind === "choices" ? response.indices : []}
          onChange={(indices) => onResponse({ kind: "choices", indices })}
          questionId={questionId}
        />
      );
    case "count_clades":
      return (
        <NumberStep
          value={response?.kind === "number" ? response.value : null}
          onChange={(value) => onResponse({ kind: "number", value })}
          onClear={() => onResponse(null)}
          questionId={questionId}
        />
      );
    case "order_nodes":
      return <OrderBuilder {...props} />;
    case "mrca":
    case "smallest_clade":
    case "place_taxon":
      return <SelectionList {...props} />;
    case "trait":
      return <TraitControl {...props} />;
    case "two_tier":
      return <TwoTierControl {...props} />;
  }
}

// --- radio / checkbox lists -------------------------------------------------

function RadioList({
  label,
  options,
  selected,
  onPick,
  questionId,
  labelId,
}: {
  label: string;
  options: string[];
  selected: number;
  onPick: (i: number) => void;
  questionId: string;
  /** A visible element already carrying the instruction text (the
   *  two-tier "Why?") — its id is reused instead of a hidden span. */
  labelId?: string;
}) {
  const genId = useId();
  const instrId = labelId ?? genId;
  return (
    <div
      role="radiogroup"
      // "question … instruction" — Tab-entry voices the question
      // first, then what to do (§21(p)).
      aria-labelledby={`${questionId} ${instrId}`}
      className="read-choices"
    >
      {labelId === undefined && (
        <span id={instrId} className="read-sr">
          {label}
        </span>
      )}
      {options.map((opt, i) => (
        <label key={i} className="read-choice">
          <input
            type="radio"
            // One name per group keeps native arrow-key navigation
            // between options working for keyboard users.
            name={`read-radio-${label}`}
            checked={selected === i}
            onChange={() => onPick(i)}
          />
          <span>{opt}</span>
        </label>
      ))}
    </div>
  );
}

function CheckList({
  label,
  options,
  selected,
  onChange,
  questionId,
}: {
  label: string;
  options: string[];
  selected: number[];
  onChange: (indices: number[]) => void;
  questionId: string;
}) {
  const instrId = useId();
  const toggle = (i: number) =>
    onChange(
      selected.includes(i)
        ? selected.filter((x) => x !== i)
        : [...selected, i].sort((a, b) => a - b),
    );
  return (
    <div
      role="group"
      aria-labelledby={`${questionId} ${instrId}`}
      className="read-choices"
    >
      <span id={instrId} className="read-sr">
        {label}
      </span>
      {options.map((opt, i) => (
        <label key={i} className="read-choice">
          <input
            type="checkbox"
            checked={selected.includes(i)}
            onChange={() => toggle(i)}
          />
          <span>{opt}</span>
        </label>
      ))}
    </div>
  );
}

// --- number stepper ----------------------------------------------------------

function NumberStep({
  value,
  onChange,
  onClear,
  questionId,
}: {
  value: number | null;
  onChange: (v: number) => void;
  onClear: () => void;
  questionId: string;
}) {
  const cur = value ?? 0;
  return (
    <div className="read-stepper">
      <button
        type="button"
        className="read-step"
        aria-label="Decrease"
        onClick={() => onChange(Math.max(0, cur - 1))}
      >
        −
      </button>
      <input
        type="number"
        min={0}
        value={value === null ? "" : value}
        placeholder="0"
        aria-label="Answer"
        // The question rides the description so the spinbutton's
        // name stays "Answer" for everyone else (§21(p)).
        aria-describedby={questionId}
        onChange={(e) => {
          const v = e.target.value;
          if (v === "") {
            onClear();
            return;
          }
          const n = Number(v);
          if (Number.isInteger(n) && n >= 0) onChange(n);
        }}
      />
      <button
        type="button"
        className="read-step"
        aria-label="Increase"
        onClick={() => onChange(cur + 1)}
      >
        +
      </button>
    </div>
  );
}

// --- trait asks ---------------------------------------------------------------

function TraitControl(props: BodyProps) {
  const { question: q, view, response, onResponse, questionId } = props;
  if (q.type !== "trait") return null;
  const names = traitNames(view);
  const ask = q.ask;
  switch (ask.kind) {
    case "which_have":
    case "has_not":
      return <SelectionList {...props} />;
    case "which_shared":
      return (
        <RadioList
          label="Choose a trait"
          options={names}
          selected={response?.kind === "choice" ? response.index : -1}
          onPick={(index) => onResponse({ kind: "choice", index })}
          questionId={questionId}
        />
      );
    case "how_many_changes":
      return (
        <NumberStep
          value={response?.kind === "number" ? response.value : null}
          onChange={(value) => onResponse({ kind: "number", value })}
          onClear={() => onResponse(null)}
          questionId={questionId}
        />
      );
    case "profile": {
      const defs = new Map(view.traits.map((t) => [t.name, t]));
      return (
        <CheckList
          label="Tick every option that applies"
          options={names.map((n) => {
            const d = defs.get(n);
            return d === undefined ? n : `${n} — ${d.derived}`;
          })}
          selected={response?.kind === "choices" ? response.indices : []}
          onChange={(indices) => onResponse({ kind: "choices", indices })}
          questionId={questionId}
        />
      );
    }
    case "ancestral_or_derived": {
      const def = view.traits.find((t) => t.name === ask.trait_name);
      return (
        <RadioList
          label="Choose one"
          options={[
            `ancestral${def !== undefined ? ` (${def.ancestral})` : ""}`,
            `derived${def !== undefined ? ` (${def.derived})` : ""}`,
          ]}
          selected={response?.kind === "choice" ? response.index : -1}
          onPick={(index) => onResponse({ kind: "choice", index })}
          questionId={questionId}
        />
      );
    }
    case "homologous":
      return (
        <RadioList
          label="Choose one"
          options={["Homologous — one shared origin", "Arose independently"]}
          selected={response?.kind === "choice" ? response.index : -1}
          onPick={(index) => onResponse({ kind: "choice", index })}
          questionId={questionId}
        />
      );
  }
}


// --- two_tier -------------------------------------------------------------------

/** The inner question reuses ControlBody so a two-tier first step can
 *  be any question type; the second tier is the authored reason
 *  radios. The untouched inner answer is the draft's `null` marker —
 *  `isComplete` keeps Check off until both parts are real. */
function TwoTierControl(props: BodyProps) {
  const { question: q, item, view, response, onResponse, questionId } =
    props;
  const whyId = useId();
  if (q.type !== "two_tier") return null;
  const cur = response?.kind === "two_tier" ? response : null;
  const inner: ResponseDraft | null = cur?.first ?? null;
  const reason = cur?.reason ?? -1;
  const emit = (first: ResponseDraft | null, r: number) =>
    onResponse({
      kind: "two_tier",
      first,
      reason: r,
    });
  return (
    <div className="read-two-tier">
      <ControlBody
        question={q.first}
        item={item}
        view={view}
        response={inner}
        onResponse={(r) => emit(r, reason)}
        questionId={questionId}
      />
      <p className="read-why" id={whyId}>
        Why?
      </p>
      <RadioList
        label="Why?"
        labelId={whyId}
        options={q.reasons}
        selected={reason}
        onPick={(i) => emit(inner, i)}
        questionId={questionId}
      />
    </div>
  );
}
