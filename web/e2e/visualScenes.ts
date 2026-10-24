// Visual snapshot scenes (v1.3 plan Task 5, spec §8.3). Each setup
// drives the real UI to the state that gets screenshotted — every
// scene × viewport × theme in the spec's matrix. Everything here is
// deterministic: the same imported FASTA or built-in lesson, default
// run settings (100 replicates, seed 1), no wall-clock dependence
// beyond settle waits.

import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import type { Locator, Page } from "@playwright/test";
import { expect } from "@playwright/test";

import { stepToEnd, waitForApp } from "./helpers";

/** The checkpoint-11 weak-support sample (6 taxa A–F, 120 sites).
 * Task 12: the generator recipe was never written down and could not
 * be reconstructed byte-identically, so this scene keeps the
 * checkpoint artifact (decisions.md); the new
 * scripts/samples/weak_support.py generates only the Sandbox's
 * web/public/samples/weak-support.fasta. */
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

/** Deterministic frame for the screenshot: fonts settled and nothing
 * mid-scroll — the window and every scrollable element reset to 0.
 * Every scene's setup calls this as its last step; a scene that wants
 * a scrolled element does that scroll after this call. */
export async function settleFrame(page: Page): Promise<void> {
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.evaluate(() => {
    for (const el of document.querySelectorAll("*")) {
      if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
        el.scrollTop = 0;
        el.scrollLeft = 0;
      }
    }
    window.scrollTo(0, 0);
  });
}

/** Run `fn` against the controls: the wide layout's column directly,
 * or — below 1280 px (Task 10, spec §6.4) — the Settings drawer the
 * header button opens, closed again afterwards so the scene's frame
 * stays clean. */
async function inSettings<T>(
  page: Page,
  fn: (scope: Locator) => Promise<T>,
): Promise<T> {
  const gear = page.getByRole("button", { name: "Settings" });
  if (!(await gear.isVisible())) {
    return await fn(page.locator(".col-controls"));
  }
  await gear.click();
  const dlg = page.getByRole("dialog", { name: "Settings" });
  await expect(dlg).toBeVisible();
  try {
    return await fn(dlg);
  } finally {
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
  }
}

/** Switch to Sandbox and import FASTA by paste, then step to the end. */
async function sandboxImport(page: Page, fasta: string): Promise<void> {
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await inSettings(page, async (scope) => {
    await scope.locator(".import-panel textarea").fill(fasta);
    await scope
      .getByRole("button", { name: "Import", exact: true })
      .click();
  });
  await stepToEnd(page);
}

/** Click Run and wait for the run to settle ("Run complete"), on the
 * seeded defaults — including the estimate→confirm path when a run is
 * over the auto-run budget. */
async function runBootstrap(page: Page): Promise<void> {
  await inSettings(page, async (scope) => {
    const run = scope.getByRole("button", { name: /Run bootstrap/ });
    await expect(run).toBeEnabled();
    await run.click();
    const done = scope.getByText(/Run complete: /);
    const start = scope.getByRole("button", { name: "Start" });
    const doneWait = done
      .waitFor({ timeout: 90_000 })
      .then(() => "done" as const);
    const startWait = start
      .waitFor({ timeout: 90_000 })
      .then(() => "confirm" as const);
    // The loser still rejects on its timeout; swallow that so it can't
    // surface as an unhandled rejection after the race has settled.
    doneWait.catch(() => {});
    startWait.catch(() => {});
    const winner = await Promise.race([doneWait, startWait]);
    if (winner === "confirm") {
      await start.click();
      await expect(done).toBeVisible({ timeout: 90_000 });
    }
  });
}

/** cytochrome-c at the final step after the seeded 100-replicate run. */
async function cytcAfterRun(page: Page): Promise<void> {
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);
  await stepToEnd(page);
  await runBootstrap(page);
}

/** bootstrap-basics' final position with the prediction answered,
 * the seeded run done and the whole sequenced note chain open —
 * returns the closing card for the frame assertions. */
async function bootstrapBasicsFinal(page: Page) {
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
  const closing = page.locator(".prompt-card", {
    hasText: /Read the numbers carefully/,
  });
  await expect(closing).toBeVisible();
  return closing;
}

/** Owner-approved (PR #67, option 2): the frame must show the
 * closing note, which sits below the .prompts strip's fold after
 * the settle reset — scroll it in and prove it lands fully on
 * screen. */
async function settleWithClosing(page: Page, closing: Locator) {
  await settleFrame(page);
  await closing.scrollIntoViewIfNeeded();
  const box = await closing.boundingBox();
  const vp = page.viewportSize();
  expect(box, "closing note has a bounding box").not.toBeNull();
  expect(vp, "viewport size is known").not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp!.width);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp!.height);
}

export const SCENES: {
  name: string;
  setup: (page: Page) => Promise<void>;
  /** Restrict the scene to one viewport × theme (Task 11's
   * presenter variant records a single 1920×1080 light frame). */
  only?: { viewport: { w: number; h: number }; theme: "light" | "dark" };
}[] = [
  {
    // Rooted on the reference's outgroup (the default view).
    name: "cytc-rooted",
    setup: async (page) => {
      await cytcAfterRun(page);
      await settleFrame(page);
    },
  },
  {
    name: "cytc-computed",
    setup: async (page) => {
      await cytcAfterRun(page);
      await page
        .getByRole("button", { name: "Show as computed (unrooted)" })
        .click();
      await expect(page.locator(".unrooted-note")).toBeVisible();
      await settleFrame(page);
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
      await settleFrame(page);
    },
  },
  {
    name: "four-taxa",
    setup: async (page) => {
      await sandboxImport(page, FOUR_TAXA);
      await inSettings(page, async (scope) => {
        await expect(
          scope.getByText(/1 grouping to test/),
        ).toBeVisible();
      });
      await settleFrame(page);
    },
  },
  {
    name: "replicate-panel",
    setup: async (page) => {
      await cytcAfterRun(page);
      const gear = page.getByRole("button", { name: "Settings" });
      if (await gear.isVisible()) {
        await gear.click();
        const dlg = page.getByRole("dialog", { name: "Settings" });
        await expect(dlg).toBeVisible();
        await dlg
          .getByRole("button", { name: /Watch one replicate/ })
          .click();
        // Opening the panel dismisses the drawer behind it, leaving
        // the one modal on screen for the frame.
        await expect(dlg).toHaveCount(0);
      } else {
        await page
          .getByRole("button", { name: /Watch one replicate/ })
          .click();
      }
      await expect(
        page.getByRole("dialog").locator(".rep-diff"),
      ).toBeVisible();
      await settleFrame(page);
    },
  },
  {
    // Final step, prediction answered, the run done, and the whole
    // sequenced note chain (reveal → wobble → length → closing) open.
    name: "bootstrap-basics-final",
    setup: async (page) => {
      const closing = await bootstrapBasicsFinal(page);
      await settleWithClosing(page, closing);
    },
  },
  {
    // Task 11 (spec §6.6): the same frame with presenter mode on —
    // 1.5× type and spacing, controls hidden — recorded once at
    // 1920×1080 light (the projector case).
    name: "bootstrap-basics-final-presenter",
    only: { viewport: { w: 1920, h: 1080 }, theme: "light" },
    setup: async (page) => {
      const closing = await bootstrapBasicsFinal(page);
      await page
        .getByRole("button", { name: "Presenter mode" })
        .click();
      await settleWithClosing(page, closing);
    },
  },
  {
    // The exported SVG rendered back as a document (spec §8.3).
    name: "export-svg-roundtrip",
    setup: async (page) => {
      await cytcAfterRun(page);
      const [dl] = await Promise.all([
        page.waitForEvent("download"),
        inSettings(page, async (scope) =>
          scope
            .locator(".export-menu")
            .getByRole("button", {
              name: "SVG (rooted on wheat)",
              exact: true,
            })
            .click(),
        ),
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
      await settleFrame(page);
    },
  },
];
