// First-visit tour e2e (v1.3 plan Task 12, spec §6.7). Four steps
// highlight the stepper, the trees, the matrix and the Concept/Math
// toggle; once per device via neophylo.tourSeen, suppressed by
// lesson-step and #x= links, reopenable from More → "Take the tour",
// and once per page session when storage is blocked (Review Focus 3).
//
// Every other spec gets neophylo.tourSeen from the project-level
// storageState in playwright.config.ts; this file overrides it back
// to empty storage so the first-visit path is the one under test.

import { test, expect } from "@playwright/test";

import { waitForApp } from "./helpers";

// Back to a first visit: the shared storageState marks the tour seen.
test.use({ storageState: { cookies: [], origins: [] } });

const tour = (page: import("@playwright/test").Page) =>
  page.getByRole("dialog", { name: "Take the tour" });

test("first visit: four steps highlight the stepper, trees, matrix and mode toggle", async ({
  page,
}) => {
  await page.goto("/");
  await waitForApp(page);
  const dlg = tour(page);
  await expect(dlg).toBeVisible();

  const targets = [".stepper", ".trees", ".matrix-wrap", ".mode-toggle"];
  for (let i = 0; i < targets.length; i += 1) {
    await expect(page.locator(".tour")).toHaveAttribute(
      "data-tour-target",
      targets[i],
    );
    // The highlighted element exists on the page.
    await expect(page.locator(targets[i]).first()).toBeVisible();
    // aria-live announces the position.
    await expect(
      page.locator(".tour [aria-live]"),
    ).toContainText(`Tour step ${i + 1} of 4`);
    const back = dlg.getByRole("button", { name: "Back" });
    if (i === 0) {
      await expect(back).toBeDisabled();
    } else {
      await expect(back).toBeEnabled();
    }
    if (i < targets.length - 1) {
      await dlg.getByRole("button", { name: "Next" }).click();
    }
  }
  // Last Next ends the tour and marks the device.
  await dlg.getByRole("button", { name: "Next" }).click();
  await expect(dlg).toHaveCount(0);
  await expect
    .poll(() =>
      page.evaluate(() => window.localStorage.getItem("neophylo.tourSeen")),
    )
    .toBe("1");
});

// Review round 1: below the wide breakpoint .col-explain (the mode
// toggle's home) is a second grid row under the centre column, so a
// step's target can start below the fold. Each step must scroll its
// target into view and keep the card — Back/Skip/Next included —
// fully inside the viewport, with at least part of the ring on
// screen. Checked at 1024×768 and 768×1024 in addition to the
// project default above.
for (const viewport of [
  { width: 1024, height: 768 },
  { width: 768, height: 1024 },
]) {
  test(`card and ring stay in the viewport at ${viewport.width}x${viewport.height}`, async ({
    page,
  }) => {
    await page.setViewportSize(viewport);
    await page.goto("/");
    await waitForApp(page);
    const dlg = tour(page);
    await expect(dlg).toBeVisible();
    const targets = [".stepper", ".trees", ".matrix-wrap", ".mode-toggle"];
    for (let i = 0; i < targets.length; i += 1) {
      await expect(page.locator(".tour")).toHaveAttribute(
        "data-tour-target",
        targets[i],
      );
      // The step's scrollIntoView animates (smooth) — poll until the
      // geometry settles rather than asserting mid-scroll.
      await expect
        .poll(
          async () =>
            page.evaluate(() => {
              const vw = window.innerWidth;
              const vh = window.innerHeight;
              const inside = (r: DOMRect) =>
                r.left >= 0 &&
                r.top >= 0 &&
                r.right <= vw &&
                r.bottom <= vh;
              const card = document
                .querySelector(".tour-card")
                ?.getBoundingClientRect();
              const buttons = Array.from(
                document.querySelectorAll(".tour-actions button"),
              ).map((b) => b.getBoundingClientRect());
              const ring = document
                .querySelector(".tour-ring")
                ?.getBoundingClientRect();
              return (
                card !== undefined &&
                inside(card) &&
                buttons.length === 3 &&
                buttons.every(inside) &&
                ring !== undefined &&
                ring.right > 0 &&
                ring.bottom > 0 &&
                ring.left < vw &&
                ring.top < vh
              );
            }),
          { timeout: 10_000 },
        )
        .toBe(true);
      if (i < targets.length - 1) {
        await dlg.getByRole("button", { name: "Next" }).click();
      }
    }
  });
}

test("skip ends the tour and a reload does not reshow it", async ({
  page,
}) => {
  await page.goto("/");
  await waitForApp(page);
  await expect(tour(page)).toBeVisible();
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await expect(tour(page)).toHaveCount(0);
  await page.reload();
  await waitForApp(page);
  await expect(tour(page)).toHaveCount(0);
});

test("not shown for a lesson-step link or an #x= shared link", async ({
  page,
}) => {
  await page.goto("/?lesson=nj-basics&s=3");
  await waitForApp(page);
  await expect(tour(page)).toHaveCount(0);
  // An #x= shared state suppresses it too (the v1 custom-exercise
  // fixture URL is a real shared link).
  await page.goto(
    "/#x=N4IgbiBcCMA0IA8qgM4GMAWBTAtgQwH0wsAnFASwHsA7KOEcgEyhDQFcUAXSnAWgGsAHAAYQ8TuU4AbLCwDKGPCSyMABOy49VWBKTTkUs8STZYCnZbMgg",
  );
  await waitForApp(page);
  await expect(tour(page)).toHaveCount(0);
});

test("More → Take the tour reopens it", async ({ page }) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/");
  await waitForApp(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Take the tour" }).click();
  await expect(tour(page)).toBeVisible();
  await expect(page.locator(".tour")).toHaveAttribute(
    "data-tour-target",
    ".stepper",
  );
});

// Task 12 round 2 (§6.7, owner decision 2A): a reopen path at every
// width. At ≥ 1280 a header button next to "Coming from PHYLIP?"
// reopens the tour — and the header still fits on one row with no
// overflow at exactly 1280×720. At 1024–1279 the Settings drawer
// holds the item; below 1024 the More-menu test above still stands.
test("1280×720: the header button reopens the tour after Skip and the header stays one row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await waitForApp(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await expect(tour(page)).toHaveCount(0);

  const header = page.locator(".app-header");
  // No sideways scroll inside the header, no child poking outside its
  // box, and no wrap to a second row. The wrap check uses the vertical
  // center, not offsetTop: align-items:center gives items of different
  // heights different tops on the SAME line, but every item on one
  // line shares its center — a wrapped row's center is offset by a
  // full row height (the skip link is absolute and excluded).
  const fits = await header.evaluate((h) => {
    const hr = h.getBoundingClientRect();
    const children = Array.from(h.children).filter(
      (c) => getComputedStyle(c).position !== "absolute",
    );
    const inside = children.every((c) => {
      const r = c.getBoundingClientRect();
      return (
        r.left >= hr.left - 0.5 &&
        r.right <= hr.right + 0.5 &&
        r.top >= hr.top - 0.5 &&
        r.bottom <= hr.bottom + 0.5
      );
    });
    const centers = children.map((c) => {
      const r = c.getBoundingClientRect();
      return r.top + r.height / 2;
    });
    const oneRow = Math.max(...centers) - Math.min(...centers) < 1;
    return {
      scroll: h.scrollWidth <= h.clientWidth,
      inside,
      oneRow,
    };
  });
  expect(fits.scroll, "header scrollWidth ≤ clientWidth at 1280").toBe(true);
  expect(fits.inside, "no header child overflows the header box").toBe(true);
  expect(fits.oneRow, "header controls stay on one row at 1280").toBe(true);

  await page.getByRole("button", { name: "Take the tour" }).click();
  await expect(tour(page)).toBeVisible();
  await expect(page.locator(".tour")).toHaveAttribute(
    "data-tour-target",
    ".stepper",
  );
});

test("1024×768: the Settings drawer's item closes it and reopens the tour", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/");
  await waitForApp(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await expect(tour(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Settings" }).click();
  const drawer = page.getByRole("dialog", { name: "Settings" });
  await drawer.getByRole("button", { name: "Take the tour" }).click();
  await expect(drawer).toHaveCount(0);
  await expect(tour(page)).toBeVisible();
  await expect(page.locator(".tour")).toHaveAttribute(
    "data-tour-target",
    ".stepper",
  );
  // Focus moved into the tour card, not back to the header's button.
  await expect(tour(page)).toBeFocused();
});

test("Review Focus 3: blocked storage shows the tour once per page session", async ({
  page,
}) => {
  await page.addInitScript(() => {
    // Make every localStorage access throw, like a private-mode block.
    Object.defineProperty(window, "localStorage", {
      get() {
        throw new DOMException("denied", "SecurityError");
      },
      configurable: true,
    });
  });
  await page.goto("/");
  await waitForApp(page);
  await expect(tour(page)).toBeVisible();
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await expect(tour(page)).toHaveCount(0);
  // Still blocked, same page session: reopening via More works and
  // closing marks the session seen without a storage write.
  await page.setViewportSize({ width: 800, height: 900 });
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Take the tour" }).click();
  await expect(tour(page)).toBeVisible();
});
