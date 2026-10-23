// Visual snapshot scenes (v1.3 plan Task 5, spec §8.3). Each setup
// drives the real UI to the state that gets screenshotted — every
// scene × viewport × theme in the spec's matrix. Everything here is
// deterministic: the same imported FASTA or built-in lesson, default
// run settings (100 replicates, seed 1), no wall-clock dependence
// beyond settle waits.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { stepToEnd, waitForApp } from "./helpers";

/** The checkpoint-11 weak-support sample (6 taxa A–F, 120 sites,
 * seed 5), committed in this task; Task 12 moves the generator to
 * scripts/samples/ and points the scene at web/public/samples/. */
const WEAK_SUPPORT = fileURLToPath(
  new URL("./data/weak-support.fasta", import.meta.url),
);

/** The checkpoint-11 4-taxa block. */
const FOUR_TAXA = [
  ">A",
  "ACGTACGTACGTACGTACGT",
  ">B",
  "ACGTACGTACGTACGTACGA",
  ">C",
  "ACGTACGAACGTACCTACGA",
  ">D",
  "ACGAACGAACGTACCTACTA",
].join("\n");

/** Switch to Sandbox and import FASTA by paste, then step to the end. */
async function sandboxImport(page: Page, fasta: string): Promise<void> {
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await page.locator(".import-panel textarea").fill(fasta);
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await stepToEnd(page);
}

/** Click Run and wait for the run to settle ("Run complete"), on the
 * seeded defaults — including the estimate→confirm path when a run is
 * over the auto-run budget. */
async function runBootstrap(page: Page): Promise<void> {
  const run = page.getByRole("button", { name: /Run bootstrap/ });
  await expect(run).toBeEnabled();
  await run.click();
  const done = page.getByText(/Run complete: /);
  const start = page.getByRole("button", { name: "Start" });
  const winner = await Promise.race([
    done.waitFor({ timeout: 90_000 }).then(() => "done" as const),
    start.waitFor({ timeout: 90_000 }).then(() => "confirm" as const),
  ]);
  if (winner === "confirm") {
    await start.click();
    await expect(done).toBeVisible({ timeout: 90_000 });
  }
}

/** cytochrome-c at the final step after the seeded 100-replicate run. */
async function cytcAfterRun(page: Page): Promise<void> {
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);
  await stepToEnd(page);
  await runBootstrap(page);
}

export const SCENES: {
  name: string;
  setup: (page: Page) => Promise<void>;
}[] = [
  {
    // Rooted on the reference's outgroup (the default view).
    name: "cytc-rooted",
    setup: cytcAfterRun,
  },
  {
    name: "cytc-computed",
    setup: async (page) => {
      await cytcAfterRun(page);
      await page
        .getByRole("button", { name: "Show as computed (unrooted)" })
        .click();
      await expect(page.locator(".unrooted-note")).toBeVisible();
    },
  },
  {
    name: "weak-support",
    setup: async (page) => {
      await sandboxImport(page, await readFile(WEAK_SUPPORT, "utf8"));
      await runBootstrap(page);
      // The fixture exists to show the weak styling — assert it.
      await expect(
        page.locator('.tree-canvas [data-weak="true"]').first(),
      ).toBeVisible();
    },
  },
  {
    name: "four-taxa",
    setup: async (page) => {
      await sandboxImport(page, FOUR_TAXA);
      await expect(page.getByText(/1 grouping to test/)).toBeVisible();
    },
  },
  {
    name: "replicate-panel",
    setup: async (page) => {
      await cytcAfterRun(page);
      await page
        .getByRole("button", { name: /Watch one replicate/ })
        .click();
      await expect(
        page.getByRole("dialog").locator(".rep-diff"),
      ).toBeVisible();
    },
  },
  {
    // Final step, prediction answered, the run done, and the whole
    // sequenced note chain (reveal → wobble → length → closing) open.
    name: "bootstrap-basics-final",
    setup: async (page) => {
      await page.goto("/?lesson=bootstrap-basics");
      await waitForApp(page);
      await stepToEnd(page);
      await page
        .locator('svg[aria-label="Inferred tree"] g[data-split="E|F|G|H"] .branch-hit')
        .dispatchEvent("click");
      await runBootstrap(page);
      // Wobble note's Continue → length note; its Continue → closing.
      await page.locator(".prompt-continue").click();
      await expect(page.getByText(/Now try more data/)).toBeVisible();
      await page.locator(".prompt-continue").click();
      await expect(
        page.getByText(/Read the numbers carefully/),
      ).toBeVisible();
    },
  },
  {
    // The exported SVG rendered back as a document (spec §8.3).
    name: "export-svg-roundtrip",
    setup: async (page) => {
      await cytcAfterRun(page);
      const [dl] = await Promise.all([
        page.waitForEvent("download"),
        page
          .locator(".export-menu")
          .getByRole("button", { name: "SVG (rooted on wheat)", exact: true })
          .click(),
      ]);
      const stream = await dl.createReadStream();
      const chunks: Buffer[] = [];
      for await (const c of stream) chunks.push(c as Buffer);
      const svgText = Buffer.concat(chunks).toString("utf8");
      // The export is a self-contained, theme-independent print
      // figure (system font stack, white pills) — render it on white.
      await page.setContent(
        `<!DOCTYPE html><html><head><style>` +
          `html,body{margin:0;background:#fff;display:flex;` +
          `align-items:flex-start;justify-content:center;}` +
          `</style></head><body>${svgText}</body></html>`,
      );
      await page.evaluate(() => document.fonts.ready.then(() => undefined));
    },
  },
];
