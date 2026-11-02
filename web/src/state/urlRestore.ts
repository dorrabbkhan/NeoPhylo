// URL restore and sync helpers (plan Task 22, spec §6.4), extracted from
// App so the shell stays near the 400-line rule. `resolveInitial` turns
// the current href into the exercise to load; `applyUrlState` replays a
// decoded UrlState's actions onto a freshly loaded session;
// `sessionUrlState` builds the state written back on every change.

import { engine } from "../engine";
import type { Alignment } from "../engine/generated/Alignment";
import type { Exercise } from "../engine/generated/Exercise";
import { defaultLessonJson } from "../lessons/default";
import { loadLesson } from "../lessons/loader";
import { listDatasets, loadDataset } from "../library/registry";

import { decode } from "./url";
import type { UrlState } from "./url";
import type { Session } from "./session";
import { exerciseSim, hasImportedData, reducer } from "./session";

/** How the loaded exercise should be shared: a built-in lesson links
 * by id (`?lesson=`), anything else is embedded in `#x=`. */
export type LinkKind = { kind: "lesson" } | { kind: "custom" };

/** A `ds=` link's resolved dataset: the index row's title (the `.meg`
 * export name) plus the fetched, parsed alignment (v1.4b Task 11). */
export interface ResolvedDataset {
  id: string;
  title: string;
  alignment: Alignment;
}

export interface Resolved {
  exercise: Exercise | null;
  link: LinkKind;
  /** The decoded URL state, or null when decode failed or was skipped. */
  fromUrl: UrlState | null;
  /** True when the caller should show the "couldn't be opened" toast. */
  toast: boolean;
  /** Extra context appended to the toast — a `ds=` failure's reason. */
  toastDetail?: string;
  /** Set when `fromUrl.dataset` resolved to an alignment for
   * `applyUrlState` to import as a library dataset. */
  dataset?: ResolvedDataset;
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

  // `ds=<id>` (v1.4b Task 11): fetch and parse the library file through
  // the same path as an opened file. An unknown id, an index/fetch or
  // a parse failure is a restore error with a message — never a blank
  // sandbox; the toast carries the reason and the default lesson loads.
  let dataset: ResolvedDataset | undefined;
  if (fromUrl?.dataset !== undefined) {
    const id = fromUrl.dataset;
    const [summaries, r] = await Promise.all([
      listDatasets().catch(() => null),
      loadDataset(id),
    ]);
    if (!r.ok || summaries === null) {
      const msg = !r.ok
        ? r.error.kind === "InvalidExercise"
          ? r.error.msg
          : r.error.kind
        : "the dataset index could not be loaded";
      const def = engine.loadExercise(defaultLessonJson);
      return {
        exercise: def.ok ? def.value : null,
        link: { kind: "lesson" },
        fromUrl: null,
        toast: true,
        toastDetail: msg,
      };
    }
    dataset = {
      id,
      title:
        summaries.find((d) => d.id === id)?.title ?? id,
      alignment: r.value,
    };
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
  return { exercise: ex, link, fromUrl, toast, dataset };
}

/**
 * Replay a decoded UrlState onto a just-loaded session: branch scale and
 * sandbox flag first (they affect or flag the pipeline), then the
 * stepper position (reducer clamps to the trace length) and the
 * Concept/Math mode.
 */
export function applyUrlState(
  s: Session,
  fromUrl: UrlState,
  dataset?: ResolvedDataset,
): Session {
  if (fromUrl.overrides?.branchScale !== undefined) {
    s = reducer(s, {
      type: "setBranchScale",
      scale: fromUrl.overrides.branchScale,
    });
  }
  if (fromUrl.src === "sandbox") {
    s = reducer(s, { type: "enterSandbox" });
  }
  // Tree first: importTree always resets the alignment to the
  // exercise's own origin, so importing it after an alignment would
  // wipe the alignment back out.
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
  if (dataset !== undefined) {
    s = reducer(s, {
      type: "importDataset",
      id: dataset.id,
      title: dataset.title,
      alignment: dataset.alignment,
    });
    // The dataset's alphabet is only known once it lands: the
    // resolve-time merge could reconcile an `o=` override to the
    // default lesson's alphabet (e.g. Poisson → Jc69 on the DNA
    // lesson). Re-apply analysis overrides so `ds=` + `o=` restores
    // both (Task 11). Sim overrides stay exercise-level — a dataset
    // never re-simulates.
    if (fromUrl.overrides?.analysis !== undefined) {
      s = reducer(s, {
        type: "setAnalysis",
        patch: fromUrl.overrides.analysis,
      });
    }
  }
  s = reducer(s, { type: "step", to: fromUrl.step });
  s = reducer(s, { type: "setMode", mode: fromUrl.mode });
  // Bootstrap settings last (v1.2 spec §6.1): a `ran: true` link
  // queues a run request the App's bootstrap effect picks up; the
  // estimate decides auto-start vs the prefilled Run button.
  if (fromUrl.bootstrap !== undefined) {
    const bs = fromUrl.bootstrap;
    s = reducer(s, {
      type: "setBootstrapSettings",
      patch: { replicates: bs.replicates, seed: bs.seed },
    });
    s = reducer(s, { type: "setBootstrapView", view: bs.view });
    if (bs.ran) {
      s = reducer(s, { type: "bootstrapRequested", autorun: true });
    }
  }
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
  const b = s.bootstrap;
  // A library dataset the sandbox shows unmodified links as `ds=<id>`
  // (v1.4b Task 11) — unless an imported reference tree also needs the
  // `d=` payload, which `ds` can't ride beside (decode refuses ds+d).
  const useDs =
    s.libraryDataset !== null &&
    s.alignmentOrigin === "imported" &&
    s.alignment !== null &&
    s.reference?.origin !== "imported";
  const imported: UrlState["imported"] = {
    ...(s.alignmentOrigin === "imported" && s.alignment !== null && !useDs
      ? { alignment: s.alignment }
      : {}),
    ...(s.reference?.origin === "imported"
      ? { trueTree: engine.writeNewick(s.reference.tree) }
      : {}),
  };
  return {
    v: 3,
    step: s.step,
    mode: s.mode,
    // Links carry bootstrap *settings* only (v1.2 spec §6.1); `ran`
    // means a run is in flight or finished, so reopening can re-run
    // it subject to the estimate. Results are never stored.
    bootstrap: {
      replicates: b.replicates,
      seed: b.seed,
      view: b.view,
      ran:
        b.status === "estimating" ||
        b.status === "confirming" ||
        b.status === "running" ||
        b.status === "done",
    },
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
    ...(hasImportedData(s) && Object.keys(imported).length > 0
      ? { imported }
      : {}),
    ...(useDs && s.libraryDataset !== null
      ? { dataset: s.libraryDataset }
      : {}),
  };
}
