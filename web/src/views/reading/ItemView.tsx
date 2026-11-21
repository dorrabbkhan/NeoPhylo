// One reading item on screen (v1.4d plan Task 8, spec §4.4/§4.6/§7):
// the question line, the tree(s) in display order, the answer
// control, the practice-mode verdict and Back/Next. The component
// maps tree taps onto `Response` values and renders what the engine
// returns — it computes no answers itself.
//
// Selection is stored as clade keys / point letters, not screen
// positions, so a rotation inside ReadingTree keeps the picked clade
// selected without the page tracking orientation.

import { useMemo } from "react";

import { engine } from "../../engine/index";
import { cladeKey } from "../../layout/readingGeom";
import type { ReadingStyle } from "../../layout/readingLayout";
import { readErrorMessage } from "../../reading/errors";
import {
  effectiveResponse,
  fillItemText,
  fillPlaceholders,
  selectableFor,
  submittable,
  type ReadingAction,
  type ReadingSession,
  type ResponseDraft,
} from "../../reading/state";
import type { Item } from "../../engine/generated/Item";
import type { Question } from "../../engine/generated/Question";
import type { ReadingSet } from "../../engine/generated/ReadingSet";
import type { ReadingTreeView } from "../../engine/generated/ReadingTreeView";
import type { Response } from "../../engine/generated/Response";

import { QuestionControls } from "./QuestionControls";
import { ReadingTree } from "./ReadingTree";

/** One resolved tree on screen: the name for the view, the label the
 *  figure captions itself with, and which slot's style applies. */
interface ShownTree {
  name: string;
  label: string;
  /** Index into item.trees for per_tree styles; -1 for the reference
   *  or small trees, which take the item's base style. */
  styleIndex: number;
}

/** Display order (spec §6): the reference first, then the item's
 *  trees, then the small trees a which_fits item compares against. */
function shownTrees(item: Item): ShownTree[] {
  const out: ShownTree[] = [];
  const q = item.question;
  if (q.type === "which_differs" && q.reference !== undefined) {
    out.push({ name: q.reference, label: "Reference tree", styleIndex: -1 });
  }
  item.trees.forEach((name, i) => {
    out.push({
      name,
      label: item.trees.length > 1 ? `Tree ${i + 1}` : "Tree",
      styleIndex: i,
    });
  });
  if (q.type === "which_fits") {
    q.small.forEach((name, i) => {
      out.push({ name, label: `Small tree ${i + 1}`, styleIndex: -1 });
    });
  }
  return out;
}

const DEFAULT_STYLE: ReadingStyle = { shape: "rectangular", tips: "right" };

function styleFor(item: Item, styleIndex: number): ReadingStyle {
  const s = item.style;
  if (s === undefined) return DEFAULT_STYLE;
  if (styleIndex >= 0) {
    const per = s.per_tree[styleIndex];
    if (per !== undefined) return { shape: per.shape, tips: per.tips };
  }
  return { shape: s.shape, tips: s.tips };
}

/** The question the tree taps answer: a two-tier item's taps feed
 *  its first question. */
function tapQuestion(q: Question): Question {
  return q.type === "two_tier" ? q.first : q;
}

export function ItemView({
  set,
  s,
  dispatch,
}: {
  set: ReadingSet;
  s: ReadingSession;
  dispatch: (a: ReadingAction) => void;
}) {
  const item = set.items[s.index];

  // Resolved views, memoised per item — the views are immutable so a
  // response or rotation change never re-resolves. `item` can only be
  // absent if the index ran past the end, which the reducer's clamps
  // prevent — the guard below is for the type checker, not a real
  // state.
  const treeKeys =
    item === undefined
      ? ""
      : shownTrees(item)
          .map((t) => t.name)
          .join(" ");
  const views = useMemo(() => {
    const out = new Map<string, ReadingTreeView>();
    for (const name of treeKeys.split(" ")) {
      if (name === "") continue;
      const r = engine.readingTree(set, name);
      if (r.ok) out.set(name, r.value);
    }
    return out;
  }, [set, treeKeys]);

  const q = item?.question;
  const tq = q === undefined ? undefined : tapQuestion(q);
  const pick = q === undefined ? "none" : selectableFor(q);
  const practice = set.mode === "practice";
  const last = s.index === set.items.length - 1;
  const view0 = item === undefined ? undefined : views.get(item.trees[0]);

  const response = s.responses[s.index] ?? null;
  // The response a two-tier item's taps and inner controls edit.
  const innerResponse =
    q?.type === "two_tier" && response?.kind === "two_tier"
      ? response.first
      : response;

  /** Selected clades for the pick layer: the response, expressed as
   *  clade keys the tree can ring. */
  const selected = useMemo(() => {
    const r = innerResponse;
    if (r === null || r === undefined) return [] as string[][];
    if (pick === "node" && r.kind === "node") return [r.clade];
    if (pick === "node" && r.kind === "order" && view0 !== undefined) {
      return r.letters
        .map((l) => view0.nodes.find((n) => n.letter === l)?.clade)
        .filter((c): c is string[] => c !== undefined);
    }
    if (pick === "tips" && r.kind === "tips") {
      return r.tips.map((t) => [t]);
    }
    if (pick === "points" && r.kind === "point" && view0 !== undefined) {
      const p = view0.points.find((x) => x.letter === r.letter);
      return p !== undefined ? [p.on] : [];
    }
    return [];
  }, [innerResponse, pick, view0]);

  // Hooks all above this line; the guards are type-level only (the
  // reducer keeps index in bounds).
  if (item === undefined || q === undefined || tq === undefined) {
    return null;
  }

  const emit = (r: ResponseDraft | null) =>
    dispatch({ type: "answer", response: r });

  /** A tap on the tree becomes (or edits) the tap-question response;
   *  in a two-tier item it lands inside `first` — `null` there is the
   *  unanswered marker, kept until the student picks. */
  const onSelect = (clade: string[]) => {
    const next = selectResponse(tq, clade, innerResponse, view0);
    if (next === undefined) return;
    if (q.type === "two_tier") {
      const reason =
        response?.kind === "two_tier" ? response.reason : -1;
      emit({ kind: "two_tier", first: next, reason });
    } else {
      emit(next);
    }
  };

  const checkable = practice && submittable(item, response);
  // `effective` is null only for a draft still holding the
  // unanswered-inner marker — a checked item is always submittable,
  // so the marker can't reach `readingCheck` from here.
  const effective = effectiveResponse(item, response);
  const verdict =
    practice && s.checked[s.index] && effective !== null
      ? engine.readingCheck(set, s.index, effective)
      : null;
  // Resolved = the answer is out: "Show answer" pressed, or a second
  // Check landed (the first wrong verdict is a real retry — no
  // explanation, no note_after). Attempt and reveal state live in
  // the session, so Back/Next keeps them (Review Focus 4).
  const resolved =
    (s.revealed[s.index] ?? false) || (s.attempts[s.index] ?? 0) >= 2;
  const explain =
    verdict !== null &&
    (!verdict.ok || verdict.value.correct || resolved);

  return (
    <>
      <div className="read-progress">
        <h1 className="read-set-title">{set.title}</h1>
        <p className="read-count">
          Question {s.index + 1} of {set.items.length}
        </p>
      </div>
      <p className="read-question">{fillItemText(item)}</p>
      <div className="read-trees">
        {shownTrees(item).map((t, i) => {
          const v = views.get(t.name);
          if (v === undefined) {
            return (
              <p key={t.name} className="error">
                Tree “{t.name}” could not be drawn.
              </p>
            );
          }
          return (
            <ReadingTree
              // No item index in the key: a remount here restarts the
              // figure's width feedback loop at a different fixed
              // point. ReadingTree suppresses the transition on a
              // view change instead — same "lands at final spots"
              // outcome without relayout drift (checkpoint §21(j)).
              key={`${t.name}-${t.label}`}
              view={v}
              style={styleFor(item, t.styleIndex)}
              selectable={i === 0 ? pick : "none"}
              selected={i === 0 ? selected : []}
              onSelect={onSelect}
              highlight={item.tips}
              rotatable={item.rotate_tool}
              onRotate={() => {}}
              label={t.label}
            />
          );
        })}
      </div>
      {view0 !== undefined && (
        <QuestionControls
          item={item}
          view={view0}
          response={response}
          onResponse={emit}
        />
      )}
      {verdict !== null && (
        <div
          className="read-feedback"
          role="status"
          aria-label="Verdict"
        >
          {verdict.ok ? (
            <>
              <p
                className={
                  verdict.value.correct
                    ? "read-verdict-good"
                    : "read-verdict-bad"
                }
              >
                {verdict.value.correct
                  ? "Correct."
                  : resolved
                    ? "Not correct."
                    : "Not quite — try again."}
              </p>
              {explain && (
                <p className="read-explain">
                  {verdict.value.explanation}
                </p>
              )}
            </>
          ) : (
            <p className="read-verdict-bad">
              {readErrorMessage(verdict.error)}
            </p>
          )}
          {explain && item.note_after !== undefined && (
            <p className="read-note">
              {fillPlaceholders(item.note_after, item)}
            </p>
          )}
          {verdict.ok && !verdict.value.correct && !resolved && (
            <button
              type="button"
              className="read-nav-btn read-show-answer"
              onClick={() => dispatch({ type: "reveal" })}
            >
              Show answer
            </button>
          )}
        </div>
      )}
      <nav className="read-nav" aria-label="Question navigation">
        <button
          type="button"
          className="read-nav-btn"
          disabled={s.index === 0}
          onClick={() => dispatch({ type: "back" })}
        >
          Back
        </button>
        {practice && (
          <button
            type="button"
            className="read-nav-btn read-check"
            disabled={!checkable}
            onClick={() => dispatch({ type: "check" })}
          >
            Check
          </button>
        )}
        {last ? (
          <button
            type="button"
            className="read-nav-btn"
            onClick={() => dispatch({ type: "finish" })}
          >
            Finish
          </button>
        ) : (
          <button
            type="button"
            className="read-nav-btn"
            onClick={() => dispatch({ type: "next" })}
          >
            Next
          </button>
        )}
      </nav>
    </>
  );
}

/**
 * What a tap contributes to the response: nodes select their clade
 * (or append their letter for order_nodes), tips toggle in the list,
 * lettered points resolve to their letter via the view. `undefined`
 * means the tap maps to nothing the question can use — ignored.
 */
function selectResponse(
  tq: Question,
  clade: string[],
  current: ResponseDraft | null,
  view: ReadingTreeView | undefined,
): Response | null | undefined {
  if (view === undefined) return undefined;
  if (tq.type === "order_nodes") {
    const letter =
      view.nodes.find(
        (n) => n.letter !== null && cladeKey(n.clade) === cladeKey(clade),
      )?.letter ?? undefined;
    if (letter === undefined || !tq.nodes.includes(letter)) {
      return undefined;
    }
    const letters = current?.kind === "order" ? current.letters : [];
    return letters.includes(letter)
      ? undefined
      : { kind: "order", letters: [...letters, letter] };
  }
  switch (tq.type) {
    case "mrca":
    case "smallest_clade":
      if (tq.type === "mrca" && tq.options !== undefined) {
        const p = view.points.find(
          (x) => cladeKey(x.on) === cladeKey(clade),
        );
        return p === undefined
          ? undefined
          : { kind: "point", letter: p.letter };
      }
      return { kind: "node", clade };
    case "place_taxon": {
      const p = view.points.find(
        (x) => x.at === "branch" && cladeKey(x.on) === cladeKey(clade),
      );
      return p === undefined
        ? undefined
        : { kind: "point", letter: p.letter };
    }
    case "closest_relative":
    case "trait": {
      const tip = clade[0];
      if (tip === undefined) return undefined;
      const tips = current?.kind === "tips" ? current.tips : [];
      return {
        kind: "tips",
        tips: tips.includes(tip)
          ? tips.filter((t) => t !== tip)
          : [...tips, tip].sort(),
      };
    }
    default:
      return undefined;
  }
}
