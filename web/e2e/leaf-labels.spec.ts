// Leaf-label fit with the support stretch (owner decision 3A on
// PR #79, 2026-10-24): after a bootstrap run the support-carrying
// internal branches get the checkpoint-11 display stretch, whose
// accumulated shift used to push the deepest leaf's name past the
// .tree-canvas's right edge — clipped until the panel was scrolled.
// At every viewport wide enough for the tree at its normal minimum
// scale, every leaf label's bounding box must lie inside the canvas's
// client rect with scrollLeft 0.

import type { Locator, Page } from "@playwright/test";
import { test, expect } from "@playwright/test";

import { stepToEnd, waitForApp } from "./helpers";

// The specs assert DOM geometry, not offline behaviour — the PWA
// service worker stays out (same as layout.spec.ts).
test.use({ serviceWorkers: "block" });

/** Run `fn` against the controls: the wide layout's column directly,
 * or the Settings drawer below 1280 px, closed again afterwards so the
 * measured canvas is the plain on-screen one (same pattern as
 * visualScenes.ts). */
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
    // The × button, not Escape: the sample buttons unmount on load, so
    // the focused element can vanish and leave Escape undelivered.
    await dlg.getByRole("button", { name: "Close settings" }).click();
    await expect(dlg).toHaveCount(0);
  }
}

/** Click Run bootstrap on the seeded defaults and wait for the run to
 * settle ("Run complete"), including the estimate→confirm path when a
 * run is over the auto-run budget. */
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
    doneWait.catch(() => {});
    startWait.catch(() => {});
    const winner = await Promise.race([doneWait, startWait]);
    if (winner === "confirm") {
      await start.click();
      await expect(done).toBeVisible({ timeout: 90_000 });
    }
  });
}

// Leaf labels are the classless <text> children of leaf node groups
// (same selector as layout.spec.ts): internal groups carry a
// .connector line, support pills live one level deeper, and the "0"
// markers have a class of their own.
const LEAF_LABELS =
  'svg > g[data-node]:not(:has(> .connector)) > text:not([class])';

/** Every leaf label of every .tree-canvas lies inside that canvas's
 * client rect while its scrollLeft sits at 0 — i.e. the svg itself
 * fits the canvas and nothing is clipped behind horizontal scroll. */
async function expectLeafLabelsInsideCanvas(page: Page): Promise<void> {
  const canvases = page.locator(".tree-canvas");
  const count = await canvases.count();
  expect(count, "at least one tree canvas is on screen").toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const canvas = canvases.nth(i);
    const hidden = await canvas
      .locator("svg")
      .first()
      .evaluate((svg, selector) => {
        const el = svg.parentElement!;
        if (el.scrollLeft !== 0) return [`scrollLeft=${el.scrollLeft}`];
        const r = el.getBoundingClientRect();
        const left = r.left + el.clientLeft;
        const right = left + el.clientWidth;
        const out: string[] = [];
        for (const t of svg.querySelectorAll<SVGTextElement>(selector)) {
          const b = t.getBoundingClientRect();
          if (b.left < left - 0.5 || b.right > right + 0.5) {
            out.push(t.textContent ?? "?");
          }
        }
        return out;
      }, LEAF_LABELS);
    expect(hidden, `tree-canvas ${i} clips leaf labels`).toEqual([]);
  }
}

for (const vp of [
  { w: 1024, h: 768 },
  { w: 1280, h: 720 },
  { w: 1920, h: 1080 },
] as const) {
  test(`weak-support run: all six leaf labels inside the canvas at ${vp.w}x${vp.h}`, async ({
    page,
  }) => {
    test.setTimeout(180_000);
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/");
    await waitForApp(page);
    await page.getByRole("radio", { name: "Sandbox" }).click();
    await inSettings(page, async (scope) => {
      await scope
        .getByRole("button", { name: "Weak-support example (DNA)" })
        .click();
    });
    // The imported alignment is on screen: 6 leaves A–F.
    await expect(
      page
        .locator('svg[aria-label="Inferred tree"] g[data-node] > text')
        .filter({ hasText: /^[A-F]$/ }),
    ).toHaveCount(6);
    await stepToEnd(page);
    await runBootstrap(page);
    // The fixture exists to show the weak styling — the stretch this
    // spec guards. Assert it really applied.
    await expect(
      page.locator('.tree-canvas [data-weak="true"]').first(),
    ).toBeVisible();
    await expectLeafLabelsInsideCanvas(page);
  });
}

test("cytochrome c after a seeded run: leaf labels inside the canvas at 1280x720", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);
  await stepToEnd(page);
  await runBootstrap(page);
  await expectLeafLabelsInsideCanvas(page);
});
