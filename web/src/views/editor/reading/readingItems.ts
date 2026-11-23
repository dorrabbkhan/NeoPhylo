// Item- and question-side draft helpers for the reading-set editor
// (v1.4d plan Task 10, spec §7.5): the question types "Add item"
// offers, the empty shells each starts as, and the tap→field mapping
// the item preview feeds — every picked value is a clade or a letter
// resolved through the engine's ReadingTreeView, never raw geometry.

import type { Item } from "../../../engine/generated/Item";
import type { Question } from "../../../engine/generated/Question";
import type { ReadingTreeView } from "../../../engine/generated/ReadingTreeView";
import type { TraitAsk } from "../../../engine/generated/TraitAsk";
import { cladeKey } from "../../../layout/readingGeom";

/** The question types "Add item" offers, in lesson order. */
export const QUESTION_TYPES: { value: Question["type"]; label: string }[] =
  [
    { value: "which_differs", label: "Which tree differs" },
    { value: "which_fits", label: "Which tree fits" },
    { value: "mrca", label: "Most recent common ancestor" },
    { value: "place_taxon", label: "Place a taxon" },
    { value: "is_clade", label: "Is it a clade" },
    { value: "smallest_clade", label: "Smallest clade" },
    { value: "closest_relative", label: "Closest relative" },
    { value: "count_clades", label: "Count the clades" },
    { value: "order_nodes", label: "Order the nodes" },
    { value: "select_true", label: "Select true statements" },
    { value: "trait", label: "Trait question" },
    { value: "concept", label: "Concept (authored answer)" },
    { value: "two_tier", label: "Two-tier question" },
  ];

/** An empty question of `type` — the fields the form edits. */
export function newQuestion(type: Question["type"]): Question {
  switch (type) {
    case "which_differs":
      return { type };
    case "which_fits":
      return { type, small: [] };
    case "mrca":
      return { type };
    case "place_taxon":
      return { type, name: "", sister: [] };
    case "is_clade":
      return { type };
    case "smallest_clade":
      return { type };
    case "closest_relative":
      return { type, form: "closest" };
    case "count_clades":
      return { type };
    case "order_nodes":
      return { type, nodes: [] };
    case "select_true":
      return { type, statements: [] };
    case "trait":
      return { type, ask: { kind: "which_have", trait_name: "" } };
    case "concept":
      return { type, options: ["", ""], correct: [] };
    case "two_tier":
      return {
        type,
        first: { type: "is_clade" },
        reasons: ["", ""],
        correct_reason: 0,
      };
  }
}

/** A new item shell: a unique-ish id, the first tree selected. */
export function newItem(
  type: Question["type"],
  firstTree: string | null,
  n: number,
): Item {
  return {
    id: `q${n}`,
    text: "",
    trees: firstTree === null ? [] : [firstTree],
    tips: [],
    question: newQuestion(type),
    rotate_tool: true,
  };
}

// --- picking by tapping ------------------------------------------------------

/** A field a tap on the item's preview tree fills. `selectable` is the
 *  ReadingTree pick layer the target taps on. */
export interface PickTarget {
  id: string;
  label: string;
  selectable: "node" | "tips" | "points";
}

const TIPS_TARGET: PickTarget = {
  id: "tips",
  label: "the set {set}",
  selectable: "tips",
};
const SISTER_TARGET: PickTarget = {
  id: "sister",
  label: "the sister set",
  selectable: "node",
};
const TIP = (id: string): PickTarget => ({
  id,
  label: `tip {${id}}`,
  selectable: "tips",
});
const OPTIONS_TARGET: PickTarget = {
  id: "mrca-options",
  label: "lettered options",
  selectable: "points",
};
const ORDER_TARGET: PickTarget = {
  id: "order-nodes",
  label: "lettered nodes",
  selectable: "node",
};

/** The trait names a resolved tree knows — trait defs first, then the
 *  names its marks introduce, in the engine's `trait_names` order. */
export function traitNamesOf(view: ReadingTreeView): string[] {
  const names = view.traits.map((t) => t.name);
  for (const m of view.marks) {
    if (!names.includes(m.trait)) names.push(m.trait);
  }
  return names;
}

function askTargets(ask: TraitAsk): PickTarget[] {
  switch (ask.kind) {
    case "which_shared":
      return [
        { id: "ask-tips", label: "the shared clade", selectable: "node" },
      ];
    case "profile":
    case "ancestral_or_derived":
      return [{ id: "ask-tip", label: "the tip", selectable: "tips" }];
    case "homologous":
      return [
        { id: "ask-x", label: "tip x", selectable: "tips" },
        { id: "ask-y", label: "tip y", selectable: "tips" },
      ];
    default:
      return [];
  }
}

/** The tap targets a question type offers (a two_tier exposes its
 *  inner question's). */
export function pickTargetsFor(q: Question): PickTarget[] {
  switch (q.type) {
    case "mrca":
      return q.options !== undefined
        ? [TIPS_TARGET, OPTIONS_TARGET]
        : [TIPS_TARGET];
    case "is_clade":
    case "smallest_clade":
      return [TIPS_TARGET];
    case "place_taxon":
      return [SISTER_TARGET];
    case "closest_relative":
      return q.form === "pairwise"
        ? [TIP("a"), TIP("b"), TIP("c")]
        : [TIP("a")];
    case "order_nodes":
      return [ORDER_TARGET];
    case "trait":
      return askTargets(q.ask);
    case "two_tier":
      return pickTargetsFor(q.first);
    default:
      return [];
  }
}

/** The lettered point on the tapped clade, if any — mrca options
 *  store point letters. */
function pointLetterAt(view: ReadingTreeView, clade: string[]): string | null {
  const key = cladeKey(clade);
  return view.points.find((x) => cladeKey(x.on) === key)?.letter ?? null;
}

/** The letter the tapped clade's node carries, if any — order_nodes
 *  orders node letters. */
function nodeLetterAt(view: ReadingTreeView, clade: string[]): string | null {
  const key = cladeKey(clade);
  return view.nodes.find((x) => cladeKey(x.clade) === key)?.letter ?? null;
}

function toggle(list: string[], v: string): string[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function applyToQuestion(
  q: Question,
  target: string,
  clade: string[],
  view: ReadingTreeView,
): Question {
  const tip = clade[0];
  switch (q.type) {
    case "mrca":
      if (target === "mrca-options") {
        const letter = pointLetterAt(view, clade);
        if (letter === null) return q;
        const options = toggle(q.options ?? [], letter).sort();
        return options.length === 0
          ? { type: "mrca" }
          : { type: "mrca", options };
      }
      return q;
    case "place_taxon":
      return target === "sister" ? { ...q, sister: clade } : q;
    case "order_nodes":
      if (target === "order-nodes") {
        const letter = nodeLetterAt(view, clade);
        return letter === null ? q : { ...q, nodes: toggle(q.nodes, letter) };
      }
      return q;
    case "trait": {
      const ask = q.ask;
      switch (ask.kind) {
        case "which_shared":
          return target === "ask-tips" ? { ...q, ask: { ...ask, tips: clade } } : q;
        case "profile":
        case "ancestral_or_derived":
          return target === "ask-tip" && tip !== undefined
            ? { ...q, ask: { ...ask, tip } }
            : q;
        case "homologous":
          if (target === "ask-x" && tip !== undefined) {
            return { ...q, ask: { ...ask, x: tip } };
          }
          return target === "ask-y" && tip !== undefined
            ? { ...q, ask: { ...ask, y: tip } }
            : q;
        default:
          return q;
      }
    }
    case "two_tier":
      return { ...q, first: applyToQuestion(q.first, target, clade, view) };
    default:
      return q;
  }
}

/** A tap on the item's preview applied to `target`: tip fields toggle
 *  or set, node letters and point letters resolve through the view.
 *  Returns the item unchanged when the tap maps to nothing the target
 *  uses. */
export function applyPick(
  item: Item,
  target: string,
  clade: string[],
  view: ReadingTreeView,
): Item {
  const tip = clade[0];
  switch (target) {
    case "tips":
      return tip === undefined
        ? item
        : { ...item, tips: toggle(item.tips, tip).sort() };
    case "a":
      return tip === undefined ? item : { ...item, a: tip };
    case "b":
      return tip === undefined ? item : { ...item, b: tip };
    case "c":
      return tip === undefined ? item : { ...item, c: tip };
    default:
      return { ...item, question: applyToQuestion(item.question, target, clade, view) };
  }
}
