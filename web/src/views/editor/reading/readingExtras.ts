// The annotate tools for a stored tree's extras (v1.4d plan Task 10,
// spec §7.5): node letters, node ages, trait marks and lettered
// points — each applied from a tapped clade plus the tool's own
// fields. Nothing here validates; the probe set's `loadReadingSet`
// call in readingDraft catches a bad extra the moment it lands.

import { cladeKey } from "../../../layout/readingGeom";

import type { TreeDraft } from "./readingDraft";

/** The annotate tools a stored tree's extras form offers; the tool
 *  picks what a tap creates and which pick layer it listens on. */
export type ExtraTool = "letter" | "age" | "mark" | "point-node" | "point-branch";

export const EXTRA_TOOLS: { value: ExtraTool; label: string }[] = [
  { value: "letter", label: "Node letter" },
  { value: "age", label: "Node age" },
  { value: "mark", label: "Trait mark" },
  { value: "point-node", label: "Point on a node" },
  { value: "point-branch", label: "Point on a branch" },
];

export interface ExtraParams {
  letter?: string;
  age?: number;
  trait?: string;
  change?: "gain" | "loss";
}

/**
 * Apply one annotate-tool tap: letters replace an existing letter on
 * the same clade (one letter per node); ages upsert into the ages
 * list; marks and points append. A lettered `on` that repeats is the
 * author editing, not a second extra.
 */
export function applyExtra(
  t: TreeDraft,
  tool: ExtraTool,
  clade: string[],
  params: ExtraParams,
): TreeDraft {
  switch (tool) {
    case "letter": {
      const rest = t.node_letters.filter(
        (l) => cladeKey(l.on) !== cladeKey(clade),
      );
      return {
        ...t,
        node_letters: [...rest, { on: clade, letter: params.letter ?? "" }],
      };
    }
    case "age": {
      if (typeof t.times !== "object") return t;
      const rest = t.times.ages.filter(
        (a) => cladeKey(a.on) !== cladeKey(clade),
      );
      return {
        ...t,
        times: {
          ...t.times,
          ages: [...rest, { on: clade, age: params.age ?? 0 }],
        },
      };
    }
    case "mark":
      return {
        ...t,
        marks: [
          ...t.marks,
          {
            on: clade,
            trait: params.trait ?? "",
            change: params.change ?? "gain",
          },
        ],
      };
    case "point-node":
    case "point-branch":
      return {
        ...t,
        points: [
          ...t.points,
          {
            letter: params.letter ?? "",
            on: clade,
            at: tool === "point-node" ? "node" : "branch",
          },
        ],
      };
  }
}
