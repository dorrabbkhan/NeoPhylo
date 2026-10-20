// The bootstrap worker (v1.2 spec §5). `runBootstrapJob` holds the
// whole run sequence — replicate 0, estimate, confirm, 100 ms batches,
// progress, result — and is deliberately transport-free so unit tests
// drive it in-process. The bottom of the file wires it to `self`
// inside a real DedicatedWorkerGlobalScope only, so importing this
// module in jsdom has no side effects.

import init from "./pkg/neophylo_wasm.js";

import type { BootstrapTally } from "./generated/BootstrapTally";
import type { ConsensusKind } from "./generated/ConsensusKind";
import type { DroppedGroup } from "./generated/DroppedGroup";
import type { Tree } from "./generated/Tree";
import type {
  BootstrapParams,
  PageToWorker,
  WorkerToPage,
  WorkerToPageJob,
} from "./bootstrapProtocol";
import { engine } from "./index";

/** Target duration of one replicate batch (spec §5: ~100 ms). */
export const BATCH_MS = 100;

const CONSENSUS_KINDS: ConsensusKind[] = ["Strict", "Majority", "Extended"];

/**
 * Yield to the event loop between batches. Batches are synchronous wasm
 * calls, so without this `confirm` and `cancel` messages would never be
 * dispatched while a job runs. A MessageChannel post runs as a macrotask
 * without setTimeout's 4 ms clamping.
 */
function yieldToEventLoop(): Promise<void> {
  if (typeof MessageChannel === "undefined") {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

/**
 * Run one bootstrap job (spec §5 run sequence):
 *
 * 1. replicate 0 alone, timed → `estimate` (msPerReplicate, totalMs).
 * 2. `waitConfirm()` — the worker waits for the page's `confirm`
 *    (which the page sends immediately when `totalMs` is under its
 *    threshold); resolving `false` means the run was declined/cancelled
 *    and the job ends silently.
 * 3. batches sized to ≈100 ms from `msPerReplicate` (minimum 1),
 *    `progress` after each.
 * 4. `result` with the merged tally, the support tree, and every
 *    consensus kind + dropped list.
 *
 * `shouldStop()` is polled between batches and once before the result;
 * a stop ends the job with no further messages (the worker sends the
 * `cancelled` acknowledgement).
 *
 * Errors are values at the wasm boundary; any non-`BootstrapFailed`
 * batch error ends the job with an `error` message. A batch whose
 * replicates all failed counts toward `failed` (and `done`) instead —
 * only a run with zero successful replicates is `BootstrapFailed`.
 */
export async function runBootstrapJob(
  p: BootstrapParams,
  post: (m: WorkerToPageJob) => void,
  shouldStop: () => boolean,
  waitConfirm: () => Promise<boolean>,
): Promise<void> {
  // The original tree is the scaffold every progress/result support
  // tree is copied from (support_on_tree writes BranchAttrs.support).
  const dist = engine.distances(p.alignment, p.model);
  if (!dist.ok) {
    post({ type: "error", error: dist.error });
    return;
  }
  const built = engine.buildTree(dist.value, p.method, { trace: false });
  if (!built.ok) {
    post({ type: "error", error: built.error });
    return;
  }
  const original: Tree = built.value.tree;

  // Replicate 0 alone, timed for the estimate (spec §5 step 1).
  const t0 = performance.now();
  const first = engine.bootstrapBatch(
    p.alignment,
    p.model,
    p.method,
    p.seed,
    0,
    1,
  );
  const msPerReplicate = performance.now() - t0;

  let tally: BootstrapTally | null = null;
  // Replicates in all-failed batches: they count as done and failed
  // but have no tally to merge.
  let skipped = 0;
  if (!first.ok) {
    if (first.error.kind !== "BootstrapFailed") {
      post({ type: "error", error: first.error });
      return;
    }
    skipped = 1;
  } else {
    tally = first.value;
  }

  // A cancel processed during replicate 0 must not leave the job
  // waiting for a confirm that will never be answered — and a cancelled
  // job posts nothing more.
  if (shouldStop()) return;
  post({
    type: "estimate",
    msPerReplicate,
    totalMs: msPerReplicate * p.replicates,
  });

  if (!(await waitConfirm())) {
    return;
  }

  const failedSoFar = () => skipped + (tally?.failed ?? 0);
  const supportSoFar = (): Tree => {
    if (tally === null) return original;
    const s = engine.supportOnTree(original, tally);
    // support_on_tree cannot fail on inputs we control, but errors are
    // values at the boundary — fall back to the bare original.
    return s.ok ? s.value : original;
  };

  let done = 1;
  post({
    type: "progress",
    done,
    total: p.replicates,
    failed: failedSoFar(),
    etaMs: msPerReplicate * (p.replicates - done),
    support: supportSoFar(),
  });

  const batchSize =
    msPerReplicate > 0 && Number.isFinite(msPerReplicate)
      ? Math.max(1, Math.round(BATCH_MS / msPerReplicate))
      : p.replicates;

  while (done < p.replicates) {
    // Let pending confirm/cancel messages dispatch before the next
    // synchronous batch starts.
    await yieldToEventLoop();
    if (shouldStop()) return;
    const count = Math.min(batchSize, p.replicates - done);
    const batch = engine.bootstrapBatch(
      p.alignment,
      p.model,
      p.method,
      p.seed,
      done,
      count,
    );
    if (!batch.ok) {
      if (batch.error.kind !== "BootstrapFailed") {
        post({ type: "error", error: batch.error });
        return;
      }
      skipped += count;
    } else if (tally === null) {
      tally = batch.value;
    } else {
      const merged = engine.mergeTallies(tally, batch.value);
      if (!merged.ok) {
        post({ type: "error", error: merged.error });
        return;
      }
      tally = merged.value;
    }
    done += count;
    post({
      type: "progress",
      done,
      total: p.replicates,
      failed: failedSoFar(),
      etaMs: msPerReplicate * (p.replicates - done),
      support: supportSoFar(),
    });
  }

  // A cancel that landed during the final batch still suppresses the
  // result.
  if (shouldStop()) return;

  if (tally === null || tally.successful === 0) {
    post({
      type: "error",
      error: {
        kind: "BootstrapFailed",
        failed: skipped,
        total: p.replicates,
      },
    });
    return;
  }

  const support = supportSoFar();
  const consensus = {} as Record<ConsensusKind, Tree>;
  const dropped = {} as Record<ConsensusKind, DroppedGroup[]>;
  for (const kind of CONSENSUS_KINDS) {
    const tree = engine.consensus(tally, kind, tally.labels);
    if (!tree.ok) {
      post({ type: "error", error: tree.error });
      return;
    }
    const d = engine.consensusDropped(original, tally, kind);
    if (!d.ok) {
      post({ type: "error", error: d.error });
      return;
    }
    consensus[kind] = tree.value;
    dropped[kind] = d.value;
  }

  post({
    type: "result",
    tally,
    support,
    consensus,
    dropped,
    failed: failedSoFar(),
  });
}

/* ---- worker wiring (real DedicatedWorkerGlobalScope only) ---- */

interface JobState {
  jobId: number;
  cancelled: boolean;
  /** Resolves the pending `waitConfirm` when set. */
  confirm: ((proceed: boolean) => void) | null;
}

/**
 * The worker's message handling, factored out of the global-scope
 * wiring so tests can drive it in-process with a fake `postMessage`.
 * `ready` resolves when the wasm engine is usable.
 */
export interface WorkerScope {
  onmessage(e: { data: PageToWorker }): void;
  /** Test-only: cancels recorded for not-yet-started jobs (must stay
   * 0 — an entry for a job that never starts would cancel a future
   * job that reuses the id). */
  pendingCancels(): number;
}

export function installWorkerScope(
  postMessage: (m: WorkerToPage) => void,
  ready: () => Promise<unknown>,
): WorkerScope {
  let active: JobState | null = null;
  // `start` messages received while a job runs: it is cancelled and the
  // queued start runs once the loop is free. JobIds cancelled before
  // they start are skipped and acknowledged on dequeue.
  const pendingStarts: Array<PageToWorker & { type: "start" }> = [];
  const cancelledBeforeStart = new Set<number>();

  const runNext = async (start: PageToWorker & { type: "start" }) => {
    const job: JobState = { jobId: start.jobId, cancelled: false, confirm: null };
    // Claim the active slot before the async init so a start or cancel
    // landing during init is handled against this job (never a second
    // concurrent job).
    active = job;
    let initOk = true;
    try {
      await ready();
    } catch (err) {
      // Init must not wedge the queue: report the failure on this job
      // and keep draining pending starts.
      initOk = false;
      postMessage({
        type: "error",
        jobId: job.jobId,
        error: {
          kind: "InvalidExercise",
          field: "bootstrap",
          msg: `engine init failed: ${String(err)}`,
        },
      });
    }
    // A queued start cancelled before it ran is skipped — but still
    // acknowledged below, so the page's cancel() resolves without the
    // 1 s terminate+respawn. The delete clears the bookkeeping entry
    // either way.
    const skippedBeforeStart = cancelledBeforeStart.delete(job.jobId);
    if (initOk && !job.cancelled && !skippedBeforeStart) {
      const post = (m: WorkerToPageJob) =>
        postMessage({ ...m, jobId: job.jobId });
      try {
        await runBootstrapJob(
          {
            alignment: start.alignment,
            model: start.model,
            method: start.method,
            seed: start.seed,
            replicates: start.replicates,
          },
          post,
          () => job.cancelled,
          () =>
            new Promise<boolean>((resolve) => {
              if (job.cancelled) {
                resolve(false);
              } else {
                job.confirm = resolve;
              }
            }),
        );
      } catch (err) {
        // The engine returns errors as values; a throw is a boundary
        // bug (e.g. OOM) — surface it as an error message, never crash
        // the worker silently.
        post({
          type: "error",
          error: {
            kind: "InvalidExercise",
            field: "bootstrap",
            msg: `worker failed: ${String(err)}`,
          },
        });
      }
    }
    if (job.cancelled || skippedBeforeStart) {
      postMessage({ type: "cancelled", jobId: job.jobId });
    }
    active = null;
    const next = pendingStarts.shift();
    if (next !== undefined) void runNext(next);
  };

  return {
    onmessage(e) {
      const m = e.data;
      if (m.type === "start") {
        if (active !== null) {
          // Cancel the running job; the queued start runs once it exits.
          active.cancelled = true;
          active.confirm?.(false);
          active.confirm = null;
          pendingStarts.push(m);
        } else {
          void runNext(m);
        }
        return;
      }
      if (m.type === "confirm") {
        if (active?.jobId === m.jobId && active.confirm !== null) {
          active.confirm(true);
          active.confirm = null;
        }
        return;
      }
      if (m.type === "cancel") {
        if (active?.jobId === m.jobId) {
          active.cancelled = true;
          active.confirm?.(false);
          active.confirm = null;
        } else if (pendingStarts.some((s) => s.jobId === m.jobId)) {
          // Queued start: skipped and acknowledged on dequeue.
          cancelledBeforeStart.add(m.jobId);
        } else {
          // Unknown or already-finished job: nothing to stop — ack
          // now so the page doesn't wait out its 1 s deadline, and
          // keep no bookkeeping that could poison a later jobId.
          postMessage({ type: "cancelled", jobId: m.jobId });
        }
      }
    },
    pendingCancels: () => cancelledBeforeStart.size,
  };
}

const isDedicatedWorker =
  typeof (globalThis as { importScripts?: unknown }).importScripts ===
    "function" &&
  typeof (globalThis as { WorkerGlobalScope?: unknown }).WorkerGlobalScope !==
    "undefined";

if (isDedicatedWorker) {
  const scope = globalThis as unknown as {
    postMessage(m: WorkerToPage): void;
    onmessage: ((e: MessageEvent<PageToWorker>) => void) | null;
  };

  let initPromise: Promise<unknown> | null = null;
  const ready = () => (initPromise ??= init());
  const handler = installWorkerScope((m) => scope.postMessage(m), ready);
  scope.onmessage = handler.onmessage;
}
