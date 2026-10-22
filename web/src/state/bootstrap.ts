// Bootstrap slice of Session: run state, settings and results
// (v1.2 spec §5, §6.1; split from session.ts in v1.3 spec §7.1).
// `bootstrapReducer` owns the slice; `clearBootstrap` is the
// Session-level helper data-changing actions call to discard results
// and request a cancel of any job in flight.

import type { ConsensusKind } from "../engine/generated/ConsensusKind";
import type { DroppedGroup } from "../engine/generated/DroppedGroup";
import type { Exercise } from "../engine/generated/Exercise";
import type { NeoError } from "../engine/generated/NeoError";
import type { Tree } from "../engine/generated/Tree";

import type { Action } from "./actions";
import type { Session } from "./session";

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
  /** Completed (status "done") runs since the last data change —
   * sequenced lesson notes key off it (bootstrap-basics round 3).
   * Cleared with the results by `clearBootstrap`. */
  completedRuns: number;
  /** Sites of the longest alignment a completed run was made on;
   * `null` before any run. Drives the "longer run" note trigger. */
  maxRunSites: number | null;
  jobId: number | null;
  cancelJobId: number | null;
  autorun: boolean;
  prefilledRun: boolean;
  error: NeoError | null;
}

/** The default bootstrap state (spec §6.1: 100 replicates, seed 1,
 * view "support"). Exported to `session.ts` callers as
 * `defaultBootstrap`. */
export function bootstrapInitial(): BootstrapState {
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
    completedRuns: 0,
    maxRunSites: null,
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
      ...bootstrapInitial(),
      replicates: b.replicates,
      seed: b.seed,
      view: b.view,
      cancelJobId: b.jobId ?? b.cancelJobId,
    },
  };
}

/** The exercise's own bootstrap settings, if it declares them (v1.2
 * spec §7.1: `bootstrap: { replicates, seed }`). The engine validates
 * loaded lessons, but `#x=` links carry trusted exercises that were
 * never re-parsed (url.ts), so the values are still clamped here.
 * Invalid or missing fields fall back to the `bootstrapInitial`
 * values; the view is not part of the block. */
function exerciseBootstrap(e: Exercise): {
  replicates?: number;
  seed?: number;
} {
  const b = e.bootstrap;
  if (b === null || b === undefined) return {};
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

/** Bootstrap-slice reducer (v1.2 spec §5, §6.1). `ctx` is the
 * pre-action session, read-only: `bootstrapDone` reads
 * `ctx.alignment` for the run's site count. Returns `slice`
 * unchanged when the action does not apply.
 *
 * `jobId` is the client-assigned id; when omitted on a request (a
 * `ran: true` link), the first job message adopts its id. */
export function bootstrapReducer(
  slice: BootstrapState,
  a: Action,
  ctx: Session,
): BootstrapState {
  const b = slice;
  switch (a.type) {
    case "load":
      // v1.1 rule: nothing carries over between lessons, so
      // settings reset to the exercise's own `bootstrap` block
      // (spec §7.1; Task 14 adds it to the Exercise type) or the
      // defaults. Only sandbox data changes keep the user's
      // settings — `load` is not one of those paths. A running job
      // still asks the page for a cancel.
      return {
        ...bootstrapInitial(),
        ...exerciseBootstrap(a.exercise),
        cancelJobId: b.jobId ?? b.cancelJobId,
      };
    case "bootstrapRequested":
      return {
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
      };
    case "bootstrapEstimated": {
      if (!jobCurrent(b, a.jobId)) return b;
      if (a.totalMs <= AUTO_RUN_MS) {
        // The client auto-confirms an under-budget run; it proceeds
        // to running (progress messages follow).
        return {
          ...b,
          status: "running",
          jobId: a.jobId,
          autorun: false,
          etaMs: a.totalMs,
          msPerReplicate: a.msPerReplicate,
        };
      }
      if (b.autorun) {
        // A `ran: true` link with an over-budget estimate never asks
        // the student to confirm: degrade to a prefilled Run button
        // (spec §6.1) and cancel the pending worker job.
        return {
          ...b,
          status: "idle",
          jobId: null,
          cancelJobId: a.jobId,
          autorun: false,
          prefilledRun: true,
          etaMs: a.totalMs,
          msPerReplicate: a.msPerReplicate,
        };
      }
      return {
        ...b,
        status: "confirming",
        jobId: a.jobId,
        etaMs: a.totalMs,
        msPerReplicate: a.msPerReplicate,
      };
    }
    case "bootstrapConfirmed": {
      if (!jobCurrent(b, a.jobId)) return b;
      return { ...b, status: "running", jobId: a.jobId, autorun: false };
    }
    case "bootstrapProgress": {
      if (!jobCurrent(b, a.jobId)) return b;
      return {
        ...b,
        status: "running",
        jobId: a.jobId,
        autorun: false,
        done: a.done,
        total: a.total,
        failed: a.failed,
        etaMs: a.etaMs,
        support: a.support,
      };
    }
    case "bootstrapDone": {
      if (!jobCurrent(b, a.jobId)) return b;
      const r = a.result;
      // The run's alignment is the session's: a data change would
      // have cancelled this job before it could finish.
      const sites = ctx.alignment?.seqs[0]?.length ?? 0;
      return {
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
        completedRuns: b.completedRuns + 1,
        maxRunSites: Math.max(b.maxRunSites ?? 0, sites),
        error: null,
      };
    }
    case "bootstrapFailed": {
      if (!jobCurrent(b, a.jobId)) return b;
      return {
        ...b,
        status: "error",
        jobId: null,
        autorun: false,
        error: a.error,
      };
    }
    case "bootstrapCancelRequested": {
      // The panel's Cancel button moves the current job into
      // `cancelJobId` for the page to cancel; `bootstrapCancelled` is
      // the page's ack. A jobId-scoped ack settles only that pending
      // cancel — a newer request may already be estimating in its
      // place.
      const active =
        b.status === "estimating" ||
        b.status === "confirming" ||
        b.status === "running";
      if (!active) return b;
      return {
        ...b,
        status: "cancelled",
        jobId: null,
        // The page cancels the job and acks with bootstrapCancelled.
        cancelJobId: b.jobId ?? b.cancelJobId,
        autorun: false,
        prefilledRun: false,
      };
    }
    case "bootstrapCancelled": {
      if (a.jobId !== undefined) {
        // Scoped ack: settles exactly the pending cancel it names. A
        // stale ack (the session moved on to a newer job) is ignored,
        // and it never touches another request's status or jobId.
        if (b.cancelJobId !== a.jobId) return b;
        return { ...b, cancelJobId: null };
      }
      const active =
        b.status === "estimating" ||
        b.status === "confirming" ||
        b.status === "running";
      return {
        ...b,
        // An active run reports cancelled; an already-idle session
        // (the page's ack of a clear-on-change cancel, or a declined
        // autorun) keeps its status and the prefilled flag.
        status: active ? "cancelled" : b.status,
        jobId: null,
        cancelJobId: null,
        autorun: false,
      };
    }
    case "setBootstrapSettings":
      // Settings changes never clear results — a finished run stays
      // visible and the panel labels it with `settingsUsed` (Review
      // Focus 3). Replicates clamp to the spec §3.8 range.
      return {
        ...b,
        replicates:
          a.patch.replicates === undefined
            ? b.replicates
            : Math.min(
                MAX_REPLICATES,
                Math.max(MIN_REPLICATES, Math.round(a.patch.replicates)),
              ),
        seed:
          a.patch.seed === undefined
            ? b.seed
            : Math.max(0, Math.round(a.patch.seed)),
      };
    case "setBootstrapView":
      return { ...b, view: a.view };
    case "setReplicateIndex":
      return { ...b, replicateIndex: a.index };
    default:
      return b;
  }
}
