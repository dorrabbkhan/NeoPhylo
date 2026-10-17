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
// - The heatmap shows the active clusters' pre-join matrix at step k
//   (trace.steps[k].distance or .q), labelled by nodeName (stepMatrix.ts);
//   NJ's final position shows final_join.distance, the stored 3×3 matrix.
//
// Hover sync (spec §6.2): a matrix cell highlights its two clusters in
// both trees; a hovered leaf highlights its matrix row and column.
// `Session.hover` stores the matrix cell; the hovered leaf label is
// local App state.
//
// Guided lessons (Task 21, spec §6.2): a predict_pair prompt with
// at_step = s gates stepper position s-1 — the position where join s is
// the pending join — until the student picks a matrix cell or two
// leaves. While the question is open the correct pair is NOT marked
// (no aria-selected cell, no tree highlight), so the prediction is
// genuine; the pick reveals "Correct" or the right pair, then stepping
// resumes. Pick state lives in `answered` (at_step → picked labels) and
// resets whenever a different exercise is loaded.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { REPO_URL } from "../config";
import { initEngine } from "../engine";
import type { Exercise } from "../engine/generated/Exercise";
import { errorMessage } from "../explain/errors";
import { usePromptGate } from "../lessons/promptGate";
import type { Action, Session } from "../state/session";
import {
  exerciseSim,
  hasImportedData,
  initialSession,
  reducer,
} from "../state/session";
import { encode } from "../state/url";
import {
  applyUrlState,
  resolveInitial,
  sessionUrlState,
  type LinkKind,
} from "../state/urlRestore";

import { Controls } from "./Controls";
import { ExportMenu } from "./ExportMenu";
import { ExplanationPanel } from "./ExplanationPanel";
import { ImportPanel } from "./ImportPanel";
import { MatrixHeatmap } from "./MatrixHeatmap";
import { PromptCard } from "./PromptCard";
import {
  leafCount,
  leafIdByLabel,
  leafLabelSets,
  stepEmphasis,
} from "./stepEmphasis";
import { Stepper } from "./Stepper";
import { stepMatrix, traceLength } from "./stepMatrix";
import { TeachingNotices } from "./TeachingNotices";
import { leafSpacingFor, TREE_CAPTION_H } from "../layout/treePanel";
import { TreeView } from "./TreeView";
import { nodeName } from "../state/names";

const NO_HIGHLIGHT = new Set<number>();

export function App({ exercise }: { exercise?: Exercise }) {
  const [session, setSession] = useState<Session | null>(null);
  const [playing, setPlaying] = useState(false);
  const [hoverLeaf, setHoverLeaf] = useState<string | null>(null);
  const [link, setLink] = useState<LinkKind>({ kind: "custom" });
  const [toast, setToast] = useState<string | null>(null);

  // Height of the side-by-side tree row, measured once for both panels
  // so they share one leafSpacing and their rows line up (§6.1). The
  // callback ref attaches the observer when .trees mounts — a mount-time
  // effect would run while the loading placeholder is rendered instead.
  const [treesHeight, setTreesHeight] = useState(0);
  const treesRef = useCallback((el: HTMLDivElement | null) => {
    if (el === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      setTreesHeight(entries[0].contentRect.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const dispatch = useCallback(
    (a: Action) => setSession((s) => (s === null ? s : reducer(s, a))),
    [],
  );

  // Restore from the URL once per exercise change (spec §6.4): the URL
  // may supply a custom exercise (`#x=`), a lesson id (`?lesson=`), or
  // nothing; a failed decode toasts and falls back to the default
  // lesson. Helpers live in src/state/urlRestore.ts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      await initEngine();
      const r = await resolveInitial(exercise ?? null);
      if (cancelled) return;
      setPlaying(false);
      setHoverLeaf(null);
      setLink(r.link);
      if (r.toast) {
        setToast("This link couldn't be opened — showing the default lesson.");
      }
      if (r.exercise === null) {
        setSession(null);
        return;
      }
      let s = reducer(initialSession(r.exercise), {
        type: "load",
        exercise: r.exercise,
        source: "lesson",
      });
      if (r.fromUrl !== null) s = applyUrlState(s, r.fromUrl);
      setSession(s);
    })();
    return () => {
      cancelled = true;
    };
  }, [exercise]);

  // Sync the URL on every state change with replaceState (spec §6.4):
  // reloads and shared links land on exactly this view.
  useEffect(() => {
    if (session === null) return;
    history.replaceState(null, "", encode(sessionUrlState(session, link)));
  }, [session, link]);

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

  // The header's Lesson|Sandbox switch. Entering sandbox keeps the
  // current pipeline outputs so nothing jumps; leaving reloads the
  // lesson and first asks when imported data would be lost.
  const onSelectMode = useCallback(
    (mode: Session["source"]) => {
      if (session === null || mode === session.source) return;
      if (mode === "sandbox") {
        dispatch({ type: "enterSandbox" });
        return;
      }
      if (
        hasImportedData(session) &&
        !window.confirm("Leave sandbox? Your imported data will be cleared.")
      ) {
        return;
      }
      dispatch({ type: "exitSandbox" });
    },
    [dispatch, session],
  );

  const inferred = session?.result?.tree ?? null;
  const trace = session?.result?.trace ?? null;
  const referenceTree = session?.reference?.tree ?? null;
  const inferSets = useMemo(
    () => (inferred ? leafLabelSets(inferred) : new Map<number, Set<string>>()),
    [inferred],
  );
  const inferLeafByLabel = useMemo(
    () => (inferred ? leafIdByLabel(inferred) : new Map<string, number>()),
    [inferred],
  );
  // Display names indexed by NodeId for the explanation panel: leaf
  // labels first, then u1, u2, … in creation order (state/names.ts).
  const explainLabels = useMemo(
    () =>
      inferred ? inferred.nodes.map((_, id) => nodeName(inferred, id)) : [],
    [inferred],
  );
  const referenceLeafByLabel = useMemo(
    () =>
      referenceTree ? leafIdByLabel(referenceTree) : new Map<string, number>(),
    [referenceTree],
  );

  // The stepper position and its heatmap must exist before the
  // usePromptGate hook call — hooks run even while session is null.
  const k = session?.step ?? 0;
  const sm = stepMatrix({
    trace,
    step: k,
    matrix: session?.matrix ?? null,
    matrixView: session?.matrixView ?? "distance",
    inferred,
  });
  const promptGate = usePromptGate({
    prompts: session?.exercise.prompts,
    position: k,
    lessonMode: session?.source === "lesson",
    sm,
    leafSets: inferSets,
  });

  // Focus rescue (§6.5): landing on a gated position disables the
  // stepper control under focus and the browser drops focus to <body>;
  // in WebKit the Tab ring can't re-enter from there at all. On the
  // transition into a gated position, dead focus moves to the matrix's
  // roving cell — where the prompt asks the student to pick. A gated
  // initial position is left alone (body is a valid ring start) and
  // live focus elsewhere is never stolen.
  const gatedNow = promptGate.gating !== null;
  const wasGated = useRef(gatedNow);
  useEffect(() => {
    const justGated = gatedNow && !wasGated.current;
    wasGated.current = gatedNow;
    if (!justGated || document.activeElement !== document.body) return;
    document
      .querySelector<SVGGElement>('[role="gridcell"][tabindex="0"]')
      ?.focus();
  }, [gatedNow]);

  if (session === null) {
    return <div className="app-loading">Loading…</div>;
  }

  const n = trace !== null ? traceLength(trace) : 0;
  const isNj = trace !== null && "Nj" in trace;
  const nLeaf = inferred ? leafCount(inferred) : 0;

  // Shared leaf spacing for both trees: the row height minus the
  // caption, divided by the leaf count, clamped to 18–48 px.
  const sharedSpacing = leafSpacingFor(
    treesHeight - TREE_CAPTION_H,
    Math.max(nLeaf, referenceTree !== null ? leafCount(referenceTree) : 0),
  );

  // Unpack the prompt gate (src/lessons/promptGate.ts): gating hides the
  // correct pair from the heatmap and the tree highlights.
  const { shown: shownPrompts, gating, smShown, answerPair } = promptGate;

  // Everything the views emphasize at step k (src/views/stepEmphasis.ts).
  const { inferHi, trueHi, wrong, visibleNodes, matrixHover } = stepEmphasis({
    trace,
    k,
    inferred,
    sm,
    smShown,
    inferSets,
    inferLeafByLabel,
    trueLeafByLabel: referenceLeafByLabel,
    matrix: session.matrix,
    cellHover: session.hover,
    hoverLeaf,
    leafPick: promptGate.leafPick,
    rf: session.rf,
    taxa: session.alignment?.labels ?? null,
  });

  const rfText =
    session.rf !== null ? `${session.rf.rf} / ${session.rf.max_rf}` : null;

  // Center-column error banner. SaturatedMatrix is covered by the §6.3
  // teaching notice; in sandbox mode pipeline errors are shown under the
  // import box instead.
  const banner =
    session.error !== null &&
    session.error.kind !== "SaturatedMatrix" &&
    session.source !== "sandbox"
      ? errorMessage(session.error)
      : null;

  // Traces are requested only for alignments of at most 50 taxa
  // (Global Constraints); above that the stepper is replaced by a note.
  const tooManyForSteps =
    (session.alignment?.labels.length ?? 0) > 50 ||
    (session.matrix?.labels.length ?? 0) > 50;

  return (
    <div className="app">
      <header className="app-header">
        <h1>{session.exercise.title}</h1>
        {toast !== null && (
          <p role="status" className="toast">
            {toast}
          </p>
        )}
        <div className="mode-switch" role="radiogroup" aria-label="Mode">
          <button
            type="button"
            role="radio"
            aria-checked={session.source === "lesson"}
            onClick={() => onSelectMode("lesson")}
          >
            Lesson
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={session.source === "sandbox"}
            onClick={() => onSelectMode("sandbox")}
          >
            Sandbox
          </button>
        </div>
      </header>
      <main className="app-grid">
        <aside className="col-controls" aria-label="Controls">
          <Controls
            sim={exerciseSim(session.exercise)}
            analysis={session.exercise.analysis}
            locked={session.source === "sandbox" ? [] : session.exercise.locked}
            matrixView={session.matrixView}
            qAvailable={isNj && trace !== null}
            simEnabled={session.alignmentOrigin === "simulated"}
            dispatch={dispatch}
          />
          {session.source === "sandbox" && (
            <ImportPanel session={session} dispatch={dispatch} />
          )}
          <ExportMenu
            tree={inferred}
            alignment={session.alignment}
            correction={session.exercise.analysis.correction}
            method={session.exercise.analysis.method}
            clampNegative={session.clampNegative}
          />
        </aside>
        <section className="col-center">
          <div className="notices">
            {banner !== null && (
              <p role="alert" className="error">
                <strong>{banner.title}</strong> {banner.body}
              </p>
            )}
            <TeachingNotices session={session} dispatch={dispatch} />
          </div>
          {shownPrompts.length > 0 && (
            <div className="prompts">
              {shownPrompts.map((p) => (
                <PromptCard
                  key={p.at_step}
                  prompt={p}
                  mode={session.mode}
                  picked={promptGate.picked(p.at_step)}
                  answer={answerPair}
                />
              ))}
            </div>
          )}
          <div className="trees" ref={treesRef}>
            {referenceTree === null && (
              <p className="no-true-tree">
                No true tree — import a Newick tree to compare
              </p>
            )}
            {referenceTree !== null && (
              <TreeView
                title="True tree"
                tree={referenceTree}
                layoutKind="phylogram"
                highlight={trueHi}
                wrong={NO_HIGHLIGHT}
                clampNegative={session.clampNegative}
                leafSpacing={sharedSpacing}
                onHoverLeaf={onHoverLeaf}
                onPickLeaf={gating !== null ? promptGate.onPickLeaf : undefined}
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
                leafSpacing={sharedSpacing}
                onHoverLeaf={onHoverLeaf}
                onPickLeaf={gating !== null ? promptGate.onPickLeaf : undefined}
              />
            )}
          </div>
          {smShown !== null && (
            <MatrixHeatmap
              labels={smShown.labels}
              values={smShown.values}
              view={smShown.view}
              chosen={smShown.chosen}
              hover={matrixHover}
              onHover={onHoverCell}
              onPick={gating !== null ? promptGate.onPickCell : undefined}
            />
          )}
        </section>
        <aside className="col-explain" aria-label="Explanation">
          <ExplanationPanel
            trace={trace}
            step={k}
            labels={explainLabels}
            mode={session.mode}
            dispatch={dispatch}
          />
        </aside>
      </main>
      <footer className="app-footer">
        {session.result !== null && trace !== null && (
          <Stepper
            step={k}
            max={n}
            rfText={rfText}
            noTrueTree={session.reference === null}
            playing={playing}
            onStep={onStep}
            onPlayToggle={onPlayToggle}
            gated={gating !== null}
          />
        )}
        {tooManyForSteps && (
          <p className="stepper-note">
            Step-through is available for 50 taxa or fewer
          </p>
        )}
        <a className="repo-link" href={REPO_URL}>
          Source code (AGPL-3.0)
        </a>
      </footer>
    </div>
  );
}
