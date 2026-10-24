// Lessons-menu end-to-end tests (checkpoint 13): the header's "Lessons"
// menu lists every built-in lesson in teaching order, each with a
// one-line summary; picking one loads it at ?lesson=<id>; the whole
// menu is keyboard-operable (menu-button pattern); and the page stays
// axe-clean with the menu open and after a switch.

import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

import { waitForApp } from "./helpers";

const ORDER = [
  "How Neighbor-Joining works",
  "When UPGMA fails: the molecular clock",
  "Saturation and distance correction",
  "Bootstrap: how sure is the tree?",
  "Protein distances: when counting isn't enough",
  "Cytochrome c: a real protein tree",
];

test("the Lessons menu lists every lesson in teaching order", async ({
  page,
}) => {
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("button", { name: "Lessons" }).click();
  const items = page.getByRole("menuitemradio");
  await expect(items).toHaveCount(ORDER.length);
  for (const [i, title] of ORDER.entries()) {
    await expect(items.nth(i)).toContainText(title);
    // One-line summary under every title.
    await expect(items.nth(i).locator(".lessons-menu-summary")).not.toBeEmpty();
  }
  // The loaded lesson is marked.
  await expect(
    page.getByRole("menuitemradio", { name: /How Neighbor-Joining works/ }),
  ).toHaveAttribute("aria-checked", "true");
});

test("picking a lesson loads it at ?lesson=<id> and step 0", async ({
  page,
}) => {
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await page.getByRole("button", { name: "Lessons" }).click();
  await page
    .getByRole("menuitemradio", { name: /When UPGMA fails/ })
    .click();
  await expect(page).toHaveURL(/lesson=upgma-fails/);
  await expect(page.locator("h1")).toHaveText(
    "When UPGMA fails: the molecular clock",
  );
  await expect(page.locator(".stepper-status")).toContainText("step 0 of");
  // The mark follows the loaded lesson.
  await page.getByRole("button", { name: "Lessons" }).click();
  await expect(
    page.getByRole("menuitemradio", { name: /When UPGMA fails/ }),
  ).toHaveAttribute("aria-checked", "true");
});

test("the menu is keyboard-operable: Enter opens, arrows move, Esc closes", async ({
  page,
}) => {
  await page.goto("/");
  await waitForApp(page);
  const button = page.getByRole("button", { name: "Lessons" });
  await button.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "Lessons" });
  await expect(menu).toBeVisible();
  // Opens focused on the current lesson's item.
  await expect(
    page.getByRole("menuitemradio", { name: /How Neighbor-Joining works/ }),
  ).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(
    page.getByRole("menuitemradio", { name: /When UPGMA fails/ }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();
  // ArrowDown also opens.
  await page.keyboard.press("ArrowDown");
  await expect(menu).toBeVisible();
});

// Task 12 round 4: at 720 px the open menu was ~690 px tall and its
// last item ("Take the tour", ≥ 1280 only) sat at/past the viewport's
// bottom edge; at 600 px it was unreachable. The list now caps inside
// the viewport and scrolls, so End must land the tour row fully inside
// both the viewport and the list's visible area — then activating it
// starts the tour. Shared storage marks tourSeen, so the tour only
// appears via this explicit reopen.
for (const vh of [720, 600]) {
  test(`1280×${vh}: the menu fits the viewport and End reaches Take the tour`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: vh });
    await page.goto("/?lesson=cytochrome-c");
    await waitForApp(page);
    await page.getByRole("button", { name: "Lessons" }).click();
    const menu = page.getByRole("menu", { name: "Lessons" });
    await expect(menu).toBeVisible();

    // The whole list sits inside the viewport.
    const mbox = await menu.boundingBox();
    expect(mbox).not.toBeNull();
    expect(mbox!.x).toBeGreaterThanOrEqual(0);
    expect(mbox!.x + mbox!.width).toBeLessThanOrEqual(1280);
    expect(mbox!.y).toBeGreaterThanOrEqual(0);
    expect(mbox!.y + mbox!.height).toBeLessThanOrEqual(vh);

    // End focuses the last item; it is fully inside the viewport AND
    // inside the list's visible area (the scroll did its job).
    await page.keyboard.press("End");
    const item = menu.getByRole("menuitem", { name: "Take the tour" });
    await expect(item).toBeFocused();
    const ibox = await item.boundingBox();
    expect(ibox).not.toBeNull();
    expect(ibox!.x).toBeGreaterThanOrEqual(0);
    expect(ibox!.x + ibox!.width).toBeLessThanOrEqual(1280);
    expect(ibox!.y).toBeGreaterThanOrEqual(0);
    expect(ibox!.y + ibox!.height).toBeLessThanOrEqual(vh);
    expect(ibox!.y).toBeGreaterThanOrEqual(mbox!.y);
    expect(ibox!.x).toBeGreaterThanOrEqual(mbox!.x);
    expect(ibox!.x + ibox!.width).toBeLessThanOrEqual(mbox!.x + mbox!.width);
    expect(ibox!.y + ibox!.height).toBeLessThanOrEqual(
      mbox!.y + mbox!.height,
    );

    // Activating it closes the menu and starts the tour.
    await page.keyboard.press("Enter");
    await expect(menu).toHaveCount(0);
    await expect(
      page.getByRole("dialog", { name: "Take the tour" }),
    ).toBeVisible();
  });
}

test("axe: the page stays clean with the Lessons menu open", async ({
  page,
}) => {
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("button", { name: "Lessons" }).click();
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    bad.map(
      (v) =>
        `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target.join(" ")).join(", ")}`,
    ),
    "open Lessons menu must have no serious/critical axe violations",
  ).toEqual([]);
});
