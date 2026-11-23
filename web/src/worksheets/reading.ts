// Reading-set worksheet and key builders (v1.4d plan Task 13, spec
// §8.4). The same rule as build.ts: sheets and keys are generated —
// every accepted set, explanation and authored flag comes from
// `readingAnswer` at render time, and every drawing uses the resolved
// `readingTree` view in the item's authored style. TypeScript only
// formats and lays out; it never derives an answer, so the sheet can
// carry no key text and the key can't drift from the engine.
//
// The sheet is a data model — the page renders it. `SheetTree`
// mirrors ItemView's shownTrees/styleFor (reference first, then the
// item's trees, then a which_fits item's small trees); `SheetSpace`
// is the printable form of QuestionControls' per-type control.

import { engine, type Result } from "../engine/index";
import type { Accepted } from "../engine/generated/Accepted";
import type { Item } from "../engine/generated/Item";
import type { Question } from "../engine/generated/Question";
import type { ReadingSet } from "../engine/generated/ReadingSet";
import type { ReadingTree } from "../engine/generated/ReadingTree";
import type { ReadingStyle } from "../layout/readingLayout";
import { fillItemText, fillPlaceholders, joinAnd } from "../reading/state";

/** One tree the sheet draws — label plus the resolved display style. */
export interface SheetTree {
  name: string;
  label: string;
  style: ReadingStyle;
}

/** The printable answer space for one item — the paper form of the
 * app's control: options to circle or tick, a number blank, lettered
 * slots for an order question, a ruled line for a write-in, and the
 * two-tier first answer + reason options. */
export type SheetSpace =
  | { kind: "options"; multi: boolean; options: string[] }
  | { kind: "number" }
  | { kind: "order"; letters: string[] }
  | { kind: "line"; hint: string }
  | { kind: "two_tier"; first: SheetSpace; reasons: string[] };

export interface ReadingSheetItem {
  id: string;
  /** The question text with {a}/{b}/{c}/{set} filled. */
  text: string;
  /** The tips the app highlights while asking — printed emphasised. */
  tips: string[];
  trees: SheetTree[];
  space: SheetSpace;
}

export interface ReadingSheet {
  title: string;
  minutes: number | null;
  /** The `?read=`/`#r=` link printed with its QR. */
  link: string;
  /** A `mode: "test"` set is collected and marked, not self-checked:
   * the sheet prints "Hand this sheet to your instructor." instead
   * of the link + QR (checkpoint §21(f)). */
  test: boolean;
  items: ReadingSheetItem[];
}

export interface ReadingKeyItem {
  id: string;
  text: string;
  /** The accepted answer rendered as text (engine values only). */
  answer: string;
  /** The engine explanation, verbatim. */
  explanation: string;
  /** The engine's authored flag, verbatim. */
  authored: boolean;
  /** "authored answer" when the key is authored, else null. */
  label: string | null;
  /** The authored post-answer note, filled — shown on the key only. */
  noteAfter: string | null;
}

export interface ReadingKey {
  title: string;
  items: ReadingKeyItem[];
}

const DEFAULT_STYLE: ReadingStyle = { shape: "rectangular", tips: "right" };

/** Shown trees in the app's own display order (spec §6): the
 * which_differs reference first, the item's trees, then a which_fits
 * item's small trees. `styleIndex` is the index into item.trees for
 * per_tree overrides, -1 for reference/small trees. */
function sheetTrees(item: Item): SheetTree[] {
  const shown: { name: string; label: string; styleIndex: number }[] = [];
  const q = item.question;
  if (q.type === "which_differs" && q.reference !== undefined) {
    shown.push({ name: q.reference, label: "Reference tree", styleIndex: -1 });
  }
  item.trees.forEach((name, i) => {
    shown.push({
      name,
      label: item.trees.length > 1 ? `Tree ${i + 1}` : "Tree",
      styleIndex: i,
    });
  });
  if (q.type === "which_fits") {
    q.small.forEach((name, i) => {
      shown.push({ name, label: `Small tree ${i + 1}`, styleIndex: -1 });
    });
  }
  return shown.map((t) => ({ ...t, style: styleFor(item, t.styleIndex) }));
}

function styleFor(item: Item, styleIndex: number): ReadingStyle {
  const s = item.style;
  if (s === undefined) return DEFAULT_STYLE;
  if (styleIndex >= 0 && styleIndex < item.trees.length) {
    const per = s.per_tree[styleIndex];
    if (per !== undefined) return { shape: per.shape, tips: per.tips };
  }
  return { shape: s.shape, tips: s.tips };
}

/** The stored tree the question's options come from — the first of
 * the item's trees, the same `t0` the engine's answer uses. */
function firstTree(set: ReadingSet, item: Item): ReadingTree | undefined {
  return set.trees[item.trees[0]];
}

/** Trait names in the engine's ResolvedTree::trait_names order —
 * authored `traits` first, then names only the marks mention (the
 * same order traitNames() derives from the resolved view, and the
 * order the accepted `choices` indices are defined on). */
function treeTraitNames(tree: ReadingTree): string[] {
  const names = tree.traits.map((t) => t.name);
  for (const m of tree.marks) {
    if (!names.includes(m.trait)) names.push(m.trait);
  }
  return names;
}

/** The option texts a radio/checkbox control shows for `q` —
 * QuestionControls' lists verbatim; authored statement texts get
 * their placeholders filled. */
function choiceOptions(
  q: Question,
  item: Item,
  tree: ReadingTree | undefined,
): string[] {
  switch (q.type) {
    case "which_differs":
      return [
        ...item.trees.map((_, i) => `Tree ${i + 1}`),
        q.reference !== undefined
          ? "All agree with the reference tree"
          : "All show the same relationships",
      ];
    case "which_fits":
      return item.trees.map((_, i) => `Tree ${i + 1}`);
    case "mrca":
      return q.options ?? [];
    case "is_clade":
      return q.by_trait === undefined
        ? ["Yes — a clade", "No — not a clade"]
        : ["Monophyletic", "Paraphyletic", "Polyphyletic"];
    case "closest_relative":
      return q.form === "pairwise"
        ? [
            `Closer to ${item.b ?? "B"}`,
            `Closer to ${item.c ?? "C"}`,
            "Equally close",
          ]
        : [];
    case "select_true":
      return q.statements.map((s) => fillPlaceholders(s.text, item));
    case "concept":
      return q.options;
    case "trait":
      switch (q.ask.kind) {
        case "which_shared":
          return tree === undefined ? [] : treeTraitNames(tree);
        case "profile":
          return tree === undefined
            ? []
            : treeTraitNames(tree).map((n) => {
                const d = tree.traits.find((t) => t.name === n);
                return d === undefined ? n : `${n} — ${d.derived}`;
              });
        case "ancestral_or_derived": {
          const ask = q.ask;
          const d = tree?.traits.find(
            (t) => t.name === ask.trait_name,
          );
          return [
            `ancestral${d !== undefined ? ` (${d.ancestral})` : ""}`,
            `derived${d !== undefined ? ` (${d.derived})` : ""}`,
          ];
        }
        case "homologous":
          return [
            "Homologous — one shared origin",
            "Arose independently",
          ];
        default:
          return [];
      }
    case "two_tier":
      return choiceOptions(q.first, item, tree);
    default:
      return [];
  }
}

/** The paper answer space for `q` — the printable shape of the app's
 * control, holding only what a student needs (option texts, slot
 * letters, a writing hint); never an answer. */
function spaceFor(
  q: Question,
  item: Item,
  tree: ReadingTree | undefined,
): SheetSpace {
  switch (q.type) {
    case "which_differs":
    case "which_fits":
    case "is_clade":
    case "select_true":
    case "concept":
      return {
        kind: "options",
        multi: q.type === "select_true" || q.type === "concept",
        options: choiceOptions(q, item, tree),
      };
    case "mrca":
      return q.options !== undefined
        ? { kind: "options", multi: false, options: q.options }
        : { kind: "line", hint: "name the node's tips" };
    case "place_taxon":
      // The lettered branch points are drawn on the tree; the student
      // circles the letter where the new taxon joins.
      return {
        kind: "options",
        multi: false,
        options: (tree?.points ?? [])
          .filter((p) => p.at === "branch")
          .map((p) => p.letter),
      };
    case "smallest_clade":
      return { kind: "line", hint: "name the clade's tips" };
    case "closest_relative":
      return q.form === "pairwise"
        ? {
            kind: "options",
            multi: false,
            options: choiceOptions(q, item, tree),
          }
        : { kind: "line", hint: "the tip(s)" };
    case "count_clades":
      return { kind: "number" };
    case "order_nodes":
      return { kind: "order", letters: q.nodes };
    case "trait":
      switch (q.ask.kind) {
        case "which_have":
        case "has_not":
          return { kind: "line", hint: "the taxa" };
        case "how_many_changes":
          return { kind: "number" };
        default:
          return {
            kind: "options",
            multi: q.ask.kind === "profile",
            options: choiceOptions(q, item, tree),
          };
      }
    case "two_tier":
      return {
        kind: "two_tier",
        first: spaceFor(q.first, item, tree),
        reasons: q.reasons,
      };
  }
}

/** The accepted answer as one line of key text — engine values only:
 * tip sets join "a, b and c" like the explanations do; `choices` and
 * `select_true` answers render the same option texts the sheet
 * printed; orders name their rule rather than a sequence the engine
 * chose not to fix. */
function acceptedText(
  q: Question,
  item: Item,
  acc: Accepted,
  tree: ReadingTree | undefined,
): string {
  switch (acc.kind) {
    case "choices": {
      const opts = choiceOptions(q, item, tree);
      return acc.value
        .map((i) => opts[i] ?? `option ${i + 1}`)
        .join("; ");
    }
    case "clade":
    case "tip_set":
      return joinAnd(acc.value);
    case "any_tip_of":
      return `any of ${joinAnd(acc.value)}`;
    case "point":
      return `point ${acc.value}`;
    case "orders":
      return acc.value.rule === "ancestry"
        ? "any order consistent with ancestry is accepted"
        : "the one order by age, oldest to youngest";
    case "number":
      return String(acc.value);
    case "pairwise":
      return acc.value === "B"
        ? `closer to ${item.b ?? "B"}`
        : acc.value === "C"
          ? `closer to ${item.c ?? "C"}`
          : "equally close";
    case "statements": {
      // The sheet lists the statements as unnumbered tick options, so
      // the key names each true one by the same text it printed —
      // an index would give the marker nothing to match against.
      const opts = choiceOptions(q, item, tree);
      const trues = acc.value
        .map((v, i) => (v ? opts[i] : undefined))
        .filter((t): t is string => t !== undefined);
      return trues.length === 0
        ? "no statement is true"
        : trues.join("; ");
    }
    case "two_tier":
      if (q.type === "two_tier") {
        const inner = acceptedText(q.first, item, acc.value.first, tree);
        const reason = q.reasons[acc.value.reason];
        return reason === undefined
          ? inner
          : `${inner} — reason: ${reason}`;
      }
      return "";
  }
}

// Paper wording (checkpoint §21(f)): the authored question text is
// written for the screen, so a sheet or key re-verbs every
// sentence-initial instruction through PAPER_VERBS — "Tap every tip
// that has…" → "Circle every tip that has…" — and drops app-only
// clauses. A sentence that starts with a screen verb the table
// doesn't cover keeps the authored wording: a shared user set can
// carry instructions the table never saw and must not crash the
// sheet (round 2d, R2). Shipped content is still held to the table —
// the corpus test asserts every built-in and coverage item reports
// no unmappedPaperSentences, so a new instruction verb fails loudly
// there instead of printing app wording on paper.

const PAPER_VERBS: [string, string][] = [
  [
    "Tap the lettered nodes in order",
    "Write the letters of the nodes in order",
  ],
  ["Tap every", "Circle every"],
  ["Tap one of", "Circle one of"],
  ["Tap the", "Circle the"],
  ["Tap", "Circle"],
  ["Select every true statement", "Tick every true statement"],
  ["Select all that apply", "Tick all that apply"],
  ["Select", "Tick"],
  ["Rotate nodes freely", "Rotating a node changes nothing"],
];

/** Instruction verbs that can only mean the screen — a sentence
 * starting with one and matching no table entry is unmapped. */
const SCREEN_VERB =
  /^(Tap|Click|Drag|Press|Select|Swipe|Hover|Rotate|Pick)\b/;

/** Sentence starts: position 0 and right after ". "/"! "/"? " — the
 * split keeps the punctuation so even-index pieces are sentences. */
const SENTENCE_SPLIT = /([.!?]+\s+)/;

/** The PAPER_VERBS mapping a sentence start maps through, if any. */
const paperVerbFor = (piece: string) =>
  PAPER_VERBS.find(([from]) => piece.startsWith(from));

/** The sentence starts of an item's filled text that begin with a
 * screen instruction verb PAPER_VERBS doesn't map — an empty list
 * means every instruction prints re-verbed. Built-in content is
 * held to it by the corpus test; a user-authored set falls back to
 * the authored sentence instead of failing the sheet. */
export function unmappedPaperSentences(item: Item): string[] {
  return fillItemText(item)
    .split(SENTENCE_SPLIT)
    .filter(
      (piece, idx) =>
        idx % 2 === 0 &&
        piece !== "" &&
        paperVerbFor(piece) === undefined &&
        SCREEN_VERB.test(piece),
    );
}

/** An item's question text re-verbed for paper. A sentence starting
 * with an instruction verb PAPER_VERBS doesn't map keeps the
 * authored wording — see unmappedPaperSentences. */
export function paperText(item: Item): string {
  const parts = fillItemText(item).split(SENTENCE_SPLIT);
  const out = parts.map((piece, idx) => {
    if (idx % 2 === 1 || piece === "") return piece;
    const hit = paperVerbFor(piece);
    return hit !== undefined ? hit[1] + piece.slice(hit[0].length) : piece;
  });
  return out.join("").replaceAll(", or arrange the list", "");
}

/** The paper worksheet model: every item's question and answer space,
 * each shown tree in its authored style, and the set's open link for
 * the QR. Carries no answer — the space types hold only what the
 * student needs to write one. */
export function readingSheet(set: ReadingSet, link: string): ReadingSheet {
  return {
    title: set.title,
    minutes: set.meta?.minutes ?? null,
    link,
    test: set.mode === "test",
    items: set.items.map((item) => ({
      id: item.id,
      text: paperText(item),
      tips: item.tips,
      trees: sheetTrees(item),
      space: spaceFor(item.question, item, firstTree(set, item)),
    })),
  };
}

/** The answer-key model: each item's `readingAnswer` — explanation
 * verbatim, authored flag verbatim — plus the accepted answer rendered
 * as text and the authored label where the engine marks one. A set
 * the engine can't answer surfaces its NeoError, not a half-key. */
export function readingKey(set: ReadingSet): Result<ReadingKey> {
  const items: ReadingKeyItem[] = [];
  for (let i = 0; i < set.items.length; i += 1) {
    const item = set.items[i];
    const k = engine.readingAnswer(set, i);
    if (!k.ok) return { ok: false, error: k.error };
    items.push({
      id: item.id,
      text: paperText(item),
      answer: acceptedText(
        item.question,
        item,
        k.value.accepted,
        firstTree(set, item),
      ),
      explanation: k.value.explanation,
      authored: k.value.authored,
      label: k.value.authored ? "authored answer" : null,
      noteAfter:
        item.note_after === undefined
          ? null
          : fillPlaceholders(item.note_after, item),
    });
  }
  return { ok: true, value: { title: set.title, items } };
}
