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

  test("the in-panel Concept/Math toggle is keyboard-reachable and synced", async ({
    page,
  }) => {
    await page.locator('[role="gridcell"][data-i="0"][data-j="1"]').click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    // Concept mode by default: the sentence shows, no formula.
    await expect(
      dialog.getByText(/JTT picks the distance/),
    ).toBeVisible();

    // Tab inside the dialog's focus trap reaches the panel's toggle.
    const mathBtn = dialog.getByRole("button", { name: "Math" });
    for (let i = 0; i < 8; i++) {
      if (await mathBtn.evaluate((el) => el === document.activeElement)) {
        break;
      }
      await page.keyboard.press("Tab");
    }
    await expect(mathBtn).toBeFocused();

    // Enter switches to Math; Shift+Tab + Space switches back.
    await page.keyboard.press("Enter");
    await expect(mathBtn).toHaveAttribute("aria-pressed", "true");
    await expect(dialog.getByText(/JTT picks the distance/)).toHaveCount(0);
    await page.keyboard.press("Shift+Tab");
    const conceptBtn = dialog.getByRole("button", { name: "Concept" });
    await expect(conceptBtn).toBeFocused();
    await page.keyboard.press(" ");
    await expect(conceptBtn).toHaveAttribute("aria-pressed", "true");
    await expect(
      dialog.getByText(/JTT picks the distance/),
    ).toBeVisible();

    // The main toggle follows the same Session.mode after the dialog
    // closes. Tab moves Concept → Math, Enter switches again.
    await page.keyboard.press("Tab");
    await expect(mathBtn).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(mathBtn).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    const main = page.getByRole("group", { name: "Explanation mode" });
    await expect(main.getByRole("button", { name: "Math" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  test("every likelihood-curve axis label renders inside the svg", async ({
    page,
  }) => {
    // Regression (Task 10 fix): the y tick labels were right-aligned at
    // x = PAD_L − 3 with too little left padding, so a multi-digit
    // negative logL like "-512.345" ran off the svg's left edge and
    // lost its minus sign. Every label's box must lie inside the svg's.
    await page.locator('[role="gridcell"][data-i="0"][data-j="1"]').click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const svg = dialog.locator("svg.likelihood-curve");
    await expect(svg).toBeVisible();
    const svgBox = await svg.boundingBox();
    expect(svgBox).not.toBeNull();

    const labels = svg.locator(".axis-label");
    const count = await labels.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const label = labels.nth(i);
      const box = await label.boundingBox();
      const text = await label.textContent();
      expect(box, `label "${text}" has a box`).not.toBeNull();
      const eps = 1;
      expect(
        box!.x,
        `label "${text}" is clipped on the left`,
      ).toBeGreaterThanOrEqual(svgBox!.x - eps);
      expect(
        box!.x + box!.width,
        `label "${text}" is clipped on the right`,
      ).toBeLessThanOrEqual(svgBox!.x + svgBox!.width + eps);
      expect(
        box!.y,
        `label "${text}" is clipped at the top`,
      ).toBeGreaterThanOrEqual(svgBox!.y - eps);
      expect(
        box!.y + box!.height,
        `label "${text}" is clipped at the bottom`,
      ).toBeLessThanOrEqual(svgBox!.y + svgBox!.height + eps);
    }
  });

  test("no curve vertex touches the d axis label", async ({ page }) => {
    // Ad-hoc fix (2026-11-01): the "d" axis title was drawn at
    // (W − PAD_R, axisY − 3), right above the axis's right end — pair
    // 2–3's curve ends inside its box. It now sits centred in the
    // bottom tick row. No polyline vertex (screen-mapped through the
    // svg's CTM) may lie inside the label's box grown by 2 px.
    await page.locator('[role="gridcell"][data-i="2"][data-j="3"]').click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const svg = dialog.locator("svg.likelihood-curve");
    await expect(svg).toBeVisible();
    const dLabel = svg.locator("text.axis-label", { hasText: /^d$/ });
    await expect(dLabel).toHaveCount(1);
    const box = await dLabel.boundingBox();
    expect(box).not.toBeNull();
    const pts = await svg.evaluate((el) => {
      const ctm = (el as SVGSVGElement).getScreenCTM();
      if (!ctm) throw new Error("no screen CTM");
      return el
        .querySelector("polyline.curve")!
        .getAttribute("points")!
        .trim()
        .split(/\s+/)
        .map((p) => {
          const [x, y] = p.split(",").map(Number);
          const s = new DOMPoint(x, y).matrixTransform(ctm);
          return { x: s.x, y: s.y };
        });
    });
    const grow = 2;
    for (const p of pts) {
      const clear =
        p.x < box!.x - grow ||
        p.x > box!.x + box!.width + grow ||
        p.y < box!.y - grow ||
        p.y > box!.y + box!.height + grow;
      expect(
        clear,
        `vertex at (${p.x.toFixed(1)}, ${p.y.toFixed(1)}) lies inside the d label box`,
      ).toBe(true);
    }
  });

  test("the peak label draws its hat as a path, not a combining mark", async ({
    page,
  }) => {
    // Ad-hoc fix (2026-11-01): "d̂ = …" put the combining circumflex
    // U+0302 on the d's upright stroke, which reads as "â". The label
    // text is now "d = …" and the hat is a separate path (the only
    // path carrying the axis-label class) above the d glyph.
    await page.locator('[role="gridcell"][data-i="0"][data-j="1"]').click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const svg = dialog.locator("svg.likelihood-curve");
    await expect(svg).toBeVisible();
    const label = svg.locator("text.axis-label", { hasText: "=" });
    await expect(label).toHaveCount(1);
    expect(await label.textContent()).not.toContain("\u0302");
    const boxes = await svg.evaluate((el) => {
      const text = [...el.querySelectorAll("text.axis-label")].find((t) =>
        (t.textContent ?? "").includes("="),
      ) as SVGTextElement;
      const hat = el.querySelector("path.axis-label") as SVGGraphicsElement;
      const d = text.getExtentOfChar(0);
      const h = hat.getBBox();
      return {
        d: { x: d.x, y: d.y, w: d.width, h: d.height },
        h: { x: h.x, y: h.y, w: h.width, h: h.height },
      };
    });
    const eps = 0.8;
    expect(boxes.h.x).toBeGreaterThanOrEqual(boxes.d.x - eps);
    expect(boxes.h.x + boxes.h.w).toBeLessThanOrEqual(
      boxes.d.x + boxes.d.w + eps,
    );
    expect(boxes.h.y + boxes.h.h).toBeLessThanOrEqual(boxes.d.y + eps);
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
