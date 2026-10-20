// runBootstrapJob (spec §5) exercised in-process: the wasm engine is
// initialized once in src/test/setup.ts, so the job logic runs against
// the real engine without a Worker. The plan's Step-1 cases: parity
// with direct engine calls, monotone progress, cancel between batches,
// and the confirm gate.

import { describe, expect, it } from "vitest";

import type { ConsensusKind } from "./generated/ConsensusKind";
import type { Alignment } from "./generated/Alignment";
import type { BootstrapParams, WorkerToPageJob } from "./bootstrapProtocol";
import { engine } from "./index";
import { runBootstrapJob } from "./worker";

/** Seeded PRNG (mulberry32); unseeded randomness is forbidden. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic DNA alignment: a root sequence mutated at p ≈ 0.25. */
function dnaAlignment(taxa: number, sites: number, seed: number): Alignment {
  const rnd = mulberry32(seed);
  const acgt = "ACGT";
  const root = Array.from({ length: sites }, () => Math.floor(rnd() * 4));
  const lines: string[] = [];
  for (let i = 0; i < taxa; i++) {
    const seq = root
      .map((b) => acgt[rnd() < 0.25 ? Math.floor(rnd() * 4) : b])
      .join("");
    lines.push(`>t${i}`, seq);
  }
  const parsed = engine.parseFasta(lines.join("\n"));
  if (!parsed.ok) throw new Error("test alignment failed to parse");
  return parsed.value;
}

function params(over: Partial<BootstrapParams> = {}): BootstrapParams {
  return {
    alignment: dnaAlignment(8, 200, 42),
    model: "Jc69",
    method: "Nj",
    seed: 7,
    replicates: 20,
    ...over,
  };
}

async function collect(
  p: BootstrapParams,
  shouldStop: () => boolean = () => false,
  waitConfirm: () => Promise<boolean> = () => Promise.resolve(true),
): Promise<WorkerToPageJob[]> {
  const msgs: WorkerToPageJob[] = [];
  await runBootstrapJob(p, (m) => msgs.push(m), shouldStop, waitConfirm);
  return msgs;
}

const KINDS: ConsensusKind[] = ["Strict", "Majority", "Extended"];

describe("runBootstrapJob", () => {
  it("emits a result identical to direct engine calls for the same seed", async () => {
    const p = params();
    const msgs = await collect(p);
    const result = msgs.find((m) => m.type === "result");
    expect(result).toBeDefined();
    if (result === undefined || result.type !== "result") return;

    // The oracle: one bootstrap_batch over 0..N merged by the caller,
    // then support_on_tree, consensus and consensus_dropped exactly as
    // the result message assembles them.
    const tally = engine.bootstrapBatch(
      p.alignment,
      p.model,
      p.method,
      p.seed,
      0,
      p.replicates,
    );
    expect(tally.ok).toBe(true);
    if (!tally.ok) return;
    const dist = engine.distances(p.alignment, p.model);
    const built = dist.ok
      ? engine.buildTree(dist.value, p.method, { trace: false })
      : null;
    expect(built?.ok).toBe(true);
    if (!dist.ok || built === null || !built.ok) return;

    const support = engine.supportOnTree(built.value.tree, tally.value);
    expect(support.ok).toBe(true);
    if (!support.ok) return;

    expect(result.tally).toEqual(tally.value);
    expect(result.support).toEqual(support.value);
    expect(result.failed).toBe(tally.value.failed);
    for (const kind of KINDS) {
      const cons = engine.consensus(tally.value, kind, tally.value.labels);
      expect(cons.ok).toBe(true);
      if (cons.ok) expect(result.consensus[kind]).toEqual(cons.value);
      const dropped = engine.consensusDropped(
        built.value.tree,
        tally.value,
        kind,
      );
      expect(dropped.ok).toBe(true);
      if (dropped.ok) expect(result.dropped[kind]).toEqual(dropped.value);
    }
  });

  it("posts an estimate after replicate 0, then progress with done strictly increasing to N", async () => {
    const p = params({ replicates: 30 });
    const msgs = await collect(p);
    expect(msgs[0]?.type).toBe("estimate");
    const progress = msgs.filter((m) => m.type === "progress");
    expect(progress.length).toBeGreaterThan(0);
    for (let i = 0; i < progress.length; i++) {
      const m = progress[i];
      if (m.type !== "progress") continue;
      expect(m.total).toBe(30);
      if (i > 0) {
        const prev = progress[i - 1];
        if (prev.type === "progress") expect(m.done).toBeGreaterThan(prev.done);
      }
    }
    const last = progress[progress.length - 1];
    if (last.type === "progress") expect(last.done).toBe(30);
    expect(msgs[msgs.length - 1]?.type).toBe("result");
  });

  it("a shouldStop after two batches ends the job with no result", async () => {
    // 30 taxa × 2,000 sites keeps each replicate over ~1 ms, so the
    // 100 ms batch sizing yields many batches even on a fast CI host.
    const p = params({
      alignment: dnaAlignment(30, 2000, 7),
      replicates: 1000,
    });
    let progressSeen = 0;
    const msgs: WorkerToPageJob[] = [];
    await runBootstrapJob(
      p,
      (m) => {
        msgs.push(m);
        if (m.type === "progress") progressSeen += 1;
      },
      () => progressSeen >= 2,
      () => Promise.resolve(true),
    );
    expect(progressSeen).toBeGreaterThanOrEqual(2);
    expect(msgs.some((m) => m.type === "result")).toBe(false);
    expect(msgs.some((m) => m.type === "error")).toBe(false);
  });

  it("still has no result when the stop lands after the final batch", async () => {
    const p = params();
    const msgs: WorkerToPageJob[] = [];
    // shouldStop only becomes true once the run is complete — the
    // pre-result check must still suppress the result.
    await runBootstrapJob(
      p,
      (m) => msgs.push(m),
      () => msgs.some((m) => m.type === "progress" && m.done === p.replicates),
      () => Promise.resolve(true),
    );
    expect(msgs.some((m) => m.type === "result")).toBe(false);
  });

  it("waits for confirmation and sends no batches when it is declined", async () => {
    const p = params();
    const msgs = await collect(
      p,
      () => false,
      () => Promise.resolve(false),
    );
    // Declining during the confirm wait ends the job after the
    // estimate: no progress, no result.
    expect(msgs.map((m) => m.type)).toEqual(["estimate"]);
  });
});
