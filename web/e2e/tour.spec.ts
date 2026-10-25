// First-visit tour e2e (v1.3 plan Task 12, spec §6.7). Four steps
// highlight the stepper, the trees, the matrix and the Concept/Math
// toggle; once per device via neophylo.tourSeen, suppressed by
// lesson-step and #x= links, reopenable at every width (owner
// decision B: the Lessons menu's last item at ≥ 1280, the Settings
// drawer at 1024–1279, More → "Take the tour" below 1024), and once
// per page session when storage is blocked (Review Focus 3).
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
      // The step's scrollIntoView settles (instant — the smooth scroll
      // raced clicks, see the fast-step test below) — poll until the
      // geometry lands rather than asserting mid-scroll.
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

// v1.3 fixes: the Firefox failure this guards — a "Next" click while
// step 3's smooth scroll still glided the card could straddle a move
// (down/up on different elements → no click), and the ring could keep
// step-3 geometry into step 4. The scroll is instant now, so stepping
// straight through — no settle waits — must land the ring on each
// step's own target; asserted exactly on the last step's box.
test("768x1024: stepping straight through lands the ring on each target", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/");
  await waitForApp(page);
  const dlg = tour(page);
  await expect(dlg).toBeVisible();
  const targets = [".stepper", ".trees", ".matrix-wrap", ".mode-toggle"];
  for (const sel of targets) {
    await expect(page.locator(".tour")).toHaveAttribute(
      "data-tour-target",
      sel,
    );
    if (sel !== targets[targets.length - 1]) {
      await dlg.getByRole("button", { name: "Next" }).click();
    }
  }
  // The ring is the step-4 target's visible rect padded by RING_PAD
  // (6 px — the same constant Tour.tsx draws with).
  const geo = await page.evaluate(() => {
    const pad = 6;
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const t = document
      .querySelector(".mode-toggle")!
      .getBoundingClientRect();
    const r = document.querySelector(".tour-ring")!.getBoundingClientRect();
    return {
      ring: { l: r.left, t: r.top, w: r.width, h: r.height },
      want: {
        l: Math.max(0, t.left) - pad,
        t: Math.max(0, t.top) - pad,
        w: Math.min(t.right, vw) - Math.max(0, t.left) + pad * 2,
        h: Math.min(t.bottom, vh) - Math.max(0, t.top) + pad * 2,
      },
    };
  });
  expect(Math.abs(geo.ring.l - geo.want.l)).toBeLessThan(1);
  expect(Math.abs(geo.ring.t - geo.want.t)).toBeLessThan(1);
  expect(Math.abs(geo.ring.w - geo.want.w)).toBeLessThan(1);
  expect(Math.abs(geo.ring.h - geo.want.h)).toBeLessThan(1);
});

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

// Task 12 round 3 (§6.7, owner decision B, 2026-10-24): a reopen path
// at every width — and the header itself identical to main's. The
// round-2 header button wrapped the controls to two rows at exactly
// 1280 on the longer lesson titles, so at ≥ 1280 "Take the tour" is
// now the LAST item of the Lessons menu. At 1024–1279 the Settings
// drawer holds the item; below 1024 the More-menu test above stands.
test("1280×720: Lessons → Take the tour reopens it after Skip, focus in the card", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/");
  await waitForApp(page);
  await tour(page).getByRole("button", { name: "Skip" }).click();
  await expect(tour(page)).toHaveCount(0);

  const menuButton = page.getByRole("button", { name: "Lessons" });
  await menuButton.click();
  const menu = page.getByRole("menu", { name: "Lessons" });
  const item = menu.getByRole("menuitem", { name: "Take the tour" });
  // The last row of the menu, after every lesson pick.
  await expect(item).toBeVisible();
  expect(
    await menu.locator(":scope > *").last().getAttribute("role"),
  ).toBe("menuitem");
  await item.click();
  await expect(menu).toHaveCount(0);
  await expect(tour(page)).toBeVisible();
  await expect(page.locator(".tour")).toHaveAttribute(
    "data-tour-target",
    ".stepper",
  );
  // Focus moved into the tour card, not back to the menu button.
  await expect(tour(page)).toBeFocused();
});

// Owner decision B's regression guard: at exactly 1280 — the width the
// round-2 button wrapped on — every lesson's header must match main's.
// Round 2's check used only nj-basics; the wrap appeared on
// cytochrome-c, saturation and upgma-fails, so this iterates the whole
// catalog.
//
// v1.3 fixes: the title now truncates with an ellipsis instead of
// wrapping the row — protein-models' 95.4 px two-row header at 1280
// and every 1024 wrap are gone — so every lesson pins the single-row
// height measured in the pinned image (54.2 px at both widths).
const HEADER_HEIGHT: Record<string, number> = {
  "nj-basics": 54.2,
  "upgma-fails": 54.2,
  saturation: 54.2,
  "bootstrap-basics": 54.2,
  "protein-models": 54.2,
  "cytochrome-c": 54.2,
};
for (const [width, height] of [
  [1280, 720],
  [1024, 768],
] as const) {
  for (const lesson of Object.keys(HEADER_HEIGHT)) {
    test(`${width}x${height} ${lesson}: header stays one row`, async ({
      page,
    }) => {
      await page.setViewportSize({ width, height });
      await page.goto(`/?lesson=${lesson}`);
      await waitForApp(page);
      await tour(page).getByRole("button", { name: "Skip" }).click();

      const header = page.locator(".app-header");
      // No sideways scroll inside the header, no child poking outside
      // its box, and no wrap to a second row. The wrap check uses the
      // vertical center, not offsetTop: align-items:center gives items
      // of different heights different tops on the SAME line, but
      // every item on one line shares its center — a wrapped row's
      // center is offset by a full row height (the skip link is
      // absolute and excluded).
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
          height: hr.height,
          scroll: h.scrollWidth <= h.clientWidth,
          inside,
          oneRow,
        };
      });
      expect(
        fits.scroll,
        `header scrollWidth ≤ clientWidth at ${width}`,
      ).toBe(true);
      expect(
        fits.inside,
        "no header child overflows the header box",
      ).toBe(true);
      expect(
        fits.height,
        "header height equals the measured single-row height",
      ).toBeCloseTo(HEADER_HEIGHT[lesson], 0);
      expect(
        fits.oneRow,
        `header controls stay on one row at ${width}`,
      ).toBe(true);
    });
  }
}

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
