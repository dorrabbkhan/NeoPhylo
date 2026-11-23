// Icon-tray header e2e (v1.5 Task 2, spec §16.2–§16.3 — mockup style
// B + phone variant M1). The tray is icon-only at rest; the label
// stays in the DOM (the accessible name) and expands on hover and
// keyboard focus; the current page's item keeps its label and an
// accent tint. Breakpoint inventories pin the §16.2 layout:
//   wide   ≥1280  Lessons, Library, Labs, Reading trees, Guides |
//                 Dark mode, Presenter mode — plus the mode pill.
//   medium 1024–1279  Library stays direct; Labs, Reading trees and
//                 the two guides move to the compact More menu;
//                 Settings stays a direct button (the drawer holds
//                 the tour there).
//   narrow  768–1023  the More menu keeps all nine secondary items;
//                 Settings direct.
//   compact <768   wordmark, title, the mode pill and one Menu
//                 button; the phone sheet carries every destination
//                 (M1: no Mode row in the sheet).
// Activation counts are preserved: every destination reachable at a
// width takes at most as many activations as today's header gave it.

import { expect, test } from "@playwright/test";
import type { Locator } from "@playwright/test";

import { waitForApp } from "./helpers";

/** The item's label is visually collapsed: max-width 0 + opacity 0.
 * Polled — the 250 ms collapse slide reads mid-flight otherwise. */
async function expectLabelCollapsed(item: Locator, what: string) {
  const label = item.locator(".nav-item-label");
  await expect(label).toHaveText(/.+/);
  await expect
    .poll(
      async () =>
        label.evaluate((el) => {
          const s = getComputedStyle(el);
          return s.maxWidth === "0px" && s.opacity === "0";
        }),
      `${what}: label collapsed to width 0 and transparent`,
    )
    .toBe(true);
}

/** The label is visually expanded (nonzero width, opaque). */
async function expectLabelExpanded(item: Locator) {
  const label = item.locator(".nav-item-label");
  // The slide takes 250 ms — poll until the computed values land
  // rather than asserting mid-animation.
  await expect
    .poll(async () =>
      label.evaluate((el) => {
        const s = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return s.opacity === "1" && r.width > 0;
      }),
    )
    .toBe(true);
}

for (const bp of [
  { w: 1920, items: ["Lessons", "Library", "Labs", "Reading trees", "Guides", "Dark mode", "Presenter mode"], name: "wide" },
  { w: 1280, items: ["Lessons", "Library", "Labs", "Reading trees", "Guides", "Dark mode", "Presenter mode"], name: "wide" },
  { w: 1024, items: ["Lessons", "Library", "More", "Dark mode", "Presenter mode", "Settings"], name: "medium" },
  { w: 768, items: ["Lessons", "More", "Dark mode", "Presenter mode", "Settings"], name: "narrow" },
] as const) {
  test(`${bp.name} (${bp.w} px): the tray holds ${bp.items.join(", ")} and the mode pill`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: bp.w, height: 800 });
    await page.goto("/?lesson=nj-basics");
    await waitForApp(page);

    const tray = page.locator(".nav-tray");
    await expect(tray).toBeVisible();
    for (const name of bp.items) {
      await expect(
        tray.getByRole("button", { name, exact: true }).or(
          tray.getByRole("link", { name, exact: true }),
        ),
        `tray item "${name}"`,
      ).toBeVisible();
    }
    // Nothing else hides in the tray.
    const buttons = tray.locator("button, a");
    await expect(buttons).toHaveCount(bp.items.length);

    // The mode pill stays at the header's right end.
    const pill = page.getByRole("radiogroup", { name: "Mode" });
    await expect(pill).toBeVisible();
    const trayBox = await tray.boundingBox();
    const pillBox = await pill.boundingBox();
    expect(pillBox!.x).toBeGreaterThan(trayBox!.x + trayBox!.width - 1);

    // Labels sit in the DOM but collapsed at rest — every item's
    // accessible name still resolves from them. The loaded lesson
    // marks its item current: pinned open instead of collapsed.
    for (const name of bp.items) {
      const item = tray
        .getByRole("button", { name, exact: true })
        .or(tray.getByRole("link", { name, exact: true }));
      if ((await item.getAttribute("aria-current")) === "page") {
        await expectLabelExpanded(item);
      } else {
        await expectLabelCollapsed(item, `"${name}" at rest`);
      }
    }
  });
}

test("wide: hover and keyboard focus expand an item's label", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);

  const labs = page.getByRole("link", { name: "Labs" });
  await expectLabelCollapsed(labs, "Labs at rest");

  await labs.hover();
  await expectLabelExpanded(labs);

  // Moving off collapses it again; keyboard focus opens it the same
  // way (the :focus-visible rule).
  await page.locator(".app-header h1").hover();
  await expectLabelCollapsed(labs, "Labs after hover leaves");

  await labs.focus();
  await expectLabelExpanded(labs);
});

test("the current page's tray item keeps its label and aria-current", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 800 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);

  const lessons = page.getByRole("button", { name: "Lessons" });
  await expect(lessons).toHaveAttribute("aria-current", "page");
  // Pinned open — no hover or focus needed.
  await expectLabelExpanded(lessons);
  const bg = await lessons.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  const labBg = await page
    .getByRole("link", { name: "Labs" })
    .evaluate((el) => getComputedStyle(el).backgroundColor);
  expect(bg, "the current item carries the accent tint").not.toBe(labBg);
});

test("medium's compact More menu holds the four overflow items and nothing else", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1100, height: 800 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);

  await page.getByRole("button", { name: "More" }).click();
  const menu = page.getByRole("menu", { name: "More" });
  await expect(menu).toBeVisible();
  await expect(menu.locator('[role="menuitem"]')).toHaveText([
    "Coming from PHYLIP?",
    "Coming from MEGA?",
    "Labs",
    "Reading trees",
  ]);
});

test("narrow's More menu keeps all nine secondary items", async ({
  page,
}) => {
  await page.setViewportSize({ width: 800, height: 900 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);

  await page.getByRole("button", { name: "More" }).click();
  const menu = page.getByRole("menu", { name: "More" });
  await expect(menu.locator('[role="menuitem"]')).toHaveText([
    "Coming from PHYLIP?",
    "Coming from MEGA?",
    "Labs",
    "Library",
    "Reading trees",
    "Take the tour",
    "Licenses",
    "Source code",
    "Help",
  ]);
});

/* ---- compact (<768 px): the Menu button and the phone sheet ---- */

test("compact: the header is wordmark, title, the mode pill and Menu; the sheet carries the rest", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);

  const header = page.locator(".app-header");
  // No tray at this width — the pill immediately precedes Menu.
  await expect(header.locator(".nav-tray")).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Mode" })).toBeVisible();
  const menu = page.getByRole("button", { name: "Menu", exact: true });
  await expect(menu).toHaveAttribute("aria-haspopup", "dialog");
  await expect(menu).toHaveAttribute("aria-expanded", "false");

  await menu.click();
  const sheet = page.getByRole("dialog", { name: "Menu" });
  await expect(sheet).toBeVisible();
  await expect(menu).toHaveAttribute("aria-expanded", "true");
  // Focus moved into the dialog — its first focusable element.
  await expect(
    sheet.getByRole("button", { name: "Close menu" }),
  ).toBeFocused();

  // Every destination the phone header and More menu used to offer.
  const tiles = sheet.locator(".phone-sheet-tiles > *");
  await expect(tiles).toHaveText([
    "Lessons",
    "Guides",
    "Library",
    "Labs",
    "Reading trees",
    "Settings",
    "Take the tour",
    "Licenses",
    "Source code",
    "Help",
  ]);
  // The in-place controls: Dark/Presenter rows — and NO Mode row
  // (M1: the pill in the header is the only mode switch).
  await expect(sheet.getByRole("radiogroup", { name: "Dark mode" })).toBeVisible();
  await expect(
    sheet.getByRole("radiogroup", { name: "Presenter mode" }),
  ).toBeVisible();
  await expect(
    sheet.getByRole("radiogroup", { name: "Mode", exact: true }),
  ).toHaveCount(0);

  // The sheet traps Tab; focus never leaves it.
  for (let i = 0; i < 16; i += 1) {
    await page.keyboard.press("Tab");
    const inside = await sheet.evaluate(
      (el) => el.contains(document.activeElement),
    );
    expect(inside, "Tab stays inside the phone sheet").toBe(true);
  }

  // Escape closes and restores focus to the Menu button.
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(menu).toBeFocused();
});

test("compact: the Lessons tile swaps to the in-sheet list; Back returns; a pick closes the sheet", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);

  await page.getByRole("button", { name: "Menu" }).click();
  const sheet = page.getByRole("dialog", { name: "Menu" });
  await sheet.getByRole("button", { name: "Lessons" }).click();

  // The dialog retitles and shows the lesson list; focus lands on
  // Back so it never leaves the sheet.
  const lessons = page.getByRole("dialog", { name: "Lessons" });
  await expect(lessons).toBeVisible();
  const back = lessons.getByRole("button", { name: "Back" });
  await expect(back).toBeFocused();
  await expect(
    lessons.getByRole("button", { name: /Neighbor-Joining/ }).first(),
  ).toBeVisible();
  // The current lesson is marked like the menu's.
  await expect(
    lessons.locator('.phone-sheet-pick[aria-current="page"]'),
  ).toHaveCount(1);

  await back.click();
  await expect(sheet).toBeVisible();

  // Guides the same way — both guide items inside the sheet.
  await sheet.getByRole("button", { name: "Guides" }).click();
  const guides = page.getByRole("dialog", { name: "Guides" });
  await expect(
    guides.getByRole("button", { name: "Coming from PHYLIP?" }),
  ).toBeVisible();
  await expect(
    guides.getByRole("button", { name: "Coming from MEGA?" }),
  ).toBeVisible();
  await guides.getByRole("button", { name: "Back" }).click();

  // A destination pick activates and closes the sheet (the unsaved-
  // work question is the caller's — a clean session goes straight
  // through).
  await sheet.getByRole("button", { name: "Reading trees" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(page).toHaveURL(/\?library&type=reading/);
});

test("compact: the sheet's Dark and Presenter rows switch in place", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);

  await page.getByRole("button", { name: "Menu" }).click();
  const sheet = page.getByRole("dialog", { name: "Menu" });

  await sheet
    .getByRole("radiogroup", { name: "Dark mode" })
    .getByRole("radio", { name: "On" })
    .click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(
    "dark",
  );
  // The sheet stays open — these are controls, not destinations.
  await expect(sheet).toBeVisible();

  await sheet
    .getByRole("radiogroup", { name: "Presenter mode" })
    .getByRole("radio", { name: "On" })
    .click();
  expect(
    await page.evaluate(() =>
      document.documentElement.hasAttribute("data-presenter"),
    ),
  ).toBe(true);
  await expect(sheet).toBeVisible();
  // Presenter hides Settings — its tile leaves the open sheet.
  await expect(
    sheet.getByRole("button", { name: "Settings" }),
  ).toHaveCount(0);
});

/* ---- touch: the long-press name tooltip (§16.3, conductor's call) ---- */

test("coarse pointer: a tap activates; a ≥500 ms hold shows the name and does not", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 1024, height: 768 },
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
  ).toBe(true);

  const more = page.getByRole("button", { name: "More" });
  // A real tap opens the menu immediately — no tooltip phase.
  await more.tap();
  await expect(page.getByRole("menu", { name: "More" })).toBeVisible();
  await page.keyboard.press("Escape");

  // A held press shows the name tooltip while the press holds and
  // never fires the click: the menu stays closed. pointerType is
  // dispatched as "touch" — the same event NavItem's timer keys on.
  const box = await more.boundingBox();
  expect(box).not.toBeNull();
  const cx = box!.x + box!.width / 2;
  const cy = box!.y + box!.height / 2;
  const fire = ([types]: string[][]) =>
    page.evaluate(
      ([ts, x, y]) => {
        const el = document.elementFromPoint(x, y)! as HTMLElement;
        for (const type of ts as string[]) {
          el.dispatchEvent(
            new PointerEvent(type, {
              bubbles: true,
              pointerType: "touch",
              clientX: x,
              clientY: y,
            }),
          );
        }
      },
      [types, cx, cy] as const,
    );
  await fire([["pointerdown"]]);
  await page.waitForTimeout(600);
  // Mid-hold: the name shows.
  await expect(more.locator(".nav-item-tip")).toHaveText("More");
  // Release + the click the gesture produces — swallowed, no open.
  await fire([["pointerup"], ["click"]]);
  await expect(page.getByRole("menu", { name: "More" })).toHaveCount(0);
  await context.close();
});
