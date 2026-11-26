// The student flow (v1.5 plan Task 8, spec §5.6, §7.1–7.5):
// `#a=` decodes to an assignment → the start page asks for the id
// → the variant's content runs as today's lesson or reading area
// with graded tasks marked — then Finish issues the NP1-… code.
//
// Everything graded comes from the Task 6 wasm wrappers:
// `makeVariant` builds the seeded variant, `checkTask` is the only
// verdict, `encodeCode` packs the code. Progress lives in
// localStorage keyed `neophylo:a:<assignment id>:<normalised id>`
// (storage.ts); a blocked store only means the "progress won't
// survive a reload" notice. The page is a lazy route — the whole
// flow stays off the initial-JS path (spec §8.2, conductor note 1).

import { useEffect, useMemo, useRef, useState } from "react";

import { engine, initEngine } from "../../engine/index";
import type { EncodeAttempt } from "../../engine/generated/EncodeAttempt";
import type { GradeResult } from "../../engine/generated/GradeResult";
import type { Quantity } from "../../engine/generated/Quantity";
import type { TaskAnswer } from "../../engine/generated/TaskAnswer";
import type { Variant } from "../../engine/generated/Variant";

import {
  answeredCount,
  cellAnswer,
  commitTask,
  encodeAttempts,
  finish as flowFinish,
  leafAnswer,
  newFlow,
  scaleNumericInput,
  startWork,
  submit,
  taskPosition,
  type FlowState,
  type TaskRecord,
} from "../../assess/flow";
import {
  listProgress,
  loadProgress,
  progressKey,
  saveProgress,
  storageAvailable,
} from "../../assess/storage";
import {
  resolveAssignmentLink,
  type ResolvedAssignment,
} from "../../assess/url";
import { readErrorMessage } from "../../reading/errors";

import { App } from "../App";
import type {
  AssignmentAppSession,
  AssignmentPickCtx,
  AssignmentPicks,
} from "../App";

import { AssignmentFinish } from "./AssignmentFinish";
import { AssignmentReading } from "./AssignmentReading";
import { GradedTaskGate } from "./GradedTaskGate";

// The start/finish/error screens are `.lab-page` surfaces — pull the
// lab chrome's padding/print rules the way worksheets and the library
// do (without it the page renders flush to the viewport edges).
import "../labs/labs.css";
import "./assignment.css";

/** spec §5.2/§5.4: the engine refuses ids past 64 bytes — refuse
 *  them at entry with the same message (owner decision). */
const MAX_ID_BYTES = 64;

/** Field paths the assignment locks: the graded tasks are keyed to
 *  the variant's data, so anything that would change the data or
 *  the tree is off — sim params and analysis settings. The
 *  predict_branch task additionally fixes the run's settings
 *  (replicates ≤ 200, seed) — the variant's `bootstrap` block
 *  already carries them; these paths stop edits (spec §5.6). */
const LOCKED_ALWAYS = [
  "sim.model",
  "sim.length",
  "sim.seed",
  "analysis.correction",
  "analysis.method",
];
const LOCKED_BRANCH = ["bootstrap.replicates", "bootstrap.seed"];

interface Work {
  resolved: ResolvedAssignment;
  studentId: string;
  normalisedId: string;
  variant: Variant;
}

type Page =
  | { status: "loading" }
  | { status: "error"; msg: string }
  | { status: "start"; resolved: ResolvedAssignment }
  | { status: "working"; work: Work }
  | { status: "finished"; work: Work };

/** Minutes since 2026-01-01 UTC — the code's `finished_min` stamp. */
function finishedMinNow(): number {
  return Math.max(
    0,
    Math.floor((Date.now() - Date.UTC(2026, 0, 1)) / 60_000),
  );
}

/** The engine's normalised id for the storage key — derived by
 *  round-tripping a code through the wasm wrappers, never by
 *  re-implementing the rule in TypeScript (conductor note 5). */
function normalisedStudentId(
  json: string,
  variant: Variant,
  studentId: string,
  taskCount: number,
): string {
  const skipped: EncodeAttempt[] = Array.from({ length: taskCount }, () => ({
    first: null,
    last: null,
    attempts: 0,
  }));
  const code = engine.encodeCode(json, variant, studentId, skipped, 0);
  if (!code.ok) return studentId;
  const dec = engine.decodeCode(code.value);
  return dec.ok ? dec.value.student_id : studentId;
}

function restoreFlow(tasks: TaskRecord[], phase: "working" | "finished", code: string | null, finishedMin: number | null, taskCount: number): FlowState {
  const records =
    tasks.length === taskCount
      ? tasks
      : newFlow(taskCount).tasks;
  return {
    phase: phase === "finished" && code !== null ? "finished" : "working",
    tasks: records,
    code,
    finishedMin,
  };
}

/** Frame auto-detect (spec §7.4): `window.top` throws cross-origin
 *  on some engines — a throw counts as framed. Lives in the lazy
 *  chunk so it never reaches the initial bundle. */
const isFramed = () => {
  try {
    return window.top !== window.self;
  } catch {
    return true;
  }
};

export function AssignmentStart({ embed }: { embed: boolean }) {
  const [framed] = useState(isFramed);
  const embedMode = embed || framed;
  const [page, setPage] = useState<Page>({ status: "loading" });
  const [idText, setIdText] = useState("");
  const [idError, setIdError] = useState<string | null>(null);
  const [flow, setFlow] = useState<FlowState | null>(null);
  const [drafts, setDrafts] = useState<ReadonlyMap<number, TaskAnswer>>(
    new Map(),
  );
  const [draftText, setDraftText] = useState<ReadonlyMap<number, string>>(
    new Map(),
  );
  const [verdicts, setVerdicts] = useState<ReadonlyMap<number, boolean>>(
    new Map(),
  );
  const [leafArm, setLeafArm] = useState<string | null>(null);
  const [storageOk, setStorageOk] = useState(true);
  const [grade, setGrade] = useState<GradeResult | null>(null);
  const [decimals, setDecimals] = useState<ReadonlyMap<string, number>>(
    new Map(),
  );
  const workRef = useRef<Work | null>(null);
  const keyRef = useRef<string | null>(null);

  const work =
    page.status === "working" || page.status === "finished"
      ? page.work
      : null;
  const assignment =
    page.status === "start"
      ? page.resolved.assignment
      : work?.resolved.assignment ?? null;

  /** Start (or resume) the flow for `studentId`: builds the variant
   *  and loads any stored progress under the normalised key. A
   *  stored FINISHED record only resumes on the automatic reopen —
   *  re-typing an id that already finished deliberately starts the
   *  student over (the link's auto-resume is what lands them back
   *  on their code, spec §7.3). */
  const enter = (
    resolved: ResolvedAssignment,
    studentId: string,
    resumeFinished = true,
  ) => {
    const a = resolved.assignment;
    const v = engine.makeVariant(resolved.json, studentId);
    if (!v.ok) {
      setIdError(
        v.error.kind === "InvalidAssignment"
          ? v.error.msg
          : readErrorMessage(v.error),
      );
      setPage({ status: "start", resolved });
      return;
    }
    const variant = v.value;
    const nid = normalisedStudentId(
      resolved.json,
      variant,
      studentId,
      a.tasks.length,
    );
    const key = progressKey(a.id, nid);
    keyRef.current = key;
    const stored = loadProgress(key);
    const resumable =
      stored !== null && (resumeFinished || stored.phase !== "finished")
        ? stored
        : null;
    const f =
      resumable !== null
        ? restoreFlow(
            resumable.tasks,
            resumable.phase,
            resumable.code,
            resumable.finishedMin,
            a.tasks.length,
          )
        : newFlow(a.tasks.length);
    const w: Work = {
      resolved,
      studentId,
      normalisedId: nid,
      variant,
    };
    workRef.current = w;
    setDrafts(new Map());
    setDraftText(new Map());
    setVerdicts(new Map());
    setLeafArm(null);
    setGrade(null);
    setFlow(startWork(f));
    setPage(
      f.phase === "finished" && f.code !== null
        ? { status: "finished", work: w }
        : { status: "working", work: w },
    );
  };

  // Persist every flow change under the per-student key (try/catch
  // inside storage.ts; a refusal flips the notice on).
  useEffect(() => {
    if (flow === null || keyRef.current === null || work === null) return;
    const ok = saveProgress(keyRef.current, {
      v: 1,
      studentId: work.studentId,
      tasks: flow.tasks,
      phase: flow.phase === "finished" ? "finished" : "working",
      code: flow.code,
      finishedMin: flow.finishedMin,
    });
    if (!ok) setStorageOk(false);
  }, [flow, work]);

  // Open: decode the link, then auto-resume when this browser holds
  // exactly one stored student for the assignment — reopening the
  // link lands on the same code / the same progress (spec §7.3).
  useEffect(() => {
    let cancelled = false;
    void initEngine()
      .then(async () => {
        const r = await resolveAssignmentLink(window.location.href);
        if (cancelled) return;
        if (!r.ok) {
          setPage({ status: "error", msg: readErrorMessage(r.error) });
          return;
        }
        if (!storageAvailable()) setStorageOk(false);
        const prec = engine.precision();
        if (prec.ok) {
          setDecimals(
            new Map(prec.value.map(([q, d]) => [q as string, d])),
          );
        }
        const stored = listProgress(r.value.assignment.id);
        if (stored.length === 1) {
          enter(r.value, stored[0].studentId);
          return;
        }
        setPage({ status: "start", resolved: r.value });
      })
      .catch(() => {
        if (!cancelled) {
          setPage({
            status: "error",
            msg: "The NeoPhylo engine could not be loaded.",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const onStart = () => {
    if (page.status !== "start") return;
    const id = idText.trim();
    if (id === "") {
      setIdError(`Type your ${page.resolved.assignment.id_prompt.label}.`);
      return;
    }
    if (new TextEncoder().encode(id).length > MAX_ID_BYTES) {
      setIdError(
        `That ${page.resolved.assignment.id_prompt.label} is too long — ${MAX_ID_BYTES} characters at most.`,
      );
      return;
    }
    setIdError(null);
    enter(page.resolved, id, false);
  };

  const setDraft = (i: number, a: TaskAnswer | null, text?: string) => {
    setDrafts((m) => {
      const next = new Map(m);
      if (a === null) next.delete(i);
      else next.set(i, a);
      return next;
    });
    if (text !== undefined) {
      setDraftText((m) => new Map(m).set(i, text));
    } else if (a === null) {
      setDraftText((m) => {
        const next = new Map(m);
        next.delete(i);
        return next;
      });
    }
  };

  /** Practice-mode Check: records the attempt and the verdict — the
   *  engine is the only judge (conductor note 5). */
  const check = (i: number) => {
    if (work === null || flow === null) return;
    const draft = drafts.get(i);
    const gt = work.resolved.assignment.tasks[i];
    if (draft === undefined || gt === undefined) return;
    const r = engine.checkTask(work.variant, gt.task, draft);
    if (!r.ok) return;
    setFlow(submit(flow, i, draft));
    setVerdicts((m) => new Map(m).set(i, r.value));
  };

  const decimalsFor = (q: Quantity): number => decimals.get(q) ?? 3;

  const fmtAnswer = (i: number, rec: TaskRecord): string | null => {
    const t = draftText.get(i);
    if (t !== undefined) return t;
    const a = rec.last ?? rec.first;
    if (a === null) return null;
    if (a.kind === "number") {
      const gt = work?.resolved.assignment.tasks[i];
      const q =
        gt?.task.kind === "numeric" ? gt.task.quantity : "corrected_distance";
      return (a.value / 10 ** decimalsFor(q)).toFixed(decimalsFor(q));
    }
    if (a.kind === "branch") return a.value.join(", ");
    return null;
  };

  /** The session object handed to App — the thin hook that marks
   *  and gates graded tasks inside the lesson (conductor note 1:
   *  entry points get only a thin hook). */
  const sess = useMemo<AssignmentAppSession | undefined>(() => {
    if (work === null || flow === null || assignment === null) {
      return undefined;
    }
    const tasks = assignment.tasks.map((g, i) => ({
      index: i,
      task: g.task,
    }));
    const uncommitted = (k: number) =>
      tasks.find(
        (t) =>
          taskPosition(t.task) === k && !flow.tasks[t.index]?.committed,
      ) ?? null;
    const anyAt = (k: number) =>
      tasks.find((t) => taskPosition(t.task) === k) ?? null;
    const branch = tasks.find((t) => t.task.kind === "predict_branch") ?? null;
    const branchUncommitted =
      branch !== null && !flow.tasks[branch.index]?.committed
        ? branch
        : null;
    const answeredAt = (i: number) =>
      drafts.has(i) || flow.tasks[i]?.first !== null;
    // §7.3 resume: land on the first uncommitted stepper task's
    // position — the next thing the student has to do — not the top
    // of the trace. 0 when none is left (a fresh run or only
    // branch/reading tasks open).
    const initialStep =
      tasks
        .filter((t) => !flow.tasks[t.index]?.committed)
        .map((t) => taskPosition(t.task))
        .filter((p): p is number => p !== null)
        .sort((x, y) => x - y)[0] ?? 0;
    return {
      stepGate(k: number, to: number) {
        let target = to;
        for (let p = k; p < to; p += 1) {
          const t = uncommitted(p);
          if (t === null) continue;
          const d =
            drafts.get(t.index) ??
            flow.tasks[t.index]?.last ??
            flow.tasks[t.index]?.first;
          if (d === undefined || d === null) {
            target = p;
            break;
          }
          setFlow((f) => (f === null ? f : commitTask(f, t.index, d)));
        }
        return target;
      },
      view(k: number) {
        const open = uncommitted(k);
        const t = anyAt(k);
        const b =
          branchUncommitted === null
            ? null
            : (() => {
                const i = branchUncommitted.index;
                return (
                  <GradedTaskGate
                    task={branchUncommitted.task}
                    mode={assignment.mode}
                    committed={false}
                    draft={drafts.get(i) ?? null}
                    verdict={verdicts.get(i) ?? null}
                    answerText={draftText.get(i) ?? null}
                    onCheck={() => check(i)}
                  />
                );
              })();
        const g =
          t === null
            ? null
            : (() => {
                const i = t.index;
                const rec = flow.tasks[i];
                const committed = rec?.committed ?? false;
                return (
                  <GradedTaskGate
                    task={t.task}
                    mode={assignment.mode}
                    committed={committed}
                    draft={drafts.get(i) ?? null}
                    verdict={verdicts.get(i) ?? null}
                    answerText={
                      draftText.get(i) ??
                      (committed && rec !== undefined
                        ? fmtAnswer(i, rec)
                        : null)
                    }
                    decimals={
                      t.task.kind === "numeric"
                        ? decimalsFor(t.task.quantity)
                        : 3
                    }
                    onCheck={() => check(i)}
                    onNumeric={(txt) => {
                      if (t.task.kind !== "numeric") return;
                      const d = decimalsFor(t.task.quantity);
                      if (txt.trim() === "") {
                        setDraft(i, null);
                        return;
                      }
                      const scaled = scaleNumericInput(txt, d);
                      if (scaled === null) {
                        setDraft(i, null);
                        return;
                      }
                      setDraft(
                        i,
                        { kind: "number", value: scaled },
                        txt.trim(),
                      );
                    }}
                  />
                );
              })();
        return {
          open: open !== null,
          blocked: open !== null && !answeredAt(open.index),
          gates:
            g === null && b === null ? null : (
              <>
                {g}
                {b}
              </>
            ),
        };
      },
      picks(k: number, ctx: AssignmentPickCtx): AssignmentPicks {
        const t = uncommitted(k);
        const pair = t?.task.kind === "predict_pair" ? t : null;
        const branchOpen = branchUncommitted !== null;
        const p = ctx.prompt;
        const pCell = p.gating !== null ? p.onPickCell : null;
        const pLeaf = p.gating !== null ? p.onPickLeaf : null;
        const pBranch = p.branchGating !== null ? p.onPickBranch : null;
        const pTerminal =
          p.branchGating !== null ? p.onPickTerminal : null;
        const sm = ctx.sm;
        const tipOrder = ctx.matrix?.labels ?? [];
        return {
          cell:
            pair !== null || pCell !== null
              ? (i, j) => {
                  if (
                    pair !== null &&
                    sm !== null &&
                    sm.active !== null
                  ) {
                    const a = cellAnswer(
                      tipOrder,
                      ctx.leafSets,
                      sm.active,
                      i,
                      j,
                    );
                    if (a !== null) {
                      setDraft(
                        pair.index,
                        a,
                        `${sm.labels[i]} + ${sm.labels[j]}`,
                      );
                    }
                  }
                  pCell?.(i, j);
                }
              : undefined,
          leaf:
            pair !== null || pLeaf !== null
              ? (label) => {
                  if (
                    pair !== null &&
                    sm !== null &&
                    sm.active !== null
                  ) {
                    if (leafArm === null || leafArm === label) {
                      setLeafArm(label);
                    } else {
                      const a = leafAnswer(
                        tipOrder,
                        ctx.leafSets,
                        sm.active,
                        leafArm,
                        label,
                      );
                      setLeafArm(null);
                      if (a !== null) {
                        setDraft(
                          pair.index,
                          a,
                          `${leafArm} + ${label}`,
                        );
                      }
                    }
                  }
                  pLeaf?.(label);
                }
              : undefined,
          branch:
            (branchOpen || pBranch !== null) && ctx.branchesPickable
              ? (key) => {
                  if (branchOpen) {
                    const clade = key.split("|");
                    setDraft(
                      branchUncommitted.index,
                      { kind: "branch", value: clade },
                      clade.join(", "),
                    );
                  }
                  pBranch?.(key);
                }
              : undefined,
          terminal:
            pTerminal !== null && ctx.branchesPickable
              ? pTerminal
              : undefined,
        };
      },
      leafArm,
      branchRunGated:
        branchUncommitted !== null &&
        !drafts.has(branchUncommitted.index),
      branchPanel: branchUncommitted !== null,
      initialStep,
      locked: [
        ...LOCKED_ALWAYS,
        ...(branch !== null ? LOCKED_BRANCH : []),
      ],
      // §5.6/§7.2: a test-mode pick feeds both the graded draft and
      // the lesson prompt — the prompt renders no verdict element at
      // all, so retries stay invisible until Finish.
      hideVerdicts: assignment.mode === "test",
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [work, flow, drafts, draftText, verdicts, leafArm, assignment, decimals]);

  /** Finish: commit every outstanding draft, encode the code
   *  through the wasm wrapper and persist it. */
  const finishNow = (
    extra?: ReadonlyMap<number, TaskAnswer | null>,
  ) => {
    const w = workRef.current;
    if (w === null || flow === null) return;
    let f = flow;
    const a = w.resolved.assignment;
    a.tasks.forEach((_g, i) => {
      if (f.tasks[i]?.committed) return;
      const fromReading = extra?.get(i);
      const d = fromReading !== undefined ? fromReading : (drafts.get(i) ?? null);
      f = commitTask(f, i, d);
    });
    const min = finishedMinNow();
    const code = engine.encodeCode(
      w.resolved.json,
      w.variant,
      w.studentId,
      encodeAttempts(f),
      min,
    );
    if (!code.ok) {
      // An encode refusal means the recorded answers can't be
      // packed — report it rather than dying silently.
      setPage({ status: "error", msg: readErrorMessage(code.error) });
      return;
    }
    f = flowFinish(f, code.value, min);
    setFlow(f);
    if (a.mode === "practice") {
      const g = engine.grade(w.resolved.json, null, code.value, {
        kind: "final",
      });
      setGrade(g.ok ? g.value : null);
    }
    setPage({ status: "finished", work: w });
  };

  const resetToStart = () => {
    const resolved = workRef.current?.resolved;
    keyRef.current = null;
    workRef.current = null;
    setFlow(null);
    setDrafts(new Map());
    setDraftText(new Map());
    setVerdicts(new Map());
    setLeafArm(null);
    setIdText("");
    setIdError(null);
    if (resolved !== undefined) {
      setPage({ status: "start", resolved });
    }
  };

  // ---- render ---------------------------------------------------------

  const openInNewTab =
    typeof window !== "undefined"
      ? `${window.location.pathname}${window.location.hash}`
      : "#";

  if (page.status === "loading") {
    return (
      <main className="app-loading">
        <p>Loading the assignment…</p>
      </main>
    );
  }
  if (page.status === "error") {
    return (
      <main className="lab-page">
        <h1>Assignment not available</h1>
        <p role="alert" className="error">
          {page.msg}
        </p>
        {embedMode && (
          <p>
            <a
              className="assess-open-tab"
              href={openInNewTab}
              target="_blank"
              rel="noreferrer"
            >
              Open in a new tab
            </a>
          </p>
        )}
      </main>
    );
  }
  if (page.status === "start") {
    const a = page.resolved.assignment;
    return (
      <main className="lab-page assess-start">
        <h1>{a.title}</h1>
        {a.instructions !== undefined && a.instructions !== "" && (
          <p className="assess-instructions">{a.instructions}</p>
        )}
        <p>
          This assignment is graded — your answers are recorded in a
          completion code you paste back to your instructor.
        </p>
        <p className="assess-id-row">
          <label className="assess-id-field">
            {a.id_prompt.label}{" "}
            <input
              type="text"
              className="assess-id-input"
              value={idText}
              onChange={(e) => setIdText(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") onStart();
              }}
            />
          </label>{" "}
          <button
            type="button"
            className="btn btn-primary assess-start-btn"
            onClick={onStart}
          >
            Start
          </button>
        </p>
        {idError !== null && (
          <p role="alert" className="error">
            {idError}
          </p>
        )}
        {!storageOk && (
          <p className="assess-storage-note" role="status">
            Your progress won't survive a reload in this browser —
            keep this tab open until you copy your completion code.
          </p>
        )}
        {embedMode && (
          <p>
            <a
              className="assess-open-tab"
              href={openInNewTab}
              target="_blank"
              rel="noreferrer"
            >
              Open in a new tab
            </a>
          </p>
        )}
      </main>
    );
  }

  const a = work!.resolved.assignment;
  const content = work!.variant.content;

  return (
    <div className="assess-page" data-embed={embedMode || undefined}>
      <header className="assess-bar">
        <div className="assess-bar-main">
          <h1>{a.title}</h1>
          <p className="assess-progress">
            {a.mode === "practice" ? "Practice" : "Test"} ·{" "}
            {flow !== null ? answeredCount(flow) : 0} of{" "}
            {a.tasks.length} graded tasks answered
          </p>
        </div>
        <div className="assess-bar-actions">
          {embedMode && (
            <a
              className="assess-open-tab"
              href={openInNewTab}
              target="_blank"
              rel="noreferrer"
            >
              Open in a new tab
            </a>
          )}
          {page.status === "working" && (
            <button
              type="button"
              className="btn btn-primary assess-finish-btn"
              onClick={() => finishNow()}
            >
              Finish
            </button>
          )}
          <button
            type="button"
            className="btn btn-secondary assess-switch-id"
            onClick={resetToStart}
          >
            Use a different ID
          </button>
        </div>
      </header>
      {/* One status note at a time: on the finished page the
          AssignmentFinish card's own notice carries the storage
          warning (two role=status elements would double-announce). */}
      {!storageOk && page.status !== "finished" && (
        <p className="assess-storage-note" role="status">
          Your progress won't survive a reload — keep this tab open
          and copy your completion code when you finish.
        </p>
      )}
      {page.status === "finished" ? (
        <main className="lab-page">
          <AssignmentFinish
            code={flow?.code ?? ""}
            mode={a.mode}
            grade={grade}
            studentId={work!.studentId}
            storageOk={storageOk}
          />
        </main>
      ) : content.kind === "exercise" ? (
        <App
          exercise={content.value}
          assignment={sess}
          embed={embedMode}
        />
      ) : (
        <main className="lab-page assess-reading-page">
          <AssignmentReading
            set={content.value}
            mode={a.mode}
            graded={
              new Map(
                a.tasks
                  .map((g, i) => ({ g, i }))
                  .filter((x) => x.g.task.kind === "reading")
                  .map((x) => [
                    (x.g.task as { item: number }).item,
                    x.i,
                  ]),
              )
            }
            committed={(i) => flow?.tasks[i]?.committed ?? false}
            onCheck={(i, answer) => {
              setFlow((f) => (f === null ? f : submit(f, i, answer)));
            }}
            onFinish={(answers) => finishNow(answers)}
          />
        </main>
      )}
    </div>
  );
}
