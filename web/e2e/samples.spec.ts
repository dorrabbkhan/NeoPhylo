// Sandbox sample buttons e2e (v1.3 plan Task 12, spec §6.8): the
// empty Sandbox offers "Cytochrome c (protein)" and "Weak-support
// example (DNA)"; the weak-support sample loads 6 taxa A–F of 120
// sites and a seeded run leaves at least one support under 50.

import type { Locator, Page } from "@playwright/test";
import { test, expect } from "@playwright/test";

import { stepToEnd, waitForApp } from "./helpers";

/** Run `fn` against the controls: the wide layout's column directly,
 * or the Settings drawer below 1280 px (same pattern as
 * visualScenes.ts). Left open for the run; the assertions are on the
 * centre column. */
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
  return await fn(dlg);
}

test("weak-support sample: 6 taxa, 120 sites, a run shows support < 50", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await inSettings(page, async (scope) => {
    await expect(
      scope.getByText("Paste or upload sequences, or try a sample:"),
    ).toBeVisible();
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
  await inSettings(page, async (scope) => {
    await scope.getByRole("button", { name: /Run bootstrap/ }).click();
    await expect(scope.getByText(/Run complete: /)).toBeVisible({
      timeout: 120_000,
    });
  });
  // At least one internal branch draws in the weak (<50) style.
  await expect(
    page.locator('.tree-canvas [data-weak="true"]').first(),
  ).toBeVisible();
});

test("cytochrome-c sample loads the protein alignment", async ({
  page,
}) => {
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await inSettings(page, async (scope) => {
    await scope
      .getByRole("button", { name: "Cytochrome c (protein)" })
      .click();
    await expect(scope.locator(".alphabet-badge")).toContainText(
      /protein/i,
    );
  });
  // 8 taxa on the inferred tree (human … neurospora).
  const leaves = page.locator(
    'svg[aria-label="Inferred tree"] g[data-node] > text',
  );
  await expect(
    leaves.filter({ hasText: /^(human|horse|chicken|zebrafish|drosophila|wheat|yeast|neurospora)$/ }),
  ).toHaveCount(8);
});
