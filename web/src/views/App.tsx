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

import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { REPO_URL } from "../config";
import { bootstrapClient } from "../engine/bootstrapClient";
import { engine, initEngine } from "../engine";
import type { ConsensusKind } from "../engine/generated/ConsensusKind";
import type { Result } from "../engine";
import type { Exercise } from "../engine/generated/Exercise";
import type { ReplicateDetail } from "../engine/generated/ReplicateDetail";
import { errorMessage } from "../explain/errors";
import { loadLesson } from "../lessons/loader";
import { usePromptGate } from "../lessons/promptGate";
import { LONGER_RUN_SITES } from "../lessons/prompts";
import type { Action, Session } from "../state/session";
import {
  exerciseSim,
  hasImportedData,
  initialSession,
  reducer,
  siteFilterName,
} from "../state/session";
import { encode } from "../state/url";
import {
  applyUrlState,
  resolveInitial,
  sessionUrlState,
  type LinkKind,
} from "../state/urlRestore";

import { applyPresenter } from "../design/presenter";
import { applyTheme } from "../design/theme";
import { PRESENTER_SCALE } from "../design/tokens";
import { useBreakpoint } from "../design/breakpoints";
import { AlphabetBadge } from "./AlphabetBadge";
import { BootstrapPanel } from "./BootstrapPanel";
import { ConsensusTabs } from "./ConsensusTabs";
import { consensusKind, viewLabel } from "./consensusTabs";
import { Controls } from "./Controls";
import { ExportMenu } from "./ExportMenu";
import { ExplanationPanel } from "./ExplanationPanel";
import { GapControl } from "./GapControl";
import { Header } from "./Header";
import { ImportPanel } from "./ImportPanel";
import { MatrixHeatmap } from "./MatrixHeatmap";
import { PairPanel } from "./PairPanel";
import { PromptCard } from "./PromptCard";
import { SettingsDrawer } from "./SettingsDrawer";
import {
  leafIdByLabel,
  leafLabelSets,
  stepEmphasis,
} from "./stepEmphasis";
import { Stepper } from "./Stepper";
import { stepMatrix, traceLength } from "./stepMatrix";
import type { StepMatrix } from "./stepMatrix";
import { TeachingNotices } from "./TeachingNotices";
import { readTourSeen } from "../design/tour";
import { Tour } from "./Tour";
import { splitKeys } from "../layout/splitKeys";
import { LEAF_SPACING_NATURAL } from "../layout/treePanel";
import { TreeView } from "./TreeView";
import { nodeName } from "../state/names";

// "Coming from PHYLIP?" is a lazy chunk (v1.3 Task 14, spec §8.2):
// fetched on first open, not with the app. Sheet's mount-time focus
// contract is unchanged — it runs when the chunk resolves, and the
// SW's `**/*.js` precache keeps it working offline after first load.
const PhylipHelp = lazy(() =>
  import("./PhylipHelp").then((m) => ({ default: m.PhylipHelp })),
);

// "Watch one replicate" is a lazy chunk too (v1.4b Task 10, owner
// decision 2026-10-30 — the v1.3 Task 14 precedent): fetched on first
// open, not with the app. Sheet's mount-time focus contract is
// unchanged — it runs when the chunk resolves — and the overlay keeps
// a null fallback layout-stable; the SW's `**/*.js` precache keeps it
// working offline after first load.
const ReplicatePanel = lazy(() =>
  import("./ReplicatePanel").then((m) => ({ default: m.ReplicatePanel })),
);

const NO_HIGHLIGHT = new Set<number>();

/** Bootstrap view → the consensus kind its tab draws (v1.2 spec §6.8). */
const CONSENSUS_KIND: Record<"majority" | "extended" | "strict", ConsensusKind> = {
  majority: "Majority",
  extended: "Extended",
  strict: "Strict",
};

export function App({ exercise }: { exercise?: Exercise }) {
  // The live breakpoint (v1.3 Task 9, spec §6.1) — exposed on .app so
  // the arrangement is observable (and testable) alongside the CSS.
  const breakpoint = useBreakpoint();
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
  // The last replicate detail delivered by a worker job (spec §6.5);
  // keyed by replicate index so a stale result can't paint the panel.
  const [repDetail, setRepDetail] = useState<{
    index: number;
    result: Result<ReplicateDetail>;
  } | null>(null);

  // The inferred tree's column scrolls when the row is squeezed (its
  // tabs block keeps a min height; the caption + toggle ride below).
  const treeColRef = useRef<HTMLDivElement | null>(null);

  // The displayed tree panel's measured width — the SVG/PNG exports
  // lay out with it so the figure matches the screen exactly
  // (checkpoint 15).
  const [exportPanelW, setExportPanelW] = useState(0);

  // Checkpoint 15: the reroot toggle sits at the column's bottom, so
  // clicking it scrolls the column down to reveal it — clipping the
  // drawing's top (and its caption) when the new view paints. Always
  // land on the drawing's top after the view changes.
  const rerootDisplay = session?.rerootDisplay ?? false;
  useLayoutEffect(() => {
    // scrollTop, not scrollTo: jsdom implements the property but not
    // the method (unit tests render this tree).
    const el = treeColRef.current;
    if (el !== null) el.scrollTop = 0;
  }, [rerootDisplay]);

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
      // First-visit tour (spec §6.7): once per device on a plain visit
      // — suppressed by a `lesson=` step link, any `#x=` state, a
      // prop-driven exercise (unit tests) or the tourSeen flag.
      if (
        exercise === undefined &&
        r.fromUrl !== null &&
        r.fromUrl.step === 0 &&
        !window.location.href.includes("#x=") &&
        !readTourSeen()
      ) {
        s = reducer(s, { type: "tourStart" });
      }
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

  // Theme (v1.3 spec §3.3): <html data-theme> follows the session's
  // theme and the choice is stored device-locally — the index.html
  // inline script has already set the pre-paint value, so this only
  // rewrites the DOM when the session value differs.
  const theme = session?.theme;
  useEffect(() => {
    if (theme !== undefined) applyTheme(theme);
  }, [theme]);

  // Presenter mode (v1.3 spec §6.6): <html data-presenter> follows the
  // session flag — the generated tokens.css block reads it to scale
  // the type and spacing tokens 1.5× — and the choice is stored
  // device-locally under neophylo.presenter, never in links.
  const presenter = session?.presenter;
  useEffect(() => {
    if (presenter !== undefined) applyPresenter(presenter);
  }, [presenter]);

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
        // v1.4b: the run uses the same gap treatment as the tree —
        // absent means pairwise, the pre-v1.4b call.
        filter: session.exercise.analysis.site_filter,
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
    // Round-3 note sequencing: the triggers read the run history.
    runs: session?.bootstrap.completedRuns ?? 0,
    longRun:
      (session?.bootstrap.maxRunSites ?? 0) >= LONGER_RUN_SITES,
  });

  // The active gap treatment (v1.4b spec §3.1): absent means pairwise.
  const siteFilter = useMemo(
    () =>
      session?.exercise.analysis.site_filter ?? {
        kind: "pairwise" as const,
      },
    [session?.exercise.analysis.site_filter],
  );

  // Pair panel (v1.1 spec §5.2): in protein mode with no predict
  // prompt gating, activating a matrix cell opens "How was this
  // distance computed?" — the engine's jttPairDetailFiltered for the
  // picked pair of taxa, so the panel's numbers follow the same gap
  // treatment as the matrix (owner decision 2026-10-30, option A).
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
    return engine.jttPairDetailFiltered(aln, i, j, siteFilter);
  }, [pair, session, siteFilter]);

  // "Watch one replicate" (v1.2 Task 13, spec §6.5): the panel shows
  // replicate `replicateIndex` (0-based) of the finished run — its seed
  // and total come from `settingsUsed`, the settings the results belong
  // to even after the user edits the fields (Review Focus 3).
  const repIndex = session?.bootstrap.replicateIndex ?? null;
  const repSeed =
    session?.bootstrap.settingsUsed?.seed ?? session?.bootstrap.seed ?? 0;
  const repAln = session?.alignment ?? null;
  const repModel = session?.exercise.analysis.correction;
  const repMethod = session?.exercise.analysis.method;
  // v1.4b: the replicate panel resamples under the same gap treatment
  // as the tree; absent site_filter is pairwise, today's call exactly.
  const repFilter = session?.exercise.analysis.site_filter;
  // A single replicate is fast on the main thread; when the run's own
  // estimate puts one replicate over ~2 s it goes through the worker
  // as a one-replicate job instead (spec §6.5).
  const repViaWorker =
    session !== null &&
    session.bootstrap.msPerReplicate !== null &&
    session.bootstrap.msPerReplicate > 2000;
  useEffect(() => {
    if (
      repIndex === null ||
      !repViaWorker ||
      repAln === null ||
      repModel === undefined ||
      repMethod === undefined
    ) {
      return;
    }
    const index = repIndex;
    const jobId = bootstrapClient.detail(
      {
        alignment: repAln,
        model: repModel,
        method: repMethod,
        seed: repSeed,
        index,
        filter: repFilter,
      },
      {
        onDetail: (d) =>
          setRepDetail({ index, result: { ok: true, value: d } }),
        onError: (e) =>
          setRepDetail({ index, result: { ok: false, error: e } }),
      },
    );
    return () => {
      void bootstrapClient.cancel(jobId);
    };
  }, [repIndex, repViaWorker, repAln, repModel, repMethod, repSeed, repFilter]);
  // The fast path: replicate_detail is one engine call, computed
  // synchronously like the pair panel's jttPairDetail.
  const repSync = useMemo(() => {
    if (
      repIndex === null ||
      repViaWorker ||
      repAln === null ||
      repModel === undefined ||
      repMethod === undefined
    ) {
      return null;
    }
    return engine.replicateDetailFiltered(
      repAln,
      repModel,
      repMethod,
      repFilter ?? { kind: "pairwise" },
      repSeed,
      repIndex,
    );
  }, [repIndex, repViaWorker, repAln, repModel, repMethod, repSeed, repFilter]);

  // The mask the count line and the pair panel share: kept/removed
  // column indices from the engine (science lives in Rust). On a
  // filter error (NoSitesKept) every column counts as removed.
  const sitesTotal =
    session?.alignment?.seqs.reduce((m, s) => Math.max(m, s.length), 0) ??
    0;
  const siteMask = useMemo(() => {
    const aln = session?.alignment ?? null;
    return aln === null ? null : engine.siteMask(aln, siteFilter);
  }, [session?.alignment, siteFilter]);
  const sitesRemoved =
    siteMask === null
      ? 0
      : siteMask.ok
        ? siteMask.value.removed.length
        : sitesTotal;

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
    // §6.8: the exact loading line over skeleton panels — never a
    // blank screen while the wasm engine boots.
    return (
      <div className="app-loading">
        <div className="skeleton skeleton-header" aria-hidden="true" />
        <div className="skeleton-row" aria-hidden="true">
          <div className="skeleton skeleton-panel" />
          <div className="skeleton skeleton-panel" />
          <div className="skeleton skeleton-panel" />
        </div>
        <p>Loading the NeoPhylo engine…</p>
      </div>
    );
  }


  const n = trace !== null ? traceLength(trace) : 0;
  // NJ-ness comes from the requested method, not the trace — >50 taxa
  // have no trace (Global Constraints) but still build an unrooted
  // tree that §6.7 roots on the reference's outgroup for display.
  const isNj = session.exercise.analysis.method === "Nj";

  // The stepper's final position (spec §6.2-6.3): a result without a
  // trace (>50 taxa) is always "final". The panel and support labels
  // appear only here — the spoiler rule from the v1.1 checkpoint.
  const atFinal =
    trace === null ? session.result !== null : k === n;
  // The active consensus tree when the view is a consensus tab and a
  // done run produced one (spec §6.4). A consensus view with no results
  // behind it falls back to the support tree — ConsensusTabs shows the
  // support tab selected in the same case. NJ's consensus is rerooted
  // on the reference's outgroup by the shared `reroot` block below,
  // exactly like the support tree; UPGMA's is already rooted.
  const b = session.bootstrap;
  const activeKind =
    atFinal && b.status === "done" && b.consensus !== null
      ? consensusKind(b.view)
      : null;
  const consensusTree =
    activeKind !== null ? b.consensus![activeKind] : null;
  // Support labels ride on the run's support-bearing tree — only after
  // a run has produced one, only at the final position.
  const drawnInferred = atFinal
    ? (consensusTree ?? session.bootstrap.support ?? inferred)
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

  // Exports follow the current display (v1.2 spec §6.8): the drawn
  // tree — rooted like the reference when that view is on — and the
  // bootstrap view's own tree for "Consensus (Newick)".
  const boot = session.bootstrap;
  const consensusViewTree =
    boot.consensus === null
      ? null
      : boot.view === "support"
        ? boot.support
        : boot.consensus[CONSENSUS_KIND[boot.view]];
  const exportBootstrap =
    boot.status === "done" ? boot.settingsUsed : null;
  // Taxon labels in alignment order — the canonical-side convention
  // behind every drawn data-split key (checkpoint 15).
  const splitTaxa =
    session.alignment?.labels ?? session.matrix?.labels ?? undefined;

  // predict_branch verdict (v1.2 spec §7.1): the weakest internal
  // branch of the run's support tree, plus every internal grouping's
  // support indexed by the canonical split key the drawn edges
  // advertise (data-split). Null until a run finishes; the prompt
  // card shows "Prediction saved" meanwhile.
  const weakestBranch = (() => {
    const st = session.bootstrap.support;
    if (
      session.bootstrap.status !== "done" ||
      st === null ||
      splitTaxa === undefined
    ) {
      return null;
    }
    const keys = splitKeys(st, splitTaxa, !isNj);
    const byKey = new Map<string, number>();
    let weakest: { key: string; support: number } | null = null;
    for (let id = 0; id < st.nodes.length; id += 1) {
      const node = st.nodes[id];
      if (node.children.length === 0 || node.parent === null) continue;
      const s = st.branches[id].support;
      if (s === null) continue;
      const key = keys.get(id) ?? "";
      byKey.set(key, s);
      if (weakest === null || s < weakest.support) {
        weakest = { key, support: s };
      }
    }
    return weakest === null ? null : { weakest, byKey };
  })();

  // Shared leaf spacing for both trees (round 3): fixed at the
  // natural 28 px/leaf — panels grow to the tree's height instead of
  // fitting the drawing to the row, so no leaf is ever cut off and
  // text never scales. Presenter mode (§6.6) is the one exception:
  // leaf spacing and figure text take the tokens' 1.5× multiplier.
  const textScale = session.presenter ? PRESENTER_SCALE : 1;
  const sharedSpacing = LEAF_SPACING_NATURAL * textScale;

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

  const controlsSections = (
    <>
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
        sandbox={session.source === "sandbox"}
        locked={session.source === "sandbox" ? [] : session.exercise.locked}
        matrixView={session.matrixView}
        qAvailable={isNj && trace !== null}
        qGated={gating !== null}
        alignmentOrigin={session.alignmentOrigin}
        dispatch={dispatch}
        bootstrapPanel={
          atFinal && inferred !== null ? (
            <BootstrapPanel
              session={session}
              dispatch={dispatch}
              runGated={promptGate.branchGating !== null}
              locked={
                session.source === "sandbox" ? [] : session.exercise.locked
              }
            />
          ) : undefined
        }
      />
      {session.source === "sandbox" && (
        <GapControl
          value={siteFilter}
          onChange={(f) =>
            dispatch({ type: "setAnalysis", patch: { site_filter: f } })
          }
          removed={sitesRemoved}
          total={sitesTotal}
          locked={false}
        />
      )}
      {session.source === "sandbox" && (
        <ImportPanel session={session} dispatch={dispatch} />
      )}
      <ExportMenu
        tree={drawnTree}
        alignment={session.alignment}
        correction={session.exercise.analysis.correction}
        method={session.exercise.analysis.method}
        clampNegative={session.clampNegative}
        matrix={session.matrix}
        treeView={
          showReroot
            ? { kind: "rooted", outgroup: reroot!.outgroup }
            : reroot !== null
              ? { kind: "computed" }
              : { kind: "plain" }
        }
        // The current bootstrap view's tree AS DRAWN — rerooted on
        // the reference's outgroup while that view is on — so the
        // export matches the item's name (checkpoint 15).
        consensusTree={consensusViewTree === null ? null : drawnTree}
        // The SAME layout inputs the on-screen figure uses, so the
        // SVG/PNG serialize this exact drawing (checkpoint 15) — with
        // one exception: exports are document-size figures, so the
        // leaf spacing never takes presenter mode's 1.5× (§6.6). The
        // measured panel width still follows the on-screen panel.
        figure={{
          kind: consensusTree === null ? "phylogram" : "cladogram",
          leafSpacing: LEAF_SPACING_NATURAL,
          panelWidth: exportPanelW,
          visibleNodes:
            drawnTree === inferred ? visibleNodes : undefined,
          splitTaxa,
          splitRooted: !isNj,
        }}
        bootstrap={exportBootstrap}
        theme={session.theme}
      />
    </>
  );

  return (
    <div className="app" data-breakpoint={breakpoint}>
      <Header
        title={session.exercise.title}
        toast={toast}
        source={session.source}
        onSelectMode={onSelectMode}
        currentLessonId={
          link.kind === "lesson" ? session.exercise.id : null
        }
        onPickLesson={(id) => void onPickLesson(id)}
        onOpenPhylipHelp={() => setPhylipHelp(true)}
        theme={session.theme}
        presenter={session.presenter}
        dispatch={dispatch}
        breakpoint={breakpoint}
        drawerOpen={session.drawerOpen}
      />
      <main className="app-grid" id="main-content" tabIndex={-1}>
        {/* The controls column renders only at the wide breakpoint;
            below it the same sections live in the Settings drawer
            opened from the header (v1.3 spec §6.1, §6.4). Presenter
            mode hides them entirely (§6.6). */}
        {breakpoint === "wide" && !session.presenter && (
          <aside className="col-controls" aria-label="Controls">
            {controlsSections}
          </aside>
        )}
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
              {shownPrompts.map((p, i) => (
                <PromptCard
                  key={`${p.at_step}:${i}`}
                  prompt={p}
                  mode={session.mode}
                  picked={promptGate.picked(p.at_step)}
                  answer={answerPair}
                  branch={
                    p.type === "predict_branch"
                      ? {
                          picked: promptGate.pickedBranch(p.at_step),
                          terminalPicked: promptGate.terminalPick,
                          verdict: (() => {
                            const picked = promptGate.pickedBranch(
                              p.at_step,
                            );
                            if (picked === null) return null;
                            // Owner note: the verdict is evaluated ONCE,
                            // on the first completed run after the pick,
                            // and locked thereafter — later reruns never
                            // change it.
                            const locked = promptGate.branchVerdictFor(
                              p.at_step,
                            );
                            if (locked !== null) return locked;
                            if (weakestBranch === null) return null;
                            const pickedS =
                              weakestBranch.byKey.get(picked);
                            const v = {
                              // Correct within 5 points of the lowest
                              // support, not only on the weakest itself.
                              correct:
                                pickedS !== undefined &&
                                pickedS - weakestBranch.weakest.support <=
                                  0.05 + 1e-9,
                              weakest:
                                weakestBranch.weakest.key.split("|"),
                              supportPct: Math.round(
                                100 * weakestBranch.weakest.support,
                              ),
                            };
                            promptGate.recordBranchVerdict(p.at_step, v);
                            return v;
                          })(),
                        }
                      : undefined
                  }
                  onShowPair={setPair}
                  onContinue={
                    p.type === "note"
                      ? (promptGate.continueFor(p) ?? undefined)
                      : undefined
                  }
                />
              ))}
            </div>
          )}
          <div className="trees">
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
                textScale={textScale}
                splitTaxa={splitTaxa}
                splitRooted
                onHoverLeaf={onHoverLeaf}
                onPickLeaf={gating !== null ? promptGate.onPickLeaf : undefined}
              />
            )}
            {inferred !== null && drawnTree !== null && (
              <div className="tree-col" ref={treeColRef}>
                {(() => {
                  // Consensus tabs (spec §6.4): at the final position
                  // the tree panel sits inside the tablist's tabpanel.
                  // A consensus view draws its tree as a cladogram with
                  // the tab's label as caption; step highlights and
                  // wrong-clade marks belong to the inferred tree only.
                  const treePanel = (
                    <TreeView
                      title={
                        consensusTree === null
                          ? "Inferred tree"
                          : `${viewLabel(b.view)} consensus`
                      }
                      tree={drawnTree}
                      layoutKind={
                        consensusTree === null ? "phylogram" : "cladogram"
                      }
                      highlight={consensusTree === null ? inferHi : NO_HIGHLIGHT}
                      wrong={consensusTree === null ? wrong : NO_HIGHLIGHT}
                      clampNegative={session.clampNegative}
                      visibleNodes={
                        drawnTree === inferred ? visibleNodes : undefined
                      }
                      leafSpacing={sharedSpacing}
                      textScale={textScale}
                      splitTaxa={splitTaxa}
                      splitRooted={!isNj}
                      onPanelSize={setExportPanelW}
                      onHoverLeaf={onHoverLeaf}
                      onPickLeaf={
                        gating !== null ? promptGate.onPickLeaf : undefined
                      }
                      onPickBranch={
                        promptGate.branchGating !== null &&
                        consensusTree === null
                          ? promptGate.onPickBranch
                          : undefined
                      }
                      onPickTerminal={
                        promptGate.branchGating !== null &&
                        consensusTree === null
                          ? promptGate.onPickTerminal
                          : undefined
                      }
                    />
                  );
                  return atFinal ? (
                    <ConsensusTabs session={session} dispatch={dispatch}>
                      {treePanel}
                    </ConsensusTabs>
                  ) : (
                    treePanel
                  );
                })()}
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
      {session.drawerOpen && (
        <SettingsDrawer
          onClose={() => dispatch({ type: "setDrawer", open: false })}
          // §6.7 (Task 12, owner decision B): at 1024–1279 — below
          // the Lessons-menu item's ≥ 1280 range, above the More
          // menu's < 1024 range — the drawer holds the reopen item.
          onTakeTour={
            breakpoint === "medium"
              ? () => dispatch({ type: "tourStart" })
              : undefined
          }
          // §6.5 (v1.4 Task 11): the lab index's 1024–1279 path —
          // the header link overflows the row there; the More menu
          // owns it below 1024.
          labsHref={
            breakpoint === "medium" ? "?labs" : undefined
          }
        >
          {controlsSections}
        </SettingsDrawer>
      )}
      {phylipHelp && (
        <Suspense fallback={null}>
          <PhylipHelp onClose={() => setPhylipHelp(false)} />
        </Suspense>
      )}
      {session.tourStep !== null && (
        <Tour step={session.tourStep} dispatch={dispatch} />
      )}
      {pairDetail !== null && session.alignment !== null && (
        <PairPanel
          aln={session.alignment}
          detail={pairDetail}
          mode={session.mode}
          dispatch={dispatch}
          onClose={() => setPair(null)}
          removed={
            siteMask !== null && siteMask.ok && siteMask.value.removed.length > 0
              ? new Set(siteMask.value.removed)
              : undefined
          }
          removedBy={siteFilterName(siteFilter)}
        />
      )}
      {repIndex !== null &&
        session.alignment !== null &&
        drawnTree !== null && (
          <Suspense fallback={null}>
            <ReplicatePanel
              method={session.exercise.analysis.method}
              taxa={session.alignment.labels}
              index={repIndex}
              total={Math.max(
                1,
                session.bootstrap.total > 0
                  ? session.bootstrap.total
                  : (session.bootstrap.settingsUsed?.replicates ??
                      session.bootstrap.replicates),
              )}
              detail={
                repViaWorker
                  ? repDetail !== null && repDetail.index === repIndex
                    ? repDetail.result
                    : null
                  : repSync
              }
              // "Your tree" is the COMPUTED tree — the same unrooted
              // split set (UPGMA: rooted clusters) the engine compared
              // the replicate against — not the displayed consensus,
              // which collapses groupings and made the "missing" count
              // read 0 while outlines still showed on the replicate.
              // Display-rooted like the main view when that toggle is
              // on, so coinciding groupings still line up.
              original={(() => {
                const base = session.bootstrap.support ?? inferred;
                if (base === null || base === drawnInferred) {
                  return drawnTree;
                }
                if (showReroot) {
                  const r = engine.rerootOnOutgroup(
                    base,
                    reroot!.outgroup,
                  );
                  if (r.ok) return r.value.tree;
                }
                return base;
              })()}
              outgroup={showReroot ? reroot!.outgroup : null}
              clampNegative={session.clampNegative}
              leafSpacing={sharedSpacing}
              textScale={textScale}
              onNavigate={(i) =>
                dispatch({ type: "setReplicateIndex", index: i })
              }
              onClose={() =>
                dispatch({ type: "setReplicateIndex", index: null })
              }
            />
          </Suspense>
        )}
    </div>
  );
}
