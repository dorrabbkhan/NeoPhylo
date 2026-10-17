// Session state for the web app (plan Task 13, spec §6). The reducer is
// pure; every state change that affects the pipeline runs `recompute`,
// which drives sim → dist → build → rf through the engine wrapper and
// stores the first failure in `error` instead of throwing.

import { engine } from "../engine/index";

import type { Alignment } from "../engine/generated/Alignment";
import type { BuildResult } from "../engine/generated/BuildResult";
import type { DistanceMatrix } from "../engine/generated/DistanceMatrix";
import type { Exercise } from "../engine/generated/Exercise";
import type { NeoError } from "../engine/generated/NeoError";
import type { RfResult } from "../engine/generated/RfResult";
import type { SimSpec } from "../engine/generated/SimSpec";
import type { Trace } from "../engine/generated/Trace";
import type { Tree } from "../engine/generated/Tree";

export interface Session {
  exercise: Exercise;
  trueTree: Tree | null;
  alignment: Alignment | null;
  /** Whether `alignment` is simulated from `trueTree` or user-imported.
   * While `'imported'`, sim controls are inert and `recompute` never
   * re-simulates. */
  alignmentOrigin: "simulated" | "imported";
  matrix: DistanceMatrix | null;
  result: BuildResult | null;
  rf: RfResult | null;
  error: NeoError | null;
  step: number; // 0 = before first join; max = trace length
  mode: "concept" | "math";
  clampNegative: boolean;
  matrixView: "distance" | "q";
  branchScale: number; // default 1; multiplies true-tree lengths before simulate
  hover: { i: number; j: number } | null;
  source: "lesson" | "sandbox";
  /** Where `trueTree` came from. An imported alignment is never
   * compared against the *lesson* tree (labels would mismatch), so
   * importAlignment drops a lesson tree and keeps an imported one. */
  trueTreeOrigin: "lesson" | "imported";
}

/** The sim spec of a simulated exercise; `null` for embedded data
 * (v1.1 spec §3.6: embedded exercises never re-simulate). */
export function exerciseSim(e: Exercise): SimSpec | null {
  return e.data.kind === "simulated" ? e.data.sim : null;
}

export type Action =
  | { type: "load"; exercise: Exercise; source: Session["source"] }
  | { type: "setSim"; patch: Partial<SimSpec> }
  | { type: "setAnalysis"; patch: Partial<Exercise["analysis"]> }
  | { type: "importAlignment"; alignment: Alignment }
  | { type: "importTree"; tree: Tree }
  | { type: "step"; to: number }
  | { type: "setMode"; mode: Session["mode"] }
  | { type: "toggleClamp" }
  | { type: "setMatrixView"; view: Session["matrixView"] }
  | { type: "setBranchScale"; scale: number }
  | { type: "hover"; cell: Session["hover"] }
  | { type: "enterSandbox" }
  | { type: "exitSandbox" };

/** Number of steps in a trace. NJ records the final three-way join
 * separately (spec §4.5 step 5 is part of the trace), so it counts one
 * extra position beyond `steps`. */
function traceLength(trace: Trace): number {
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

/**
 * Run the pipeline sim → dist → build → rf (spec §3.1) from the
 * session's current inputs. Stops at the first error and stores it in
 * `error`; never throws. Outputs upstream of the failure are kept (a
 * saturated matrix is still displayed, spec §6.3).
 *
 * `alignmentOrigin` decides the alignment source: `'simulated'` always
 * re-simulates from `trueTree` (deterministic for a fixed seed), while
 * `'imported'` keeps the user's alignment untouched. A trace is
 * requested only when the alignment has at most 50 taxa (Global
 * Constraints).
 */
export function recompute(s: Session): Session {
  let alignment = s.alignment;
  if (s.alignmentOrigin === "simulated") {
    alignment = null;
    if (s.trueTree === null) {
      return {
        ...s,
        alignment,
        matrix: null,
        result: null,
        rf: null,
        error: null,
        step: 0,
      };
    }
    const spec = exerciseSim(s.exercise);
    if (spec === null) {
      // Embedded data never re-simulates; `load` stores it under the
      // imported origin, so this is just a defensive stop.
      return {
        ...s,
        alignment,
        matrix: null,
        result: null,
        rf: null,
        error: null,
        step: 0,
      };
    }
    const sim = engine.simulate(scaleTree(s.trueTree, s.branchScale), spec);
    if (!sim.ok) {
      return {
        ...s,
        alignment,
        matrix: null,
        result: null,
        rf: null,
        error: sim.error,
        step: 0,
      };
    }
    alignment = sim.value;
  }
  if (alignment === null) {
    // Imported origin with nothing imported yet: nothing to analyze.
    return {
      ...s,
      alignment,
      matrix: null,
      result: null,
      rf: null,
      error: null,
      step: 0,
    };
  }

  const dist = engine.distances(alignment, s.exercise.analysis.correction);
  if (!dist.ok) {
    return {
      ...s,
      alignment,
      matrix: null,
      result: null,
      rf: null,
      error: dist.error,
      step: 0,
    };
  }
  const matrix = dist.value;

  const built = engine.buildTree(matrix, s.exercise.analysis.method, {
    trace: alignment.labels.length <= 50,
  });
  if (!built.ok) {
    return {
      ...s,
      alignment,
      matrix,
      result: null,
      rf: null,
      error: built.error,
      step: 0,
    };
  }
  const result = built.value;

  let rf: RfResult | null = null;
  if (s.trueTree !== null) {
    const cmp = engine.compare(s.trueTree, result.tree);
    if (!cmp.ok) {
      return {
        ...s,
        alignment,
        matrix,
        result,
        rf: null,
        error: cmp.error,
        step: 0,
      };
    }
    rf = cmp.value;
  }

  return { ...s, alignment, matrix, result, rf, error: null, step: 0 };
}

/** `reducer` is pure: it returns a new `Session` and mutates nothing. */
export function reducer(s: Session, a: Action): Session {
  switch (a.type) {
    case "load": {
      // Simulated data needs its true tree; embedded data is parsed
      // into an imported alignment and any `reference` supplies the
      // comparison tree (v1.1 spec §3.6).
      let trueTree: Tree | null = null;
      let alignment: Alignment | null = null;
      let alignmentOrigin: Session["alignmentOrigin"] = "simulated";
      let error: NeoError | null = null;
      if (a.exercise.data.kind === "simulated") {
        const parsed = engine.parseNewick(a.exercise.data.true_tree);
        if (parsed.ok) {
          trueTree = parsed.value;
        } else {
          error = parsed.error;
        }
      } else {
        const parsed = engine.parseFasta(a.exercise.data.fasta);
        if (parsed.ok) {
          // The declared alphabet is authoritative (v1.1 spec §3.6):
          // re-tag DNA-looking protein data so protein corrections
          // apply; load_exercise already validated the characters.
          const tagged = engine.withAlphabet(
            parsed.value,
            a.exercise.alphabet,
          );
          if (tagged.ok) {
            alignment = tagged.value;
            alignmentOrigin = "imported";
          } else {
            error = tagged.error;
          }
        } else {
          error = parsed.error;
        }
        if (a.exercise.reference !== null) {
          const parsedRef = engine.parseNewick(a.exercise.reference.newick);
          if (parsedRef.ok) {
            trueTree = parsedRef.value;
          } else if (error === null) {
            error = parsedRef.error;
          }
        }
      }
      const base: Session = {
        exercise: a.exercise,
        trueTree,
        alignment,
        matrix: null,
        result: null,
        rf: null,
        error,
        step: 0,
        mode: s.mode,
        clampNegative: s.clampNegative,
        matrixView: s.matrixView,
        branchScale: 1,
        hover: null,
        source: a.source,
        trueTreeOrigin: "lesson",
        alignmentOrigin,
      };
      return error === null ? recompute(base) : base;
    }
    case "setSim": {
      // Simulation controls are inert while an imported alignment is in
      // place; otherwise the patch is stored and recompute re-simulates.
      if (s.alignmentOrigin === "imported") return s;
      if (s.exercise.data.kind !== "simulated") return s;
      return recompute({
        ...s,
        exercise: {
          ...s.exercise,
          data: {
            ...s.exercise.data,
            sim: { ...s.exercise.data.sim, ...a.patch },
          },
        },
      });
    }
    case "setAnalysis":
      // Analysis inputs do not affect simulation, so keep the alignment.
      return recompute({
        ...s,
        exercise: {
          ...s.exercise,
          analysis: { ...s.exercise.analysis, ...a.patch },
        },
      });
    case "importAlignment":
      // An imported alignment is compared against an imported true
      // tree only: the lesson's tree is a different leaf set, so it is
      // cleared (no comparison, no RF) instead of erroring.
      return recompute({
        ...s,
        alignment: a.alignment,
        alignmentOrigin: "imported",
        source: "sandbox",
        trueTree: s.trueTreeOrigin === "imported" ? s.trueTree : null,
      });
    case "importTree":
      // The imported tree becomes the true tree and the alignment is
      // re-simulated along it (spec §3.1).
      return recompute({
        ...s,
        trueTree: a.tree,
        trueTreeOrigin: "imported",
        alignment: null,
        alignmentOrigin: "simulated",
        source: "sandbox",
      });
    case "step": {
      const max = s.result?.trace ? traceLength(s.result.trace) : 0;
      return { ...s, step: Math.max(0, Math.min(a.to, max)) };
    }
    case "setMode":
      return { ...s, mode: a.mode };
    case "toggleClamp":
      return { ...s, clampNegative: !s.clampNegative };
    case "setMatrixView":
      return { ...s, matrixView: a.view };
    case "setBranchScale":
      // Scaling only affects simulated data; it is inert while an
      // imported alignment is in place.
      if (s.alignmentOrigin === "imported") return s;
      return recompute({ ...s, branchScale: a.scale });
    case "hover":
      return { ...s, hover: a.cell };
    case "enterSandbox":
      // Sandbox keeps the current pipeline outputs — same exercise,
      // same seed — so nothing on screen jumps. It only unlocks the
      // controls and shows the import panel (both read `source`).
      return { ...s, source: "sandbox" };
    case "exitSandbox":
      // Reload the current lesson from scratch. The exercise is
      // re-dispatched through `load` with a fresh `prompts` array so
      // the prompt gate (which resets on the array's identity)
      // forgets the student's picks.
      return reducer(s, {
        type: "load",
        exercise: { ...s.exercise, prompts: [...s.exercise.prompts] },
        source: "lesson",
      });
  }
}

/** A fresh session around `exercise`, before any pipeline has run.
 * Dispatch `load` to parse the exercise's data and simulate or embed. */
export function initialSession(exercise: Exercise): Session {
  return {
    exercise,
    trueTree: null,
    alignment: null,
    alignmentOrigin: "simulated",
    matrix: null,
    result: null,
    rf: null,
    error: null,
    step: 0,
    mode: "concept",
    clampNegative: false,
    matrixView: "distance",
    branchScale: 1,
    hover: null,
    source: "lesson",
    trueTreeOrigin: "lesson",
  };
}

/** True when the session holds user-imported data (an alignment or a
 * true tree) that `exitSandbox` would clear — the UI confirms before
 * leaving sandbox in that case. */
export function hasImportedData(s: Session): boolean {
  return s.alignmentOrigin === "imported" || s.trueTreeOrigin === "imported";
}
