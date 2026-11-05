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
