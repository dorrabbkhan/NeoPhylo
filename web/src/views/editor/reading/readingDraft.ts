// Draft state for the reading-set editor (v1.4d plan Task 10, spec
// §7.5). The editor keeps trees and items as editable drafts; on every
// change `buildWireSet` shapes the file JSON that `loadReadingSet` —
// the only validator — accepts or refuses. Nothing here recomputes an
// answer or validates a set: helpers only shape JSON, resolve taps to
// clade keys through the engine, and invert a loaded set back to a
// draft for Import.
//
// A stored tree previews through a one-item probe set: `readingTree`
// needs a loaded ReadingSet, so `probeSetJson` wraps the tree in the
// smallest set that always has an answer (`count_clades`). The probe
// surfaces exactly the InvalidReading a bad extra would cause in the
// real set.

import { engine, type Result } from "../../../engine/index";
import type { ExerciseMeta } from "../../../engine/generated/ExerciseMeta";
import type { Item } from "../../../engine/generated/Item";
import type { NodeAge } from "../../../engine/generated/NodeAge";
import type { NodeId } from "../../../engine/generated/NodeId";
import type { NodeLetter } from "../../../engine/generated/NodeLetter";
import type { Point } from "../../../engine/generated/Point";
import type { Premise } from "../../../engine/generated/Premise";
import type { ReadingMode } from "../../../engine/generated/ReadingMode";
import type { ReadingSet } from "../../../engine/generated/ReadingSet";
import type { ReadingTreeView } from "../../../engine/generated/ReadingTreeView";
import type { TraitDef } from "../../../engine/generated/TraitDef";
import type { Tree } from "../../../engine/generated/Tree";
import type { NeoError } from "../../../engine/generated/NeoError";

import { leafNames } from "../drawOps";

/** A stored tree's time axis in draft form; "none" emits no `times`
 *  key. Ages carry unit/source only — per-node ages are added by the
 *  age tool (`applyExtra`). */
export type TimesDraft =
  | "none"
  | "schematic"
  | { unit: string; source: string; ages: NodeAge[] };

export interface TreeDraft {
  name: string;
  newick: string;
  node_letters: NodeLetter[];
  times: TimesDraft;
  marks: { on: string[]; trait: string; change: "gain" | "loss" }[];
  traits: TraitDef[];
  points: Point[];
}

export interface ReadingDraft {
  id: string;
  title: string;
  summary: string;
  mode: ReadingMode;
  /** Carried verbatim from an import (never edited here). */
  meta?: ExerciseMeta;
  /** v1.5 Task 4: variant premises — carried verbatim like `meta`. */
  premises?: Premise[];
  taxa_pool: Record<string, string[]>;
  trees: TreeDraft[];
  items: Item[];
}

export function emptyDraft(): ReadingDraft {
  return {
    id: "",
    title: "",
    summary: "",
    mode: "practice",
    taxa_pool: {},
    trees: [emptyTreeDraft("t1")],
    items: [],
  };
}

export function emptyTreeDraft(name: string): TreeDraft {
  return {
    name,
    newick: "",
    node_letters: [],
    times: "none",
    marks: [],
    traits: [],
    points: [],
  };
}

/** The file JSON `loadReadingSet` parses — also the saved file body. */
export function buildWireSet(d: ReadingDraft): Record<string, unknown> {
  const trees: Record<string, unknown> = {};
  for (const t of d.trees) {
    const body: Record<string, unknown> = {
      newick: t.newick,
      node_letters: t.node_letters,
      marks: t.marks,
      traits: t.traits,
      points: t.points,
    };
    if (t.times === "schematic") {
      body.times = "schematic";
    } else if (typeof t.times === "object") {
      body.times = {
        unit: t.times.unit,
        ...(t.times.source !== "" ? { source: t.times.source } : {}),
        ages: t.times.ages,
      };
    }
    trees[t.name] = body;
  }
  return {
    schema_version: 1,
    kind: "reading",
    id: d.id,
    title: d.title,
    summary: d.summary,
    ...(d.meta !== undefined ? { meta: d.meta } : {}),
    ...(d.premises !== undefined && d.premises.length > 0
      ? { premises: d.premises }
      : {}),
    mode: d.mode,
    taxa_pool: d.taxa_pool,
    trees,
    items: d.items,
  };
}

/** Loaded set → draft, for Import. Meta and the taxa pool ride along
 *  verbatim — the form can't edit them but must not drop them. */
export function draftFromSet(set: ReadingSet): ReadingDraft {
  const trees = Object.entries(set.trees).map(([name, t]): TreeDraft => {
    const times: TimesDraft =
      t.times === undefined
        ? "none"
        : t.times === "schematic"
          ? "schematic"
          : {
              unit: t.times.unit,
              source: t.times.source ?? "",
              ages: t.times.ages,
            };
    return {
      name,
      newick: t.newick,
      node_letters: t.node_letters,
      times,
      marks: t.marks,
      traits: t.traits,
      points: t.points,
    };
  });
  return {
    id: set.id,
    title: set.title,
    summary: set.summary,
    mode: set.mode,
    ...(set.meta !== undefined ? { meta: set.meta } : {}),
    ...(set.premises !== undefined && set.premises.length > 0
      ? { premises: set.premises }
      : {}),
    taxa_pool: set.taxa_pool,
    trees: trees.length > 0 ? trees : [emptyTreeDraft("t1")],
    items: set.items,
  };
}

/**
 * The stored `neophylo:draft:reading` payload back into a draft
 * (v1.5 Task 7, spec §9.1): a shape check plus normalization — a
 * tree missing an extras array gets the empty list, an empty tree
 * list gets the starter slot. `null` for anything that isn't a
 * draft at all; the engine's `loadReadingSet` still owns validity.
 */
export function storedDraft(d: unknown): ReadingDraft | null {
  if (typeof d !== "object" || d === null) return null;
  const o = d as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.title !== "string" ||
    typeof o.summary !== "string" ||
    typeof o.mode !== "string" ||
    typeof o.taxa_pool !== "object" ||
    o.taxa_pool === null ||
    !Array.isArray(o.trees) ||
    !Array.isArray(o.items)
  ) {
    return null;
  }
  const trees: TreeDraft[] = [];
  for (const t of o.trees) {
    if (typeof t !== "object" || t === null) return null;
    const tr = t as Record<string, unknown>;
    if (typeof tr.name !== "string" || typeof tr.newick !== "string") {
      return null;
    }
    trees.push({
      ...emptyTreeDraft(tr.name),
      ...tr,
      name: tr.name,
      newick: tr.newick,
    } as TreeDraft);
  }
  return {
    id: o.id,
    title: o.title,
    summary: o.summary,
    mode: o.mode as ReadingMode,
    ...(o.meta !== undefined ? { meta: o.meta as ExerciseMeta } : {}),
    ...(Array.isArray(o.premises)
      ? { premises: o.premises as Premise[] }
      : {}),
    taxa_pool: o.taxa_pool as Record<string, string[]>,
    trees: trees.length > 0 ? trees : [emptyTreeDraft("t1")],
    items: o.items as Item[],
  };
}

/** The probe set's single tree key (and its one item's id). */
const PROBE_TREE = "the_tree";

/**
 * The smallest set that resolves `t` for `readingTree`: one
 * `count_clades` item (answered for every valid tree). The engine
 * parses the tree and validates every extra — letters on missing
 * clades, marks on missing branches, non-decreasing ages — so the
 * refusal this surfaces is the same one the real set would give.
 */
export function probeSetJson(t: TreeDraft): string {
  return JSON.stringify(
    buildWireSet({
      id: "probe",
      title: "probe",
      summary: "probe",
      mode: "practice",
      taxa_pool: {},
      trees: [t],
      items: [
        {
          id: "probe-item",
          text: "How many clades does the tree have?",
          trees: [PROBE_TREE],
          tips: [],
          question: { type: "count_clades" },
          rotate_tool: false,
        },
      ],
    }),
  );
}

/** The stored tree resolved for layout, or the engine's refusal —
 *  either is shown beside the extras form. Probe errors name the
 *  internal `the_tree` key — map it back to the stored name. */
export function resolveTreeView(t: TreeDraft): Result<ReadingTreeView> {
  const r = engine.loadReadingSet(probeSetJson({ ...t, name: PROBE_TREE }));
  if (!r.ok) {
    if (r.error.kind === "InvalidReading") {
      return {
        ok: false,
        error: {
          ...r.error,
          field: r.error.field.replaceAll(PROBE_TREE, t.name),
        },
      };
    }
    return r;
  }
  return engine.readingTree(r.value, PROBE_TREE);
}

/**
 * The clade a canvas tap names: the node's tip labels resolved to the
 * canonical `CladeKey` by the engine (sorted, deduplicated, checked to
 * be a real node). Used when a tree's extras are annotated from the
 * draw canvas instead of the preview.
 */
export function canvasClade(tree: Tree, node: NodeId): Result<string[]> {
  const tips: string[] = [];
  leafNames(tree, node, tips);
  if (tips.length === 0) {
    const error: NeoError = {
      kind: "InvalidReading",
      item: "",
      field: "canvas",
      msg: "that node has no labelled tips",
    };
    return { ok: false, error };
  }
  return engine.readingCladeOf(engine.writeNewick(tree), tips);
}

// Question/item shells and the tap→field pick mapping live in
// readingItems.ts; the annotate tools in readingExtras.ts.
