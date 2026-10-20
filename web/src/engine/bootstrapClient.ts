// Page-side bootstrap client (v1.2 spec §5). Owns the Web Worker,
// assigns jobIds, drops messages for jobs that aren't current, sends
// the immediate `confirm` when the estimate is under the threshold,
// and terminates+respawns a worker that doesn't acknowledge a cancel
// within 1 s.
//
// `new Worker(new URL("./worker.ts", import.meta.url))` is the pattern
// Vite detects to bundle the worker entry — it must stay inline.

import type {
  WorkerToPage,
  BootstrapParams,
  BootstrapHandlers,
  ReplicateDetailParams,
  ReplicateDetailHandlers,
} from "./bootstrapProtocol";

export type {
  BootstrapHandlers,
  BootstrapParams,
  BootstrapResult,
  ReplicateDetailParams,
  ReplicateDetailHandlers,
} from "./bootstrapProtocol";

export interface BootstrapClientOptions {
  /** For tests: supply a fake worker. */
  workerFactory?: () => Worker;
  /** Estimates above this many ms require an explicit `confirm`
   * (spec §5: 10,000). */
  confirmThresholdMs?: number;
  /** How long `cancel` waits for the worker's `cancelled` before
   * terminating it and spawning a fresh worker (spec §5: 1,000). */
  cancelAckTimeoutMs?: number;
  /** Observability hook for tests/e2e: messages arriving for a jobId
   * that isn't current (spec §5 stale-results rule). */
  onStaleMessage?: (m: WorkerToPage) => void;
}

export class BootstrapClient {
  private readonly confirmThresholdMs: number;
  private readonly cancelAckTimeoutMs: number;
  private readonly workerFactory: (() => Worker) | undefined;
  private readonly onStaleMessage: ((m: WorkerToPage) => void) | undefined;

  private worker: Worker | null = null;
  private nextId = 0;
  /** The jobId the page currently accepts messages for; 0 = none. */
  private currentId = 0;
  private handlers = new Map<number, (m: WorkerToPage) => void>();
  /** Jobs a cancel was sent for; their late messages are dropped. */
  private cancelling = new Set<number>();
  private cancelWaiters = new Map<number, () => void>();

  constructor(opts: BootstrapClientOptions = {}) {
    this.workerFactory = opts.workerFactory;
    this.confirmThresholdMs = opts.confirmThresholdMs ?? 10_000;
    this.cancelAckTimeoutMs = opts.cancelAckTimeoutMs ?? 1_000;
    this.onStaleMessage = opts.onStaleMessage;
  }

  /** Take the single live-job slot: the current job (if any) is sent a
   * cancel and its late messages are dropped (spec §5 stale rule). */
  private claimJob(): number {
    const jobId = ++this.nextId;
    if (this.currentId !== 0) {
      this.worker?.postMessage({ type: "cancel", jobId: this.currentId });
      this.cancelling.add(this.currentId);
      this.handlers.delete(this.currentId);
    }
    this.currentId = jobId;
    return jobId;
  }

  /** Start a job; returns its jobId. A running job is cancelled first —
   * the page never has two live jobs. */
  start(p: BootstrapParams, h: BootstrapHandlers): number {
    const w = this.ensureWorker();
    const jobId = this.claimJob();
    this.handlers.set(jobId, (m) => this.onRunMessage(jobId, m, h));
    w.postMessage({ type: "start", jobId, ...p });
    return jobId;
  }

  /** Ask the worker for one replicate's teaching detail (spec §6.5):
   * the same single-job slot as a run, so it is never concurrent with
   * one. */
  detail(p: ReplicateDetailParams, h: ReplicateDetailHandlers): number {
    const w = this.ensureWorker();
    const jobId = this.claimJob();
    this.handlers.set(jobId, (m) => {
      if (m.type === "detail") {
        h.onDetail(m.detail);
        this.clearJob(m.jobId);
      } else if (m.type === "error") {
        h.onError(m.error);
        this.clearJob(m.jobId);
      }
    });
    w.postMessage({ type: "detail", jobId, ...p });
    return jobId;
  }

  /** Approve a run whose estimate exceeded the confirm threshold. */
  confirm(jobId: number): void {
    this.worker?.postMessage({ type: "confirm", jobId });
  }

  /** Ask the worker to stop the job. Resolves when the worker's
   * `cancelled` ack arrives, or after `cancelAckTimeoutMs` when the
   * worker is terminated and respawned (spec §5). */
  cancel(jobId: number): Promise<void> {
    const w = this.worker;
    if (w === null || jobId !== this.currentId) {
      return Promise.resolve();
    }
    this.cancelling.add(jobId);
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.cancelWaiters.delete(jobId);
        // No ack inside the deadline: terminate and respawn.
        w.terminate();
        this.worker = null;
        this.clearJob(jobId);
        resolve();
      }, this.cancelAckTimeoutMs);
      this.cancelWaiters.set(jobId, () => {
        clearTimeout(timer);
        this.clearJob(jobId);
        resolve();
      });
      w.postMessage({ type: "cancel", jobId });
    });
  }

  /** Terminate the worker and forget every job. */
  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.currentId = 0;
    this.handlers.clear();
    this.cancelling.clear();
    for (const resolve of this.cancelWaiters.values()) resolve();
    this.cancelWaiters.clear();
  }

  private ensureWorker(): Worker {
    if (this.worker === null) {
      this.worker =
        this.workerFactory?.() ??
        new Worker(new URL("./worker.ts", import.meta.url), {
          type: "module",
        });
      this.worker.onmessage = (e: MessageEvent<WorkerToPage>) =>
        this.onMessage(e.data);
    }
    return this.worker;
  }

  private clearJob(jobId: number): void {
    this.handlers.delete(jobId);
    this.cancelling.delete(jobId);
    if (this.currentId === jobId) this.currentId = 0;
  }

  private onMessage(m: WorkerToPage): void {
    if (m.type === "cancelled") {
      this.cancelWaiters.get(m.jobId)?.();
      this.cancelWaiters.delete(m.jobId);
      this.clearJob(m.jobId);
      return;
    }
    if (m.jobId !== this.currentId || this.cancelling.has(m.jobId)) {
      this.onStaleMessage?.(m);
      return;
    }
    this.handlers.get(m.jobId)?.(m);
  }

  /** Dispatch a message for a `start` job (estimate → confirm gate,
   * progress, result, error). */
  private onRunMessage(
    jobId: number,
    m: WorkerToPage,
    h: BootstrapHandlers,
  ): void {
    switch (m.type) {
      case "estimate":
        if (m.totalMs <= this.confirmThresholdMs) {
          this.confirm(jobId);
        } else {
          h.onEstimate({
            msPerReplicate: m.msPerReplicate,
            totalMs: m.totalMs,
          });
        }
        break;
      case "progress":
        h.onProgress({
          done: m.done,
          total: m.total,
          failed: m.failed,
          etaMs: m.etaMs,
          support: m.support,
        });
        break;
      case "result":
        h.onResult({
          tally: m.tally,
          support: m.support,
          consensus: m.consensus,
          dropped: m.dropped,
          failed: m.failed,
        });
        this.clearJob(jobId);
        break;
      case "error":
        h.onError(m.error);
        this.clearJob(jobId);
        break;
    }
  }
}

/**
 * The shared client the app uses. Workers are created lazily on
 * `start`, so importing this module is side-effect-free.
 */
export const bootstrapClient = new BootstrapClient();
