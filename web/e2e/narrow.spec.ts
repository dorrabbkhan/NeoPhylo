// Narrow-viewport regression pin (v1.4b Task 14 fix round, issue
// #135): at 375×812 under a coarse pointer every on-screen header
// control sits inside [0, viewport width] at ≥40×40, and no page
// scrolls sideways. The header itself already fit (conductor
// measurements on this branch) — this spec pins it so it can't
// regress. The lab settings table and the lab cards did NOT fit:
// ?lab=mega-jc69-vs-k2p and ?lab=mega-interpreting-support scrolled
// sideways (scrollWidth 450/463 at 375) and ?labs lab cards reached
// right=336 at 320. This spec fails there until the table scrolls
// inside its own region and the cards can shrink.
//
// The lab routes carry header.lab-page-head rather than
// header.app-header — the same (a) checks run on it. The skip link
// parks above the viewport until focused, so a control whose box
// never intersects the screen vertically is skipped as not visible.
// The tour stays dismissed by the project storageState
// (neophylo.tourSeen in playwright.config.ts), like the other specs.

import { readdirSync } from "node:fs";

import { test, expect } from "@playwright/test";

import { waitForApp } from "./helpers";

/** The shipped lab ids — the exercises/labs file-name stems are the
 * registry keys, and lab.id must match the stem (registry.loadLab). */
const LAB_IDS = readdirSync(new URL("../../exercises/labs/", import.meta.url))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -".json".length))
  .sort();

const NARROW = { w: 375, h: 812 };

test.use({
  viewport: { width: NARROW.w, height: NARROW.h },
  hasTouch: true,
});

/** Every header's controls: the app's own header, or the lab pages'
 * nav header that replaces it on ?labs / ?lab=<id>. */
const headerControls = (page: import("@playwright/test").Page) =>
  page.locator(
    "header.app-header a, header.app-header button, header.app-header [role=radio], " +
      "header.lab-page-head a, header.lab-page-head button",
  );

/** (a): every on-screen header control inside [0, w] at ≥40×40. */
async function checkHeaderControls(
  page: import("@playwright/test").Page,
  what: string,
): Promise<void> {
  const controls = headerControls(page);
  const count = await controls.count();
  expect(count, `${what}: header controls on screen`).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    if (box === null) continue;
    // The skip link parks above the viewport until focused — a
    // control whose box never intersects the screen vertically isn't
    // on it (one at the right edge still intersects and is checked).
    if (box.y + box.height <= 0 || box.y >= NARROW.h) continue;
    const label =
      (await control.getAttribute("aria-label")) ??
      (await control.innerText().catch(() => "")).slice(0, 40) ??
      `control ${i}`;
    expect(box.x, `${what}: "${label}" inside the left edge`).toBeGreaterThanOrEqual(
      -0.5,
    );
    expect(
      box.x + box.width,
      `${what}: "${label}" inside the right edge`,
    ).toBeLessThanOrEqual(NARROW.w + 0.5);
    // Gecko reports a 40 px box as 39.99998 — the same unit-conversion
    // noise labs.spec.ts absorbs; a genuinely smaller control fails.
    expect(
      box.width,
      `${what}: "${label}" at least 40 px wide (got ${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(39.95);
    expect(
      box.height,
      `${what}: "${label}" at least 40 px tall (got ${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(39.95);
  }
}

/** (b): the document itself never scrolls sideways. */
async function expectNoSidewaysScroll(
  page: import("@playwright/test").Page,
  width: number,
  what: string,
): Promise<void> {
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  expect(
    scrollWidth,
    `${what}: no sideways page scroll (scrollWidth ${scrollWidth})`,
  ).toBeLessThanOrEqual(width);
}

test("375×812: the Lesson view's header controls fit and the page never scrolls sideways", async ({
  page,
}) => {
  await page.goto("/");
  await waitForApp(page);
  await expect(page.getByRole("radio", { name: "Lesson" })).toBeChecked();
  await checkHeaderControls(page, "the Lesson view");
  await expectNoSidewaysScroll(page, NARROW.w, "the Lesson view");
});

test("375×812: the Sandbox view's header controls fit and the page never scrolls sideways", async ({
  page,
}) => {
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await expect(page.getByRole("radio", { name: "Sandbox" })).toBeChecked();
  await checkHeaderControls(page, "the Sandbox view");
  await expectNoSidewaysScroll(page, NARROW.w, "the Sandbox view");
  // Below the wide breakpoint the sandbox controls — the gap-
  // treatment radios included — live in the Settings drawer (§6.4),
  // so the header's toggle has to open it before the swap check.
  const settingsToggle = page.getByRole("button", {
    name: "Settings",
    exact: true,
  });
  await settingsToggle.click();
  await expect(settingsToggle).toHaveAttribute("aria-expanded", "true");
  // The sandbox-only gap control confirms the view swapped.
  await expect(
    page.getByRole("radio", { name: "Pairwise deletion" }),
  ).toBeVisible();
  await expectNoSidewaysScroll(
    page,
    NARROW.w,
    "the Sandbox view with the Settings drawer open",
  );
});

test("375×812: the lab index's header controls fit and the page never scrolls sideways", async ({
  page,
}) => {
  await page.goto("/?labs");
  await expect(
    page.getByRole("heading", { name: "Labs", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".lab-card").first()).toBeVisible();
  await checkHeaderControls(page, "the lab index");
  await expectNoSidewaysScroll(page, NARROW.w, "the lab index");
});

for (const id of LAB_IDS) {
  test(`375×812: lab ${id}'s header controls fit and the page never scrolls sideways`, async ({
    page,
  }) => {
    await page.goto(`/?lab=${id}`);
    // The settings table renders only once the lab has loaded.
    await expect(page.locator("table.lab-settings")).toBeVisible();
    await checkHeaderControls(page, `lab ${id}`);
    await expectNoSidewaysScroll(page, NARROW.w, `lab ${id}`);
  });
}

test("320×640: the lab index never scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/?labs");
  await expect(page.locator(".lab-card").first()).toBeVisible();
  await expectNoSidewaysScroll(page, 320, "the lab index at 320 px");
});

// v1.4c Task 12 (spec §7.1): the library gets the same pass — `?labs`
// above already covers the filtered view; `?library` adds the filter
// bar, lesson and dataset cards and the prepares/follows links at the
// two narrow widths.
test("375×812: the library's header controls fit and the page never scrolls sideways", async ({
  page,
}) => {
  await page.goto("/?library");
  await expect(
    page.getByRole("heading", { name: "Library", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".lib-card").first()).toBeVisible();
  await checkHeaderControls(page, "the library");
  await expectNoSidewaysScroll(page, NARROW.w, "the library");
});

test("320×640: the library never scrolls sideways", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/?library");
  await expect(page.locator(".lib-card").first()).toBeVisible();
  await expectNoSidewaysScroll(page, 320, "the library at 320 px");
});

// v1.4c Task 13 (spec §7.5): the instructor guide is a lab-print page —
// the same header-controls and no-sideways checks apply at both narrow
// widths.
test("375×812: the instructor guide's header controls fit and the page never scrolls sideways", async ({
  page,
}) => {
  await page.goto("/?guide");
  await expect(
    page.getByRole("heading", { name: "Instructor guide", level: 1 }),
  ).toBeVisible();
  await checkHeaderControls(page, "the instructor guide");
  await expectNoSidewaysScroll(page, NARROW.w, "the instructor guide");
});

test("320×640: the instructor guide never scrolls sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/?guide");
  await expect(
    page.getByRole("heading", { name: "Instructor guide", level: 1 }),
  ).toBeVisible();
  await expectNoSidewaysScroll(page, 320, "the instructor guide at 320 px");
});

/* ---- v1.4c Task 8: the matrix UI under a coarse pointer ---- */

test("375×812 coarse pointer: every matrix control is ≥40×40 and the page never scrolls sideways", async ({
  page,
}) => {
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  // At 375 px the import panel sits in the Settings drawer.
  await page.getByRole("button", { name: "Settings" }).click();
  const dlg = page.getByRole("dialog", { name: "Settings" });
  await dlg.getByRole("tab", { name: "Distance matrix" }).click();

  const controls = dlg.locator(
    ".import-panel a, .import-panel button, .import-panel input, " +
      ".import-panel [role=tab]",
  );
  const count = await controls.count();
  expect(count).toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const control = controls.nth(i);
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    if (box === null) continue;
    const label =
      (await control.getAttribute("aria-label")) ??
      (await control.innerText().catch(() => "")).slice(0, 40) ??
      `control ${i}`;
    expect(
      box.width,
      `matrix UI: "${label}" at least 40 px wide (got ${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(39.95);
    expect(
      box.height,
      `matrix UI: "${label}" at least 40 px tall (got ${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(39.95);
  }

  // The typing grid lives in the "Type a matrix…" sheet (fix round 2)
  // — full-screen at this width. Its cells keep the same 40 px floor.
  const grid = dlg.locator(".matrix-import");
  await grid.getByRole("button", { name: "Type a matrix…" }).click();
  const sheet = page.getByRole("dialog", { name: "Distance matrix" });
  await expect(sheet).toBeVisible();
  const sheetControls = sheet.locator(
    "button, input, select, a, [tabindex='0']",
  );
  for (let i = 0; i < (await sheetControls.count()); i += 1) {
    const control = sheetControls.nth(i);
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    if (box === null) continue;
    const label =
      (await control.getAttribute("aria-label")) ??
      (await control.innerText().catch(() => "")).slice(0, 40) ??
      `control ${i}`;
    expect(
      box.width,
      `matrix sheet: "${label}" ≥40 px wide (${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(39.95);
    expect(
      box.height,
      `matrix sheet: "${label}" ≥40 px tall (${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(39.95);
  }

  // Ten taxa: the sheet itself fits the viewport; the table scrolls
  // inside its own region, never the page.
  for (let k = 0; k < 5; k += 1) {
    await sheet.getByRole("button", { name: "Add taxon" }).click();
  }
  await expect(sheet.getByLabel("Taxon 10 name")).toBeVisible();
  const sheetBox = await sheet.boundingBox();
  expect(sheetBox).not.toBeNull();
  expect(sheetBox!.x).toBeGreaterThanOrEqual(-0.5);
  expect(sheetBox!.x + sheetBox!.width).toBeLessThanOrEqual(NARROW.w + 0.5);
  await expectNoSidewaysScroll(page, NARROW.w, "the matrix grid at 375 px");

  // The matrix session's own export items keep the same floor.
  for (const n of ["B", "C", "D", "E", "F", "G", "H", "I", "J"]) {
    await grid.getByLabel(`Distance between ${n} and A`).fill("1");
  }
  for (const [r, c] of [
    ["C", "B"], ["D", "B"], ["D", "C"], ["E", "B"], ["E", "C"], ["E", "D"],
    ["F", "B"], ["F", "C"], ["F", "D"], ["F", "E"],
    ["G", "B"], ["G", "C"], ["G", "D"], ["G", "E"], ["G", "F"],
    ["H", "B"], ["H", "C"], ["H", "D"], ["H", "E"], ["H", "F"], ["H", "G"],
    ["I", "B"], ["I", "C"], ["I", "D"], ["I", "E"], ["I", "F"], ["I", "G"], ["I", "H"],
    ["J", "B"], ["J", "C"], ["J", "D"], ["J", "E"], ["J", "F"], ["J", "G"], ["J", "H"], ["J", "I"],
  ] as const) {
    await grid.getByLabel(`Distance between ${r} and ${c}`).fill("2");
  }
  await grid.getByRole("button", { name: "Build tree" }).click();
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  await expectNoSidewaysScroll(page, NARROW.w, "a matrix session at 375 px");
  // Close the sheet — it covers the Settings drawer's export strip.
  await page.keyboard.press("Escape");

  const exports = dlg.locator(".export-menu a, .export-menu button");
  for (let i = 0; i < (await exports.count()); i += 1) {
    const control = exports.nth(i);
    if (!(await control.isVisible())) continue;
    const box = await control.boundingBox();
    if (box === null) continue;
    const label = (await control.innerText().catch(() => "")).slice(0, 40);
    expect(
      box.height,
      `matrix export "${label}" at least 40 px tall`,
    ).toBeGreaterThanOrEqual(39.95);
  }

  // 768 px: the whole matrix session again, no sideways scroll.
  await page.setViewportSize({ width: 768, height: 1024 });
  await expectNoSidewaysScroll(page, 768, "a matrix session at 768 px");
});

/* ---- v1.4d Task 8: the reading area under a coarse pointer ---- */

test("375x812: the reading area's header controls fit and the page never scrolls sideways", async ({
  page,
}) => {
  await page.goto("/?read=trees-demo");
  await expect(page.getByText(/Question 1 of/)).toBeVisible();
  await checkHeaderControls(page, "the reading area");
  await expectNoSidewaysScroll(page, NARROW.w, "the reading area");

  // The three-tree item stacks vertically below 600 px (spec §6);
  // the tips-up long-name item (index 24) is the widest figure the
  // demo set owns — the figure scrolls inside .rt-canvas, the page
  // never does.
  for (let i = 0; i < 24; i += 1) {
    await page.getByRole("button", { name: "Next" }).click();
  }
  await expect(page.getByText("Question 25 of")).toBeVisible();
  await expect(page.locator(".rt-figure svg").first()).toBeVisible();
  await expectNoSidewaysScroll(
    page,
    NARROW.w,
    "the reading area's long-name tips-up item",
  );
});

test("320x640: the reading area never scrolls sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 640 });
  await page.goto("/?read=trees-demo");
  await expect(page.getByText(/Question 1 of/)).toBeVisible();
  await expect(page.locator(".rt-figure svg").first()).toBeVisible();
  await expectNoSidewaysScroll(page, 320, "the reading area at 320 px");
});
