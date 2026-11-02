// Dataset library e2e (v1.4b plan Task 11, spec §5.3): the "Open
// dataset" sheet opens each curated dataset through the file path,
// the unsaved-work confirm (Review Focus 5), `ds=` share links, the
// unknown-id restore error and ≥40×40 touch targets under
// (pointer: coarse).

import { test, expect } from "@playwright/test";
import lzString from "lz-string";

const { compressToEncodedURIComponent } = lzString;

import { waitForApp } from "./helpers";

async function openSandbox(page: import("@playwright/test").Page) {
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
}

test("open a library dataset; the link uses ds=", async ({ page }) => {
  await openSandbox(page);
  await page.getByRole("button", { name: /Open dataset/ }).click();
  const sheet = page.getByRole("dialog", { name: "Open dataset" });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(".dataset-row")).toHaveCount(5);
  await sheet.getByRole("button", { name: /Vertebrate globins/ }).click();
  // The dataset imports like a file: protein alphabet, a tree, ds= in
  // the synced URL.
  await expect(
    page.locator('svg[aria-label="Inferred tree"]'),
  ).toBeVisible();
  await expect(page).toHaveURL(/ds=globins/);
  await expect(page).not.toHaveURL(/d=/);
});

test("16S opens and the gap control filters its columns", async ({
  page,
}) => {
  await openSandbox(page);
  await page.getByRole("button", { name: /Open dataset/ }).click();
  const sheet = page.getByRole("dialog", { name: "Open dataset" });
  await sheet
    .getByRole("button", { name: /Bacterial 16S ribosomal RNA/ })
    .click();
  await expect(
    page.locator('svg[aria-label="Inferred tree"]'),
  ).toBeVisible();
  await page.getByRole("radio", { name: "Complete deletion" }).click();
  await expect(page.locator(".gap-count")).toContainText(
    /sites removed by complete deletion/,
  );
});

test("Review Focus 5: opening a dataset over unsaved work asks first; declining keeps it", async ({
  page,
}) => {
  await openSandbox(page);
  await page
    .locator(".import-panel textarea")
    .fill(">x1\nACGT\n>x2\nACGA\n>x3\nACGG\n");
  await page
    .locator(".import-panel")
    .getByRole("button", { name: "Import", exact: true })
    .click();
  await page.getByRole("button", { name: /Open dataset/ }).click();
  const sheet = page.getByRole("dialog", { name: "Open dataset" });
  await sheet.getByRole("button", { name: /Vertebrate globins/ }).click();
  await expect(sheet.getByText("Replace your unsaved work?")).toBeVisible();
  await sheet.getByRole("button", { name: "Keep my work" }).click();
  // The list is back and the pasted alignment is untouched.
  await expect(sheet.locator(".dataset-row")).toHaveCount(5);
  await expect(page).toHaveURL(/d=/);
  await expect(page).not.toHaveURL(/ds=/);
});

test("an unknown ds= id restores the default lesson with a toast", async ({
  page,
}) => {
  await page.goto("/?sb=1&ds=nope");
  await waitForApp(page);
  await expect(page.locator(".toast")).toContainText(
    "unknown library dataset 'nope'",
  );
});

test("ds= with o= overrides restores both", async ({ page }) => {
  const o = compressToEncodedURIComponent(
    JSON.stringify({ analysis: { correction: "Poisson" } }),
  );
  await page.goto(`/?sb=1&ds=globins&o=${o}`);
  await waitForApp(page);
  await expect(
    page.locator('svg[aria-label="Inferred tree"]'),
  ).toBeVisible();
  await expect(page.getByLabel("Distance correction")).toHaveValue(
    "Poisson",
  );
  await expect(page).toHaveURL(/ds=globins/);
});

test("under (pointer: coarse) the sheet's rows, buttons and links are ≥40×40", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto("/");
  await waitForApp(page);
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
  ).toBe(true);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  // Below 1024 px the import panel lives in the Settings drawer.
  await page.getByRole("button", { name: "Settings" }).click();
  await page
    .getByRole("dialog", { name: "Settings" })
    .getByRole("button", { name: /Open dataset/ })
    .click();
  const sheet = page.getByRole("dialog", { name: "Open dataset" });
  await expect(sheet.locator(".dataset-row")).toHaveCount(5);

  const targets = sheet.locator("a, button, .dataset-row");
  const count = await targets.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await targets.nth(i).boundingBox();
    if (box === null) continue;
    const name =
      (await targets.nth(i).innerText().catch(() => "")) || `t${i}`;
    expect(box.width, `${name} ≥40 wide`).toBeGreaterThanOrEqual(40);
    expect(box.height, `${name} ≥40 tall`).toBeGreaterThanOrEqual(40);
  }
  await context.close();
});

test("under (pointer: coarse) the .meg export item is ≥40×40", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await openSandbox(page);
  // Below 1280 px the import panel and the Export menu live in the
  // Settings drawer.
  await page.getByRole("button", { name: "Settings" }).click();
  const drawer = page.getByRole("dialog", { name: "Settings" });
  await drawer
    .locator(".import-panel textarea")
    .fill(">a\nACGT\n>b\nACGA\n>c\nACGG\n");
  await drawer
    .locator(".import-panel")
    .getByRole("button", { name: "Import", exact: true })
    .click();
  const item = drawer.getByRole("button", { name: "Alignment (.meg)" });
  await expect(item).toBeEnabled();
  const box = await item.boundingBox();
  expect(box).not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(40);
  expect(box!.height).toBeGreaterThanOrEqual(40);
  await context.close();
});
