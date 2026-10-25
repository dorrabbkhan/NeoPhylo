// Presenter mode end-to-end tests (v1.3 plan Task 11, spec §6.6):
//
// - The header toggle carries aria-pressed, sets <html
//   data-presenter>, and renders the type and spacing tokens at
//   1.5× — tree leaf text and the step buttons included.
// - The controls column (wide) and the Settings drawer button
//   (below 1280) hide; the choice persists under
//   neophylo.presenter and never enters the URL.
// - Review Focus 3: with storage throwing, the app boots with
//   presenter off and no errors, and the toggle still works for
//   the session.
// - Review Focus 4, real input only: a real Playwright click on
//   the header toggle — raised above a content sheet's scrim like
//   the theme toggle (Task 10/PR #74) — switches presenter mode
//   mid-run and with the replicate panel open; the run keeps going
//   and the dialog stays open and re-styled.
// - The parked toggles never overlap a sheet's header content at
//   768/1024/1920 in either theme.

import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { answerPredictPrompt, readStep, stepToEnd, waitForApp } from "./helpers";

test.use({ serviceWorkers: "block" });

const toggle = (page: Page) =>
  page.getByRole("button", { name: "Presenter mode" });
const settingsButton = (page: Page) =>
  page.getByRole("button", { name: "Settings" });
const dataPresenter = (page: Page) =>
  page.evaluate(() => document.documentElement.hasAttribute("data-presenter"));

// Leaf labels are the classless <text> children of leaf node groups
// (same selector as layout.spec.ts).
const LEAF_LABELS =
  'svg > g[data-node]:not(:has(> .connector)) > text:not([class])';

const fontSize = (el: Locator) =>
  el.evaluate((e) => parseFloat(getComputedStyle(e).fontSize));

test("the toggle sets data-presenter and scales tree text and step buttons 1.5×", async ({
  page,
}) => {
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  const leaf = page.locator(LEAF_LABELS).first();
  await expect(leaf).toBeVisible();
  const next = page.getByRole("button", { name: "Next step" });
  const leafBefore = await fontSize(leaf);
  const stepBefore = await fontSize(next);
  const varBefore = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue(
      "--size-md",
    ),
  );

  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  expect(await dataPresenter(page)).toBe(true);

  // The 1.5× lands through the tokens: --size-md is 16 px normally.
  expect(varBefore).toBe("16px");
  expect(
    await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue(
        "--size-md",
      ),
    ),
  ).toBe("24px");
  expect(await fontSize(leaf)).toBeCloseTo(leafBefore * 1.5, 1);
  expect(await fontSize(next)).toBeCloseTo(stepBefore * 1.5, 1);

  await toggle(page).click();
  expect(await dataPresenter(page)).toBe(false);
  expect(await fontSize(leaf)).toBeCloseTo(leafBefore, 1);
});

test("presenter hides the controls column (wide) and the Settings button (below 1280)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await expect(page.locator(".col-controls")).toHaveCount(1);

  await toggle(page).click();
  expect(await dataPresenter(page)).toBe(true);
  await expect(page.locator(".col-controls")).toHaveCount(0);

  // Crossing into medium keeps the controls unreachable: the
  // drawer's header button is gone too.
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator(".app")).toHaveAttribute(
    "data-breakpoint",
    "medium",
  );
  await expect(settingsButton(page)).toHaveCount(0);

  // Toggling back off restores the trigger.
  await toggle(page).click();
  expect(await dataPresenter(page)).toBe(false);
  await expect(settingsButton(page)).toBeVisible();
});

test("the choice persists per device and stays out of the URL", async ({
  page,
}) => {
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  // The URL state sync is a replaceState in a post-render effect — on
  // WebKit it lands measurably after .app first paints (~200 ms), so a
  // URL read now can still catch the pre-sync "?lesson=" form. Wait
  // for the deterministic end state (encode() always writes `s=`), so
  // urlBefore is the SETTLED URL the toggle must not change.
  await expect.poll(() => page.url()).toContain("&s=");
  const urlBefore = page.url();

  await toggle(page).click();
  expect(await dataPresenter(page)).toBe(true);
  expect(
    await page.evaluate(() =>
      window.localStorage.getItem("neophylo.presenter"),
    ),
  ).toBe("1");
  expect(page.url()).not.toContain("presenter");
  // The URL still encodes the same view state — only the attribute
  // changed, nothing about the link.
  expect(page.url()).toBe(urlBefore);

  await page.reload();
  await waitForApp(page);
  expect(await dataPresenter(page)).toBe(true);
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
});

test("blocked storage: presenter defaults off with no errors and the toggle still works for the session", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      get() {
        throw new DOMException("storage is blocked", "SecurityError");
      },
    });
  });
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  expect(await dataPresenter(page)).toBe(false);
  await toggle(page).click();
  expect(await dataPresenter(page)).toBe(true);
  expect(errors.filter((e) => !/sw\.js|service worker/i.test(e))).toEqual(
    [],
  );
});

test("Review Focus 4, real input: a real click switches presenter with the pair panel open mid-run, and with the replicate panel open", async ({
  page,
}) => {
  test.setTimeout(240_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);
  await stepToEnd(page);

  await page.getByRole("button", { name: /Run bootstrap/ }).click();
  // Step back to the full taxon matrix while the run proceeds — pair
  // cells resolve to sequences only on earlier steps.
  await page.locator('[aria-label="Step"]').fill("0");
  await page.locator('[role="gridcell"][data-i="0"][data-j="1"]').click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  const head = dialog.locator("header").first();
  const headBefore = await fontSize(head);

  // The header toggle stays a real click target above the scrim — no
  // dispatchEvent, exactly what a pointer user can reach.
  await toggle(page).click();
  expect(await dataPresenter(page)).toBe(true);
  await expect(dialog).toBeVisible();
  // Re-styled, still open: the sheet's text now reads the 1.5× tokens.
  expect(await fontSize(head)).toBeGreaterThan(headBefore);

  // Back off again — still a real click while the sheet is up — then
  // close the dialog, return to the final position and let the run
  // settle. It kept going behind the sheet through both switches
  // (presenter hides the controls column, so the confirm gate and
  // the "Run complete" line are only reachable with the mode off).
  await toggle(page).click();
  expect(await dataPresenter(page)).toBe(false);
  await expect(dialog).toBeVisible();
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

  // The replicate panel too: opened first (its trigger lives in the
  // controls presenter hides), then a real click switches presenter
  // on with the sheet up — it stays open.
  await page
    .getByRole("button", { name: /Watch one replicate/ })
    .click();
  const repDialog = page.getByRole("dialog");
  await expect(repDialog).toBeVisible();
  await toggle(page).click();
  expect(await dataPresenter(page)).toBe(true);
  await expect(repDialog).toBeVisible();
});

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

/** Both header toggles (theme and presenter share the raised slot)
 * must sit where no sheet content is: no box may intersect the
 * sheet's header or any element inside it. */
async function expectTogglesClearOfSheet(page: Page, dialog: Locator) {
  const header = dialog.locator("header").first();
  await expect(header).toBeVisible();
  const hb = await header.boundingBox();
  expect(hb, "the sheet header has a bounding box").not.toBeNull();
  const kids = header.locator("*");
  const kidBoxes = [];
  for (let i = 0; i < (await kids.count()); i++) {
    const kb = await kids.nth(i).boundingBox();
    if (kb !== null) kidBoxes.push(kb);
  }
  for (const name of ["Dark mode", "Presenter mode"]) {
    const tb = await page
      .getByRole("button", { name })
      .boundingBox();
    expect(tb, `the ${name} toggle has a bounding box`).not.toBeNull();
    expect(
      intersects(tb!, hb!),
      `the ${name} toggle must not overlap the sheet header`,
    ).toBe(false);
    for (const [i, kb] of kidBoxes.entries()) {
      expect(
        intersects(tb!, kb),
        `the ${name} toggle must not overlap sheet header element ${i}`,
      ).toBe(false);
    }
  }
}

test("the header toggles never overlap sheet header content in presenter mode (768/1024/1920, both themes)", async ({
  page,
  context,
}) => {
  test.setTimeout(180_000);
  for (const theme of ["light", "dark"] as const) {
    for (const vp of [
      { w: 768, h: 1024 },
      { w: 1024, h: 768 },
      { w: 1920, h: 1080 },
    ]) {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await context.addInitScript((t) => {
        try {
          window.localStorage.setItem("neophylo.theme", t);
        } catch {
          // storage can be blocked; the app tolerates it
        }
      }, theme);
      await page.goto("/?lesson=cytochrome-c");
      await waitForApp(page);
      // Open the pair panel through a real cell pick (the predict
      // prompt at position 0 gates the matrix — answer it first).
      await answerPredictPrompt(page);
      await page.locator('[role="gridcell"][data-i="0"][data-j="1"]').click();
      const dialog = page.getByRole("dialog");
      await expect(dialog).toBeVisible();
      // Presenter on through a real click — the toggle must stay a
      // real pointer path — then check the parked/header slot.
      await toggle(page).click();
      expect(await dataPresenter(page)).toBe(true);
      await expectTogglesClearOfSheet(page, dialog);
      // Back off — the pref is device-local and would leak into the
      // next viewport's load otherwise. Still a real click path.
      await toggle(page).click();
      expect(await dataPresenter(page)).toBe(false);
      await dialog
        .getByRole("button", { name: "Close pair details" })
        .click();
      await expect(dialog).toHaveCount(0);
    }
  }
});
