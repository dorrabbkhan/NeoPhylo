// Application shell (plan Task 17, spec §6.1-6.3). Three-column CSS grid —
// Controls | True+Inferred trees over the distance/Q heatmap | Explanation
// (placeholder until Task 18) — with the stepper bar along the bottom.
//
// Stepping model (per the task's Produces list):
// - Step k shows leaves plus the internal nodes created by steps 1..k.
//   NJ's central node appears only at the final position (k = N).
// - The highlighted pair at step k is the `chosen` pair of the next join
//   (trace step k+1); at the end it is the last join — NJ's three-way
//   final join highlights all three nodes and no single matrix cell.
// - In distance view a `chosen` cell is marked only while both chosen
//   nodes are still leaves; clusters have no single taxon cell.
// - The Q heatmap shows the matrix recorded *before* join k+1, i.e.
//   trace.steps[k].q, labelled by the active clusters' display names.
//
// Hover sync (spec §6.2): a matrix cell highlights its two taxa (or, in Q
// view, its two clusters) in both trees; a hovered leaf highlights its
// matrix row and column. `Session.hover` stores the matrix cell; the
// hovered leaf label is local App state.

import { useCallback, useEffect, useMemo, useState } from "react";

import { engine, initEngine } from "../engine";
import type { Exercise } from "../engine/generated/Exercise";
import type { NeoError } from "../engine/generated/NeoError";
import type { NjStep } from "../engine/generated/NjStep";
import type { Trace } from "../engine/generated/Trace";
import type { Tree } from "../engine/generated/Tree";
import type { UpgmaStep } from "../engine/generated/UpgmaStep";
import { defaultLessonJson } from "../lessons/default";
import { nodeName } from "../state/names";
import type { Action, Session } from "../state/session";
import { initialSession, reducer } from "../state/session";

import { Controls } from "./Controls";
import { MatrixHeatmap } from "./MatrixHeatmap";
import type { MatrixCell } from "./MatrixHeatmap";
import { Stepper } from "./Stepper";
import { TreeView } from "./TreeView";

/** Steps are 1-based joins; NJ records the final three-way join as one
 * extra position beyond `steps` (mirrors session.ts traceLength). */
function traceLength(trace: Trace): number {
  return "Nj" in trace ? trace.Nj.steps.length + 1 : trace.Upgma.steps.length;
}

function stepsOf(trace: Trace): (NjStep | UpgmaStep)[] {
  return "Nj" in trace ? trace.Nj.steps : trace.Upgma.steps;
}

/** Map of every node id to the set of leaf labels under it. */
function leafLabelSets(tree: Tree): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  const dfs = (id: number): Set<string> => {
    const cached = out.get(id);
    if (cached) return cached;
    const s = new Set<string>();
    const node = tree.nodes[id];
    if (node.children.length === 0 && node.label !== null) s.add(node.label);
    for (const c of node.children) for (const l of dfs(c)) s.add(l);
    out.set(id, s);
    return s;
  };
  dfs(tree.root);
  return out;
}

/** Leaf node ids by taxon label (labels are unique per alignment/tree). */
function leafIdByLabel(tree: Tree): Map<string, number> {
  const out = new Map<string, number>();
  tree.nodes.forEach((n, id) => {
    if (n.children.length === 0 && n.label !== null) out.set(n.label, id);
  });
  return out;
}

function sameSet<T>(a: Set<T>, b: Set<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

function leafCount(tree: Tree): number {
  return tree.nodes.reduce(
    (n, node) => n + (node.children.length === 0 ? 1 : 0),
    0,
  );
}

function errorText(e: NeoError): string {
  switch (e.kind) {
    case "TooFewTaxa":
      return `At least ${e.min} taxa are needed to build a tree (got ${e.got}).`;
    case "TooManyTaxa":
      return `At most ${e.max} taxa are supported (got ${e.got}).`;
    case "SaturatedMatrix":
      return `Some distances could not be estimated (saturation). Try longer sequences or shorter branches.`;
    case "Parse":
      return `Parse error at line ${e.line}: ${e.msg}`;
    case "InvalidExercise":
      return `Invalid exercise field "${e.field}": ${e.msg}`;
    default:
      return e.kind;
  }
}

const NO_HIGHLIGHT = new Set<number>();
const NO_LABELS: Set<string> = new Set();

export function App({ exercise }: { exercise?: Exercise }) {
  const [session, setSession] = useState<Session | null>(null);
  const [playing, setPlaying] = useState(false);
  const [hoverLeaf, setHoverLeaf] = useState<string | null>(null);

  const dispatch = useCallback(
    (a: Action) => setSession((s) => (s === null ? s : reducer(s, a))),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await initEngine();
      let ex = exercise ?? null;
      if (ex === null) {
        const r = engine.loadExercise(defaultLessonJson);
        ex = r.ok ? r.value : null;
      }
      if (cancelled) return;
      setPlaying(false);
      setHoverLeaf(null);
      if (ex === null) {
        setSession(null);
        return;
      }
      setSession(
        reducer(initialSession(ex), {
          type: "load",
          exercise: ex,
          source: "lesson",
        }),
      );
    })();
    return () => {
      cancelled = true;
    };
  }, [exercise]);

  const onStep = useCallback(
    (to: number) => dispatch({ type: "step", to }),
    [dispatch],
  );
  const onPlayToggle = useCallback(() => setPlaying((p) => !p), []);
  const onHoverCell = useCallback(
    (cell: { i: number; j: number } | null) => {
      setHoverLeaf(null);
      dispatch({ type: "hover", cell });
    },
    [dispatch],
  );
  const onHoverLeaf = useCallback(
    (label: string | null) => {
      setHoverLeaf(label);
      if (label !== null) dispatch({ type: "hover", cell: null });
    },
    [dispatch],
  );

  const inferred = session?.result?.tree ?? null;
  const trace = session?.result?.trace ?? null;
  const trueTree = session?.trueTree ?? null;
  const steps = useMemo(() => (trace ? stepsOf(trace) : []), [trace]);
  const inferSets = useMemo(
    () => (inferred ? leafLabelSets(inferred) : new Map<number, Set<string>>()),
    [inferred],
  );
  const inferLeafByLabel = useMemo(
    () => (inferred ? leafIdByLabel(inferred) : new Map<string, number>()),
    [inferred],
  );
  const trueLeafByLabel = useMemo(
    () => (trueTree ? leafIdByLabel(trueTree) : new Map<string, number>()),
    [trueTree],
  );

  if (session === null) {
    return <div className="app-loading">Loading…</div>;
  }

  const n = trace !== null ? traceLength(trace) : 0;
  const k = session.step;
  const isNj = trace !== null && "Nj" in trace;
  const nLeaf = inferred ? leafCount(inferred) : 0;

  // The trace record shown in views at step k: the join about to happen,
  // or the last join once the trace is exhausted.
  const displayStep =
    steps.length === 0
      ? null
      : k < steps.length
        ? steps[k]
        : steps[steps.length - 1];
  const qActive =
    session.matrixView === "q" && displayStep !== null && "q" in displayStep;

  // Highlighted nodes for the inferred tree: the next (or last) join plus
  // whatever the pointer is over.
  const chosenNodes: number[] = [];
  let chosenCell: [number, number] | null = null;
  if (isNj && k >= steps.length) {
    // NJ's final three-way join: no single pair, highlight all three.
    const f = trace!.Nj.final_join;
    chosenNodes.push(f.a, f.b, f.c);
  } else if (displayStep !== null) {
    const [ci, cj] = displayStep.chosen;
    const a = displayStep.active[ci];
    const b = displayStep.active[cj];
    chosenNodes.push(a, b);
    if (qActive) chosenCell = [ci, cj];
    else if (a < nLeaf && b < nLeaf) chosenCell = [a, b];
  }

  const inferHi = new Set<number>(chosenNodes);
  const trueHi = new Set<number>();
  // Emphasize the chosen pair's member taxa in the true tree too (§6.2:
  // "the chosen pair is emphasized in every view").
  for (const id of chosenNodes) {
    for (const label of inferSets.get(id) ?? NO_LABELS) {
      const t = trueLeafByLabel.get(label);
      if (t !== undefined) trueHi.add(t);
    }
  }

  // Hover: a matrix cell highlights its pair in both trees; the meaning of
  // the cell indices depends on the current view.
  const cellHover = session.hover;
  if (cellHover !== null && !qActive && session.matrix !== null) {
    for (const idx of [cellHover.i, cellHover.j]) {
      const label = session.matrix.labels[idx];
      if (label === undefined) continue;
      const fi = inferLeafByLabel.get(label);
      const ft = trueLeafByLabel.get(label);
      if (fi !== undefined) inferHi.add(fi);
      if (ft !== undefined) trueHi.add(ft);
    }
  } else if (cellHover !== null && qActive && displayStep !== null) {
    for (const idx of [cellHover.i, cellHover.j]) {
      const id = displayStep.active[idx];
      if (id === undefined) continue;
      inferHi.add(id);
      for (const label of inferSets.get(id) ?? NO_LABELS) {
        const ft = trueLeafByLabel.get(label);
        if (ft !== undefined) trueHi.add(ft);
      }
    }
  }
  if (hoverLeaf !== null) {
    const fi = inferLeafByLabel.get(hoverLeaf);
    const ft = trueLeafByLabel.get(hoverLeaf);
    if (fi !== undefined) inferHi.add(fi);
    if (ft !== undefined) trueHi.add(ft);
  }

  // Visible nodes at step k: leaves plus nodes created by steps 1..k
  // (NJ's central node only at the final position).
  let visibleNodes: Set<number> | undefined;
  if (inferred !== null && trace !== null) {
    visibleNodes = new Set<number>();
    for (let id = 0; id < nLeaf; id++) visibleNodes.add(id);
    for (let i = 0; i < k && i < steps.length; i++) {
      visibleNodes.add(steps[i].new_node);
    }
    if (isNj && k === n) visibleNodes.add(inferred.root);
  }

  // Clades of the inferred tree absent from the true tree (rf extra splits).
  const wrong = new Set<number>();
  if (inferred !== null && session.rf !== null && session.alignment !== null) {
    const all = new Set(session.alignment.labels);
    for (const split of session.rf.extra_in_inferred) {
      const side = new Set(split.side);
      const complement = new Set([...all].filter((l) => !side.has(l)));
      for (const [id, labs] of inferSets) {
        if (inferred.nodes[id].children.length === 0) continue;
        if (sameSet(labs, side) || sameSet(labs, complement)) wrong.add(id);
      }
    }
  }

  // Leaf hover → highlight that leaf's matrix row and column.
  let matrixHover: { i: number; j: number } | { axis: number } | null =
    cellHover;
  if (hoverLeaf !== null) {
    matrixHover = null;
    if (qActive && displayStep !== null) {
      const idx = displayStep.active.findIndex((id) =>
        inferSets.get(id)?.has(hoverLeaf),
      );
      if (idx >= 0) matrixHover = { axis: idx };
    } else if (session.matrix !== null) {
      const idx = session.matrix.labels.indexOf(hoverLeaf);
      if (idx >= 0) matrixHover = { axis: idx };
    }
  }

  const matrixValues: MatrixCell[] = qActive
    ? (displayStep as NjStep).q.data
    : (session.matrix?.cells.map((c) =>
        c === "Saturated" ? "sat" : c.Value,
      ) ?? []);
  const matrixLabels = qActive
    ? (displayStep as NjStep).active.map((id) => nodeName(inferred!, id))
    : (session.matrix?.labels ?? []);

  const rfText =
    session.rf !== null ? `${session.rf.rf} / ${session.rf.max_rf}` : null;

  // Traces are requested only for alignments of at most 50 taxa
  // (Global Constraints); above that the stepper is replaced by a note.
  const tooManyForSteps =
    (session.alignment?.labels.length ?? 0) > 50 ||
    (session.matrix?.labels.length ?? 0) > 50;

  return (
    <div className="app">
      <header className="app-header">
        <h1>{session.exercise.title}</h1>
      </header>
      <main className="app-grid">
        <aside className="col-controls" aria-label="Controls">
          <Controls
            sim={session.exercise.sim}
            analysis={session.exercise.analysis}
            locked={session.exercise.locked}
            matrixView={session.matrixView}
            qAvailable={isNj && trace !== null}
            simEnabled={session.alignmentOrigin === "simulated"}
            dispatch={dispatch}
          />
        </aside>
        <section className="col-center">
          {session.error !== null && (
            <p role="alert" className="error">
              {errorText(session.error)}
            </p>
          )}
          <div className="trees">
            {trueTree !== null && (
              <TreeView
                title="True tree"
                tree={trueTree}
                layoutKind="phylogram"
                highlight={trueHi}
                wrong={NO_HIGHLIGHT}
                clampNegative={session.clampNegative}
                onHoverLeaf={onHoverLeaf}
              />
            )}
            {inferred !== null && (
              <TreeView
                title="Inferred tree"
                tree={inferred}
                layoutKind="phylogram"
                highlight={inferHi}
                wrong={wrong}
                clampNegative={session.clampNegative}
                visibleNodes={visibleNodes}
                onHoverLeaf={onHoverLeaf}
              />
            )}
          </div>
          {session.matrix !== null && (
            <MatrixHeatmap
              labels={matrixLabels}
              values={matrixValues}
              view={qActive ? "q" : "distance"}
              chosen={chosenCell}
              hover={matrixHover}
              onHover={onHoverCell}
            />
          )}
        </section>
        <aside className="col-explain" aria-label="Explanation">
          {/* ExplanationPanel arrives in Task 18. */}
        </aside>
      </main>
      <footer className="app-footer">
        {session.result !== null && trace !== null && (
          <Stepper
            step={k}
            max={n}
            rfText={rfText}
            playing={playing}
            onStep={onStep}
            onPlayToggle={onPlayToggle}
          />
        )}
        {tooManyForSteps && (
          <p className="stepper-note">
            Step-through is available for 50 taxa or fewer
          </p>
        )}
      </footer>
    </div>
  );
}
