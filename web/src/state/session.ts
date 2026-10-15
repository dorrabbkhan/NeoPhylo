// Session state for the web app (plan Task 13, spec §6). The reducer is
// pure; every state change that affects the pipeline runs `recompute`,
// which drives sim → dist → build → rf through the engine wrapper and
// stores the first failure in `error` instead of throwing.

import { engine } from '../engine/index'

import type { Alignment } from '../engine/generated/Alignment'
import type { BuildResult } from '../engine/generated/BuildResult'
import type { DistanceMatrix } from '../engine/generated/DistanceMatrix'
import type { Exercise } from '../engine/generated/Exercise'
import type { NeoError } from '../engine/generated/NeoError'
import type { RfResult } from '../engine/generated/RfResult'
import type { Trace } from '../engine/generated/Trace'
import type { Tree } from '../engine/generated/Tree'

export interface Session {
  exercise: Exercise
  trueTree: Tree | null
  alignment: Alignment | null
  matrix: DistanceMatrix | null
  result: BuildResult | null
  rf: RfResult | null
  error: NeoError | null
  step: number // 0 = before first join; max = trace length
  mode: 'concept' | 'math'
  clampNegative: boolean
  matrixView: 'distance' | 'q'
  branchScale: number // default 1; multiplies true-tree lengths before simulate
  hover: { i: number; j: number } | null
  source: 'lesson' | 'sandbox'
}

export type Action =
  | { type: 'load'; exercise: Exercise; source: Session['source'] }
  | { type: 'setSim'; patch: Partial<Exercise['sim']> }
  | { type: 'setAnalysis'; patch: Partial<Exercise['analysis']> }
  | { type: 'importAlignment'; alignment: Alignment }
  | { type: 'importTree'; tree: Tree }
  | { type: 'step'; to: number }
  | { type: 'setMode'; mode: Session['mode'] }
  | { type: 'toggleClamp' }
  | { type: 'setMatrixView'; view: Session['matrixView'] }
  | { type: 'setBranchScale'; scale: number }
  | { type: 'hover'; cell: Session['hover'] }

/** Number of steps in a trace. NJ records the final three-way join
 * separately (spec §4.5 step 5 is part of the trace), so it counts one
 * extra position beyond `steps`. */
function traceLength(trace: Trace): number {
  return 'Nj' in trace ? trace.Nj.steps.length + 1 : trace.Upgma.steps.length
}

/** A copy of `tree` with every branch length multiplied by `scale`
 * (spec §6.2 TeachingNotices halves branch lengths via branchScale). */
function scaleTree(tree: Tree, scale: number): Tree {
  if (scale === 1) return tree
  return {
    ...tree,
    branches: tree.branches.map((b) => ({
      ...b,
      length: b.length === null ? null : b.length * scale,
    })),
  }
}

/**
 * Run the pipeline sim → dist → build → rf (spec §3.1) from the
 * session's current inputs. Stops at the first error and stores it in
 * `error`; never throws. Outputs upstream of the failure are kept (a
 * saturated matrix is still displayed, spec §6.3).
 *
 * An alignment that is already set (imported) is reused; `null` means
 * "simulate from the true tree". A trace is requested only when the
 * alignment has at most 50 taxa (Global Constraints).
 */
export function recompute(s: Session): Session {
  let alignment = s.alignment
  if (alignment === null) {
    if (s.trueTree === null) {
      return { ...s, matrix: null, result: null, rf: null, error: null, step: 0 }
    }
    const sim = engine.simulate(
      scaleTree(s.trueTree, s.branchScale),
      s.exercise.sim,
    )
    if (!sim.ok) {
      return {
        ...s,
        alignment: null,
        matrix: null,
        result: null,
        rf: null,
        error: sim.error,
        step: 0,
      }
    }
    alignment = sim.value
  }

  const dist = engine.distances(alignment, s.exercise.analysis.correction)
  if (!dist.ok) {
    return {
      ...s,
      alignment,
      matrix: null,
      result: null,
      rf: null,
      error: dist.error,
      step: 0,
    }
  }
  const matrix = dist.value

  const built = engine.buildTree(matrix, s.exercise.analysis.method, {
    trace: alignment.labels.length <= 50,
  })
  if (!built.ok) {
    return {
      ...s,
      alignment,
      matrix,
      result: null,
      rf: null,
      error: built.error,
      step: 0,
    }
  }
  const result = built.value

  let rf: RfResult | null = null
  if (s.trueTree !== null) {
    const cmp = engine.compare(s.trueTree, result.tree)
    if (!cmp.ok) {
      return { ...s, alignment, matrix, result, rf: null, error: cmp.error, step: 0 }
    }
    rf = cmp.value
  }

  return { ...s, alignment, matrix, result, rf, error: null, step: 0 }
}

/** `reducer` is pure: it returns a new `Session` and mutates nothing. */
export function reducer(s: Session, a: Action): Session {
  switch (a.type) {
    case 'load': {
      const parsed = engine.parseNewick(a.exercise.true_tree)
      const base: Session = {
        exercise: a.exercise,
        trueTree: parsed.ok ? parsed.value : null,
        alignment: null,
        matrix: null,
        result: null,
        rf: null,
        error: parsed.ok ? null : parsed.error,
        step: 0,
        mode: s.mode,
        clampNegative: s.clampNegative,
        matrixView: s.matrixView,
        branchScale: 1,
        hover: null,
        source: a.source,
      }
      return parsed.ok ? recompute(base) : base
    }
    case 'setSim':
      // Simulation inputs changed: drop any imported alignment so the
      // pipeline simulates again from the true tree.
      return recompute({
        ...s,
        exercise: { ...s.exercise, sim: { ...s.exercise.sim, ...a.patch } },
        alignment: null,
      })
    case 'setAnalysis':
      // Analysis inputs do not affect simulation, so keep the alignment.
      return recompute({
        ...s,
        exercise: {
          ...s.exercise,
          analysis: { ...s.exercise.analysis, ...a.patch },
        },
      })
    case 'importAlignment':
      return recompute({ ...s, alignment: a.alignment, source: 'sandbox' })
    case 'importTree':
      // The imported tree becomes the true tree and the alignment is
      // re-simulated along it (spec §3.1).
      return recompute({
        ...s,
        trueTree: a.tree,
        alignment: null,
        source: 'sandbox',
      })
    case 'step': {
      const max = s.result?.trace ? traceLength(s.result.trace) : 0
      return { ...s, step: Math.max(0, Math.min(a.to, max)) }
    }
    case 'setMode':
      return { ...s, mode: a.mode }
    case 'toggleClamp':
      return { ...s, clampNegative: !s.clampNegative }
    case 'setMatrixView':
      return { ...s, matrixView: a.view }
    case 'setBranchScale':
      // Scaling changes the simulated data, so re-run the pipeline.
      return recompute({ ...s, branchScale: a.scale, alignment: null })
    case 'hover':
      return { ...s, hover: a.cell }
  }
}
