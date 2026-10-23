// Shared e2e helpers (plan Task 23). Kept out of the specs so the
// lesson and share specs state only what they assert.
//
// `answerPredictPrompt` answers the gating predict_pair prompt with the
// genuinely correct pair without peeking at the marked cell (which the
// gate hides anyway). The Q view can't help: the toggle is disabled
// while a prompt gates (checkpoint 12), so the helper computes Q from
// the distance matrix itself — Q(i,j) = (n-2)·d(i,j) − R_i − R_j —
// exactly as a student is meant to. UPGMA joins the minimum distance.

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Wait until the app has loaded a lesson (session !== null renders .app). */
export async function waitForApp(page: Page): Promise<void> {
  await expect(page.locator(".app")).toBeVisible();
}

/** Wait until the page is controlled by an ACTIVATED service worker
 * whose precache is complete. `serviceWorker.ready` resolves only once
 * a registration's worker is active, and activation only follows a
 * completed install — i.e. the precache is fully populated. The
 * generated sw.js does not call clients.claim(), so the first load is
 * never controlled; a navigation instead selects the active
 * registration, so one still-online reload puts the page under the
 * worker's control (the state a real second visit is in).
 *
 * This must be a real awaited evaluate (+ reload), not
 * `waitForFunction(async () => …)`: Playwright polls the predicate's
 * return value and a Promise is truthy, so an async predicate resolves
 * on the first poll and never waits — the offline cut then races SW
 * activation (the CI ERR_INTERNET_DISCONNECTED flake). */
export async function waitForServiceWorkerControl(page: Page): Promise<void> {
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  if (await page.evaluate(() => navigator.serviceWorker.controller === null)) {
    await page.reload();
    await page.evaluate(async () => {
      await navigator.serviceWorker.ready;
    });
  }
}

/** Current stepper position and max, parsed from "step k of N". */
export async function readStep(
  page: Page,
): Promise<{ k: number; max: number }> {
  const text = await page.locator(".stepper-status").innerText();
  const m = /step (\d+) of (\d+)/.exec(text);
  if (m === null) throw new Error(`unexpected stepper text: "${text}"`);
  return { k: Number(m[1]), max: Number(m[2]) };
}

/** Locator index of the minimum off-diagonal matrix cell currently shown
 * (-1 when the grid is empty). Works on whichever view is on screen —
 * distance or Q — since both parse the value out of each cell's
 * aria-label. */
export async function minCell(page: Page): Promise<number> {
  const cells = page.locator('[role="gridcell"]');
  const count = await cells.count();
  let best = -1;
  let bestVal = Infinity;
  for (let c = 0; c < count; c++) {
    const cell = cells.nth(c);
    const i = Number(await cell.getAttribute("data-i"));
    const j = Number(await cell.getAttribute("data-j"));
    if (j <= i) continue; // upper triangle only
    const label = (await cell.getAttribute("aria-label")) ?? "";
    const v = Number(label.slice(label.lastIndexOf(":") + 1));
    if (v < bestVal) {
      bestVal = v;
      best = c;
    }
  }
  return best;
}

/** Locator index of the minimum-Q off-diagonal cell, computed from the
 * on-screen distance matrix: Q(i,j) = (n−2)·d(i,j) − R_i − R_j, where
 * R_i is row i's total distance. Needed because the Distance/Q toggle
 * is disabled while a predict prompt gates (checkpoint 12). */
export async function minQCell(page: Page): Promise<number> {
  const cells = page.locator('[role="gridcell"]');
  const count = await cells.count();
  const d = new Map<string, number>(); // "i,j" with i < j → distance
  const locator: number[] = []; // locator index for each (i, j)
  let n = 0;
  for (let c = 0; c < count; c++) {
    const cell = cells.nth(c);
    const i = Number(await cell.getAttribute("data-i"));
    const j = Number(await cell.getAttribute("data-j"));
    if (j <= i) continue;
    n = Math.max(n, i + 1, j + 1);
    const label = (await cell.getAttribute("aria-label")) ?? "";
    d.set(`${i},${j}`, Number(label.slice(label.lastIndexOf(":") + 1)));
    locator.push(c);
  }
  if (locator.length === 0) return -1;
  const dist = (a: number, b: number): number => {
    const v = a < b ? d.get(`${a},${b}`) : d.get(`${b},${a}`);
    return v ?? 0;
  };
  const row = Array.from({ length: n }, (_, i) => {
    let s = 0;
    for (let j = 0; j < n; j++) if (j !== i) s += dist(i, j);
    return s;
  });
  let best = -1;
  let bestQ = Infinity;
  const pairs = Array.from(d.keys(), (k) => k.split(",").map(Number));
  for (const [i, j] of pairs) {
    const q = (n - 2) * dist(i, j) - row[i] - row[j];
    if (q < bestQ) {
      bestQ = q;
      best = locator[pairs.findIndex(([a, b]) => a === i && b === j)];
    }
  }
  return best;
}

/** Answer the gating predict_pair prompt with the correct pair. */
export async function answerPredictPrompt(page: Page): Promise<void> {
  // NJ joins the minimum-Q pair (the Q toggle exists but is disabled
  // while gated); without a trace the method is UPGMA → min distance.
  const isNj =
    (await page.getByRole("switch", { name: "Distance / Q" }).count()) > 0;
  const best = isNj ? await minQCell(page) : await minCell(page);
  if (best < 0) throw new Error("no off-diagonal matrix cell found");
  await page.locator('[role="gridcell"]').nth(best).click();
}

/** Step to the last position, answering predict_pair prompts on the way. */
export async function stepToEnd(page: Page): Promise<void> {
  const next = page.getByRole("button", { name: "Next step" });
  for (;;) {
    const { k, max } = await readStep(page);
    if (k === max) return;
    // Past the end the button is disabled too, but k === max already
    // returned — a disabled Next here means a prompt is gating.
    if (await next.isDisabled()) {
      await answerPredictPrompt(page);
    } else {
      await next.click();
    }
  }
}

/** Every matrix cell's aria-label ("<a>, <b>: <value>"), row-major. */
export async function matrixLabels(page: Page): Promise<string[]> {
  return page
    .locator('[role="gridcell"]')
    .evaluateAll((els) => els.map((el) => el.getAttribute("aria-label") ?? ""));
}
