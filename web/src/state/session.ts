// Session state for the web app (plan Task 13, spec §6; v1.1 plan Task 9,
// v1.1 spec §5.1). The reducer is pure; every state change that affects
// the pipeline runs `recompute`, which drives sim → dist → build → rf
// through the engine wrapper and stores the first failure in `error`
// instead of throwing.

import { engine } from "../engine/index";

import type { Alignment } from "../engine/generated/Alignment";
import type { Alphabet } from "../engine/generated/Alphabet";
import type { BuildResult } from "../engine/generated/BuildResult";
import type { ConsensusKind } from "../engine/generated/ConsensusKind";
import type { DistModel } from "../engine/generated/DistModel";
import type { DistanceMatrix } from "../engine/generated/DistanceMatrix";
import type { DroppedGroup } from "../engine/generated/DroppedGroup";
import type { Exercise } from "../engine/generated/Exercise";
import type { NeoError } from "../engine/generated/NeoError";
import type { ReferenceKind } from "../engine/generated/ReferenceKind";
import type { RfResult } from "../engine/generated/RfResult";
import type { SimModel } from "../engine/generated/SimModel";
import type { SimSpec } from "../engine/generated/SimSpec";
import type { Trace } from "../engine/generated/Trace";
import type { Tree } from "../engine/generated/Tree";
import type { BootstrapResult } from "../engine/bootstrapProtocol";

export interface Session {
  exercise: Exercise;
  /** The exercise exactly as `load` received it (checkpoint 13).
   * `exercise` is the working copy: setSim, setAnalysis and
   * reconcileModels mutate it, so reloading `s.exercise` would carry
   * sandbox changes back into lesson mode. `exitSandbox` reloads this
   * pristine copy instead — the lesson file's own settings. */
  lessonExercise: Exercise;
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
  /** Bootstrap run state (v1.2 spec §6.1). */
  bootstrap: BootstrapState;
  /** Draw the NJ tree rooted on the reference's outgroup at the final
   * step (v1.2 spec §6.7); false shows the computed unrooted layout. */
  rerootDisplay: boolean;
}

/** Consensus tab ids plus "support" for the original tree (§6.4).
 * URL v3 serializes these verbatim. */
export type BootstrapView = "support" | "majority" | "extended" | "strict";

/** Bootstrap replicate bounds (v1.2 spec §3.8). */
export const MIN_REPLICATES = 10;
export const MAX_REPLICATES = 1000;
/** Runs estimated at or under this many ms start without a confirm
 * (v1.2 spec §5, §6.1) — including `ran: true` links. */
export const AUTO_RUN_MS = 10_000;

export type BootstrapStatus =
  | "idle"
  | "estimating"
  | "confirming"
  | "running"
  | "done"
  | "cancelled"
  | "error";

/** `Session.bootstrap` (v1.2 spec §6.1), plus the bookkeeping the page
 * needs to drive `BootstrapClient` without its own state:
 * - `settingsUsed` snapshots the settings a run was started with, so a
 *   results panel can flag "settings changed" (Review Focus 3).
 * - `jobId` is the client's current job; `cancelJobId` is a job the
 *   session asks the page to cancel (a running job whose results were
 *   just cleared by a data change, an autorun the estimate ruled out,
 *   or the panel's Cancel button). The App effect turns it into
 *   `client.cancel` + a jobId-scoped `bootstrapCancelled` ack, which
 *   settles only that pending cancel — a newer request may already be
 *   estimating in its place.
 * - `autorun` marks a request from a `ran: true` link: an over-budget
 *   estimate degrades to `idle` + `prefilledRun` instead of the
 *   confirm dialog (spec §6.1).
 * - `prefilledRun`: show a prefilled "Run bootstrap (N replicates)"
 *   button (the autorun link whose estimate exceeded AUTO_RUN_MS).
 *
 * `etaMs` is null until the first estimate/progress lands. */
export interface BootstrapState {
  status: BootstrapStatus;
  replicates: number;
  seed: number;
  done: number;
  total: number;
  failed: number;
  etaMs: number | null;
  /** Measured cost of one replicate from the run's estimate (spec §5).
   * The replicate view routes through the worker when this tops ~2 s
   * (spec §6.5); null until an estimate lands. */
  msPerReplicate: number | null;
  support: Tree | null;
  consensus: Record<ConsensusKind, Tree> | null;
  dropped: Record<ConsensusKind, DroppedGroup[]> | null;
  view: BootstrapView;
  replicateIndex: number | null;
  settingsUsed: { replicates: number; seed: number } | null;
  jobId: number | null;
  cancelJobId: number | null;
  autorun: boolean;
  prefilledRun: boolean;
  error: NeoError | null;
}

/** The default bootstrap state (spec §6.1: 100 replicates, seed 1,
 * view "support"). */
export function defaultBootstrap(): BootstrapState {
  return {
    status: "idle",
    replicates: 100,
    seed: 1,
    done: 0,
    total: 0,
    failed: 0,
    etaMs: null,
    msPerReplicate: null,
    support: null,
    consensus: null,
    dropped: null,
    view: "support",
    replicateIndex: null,
    settingsUsed: null,
    jobId: null,
    cancelJobId: null,
    autorun: false,
    prefilledRun: false,
    error: null,
  };
}

/** Data/model changes discard bootstrap results and request a cancel
 * of any job in flight: its jobId moves to `cancelJobId`, which the
 * App effect turns into `client.cancel` (spec §6.1, §5). The user's
 * settings (replicates, seed, view) survive — they are preferences,
 * not results. */
export function clearBootstrap(s: Session): Session {
  const b = s.bootstrap;
  if (
    b.status === "idle" &&
    b.jobId === null &&
    b.cancelJobId === null &&
    b.support === null &&
    b.consensus === null &&
    b.settingsUsed === null &&
    !b.prefilledRun
  ) {
    return s; // nothing to clear — keep identity
  }
  return {
    ...s,
    bootstrap: {
      ...defaultBootstrap(),
      replicates: b.replicates,
      seed: b.seed,
      view: b.view,
      cancelJobId: b.jobId ?? b.cancelJobId,
    },
  };
}

/** The exercise's own bootstrap settings, if it declares them (v1.2
 * spec §7.1: files may include `bootstrap: { replicates, seed }` —
 * Task 14 adds the field to the `Exercise` type, so the block is read
 * defensively here). Invalid or missing fields fall back to the
 * `defaultBootstrap` values; the view is not part of the block. */
function exerciseBootstrap(e: Exercise): {
  replicates?: number;
  seed?: number;
} {
  const block = (e as { bootstrap?: unknown }).bootstrap;
  if (typeof block !== "object" || block === null) return {};
  const b = block as { replicates?: unknown; seed?: unknown };
  const out: { replicates?: number; seed?: number } = {};
  if (typeof b.replicates === "number" && Number.isFinite(b.replicates)) {
    out.replicates = Math.min(
      MAX_REPLICATES,
      Math.max(MIN_REPLICATES, Math.round(b.replicates)),
    );
  }
  if (typeof b.seed === "number" && Number.isFinite(b.seed)) {
    out.seed = Math.max(0, Math.round(b.seed));
  }
  return out;
}

/** A job-scoped message is honored only for the current job — or
 * adopted while an unassigned request (autorun; `jobId` still null)
 * waits in "estimating". `BootstrapClient` already drops stale
 * messages; this guard keeps the reducer safe when the client is
 * faked in tests. */
function jobCurrent(b: BootstrapState, jobId: number): boolean {
  if (b.jobId === jobId) return true;
  return b.jobId === null && b.status === "estimating";
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
  | { type: "exitSandbox" }
  // v1.2 Task 10: bootstrap run lifecycle (spec §5, §6.1).
  // `jobId` is the client-assigned id; when omitted (a `ran: true`
  // link), the first job message adopts its id.
  | { type: "bootstrapRequested"; jobId?: number; autorun?: boolean }
  | {
      type: "bootstrapEstimated";
      jobId: number;
      msPerReplicate: number;
      totalMs: number;
    }
  | { type: "bootstrapConfirmed"; jobId: number }
  | {
      type: "bootstrapProgress";
      jobId: number;
      done: number;
      total: number;
      failed: number;
      etaMs: number;
      support: Tree;
    }
  | { type: "bootstrapDone"; jobId: number; result: BootstrapResult }
  | { type: "bootstrapFailed"; jobId: number; error: NeoError }
  // v1.2 Task 11: the panel's Cancel button moves the current job into
  // `cancelJobId` for the page to cancel; `bootstrapCancelled` is the
  // page's ack. A jobId-scoped ack settles only that pending cancel —
  // a newer request may already be estimating in its place.
  | { type: "bootstrapCancelRequested" }
  | { type: "bootstrapCancelled"; jobId?: number }
  | {
      type: "setBootstrapSettings";
      patch: { replicates?: number; seed?: number };
    }
  | { type: "setBootstrapView"; view: BootstrapView }
  | { type: "setReplicateIndex"; index: number | null }
  | { type: "toggleRerootDisplay" };

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
        lessonExercise: a.exercise,
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
        bootstrap: {
          ...defaultBootstrap(),
          // v1.1 rule: nothing carries over between lessons, so
          // settings reset to the exercise's own `bootstrap` block
          // (spec §7.1; Task 14 adds it to the Exercise type) or the
          // defaults. Only sandbox data changes keep the user's
          // settings — `load` is not one of those paths. A running job
          // still asks the page for a cancel.
          ...exerciseBootstrap(a.exercise),
          cancelJobId: s.bootstrap.jobId ?? s.bootstrap.cancelJobId,
        },
        rerootDisplay: s.rerootDisplay,
        alignmentOrigin:
          a.exercise.data.kind === "embedded" ? "embedded" : "simulated",
      };
      // reconcileModels keeps a declared-alphabet exercise consistent
      // even when the file pairs it with a foreign model (the schema
      // validates this, so it is belt-and-braces for custom `#x=` links).
      // The lesson defines its models, so its silent switch is kept but
      // the notice is dropped: a notice is for user-driven changes —
      // setAlphabet and imports — not for loading a lesson (checkpoint
      // 13).
      const reconciled = { ...reconcileModels(base), notice: null };
      return error === null ? recompute(reconciled) : reconciled;
    }
    case "setSim": {
      // Simulation controls are inert unless the alignment is
      // re-simulatable — an imported alignment keeps the user's data
      // and an embedded alignment is fixed lesson data; otherwise the
      // patch is stored and recompute re-simulates.
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
              sim: { ...s.exercise.data.sim, ...a.patch },
            },
          },
        }),
      );
    }
    case "setAnalysis": {
      // Analysis inputs do not affect simulation, so keep the alignment.
      // Checkpoint 11: a stepper sitting at its final position lands on
      // the new tree's final position — re-analyzing at the end shows
      // the finished new tree (and its bootstrap panel) immediately.
      // Any earlier position still resets to step 0, and bootstrap
      // results clear either way (clearBootstrap → status idle).
      const prevMax = s.result?.trace ? traceLength(s.result.trace) : 0;
      const wasAtFinal = s.result !== null && s.step === prevMax;
      const next = recompute(
        clearBootstrap({
          ...s,
          notice: null,
          exercise: {
            ...s.exercise,
            analysis: { ...s.exercise.analysis, ...a.patch },
          },
        }),
      );
      if (!wasAtFinal) return next;
      // A traceless result (>50 taxa) is always at its final position.
      const nextMax = next.result?.trace ? traceLength(next.result.trace) : 0;
      return nextMax === 0 ? next : { ...next, step: nextMax };
    }
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
        clearBootstrap(
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
        ),
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
        clearBootstrap(
          reconcileModels({
            ...s,
            reference: { tree: a.tree, kind: "true", origin: "imported" },
            notice: null,
            alignment: null,
            alignmentOrigin,
            alphabet,
            source: "sandbox",
          }),
        ),
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
      return recompute(clearBootstrap({ ...s, branchScale: a.scale }));
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
      // Reload the current lesson from scratch: `lessonExercise`, the
      // exercise as loaded — sandbox setSim/setAnalysis/reconcile
      // changes live on `exercise` and must not carry back into lesson
      // mode (checkpoint 13). The fresh `prompts` array keeps the
      // prompt gate (which resets on the array's identity) forgetting
      // the student's picks.
      return reducer(s, {
        type: "load",
        exercise: {
          ...s.lessonExercise,
          prompts: [...s.lessonExercise.prompts],
        },
        source: "lesson",
      });
    // --- v1.2 Task 10: bootstrap lifecycle (spec §5, §6.1) ----------
    case "bootstrapRequested": {
      const b = s.bootstrap;
      return {
        ...s,
        bootstrap: {
          ...b,
          status: "estimating",
          jobId: a.jobId ?? null,
          // A superseded in-flight job is handed to the page to cancel
          // (client.start also cancels it — the request is idempotent).
          cancelJobId: b.jobId ?? b.cancelJobId,
          autorun: a.autorun ?? false,
          prefilledRun: false,
          done: 0,
          total: b.replicates,
          failed: 0,
          etaMs: null,
          msPerReplicate: null,
          support: null,
          consensus: null,
          dropped: null,
          error: null,
          settingsUsed: { replicates: b.replicates, seed: b.seed },
        },
      };
    }
    case "bootstrapEstimated": {
      const b = s.bootstrap;
      if (!jobCurrent(b, a.jobId)) return s;
      if (a.totalMs <= AUTO_RUN_MS) {
        // The client auto-confirms an under-budget run; it proceeds
        // to running (progress messages follow).
        return {
          ...s,
          bootstrap: {
            ...b,
            status: "running",
            jobId: a.jobId,
            autorun: false,
            etaMs: a.totalMs,
            msPerReplicate: a.msPerReplicate,
          },
        };
      }
      if (b.autorun) {
        // A `ran: true` link with an over-budget estimate never asks
        // the student to confirm: degrade to a prefilled Run button
        // (spec §6.1) and cancel the pending worker job.
        return {
          ...s,
          bootstrap: {
            ...b,
            status: "idle",
            jobId: null,
            cancelJobId: a.jobId,
            autorun: false,
            prefilledRun: true,
            etaMs: a.totalMs,
            msPerReplicate: a.msPerReplicate,
          },
        };
      }
      return {
        ...s,
        bootstrap: {
          ...b,
          status: "confirming",
          jobId: a.jobId,
          etaMs: a.totalMs,
          msPerReplicate: a.msPerReplicate,
        },
      };
    }
    case "bootstrapConfirmed": {
      const b = s.bootstrap;
      if (!jobCurrent(b, a.jobId)) return s;
      return {
        ...s,
        bootstrap: { ...b, status: "running", jobId: a.jobId, autorun: false },
      };
    }
    case "bootstrapProgress": {
      const b = s.bootstrap;
      if (!jobCurrent(b, a.jobId)) return s;
      return {
        ...s,
        bootstrap: {
          ...b,
          status: "running",
          jobId: a.jobId,
          autorun: false,
          done: a.done,
          total: a.total,
          failed: a.failed,
          etaMs: a.etaMs,
          support: a.support,
        },
      };
    }
    case "bootstrapDone": {
      const b = s.bootstrap;
      if (!jobCurrent(b, a.jobId)) return s;
      const r = a.result;
      return {
        ...s,
        bootstrap: {
          ...b,
          status: "done",
          jobId: null,
          autorun: false,
          done: r.tally.successful + r.failed,
          total: r.tally.successful + r.failed,
          failed: r.failed,
          etaMs: null,
          support: r.support,
          consensus: r.consensus,
          dropped: r.dropped,
          error: null,
        },
      };
    }
    case "bootstrapFailed": {
      const b = s.bootstrap;
      if (!jobCurrent(b, a.jobId)) return s;
      return {
        ...s,
        bootstrap: {
          ...b,
          status: "error",
          jobId: null,
          autorun: false,
          error: a.error,
        },
      };
    }
    case "bootstrapCancelRequested": {
      const b = s.bootstrap;
      const active =
        b.status === "estimating" ||
        b.status === "confirming" ||
        b.status === "running";
      if (!active) return s;
      return {
        ...s,
        bootstrap: {
          ...b,
          status: "cancelled",
          jobId: null,
          // The page cancels the job and acks with bootstrapCancelled.
          cancelJobId: b.jobId ?? b.cancelJobId,
          autorun: false,
          prefilledRun: false,
        },
      };
    }
    case "bootstrapCancelled": {
      const b = s.bootstrap;
      if (a.jobId !== undefined) {
        // Scoped ack: settles exactly the pending cancel it names. A
        // stale ack (the session moved on to a newer job) is ignored,
        // and it never touches another request's status or jobId.
        if (b.cancelJobId !== a.jobId) return s;
        return { ...s, bootstrap: { ...b, cancelJobId: null } };
      }
      const active =
        b.status === "estimating" ||
        b.status === "confirming" ||
        b.status === "running";
      return {
        ...s,
        bootstrap: {
          ...b,
          // An active run reports cancelled; an already-idle session
          // (the page's ack of a clear-on-change cancel, or a declined
          // autorun) keeps its status and the prefilled flag.
          status: active ? "cancelled" : b.status,
          jobId: null,
          cancelJobId: null,
          autorun: false,
        },
      };
    }
    case "setBootstrapSettings":
      // Settings changes never clear results — a finished run stays
      // visible and the panel labels it with `settingsUsed` (Review
      // Focus 3). Replicates clamp to the spec §3.8 range.
      return {
        ...s,
        bootstrap: {
          ...s.bootstrap,
          replicates:
            a.patch.replicates === undefined
              ? s.bootstrap.replicates
              : Math.min(
                  MAX_REPLICATES,
                  Math.max(MIN_REPLICATES, Math.round(a.patch.replicates)),
                ),
          seed:
            a.patch.seed === undefined
              ? s.bootstrap.seed
              : Math.max(0, Math.round(a.patch.seed)),
        },
      };
    case "setBootstrapView":
      return { ...s, bootstrap: { ...s.bootstrap, view: a.view } };
    case "setReplicateIndex":
      return { ...s, bootstrap: { ...s.bootstrap, replicateIndex: a.index } };
    case "toggleRerootDisplay":
      return { ...s, rerootDisplay: !s.rerootDisplay };
  }
}

/** A fresh session around `exercise`, before any pipeline has run.
 * Dispatch `load` to parse the exercise's data and simulate or embed. */
export function initialSession(exercise: Exercise): Session {
  return {
    exercise,
    lessonExercise: exercise,
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
    bootstrap: defaultBootstrap(),
    rerootDisplay: true,
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
