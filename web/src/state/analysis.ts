// Analysis slice of Session: the alignment, the distance/build
// results the pipeline derives from it, the model/method vocabulary
// and the analysis-display settings (v1.3 spec §7.1). `recompute` is
// the pipeline driver — sim → dist → build → rf — and is shared by
// session.ts and the exercise/data actions in lesson.ts.

import { engine } from "../engine/index";

import type { Alignment } from "../engine/generated/Alignment";
import type { Alphabet } from "../engine/generated/Alphabet";
import type { BuildResult } from "../engine/generated/BuildResult";
import type { DistModel } from "../engine/generated/DistModel";
import type { DistanceMatrix } from "../engine/generated/DistanceMatrix";
import type { Exercise } from "../engine/generated/Exercise";
import type { NeoError } from "../engine/generated/NeoError";
import type { ReferenceKind } from "../engine/generated/ReferenceKind";
import type { RfResult } from "../engine/generated/RfResult";
import type { SimModel } from "../engine/generated/SimModel";
import type { SimSpec } from "../engine/generated/SimSpec";
import type { Trace } from "../engine/generated/Trace";
import type { Tree } from "../engine/generated/Tree";

import type { Action } from "./actions";
import type { Session } from "./session";

/** The Session slice owned by `analysisReducer`: the pipeline inputs
 * and outputs plus the analysis-display settings. */
export interface AnalysisState {
  /** The tree the inferred tree is compared against (v1.1 spec §5.1):
   * the exercise's declared `reference`, defaulting to `data.true_tree`
   * for simulated data without one (v1 parity), or a tree the sandbox
   * user imported (`origin: "imported"`, always `kind: "true"` — an
   * imported tree is treated as the truth and is simulated along).
   *
   * The v1 `trueTreeOrigin` rules apply to `origin` unchanged: an
   * imported alignment is never compared against a *lesson* reference
   * (labels would mismatch), so `importAlignment` drops a lesson
   * reference and keeps an imported one. */
  reference: {
    tree: Tree;
    kind: ReferenceKind;
    origin: "lesson" | "imported";
  } | null;
  alignment: Alignment | null;
  /** Where `alignment` comes from. `'simulated'`: simulated along the
   * true tree by `recompute` (sim controls live). `'embedded'`: parsed
   * from `data.fasta` by `recompute` (v1.1 spec §3.6 — never
   * re-simulated, and it is lesson data, so it does not count as
   * "imported data" for sandbox prompts or shared links).
   * `'imported'`: user-provided; `recompute` keeps it untouched. */
  alignmentOrigin: "simulated" | "imported" | "embedded";
  /** The active alignment's alphabet, or the exercise's declared
   * alphabet before/without one. `importAlignment` sets it from the
   * parsed alignment (v1.1 plan Task 9). */
  alphabet: Alphabet;
  matrix: DistanceMatrix | null;
  result: BuildResult | null;
  rf: RfResult | null;
  error: NeoError | null;
  step: number; // 0 = before first join; max = trace length
  clampNegative: boolean;
  matrixView: "distance" | "q";
  branchScale: number; // default 1; multiplies true-tree lengths before simulate
  hover: { i: number; j: number } | null;
  /** A one-line notice set by `setAlphabet` when the override silently
   * switched a model to the new alphabet's default (v1.1 spec §5.1).
   * Cleared by the next action that changes models or data. */
  notice: string | null;
  /** Draw the NJ tree rooted on the reference's outgroup at the final
   * step (v1.2 spec §6.7); false shows the computed unrooted layout. */
  rerootDisplay: boolean;
}

/** The initial analysis slice for `initialSession`: nothing computed
 * yet; `alignmentOrigin` mirrors `data.kind` (embedded data is parsed
 * from `data.fasta`, never re-simulated, v1.1 spec §3.6). */
export function analysisInitial(exercise: Exercise): AnalysisState {
  return {
    reference: null,
    alignment: null,
    alignmentOrigin:
      exercise.data.kind === "embedded" ? "embedded" : "simulated",
    alphabet: exercise.alphabet,
    matrix: null,
    result: null,
    rf: null,
    error: null,
    step: 0,
    clampNegative: false,
    matrixView: "distance",
    branchScale: 1,
    hover: null,
    notice: null,
    rerootDisplay: true,
  };
}

/** The analysis fields of a session — the input `analysisReducer`
 * sees. */
export function analysisSlice(s: Session): AnalysisState {
  return {
    reference: s.reference,
    alignment: s.alignment,
    alignmentOrigin: s.alignmentOrigin,
    alphabet: s.alphabet,
    matrix: s.matrix,
    result: s.result,
    rf: s.rf,
    error: s.error,
    step: s.step,
    clampNegative: s.clampNegative,
    matrixView: s.matrixView,
    branchScale: s.branchScale,
    hover: s.hover,
    notice: s.notice,
    rerootDisplay: s.rerootDisplay,
  };
}

/** Analysis-slice reducer: the actions that touch only analysis
 * state, plus the analysis fields of `load`. `ctx` is the pre-action
 * session (read-only); this slice needs only the action. Returns
 * `slice` unchanged when the action does not apply. */
export function analysisReducer(
  slice: AnalysisState,
  a: Action,
  ctx: Session,
): AnalysisState {
  void ctx; // the analysis slice reads no other slices
  switch (a.type) {
    case "load": {
      // The comparison tree is the exercise's declared `reference`,
      // or — for simulated data without one — `data.true_tree`, the
      // tree the alignment is simulated along (v1 parity: RF against
      // the true tree). The alignment itself is left to `recompute`,
      // which simulates or parses `data.fasta` for embedded data.
      let refNewick: string | null = a.exercise.reference?.newick ?? null;
      const refKind: ReferenceKind = a.exercise.reference?.kind ?? "true";
      if (refNewick === null && a.exercise.data.kind === "simulated") {
        refNewick = a.exercise.data.true_tree;
      }
      let reference: AnalysisState["reference"] = null;
      let error: NeoError | null = null;
      if (refNewick !== null) {
        const parsed = engine.parseNewick(refNewick);
        if (parsed.ok) {
          reference = { tree: parsed.value, kind: refKind, origin: "lesson" };
        } else {
          error = parsed.error;
        }
      }
      return {
        ...slice,
        reference,
        alphabet: a.exercise.alphabet,
        alignment: null,
        matrix: null,
        result: null,
        rf: null,
        error,
        step: 0,
        branchScale: 1,
        hover: null,
        notice: null,
        alignmentOrigin:
          a.exercise.data.kind === "embedded" ? "embedded" : "simulated",
      };
    }
    case "step": {
      const max = slice.result?.trace ? traceLength(slice.result.trace) : 0;
      return { ...slice, step: Math.max(0, Math.min(a.to, max)) };
    }
    case "toggleClamp":
      return { ...slice, clampNegative: !slice.clampNegative };
    case "setMatrixView":
      return { ...slice, matrixView: a.view };
    case "hover":
      return { ...slice, hover: a.cell };
    case "toggleRerootDisplay":
      return { ...slice, rerootDisplay: !slice.rerootDisplay };
    default:
      return slice;
  }
}

/** Corrections valid for each alphabet, in menu order (v1.1 spec
 * §5.1). The first non-`P` entry is the alphabet's default. */
export const CORRECTIONS: Record<Alphabet, DistModel[]> = {
  dna: ["P", "Jc69", "K80"],
  protein: ["P", "Kimura", "Jtt"],
};

/** Display labels for the correction menu and `notice` text. */
export const DIST_LABEL: Record<DistModel, string> = {
  P: "p",
  Jc69: "JC69",
  K80: "K80",
  Kimura: "Kimura",
  Jtt: "JTT",
};

/** The simple name of a `SimModel` (the K80 parameter is a detail). */
export type SimModelName = "Jc69" | "K80" | "Jtt";

/** Sim models valid for each alphabet, in menu order (v1.1 spec §5.1). */
export const SIM_MODEL_NAMES: Record<Alphabet, SimModelName[]> = {
  dna: ["Jc69", "K80"],
  protein: ["Jtt"],
};

/** Display labels for the simulation menu and `notice` text. */
export const SIM_LABEL: Record<SimModelName, string> = {
  Jc69: "JC69",
  K80: "K80",
  Jtt: "JTT",
};

/** The simple name of a `SimModel` (the K80 parameter is a detail).
 * Exhaustive over SimModel's variants — the `never` check fails to
 * compile if a new variant appears. */
export function simModelName(m: SimModel): SimModelName {
  if (typeof m === "string") {
    switch (m) {
      case "Jc69":
        return "Jc69";
      case "Jtt":
        return "Jtt";
      default: {
        const _exhaustive: never = m;
        throw new Error(`unhandled SimModel variant: ${_exhaustive}`);
      }
    }
  }
  if ("K80" in m) return "K80";
  const _exhaustive: never = m;
  throw new Error(`unhandled SimModel variant: ${JSON.stringify(_exhaustive)}`);
}

/** The sim spec of a simulated exercise; `null` for embedded data
 * (v1.1 spec §3.6: embedded exercises never re-simulate). */
export function exerciseSim(e: Exercise): SimSpec | null {
  return e.data.kind === "simulated" ? e.data.sim : null;
}

/** Number of steps in a trace. NJ records the final three-way join
 * separately (spec §4.5 step 5 is part of the trace), so it counts one
 * extra position beyond `steps`. */
export function traceLength(trace: Trace): number {
  return "Nj" in trace ? trace.Nj.steps.length + 1 : trace.Upgma.steps.length;
}

/** A copy of `tree` with every branch length multiplied by `scale`
 * (spec §6.2 TeachingNotices halves branch lengths via branchScale). */
function scaleTree(tree: Tree, scale: number): Tree {
  if (scale === 1) return tree;
  return {
    ...tree,
    branches: tree.branches.map((b) => ({
      ...b,
      length: b.length === null ? null : b.length * scale,
    })),
  };
}

/** A pipeline result with the failure's `error` recorded and every
 * downstream output cleared (the shared shape of each early return). */
function failed(s: Session, e: Session["error"]): Session {
  return {
    ...s,
    matrix: null,
    result: null,
    rf: null,
    error: e,
    step: 0,
  };
}

/**
 * Run the pipeline sim → dist → build → rf (spec §3.1) from the
 * session's current inputs. Stops at the first error and stores it in
 * `error`; never throws. Outputs upstream of the failure are kept (a
 * saturated matrix is still displayed, spec §6.3).
 *
 * `alignmentOrigin` decides the alignment source: `'imported'` keeps the
 * user's alignment untouched, `'embedded'` re-parses `data.fasta`
 * (never re-simulated, v1.1 spec §3.6), and `'simulated'` re-simulates
 * along the true tree. A trace is requested only when the alignment has
 * at most 50 taxa (Global Constraints).
 */
export function recompute(s: Session): Session {
  let alignment = s.alignment;
  let alphabet: Alphabet = s.exercise.alphabet;
  if (s.alignmentOrigin === "embedded") {
    // Re-parse `data.fasta` and tag it with the declared alphabet (the
    // declared alphabet is authoritative, v1.1 spec §3.6).
    alignment = null;
    if (s.exercise.data.kind !== "embedded") {
      // Unreachable: the origin is set from data.kind at load.
      // Defensive stop.
      return { ...failed(s, null), alignment, alphabet };
    }
    const parsed = engine.parseFasta(s.exercise.data.fasta);
    if (!parsed.ok) {
      return { ...failed(s, parsed.error), alignment, alphabet };
    }
    const tagged = engine.withAlphabet(parsed.value, s.exercise.alphabet);
    if (!tagged.ok) {
      return { ...failed(s, tagged.error), alignment, alphabet };
    }
    alignment = tagged.value;
  } else if (s.alignmentOrigin === "simulated") {
    alignment = null;
    const spec = exerciseSim(s.exercise);
    if (spec === null || s.exercise.data.kind !== "simulated") {
      // Unreachable: the origin is "simulated" only for simulated
      // data. Defensive stop.
      return { ...failed(s, null), alignment, alphabet };
    }
    // The sim source is an imported reference tree when the user
    // imported one (v1 importTree semantics), otherwise the
    // exercise's true_tree — not `reference.tree`, which may be a
    // different declared comparison tree.
    let simTree: Tree;
    if (s.reference !== null && s.reference.origin === "imported") {
      simTree = s.reference.tree;
    } else {
      const parsed = engine.parseNewick(s.exercise.data.true_tree);
      if (!parsed.ok) {
        return { ...failed(s, parsed.error), alignment, alphabet };
      }
      simTree = parsed.value;
    }
    const sim = engine.simulate(scaleTree(simTree, s.branchScale), spec);
    if (!sim.ok) {
      return { ...failed(s, sim.error), alignment, alphabet };
    }
    alignment = sim.value;
  }
  if (alignment === null) {
    // Imported origin with nothing imported yet: nothing to analyze.
    return { ...failed(s, null), alignment, alphabet };
  }
  alphabet = alignment.alphabet;

  const dist = engine.distances(alignment, s.exercise.analysis.correction);
  if (!dist.ok) {
    return { ...failed(s, dist.error), alignment, alphabet };
  }
  const matrix = dist.value;

  const built = engine.buildTree(matrix, s.exercise.analysis.method, {
    trace: alignment.labels.length <= 50,
  });
  if (!built.ok) {
    return {
      ...s,
      alignment,
      alphabet,
      matrix,
      result: null,
      rf: null,
      error: built.error,
      step: 0,
    };
  }
  const result = built.value;

  let rf: RfResult | null = null;
  if (s.reference !== null) {
    const cmp = engine.compare(s.reference.tree, result.tree);
    if (!cmp.ok) {
      return {
        ...s,
        alignment,
        alphabet,
        matrix,
        result,
        rf: null,
        error: cmp.error,
        step: 0,
      };
    }
    rf = cmp.value;
  }

  return {
    ...s,
    alignment,
    alphabet,
    matrix,
    result,
    rf,
    error: null,
    step: 0,
  };
}
