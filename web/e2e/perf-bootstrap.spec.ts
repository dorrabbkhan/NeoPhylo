// Bootstrap performance budgets (v1.2 plan Task 16, spec §8.5 and the
// plan's Global Constraints):
//   1. Lesson-sized data — nj-basics (6 taxa, 1,000 sites, JC69/NJ):
//      1,000 replicates finish in under 1 s in Chromium, measured as a
//      real run through the "How sure are we?" panel.
//   2. The large case — 200 × 1,000 protein, JTT, 100 replicates:
//      the ETA sent after replicate 0 is within 30% of the actual run
//      time, and a PerformanceObserver on "longtask" records no
//      main-thread task over 50 ms for the whole run.
//
// On failure these print the measurements and stop — the budgets are
// the spec's, not knobs to turn.
//
// Measured on Chromium only, against the production preview (:4174),
// matching perf-protein.spec.ts. Tagged @perf so scripts/ci/e2e.sh runs
// this file alone on a single worker — wall-clock budgets are
// meaningless under parallel test load. (The Long Tasks API is
// Chromium-only anyway.)

import { test, expect } from "@playwright/test";

import { stepToEnd, waitForApp } from "./helpers";

const PREVIEW_URL = "http://localhost:4174";

// Install the e2e page hook (window.__neophylo: engine + the shared
// BootstrapClient) before any app code runs.
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("neophylo-e2e", "1");
  });
});

/** Seeded PRNG (mulberry32); the task forbids Math.random. */
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

/** 200×1,000 protein FASTA: uniform root, ~20% mutated sites per taxon
 * (the same dense-table worst case perf-protein.spec.ts generates). */
function proteinFasta(seed: number): string {
  const TAXA = 200;
  const SITES = 1000;
  const AA = "ARNDCQEGHILKMFPSTWYV";
  const rnd = mulberry32(seed);
  const root = Array.from({ length: SITES }, () => Math.floor(rnd() * 20));
  const parts: string[] = [];
  for (let i = 0; i < TAXA; i++) {
    const seq = root.map((x) =>
      rnd() < 0.2 ? Math.floor(rnd() * 20) : x,
    );
    let line = "";
    for (const x of seq) line += AA[x];
    parts.push(`>P${String(i).padStart(3, "0")}`, line);
  }
  return parts.join("\n");
}

test(
  "nj-basics: 1,000 bootstrap replicates finish within the 1 s budget",
  { tag: "@perf" },
  async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    await page.goto(`${PREVIEW_URL}/?lesson=nj-basics`);
    await waitForApp(page);
    await stepToEnd(page);

    const replicates = page.getByRole("spinbutton", { name: "Replicates" });
    await expect(replicates).toBeVisible();
    await replicates.fill("1000");

    // Click-to-completion is what the student experiences: replicate 0,
    // the estimate round trip, then the batch loop in the worker.
    const t0 = Date.now();
    await page.getByRole("button", { name: /Run bootstrap/ }).click();
    await expect(
      page.locator(".bootstrap-panel [role=status]"),
    ).toContainText("Run complete", { timeout: 30_000 });
    const elapsed = Date.now() - t0;

    console.log(`perf-bootstrap: nj-basics 1,000 replicates took ${elapsed} ms`);
    expect(
      elapsed,
      `1,000 replicates on nj-basics took ${elapsed} ms (budget 1,000 ms)`,
    ).toBeLessThan(1000);
  },
);

test(
  "200×1,000 protein JTT: ETA within 30%, no main-thread task over 50 ms",
  { tag: "@perf" },
  async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    // ~100 JTT matrix+NJ rounds at 200 taxa — minutes, not the 30 s
    // default timeout.
    test.setTimeout(900_000);
    const fasta = proteinFasta(2026);

    await page.goto(`${PREVIEW_URL}/`);
    await waitForApp(page);

    const res = await page.evaluate(async (f) => {
      const w = window as unknown as {
        __neophylo: {
          engine: {
            parseFasta(t: string): {
              ok: boolean;
              value: unknown;
              error: { kind: string };
            };
          };
          bootstrapClient: {
            start(
              p: {
                alignment: unknown;
                model: string;
                method: string;
                seed: number;
                replicates: number;
              },
              h: {
                onEstimate(e: {
                  msPerReplicate: number;
                  totalMs: number;
                }): void;
                onProgress(p: { done: number }): void;
                onResult(r: { failed: number }): void;
                onError(e: { kind: string }): void;
              },
            ): number;
            confirm(jobId: number): void;
          };
        };
      };
      const { engine, bootstrapClient } = w.__neophylo;
      const parsed = engine.parseFasta(f);
      if (!parsed.ok) throw new Error(`parse failed: ${parsed.error.kind}`);

      // The Long Tasks API reports any main-thread task > 50 ms; the
      // budget is zero such tasks for the whole run.
      const longtasks: number[] = [];
      const observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) longtasks.push(e.duration);
      });
      observer.observe({ entryTypes: ["longtask"] });

      const out = await new Promise<{
        estimateMs: number;
        msPerReplicate: number;
        actualMs: number;
        failed: number;
        err: string;
      }>((resolve) => {
        const t0 = performance.now();
        let estimatedTotal = 0;
        let perRep = 0;
        const timer = setTimeout(
          () =>
            resolve({
              estimateMs: 0,
              msPerReplicate: 0,
              actualMs: performance.now() - t0,
              failed: -1,
              err: "timeout",
            }),
          600_000,
        );
        const jobId = bootstrapClient.start(
          {
            alignment: parsed.value,
            model: "Jtt",
            method: "Nj",
            seed: 1,
            replicates: 100,
          },
          {
            onEstimate: (e) => {
              // totalMs > 10,000 for this size, so the worker waits for
              // confirm — approve it exactly as the panel's button does.
              estimatedTotal = e.totalMs;
              perRep = e.msPerReplicate;
              bootstrapClient.confirm(jobId);
            },
            onProgress: () => {},
            onResult: (r) => {
              clearTimeout(timer);
              resolve({
                estimateMs: estimatedTotal,
                msPerReplicate: perRep,
                actualMs: performance.now() - t0,
                failed: r.failed,
                err: "",
              });
            },
            onError: (e) => {
              clearTimeout(timer);
              resolve({
                estimateMs: estimatedTotal,
                msPerReplicate: perRep,
                actualMs: performance.now() - t0,
                failed: -1,
                err: e.kind,
              });
            },
          },
        );
      });
      observer.disconnect();
      return { ...out, longtasks };
    }, fasta);

    expect(res.err, "the bootstrap job failed").toBe("");

    const etaError =
      Math.abs(res.estimateMs - res.actualMs) / res.actualMs;
    const worstTask =
      res.longtasks.length === 0 ? 0 : Math.max(...res.longtasks);
    console.log(
      `perf-bootstrap: 200×1,000 JTT ×100 — estimate ${res.estimateMs.toFixed(0)} ms ` +
        `(${res.msPerReplicate.toFixed(1)} ms/rep), actual ${res.actualMs.toFixed(0)} ms, ` +
        `eta error ${(etaError * 100).toFixed(1)}%, skipped replicates ${res.failed}, ` +
        `longtasks ${res.longtasks.length} (worst ${worstTask.toFixed(1)} ms)`,
    );

    expect(
      etaError,
      `ETA ${res.estimateMs.toFixed(0)} ms vs actual ${res.actualMs.toFixed(0)} ms ` +
        `(off by ${(etaError * 100).toFixed(1)}%, budget 30%)`,
    ).toBeLessThanOrEqual(0.3);
    expect(
      res.longtasks,
      `main-thread tasks over 50 ms during the run: ${res.longtasks
        .map((d) => d.toFixed(1))
        .join(", ")}`,
    ).toEqual([]);
  },
);
