// BootstrapClient against a fake Worker: the spec §5 page-side rules —
// auto-confirm under the threshold, the confirm gate over it, stale
// jobId filtering, and cancel's 1 s acknowledge/terminate contract —
// without needing a real worker in jsdom. Real-worker behavior is
// covered by e2e/bootstrap.spec.ts.

import { afterEach, describe, expect, it, vi } from "vitest";

import type { Alignment } from "./generated/Alignment";
import type { NeoError } from "./generated/NeoError";
import type { Tree } from "./generated/Tree";
import type { PageToWorker, WorkerToPage } from "./bootstrapProtocol";
import type { BootstrapHandlers } from "./bootstrapProtocol";
import { BootstrapClient } from "./bootstrapClient";

/** Minimal Worker stand-in: the client only touches postMessage,
 * onmessage and terminate. */
class FakeWorker {
  onmessage: ((e: { data: WorkerToPage }) => void) | null = null;
  readonly posted: PageToWorker[] = [];
  terminated = false;
  postMessage(m: PageToWorker): void {
    this.posted.push(m);
  }
  terminate(): void {
    this.terminated = true;
  }
  emit(m: WorkerToPage): void {
    this.onmessage?.({ data: m });
  }
}

const fakeAlignment = {
  labels: ["a"],
  seqs: [[0]],
  alphabet: "Dna",
} as unknown as Alignment;
const fakeTree = {
  nodes: [],
  branches: [],
  root: 0,
  rooted: false,
} as unknown as Tree;

function makeClient(opts: {
  confirmThresholdMs?: number;
  cancelAckTimeoutMs?: number;
  onStaleMessage?: (m: WorkerToPage) => void;
}): { client: BootstrapClient; workers: FakeWorker[] } {
  const workers: FakeWorker[] = [];
  const client = new BootstrapClient({
    workerFactory: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w as unknown as Worker;
    },
    ...opts,
  });
  return { client, workers };
}

function handlers(over: Partial<BootstrapHandlers> = {}): BootstrapHandlers & {
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    onEstimate: (e) => {
      calls.push(`estimate:${e.totalMs}`);
      over.onEstimate?.(e);
    },
    onProgress: (p) => {
      calls.push(`progress:${p.done}`);
      over.onProgress?.(p);
    },
    onResult: (r) => {
      calls.push(`result:${r.failed}`);
      over.onResult?.(r);
    },
    onError: (e) => {
      calls.push(`error:${e.kind}`);
      over.onError?.(e);
    },
  };
}

const PARAMS = {
  alignment: fakeAlignment,
  model: "Jc69",
  method: "Nj",
  seed: 1,
  replicates: 100,
} as const;

describe("BootstrapClient", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends start with the params and an increasing jobId", () => {
    const { client, workers } = makeClient({});
    const h = handlers();
    const id = client.start({ ...PARAMS }, h);
    expect(id).toBe(1);
    expect(workers).toHaveLength(1);
    expect(workers[0].posted[0]).toEqual({ type: "start", jobId: 1, ...PARAMS });
  });

  it("auto-confirms when the estimate is under the threshold", () => {
    const { client, workers } = makeClient({ confirmThresholdMs: 10_000 });
    const h = handlers();
    const id = client.start({ ...PARAMS }, h);
    workers[0].emit({ type: "estimate", jobId: id, msPerReplicate: 5, totalMs: 500 });
    expect(h.calls).toEqual([]);
    expect(workers[0].posted).toContainEqual({ type: "confirm", jobId: id });
  });

  it("with the threshold set to 0 waits for confirm instead of confirming", () => {
    const { client, workers } = makeClient({ confirmThresholdMs: 0 });
    const h = handlers();
    const id = client.start({ ...PARAMS }, h);
    workers[0].emit({ type: "estimate", jobId: id, msPerReplicate: 5, totalMs: 500 });
    expect(h.calls).toEqual(["estimate:500"]);
    expect(workers[0].posted).not.toContainEqual({ type: "confirm", jobId: id });
    client.confirm(id);
    expect(workers[0].posted).toContainEqual({ type: "confirm", jobId: id });
  });

  it("routes progress, result and error to the job's handlers", () => {
    const { client, workers } = makeClient({});
    const h = handlers();
    const id = client.start({ ...PARAMS }, h);
    workers[0].emit({
      type: "progress",
      jobId: id,
      done: 4,
      total: 100,
      failed: 0,
      etaMs: 96,
      support: fakeTree,
    });
    workers[0].emit({
      type: "result",
      jobId: id,
      tally: { method: "Nj", labels: ["a"], successful: 100, failed: 0, counts: [] },
      support: fakeTree,
      consensus: { Strict: fakeTree, Majority: fakeTree, Extended: fakeTree },
      dropped: { Strict: [], Majority: [], Extended: [] },
      failed: 0,
    });
    expect(h.calls).toEqual(["progress:4", "result:0"]);
  });

  it("ignores messages whose jobId is not current", () => {
    const stale: string[] = [];
    const { client, workers } = makeClient({
      onStaleMessage: (m) => stale.push(m.type),
    });
    const a = handlers();
    const b = handlers();
    const idA = client.start({ ...PARAMS }, a);
    const idB = client.start({ ...PARAMS }, b);
    // Starting B cancels A first, then posts B's start.
    expect(workers[0].posted).toContainEqual({ type: "cancel", jobId: idA });

    // A's late progress must not reach its handlers; B's messages work.
    workers[0].emit({
      type: "progress",
      jobId: idA,
      done: 5,
      total: 100,
      failed: 0,
      etaMs: 1,
      support: fakeTree,
    });
    workers[0].emit({
      type: "progress",
      jobId: idB,
      done: 2,
      total: 100,
      failed: 0,
      etaMs: 1,
      support: fakeTree,
    });
    expect(a.calls).toEqual([]);
    expect(b.calls).toEqual(["progress:2"]);
    expect(stale).toEqual(["progress"]);
    void idB;
  });

  it("cancel resolves when the worker acknowledges within the timeout", async () => {
    const { client, workers } = makeClient({});
    const id = client.start({ ...PARAMS }, handlers());
    const done = client.cancel(id);
    expect(workers[0].posted).toContainEqual({ type: "cancel", jobId: id });
    workers[0].emit({ type: "cancelled", jobId: id });
    await expect(done).resolves.toBeUndefined();
    expect(workers[0].terminated).toBe(false);
  });

  it("cancel of a job queued behind another resolves on its ack without respawning", async () => {
    const { client, workers } = makeClient({});
    client.start({ ...PARAMS }, handlers()); // A occupies the worker
    const idB = client.start({ ...PARAMS }, handlers()); // B queued worker-side
    const done = client.cancel(idB);
    expect(workers[0].posted).toContainEqual({ type: "cancel", jobId: idB });
    // The worker acknowledges the queued job as soon as it is dequeued
    // and skipped — before the 1 s deadline, so no terminate/respawn.
    workers[0].emit({ type: "cancelled", jobId: idB });
    await expect(done).resolves.toBeUndefined();
    expect(workers[0].terminated).toBe(false);
    expect(workers).toHaveLength(1);
  });

  it("cancel terminates and respawns the worker when no ack arrives in 1 s", async () => {
    vi.useFakeTimers();
    const { client, workers } = makeClient({ cancelAckTimeoutMs: 1000 });
    const id = client.start({ ...PARAMS }, handlers());
    const done = client.cancel(id);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(done).resolves.toBeUndefined();
    expect(workers[0].terminated).toBe(true);

    const id2 = client.start({ ...PARAMS }, handlers());
    expect(workers).toHaveLength(2);
    expect(workers[1].posted[0]).toEqual({
      type: "start",
      jobId: id2,
      ...PARAMS,
    });
  });

  it("cancel on a job that is not running resolves without a message", async () => {
    const { client, workers } = makeClient({});
    client.start({ ...PARAMS }, handlers());
    await expect(client.cancel(999)).resolves.toBeUndefined();
    expect(workers[0].posted).toHaveLength(1);
  });

  it("forwards engine errors to onError", () => {
    const { client, workers } = makeClient({});
    const h = handlers();
    const id = client.start({ ...PARAMS }, h);
    const err: NeoError = { kind: "BootstrapFailed", failed: 100, total: 100 };
    workers[0].emit({ type: "error", jobId: id, error: err });
    expect(h.calls).toEqual(["error:BootstrapFailed"]);
  });

  it("dispose terminates the worker", () => {
    const { client, workers } = makeClient({});
    client.start({ ...PARAMS }, handlers());
    client.dispose();
    expect(workers[0].terminated).toBe(true);
  });
});
