// Editor autosave (v1.5 plan Task 7, spec §9.1): every editor keeps
// its unsaved draft under `neophylo:draft:<kind>` in localStorage —
// `exercise` and `matrix` for the two data routes of the exercise
// editor (only one is ever live; switching routes moves the draft),
// `reading` for the reading-set editor and `assignment` for the
// builder. The whole draft rides there — tree included — so a reload
// or a lost tab restores exactly what was on screen. A draft is
// restored, not merged: the storage copy IS the draft.
//
// Every access is wrapped: a blocked or full storage (private-mode
// Safari, a quota) can never crash an editor. The first failure sets
// `blocked` — the "drafts won't be saved" flag the notices read — and
// the next successful access clears it.

import { buildExerciseState } from "../../editor/draft";
import {
  importExercise,
  saveExercise,
} from "../../editor/exerciseFile";
import type { ExerciseState } from "../../editor/exerciseFile";
import { engine } from "../../engine/index";
import type { Prompt } from "../../engine/generated/Prompt";
import type { Tree } from "../../engine/generated/Tree";

export type DraftKind = "exercise" | "matrix" | "reading" | "assignment";

/** A stored draft — each editor validates the shape it expects. */
export type Draft = unknown;

const KEY_PREFIX = "neophylo:draft:";

let storageBlocked = false;
const listeners = new Set<() => void>();

function setBlocked(v: boolean): void {
  if (storageBlocked === v) return;
  storageBlocked = v;
  for (const fn of listeners) fn();
}

export const autosave = {
  load(kind: DraftKind): Draft | null {
    let raw: string | null;
    try {
      raw = window.localStorage.getItem(KEY_PREFIX + kind);
      setBlocked(false);
    } catch {
      setBlocked(true);
      return null;
    }
    if (raw === null) return null;
    try {
      return JSON.parse(raw) as Draft;
    } catch {
      // Corrupt bytes are not a storage failure — just no draft.
      return null;
    }
  },
  save(kind: DraftKind, draft: Draft): void {
    try {
      window.localStorage.setItem(KEY_PREFIX + kind, JSON.stringify(draft));
      setBlocked(false);
    } catch {
      setBlocked(true);
    }
  },
  clear(kind: DraftKind): void {
    try {
      window.localStorage.removeItem(KEY_PREFIX + kind);
      setBlocked(false);
    } catch {
      setBlocked(true);
    }
  },
  /** The `blocked` flag is external mutable state — the editors read
   *  it through `useSyncExternalStore` with this subscribe (the same
   *  pattern the tree model uses), never through effect-set-state. */
  subscribe(fn: () => void): () => void {
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  },
  /** True while the last storage access failed — the "drafts won't
   *  be saved" flag (spec §9.1's notice). */
  get blocked(): boolean {
    return storageBlocked;
  },
};

/** The exercise editor's stored payload — `{n, s, p, x, r}` is the
 *  same record `draftSnapshot` serializes for the dirty check:
 *  Newick, settings, prompts, file extras and preserved fields. */
export interface ExerciseDraft {
  v: 1;
  n: string;
  s: unknown;
  p: Prompt[];
  x: Record<string, unknown> | null;
  r: unknown;
}

function isExerciseDraft(d: unknown): d is ExerciseDraft {
  if (typeof d !== "object" || d === null) return false;
  const o = d as Record<string, unknown>;
  return (
    typeof o.n === "string" &&
    typeof o.s === "object" &&
    o.s !== null &&
    Array.isArray(o.p) &&
    (o.x === null || typeof o.x === "object") &&
    typeof o.r === "object" &&
    o.r !== null
  );
}

/**
 * Rebuild a stored exercise draft into the `ExerciseState` the
 * panel's load path consumes — by running it through the same
 * save→load round-trip a file import takes, so a draft that wouldn't
 * survive a save is refused here instead of breaking the form. Also
 * returns the draft's own tree (a matrix-mode file doesn't carry the
 * drawn tree — it stays the matrix's derive source). `null` for
 * anything that isn't a loadable draft.
 */
export function exerciseDraftState(d: unknown): {
  state: ExerciseState;
  tree: Tree;
  /** The file the round-trip produced — the assignment builder
   *  embeds it as `content.exercise` (spec §5.1). */
  file: unknown;
} | null {
  if (!isExerciseDraft(d)) return null;
  const parsed = engine.parseNewick(d.n);
  if (!parsed.ok) return null;
  try {
    const state = buildExerciseState(
      parsed.value,
      d.s as Parameters<typeof buildExerciseState>[1],
      d.p,
      d.x ?? undefined,
      d.r as Parameters<typeof buildExerciseState>[4],
    );
    const saved = saveExercise(state);
    if ("error" in saved) return null;
    const loaded = importExercise(saved.json);
    return loaded.ok
      ? { state: loaded.value, tree: parsed.value, file: JSON.parse(saved.json) }
      : null;
  } catch {
    // A corrupt draft can throw inside the conversion — refuse it whole.
    return null;
  }
}
