// Phone-sheet mobile regression pin (v1.4d Task 15 fix round — owner
// iPhone Safari checkpoint finding on PR #182, reproduced in the
// pinned image on both the v1.4.2 deploy and this branch, so
// pre-existing on main; re-pinned on the phone sheet by v1.5 Task 2,
// which moved all <768 px navigation into the sheet): at iPhone
// widths the open Lessons list
//   (a) squashed its rows — WebKit lets <button> flex items shrink
//       below their content inside the capped, scrolling list, so a
//       summary bled into the next row;
//   (b) ran off the viewport's left edge — the list was right-aligned
//       under a mid-header button with min-width 300 px;
//   (c) painted under the header's second-row theme/presenter toggles
//       — their z-index 40 (meant to beat an open sheet's scrim)
//       applied at all times, over the list's z-index 10.
// The phone sheet's tile grid is checked for the same three defects
// at the same widths — it is the <768 px surface for every
// destination the More menu used to carry (§16.3).
//
// Sizes are the report's: 320×640 (the smallest supported width) and
// 390×844 (the iPhone 12–14 CSS viewport). hasTouch sets the coarse
// pointer (the ≥40 px menu-item floor in index.css); isMobile joins
// it where the engine implements the option — Firefox throws on it,
// so the fixture below gives it every project but firefox's.

import { expect, test as base } from "@playwright/test";
import type { Locator } from "@playwright/test";

import { waitForApp } from "./helpers";

const test = base.extend({
  // isMobile only exists with touch anyway, and Firefox throws on
  // the option outright — it gets hasTouch and viewport only.
  isMobile: async ({ hasTouch }, provide, testInfo) => {
    await provide(hasTouch === true && testInfo.project.name !== "firefox");
  },
});

test.use({ hasTouch: true });

const SIZES = [
  { w: 320, h: 640 },
  { w: 390, h: 844 },
];

/** The finding's (a)–(c) on an open menu list: rows keep their
 * content height, the list sits inside [0, innerWidth] with ≥ 8 px of
 * margin each side, and nothing paints over a visible item. */
async function checkMenu(list: Locator, what: string): Promise<void> {
  const report = await list.evaluate((el) => {
    const lr = el.getBoundingClientRect();
    const items = [...el.children].map((child, i) => {
      const r = child.getBoundingClientRect();
      // An item's visible part is its box clipped to the list's
      // scrollport and to the viewport.
      const left = Math.max(r.left, lr.left, 0);
      const right = Math.min(r.right, lr.right, window.innerWidth);
      const top = Math.max(r.top, lr.top, 0);
      const bottom = Math.min(r.bottom, lr.bottom, window.innerHeight);
      let hit: string | null = null;
      if (right - left >= 1 && bottom - top >= 1) {
        const e = document.elementFromPoint(
          (left + right) / 2,
          (top + bottom) / 2,
        );
        hit =
          e === child || child.contains(e)
            ? "ok"
            : e === null
              ? "nothing"
              : `${e.tagName.toLowerCase()}.${String(e.className).slice(0, 60)}`;
      }
      return {
        i,
        text: child.textContent?.trim().slice(0, 30) ?? "",
        h: r.height,
        sh: child.scrollHeight,
        hit,
      };
    });
    return {
      vw: window.innerWidth,
      x: lr.x,
      right: lr.right,
      items,
    };
  });

  // (a) no row shrunk below its content.
  for (const it of report.items) {
    expect(
      it.h,
      `${what}: "${it.text}" keeps its content height (${it.h} vs scrollHeight ${it.sh})`,
    ).toBeGreaterThanOrEqual(it.sh - 1);
  }
  // (b) the list lies inside [0, innerWidth] with ≥ 8 px each side.
  expect(
    report.x,
    `${what}: list's left edge ${report.x} has its ≥8 px margin`,
  ).toBeGreaterThanOrEqual(7.5);
  expect(
    report.right,
    `${what}: list's right edge ${report.right} leaves ≥8 px`,
  ).toBeLessThanOrEqual(report.vw - 7.5);
  // (c) the item or its descendant is topmost at its visible centre.
  for (const it of report.items) {
    if (it.hit === null) continue;
    expect(
      it.hit,
      `${what}: "${it.text}" is the topmost element at its visible centre`,
    ).toBe("ok");
  }
}

for (const { w, h } of SIZES) {
  test.describe(`${w}×${h}`, () => {
    test.use({ viewport: { width: w, height: h } });

    test("the phone sheet's Lessons list keeps its rows, stays on screen and paints on top", async ({
      page,
    }) => {
      await page.goto("/");
      await waitForApp(page);
      await page.getByRole("button", { name: "Menu" }).click();
      await page.getByRole("button", { name: "Lessons" }).click();
      const list = page.locator(".phone-sheet-list");
      await expect(list).toBeVisible();
      await checkMenu(list, "Lessons list");
    });

    test("the phone sheet's tile grid keeps its rows, stays on screen and paints on top", async ({
      page,
    }) => {
      await page.goto("/");
      await waitForApp(page);
      await page.getByRole("button", { name: "Menu" }).click();
      const list = page.locator(".phone-sheet-tiles");
      await expect(list).toBeVisible();
      await checkMenu(list, "phone sheet tiles");
    });
  });
}
