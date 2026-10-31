// Gap-treatment e2e (v1.4b plan Task 10, spec §6.1–6.2): the sandbox's
// MEGA gap filter — Pairwise, Complete, Partial with a 0–100 cutoff —
// drives the analysis, the removed-site count updates, and the matrix
// changes. Keyboard-only path and ≥40×40 touch targets covered.

import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { waitForApp } from "./helpers";

const JC8_GAPS = fileURLToPath(
  new URL("../../fixtures/inputs/jc8_gaps.fasta", import.meta.url),
);

async function openSandboxWithGaps(page: import("@playwright/test").Page) {
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await page
    .locator('.import-panel input[type="file"]')
    .setInputFiles(JC8_GAPS);
  await expect(page.locator(".gap-count")).toContainText("0 of 500");
}

test("pairwise → complete → partial 95 updates the count and the matrix", async ({
  page,
}) => {
  await openSandboxWithGaps(page);

  const cells = page.locator('[role="gridcell"]');
  // The matrix is SVG: a cell's value is its aria-label ("t1, t2:
  // 0.218"), the same source the keyboard path announces — innerText
  // reads nothing on a <g>.
  const matrixText = async () =>
    cells.evaluateAll((els) =>
      els.map((e) => e.getAttribute("aria-label") ?? "").join("|"),
    );

  await expect(page.locator(".gap-count")).toContainText(
    "sites removed by pairwise deletion",
  );
  const pairwise = await matrixText();

  await page.getByRole("radio", { name: "Complete deletion" }).click();
  await expect(page.locator(".gap-count")).toContainText(
    "135 of 500 sites removed by complete deletion",
  );
  const complete = await matrixText();
  expect(complete).not.toBe(pairwise);

  await page.getByRole("radio", { name: "Partial deletion" }).click();
  await expect(page.getByLabel(/Site coverage cutoff/)).toHaveValue("95");
  await expect(page.locator(".gap-count")).toContainText(
    "135 of 500 sites removed by partial 95% deletion",
  );
  const partial = await matrixText();
  // Eight taxa: a single missing character is already 87.5 %
  // coverage — below the 95 % cutoff — so partial 95 removes exactly
  // complete's columns and the matrices coincide; both differ from
  // the per-pair matrix.
  expect(partial).toBe(complete);
  expect(partial).not.toBe(pairwise);

  // A looser cutoff keeps the one-missing columns (21 columns carry
  // ≥ 2 missing): the count and the matrix change again, so the
  // cutoff — not only the radio — drives the analysis.
  const cutoff = page.getByLabel(/Site coverage cutoff/);
  await cutoff.fill("80");
  await expect(page.locator(".gap-count")).toContainText(
    "21 of 500 sites removed by partial 80% deletion",
  );
  const partial80 = await matrixText();
  expect(partial80).not.toBe(complete);
  expect(partial80).not.toBe(pairwise);
});

test("the gap control is keyboard-only operable and the cutoff refuses junk", async ({
  page,
}) => {
  await openSandboxWithGaps(page);

  // Keyboard path: Tab to the radios, arrow keys move the selection.
  await page.getByRole("radio", { name: "Pairwise deletion" }).focus();
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".gap-count")).toContainText(
    "removed by complete deletion",
  );
  await page.keyboard.press("ArrowRight");
  await expect(page.locator(".gap-count")).toContainText(
    "removed by partial 95% deletion",
  );

  const cutoff = page.getByLabel(/Site coverage cutoff/);
  await cutoff.fill("101");
  await expect(page.locator(".field-error")).toContainText(
    "whole number from 0 to 100",
  );
  await cutoff.fill("90");
  await expect(page.locator(".field-error")).toHaveCount(0);
  await expect(page.locator(".gap-count")).toContainText("partial 90%");
});

test("under (pointer: coarse) the gap radios and the number inputs are ≥40×40", async ({
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
    "the emulation presents a coarse pointer",
  ).toBe(true);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  // Below 1024 px the controls sections — the gap control and the
  // import input among them — live in the Settings drawer (v1.3
  // §6.1); a coarse-pointer tablet reaches them through it.
  await page.getByRole("button", { name: "Settings" }).click();
  const dlg = page.getByRole("dialog", { name: "Settings" });
  await dlg
    .locator('.import-panel input[type="file"]')
    .setInputFiles(JC8_GAPS);
  await dlg.getByRole("radio", { name: "Partial deletion" }).click();

  const targets = dlg.locator(
    '.gap-control label.gap-radio, .gap-control input[type="number"], .controls input[type="number"]',
  );
  const count = await targets.count();
  expect(count, "gap and number inputs").toBeGreaterThan(0);
  for (let i = 0; i < count; i++) {
    const box = await targets.nth(i).boundingBox();
    if (box === null) continue;
    const name = (await targets.nth(i).innerText().catch(() => "")) || `t${i}`;
    expect(box.width, `${name} ≥40 wide`).toBeGreaterThanOrEqual(40);
    expect(box.height, `${name} ≥40 tall`).toBeGreaterThanOrEqual(40);
  }
  await context.close();
});

test("at 1920 every model menu stays inside the controls column", async ({
  browser,
}) => {
  // Regression for the clipped Correction dropdown arrow: a native
  // select lays out at its widest option ("K2P (dnadist, κ = 2.0)"),
  // which overflowed the 230 px column. Asserts the box, not the
  // pixels, for the default correction and for K2P_PHYLIP selected.
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 1920, height: 1080 },
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await openSandboxWithGaps(page);

  const column = page.locator(".col-controls");
  const colBox = await column.boundingBox();
  expect(colBox).not.toBeNull();

  for (const correction of [undefined, "K2P_PHYLIP"]) {
    if (correction !== undefined) {
      await page
        .getByLabel("Distance correction")
        .selectOption(correction);
    }
    const selects = column.locator("select");
    const count = await selects.count();
    expect(count, "selects in the controls column").toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await selects.nth(i).boundingBox();
      expect(box).not.toBeNull();
      const label =
        (await selects.nth(i).getAttribute("aria-label")) ?? `select ${i}`;
      expect(box!.x, `${label} left edge`).toBeGreaterThanOrEqual(colBox!.x);
      expect(
        box!.x + box!.width,
        `${label} right edge (${correction ?? "default"})`,
      ).toBeLessThanOrEqual(colBox!.x + colBox!.width);
    }

    // The model menus additionally must not shrink below their natural
    // width — a shrunk select ellipsizes the selected text
    // ("Neighbor-Joinin"), the same class of bug as the clipped arrow
    // one layer down. The natural width comes from a clone laid out
    // without the field row's constraints. Scoped to .controls: the
    // export section's Newick-names menu is deliberately clamped by
    // .newick-name-mode select (its longest option is wider than the
    // column) and keeps that approved look.
    const menus = column.locator(".controls select");
    const menuCount = await menus.count();
    for (let i = 0; i < menuCount; i++) {
      const label =
        (await menus.nth(i).getAttribute("aria-label")) ?? `menu ${i}`;
      const size = await menus.nth(i).evaluate((el) => {
        const sel = el as HTMLSelectElement;
        const clone = sel.cloneNode(true) as HTMLSelectElement;
        clone.style.cssText =
          "position:absolute;visibility:hidden;top:0;left:0;width:auto;min-width:0;max-width:none;";
        sel.parentElement!.appendChild(clone);
        const natural = clone.getBoundingClientRect().width;
        clone.remove();
        return { actual: sel.getBoundingClientRect().width, natural };
      });
      expect(
        size.actual,
        `${label} selected text not truncated (${correction ?? "default"})`,
      ).toBeGreaterThanOrEqual(size.natural - 0.5);
    }
  }
  await context.close();
});

test("a built-in lesson shows neither the gap control nor the new models", async ({
  page,
}) => {
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await expect(page.locator(".gap-control")).toHaveCount(0);
  const options = page.getByLabel("Distance correction").locator("option");
  await expect(options).toHaveCount(3);
});
