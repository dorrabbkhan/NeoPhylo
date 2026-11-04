// Heatmap text scale cap (owner-requested rendering follow-up, PR
// #139 review): .matrix-wrap's svg is width:100% with only the
// --matrix-w min-width floor, so a small late-step matrix stretched
// to the 560 px column and rendered its authored 12 px text past the
// type scale's 32 px maximum — the globins UPGMA run's 2-taxon
// matrix (steps 21–22) drew its labels at ~35 px. The svg is now also
// capped at natural-width × (32 / largest authored font), so rendered
// text stays inside 12–32 px at every viewport; the min-width floor
// and the coarse-pointer --matrix-min floor still keep it ≥ 12 px.

import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { stepToEnd, waitForApp } from "./helpers";

// DOM geometry, not offline behaviour — the service worker stays out
// (same as layout.spec.ts).
test.use({ serviceWorkers: "block" });

/** The checkpoint-11 4-taxa block (same input as visualScenes). */
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

/** Run `fn` against the controls: the wide layout's column directly,
 * or the Settings drawer below 1280 px, closed again afterwards (same
 * pattern as leaf-labels.spec.ts). */
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
    await dlg.getByRole("button", { name: "Close settings" }).click();
    await expect(dlg).toHaveCount(0);
  }
}

/** The rendered font size of every <text> the heatmap draws: its
 * authored size times the svg's drawn/viewBox scale — the px the
 * glyphs actually occupy on screen. */
async function matrixFontSizes(page: Page): Promise<number[]> {
  const svg = page.locator('svg[aria-label="Distance matrix"]');
  await expect(svg).toBeVisible();
  await svg.scrollIntoViewIfNeeded();
  return svg.evaluate((el) => {
    const scale =
      el.getBoundingClientRect().width /
      (el as SVGSVGElement).viewBox.baseVal.width;
    return [...el.querySelectorAll("text")].map((t) =>
      parseFloat(getComputedStyle(t).fontSize),
    ).map((s) => s * scale);
  });
}

/** Every heatmap text — axis labels and cell values — renders inside
 * the type scale's 12–32 px band. */
async function expectMatrixTextInScale(page: Page): Promise<void> {
  const sizes = await matrixFontSizes(page);
  expect(sizes.length, "the heatmap draws text").toBeGreaterThan(0);
  for (const s of sizes) {
    expect(s, "rendered font size below the 12 px floor").toBeGreaterThanOrEqual(11.9);
    expect(s, "rendered font size past the 32 px type-scale max").toBeLessThanOrEqual(32.1);
  }
}

for (const vp of [
  { w: 1920, h: 1080 },
  { w: 768, h: 1024 },
] as const) {
  test(`globins UPGMA late steps: matrix text stays 12–32 px at ${vp.w}x${vp.h}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/?sb=1&ds=globins");
    await waitForApp(page);
    await inSettings(page, async (scope) => {
      await scope
        .getByLabel("Tree-building method")
        .selectOption("Upgma");
    });
    // The reported frame: step 20 of 22, a 3-taxon matrix.
    const next = page.getByRole("button", { name: "Next step" });
    for (;;) {
      const text = await page.locator(".stepper-status").innerText();
      if (/step 20 of /.test(text)) break;
      await next.click();
    }
    await expectMatrixTextInScale(page);
    // …and the late steps past it, where the 2-taxon matrix drew its
    // text at ~35 px before the cap.
    await stepToEnd(page);
    await expectMatrixTextInScale(page);
  });

  test(`4-taxon matrix text stays 12–32 px at ${vp.w}x${vp.h}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/");
    await waitForApp(page);
    await page.getByRole("radio", { name: "Sandbox" }).click();
    await inSettings(page, async (scope) => {
      await scope.locator(".import-panel textarea").fill(FOUR_TAXA);
      await scope
        .getByRole("button", { name: "Import", exact: true })
        .click();
    });
    await expectMatrixTextInScale(page);
  });
}
