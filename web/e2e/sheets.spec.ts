// Sheets, Settings drawer, More menu and touch targets (v1.3 plan
// Task 10, spec §6.2–§6.5, §6.10).
//
// - Below 1024 px the pair and replicate panels are full-screen
//   sheets; Esc closes and focus returns to the trigger.
// - The Settings drawer (controls sections, §6.4) opens from a header
//   button below 1280 px: focus trapped, Esc and a backdrop click
//   close it and restore focus to the button.
// - Below 1024 px "Coming from PHYLIP?", Licenses, Source code and
//   Help live in a keyboard-operable "More" menu (§6.3).
// - Under (pointer: coarse) every button, matrix cell and
//   predict_branch target is ≥ 40×40 px (§6.5).
// - Review Focus 5 (drawer half): an open drawer survives a
//   768×1024 → 1024×768 rotation open and focused.
// - Review Focus 4, real input only: the theme switch is exercised by
//   a real Playwright click on the header toggle — it stays reachable
//   (raised above the scrim) while a dialog is open; the run keeps
//   going and the dialog stays open and re-styled.
// - "Skip to content" is the first focusable element and lands focus
//   in the main area; prefers-reduced-motion zeroes transitions and
//   play mode still steps; axe is clean in both themes at all four
//   widths.

import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

import { answerPredictPrompt, readStep, stepToEnd, waitForApp } from "./helpers";

test.use({ serviceWorkers: "block" });

const settingsButton = (page: Page) =>
  page.getByRole("button", { name: "Settings" });
const drawer = (page: Page) =>
  page.getByRole("dialog", { name: "Settings" });
const themeToggle = (page: Page) =>
  page.getByRole("button", { name: "Dark mode" });

/** The focused element sits inside `locator`'s subtree. */
async function expectFocusInside(locator: Locator) {
  const inside = await locator.evaluate((el) =>
    el.contains(document.activeElement),
  );
  expect(inside, "focus is inside the overlay").toBe(true);
}

/** True when the two boxes overlap by a positive area. */
function intersects(
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

/** Review Focus 4 keeps the header's theme toggle a real click target
 * above a content sheet's scrim — but it must sit where no sheet
 * content is: its box may not intersect the sheet's header or any
 * text/button inside it. */
async function expectToggleClearOfSheet(page: Page, dialog: Locator) {
  const tb = await themeToggle(page).boundingBox();
  expect(tb, "the theme toggle has a bounding box").not.toBeNull();
  const header = dialog.locator("header").first();
  await expect(header).toBeVisible();
  const hb = await header.boundingBox();
  expect(hb, "the sheet header has a bounding box").not.toBeNull();
  expect(
    intersects(tb!, hb!),
    "the theme toggle must not overlap the sheet header",
  ).toBe(false);
  const kids = header.locator("*");
  for (let i = 0; i < (await kids.count()); i++) {
    const kb = await kids.nth(i).boundingBox();
    if (kb === null) continue;
    expect(
      intersects(tb!, kb),
      `the theme toggle must not overlap sheet header element ${i}`,
    ).toBe(false);
  }
}

/** Open the pair panel on a protein lesson (predict gate answered
 * first), run `fn` against it, then close it via its own × (the real
 * path while focus is on the header toggle). */
async function withPairPanel(
  page: Page,
  fn: (dialog: Locator) => Promise<void>,
) {
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);
  await answerPredictPrompt(page);
  await page.locator('[role="gridcell"][data-i="0"][data-j="1"]').click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await fn(dialog);
  await dialog
    .getByRole("button", { name: "Close pair details" })
    .click();
  await expect(dialog).toHaveCount(0);
}

/** Open "Coming from PHYLIP?" — the More menu below 1024, the header
 * button at and above it — run `fn`, close via its own ×. */
async function withPhylipHelp(
  page: Page,
  fn: (dialog: Locator) => Promise<void>,
) {
  const direct = page.getByRole("button", { name: "Coming from PHYLIP?" });
  if (await direct.isVisible()) {
    await direct.click();
  } else {
    await page.getByRole("button", { name: "More" }).click();
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Coming from PHYLIP?" })
      .click();
  }
  const dialog = page.getByRole("dialog", { name: "Coming from PHYLIP?" });
  await expect(dialog).toBeVisible();
  await fn(dialog);
  await dialog
    .getByRole("button", { name: "Close PHYLIP help" })
    .click();
  await expect(dialog).toHaveCount(0);
}

const SHEET_CHECK_VIEWPORTS = [
  { w: 768, h: 1024 },
  { w: 1024, h: 768 },
  { w: 1920, h: 1080 },
] as const;

/** Assert the toggle/sheet-header clearance at the current viewport in
 * the current theme, then click the toggle (the real-input RF4 path)
 * and assert again in the other theme. */
async function expectClearInBothThemes(page: Page, dialog: Locator) {
  await expectToggleClearOfSheet(page, dialog);
  await themeToggle(page).click();
  await expectToggleClearOfSheet(page, dialog);
  // Back to light for the next viewport — still a real click.
  await themeToggle(page).click();
}

test("the theme toggle never overlaps sheet header content (pair panel, PHYLIP help)", async ({
  page,
}) => {
  test.setTimeout(120_000);
  for (const vp of SHEET_CHECK_VIEWPORTS) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await withPairPanel(page, (dialog) =>
      expectClearInBothThemes(page, dialog),
    );
    await withPhylipHelp(page, (dialog) =>
      expectClearInBothThemes(page, dialog),
    );
  }
});

test("the theme toggle never overlaps the replicate sheet's header", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);
  await stepToEnd(page);

  // Same short seeded run as the replicate-sheet test above.
  await settingsButton(page).click();
  const dlg = drawer(page);
  await expect(dlg).toBeVisible();
  await dlg.getByLabel("Replicates").fill("10");
  await dlg.getByRole("button", { name: /Run bootstrap/ }).click();
  await expect(dlg.getByText(/Run complete: /)).toBeVisible({
    timeout: 90_000,
  });
  await dlg.getByRole("button", { name: /Watch one replicate/ }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog.locator(".rep-strip")).toBeVisible();

  for (const vp of SHEET_CHECK_VIEWPORTS) {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await expectClearInBothThemes(page, dialog);
  }
});

test("every Settings drawer control stays inside the drawer at 768 and 1024", async ({
  page,
}) => {
  for (const w of [768, 1024] as const) {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto("/?lesson=cytochrome-c");
    await waitForApp(page);
    await settingsButton(page).click();
    const dlg = drawer(page);
    await expect(dlg).toBeVisible();

    const over = await dlg.evaluate((d) => {
      const dr = d.getBoundingClientRect();
      const bad: string[] = [];
      if (d.scrollWidth > d.clientWidth + 1) {
        bad.push(
          `drawer scrollWidth ${d.scrollWidth} > clientWidth ${d.clientWidth}`,
        );
      }
      for (const el of d.querySelectorAll<HTMLElement>("*")) {
        // Content clipped or scrolled by an inner container legitimately
        // extends past it — only free-flowing boxes must stay inside.
        let p = el.parentElement;
        let clipped = false;
        while (p !== null && p !== d) {
          if (getComputedStyle(p).overflowX !== "visible") {
            clipped = true;
            break;
          }
          p = p.parentElement;
        }
        if (clipped) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0) continue;
        if (r.right > dr.right + 0.5 || r.left < dr.left - 0.5) {
          bad.push(
            `${el.tagName.toLowerCase()}.${el.className} ` +
              `x=[${r.left.toFixed(1)},${r.right.toFixed(1)}] ` +
              `outside drawer [${dr.left.toFixed(1)},${dr.right.toFixed(1)}]`,
          );
        }
      }
      return bad;
    });
    expect(over, `drawer overflow at ${w}px`).toEqual([]);
    await page.keyboard.press("Escape");
    await expect(dlg).toHaveCount(0);
  }
});

/** The dialog's bounding box covers the viewport (the full-screen
 * sheet, §6.2). */
async function expectFullScreen(page: Page, dialog: Locator) {
  const vp = page.viewportSize();
  expect(vp, "viewport size is known").not.toBeNull();
  const box = await dialog.boundingBox();
  expect(box, "the sheet has a bounding box").not.toBeNull();
  expect(Math.abs(box!.x), "sheet fills the left edge").toBeLessThanOrEqual(1);
  expect(Math.abs(box!.y), "sheet fills the top edge").toBeLessThanOrEqual(1);
  expect(box!.width, "sheet is viewport-wide").toBeGreaterThanOrEqual(
    vp!.width - 1,
  );
  expect(box!.height, "sheet is viewport-tall").toBeGreaterThanOrEqual(
    vp!.height - 1,
  );
}

test("below 1024 the pair panel is a full-screen sheet; Esc restores focus to the cell", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);

  // Position 0 is gated by the predict_pair prompt — answer it so a
  // cell pick opens the pair panel rather than the prediction.
  await answerPredictPrompt(page);
  const cell = page.locator('[role="gridcell"][data-i="0"][data-j="1"]');
  await cell.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expectFullScreen(page, dialog);

  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(cell).toBeFocused();
});

test("below 1024 the replicate panel is a full-screen sheet; Esc closes it", async ({
  page,
}) => {
  test.setTimeout(180_000);
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);
  await stepToEnd(page);

  // A short seeded run through the drawer, then "Watch one replicate".
  await settingsButton(page).click();
  const dlg = drawer(page);
  await expect(dlg).toBeVisible();
  await dlg.getByLabel("Replicates").fill("10");
  await dlg.getByRole("button", { name: /Run bootstrap/ }).click();
  await expect(dlg.getByText(/Run complete: /)).toBeVisible({
    timeout: 90_000,
  });
  await dlg.getByRole("button", { name: /Watch one replicate/ }).click();

  const dialog = page.getByRole("dialog");
  await expect(dialog).toHaveCount(1);
  await expect(dialog.locator(".rep-strip")).toBeVisible();
  await expectFullScreen(page, dialog);

  // Esc closes the sheet; its trigger lived inside the drawer the
  // opening dismissed, so focus settles on the page body.
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
});

test("the Settings drawer traps focus; Esc and a backdrop click restore focus to its button", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);

  await settingsButton(page).click();
  const dlg = drawer(page);
  await expect(dlg).toBeVisible();
  await expectFocusInside(dlg);
  // The drawer's own sections are inside (§6.4); "How sure are we?"
  // and Import join when a run/section exists — at step 0 they don't.
  await expect(
    dlg.getByRole("heading", { name: "Simulation" }),
  ).toBeVisible();
  await expect(dlg.getByRole("heading", { name: "Analysis" })).toBeVisible();
  await expect(dlg.getByRole("heading", { name: "Export" })).toBeVisible();

  // Tab is trapped: it cycles inside the drawer.
  for (let i = 0; i < 8; i++) {
    await page.keyboard.press("Tab");
    await expectFocusInside(dlg);
  }

  await page.keyboard.press("Escape");
  await expect(dlg).toHaveCount(0);
  await expect(settingsButton(page)).toBeFocused();

  // A click on the scrim closes it the same way.
  await settingsButton(page).click();
  await expect(dlg).toBeVisible();
  await page.mouse.click(900, 700);
  await expect(dlg).toHaveCount(0);
  await expect(settingsButton(page)).toBeFocused();
});

test("Review Focus 5: the open drawer survives a 768×1024 → 1024×768 rotation open and focused", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await settingsButton(page).click();
  const dlg = drawer(page);
  await expect(dlg).toBeVisible();
  await expectFocusInside(dlg);

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator(".app")).toHaveAttribute(
    "data-breakpoint",
    "medium",
  );
  // Both widths live below 1280 — the drawer stays open and keeps its
  // focus (the spec's "open and focused" half).
  await expect(dlg).toBeVisible();
  await expectFocusInside(dlg);
});

test("below 1024 the More menu holds the secondary items and works by keyboard", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);

  const more = page.getByRole("button", { name: "More" });
  await expect(more).toBeVisible();
  // The direct "Coming from PHYLIP?" header button is gone below 1024.
  await expect(
    page.getByRole("button", { name: "Coming from PHYLIP?" }),
  ).toHaveCount(0);

  await more.focus();
  await page.keyboard.press("Enter");
  const menu = page.getByRole("menu", { name: "More" });
  await expect(menu).toBeVisible();
  const items = menu.locator('[role="menuitem"]');
  await expect(items).toHaveText([
    "Coming from PHYLIP?",
    "PHYLIP labs",
    "Take the tour",
    "Licenses",
    "Source code",
    "Help",
  ]);

  // Arrows rove the items, Esc closes and returns focus to the button.
  await expect(items.first()).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(1)).toBeFocused();
  await page.keyboard.press("ArrowDown");
  await expect(items.nth(2)).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(more).toBeFocused();

  // "Coming from PHYLIP?" opens its (full-screen) sheet from the menu.
  await page.keyboard.press("Enter");
  await menu.getByRole("menuitem", { name: "Coming from PHYLIP?" }).click();
  const dialog = page.getByRole("dialog", { name: "Coming from PHYLIP?" });
  await expect(dialog).toBeVisible();
  await expectFullScreen(page, dialog);
});

test("Review Focus 4, real input: a real click switches theme with the pair panel open mid-run, and with the replicate panel open", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);
  await stepToEnd(page);

  await page.getByRole("button", { name: /Run bootstrap/ }).click();
  // Step back to the full taxon matrix while the run proceeds — pair
  // cells resolve to sequences only on earlier steps (App's pairDetail).
  await page.locator('[aria-label="Step"]').fill("0");
  await page.locator('[role="gridcell"][data-i="0"][data-j="1"]').click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const bgBefore = await dialog.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );

  // The header toggle stays a real click target above the scrim — no
  // dispatchEvent, exactly what a pointer user can reach.
  await themeToggle(page).click();
  await expect(dialog).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(
    "dark",
  );
  // Re-styled, still open: the dialog's surface now reads the dark token.
  const bgAfter = await dialog.evaluate(
    (el) => getComputedStyle(el).backgroundColor,
  );
  expect(bgAfter).not.toBe(bgBefore);

  // Close the dialog, return to the final position and let the run
  // settle — it kept going behind the sheet. The real toggle click
  // moved focus to the header, so the dialog's own × is the real path
  // out (Esc on the toggle wouldn't reach the sheet's key handler).
  await dialog
    .getByRole("button", { name: "Close pair details" })
    .click();
  await expect(dialog).toHaveCount(0);
  const { max } = await readStep(page);
  await page.locator('[aria-label="Step"]').fill(String(max));
  const done = page.getByText(/Run complete: /);
  const start = page.getByRole("button", { name: "Start", exact: true });
  const doneWait = done
    .waitFor({ timeout: 120_000 })
    .then(() => "done" as const);
  const startWait = start
    .waitFor({ timeout: 120_000 })
    .then(() => "confirm" as const);
  doneWait.catch(() => {});
  startWait.catch(() => {});
  const winner = await Promise.race([doneWait, startWait]);
  if (winner === "confirm") await start.click();
  await expect(done).toBeVisible({ timeout: 120_000 });
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(
    "dark",
  );

  // The replicate panel too: real click back to light, dialog open.
  await page
    .getByRole("button", { name: /Watch one replicate/ })
    .click();
  const repDialog = page.getByRole("dialog");
  await expect(repDialog).toBeVisible();
  await themeToggle(page).click();
  expect(await page.evaluate(() => document.documentElement.dataset.theme)).toBe(
    "light",
  );
  await expect(repDialog).toBeVisible();
});

test("the skip link is the first focusable element and lands focus in the main area", async ({
  page,
}) => {
  // upgma-fails has no predict prompts, so nothing re-parks focus on
  // load — the first Tab is the real "from the top" navigation the
  // skip link answers.
  await page.goto("/?lesson=upgma-fails");
  await waitForApp(page);

  await page.keyboard.press("Tab");
  const skip = page.locator(".skip-link");
  await expect(skip).toBeFocused();
  await expect(skip).toHaveText("Skip to content");

  await page.keyboard.press("Enter");
  const focused = await page.evaluate(
    () => document.activeElement?.id ?? "",
  );
  expect(focused).toBe("main-content");
});

test("prefers-reduced-motion zeroes transitions and play mode still steps", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);

  const durations = await page.evaluate(() => {
    const b = document.querySelector("button")!;
    const s = getComputedStyle(b);
    return { transition: s.transitionDuration, animation: s.animationDuration };
  });
  expect(durations.transition).toBe("0s");
  expect(durations.animation).toBe("0s");

  // Step through once so every prompt is answered, then replay from
  // the start — a gated position disables Play, so play-through needs
  // the prompts resolved.
  await stepToEnd(page);
  await page.locator('[aria-label="Step"]').fill("0");
  const before = await readStep(page);
  await page.getByRole("button", { name: "Play" }).click();
  await expect
    .poll(async () => (await readStep(page)).k, { timeout: 5_000 })
    .toBeGreaterThan(before.k);
});

test("under (pointer: coarse) every button, matrix cell and predict_branch target is ≥40×40", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto("/?lesson=bootstrap-basics");
  await waitForApp(page);
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    "the emulation presents a coarse pointer",
  ).toBe(true);

  await stepToEnd(page);
  // The predict_branch prompt at the final position leaves the
  // branch-hit targets on the inferred tree.
  await expect(page.locator(".branch-hit").first()).toBeVisible();

  const targets = page.locator(
    'button, [role="button"], [role="gridcell"]',
  );
  const count = await targets.count();
  expect(count, "interactive targets on screen").toBeGreaterThan(10);
  for (let i = 0; i < count; i++) {
    const target = targets.nth(i);
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    if (box === null) continue;
    const name =
      (await target.getAttribute("aria-label")) ??
      (await target.innerText().catch(() => "")).slice(0, 40) ??
      `target ${i}`;
    expect(
      box.width,
      `"${name}" is at least 40 px wide (got ${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(40);
    expect(
      box.height,
      `"${name}" is at least 40 px tall (got ${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(40);
  }
  await context.close();
});

const AXE_WIDTHS = [768, 1024, 1280, 1920] as const;
for (const w of AXE_WIDTHS) {
  for (const theme of ["light", "dark"] as const) {
    test(`axe is clean at ${w} px in ${theme} theme`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width: w, height: 800 });
      await context.addInitScript((t) => {
        try {
          window.localStorage.setItem("neophylo.theme", t);
        } catch {
          // storage can be blocked; the app tolerates it
        }
      }, theme);
      await page.goto("/?lesson=nj-basics");
      await waitForApp(page);
      const results = await new AxeBuilder({ page }).analyze();
      const bad = results.violations.filter(
        (v) => v.impact === "serious" || v.impact === "critical",
      );
      expect(
        bad.map((v) => `${v.id} (${v.impact})`),
        `axe at ${w} px ${theme}`,
      ).toEqual([]);
    });
  }
}
