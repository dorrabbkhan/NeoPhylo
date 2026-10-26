// Session state for the web app (v1.3 spec §7.1). Composes the
// lesson, analysis, bootstrap and ui slices behind an unchanged
// public API so callers are untouched. The reducer is pure; every
// state change that affects the pipeline runs `recompute`, which
// drives sim → dist → build → rf and stores the first failure in
// `error` instead of throwing.

import type { Exercise } from "../engine/generated/Exercise";

import {
  analysisInitial,
  analysisReducer,
  analysisSlice,
  type AnalysisState,
} from "./analysis";
import {
  bootstrapInitial,
  bootstrapReducer,
  type BootstrapState,
} from "./bootstrap";
import {
  applyBranchScale,
  applyEnterSandbox,
  applyExitSandbox,
  applyImportAlignment,
  applyImportTree,
  applyLoad,
  applySetAlphabet,
  applySetAnalysis,
  applySetSim,
  lessonInitial,
  lessonReducer,
  lessonSlice,
  type LessonState,
} from "./lesson";
import { uiInitial, uiReducer, uiSlice, type UiState } from "./ui";
import type { Action } from "./actions";

export type { Action } from "./actions";
export {
  AUTO_RUN_MS,
  MAX_REPLICATES,
  MIN_REPLICATES,
  bootstrapInitial as defaultBootstrap,
  clearBootstrap,
  type BootstrapState,
  type BootstrapStatus,
  type BootstrapView,
} from "./bootstrap";
export {
  CORRECTIONS,
  DIST_LABEL,
  SIM_LABEL,
  SIM_MODEL_NAMES,
  distModelName,
  exerciseSim,
  recompute,
  simModelName,
  type DistModelName,
  type SimModelName,
} from "./analysis";
export { hasImportedData, reconcileModels } from "./lesson";

/** The whole session: the four slices side by side, so `s.exercise`,
 * `s.step`, `s.mode` keep working for callers. */
export interface Session extends LessonState, AnalysisState, UiState {
  /** Bootstrap run state (v1.2 spec §6.1). */
  bootstrap: BootstrapState;
}

/** Merge each slice reducer's output over the pre-action session.
 * Slices are passed as field-picked objects so a slice reducer can
 * only return its own fields; a slice that does not apply returns its
 * input unchanged. When no slice changed, the session itself is
 * returned so no-op dispatches keep their identity. */
function compose(s: Session, a: Action): Session {
  const lesson = lessonSlice(s);
  const analysis = analysisSlice(s);
  const ui = uiSlice(s);
  const l = lessonReducer(lesson, a, s);
  const an = analysisReducer(analysis, a, s);
  const b = bootstrapReducer(s.bootstrap, a, s);
  const u = uiReducer(ui, a, s);
  if (l === lesson && an === analysis && b === s.bootstrap && u === ui) {
    return s;
  }
  return { ...s, ...l, ...an, bootstrap: b, ...u };
}

/** `reducer` is pure: it returns a new `Session` and mutates nothing.
 * The cross-slice data transitions run through Session-level helpers
 * (a slice reducer returns only its own fields); the rest compose. */
export function reducer(s: Session, a: Action): Session {
  switch (a.type) {
    case "load":
      return applyLoad(s, a.exercise, a.source);
    case "setSim":
      return applySetSim(s, a.patch);
    case "setAnalysis":
      return applySetAnalysis(s, a.patch);
    case "setAlphabet":
      return applySetAlphabet(s, a.alphabet);
    case "importAlignment":
      return applyImportAlignment(s, a.alignment);
    case "importTree":
      return applyImportTree(s, a.tree);
    case "setBranchScale":
      return applyBranchScale(s, a.scale);
    case "enterSandbox":
      return applyEnterSandbox(s);
    case "exitSandbox":
      return applyExitSandbox(s);
    default:
      return compose(s, a);
  }
}

/** A fresh session around `exercise`, before any pipeline has run.
 * Dispatch `load` to parse the exercise's data and simulate or embed. */
export function initialSession(exercise: Exercise): Session {
  return {
    ...lessonInitial(exercise),
    ...analysisInitial(exercise),
    bootstrap: bootstrapInitial(),
    ...uiInitial(),
  };
}
