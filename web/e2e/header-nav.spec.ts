// Icon-tray header e2e (v1.5 Task 2, spec §16.2–§16.3 — mockup style
// B + phone variant M2). The tray is icon-only at rest; the label
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
//   compact <768   wordmark, title and one Menu button; the phone
//                 sheet carries every destination AND the Lesson |
//                 Sandbox switch as a row like Dark mode (M2).
// Activation counts are preserved: every destination reachable at a
// width takes at most as many activations as today's header gave it.

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

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

test("compact: the header is wordmark, title and Menu; the sheet carries the rest and the Mode row", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);

  const header = page.locator(".app-header");
  // No tray and no mode pill at this width (M2) — the sheet's Mode
  // row is the only <768 mode switch.
  await expect(header.locator(".nav-tray")).toHaveCount(0);
  await expect(header.locator(".mode-switch")).toHaveCount(0);
  await expect(page.getByRole("radiogroup", { name: "Mode" })).toHaveCount(0);
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
  // The in-place controls: the Mode row (M2 — the only <768 mode
  // switch) and the Dark/Presenter rows.
  const mode = sheet.getByRole("radiogroup", { name: "Mode", exact: true });
  await expect(mode).toBeVisible();
  await expect(mode.getByRole("radio", { name: "Lesson" })).toBeChecked();
  await expect(sheet.getByRole("radiogroup", { name: "Dark mode" })).toBeVisible();
  await expect(
    sheet.getByRole("radiogroup", { name: "Presenter mode" }),
  ).toBeVisible();

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

test("compact: the sheet's Mode, Dark and Presenter rows switch in place", async ({
  page,
}) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);

  await page.getByRole("button", { name: "Menu" }).click();
  const sheet = page.getByRole("dialog", { name: "Menu" });

  // The Mode row is the compact Lesson|Sandbox switch (M2): picking
  // Sandbox flips the app's source and the row reports it back —
  // the sheet stays open (a control, not a destination).
  const mode = sheet.getByRole("radiogroup", { name: "Mode", exact: true });
  await mode.getByRole("radio", { name: "Sandbox" }).click();
  await expect(mode.getByRole("radio", { name: "Sandbox" })).toBeChecked();
  await expect(sheet).toBeVisible();
  // Back to the lesson the rest of the test expects.
  await mode.getByRole("radio", { name: "Lesson" }).click();
  await expect(mode.getByRole("radio", { name: "Lesson" })).toBeChecked();

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

/* ---- touch targets (§16.3, plan Step 1): ≥ 44 × 44 px ---- */

/** Every header target at `w` px under a coarse pointer is ≥ 44 × 44
 * and one tap on Library really navigates — a tap never only reveals
 * a label. Library is a direct tray pick at ≥ 1024, lives behind
 * More at narrow and is a sheet tile at compact; the destination is
 * `?library` on every path. */
for (const w of [1920, 1280, 1024, 768, 360] as const) {
  test(`coarse pointer ${w} px: every header target ≥ 44×44 and Library takes one tap`, async ({
    browser,
  }) => {
    const context = await browser.newContext({
      baseURL: "http://localhost:4173",
      viewport: { width: w, height: w === 360 ? 740 : 800 },
      hasTouch: true,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.goto("/?lesson=nj-basics");
    await waitForApp(page);
    expect(
      await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
      "(pointer: coarse) active under hasTouch",
    ).toBe(true);

    const controls = page.locator(
      ".app-header a, .app-header button, .app-header [role=radio]",
    );
    const count = await controls.count();
    expect(count, `header targets present at ${w} px`).toBeGreaterThan(0);
    for (let i = 0; i < count; i += 1) {
      const control = controls.nth(i);
      if (!(await control.isVisible())) continue;
      const box = await control.boundingBox();
      if (box === null) continue;
      // The skip link parks above the viewport until focused — like
      // narrow.spec's sweep, a box that never intersects the screen
      // vertically isn't an on-screen target.
      if (box.y + box.height <= 0) continue;
      const label =
        (await control.getAttribute("aria-label")) ??
        (await control.innerText().catch(() => ""))
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 40) ??
        `control ${i}`;
      expect(
        box.width,
        `${w} px: "${label}" at least 44 px wide (${box.width}×${box.height})`,
      ).toBeGreaterThanOrEqual(43.95);
      expect(
        box.height,
        `${w} px: "${label}" at least 44 px tall (${box.width}×${box.height})`,
      ).toBeGreaterThanOrEqual(43.95);
    }

    if (w >= 1024) {
      await page
        .getByRole("button", { name: "Library", exact: true })
        .tap();
    } else if (w === 768) {
      await page.getByRole("button", { name: "More" }).tap();
      await page.getByRole("menuitem", { name: "Library" }).tap();
    } else {
      await page.getByRole("button", { name: "Menu", exact: true }).tap();
      await page.getByRole("button", { name: "Library" }).tap();
    }
    await expect(page).toHaveURL(/\?library/);
    await context.close();
  });
}

/* ---- reduced motion (§16.4): no label slide ---- */

test("reduced motion: a tray label's transition is 0s", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 1440, height: 800 },
    reducedMotion: "reduce",
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  const label = page
    .getByRole("button", { name: "Dark mode" })
    .locator(".nav-item-label");
  await expect(label).toHaveText("Dark mode");
  const duration = await label.evaluate(
    (el) => getComputedStyle(el).transitionDuration,
  );
  expect(duration, "the label slide is zeroed under reduced motion").toBe(
    "0s",
  );
  await context.close();
});

/* ---- opaque surfaces (fix: --color-surface-2 must resolve) ---- */

test("nav surfaces paint opaquely — no custom property falls back to transparent", async ({
  page,
}) => {
  const opaque = async (loc: Locator, what: string) => {
    const bg = await loc.evaluate(
      (el) => getComputedStyle(el).backgroundColor,
    );
    expect(bg, `${what} paints an opaque background`).not.toBe(
      "rgba(0, 0, 0, 0)",
    );
  };

  // The tray container at a width where it shows (its items stay
  // transparent at rest by design — the tint was always the
  // container's).
  await page.setViewportSize({ width: 900, height: 800 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await opaque(page.locator(".nav-tray"), "the nav tray");

  // The compact surfaces: Menu button, the sheet panel, head
  // buttons, tiles and a lesson pick.
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await opaque(
    page.getByRole("button", { name: "Menu", exact: true }),
    "the Menu button",
  );
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Menu" });
  await opaque(sheet, "the phone sheet panel");
  await opaque(
    sheet.getByRole("button", { name: "Close menu" }),
    "the sheet's close button",
  );
  await opaque(
    sheet.locator(".phone-sheet-tile").first(),
    "a phone sheet tile",
  );
  await sheet.getByRole("button", { name: "Lessons" }).click();
  await opaque(
    page.locator(".phone-sheet-pick").first(),
    "a lesson pick",
  );
  await opaque(
    page.getByRole("button", { name: "Back" }),
    "the sheet's Back button",
  );
});

/* ---- awkward widths (plan Step 1, Review Focus 4) ---- */

/** Header boxes that must never intersect: the wordmark, the title,
 * every tray item (incl. More and Settings), the Menu button and the
 * mode pill's radios. */
async function headerBoxes(page: Page) {
  const items = page.locator(
    ".app-header .wordmark, .app-header h1, .app-header .nav-item, " +
      ".app-header .mode-switch button",
  );
  const boxes: { name: string; x: number; y: number; w: number; h: number }[] =
    [];
  for (const [i, el] of (await items.all()).entries()) {
    if (!(await el.isVisible())) continue;
    const box = await el.boundingBox();
    if (box === null) continue;
    if (box.y + box.height <= 0) continue; // parked skip link
    boxes.push({
      name: `${await el.evaluate(
        (n) =>
          n.getAttribute("aria-label") ??
          n.textContent?.trim().slice(0, 30) ??
          n.className,
      )}#${i}`,
      x: box.x,
      y: box.y,
      w: box.width,
      h: box.height,
    });
  }
  return boxes;
}

/** No two collected header boxes intersect (0.5 px antialias slack). */
async function expectNoHeaderOverlap(page: Page, what: string) {
  const boxes = await headerBoxes(page);
  expect(boxes.length, `${what}: header boxes collected`).toBeGreaterThan(2);
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) {
      const overlap =
        a.x < b.x + b.w - 0.5 &&
        a.x + a.w > b.x + 0.5 &&
        a.y < b.y + b.h - 0.5 &&
        a.y + a.h > b.y + 0.5;
      expect(
        overlap,
        `${what}: "${a.name}" and "${b.name}" intersect`,
      ).toBe(false);
    }
  }
}

/** The title keeps the ellipsis mechanism and genuinely truncates
 * when the longest lesson title can't fit. */
async function expectTitleEllipsis(
  page: Page,
  what: string,
  mustTruncate: boolean,
) {
  const h1 = page.locator(".app-header h1");
  const style = await h1.evaluate((el) => {
    const s = getComputedStyle(el);
    return {
      textOverflow: s.textOverflow,
      overflow: s.overflow,
      whiteSpace: s.whiteSpace,
      truncates: el.scrollWidth > el.clientWidth,
    };
  });
  expect(style, `${what}: the title ellipsizes`).toMatchObject({
    textOverflow: "ellipsis",
    overflow: "hidden",
    whiteSpace: "nowrap",
  });
  if (mustTruncate) {
    expect(
      style.truncates,
      `${what}: the longest title is clipped, not overlapped`,
    ).toBe(true);
  }
}

test("awkward widths", async ({ browser }) => {
  // 1024–1279 with the longest built-in lesson title: medium keeps
  // its inventory, nothing overlaps, the title ellipsizes.
  for (const w of [1024, 1279] as const) {
    const context = await browser.newContext({
      baseURL: "http://localhost:4173",
      viewport: { width: w, height: 800 },
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.goto("/?lesson=upgma-vs-nj-matrix");
    await waitForApp(page);
    await expectNoHeaderOverlap(page, `medium ${w} px`);
    // At 1024 the longest title must genuinely clip; at 1279 it fits —
    // the ellipsis mechanism just has to stay in place.
    await expectTitleEllipsis(page, `medium ${w} px`, w === 1024);
    // Reachable: the medium tray inventory plus the mode pill.
    for (const name of [
      "Lessons",
      "Library",
      "More",
      "Dark mode",
      "Presenter mode",
      "Settings",
    ]) {
      await expect(
        page.getByRole("button", { name, exact: true }),
        `medium ${w} px: ${name} reachable`,
      ).toBeVisible();
    }
    await expect(
      page.getByRole("radiogroup", { name: "Mode" }),
    ).toBeVisible();
    // …and the More menu still opens with its overflow items.
    await page.getByRole("button", { name: "More" }).click();
    const menu = page.getByRole("menu", { name: "More" });
    await expect(menu).toBeVisible();
    await expect(menu.locator('[role="menuitem"]')).toHaveText([
      "Coming from PHYLIP?",
      "Coming from MEGA?",
      "Labs",
      "Reading trees",
    ]);
    await context.close();
  }

  // A 1280 px window at 200 % zoom: 640 CSS px of compact layout.
  {
    const context = await browser.newContext({
      baseURL: "http://localhost:4173",
      viewport: { width: 640, height: 800 },
      deviceScaleFactor: 2,
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.goto("/?lesson=upgma-vs-nj-matrix");
    await waitForApp(page);
    await expect(page.locator(".app")).toHaveAttribute(
      "data-breakpoint",
      "compact",
    );
    await expectNoHeaderOverlap(page, "1280 px at 200% zoom");
    // 640 CSS px of compact is wordmark + title + Menu — the longest
    // title still fits, so only the mechanism is asserted.
    await expectTitleEllipsis(page, "1280 px at 200% zoom", false);
    // Reachable: the Menu button and the sheet's whole surface.
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Menu" });
    await expect(sheet).toBeVisible();
    for (const name of [
      "Lessons",
      "Guides",
      "Library",
      "Settings",
      "Take the tour",
    ]) {
      await expect(
        sheet.getByRole("button", { name, exact: true }),
        `compact zoomed: ${name} reachable`,
      ).toBeVisible();
    }
    await expect(
      sheet.getByRole("radiogroup", { name: "Mode", exact: true }),
    ).toBeVisible();
    await context.close();
  }

  // Presenter mode at 1920: 1.5× chrome, same non-overlap rule.
  {
    const context = await browser.newContext({
      baseURL: "http://localhost:4173",
      viewport: { width: 1920, height: 1080 },
      serviceWorkers: "block",
    });
    const page = await context.newPage();
    await page.goto("/?lesson=upgma-vs-nj-matrix");
    await waitForApp(page);
    await page.getByRole("button", { name: "Presenter mode" }).click();
    await expect
      .poll(async () =>
        page.evaluate(() =>
          document.documentElement.hasAttribute("data-presenter"),
        ),
      )
      .toBe(true);
    await expectNoHeaderOverlap(page, "presenter at 1920 px");
    // Presenter chrome is 1.5× but 1920 still fits the longest title.
    await expectTitleEllipsis(page, "presenter at 1920 px", false);
    // Reachable: the wide inventory minus Settings (presenter hides
    // it) plus the mode pill.
    for (const name of ["Lessons", "Library", "Dark mode", "Presenter mode"]) {
      await expect(
        page.getByRole("button", { name, exact: true }),
        `presenter: ${name} reachable`,
      ).toBeVisible();
    }
    await expect(
      page.getByRole("link", { name: "Labs" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Reading trees" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Guides" }),
    ).toBeVisible();
    await expect(
      page.getByRole("radiogroup", { name: "Mode" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Settings" }),
    ).toHaveCount(0);
    await context.close();
  }
});

/* ---- axe on the header surfaces (plan Step 1, §16.5) ---- */

async function expectNoSeriousViolations(
  page: Page,
  where: string,
  scope: string,
): Promise<void> {
  const results = await new AxeBuilder({ page }).include(scope).analyze();
  const bad = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    bad.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
    `${where} must have no serious/critical axe violations`,
  ).toEqual([]);
}

for (const theme of ["light", "dark"] as const) {
  test(`axe: the header and its open surfaces are clean (${theme})`, async ({
    page,
    context,
  }) => {
    await context.addInitScript((t) => {
      try {
        window.localStorage.setItem("neophylo.theme", t);
      } catch {
        // storage can be blocked; the app tolerates it
      }
    }, theme);
    await page.emulateMedia({ colorScheme: theme });
    await page.setViewportSize({ width: 1440, height: 800 });
    await page.goto("/?lesson=nj-basics");
    await waitForApp(page);

    // The header at rest and with each wide menu open (its list is a
    // descendant of .app-header, so the scope covers both).
    await expectNoSeriousViolations(page, `header at rest (${theme})`, ".app-header");
    await page.getByRole("button", { name: "Lessons" }).click();
    await expect(page.getByRole("menu", { name: "Lessons" })).toBeVisible();
    await expectNoSeriousViolations(page, `Lessons menu open (${theme})`, ".app-header");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Guides" }).click();
    await expect(page.getByRole("menu", { name: "Guides" })).toBeVisible();
    await expectNoSeriousViolations(page, `Guides menu open (${theme})`, ".app-header");
    await page.keyboard.press("Escape");

    // More exists at medium/narrow — reopen on a medium viewport.
    await page.setViewportSize({ width: 1100, height: 800 });
    await page.getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("menu", { name: "More" })).toBeVisible();
    await expectNoSeriousViolations(page, `More menu open (${theme})`, ".app-header");
    await page.keyboard.press("Escape");

    // The open phone sheet at compact (its backdrop is a header
    // descendant — the scope covers the whole dialog).
    await page.setViewportSize({ width: 360, height: 740 });
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await expect(page.getByRole("dialog", { name: "Menu" })).toBeVisible();
    await expectNoSeriousViolations(page, `phone sheet open (${theme})`, ".app-header");
  });
}
