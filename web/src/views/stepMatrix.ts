// Which matrix the heatmap shows at step k (spec §6.2: all panels stay in
// sync with the step). Pure selection over the stored trace — no distances
// are ever computed in TypeScript.
//
// At step k the join under discussion is steps[k] (the *next* join), so
// both the distance and Q heatmaps show that step's pre-join matrices,
// labeled by the active clusters' display names (state/names.ts). Once the
// trace is exhausted — including NJ's final three-way join, which stores
// no matrix — the last stored step's matrix stays on screen.

import type { DistanceMatrix } from "../engine/generated/DistanceMatrix";
import type { NjStep } from "../engine/generated/NjStep";
import type { Trace } from "../engine/generated/Trace";
import type { Tree } from "../engine/generated/Tree";
import type { UpgmaStep } from "../engine/generated/UpgmaStep";
import { nodeName } from "../state/names";

import type { MatrixCell } from "./MatrixHeatmap";

/** Steps are 1-based joins; NJ records the final three-way join as one
 * extra position beyond `steps` (mirrors session.ts traceLength). */
export function traceLength(trace: Trace): number {
  return "Nj" in trace ? trace.Nj.steps.length + 1 : trace.Upgma.steps.length;
}

export function stepsOf(trace: Trace): (NjStep | UpgmaStep)[] {
  return "Nj" in trace ? trace.Nj.steps : trace.Upgma.steps;
}

/** The trace record shown at step k: the join about to happen, or the
 * last join once the trace is exhausted (NJ's final three-way join has no
 * stored step, so the last pairwise join stays displayed). */
export function stepFor(trace: Trace, k: number): NjStep | UpgmaStep | null {
  const steps = stepsOf(trace);
  if (steps.length === 0) return null;
  return k < steps.length ? steps[k] : steps[steps.length - 1];
}

/** Everything MatrixHeatmap needs for one step position. */
export interface StepMatrix {
  /** Cluster display names, parallel to `active`/`values`. */
  labels: string[];
  /** Row-major cell values ("sat" for saturated distances). */
  values: MatrixCell[];
  view: "distance" | "q";
  /** The joining pair as [i, j] indices into `labels`, or null when the
   * position has no single pair (NJ's final three-way join; no trace). */
  chosen: [number, number] | null;
  /** Tree node ids of the shown clusters, parallel to `labels`; null when
   * the fallback full distance matrix (no trace) is shown — the labels are
   * then taxon names, not cluster names. */
  active: number[] | null;
}

/**
 * The matrix on screen at `step`.
 *
 * With a trace: the current step's `distance` (or `q` when the NJ Q view
 * is on), labeled by `nodeName` of the step's active clusters — leaves
 * show taxon names, joined clusters show u1, u2, …. The chosen pair is
 * returned as indices into `labels`; it is null at NJ's final position
 * (three-way join, no pair).
 *
 * Without a trace (>50 taxa, so step-through is off): the full leaf
 * distance matrix with taxon labels, nothing marked.
 */
export function stepMatrix({
  trace,
  step,
  matrix,
  matrixView,
  inferred,
}: {
  trace: Trace | null;
  step: number;
  matrix: DistanceMatrix | null;
  matrixView: "distance" | "q";
  inferred: Tree | null;
}): StepMatrix | null {
  if (trace !== null && inferred !== null) {
    const s = stepFor(trace, step);
    if (s !== null) {
      const q = matrixView === "q" && "q" in s;
      const isNjEnd = "Nj" in trace && step >= trace.Nj.steps.length;
      return {
        labels: s.active.map((id) => nodeName(inferred, id)),
        values: q ? s.q.data : s.distance.data,
        view: q ? "q" : "distance",
        chosen: isNjEnd ? null : s.chosen,
        active: [...s.active],
      };
    }
  }
  if (matrix === null) return null;
  return {
    labels: matrix.labels,
    values: matrix.cells.map((c) => (c === "Saturated" ? "sat" : c.Value)),
    view: "distance",
    chosen: null,
    active: null,
  };
}
