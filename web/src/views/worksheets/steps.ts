// Per-join context for the worksheet/key pages: a JoinFacts entry says
// WHICH step it is; the trace (already fetched by the page) says what
// the matrices looked like. This maps a 1-based join number to the
// labels and matrices the sheet prints — pure selection, no math.

import type { Matrix } from "../../engine/generated/Matrix";
import { nodeName } from "../../state/names";
import type { WorksheetRun } from "../../worksheets/build";

export interface JoinContext {
  /** Display names of the active clusters before this join. */
  active: string[];
  /** The step's distance matrix over `active` (row-major n×n). */
  distance: Matrix | null;
  /** NJ only: the step's Q matrix. UPGMA uses cluster averages — the
   * distance matrix — instead, so this stays null. */
  q: Matrix | null;
  /** UPGMA only: cluster sizes parallel to `active`. */
  sizes: number[] | null;
  /** NJ's final three-way join: [la, lb, lc] for the three remaining
   * clusters, or null for every ordinary join. */
  finalLens: [number, number, number] | null;
  /** UPGMA only: the new node's height, d(i, j) / 2. */
  height: number | null;
  /** Display name of the cluster this join creates (u1, u2, …). */
  newName: string;
}

/** The trace record for join `step` (1-based, matching
 * JoinFacts.step), with names resolved through the same `nodeName`
 * the stepper uses. */
export function joinContext(
  run: WorksheetRun,
  step: number,
): JoinContext {
  const tree = run.build.tree;
  const trace = run.trace;
  if (trace === null) {
    return {
      active: [],
      distance: null,
      q: null,
      sizes: null,
      finalLens: null,
      height: null,
      newName: `u${step}`,
    };
  }
  if ("Nj" in trace) {
    const idx = step - 1;
    if (idx < trace.Nj.steps.length) {
      const s = trace.Nj.steps[idx];
      return {
        active: s.active.map((id) => nodeName(tree, id)),
        distance: s.distance,
        q: s.q,
        sizes: null,
        finalLens: null,
        height: null,
        newName: nodeName(tree, s.new_node),
      };
    }
    const f = trace.Nj.final_join;
    return {
      active: [f.a, f.b, f.c].map((id) => nodeName(tree, id)),
      distance: f.distance,
      q: null,
      sizes: null,
      finalLens: [f.la, f.lb, f.lc],
      height: null,
      newName: nodeName(tree, tree.root),
    };
  }
  const s = trace.Upgma.steps[Math.min(step - 1, trace.Upgma.steps.length - 1)];
  return {
    active: s.active.map((id) => nodeName(tree, id)),
    distance: s.distance,
    q: null,
    sizes: s.sizes,
    finalLens: null,
    height: s.height,
    newName: nodeName(tree, s.new_node),
  };
}

/** The packed strict-lower-triangle values of a square `Matrix` —
 * index selection only, for the print tables. */
export function matrixLower(m: Matrix): number[] {
  const out: number[] = [];
  for (let i = 1; i < m.n; i += 1) {
    for (let j = 0; j < i; j += 1) out.push(m.data[i * m.n + j]);
  }
  return out;
}
