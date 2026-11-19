// Reading-area session state (v1.4d plan Task 8, spec §4.4/§7.2).
// The reducer holds each item's in-progress Response so Back/Next
// loses nothing (Review Focus 4); verdicts are never stored — the
// page asks the engine's `readingCheck` for the item the student
// checked, so correctness and explanations live in Rust only
// (spec §5.3). Test mode never marks an item checked before Finish.

import type { Item } from "../engine/generated/Item";
import type { Question } from "../engine/generated/Question";
import type { ReadingSet } from "../engine/generated/ReadingSet";
import type { ReadingTreeView } from "../engine/generated/ReadingTreeView";
import type { Response } from "../engine/generated/Response";

export interface ReadingSession {
  set: ReadingSet;
  index: number;
  responses: (Response | null)[];
  checked: boolean[];
  finished: boolean;
}

export type ReadingAction =
  | { type: "answer"; response: Response | null }
  | { type: "check" }
  | { type: "next" }
  | { type: "back" }
  | { type: "finish" }
  | { type: "restart" };

/** Which of ReadingTree's pick layers the question answers on. */
export type PickMode = "none" | "node" | "tips" | "points";

export function initSession(set: ReadingSet): ReadingSession {
  return {
    set,
    index: 0,
    responses: Array.from({ length: set.items.length }, () => null),
    checked: Array.from({ length: set.items.length }, () => false),
    finished: false,
  };
}

export function readingReducer(
  s: ReadingSession,
  a: ReadingAction,
): ReadingSession {
  switch (a.type) {
    case "answer": {
      const responses = s.responses.slice();
      const checked = s.checked.slice();
      responses[s.index] = a.response;
      // Editing after a check is the retry path: the stale verdict
      // must not hang around beside the new response.
      checked[s.index] = false;
      return { ...s, responses, checked };
    }
    case "check": {
      // Practice only. The reducer stores the flag; the page calls
      // the engine's check wrapper for the verdict itself, so test
      // mode can never leak one by reusing this path.
      if (s.set.mode !== "practice") return s;
      const item = s.set.items[s.index];
      if (item === undefined || !submittable(item, s.responses[s.index])) {
        return s;
      }
      const checked = s.checked.slice();
      checked[s.index] = true;
      return { ...s, checked };
    }
    case "next":
      return { ...s, index: Math.min(s.index + 1, s.set.items.length - 1) };
    case "back":
      return { ...s, index: Math.max(s.index - 1, 0) };
    case "finish":
      return { ...s, finished: true };
    case "restart":
      return initSession(s.set);
  }
}

/**
 * True when the response answers the question — the Check button's
 * enabled test and TestSummary's "unanswered" test. `null` counts as
 * complete only where "nothing selected" is itself a valid answer
 * (every statement false, no trait in the profile, no correct option).
 */
export function isComplete(
  q: Question,
  r: Response | null,
): boolean {
  if (r === null) {
    return (
      q.type === "select_true" ||
      q.type === "concept" ||
      (q.type === "trait" && q.ask.kind === "profile")
    );
  }
  switch (r.kind) {
    case "choice":
      return r.index >= 0;
    case "choices":
      return true;
    case "node":
      return r.clade.length > 0;
    case "point":
      return r.letter !== "";
    case "tips":
      return r.tips.length > 0;
    case "order":
      return q.type === "order_nodes" && r.letters.length === q.nodes.length;
    case "number":
      return r.value >= 0;
    case "pairwise":
      return true;
    case "two_tier":
      return (
        q.type === "two_tier" &&
        r.reason >= 0 &&
        isComplete(q.first, r.first)
      );
  }
}

/** Check's enabled test for the current item. */
export function submittable(item: Item, r: Response | null): boolean {
  return isComplete(item.question, r);
}

/**
 * The response `check` should see for a submittable-but-null slot —
 * the empty form of the answer the question accepts (an empty
 * `Choices` list). Single-answer questions are never submittable
 * while null, so their branches here are unreachable in practice.
 */
export function effectiveResponse(item: Item, r: Response | null): Response {
  return r ?? emptyResponse(item.question);
}

/** The untouched form of a question's answer — the placeholder a
 *  two-tier response keeps in `first` until the student answers it
 *  (negative sentinels mark "not chosen" and never reach the engine:
 *  Check is gated on `isComplete`). */
export function emptyResponse(q: Question): Response {
  switch (q.type) {
    case "mrca":
      return q.options !== undefined
        ? { kind: "point", letter: "" }
        : { kind: "node", clade: [] };
    case "place_taxon":
      return { kind: "point", letter: "" };
    case "smallest_clade":
      return { kind: "node", clade: [] };
    case "order_nodes":
      return { kind: "order", letters: [] };
    case "count_clades":
      return { kind: "number", value: -1 };
    case "select_true":
    case "concept":
      return { kind: "choices", indices: [] };
    case "closest_relative":
      return q.form === "pairwise"
        ? { kind: "pairwise", answer: "B" }
        : { kind: "tips", tips: [] };
    case "two_tier":
      return {
        kind: "two_tier",
        first: emptyResponse(q.first),
        reason: -1,
      };
    default:
      // which_differs, which_fits, is_clade and the choice asks of
      // trait all answer with a single picked index.
      return { kind: "choice", index: -1 };
  }
}

/** The tree pick layer the question answers on ("none" for
 *  radio/checkbox/stepper controls). `order_nodes` taps lettered
 *  nodes to append them to the sequence. */
export function selectableFor(q: Question): PickMode {
  switch (q.type) {
    case "mrca":
      return q.options !== undefined ? "points" : "node";
    case "place_taxon":
      return "points";
    case "smallest_clade":
    case "order_nodes":
      return "node";
    case "closest_relative":
      return q.form === "pairwise" ? "none" : "tips";
    case "trait":
      return q.ask.kind === "which_have" || q.ask.kind === "has_not"
        ? "tips"
        : "none";
    case "two_tier":
      return selectableFor(q.first);
    default:
      return "none";
  }
}

/** The option text a select_true/choices control shows is authored;
 *  trait options need the tree's trait names — authored `traits`
 *  first, then names only the marks mention (mirrors the engine's
 *  ResolvedTree::trait_names order, on which the answer indices are
 *  defined). */
export function traitNames(view: ReadingTreeView): string[] {
  const names = view.traits.map((t) => t.name);
  for (const m of view.marks) {
    if (!names.includes(m.trait)) names.push(m.trait);
  }
  return names;
}

/** Item text display: {a} {b} {c} take the item's bindings and {set}
 *  the tip list, joined English-style ("a, b and c"). The engine
 *  binds the same placeholders the same way in its explanations. */
export function fillItemText(item: Item): string {
  let text = item.text;
  if (item.a !== undefined) text = text.replaceAll("{a}", item.a);
  if (item.b !== undefined) text = text.replaceAll("{b}", item.b);
  if (item.c !== undefined) text = text.replaceAll("{c}", item.c);
  return text.replaceAll("{set}", joinAnd(item.tips));
}

/** "a and b" / "a, b and c" — the same convention as the engine's
 *  explanations. */
export function joinAnd(tips: string[]): string {
  if (tips.length <= 1) return tips.join("");
  return `${tips.slice(0, -1).join(", ")} and ${tips[tips.length - 1]}`;
}
