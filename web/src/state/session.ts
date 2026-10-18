// Session state for the web app (plan Task 13, spec §6; v1.1 plan Task 9,
// v1.1 spec §5.1). The reducer is pure; every state change that affects
// the pipeline runs `recompute`, which drives sim → dist → build → rf
// through the engine wrapper and stores the first failure in `error`
// instead of throwing.

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

export interface Session {
  exercise: Exercise;
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
  mode: "concept" | "math";
  clampNegative: boolean;
  matrixView: "distance" | "q";
  branchScale: number; // default 1; multiplies true-tree lengths before simulate
  hover: { i: number; j: number } | null;
  source: "lesson" | "sandbox";
  /** A one-line notice set by `setAlphabet` when the override silently
   * switched a model to the new alphabet's default (v1.1 spec §5.1).
   * Cleared by the next action that changes models or data. */
  notice: string | null;
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
  | { type: "setAlphabet"; alphabet: Alphabet }
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

/** The alphabet's default correction (v1.1 spec §5.1: protein → JTT). */
function defaultCorrection(a: Alphabet): DistModel {
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
  const target = s.alphabet;
  let exercise = s.exercise;
  const switches: string[] = [];
  if (!CORRECTIONS[target].includes(exercise.analysis.correction)) {
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
  if (switches.length === 0) return s;
  return {
    ...s,
    exercise,
    notice: `Switched ${switches.join(" and ")} because this data is now ${
      target === "dna" ? "DNA" : "protein"
    }.`,
  };
}

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

/** `reducer` is pure: it returns a new `Session` and mutates nothing. */
export function reducer(s: Session, a: Action): Session {
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
      let reference: Session["reference"] = null;
      let error: NeoError | null = null;
      if (refNewick !== null) {
        const parsed = engine.parseNewick(refNewick);
        if (parsed.ok) {
          reference = { tree: parsed.value, kind: refKind, origin: "lesson" };
        } else {
          error = parsed.error;
        }
      }
      const base: Session = {
        exercise: a.exercise,
        reference,
        alphabet: a.exercise.alphabet,
        alignment: null,
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
        notice: null,
        alignmentOrigin:
          a.exercise.data.kind === "embedded" ? "embedded" : "simulated",
      };
      // reconcileModels keeps a declared-alphabet exercise consistent
      // even when the file pairs it with a foreign model (the schema
      // validates this, so it is belt-and-braces for custom `#x=` links).
      const reconciled = reconcileModels(base);
      return error === null ? recompute(reconciled) : reconciled;
    }
    case "setSim": {
      // Simulation controls are inert unless the alignment is
      // re-simulatable — an imported alignment keeps the user's data
      // and an embedded alignment is fixed lesson data; otherwise the
      // patch is stored and recompute re-simulates.
      if (s.alignmentOrigin !== "simulated") return s;
      if (s.exercise.data.kind !== "simulated") return s;
      return recompute({
        ...s,
        notice: null,
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
        notice: null,
        exercise: {
          ...s.exercise,
          analysis: { ...s.exercise.analysis, ...a.patch },
        },
      });
    case "setAlphabet": {
      // The alphabet override (badge's "Treat as protein/DNA", v1.1
      // spec §5.1). reconcileModels switches any model that is invalid
      // for the target alphabet to that alphabet's default and reports
      // the switch in `notice` — never a stuck error state (Review
      // Focus 3).
      const target = a.alphabet;
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
        return recompute({ ...s, exercise, notice });
      }
      // Imported or embedded data is reinterpreted in place. A
      // successful override turns the alignment into user data — for
      // embedded data staying "embedded" would make `recompute`
      // re-parse data.fasta and undo the override.
      if (s.alignment === null) {
        return exercise === s.exercise ? s : recompute({ ...s, exercise, notice });
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
      return recompute({
        ...s,
        exercise,
        notice,
        alignment: tagged.value,
        alignmentOrigin: "imported",
      });
    }
    case "importAlignment":
      // An imported alignment is compared against an imported
      // reference tree only: the lesson's reference is a different leaf
      // set, so it is cleared (no comparison, no RF) instead of
      // erroring. `recompute` picks up `alphabet` from the alignment;
      // reconcileModels first brings the correction (and, on simulated
      // lessons, the sim model) in line with it, so e.g. a protein
      // import under JC69 switches to JTT with a notice instead of
      // erroring (checkpoint 10).
      return recompute(
        reconcileModels({
          ...s,
          alignment: a.alignment,
          alphabet: a.alignment.alphabet,
          alignmentOrigin: "imported",
          source: "sandbox",
          notice: null,
          reference:
            s.reference?.origin === "imported" ? s.reference : null,
        }),
      );
    case "importTree": {
      // The imported tree becomes the reference (kind "true": it is
      // treated as the truth to compare against). The alignment
      // returns to the exercise's own origin — simulated data is
      // re-simulated along the new tree (spec §3.1); embedded data is
      // re-parsed from `data.fasta` and compared against it.
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
        reconcileModels({
          ...s,
          reference: { tree: a.tree, kind: "true", origin: "imported" },
          notice: null,
          alignment: null,
          alignmentOrigin,
          alphabet,
          source: "sandbox",
        }),
      );
    }
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
      // Scaling only affects simulation; it is inert while the
      // alignment is imported or embedded.
      if (s.alignmentOrigin !== "simulated") return s;
      return recompute({ ...s, branchScale: a.scale });
    case "hover":
      return { ...s, hover: a.cell };
    case "enterSandbox":
      // Sandbox keeps the current pipeline outputs — same exercise,
      // same seed — so nothing on screen jumps. It only unlocks the
      // controls and shows the import panel (both read `source`).
      // reconcileModels is a no-op on an already-consistent session;
      // it runs here so every alphabet/data path stays covered.
      return reconcileModels({ ...s, source: "sandbox" });
    case "exitSandbox":
      // Reload the current lesson from scratch. The exercise is
      // re-dispatched through `load` — which reconciles the models
      // against the lesson's alphabet — with a fresh `prompts` array
      // so the prompt gate (which resets on the array's identity)
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
    reference: null,
    alphabet: exercise.alphabet,
    alignment: null,
    alignmentOrigin:
      exercise.data.kind === "embedded" ? "embedded" : "simulated",
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
    notice: null,
  };
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
