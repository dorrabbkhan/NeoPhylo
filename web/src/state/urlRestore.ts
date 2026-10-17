// URL restore and sync helpers (plan Task 22, spec §6.4), extracted from
// App so the shell stays near the 400-line rule. `resolveInitial` turns
// the current href into the exercise to load; `applyUrlState` replays a
// decoded UrlState's actions onto a freshly loaded session;
// `sessionUrlState` builds the state written back on every change.

import { engine } from "../engine";
import type { Exercise } from "../engine/generated/Exercise";
import { defaultLessonJson } from "../lessons/default";
import { loadLesson } from "../lessons/loader";

import { decode } from "./url";
import type { UrlState } from "./url";
import type { Session } from "./session";
import { exerciseSim, hasImportedData, reducer } from "./session";

/** How the loaded exercise should be shared: a built-in lesson links
 * by id (`?lesson=`), anything else is embedded in `#x=`. */
export type LinkKind = { kind: "lesson" } | { kind: "custom" };

export interface Resolved {
  exercise: Exercise | null;
  link: LinkKind;
  /** The decoded URL state, or null when decode failed or was skipped. */
  fromUrl: UrlState | null;
  /** True when the caller should show the "couldn't be opened" toast. */
  toast: boolean;
}

/**
 * Decide which exercise the app should load. An explicit `exercise` prop
 * wins and skips URL decoding entirely (tests drive the app directly);
 * it also means the state syncs as `#x=`, since a prop exercise is not
 * a built-in. Otherwise the URL supplies a custom exercise (`#x=`), a
 * lesson id (`?lesson=` fetched via loadLesson), or nothing — in which
 * case the embedded default lesson is used. Unopenable links set
 * `toast` and still fall back to the default (spec §6.4).
 */
export async function resolveInitial(
  exercise: Exercise | null,
): Promise<Resolved> {
  if (exercise !== null) {
    return { exercise, link: { kind: "custom" }, fromUrl: null, toast: false };
  }

  const d = decode(window.location.href);
  let toast = false;
  const fromUrl = d.ok ? d.state : null;
  if (!d.ok) toast = true;

  let ex: Exercise | null = null;
  let link: LinkKind = { kind: "lesson" };
  if (fromUrl !== null) {
    if (fromUrl.x !== undefined) {
      ex = fromUrl.x;
      link = { kind: "custom" };
    } else if (fromUrl.lesson !== undefined) {
      const r = await loadLesson(fromUrl.lesson);
      if (r.ok) {
        ex = r.value;
      } else {
        toast = true;
      }
    }
  }
  if (ex === null) {
    const r = engine.loadExercise(defaultLessonJson);
    ex = r.ok ? r.value : null;
    link = { kind: "lesson" };
  }

  // Merge overrides before load so the first recompute already uses them.
  if (ex !== null && fromUrl?.overrides !== undefined) {
    const o = fromUrl.overrides;
    ex = {
      ...ex,
      analysis: { ...ex.analysis, ...o.analysis },
    };
    if (o.sim !== undefined && ex.data.kind === "simulated") {
      ex = {
        ...ex,
        data: { ...ex.data, sim: { ...ex.data.sim, ...o.sim } },
      };
    }
  }
  return { exercise: ex, link, fromUrl, toast };
}

/**
 * Replay a decoded UrlState onto a just-loaded session: branch scale and
 * sandbox flag first (they affect or flag the pipeline), then the
 * stepper position (reducer clamps to the trace length) and the
 * Concept/Math mode.
 */
export function applyUrlState(s: Session, fromUrl: UrlState): Session {
  if (fromUrl.overrides?.branchScale !== undefined) {
    s = reducer(s, {
      type: "setBranchScale",
      scale: fromUrl.overrides.branchScale,
    });
  }
  if (fromUrl.src === "sandbox") {
    s = reducer(s, { type: "enterSandbox" });
  }
  // Tree first: importTree always resets the alignment to "simulated",
  // so importing it after an alignment would wipe the alignment back out.
  if (fromUrl.imported?.trueTree !== undefined) {
    const r = engine.parseNewick(fromUrl.imported.trueTree);
    if (r.ok) s = reducer(s, { type: "importTree", tree: r.value });
  }
  if (fromUrl.imported?.alignment !== undefined) {
    s = reducer(s, {
      type: "importAlignment",
      alignment: fromUrl.imported.alignment,
    });
  }
  s = reducer(s, { type: "step", to: fromUrl.step });
  s = reducer(s, { type: "setMode", mode: fromUrl.mode });
  return s;
}

/**
 * Build the UrlState the live session should sync to. The current sim
 * and analysis are always written as overrides — merging them back onto
 * the same exercise is idempotent, and the link stays correct even if a
 * lesson file changes between shares. `branchScale` is omitted at its
 * default of 1.
 */
export function sessionUrlState(s: Session, link: LinkKind): UrlState {
  return {
    v: 2,
    step: s.step,
    mode: s.mode,
    ...(s.source === "sandbox" ? { src: "sandbox" as const } : {}),
    overrides: {
      ...(exerciseSim(s.exercise) !== null
        ? { sim: exerciseSim(s.exercise)! }
        : {}),
      analysis: s.exercise.analysis,
      ...(s.branchScale !== 1 ? { branchScale: s.branchScale } : {}),
    },
    ...(link.kind === "lesson"
      ? { lesson: s.exercise.id }
      : { x: s.exercise }),
    // Pasted/uploaded sandbox data has no seed to replay it from, so it
    // rides along verbatim — otherwise a shared sandbox link silently
    // reopens the lesson's own simulated data instead (spec §6.4).
    ...(hasImportedData(s)
      ? {
          imported: {
            ...(s.alignmentOrigin === "imported" && s.alignment !== null
              ? { alignment: s.alignment }
              : {}),
            ...(s.reference?.origin === "imported"
              ? { trueTree: engine.writeNewick(s.reference.tree) }
              : {}),
          },
        }
      : {}),
  };
}
