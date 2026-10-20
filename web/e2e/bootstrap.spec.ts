// Bootstrap worker + client e2e (v1.2 plan Task 9, spec §5 and §8.4):
// a real Web Worker running the real wasm engine, driven through the
// `neophylo-e2e` localStorage flag that main.tsx installs (it exposes
// `__neophylo` with the engine wrapper, the BootstrapClient class and a
// shared client). A query param can't work — the app's URL
// replaceState sync strips unknown params before the offline reload.
// Covers cancel's 1 s settle, stale jobId filtering under a forced
// message delay, and an offline run through the PWA precache.

import { test, expect } from "@playwright/test";

import { waitForApp } from "./helpers";

const PREVIEW_URL = "http://localhost:4174";

// Install the e2e page hook before any app code runs, on every
// navigation (including the offline reload).
test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    window.localStorage.setItem("neophylo-e2e", "1");
  });
});

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

/** Deterministic DNA FASTA: a root sequence mutated at the given rate. */
function dnaFasta(taxa: number, sites: number, rate: number, seed: number): string {
  const rnd = mulberry32(seed);
  const acgt = "ACGT";
  const root = Array.from({ length: sites }, () => Math.floor(rnd() * 4));
  const parts: string[] = [];
  for (let i = 0; i < taxa; i++) {
    const seq = root
      .map((b) => acgt[rnd() < rate ? Math.floor(rnd() * 4) : b])
      .join("");
    parts.push(`>t${i}`, seq);
  }
  return parts.join("\n");
}

test("cancel mid-run settles within 1 s", async ({ page }) => {
  await page.goto("/");
  await waitForApp(page);
  const fasta = dnaFasta(24, 1500, 0.25, 11);

  const res = await page.evaluate(async (f) => {
    const w = window as unknown as {
      __neophylo: {
        engine: {
          parseFasta(t: string): { ok: boolean; value: unknown; error: { kind: string } };
        };
        bootstrapClient: {
          start(
            p: { alignment: unknown; model: string; method: string; seed: number; replicates: number },
            h: {
              onEstimate(e: unknown): void;
              onProgress(p: unknown): void;
              onResult(r: unknown): void;
              onError(e: { kind: string }): void;
            },
          ): number;
          cancel(jobId: number): Promise<void>;
        };
      };
    };
    const { engine, bootstrapClient } = w.__neophylo;
    const parsed = engine.parseFasta(f);
    if (!parsed.ok) throw new Error(`parse failed: ${parsed.error.kind}`);
    const events: string[] = [];
    const id = bootstrapClient.start(
      { alignment: parsed.value, model: "Jc69", method: "Nj", seed: 1, replicates: 1000 },
      {
        onEstimate: () => events.push("estimate"),
        onProgress: () => events.push("progress"),
        onResult: () => events.push("result"),
        onError: (e) => events.push(`error:${e.kind}`),
      },
    );
    // Let the worker spin up (wasm init + replicate 0 + some batches).
    await new Promise((r) => setTimeout(r, 500));
    const t0 = performance.now();
    await bootstrapClient.cancel(id);
    const cancelMs = performance.now() - t0;
    await new Promise((r) => setTimeout(r, 100));
    return { cancelMs, events };
  }, fasta);

  expect(res.cancelMs).toBeLessThan(1000);
  expect(res.events).not.toContain("result");
  expect(res.events.some((e) => e.startsWith("error"))).toBe(false);
});

test("starting job B while A runs ignores A's late messages", async ({
  page,
}) => {
  // Forced delay hook: the shim re-emits the worker's first progress
  // message (job A's) 1 s later, so a jobId-A message provably lands
  // after B is the current job — on top of the natural in-flight
  // progress a mid-batch cancel produces. The route wraps the worker
  // script (dev: /src/engine/worker.ts, build: assets/worker-*.js).
  // The \n guards against a trailing // comment (sourceMappingURL)
  // swallowing the appended code.
  await page.route(/\/worker[.-]/, async (route) => {
    const res = await route.fetch();
    const body =
      (await res.text()) +
      "\n;const __post=self.postMessage.bind(self);let __seen=false;" +
      "self.postMessage=(m)=>{" +
      "if(!__seen&&m.type==='progress'){__seen=true;setTimeout(()=>__post(m),1000);}" +
      "__post(m);};";
    await route.fulfill({ response: res, body });
  });

  await page.goto("/");
  await waitForApp(page);
  const heavy = dnaFasta(24, 1500, 0.25, 3);
  const light = dnaFasta(8, 200, 0.25, 5);

  const res = await page.evaluate(
    async ({ heavy, light }) => {
      const w = window as unknown as {
        __stale: string[];
        __neophylo: {
          engine: {
            parseFasta(t: string): {
              ok: boolean;
              value: unknown;
              error: { kind: string };
            };
          };
          BootstrapClient: new (opts: {
            onStaleMessage(m: { type: string }): void;
          }) => {
            confirm(jobId: number): void;
            start(
              p: {
                alignment: unknown;
                model: string;
                method: string;
                seed: number;
                replicates: number;
              },
              h: {
                onEstimate(e: unknown): void;
                onProgress(p: unknown): void;
                onResult(r: unknown): void;
                onError(e: { kind: string }): void;
              },
            ): number;
            dispose(): void;
          };
        };
      };
      const { engine, BootstrapClient } = w.__neophylo;
      const aln = (f: string) => {
        const p = engine.parseFasta(f);
        if (!p.ok) throw new Error(`parse failed: ${p.error.kind}`);
        return p.value;
      };
      const client = new BootstrapClient({
        onStaleMessage: (m) => {
          (w.__stale ??= []).push(m.type);
        },
      });
      const lateA: string[] = [];
      let bCurrent = false;
      let resolveB: () => void = () => {};
      const doneB = new Promise<void>((r) => {
        resolveB = r;
      });
      let aRunning = false;
      const mark = (e: string) => {
        if (e === "progress") aRunning = true;
        if (bCurrent) lateA.push(e);
      };
      const jobA = client.start(
        { alignment: aln(heavy), model: "Jc69", method: "Nj", seed: 1, replicates: 1000 },
        {
          // Over the confirm threshold the estimate lands here —
          // approve it so A always reaches the batch loop.
          onEstimate: () => {
            mark("estimate");
            client.confirm(jobA);
          },
          onProgress: () => mark("progress"),
          onResult: () => mark("result"),
          onError: (e) => mark(`error:${e.kind}`),
        },
      );
      // Wait until A is mid-run (its first progress), then start B.
      // The shim's re-emitted progress lands 1 s later — while B is
      // current — as a stale jobId-A message.
      const deadline = performance.now() + 25_000;
      while (!aRunning && performance.now() < deadline) {
        await new Promise((r) => setTimeout(r, 25));
      }
      if (!aRunning) throw new Error("job A never reached progress");
      bCurrent = true;
      let bResult = false;
      client.start(
        { alignment: aln(light), model: "Jc69", method: "Nj", seed: 1, replicates: 10 },
        {
          onEstimate: () => {},
          onProgress: () => {},
          onResult: () => {
            bResult = true;
            resolveB();
          },
          onError: () => resolveB(),
        },
      );
      await doneB;
      // Drain the re-emitted progress (fires 1 s after A's first
      // progress) plus anything else still in flight.
      await new Promise((r) => setTimeout(r, 1300));
      client.dispose();
      return { lateA, bResult, stale: w.__stale ?? [] };
    },
    { heavy, light },
  );

  expect(res.bResult).toBe(true);
  expect(res.lateA).toEqual([]);
  expect(res.stale.length).toBeGreaterThan(0);
});

test("after one online load, a bootstrap run works offline", async ({
  page,
  context,
  browserName,
}) => {
  // Same Chromium-only limitation as the a11y offline spec: Playwright's
  // offline emulation breaks SW navigations on Firefox and WebKit.
  test.skip(browserName !== "chromium");
  await page.goto(`${PREVIEW_URL}/`);
  await waitForApp(page);
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return reg !== undefined && reg !== null && reg.active !== null;
  });

  await context.setOffline(true);
  await page.reload();
  await waitForApp(page);

  const fasta = dnaFasta(8, 300, 0.25, 9);
  const res = await page.evaluate(async (f) => {
    const w = window as unknown as {
      __neophylo: {
        engine: {
          parseFasta(t: string): { ok: boolean; value: unknown; error: { kind: string } };
        };
        bootstrapClient: {
          start(
            p: { alignment: unknown; model: string; method: string; seed: number; replicates: number },
            h: {
              onEstimate(e: unknown): void;
              onProgress(p: unknown): void;
              onResult(r: unknown): void;
              onError(e: { kind: string }): void;
            },
          ): number;
        };
      };
    };
    const { engine, bootstrapClient } = w.__neophylo;
    const parsed = engine.parseFasta(f);
    if (!parsed.ok) throw new Error(`parse failed: ${parsed.error.kind}`);
    return await new Promise<{ ok: boolean; err: string }>((resolve) => {
      const timer = setTimeout(
        () => resolve({ ok: false, err: "timeout" }),
        20_000,
      );
      bootstrapClient.start(
        { alignment: parsed.value, model: "Jc69", method: "Nj", seed: 1, replicates: 20 },
        {
          onEstimate: () => {},
          onProgress: () => {},
          onResult: () => {
            clearTimeout(timer);
            resolve({ ok: true, err: "" });
          },
          onError: (e) => {
            clearTimeout(timer);
            resolve({ ok: false, err: e.kind });
          },
        },
      );
    });
  }, fasta);

  expect(res.err).toBe("");
  expect(res.ok).toBe(true);
});
