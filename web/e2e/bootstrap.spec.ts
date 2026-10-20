// Bootstrap worker + client e2e (v1.2 plan Task 9, spec §5 and §8.4):
// a real Web Worker running the real wasm engine, driven through the
// `neophylo-e2e` localStorage flag that main.tsx installs (it exposes
// `__neophylo` with the engine wrapper, the BootstrapClient class and a
// shared client). A query param can't work — the app's URL
// replaceState sync strips unknown params before the offline reload.
// Covers cancel's 1 s settle, stale jobId filtering under a forced
// message delay, and an offline run through the PWA precache.

import { test, expect } from "@playwright/test";

import { stepToEnd, waitForApp } from "./helpers";

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

// Review Focus 5 (v1.2 Task 11): with a reference, NJ's tree is drawn
// rerooted on the reference's outgroup; support labels come from the
// run's tally and every grouping is labeled exactly once.
test("cytochrome-c: drawn support matches the tally, each grouping labeled once", async ({
  page,
}) => {
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);
  await stepToEnd(page);
  await page
    .getByRole("button", { name: /Run bootstrap/ })
    .click();
  await expect(
    page.locator(".bootstrap-panel [role=status]"),
  ).toContainText("Run complete", { timeout: 30_000 });

  // Independently recompute the whole pipeline in the page: the same
  // exercise, distances, NJ tree, tally (seed 1, replicates 1..100),
  // support-bearing tree and reroot-on-outgroup result the app drew.
  const expected = await page.evaluate(async () => {
    const w = window as unknown as {
      __neophylo: {
        engine: {
          parseFasta(t: string): { ok: boolean; value: unknown };
          parseNewick(t: string): { ok: boolean; value: unknown };
          distances(
            a: unknown,
            model: string,
          ): { ok: boolean; value: unknown };
          buildTree(
            m: unknown,
            method: string,
            opts: { trace: boolean },
          ): { ok: boolean; value: { tree: unknown } };
          bootstrapBatch(
            a: unknown,
            model: string,
            method: string,
            seed: number,
            start: number,
            count: number,
          ): {
            ok: boolean;
            value: {
              labels: string[];
              counts: { labels: string[]; count: number }[];
              successful: number;
            };
          };
          supportOnTree(t: unknown, tally: unknown): {
            ok: boolean;
            value: unknown;
          };
          referenceOutgroup(t: unknown): { ok: boolean; value: string[] };
          rerootOnOutgroup(
            t: unknown,
            og: string[],
          ): {
            ok: boolean;
            value: {
              tree: {
                nodes: { parent: number | null; children: number[]; label: string | null }[];
                branches: { length: number | null; support: number | null }[];
                root: number;
              };
              outgroup_is_group: boolean;
            };
          };
        };
      };
    };
    const { engine } = w.__neophylo;
    const ex = await fetch("/exercises/cytochrome-c.json").then((r) =>
      r.json(),
    );
    const aln = engine.parseFasta(ex.data.fasta);
    if (!aln.ok) throw new Error("parseFasta failed");
    const m = engine.distances(aln.value, "Jtt");
    if (!m.ok) throw new Error("distances failed");
    const built = engine.buildTree(m.value, "Nj", { trace: false });
    if (!built.ok) throw new Error("buildTree failed");
    const tally = engine.bootstrapBatch(aln.value, "Jtt", "Nj", 1, 0, 100);
    if (!tally.ok) throw new Error("bootstrapBatch failed");
    const supportTree = engine.supportOnTree(built.value.tree, tally.value);
    if (!supportTree.ok) throw new Error("supportOnTree failed");
    const ref = engine.parseNewick(ex.reference.newick);
    if (!ref.ok) throw new Error("parseNewick failed");
    const og = engine.referenceOutgroup(ref.value);
    if (!og.ok) throw new Error("referenceOutgroup failed");
    const rr = engine.rerootOnOutgroup(supportTree.value, og.value);
    if (!rr.ok) throw new Error("rerootOnOutgroup failed");
    const t = rr.value.tree;
    const leafSet = (id: number): Set<string> => {
      const n = t.nodes[id];
      if (n.children.length === 0 && n.label !== null)
        return new Set([n.label]);
      const out = new Set<string>();
      for (const c of n.children)
        leafSet(c).forEach((l) => out.add(l));
      return out;
    };
    // The (horse, human) split's tally support → the expected label.
    // A Split serializes canonically: the side holding the smallest
    // label, so a grouping may be stored as its complement.
    const all = new Set<string>(tally.value.labels);
    const hhSide = new Set(["horse", "human"]);
    const rowMatches = (row: string[], side: Set<string>) =>
      row.length === side.size && row.every((l) => side.has(l));
    const hh = tally.value.counts.find((c) => {
      if (rowMatches(c.labels, hhSide)) return true;
      const comp: string[] = [];
      all.forEach((l) => {
        if (!c.labels.includes(l)) comp.push(l);
      });
      return rowMatches(comp, hhSide);
    });
    if (hh === undefined) throw new Error("no (horse,human) tally row");
    const hhPct = Math.round((100 * hh.count) / tally.value.successful);
    // Node id whose leaf set is exactly {horse, human} in the drawn
    // (rerooted) tree — its branch carries that split's support.
    let hhNode = -1;
    for (let i = 0; i < t.nodes.length; i++) {
      const s = leafSet(i);
      if (s.size === 2 && s.has("horse") && s.has("human")) hhNode = i;
    }
    if (hhNode < 0) throw new Error("(horse,human) clade not found");
    const labeledEdges = t.nodes.filter(
      (n, i) => n.parent !== null && t.branches[i].support !== null,
    ).length;
    return { hhPct, hhNode, labeledEdges };
  });

  const svg = page.locator('svg[aria-label="Inferred tree"]');
  // Every grouping is labeled exactly once — including the split the
  // display was rooted on, which must not appear on both root edges.
  await expect(svg.locator(".support-label")).toHaveCount(
    expected.labeledEdges,
  );
  await expect(
    svg.locator(`g[data-node="${expected.hhNode}"] .support-label`),
  ).toHaveText(String(expected.hhPct));
  // The default caption states the drawing's root came from the
  // reference's outgroup.
  await expect(
    page.getByText(
      "Drawn with the same outgroup as the reference; rerooting " +
        "changes only the drawing, not the groupings.",
    ),
  ).toBeVisible();
});
