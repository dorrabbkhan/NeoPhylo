// Shared e2e helpers (plan Task 23). Kept out of the specs so the
// lesson and share specs state only what they assert.
//
// `answerPredictPrompt` answers the gating predict_pair prompt with the
// genuinely correct pair without peeking at the marked cell (which the
// gate hides anyway): NJ joins the minimum of the Q matrix and UPGMA the
// minimum distance, so the helper switches to the Q view when the
// Distance/Q toggle exists, picks the minimum off-diagonal cell, and
// restores the view it found.

import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";

/** Wait until the app has loaded a lesson (session !== null renders .app). */
export async function waitForApp(page: Page): Promise<void> {
  await expect(page.locator(".app")).toBeVisible();
}

/** Current stepper position and max, parsed from "step k of N". */
export async function readStep(page: Page): Promise<{ k: number; max: number }> {
  const text = await page.locator(".stepper-status").innerText();
  const m = /step (\d+) of (\d+)/.exec(text);
  if (m === null) throw new Error(`unexpected stepper text: "${text}"`);
  return { k: Number(m[1]), max: Number(m[2]) };
}

/** Answer the gating predict_pair prompt with the correct pair. */
export async function answerPredictPrompt(page: Page): Promise<void> {
  const qToggle = page.getByRole("switch", { name: "Distance / Q" });
  const switchedToQ =
    (await qToggle.count()) > 0 &&
    (await qToggle.getAttribute("aria-checked")) === "false";
  if (switchedToQ) await qToggle.click();

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
  if (best < 0) throw new Error("no off-diagonal matrix cell found");
  await cells.nth(best).click();

  if (switchedToQ) await qToggle.click();
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
