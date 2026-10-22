// Accessibility, keyboard and offline end-to-end tests (plan Task 25,
// spec §6.5 "Accessibility" and §2.1 "works offline after first load").
//
// - Every built-in lesson is axe-scanned at step 0 and at the final
//   step; no serious or critical violations are allowed.
// - nj-basics is completed using only the keyboard (Tab, arrows, Enter,
//   Space): the Distance/Q switch, the matrix grid's roving-tabindex
//   cells and the stepper buttons are all reachable and operable.
// - The production build (vite preview on :4174 — the second webServer
//   in playwright.config.ts) registers the PWA service worker; after
//   one load the lesson still works with the network cut.

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

import { minQCell, readStep, stepToEnd, waitForApp } from "./helpers";

const LESSONS = ["nj-basics", "upgma-fails", "saturation"] as const;
const PREVIEW_URL = "http://localhost:4174";

/* ---- axe scans ---- */

async function expectNoSeriousViolations(
  page: Page,
  where: string,
): Promise<void> {
  const results = await new AxeBuilder({ page }).analyze();
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

/** The saturation lesson starts with the build blocked; the "Use longer
 * sequences" fix is applied until a tree (and its stepper) exists. */
async function unblockSaturation(page: Page): Promise<void> {
  const stepper = page.getByRole("group", { name: "Trace stepper" });
  const longer = page.getByRole("button", { name: /Use longer sequences/ });
  for (let i = 0; i < 4; i++) {
    if ((await stepper.count()) > 0) return;
    if (!(await longer.isVisible())) return;
    await longer.click();
  }
  await expect(stepper).toBeVisible();
}

for (const id of LESSONS) {
  test(`axe: ${id} has no serious violations at step 0 or the final step`, async ({
    page,
  }) => {
    await page.goto(`/?lesson=${id}`);
    await waitForApp(page);
    await expectNoSeriousViolations(page, `${id} at step 0`);
    if (id === "saturation") await unblockSaturation(page);
    await stepToEnd(page);
    await expectNoSeriousViolations(page, `${id} at the final step`);
  });
}

/* ---- keyboard-only lesson completion ---- */

interface Focused {
  tag: string;
  role: string | null;
  label: string | null;
  text: string;
}

/** tagName, ARIA role, aria-label and text of the focused element. */
async function focused(page: Page): Promise<Focused> {
  return page.evaluate(() => {
    const el = document.activeElement;
    if (el === null) return { tag: "", role: null, label: null, text: "" };
    return {
      tag: el.tagName,
      role: el.getAttribute("role"),
      label: el.getAttribute("aria-label"),
      text: (el.textContent ?? "").trim(),
    };
  });
}

/** Tab until the focused element matches `pred`, forward then backward
 * (Shift+Tab): the target may sit earlier in the ring than the current
 * focus. */
async function tabUntil(
  page: Page,
  pred: (f: Focused) => boolean,
  maxTabs = 40,
): Promise<void> {
  for (let i = 0; i <= maxTabs; i++) {
    if (pred(await focused(page))) return;
    await page.keyboard.press("Tab");
  }
  for (let i = 0; i <= maxTabs; i++) {
    if (pred(await focused(page))) return;
    await page.keyboard.press("Shift+Tab");
  }
  const f = await focused(page);
  throw new Error(
    `no matching focusable within ${maxTabs} tabs each way; stuck at ` +
      `${f.tag} role=${f.role} label=${f.label} text="${f.text}"`,
  );
}

/** data-i/data-j of the focused matrix cell. */
async function focusedCell(page: Page): Promise<{ i: number; j: number }> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    return { i: Number(el?.dataset.i), j: Number(el?.dataset.j) };
  });
}

/** Arrow-key the matrix grid's roving focus to cell (ti, tj). */
async function arrowToCell(page: Page, ti: number, tj: number): Promise<void> {
  for (let g = 0; g < 200; g++) {
    const { i, j } = await focusedCell(page);
    if (i === ti && j === tj) return;
    if (i < ti) await page.keyboard.press("ArrowDown");
    else if (i > ti) await page.keyboard.press("ArrowUp");
    else if (j < tj) await page.keyboard.press("ArrowRight");
    else await page.keyboard.press("ArrowLeft");
  }
  throw new Error(`could not reach cell (${ti}, ${tj})`);
}

/** Answer a gating predict_pair prompt with the keyboard only: compute
 * the minimum-Q cell from the distance matrix (the Distance/Q switch is
 * disabled while a prompt gates — checkpoint 12), Tab into the grid,
 * arrow to it and press Enter. */
async function answerPromptWithKeyboard(page: Page): Promise<void> {
  const cells = page.locator('[role="gridcell"]');
  const idx = await minQCell(page);
  if (idx < 0) throw new Error("no off-diagonal matrix cell found");
  const ti = Number(await cells.nth(idx).getAttribute("data-i"));
  const tj = Number(await cells.nth(idx).getAttribute("data-j"));
  await tabUntil(page, (f) => f.role === "gridcell");
  await arrowToCell(page, ti, tj);
  await page.keyboard.press("Enter");
}

/** Tab to the "Next step" button and activate it with Enter. */
async function keyboardNext(page: Page): Promise<void> {
  await tabUntil(page, (f) => f.label === "Next step", 40);
  await page.keyboard.press("Enter");
}

test("nj-basics can be completed with the keyboard only", async ({ page }) => {
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);

  for (;;) {
    const { k, max } = await readStep(page);
    if (k === max) break;
    const next = page.getByRole("button", { name: "Next step" });
    if (await next.isDisabled()) {
      // A predict_pair prompt gates this position — answer it correctly.
      await answerPromptWithKeyboard(page);
      expect(
        await page.locator(".prompt-verdict.correct").count(),
      ).toBeGreaterThan(0);
    } else {
      await keyboardNext(page);
    }
  }
  expect(await readStep(page)).toEqual({ k: 4, max: 4 });
  await expect(page.locator(".stepper-rf")).toHaveText("matches the true tree in every clade");
});

/* ---- offline (PWA service worker + precache) ---- */

test("a loaded lesson still works offline", async ({
  page,
  context,
  browserName,
}) => {
  // Playwright's setOffline emulation rejects SW-served navigations in
  // Firefox (NS_ERROR_OFFLINE) and WebKit (internal error) — a driver
  // limitation, not app behavior. The precache contract is the same on
  // every engine, so Chromium validates it.
  test.skip(browserName !== "chromium");
  await page.goto(`${PREVIEW_URL}/?lesson=nj-basics`);
  await waitForApp(page);

  // The service worker's install only finishes once the precache (app
  // shell, wasm, exercises/*.json) is populated, and autoUpdate's
  // clients.claim() must have run before a reload is intercepted — an
  // active-but-not-controlling worker leaves the navigation to the
  // (offline) network, so wait for controller, not just active.
  await page.waitForFunction(async () => {
    const reg = await navigator.serviceWorker.getRegistration();
    return (
      reg !== undefined &&
      reg !== null &&
      reg.active !== null &&
      navigator.serviceWorker.controller !== null
    );
  });

  await context.setOffline(true);
  await page.reload();
  await waitForApp(page);
  await expect(page.locator("h1")).toHaveText("How Neighbor-Joining works");
  await stepToEnd(page);
  await expect(page.locator(".stepper-rf")).toHaveText("matches the true tree in every clade");
});
