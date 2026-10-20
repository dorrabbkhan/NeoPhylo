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
import { bootstrapClient } from "../engine/bootstrapClient";
import { engine, initEngine } from "../engine";
import type { Exercise } from "../engine/generated/Exercise";
import { errorMessage } from "../explain/errors";
import { loadLesson } from "../lessons/loader";
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

import { AlphabetBadge } from "./AlphabetBadge";
import { BootstrapPanel } from "./BootstrapPanel";
import { Controls } from "./Controls";
import { ExportMenu } from "./ExportMenu";
import { ExplanationPanel } from "./ExplanationPanel";
import { ImportPanel } from "./ImportPanel";
import { LessonsMenu } from "./LessonsMenu";
import { MatrixHeatmap } from "./MatrixHeatmap";
import { PairPanel } from "./PairPanel";
import { PhylipHelp } from "./PhylipHelp";
import { PromptCard } from "./PromptCard";
import {
  leafCount,
  leafIdByLabel,
  leafLabelSets,
  stepEmphasis,
} from "./stepEmphasis";
import { Stepper } from "./Stepper";
import { stepMatrix, traceLength } from "./stepMatrix";
import type { StepMatrix } from "./stepMatrix";
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
  // The open pair panel's sequences, stored as the picked cell's labels
  // (v1.1 spec §5.2): only cells whose labels are still taxon names —
  // not joined clusters u1, u2, … — resolve to alignment sequences.
  const [pair, setPair] = useState<[string, string] | null>(null);
  // "Coming from PHYLIP?" help dialog, opened from the header (§5.5).
  const [phylipHelp, setPhylipHelp] = useState(false);

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
      setPair(null);
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

  // Bootstrap job driver (v1.2 Task 11, spec §5). The session records
  // intent — `estimating` with no bound jobId is a start request,
  // `cancelJobId` asks the page to cancel that job, `confirming` waits
  // on the Start button — and this effect is the only page code that
  // talks to the shared `bootstrapClient` singleton. There is never a
  // second client or worker.
  const startedFor = useRef<object | null>(null);
  const pendingBind = useRef<number | null>(null);
  const confirmAwaiting = useRef<number | null>(null);
  const cancelsInFlight = useRef(new Set<number>());
  useEffect(() => {
    if (session === null) return;
    const b = session.bootstrap;

    // A job whose bind the session never adopted (the request was
    // superseded or cancelled between start and bind) is cancelled
    // here so no orphaned worker job survives.
    const pending = pendingBind.current;
    if (pending !== null) {
      pendingBind.current = null;
      const accepted =
        (b.status === "estimating" ||
          b.status === "confirming" ||
          b.status === "running") &&
        b.jobId === pending;
      if (!accepted) void bootstrapClient.cancel(pending);
    }

    // A confirming→running move is the Start button: the parked worker
    // job resumes when the client forwards `confirm` (spec §5).
    if (b.status === "confirming") confirmAwaiting.current = b.jobId;
    if (
      b.status === "running" &&
      b.jobId !== null &&
      confirmAwaiting.current === b.jobId
    ) {
      confirmAwaiting.current = null;
      bootstrapClient.confirm(b.jobId);
    } else if (b.status !== "confirming" && b.status !== "running") {
      confirmAwaiting.current = null;
    }

    // A pending cancelJobId → a real worker cancel; the resolve acks
    // with a jobId-scoped bootstrapCancelled so a newer request the
    // session moved on to is never clobbered.
    const cancelId = b.cancelJobId;
    if (cancelId !== null && !cancelsInFlight.current.has(cancelId)) {
      cancelsInFlight.current.add(cancelId);
      void bootstrapClient.cancel(cancelId).then(() => {
        cancelsInFlight.current.delete(cancelId);
        dispatch({ type: "bootstrapCancelled", jobId: cancelId });
      });
    }

    if (b.status !== "estimating" || b.jobId !== null) return;
    // One client job per request: `settingsUsed` is the request's
    // identity — bootstrapRequested stores a fresh snapshot object.
    if (b.settingsUsed !== null && startedFor.current === b.settingsUsed) {
      return;
    }
    startedFor.current = b.settingsUsed;
    const aln = session.alignment;
    if (aln === null) {
      // No data to run on (only reachable through a `ran: true` link on
      // a broken custom exercise) — settle the request as cancelled.
      queueMicrotask(() => dispatch({ type: "bootstrapCancelled" }));
      return;
    }
    const jobId = bootstrapClient.start(
      {
        alignment: aln,
        model: session.exercise.analysis.correction,
        method: session.exercise.analysis.method,
        seed: b.seed,
        replicates: b.replicates,
      },
      {
        onEstimate: (e) =>
          dispatch({ type: "bootstrapEstimated", jobId, ...e }),
        onProgress: (p) =>
          dispatch({ type: "bootstrapProgress", jobId, ...p }),
        onResult: (result) =>
          dispatch({ type: "bootstrapDone", jobId, result }),
        onError: (error) =>
          dispatch({ type: "bootstrapFailed", jobId, error }),
      },
    );
    pendingBind.current = jobId;
    // The bind dispatches in a microtask: it still lands before any
    // later user action (microtasks run before the next task), so a
    // Cancel click can never be swallowed by a late bind — but it is
    // not a synchronous setState inside the effect body (react-hooks
    // lint).
    queueMicrotask(() =>
      dispatch({ type: "bootstrapRequested", jobId, autorun: b.autorun }),
    );
  }, [session, dispatch]);

  // The worker outlives a single job; it terminates with the app.
  useEffect(() => () => bootstrapClient.dispose(), []);

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
      setPair(null);
    },
    [dispatch, session],
  );

  // The header's Lessons menu (checkpoint 13): pick a built-in lesson
  // and it loads straight through the `load` reducer — the lesson
  // file's own settings, no overrides, at step 0, in lesson mode — and
  // the URL sync writes ?lesson=<id>. Imported sandbox data would be
  // cleared, so the same confirm as the Lesson switch applies.
  const onPickLesson = useCallback(
    async (id: string) => {
      if (session === null) return;
      if (
        hasImportedData(session) &&
        !window.confirm("Leave sandbox? Your imported data will be cleared.")
      ) {
        return;
      }
      const r = await loadLesson(id);
      if (!r.ok) {
        setToast(`The lesson "${id}" couldn't be loaded.`);
        return;
      }
      setPlaying(false);
      setHoverLeaf(null);
      setPair(null);
      setLink({ kind: "lesson" });
      setSession((s) =>
        reducer(s ?? initialSession(r.value), {
          type: "load",
          exercise: r.value,
          source: "lesson",
        }),
      );
    },
    [session],
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

  // Pair panel (v1.1 spec §5.2): in protein mode with no predict
  // prompt gating, activating a matrix cell opens "How was this
  // distance computed?" — the engine's jttPairDetail for the picked
  // pair of taxa.
  const onPickPairCell = useCallback(
    (i: number, j: number) => {
      if (sm === null) return;
      setPair([sm.labels[i], sm.labels[j]]);
    },
    [sm],
  );
  const pairDetail = useMemo(() => {
    const aln = session?.alignment ?? null;
    if (pair === null || aln === null || session?.alphabet !== "protein") {
      return null;
    }
    const i = aln.labels.indexOf(pair[0]);
    const j = aln.labels.indexOf(pair[1]);
    if (i < 0 || j < 0) return null;
    return engine.jttPairDetail(aln, i, j);
  }, [pair, session]);

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
  // NJ-ness comes from the requested method, not the trace — >50 taxa
  // have no trace (Global Constraints) but still build an unrooted
  // tree that §6.7 roots on the reference's outgroup for display.
  const isNj = session.exercise.analysis.method === "Nj";
  const nLeaf = inferred ? leafCount(inferred) : 0;

  // The stepper's final position (spec §6.2-6.3): a result without a
  // trace (>50 taxa) is always "final". The panel and support labels
  // appear only here — the spoiler rule from the v1.1 checkpoint.
  const atFinal =
    trace === null ? session.result !== null : k === n;
  // Support labels ride on the run's support-bearing tree — only after
  // a run has produced one, only at the final position.
  const drawnInferred = atFinal
    ? (session.bootstrap.support ?? inferred)
    : inferred;

  // Reference rooting (spec §6.7): NJ's tree is drawn rerooted on the
  // reference's outgroup. Only the drawing changes — the computed tree
  // and its groupings are untouched. UPGMA is never rerooted.
  const reroot = (() => {
    if (
      !atFinal ||
      !isNj ||
      referenceTree === null ||
      drawnInferred === null
    ) {
      return null;
    }
    const og = engine.referenceOutgroup(referenceTree);
    if (!og.ok || og.value.length === 0) return null;
    const r = engine.rerootOnOutgroup(drawnInferred, og.value);
    if (!r.ok) return null;
    return { ...r.value, outgroup: og.value };
  })();
  const showReroot = reroot !== null && session.rerootDisplay;
  const drawnTree = showReroot ? reroot!.tree : drawnInferred;

  // Shared leaf spacing for both trees: the row height minus the
  // caption, divided by the leaf count, clamped to 18–48 px.
  const sharedSpacing = leafSpacingFor(
    treesHeight - TREE_CAPTION_H,
    Math.max(nLeaf, referenceTree !== null ? leafCount(referenceTree) : 0),
  );

  // Unpack the prompt gate (src/lessons/promptGate.ts): gating hides the
  // correct pair from the heatmap and the tree highlights.
  const { shown: shownPrompts, gating, answerPair } = promptGate;

  // The shown matrix while a predict_pair prompt is open: the marked
  // cell is cleared and the view is pinned to distances — the lowest Q
  // value IS the answer, so the Q matrix would hand it to the student
  // (checkpoint 12).
  const smShown: StepMatrix | null =
    gating === null
      ? sm
      : (() => {
          const pinned = stepMatrix({
            trace,
            step: k,
            matrix: session.matrix,
            matrixView: "distance",
            inferred,
          });
          const base = pinned ?? sm;
          return base === null ? null : { ...base, chosen: null };
        })();

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

  // An answered reveal_pair prompt leaves a "Revisit" link on the step
  // right after its own — the position where that join shows as
  // just-completed (checkpoint 12).
  const revisit =
    session.source === "lesson"
      ? (session.exercise.prompts.find(
          (p) =>
            p.reveal_pair !== null &&
            p.at_step === k &&
            promptGate.picked(p.at_step) !== null,
        )?.reveal_pair ?? null)
      : null;

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
        <LessonsMenu
          currentId={
            link.kind === "lesson" ? session.exercise.id : null
          }
          onPick={(id) => void onPickLesson(id)}
        />
        <button
          type="button"
          className="phylip-help-open"
          onClick={() => setPhylipHelp(true)}
        >
          Coming from PHYLIP?
        </button>
      </header>
      <main className="app-grid">
        <aside className="col-controls" aria-label="Controls">
          <AlphabetBadge
            alphabet={session.alphabet}
            source={session.source}
            alignmentOrigin={session.alignmentOrigin}
            dispatch={dispatch}
          />
          <Controls
            sim={exerciseSim(session.exercise)}
            alphabet={session.alphabet}
            analysis={session.exercise.analysis}
            locked={session.source === "sandbox" ? [] : session.exercise.locked}
            matrixView={session.matrixView}
            qAvailable={isNj && trace !== null}
            qGated={gating !== null}
            alignmentOrigin={session.alignmentOrigin}
            dispatch={dispatch}
            bootstrapPanel={
              atFinal && inferred !== null ? (
                <BootstrapPanel session={session} dispatch={dispatch} />
              ) : undefined
            }
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
            matrix={session.matrix}
          />
        </aside>
        <section className="col-center">
          <div className="notices">
            {banner !== null && (
              <p role="alert" className="error">
                <strong>{banner.title}</strong> {banner.body}
              </p>
            )}
            {session.notice !== null && (
              <p role="status" className="alphabet-notice">
                {session.notice}
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
                  onShowPair={setPair}
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
                title={
                  session.reference?.kind === "classification"
                    ? "Reference (accepted classification), not a known true tree"
                    : "True tree"
                }
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
            {inferred !== null && drawnTree !== null && (
              <div className="tree-col">
                <TreeView
                  title="Inferred tree"
                  tree={drawnTree}
                  layoutKind="phylogram"
                  highlight={inferHi}
                  wrong={wrong}
                  clampNegative={session.clampNegative}
                  visibleNodes={
                    drawnTree === inferred ? visibleNodes : undefined
                  }
                  leafSpacing={sharedSpacing}
                  onHoverLeaf={onHoverLeaf}
                  onPickLeaf={gating !== null ? promptGate.onPickLeaf : undefined}
                />
                {/* NJ's tree is unrooted; the arbitrary drawing point can
                    make a correct tree look different from the reference
                    (checkpoint 12). Only a verdict caption — final step.
                    With a reference the default drawing roots on its
                    outgroup instead (v1.2 spec §6.7), with a toggle back
                    to the computed view. */}
                {isNj && k === n && referenceTree !== null && (
                  <>
                    {showReroot ? (
                      reroot.outgroup_is_group ? (
                        <p className="unrooted-note">
                          Drawn with the same outgroup as the reference;
                          rerooting changes only the drawing, not the
                          groupings.
                        </p>
                      ) : (
                        <p className="unrooted-note">
                          The reference's outgroup isn't a single group in
                          this tree; rooted next to {reroot.outgroup[0]}.
                        </p>
                      )
                    ) : (
                      <p className="unrooted-note">
                        NJ builds an unrooted tree, drawn here from an
                        arbitrary point. It can look different from the
                        reference even when every grouping matches; compare
                        the groupings, not the shape.
                      </p>
                    )}
                    {reroot !== null && (
                      <button
                        type="button"
                        // The label says what a click switches TO; the
                        // pressed state says which view is on (pressed =
                        // rooted like the reference). Checkpoint 11.
                        aria-pressed={session.rerootDisplay}
                        className="reroot-toggle"
                        onClick={() =>
                          dispatch({ type: "toggleRerootDisplay" })
                        }
                      >
                        {showReroot
                          ? "Show as computed (unrooted)"
                          : "Show rooted like the reference"}
                      </button>
                    )}
                  </>
                )}
              </div>
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
              onPick={
                gating !== null
                  ? promptGate.onPickCell
                  : session.alphabet === "protein"
                    ? onPickPairCell
                    : undefined
              }
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
            gated={gating !== null}
            revisit={
              revisit !== null
                ? { pair: revisit, onShow: () => setPair(revisit) }
                : null
            }
          />
        </aside>
      </main>
      <footer className="app-footer">
        {session.result !== null && trace !== null && (
          <Stepper
            step={k}
            max={n}
            rfText={rfText}
            referenceKind={session.reference?.kind}
            rfClades={session.rf?.missing_in_inferred.length}
            rfZero={session.rf !== null && session.rf.rf === 0}
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
        <a
          className="repo-link"
          href={`${import.meta.env.BASE_URL}licenses.html`}
        >
          Licenses
        </a>
      </footer>
      {phylipHelp && <PhylipHelp onClose={() => setPhylipHelp(false)} />}
      {pairDetail !== null && session.alignment !== null && (
        <PairPanel
          aln={session.alignment}
          detail={pairDetail}
          mode={session.mode}
          dispatch={dispatch}
          onClose={() => setPair(null)}
        />
      )}
    </div>
  );
}
