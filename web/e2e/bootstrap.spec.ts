// Bootstrap worker + client e2e (v1.2 plan Task 9, spec §5 and §8.4):
// a real Web Worker running the real wasm engine, driven through the
// `neophylo-e2e` localStorage flag that main.tsx installs (it exposes
// `__neophylo` with the engine wrapper, the BootstrapClient class and a
// shared client). A query param can't work — the app's URL
// replaceState sync strips unknown params before the offline reload.
// Covers cancel's 1 s settle, stale jobId filtering under a forced
// message delay, and an offline run through the PWA precache.

import { readFile } from "node:fs/promises";

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

// Task 12 (spec §6.4): the majority-rule consensus tab draws the
// consensus tree as a cladogram, rerooted on the reference's outgroup
// like the support tree — cytochrome-c puts wheat on its own branch —
// with support labels that never clip or overlap.
test("cytochrome-c: majority-rule view rooted like the reference, wheat on its own branch", async ({
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

  await page.getByRole("tab", { name: "Majority-rule" }).click();
  const svg = page.locator('svg[aria-label="Majority-rule consensus"]');
  await expect(svg).toBeVisible();

  // Recompute the expected drawing in the page: majority consensus of
  // the same tally, rerooted on the reference's outgroup (wheat).
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
          bootstrapBatch(
            a: unknown,
            model: string,
            method: string,
            seed: number,
            start: number,
            count: number,
          ): { ok: boolean; value: unknown };
          consensus(
            tally: unknown,
            kind: string,
            labels: string[],
          ): { ok: boolean; value: unknown };
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
    const tally = engine.bootstrapBatch(aln.value, "Jtt", "Nj", 1, 0, 100);
    if (!tally.ok) throw new Error("bootstrapBatch failed");
    const labels = (tally.value as { labels: string[] }).labels;
    const cons = engine.consensus(tally.value, "Majority", labels);
    if (!cons.ok) throw new Error("consensus failed");
    const ref = engine.parseNewick(ex.reference.newick);
    if (!ref.ok) throw new Error("parseNewick failed");
    const og = engine.referenceOutgroup(ref.value);
    if (!og.ok) throw new Error("referenceOutgroup failed");
    const rr = engine.rerootOnOutgroup(cons.value, og.value);
    if (!rr.ok) throw new Error("rerootOnOutgroup failed");
    const t = rr.value.tree;
    // Wheat on its own branch: its leaf hangs directly off the new
    // degree-2 root.
    const wheat = t.nodes.findIndex((n) => n.label === "wheat");
    const own = wheat >= 0 && t.nodes[wheat].parent === t.root;
    const labeledEdges = t.nodes.filter(
      (n, i) => n.parent !== null && t.branches[i].support !== null,
    ).length;
    return { nodes: t.nodes.length, og: og.value, own, labeledEdges };
  });

  expect(expected.og).toEqual(["wheat"]);
  expect(expected.own).toBe(true);
  await expect(svg.locator("[data-node]")).toHaveCount(expected.nodes);
  await expect(svg.locator(".support-label")).toHaveCount(
    expected.labeledEdges,
  );

  // The rerooted-consensus caption is the same as the support view's.
  await expect(
    page.getByText(
      "Drawn with the same outgroup as the reference; rerooting " +
        "changes only the drawing, not the groupings.",
    ),
  ).toBeVisible();

  // No support pill intersects a node marker, a leaf name or another
  // pill (the checkpoint-11 box check, on the consensus svg).
  const overlaps = await svg.evaluate((el) => {
    const box = (e: Element) => (e as SVGGraphicsElement).getBBox();
    const pills = Array.from(
      el.querySelectorAll("rect.support-pill"),
    ).map(box);
    const markers = Array.from(
      el.querySelectorAll("g[data-node] > circle"),
    ).map(box);
    const names = Array.from(el.querySelectorAll("g[data-node] > text"))
      .filter((t) => !t.classList.contains("support-label"))
      .map(box);
    const hit = (
      a: { x: number; y: number; width: number; height: number },
      b: { x: number; y: number; width: number; height: number },
    ) =>
      a.x < b.x + b.width &&
      a.x + a.width > b.x &&
      a.y < b.y + b.height &&
      a.y + a.height > b.y;
    const out: string[] = [];
    pills.forEach((p, i) => {
      markers.forEach((m, j) => {
        if (hit(p, m)) out.push(`pill ${i} vs marker ${j}`);
      });
      names.forEach((n, j) => {
        if (hit(p, n)) out.push(`pill ${i} vs name ${j}`);
      });
      pills.forEach((q, j) => {
        if (j > i && hit(p, q)) out.push(`pill ${i} vs pill ${j}`);
      });
    });
    return out;
  });
  expect(overlaps).toEqual([]);
});

// Checkpoint 11 acceptance: at the final step with a done 100-replicate
// run (seed 1), no support label's pill box intersects a node marker, a
// leaf name or another label — in BOTH the rooted (default) and the
// computed (unrooted) views. Screenshots of both views are written to
// test-results/ for the PR.
test("cytochrome-c: support labels never overlap markers, names or each other", async ({
  page,
}) => {
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);
  await stepToEnd(page);
  await page.getByRole("button", { name: /Run bootstrap/ }).click();
  await expect(
    page.locator(".bootstrap-panel [role=status]"),
  ).toContainText("Run complete", { timeout: 30_000 });

  const svg = page.locator('svg[aria-label="Inferred tree"]');
  await expect(svg.locator(".support-label").first()).toBeVisible();

  interface Box {
    x: number;
    y: number;
    width: number;
    height: number;
  }
  const hit = (a: Box, b: Box) =>
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y;

  /** All overlap violations in the inferred-tree svg, as strings. */
  const overlaps = () =>
    svg.evaluate((el) => {
      const box = (e: Element) => (e as SVGGraphicsElement).getBBox();
      const pills = Array.from(
        el.querySelectorAll("rect.support-pill"),
      ).map(box);
      const markers = Array.from(
        el.querySelectorAll("g[data-node] > circle"),
      ).map(box);
      // Leaf names and any drawn node/zero-length labels (support text
      // lives inside the pill and is excluded).
      const names = Array.from(el.querySelectorAll("g[data-node] > text"))
        .filter((t) => !t.classList.contains("support-label"))
        .map(box);
      const out: string[] = [];
      const overlap = (a: Box, b: Box) =>
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y;
      pills.forEach((p, i) => {
        markers.forEach((m, j) => {
          if (overlap(p, m)) out.push(`pill ${i} vs marker ${j}`);
        });
        names.forEach((n, j) => {
          if (overlap(p, n)) out.push(`pill ${i} vs name ${j}`);
        });
        pills.forEach((q, j) => {
          if (j > i && overlap(p, q)) out.push(`pill ${i} vs pill ${j}`);
        });
      });
      return out;
    });

  /** On-segment convention (21-10-26 refinement): no leader callouts,
   * and each pill's centre stays within 10 px of its node's row — a
   * short segment lets the pill overhang left past its start instead
   * (the pill's background masks the parent's vertical line). */
  const placement = () =>
    svg.evaluate((el) => {
      const out: string[] = [];
      el.querySelectorAll("g[data-node]").forEach((g) => {
        if (
          g.querySelector(":scope > g.support > line.support-leader") !==
          null
        )
          out.push(`leader on node ${g.getAttribute("data-node")}`);
        const pill = g.querySelector(
          ":scope > g.support > rect.support-pill",
        );
        if (pill === null) return;
        const pb = (pill as SVGGraphicsElement).getBBox();
        const cy = Number(
          g.querySelector(":scope > circle")!.getAttribute("cy"),
        );
        const dy = Math.abs(pb.y + pb.height / 2 - cy);
        if (dy > 10 + 1e-6)
          out.push(
            `node ${g.getAttribute("data-node")}: ${dy.toFixed(1)} px off-row`,
          );
      });
      return out;
    });

  /** Font size of the leaf named "human" in the inferred svg. */
  const leafFont = () =>
    svg.evaluate(
      (el) =>
        Array.from(el.querySelectorAll("g[data-node] > text")).find(
          (t) => t.textContent === "human",
        )?.getAttribute("font-size") ?? null,
    );

  // Rooted view (default, §6.7).
  expect(await overlaps()).toEqual([]);
  expect(await placement()).toEqual([]);
  const rootedFont = await leafFont();
  expect(Number(rootedFont)).toBeGreaterThanOrEqual(12);
  await page
    .locator(".tree-col")
    .screenshot({ path: "test-results/c11-support-rooted.png" });

  // Computed (unrooted) view.
  const toggle = page.getByRole("button", {
    name: "Show as computed (unrooted)",
  });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await toggle.click();
  await expect(
    page.getByRole("button", { name: "Show rooted like the reference" }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(await overlaps()).toEqual([]);
  expect(await placement()).toEqual([]);
  // Text size is independent of the drawing: same font size as rooted.
  expect(await leafFont()).toBe(rootedFont);
  await page
    .locator(".tree-col")
    .screenshot({ path: "test-results/c11-support-computed.png" });

  // Sanity: the helper actually intersects boxes that touch.
  expect(
    hit({ x: 0, y: 0, width: 4, height: 4 }, { x: 3, y: 3, width: 4, height: 4 }),
  ).toBe(true);
});

// Measured text sizes (owner fix): placement must hold whatever font
// the system resolves — the overlap failure this test reproduces was a
// vertical graze under a font whose descent exceeds the 0.5em estimate
// (Firefox's system-ui on Linux). Forcing a different, wider family on
// every text element stands in for any unexpected installed font; the
// label layout re-measures and stays clear.
test("cytochrome-c: label placement holds under a substituted font", async ({
  page,
}) => {
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);
  await stepToEnd(page);
  await page.getByRole("button", { name: /Run bootstrap/ }).click();
  await expect(
    page.locator(".bootstrap-panel [role=status]"),
  ).toContainText("Run complete", { timeout: 30_000 });

  const svg = page.locator('svg[aria-label="Inferred tree"]');
  await expect(svg.locator(".support-label").first()).toBeVisible();

  const overlaps = () =>
    svg.evaluate((el) => {
      const box = (e: Element) => (e as SVGGraphicsElement).getBBox();
      const pills = Array.from(
        el.querySelectorAll("rect.support-pill"),
      ).map(box);
      const markers = Array.from(
        el.querySelectorAll("g[data-node] > circle"),
      ).map(box);
      const names = Array.from(el.querySelectorAll("g[data-node] > text"))
        .filter((t) => !t.classList.contains("support-label"))
        .map(box);
      const out: string[] = [];
      const overlap = (a: DOMRect, b: DOMRect) =>
        a.x < b.x + b.width &&
        a.x + a.width > b.x &&
        a.y < b.y + b.height &&
        a.y + a.height > b.y;
      pills.forEach((p, i) => {
        markers.forEach((m, j) => {
          if (overlap(p, m)) out.push(`pill ${i} vs marker ${j}`);
        });
        names.forEach((n, j) => {
          if (overlap(p, n)) out.push(`pill ${i} vs name ${j}`);
        });
        pills.forEach((q, j) => {
          if (j > i && overlap(p, q)) out.push(`pill ${i} vs pill ${j}`);
        });
      });
      return out;
    });

  expect(await overlaps()).toEqual([]);

  const pillGeom = () =>
    svg.evaluate((el) =>
      Array.from(el.querySelectorAll("rect.support-pill")).map(
        (r) =>
          `${r.getAttribute("x")},${r.getAttribute("y")},${r.getAttribute("width")}`,
      ),
    );
  const before = await pillGeom();

  // Swap every text element's family — the probe that measures extents
  // lives under the same rules, so the next layout uses the new font's
  // real widths and glyph boxes.
  await page.addStyleTag({
    content: `text { font-family: "DejaVu Sans", serif !important; }`,
  });
  // A resize refires the ResizeObserver so treeFigure re-runs and the
  // pills are re-placed under the substituted font.
  await page.setViewportSize({ width: 1400, height: 900 });
  await expect(svg.locator(".support-label").first()).toBeVisible();
  const resolved = await svg.evaluate(
    (el) =>
      getComputedStyle(el.querySelector("g[data-node] > text")!)
        .fontFamily,
  );
  expect(resolved).toMatch(/dejavu|serif/i);
  // Re-layout really happened: at least one pill re-measured to a
  // different position or width under the new font.
  expect(await pillGeom()).not.toEqual(before);
  expect(await overlaps()).toEqual([]);
});

// Checkpoint 15: the Export menu names the drawing each item exports —
// the rerooted-on-outgroup view or the computed (unrooted) view — and
// the downloaded Newick's top-level structure matches the name. The
// toggle sits below the column's scroll overflow: clicking it must not
// leave the computed drawing's top clipped, so every leaf name and the
// panel title stay visible without scrolling (the owner saw zebrafish
// and the title cut off).
test("cytochrome-c: export items name the drawing, all leaves visible in both views", async ({
  page,
}) => {
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);
  await stepToEnd(page);

  const menu = page.locator(".export-menu");
  const item = (name: string) =>
    menu.getByRole("button", { name, exact: true });

  /** Click an export item and return the downloaded file's text. */
  const downloadText = async (name: string): Promise<string> => {
    const [dl] = await Promise.all([
      page.waitForEvent("download"),
      item(name).click(),
    ]);
    return readFile((await dl.path())!, "utf8");
  };

  /** Parse a Newick string in the page: is wheat a direct root child? */
  const wheatAtTop = (nwk: string) =>
    page.evaluate((text) => {
      const w = window as unknown as {
        __neophylo: {
          engine: {
            parseNewick(t: string): {
              ok: boolean;
              value: {
                nodes: { parent: number | null; label: string | null }[];
                root: number;
              };
            };
          };
        };
      };
      const r = w.__neophylo.engine.parseNewick(text);
      if (!r.ok) throw new Error("downloaded Newick failed to parse");
      const wheat = r.value.nodes.findIndex((n) => n.label === "wheat");
      return wheat >= 0 && r.value.nodes[wheat].parent === r.value.root;
    }, nwk);

  // Rooted-like-the-reference view (default, §6.7): every tree item
  // names the outgroup, and the exported Newick is rooted with wheat
  // on its own top-level branch.
  for (const name of [
    "Newick (rooted on wheat)",
    "SVG (rooted on wheat)",
    "PNG (rooted on wheat)",
    "Consensus (Newick, rooted on wheat)",
  ]) {
    await expect(item(name)).toBeVisible();
  }
  expect(await wheatAtTop(await downloadText("Newick (rooted on wheat)")))
    .toBe(true);

  // Computed view: the labels follow the toggle immediately.
  await page
    .getByRole("button", { name: "Show as computed (unrooted)" })
    .click();
  for (const name of [
    "Newick (as computed, unrooted)",
    "SVG (as computed, unrooted)",
    "PNG (as computed, unrooted)",
    "Consensus (Newick, as computed, unrooted)",
  ]) {
    await expect(item(name)).toBeVisible();
  }
  expect(await wheatAtTop(await downloadText("Newick (as computed, unrooted)")))
    .toBe(false);

  // Every leaf name and the panel title are on screen without
  // scrolling the tree column — in BOTH views — getBoundingClientRect,
  // since toBeVisible ignores overflow clipping.
  const LEAVES = [
    "human",
    "horse",
    "chicken",
    "zebrafish",
    "drosophila",
    "wheat",
    "yeast",
    "neurospora",
  ];
  const clipCheck = () =>
    page.evaluate((names) => {
      const col = document.querySelector(".tree-col") as HTMLElement;
      const svg = col.querySelector('svg[aria-label="Inferred tree"]')!;
      const caption = col.querySelector("figcaption")!;
      // Symmetric half-pixel tolerance: subpixel layout differs between
      // font stacks, so either edge may sit a fraction outside.
      const inside = (r: DOMRect, c: DOMRect) =>
        r.top >= c.top - 0.5 && r.bottom <= c.bottom + 0.5;
      const colRect = col.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      const leafRects = Array.from(svg.querySelectorAll("text"))
        .filter((t) => names.includes(t.textContent ?? ""))
        .map((t) => t.getBoundingClientRect());
      return {
        leaves: leafRects.length,
        leavesInSvg: leafRects.every((r) => inside(r, svgRect)),
        svgInCol: inside(svgRect, colRect),
        captionInCol: inside(caption.getBoundingClientRect(), colRect),
        scrollTop: col.scrollTop,
        // Returned verbatim so a failure shows the actual geometry.
        col: [colRect.top, colRect.bottom],
        svg: [svgRect.top, svgRect.bottom],
      };
    }, LEAVES);

  // Computed view (the view currently on screen).
  let clip = await clipCheck();
  expect(clip.scrollTop).toBe(0);
  expect(clip.captionInCol, JSON.stringify(clip)).toBe(true);
  expect(clip.svgInCol, JSON.stringify(clip)).toBe(true);
  expect(clip.leaves).toBe(8);
  expect(clip.leavesInSvg).toBe(true);

  // Rooted view — the same check after toggling back.
  await page
    .getByRole("button", { name: "Show rooted like the reference" })
    .click();
  clip = await clipCheck();
  expect(clip.scrollTop).toBe(0);
  expect(clip.captionInCol, JSON.stringify(clip)).toBe(true);
  expect(clip.svgInCol, JSON.stringify(clip)).toBe(true);
  expect(clip.leaves).toBe(8);
  expect(clip.leavesInSvg).toBe(true);
});
