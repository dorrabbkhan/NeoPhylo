// Pair panel e2e (v1.1 plan Task 11, spec §5.2): a protein import in
// the sandbox, then activating a distance-matrix cell opens the "How
// was this distance computed?" dialog; it traps keyboard focus, closes
// on Esc returning focus to the cell, and passes an axe scan while
// open.

import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";
import { AxeBuilder } from "@axe-core/playwright";

import { waitForApp } from "./helpers";

const P6_150 = fileURLToPath(
  new URL("../../fixtures/inputs/protein/p6_150.fasta", import.meta.url),
);

test.describe("pair panel", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await waitForApp(page);
    await page.getByRole("radio", { name: "Sandbox" }).click();
    await page
      .locator('.import-panel input[type="file"]')
      .setInputFiles(P6_150);
    await expect(page.locator('[role="gridcell"]')).toHaveCount(36);
  });

  test("opens on click, closes on Esc, returns focus to the cell", async ({
    page,
  }) => {
    const cell = page.locator('[role="gridcell"][data-i="0"][data-j="1"]');
    await cell.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText("How was this distance computed?");

    // Focus moved into the dialog and stays trapped: Tab wraps around
    // the dialog's focusables instead of leaving it.
    await page.keyboard.press("Tab");
    const inside = await page.evaluate(() =>
      document
        .querySelector('[role="dialog"]')
        ?.contains(document.activeElement),
    );
    expect(inside).toBe(true);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(cell).toBeFocused();
  });

  test("has no serious axe violations while open", async ({ page }) => {
    await page.locator('[role="gridcell"][data-i="0"][data-j="1"]').click();
    await expect(page.getByRole("dialog")).toBeVisible();
    const results = await new AxeBuilder({ page }).analyze();
    const bad = results.violations.filter(
      (v) => v.impact === "serious" || v.impact === "critical",
    );
    expect(
      bad.map((v) => `${v.id} (${v.impact})`),
      "the open pair panel must have no serious/critical axe violations",
    ).toEqual([]);
  });
});
