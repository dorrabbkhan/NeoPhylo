// Protein performance budget (v1.1 plan Task 14, spec §3.4 "Budget" and
// §6.3): a full JTT matrix for 200 taxa × 1,000 sites must render in
// under 2 s in the browser (single-threaded wasm). Measured on Chromium
// only — it is the reference engine for the budget; Firefox/WebKit run
// the same wasm but their JS/SVG timings differ.
//
// The alignment is generated in-test with a seeded generator (no
// Math.random): a uniform 20-state root mutated at p ≈ 0.2 per taxon,
// which keeps every pair's count table dense — the worst case for the
// JTT likelihood evaluation.

import { test, expect } from "@playwright/test";

import { waitForApp } from "./helpers";

const TAXA = 200;
const SITES = 1000;
const BUDGET_MS = 2000;
const AA = "ARNDCQEGHILKMFPSTWYV";
const PREVIEW_URL = "http://localhost:4174";

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

/** 200×1,000 protein FASTA: uniform root, ~20% mutated sites per taxon. */
function proteinFasta(seed: number): string {
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

// Tagged @perf so scripts/ci/e2e.sh can run it alone on a single worker
// — a wall-clock budget is meaningless under parallel test load.
test(
  "a 200×1,000 protein JTT matrix renders within the 2 s budget",
  { tag: "@perf" },
  async ({ page, browserName }) => {
    test.skip(browserName !== "chromium");
    const fasta = proteinFasta(2026);

    // The budget is about the shipped app: use the production preview
    // server (:4174), not the dev server — dev-mode React renders twice
    // under StrictMode and isn't what users run.
    await page.goto(`${PREVIEW_URL}/`);
    await waitForApp(page);
    await page.getByRole("radio", { name: "Sandbox" }).click();

    // Import → rendered heatmap, timed end to end. Past 64 taxa the
    // heatmap renders compact (bucketed paths, no per-cell gridcells), so
    // the wait is on the grid's svg label, not 40,000 cells.
    const t0 = Date.now();
    await page
      .locator('.import-panel input[type="file"]')
      .setInputFiles({
        name: "perf.fasta",
        mimeType: "text/plain",
        buffer: Buffer.from(fasta, "utf8"),
      });
    await expect(
      page.locator(`svg[aria-label="Distance matrix, ${TAXA} taxa"]`),
    ).toBeVisible();
    const elapsed = Date.now() - t0;

    console.log(
      `perf-protein: import → rendered ${TAXA}×${TAXA} heatmap took ${elapsed} ms`,
    );
    expect(
      elapsed,
      `import → heatmap took ${elapsed} ms (budget ${BUDGET_MS} ms)`,
    ).toBeLessThan(BUDGET_MS);
  },
);
