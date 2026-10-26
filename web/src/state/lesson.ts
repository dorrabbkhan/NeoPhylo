// Lesson slice of Session: the exercise being worked through, its
// pristine reload copy and the lesson/sandbox source (v1.3 spec
// §7.1). This module also owns the Session-level "data transition"
// helpers — every action that rewrites the exercise or the imported
// data and re-runs the pipeline (setSim/setAnalysis/setAlphabet/
// importAlignment/importTree) — and `reconcileModels`, which keeps
// the exercise's models consistent with the alphabet.

import { engine } from "../engine/index";

import type { Alignment } from "../engine/generated/Alignment";
import type { Alphabet } from "../engine/generated/Alphabet";
import type { Exercise } from "../engine/generated/Exercise";
import type { SimModel } from "../engine/generated/SimModel";
import type { SimSpec } from "../engine/generated/SimSpec";
import type { Tree } from "../engine/generated/Tree";

import {
  CORRECTIONS,
  DIST_LABEL,
  SIM_LABEL,
  SIM_MODEL_NAMES,
  analysisReducer,
  analysisSlice,
  recompute,
  simModelName,
  traceLength,
  type DistModelName,
} from "./analysis";
import { bootstrapReducer, clearBootstrap } from "./bootstrap";
import type { Action } from "./actions";
import type { Session } from "./session";

/** The Session slice owned by `lessonReducer`. */
export interface LessonState {
  exercise: Exercise;
  /** The exercise exactly as `load` received it (checkpoint 13).
   * `exercise` is the working copy: setSim, setAnalysis and
   * reconcileModels mutate it, so reloading `s.exercise` would carry
   * sandbox changes back into lesson mode. `exitSandbox` reloads this
   * pristine copy instead — the lesson file's own settings. */
  lessonExercise: Exercise;
  source: "lesson" | "sandbox";
}

/** The initial lesson slice for `initialSession`. */
export function lessonInitial(exercise: Exercise): LessonState {
  return { exercise, lessonExercise: exercise, source: "lesson" };
}

/** The lesson fields of a session — the input `lessonReducer` sees. */
export function lessonSlice(s: Session): LessonState {
  return {
    exercise: s.exercise,
    lessonExercise: s.lessonExercise,
    source: s.source,
  };
}

/** Lesson-slice reducer: `load` replaces the exercise wholesale;
 * everything else leaves the slice untouched (the apply* helpers
 * below handle the cross-slice data transitions). `ctx` is the
 * pre-action session (read-only); this slice needs only the action. */
export function lessonReducer(
  slice: LessonState,
  a: Action,
  ctx: Session,
): LessonState {
  void ctx; // the lesson slice reads no other slices
  if (a.type === "load") {
    return {
      exercise: a.exercise,
      lessonExercise: a.exercise,
      source: a.source,
    };
  }
  return slice;
}

/** The alphabet's default correction (v1.1 spec §5.1: protein → JTT). */
function defaultCorrection(a: Alphabet): DistModelName {
  return a === "protein" ? "Jtt" : "Jc69";
}

/** The alphabet's default simulation model (protein → JTT). */
function defaultSimModel(a: Alphabet): SimModel {
  return a === "protein" ? "Jtt" : "Jc69";
}

/** The alphabet a simulation model produces (JTT → protein). */
function simModelAlphabet(m: SimModel): Alphabet {
  return SIM_MODEL_NAMES.dna.includes(simModelName(m)) ? "dna" : "protein";
}

/** The exercise-level core of `reconcileModels`: switch the models
 * that are invalid for `target` to that alphabet's defaults and
 * report the switch. `null` when nothing needs switching. */
function reconcileExercise(
  exercise: Exercise,
  target: Alphabet,
): { exercise: Exercise; notice: string } | null {
  const switches: string[] = [];
  if (!CORRECTIONS[target].some((c) => c === exercise.analysis.correction)) {
    const c = defaultCorrection(target);
    exercise = {
      ...exercise,
      analysis: { ...exercise.analysis, correction: c },
    };
    switches.push(`correction to ${DIST_LABEL[c]}`);
  }
  if (
    exercise.data.kind === "simulated" &&
    !SIM_MODEL_NAMES[target].includes(
      simModelName(exercise.data.sim.model),
    )
  ) {
    const m = defaultSimModel(target);
    exercise = {
      ...exercise,
      data: {
        ...exercise.data,
        sim: { ...exercise.data.sim, model: m },
      },
    };
    switches.push(
      `the simulation model to ${SIM_LABEL[simModelName(m)]}`,
    );
  }
  if (switches.length === 0) return null;
  return {
    exercise,
    notice: `Switched ${switches.join(" and ")} because this data is now ${
      target === "dna" ? "DNA" : "protein"
    }.`,
  };
}

/**
 * Bring the session's models in line with `s.alphabet` (v1.1 spec
 * §5.1): a correction — or, on simulated data, a sim model — that is
 * invalid for the alphabet silently switches to the alphabet's
 * default (DNA → JC69, protein → JTT) and the switch is reported in
 * `notice`; an unchanged session keeps its identity and its `notice`.
 *
 * Every reducer path that can change the alphabet or the data calls
 * this before `recompute` — `load` (including embedded), `setAlphabet`,
 * `importAlignment`, `importTree`, `enterSandbox` and `exitSandbox` —
 * so a model/alphabet mismatch becomes the default-plus-notice instead
 * of a stuck `ModelAlphabetMismatch` (checkpoint 10: importing protein
 * after the DNA lesson errored with JC69 kept). Callers set `alphabet`
 * to the alphabet the action will display before calling. */
export function reconcileModels(s: Session): Session {
  const r = reconcileExercise(s.exercise, s.alphabet);
  if (r === null) return s;
  return { ...s, exercise: r.exercise, notice: r.notice };
}

/** `load`: merge the slice reducers' response to the load action over
 * the pre-action session (the UI slice is untouched by `load`, so
 * `mode` carries over), then reconcile and recompute.
 * reconcileModels keeps a declared-alphabet exercise consistent even
 * when the file pairs it with a foreign model (the schema validates
 * this, so it is belt-and-braces for custom `#x=` links). The lesson
 * defines its models, so its silent switch is kept but the notice is
 * dropped: a notice is for user-driven changes — setAlphabet and
 * imports — not for loading a lesson (checkpoint 13). */
export function applyLoad(
  s: Session,
  exercise: Exercise,
  source: LessonState["source"],
): Session {
  const a: Action = { type: "load", exercise, source };
  const merged: Session = {
    ...s,
    ...lessonReducer(lessonSlice(s), a, s),
    ...analysisReducer(analysisSlice(s), a, s),
    bootstrap: bootstrapReducer(s.bootstrap, a, s),
  };
  const reconciled = { ...reconcileModels(merged), notice: null };
  return reconciled.error === null ? recompute(reconciled) : reconciled;
}

/** `exitSandbox`: reload the current lesson from scratch:
 * `lessonExercise`, the exercise as loaded — sandbox
 * setSim/setAnalysis/reconcile changes live on `exercise` and must not
 * carry back into lesson mode (checkpoint 13). The fresh `prompts`
 * array keeps the prompt gate (which resets on the array's identity)
 * forgetting the student's picks. */
export function applyExitSandbox(s: Session): Session {
  return applyLoad(
    s,
    { ...s.lessonExercise, prompts: [...s.lessonExercise.prompts] },
    "lesson",
  );
}

/** `enterSandbox`: sandbox keeps the current pipeline outputs — same
 * exercise, same seed — so nothing on screen jumps. It only unlocks
 * the controls and shows the import panel (both read `source`).
 * reconcileModels is a no-op on an already-consistent session; it
 * runs here so every alphabet/data path stays covered. */
export function applyEnterSandbox(s: Session): Session {
  return reconcileModels({ ...s, source: "sandbox" });
}

/** `setSim`: simulation controls are inert unless the alignment is
 * re-simulatable — an imported alignment keeps the user's data and an
 * embedded alignment is fixed lesson data; otherwise the patch is
 * stored and recompute re-simulates. */
export function applySetSim(s: Session, patch: Partial<SimSpec>): Session {
  if (s.alignmentOrigin !== "simulated") return s;
  if (s.exercise.data.kind !== "simulated") return s;
  return recompute(
    clearBootstrap({
      ...s,
      notice: null,
      exercise: {
        ...s.exercise,
        data: {
          ...s.exercise.data,
          sim: { ...s.exercise.data.sim, ...patch },
        },
      },
    }),
  );
}

/** `setAnalysis`: analysis inputs do not affect simulation, so keep
 * the alignment. Checkpoint 11: a stepper sitting at its final
 * position lands on the new tree's final position — re-analyzing at
 * the end shows the finished new tree (and its bootstrap panel)
 * immediately. Any earlier position still resets to step 0, and
 * bootstrap results clear either way (clearBootstrap → status idle). */
export function applySetAnalysis(
  s: Session,
  patch: Partial<Exercise["analysis"]>,
): Session {
  const prevMax = s.result?.trace ? traceLength(s.result.trace) : 0;
  const wasAtFinal = s.result !== null && s.step === prevMax;
  const next = recompute(
    clearBootstrap({
      ...s,
      notice: null,
      exercise: {
        ...s.exercise,
        analysis: { ...s.exercise.analysis, ...patch },
      },
    }),
  );
  if (!wasAtFinal) return next;
  // A traceless result (>50 taxa) is always at its final position.
  const nextMax = next.result?.trace ? traceLength(next.result.trace) : 0;
  return nextMax === 0 ? next : { ...next, step: nextMax };
}

/** `setAlphabet`: the alphabet override (badge's "Treat as
 * protein/DNA", v1.1 spec §5.1). reconcileModels switches any model
 * that is invalid for the target alphabet to that alphabet's default
 * and reports the switch in `notice` — never a stuck error state
 * (Review Focus 3). */
export function applySetAlphabet(s: Session, alphabet: Alphabet): Session {
  const target = alphabet;
  const reconciled = reconcileModels({
    ...s,
    alphabet: target,
    notice: null,
  });
  const exercise = reconciled.exercise;
  const notice = reconciled.notice;
  if (s.alignmentOrigin === "simulated") {
    // Simulated data regenerates from sim.model in `recompute`, so
    // the model switch above is what produces the target alphabet;
    // reinterpreting the current sequences via withAlphabet would
    // either be discarded or fail on real protein letters.
    if (exercise === s.exercise) return s;
    return recompute(clearBootstrap({ ...s, exercise, notice }));
  }
  // Imported or embedded data is reinterpreted in place. A
  // successful override turns the alignment into user data — for
  // embedded data staying "embedded" would make `recompute`
  // re-parse data.fasta and undo the override.
  if (s.alignment === null) {
    return exercise === s.exercise
      ? s
      : recompute(clearBootstrap({ ...s, exercise, notice }));
  }
  if (s.alignment.alphabet === target && exercise === s.exercise) {
    return s;
  }
  const tagged = engine.withAlphabet(s.alignment, target);
  if (!tagged.ok) {
    // The override failed on real protein letters: keep the data
    // and show the error — never a stuck state.
    return { ...s, error: tagged.error, notice: null };
  }
  return recompute(
    clearBootstrap({
      ...s,
      exercise,
      notice,
      alignment: tagged.value,
      alignmentOrigin: "imported",
    }),
  );
}

/** `importAlignment`: an imported alignment is compared against an
 * imported reference tree only: the lesson's reference is a different
 * leaf set, so it is cleared (no comparison, no RF) instead of
 * erroring. `recompute` picks up `alphabet` from the alignment;
 * reconcileModels first brings the correction (and, on simulated
 * lessons, the sim model) in line with it, so e.g. a protein import
 * under JC69 switches to JTT with a notice instead of erroring
 * (checkpoint 10). */
export function applyImportAlignment(
  s: Session,
  alignment: Alignment,
): Session {
  return recompute(
    clearBootstrap(
      reconcileModels({
        ...s,
        alignment,
        alphabet: alignment.alphabet,
        alignmentOrigin: "imported",
        source: "sandbox",
        notice: null,
        reference: s.reference?.origin === "imported" ? s.reference : null,
      }),
    ),
  );
}

/** `importTree`: the imported tree becomes the reference (kind
 * "true": it is treated as the truth to compare against). The
 * alignment returns to the exercise's own origin — simulated data is
 * re-simulated along the new tree (spec §3.1); embedded data is
 * re-parsed from `data.fasta` and compared against it. */
export function applyImportTree(s: Session, tree: Tree): Session {
  const alignmentOrigin: Session["alignmentOrigin"] =
    s.exercise.data.kind === "embedded" ? "embedded" : "simulated";
  // The post-action alphabet is the declared one for embedded data
  // and the sim model's own alphabet for simulated data — not
  // `s.alphabet`, which may still describe an imported alignment
  // this action discards.
  const alphabet: Alphabet =
    s.exercise.data.kind === "embedded"
      ? s.exercise.alphabet
      : simModelAlphabet(s.exercise.data.sim.model);
  return recompute(
    clearBootstrap(
      reconcileModels({
        ...s,
        reference: { tree, kind: "true", origin: "imported" },
        notice: null,
        alignment: null,
        alignmentOrigin,
        alphabet,
        source: "sandbox",
      }),
    ),
  );
}

/** `setBranchScale`: scaling only affects simulation; the control is
 * inert while the alignment is imported or embedded. */
export function applyBranchScale(s: Session, scale: number): Session {
  if (s.alignmentOrigin !== "simulated") return s;
  return recompute(clearBootstrap({ ...s, branchScale: scale }));
}

/** True when the session holds user-imported data (an alignment or a
 * reference tree) that `exitSandbox` would clear — the UI confirms
 * before leaving sandbox in that case. An embedded alignment is lesson
 * data, not user data, so it never counts. */
export function hasImportedData(s: Session): boolean {
  return (
    s.alignmentOrigin === "imported" || s.reference?.origin === "imported"
  );
}
