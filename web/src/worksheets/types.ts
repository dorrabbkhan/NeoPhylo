// Worksheet model types (v1.4c plan Task 11, spec §7.2). A worksheet is
// a pure function of an exercise and its engine trace — every number on
// a key comes from worksheetFacts / the trace at render time; no
// content file holds a key value.

import type { DistanceInput } from "../engine/generated/DistanceInput";
import type { JoinFacts } from "../engine/generated/JoinFacts";
import type { Method } from "../engine/generated/Method";
import type { Tree } from "../engine/generated/Tree";

/** The pencil-and-paper worksheet (exercises with ≤ 8 taxa): the
 * matrix, then one block per hand-worked join, then "finish the tree
 * and sketch it" with the exercise link and QR code. */
export interface PaperSheet {
  title: string;
  /** The exercise's own estimate (meta.minutes or lab.minutes); null
   * when it declares none. */
  minutes: number | null;
  /** The matrix to work — the supplied input, or the engine's computed
   * distances for alignment exercises (spec §7.2). */
  matrix: DistanceInput;
  method: Method;
  /** How many joins the sheet asks the student to work by hand. */
  handSteps: number;
  /** The link that opens the exact exercise. */
  link: string;
}

/** Which prompt a companion-sheet item answers to: a join step, the
 * bootstrap run, or a lab's chain entry. */
export type CompanionStep = number | "bootstrap" | "lab";

export interface CompanionItem {
  step: CompanionStep;
  question: string;
}

/** The in-app worksheet (every lesson and lab): filled in on paper
 * while using the app (spec §7.2). */
export interface CompanionSheet {
  title: string;
  items: CompanionItem[];
}

/** The paper worksheet's answer key: the same sheet with every value
 * filled in from the engine trace, plus the common mistake per join. */
export interface PaperKey {
  sheet: PaperSheet;
  joins: JoinFacts[];
  mistakes: string[];
  tree: Tree;
}

/** The companion worksheet's answer key. `answers` is parallel to
 * `sheet.items`; null marks a writing prompt with no checkable
 * answer. `caption` carries the fixed sampling-noise note for keys
 * that show a seeded bootstrap run. */
export interface CompanionKey {
  sheet: CompanionSheet;
  answers: (string | null)[];
  caption: string | null;
}
