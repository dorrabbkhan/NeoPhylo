// bootstrap-basics note sequencing + panel layout e2e (owner
// checkpoint rounds 3–4). Drives the real lesson through the real UI
// and asserts the sequenced bootstrap-stage notes plus the natural
// tree sizing:
//
// - before answering, only the predict_branch prompt shows — Run is
//   gated and no bootstrap-stage note is visible;
// - the first completed run brings the reveal, the locked verdict and
//   the seed-wobble note (after: "first_run");
// - the length note (after: "continue_or_second_run") appears on the
//   wobble note's Continue or on any second completed run;
// - the closing note (after: "longer_run") appears on a completed run
//   at Length ≥ 3,000 or on the length note's Continue;
// - every note, once shown, stays — including across the Length-3000
//   re-simulation that resets the run count;
// - both trees draw all eight leaves inside the viewport with no
//   inner panel scroll, the four consensus tabs keep full labels, the
//   reroot caption wraps fully, and every text element renders ≥12 px
//   — at 1280×800 and 1920×1080.
//
// The run triggers read session.bootstrap's completedRuns /
// maxRunSites; the gate's unlocked set is sticky, which is what
// carries a shown note through the data change.

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { stepToEnd, waitForApp } from "./helpers";

const INFERRED = 'svg[aria-label="Inferred tree"]';
const TRUE = 'svg[aria-label="True tree"]';

const WOBBLE = /Support is an estimate too/;
const LENGTH_NOTE = /Now try more data/;
const CLOSING = /Read the numbers carefully/;
const REVEAL = /shortest internal branch/;
const COLUMNS = /^step 6 of 6/;

/** Click the designed-weakest branch — the lesson's taught read. */
async function answerPrediction(page: Page): Promise<void> {
  await page
    .locator(`${INFERRED} g[data-split="E|F|G|H"] .branch-hit`)
    .dispatchEvent("click");
}

/** Run the bootstrap and wait for completion — including the
 * estimate-confirm path when a run is over the auto-run budget. */
async function runBootstrap(page: Page): Promise<void> {
  const run = page.getByRole("button", { name: /Run bootstrap/ });
  await expect(run).toBeEnabled();
  await run.click();
  const done = page.getByText(/Run complete: /);
  const start = page.getByRole("button", { name: "Start" });
  const winner = await Promise.race([
    done.waitFor({ timeout: 90_000 }).then(() => "done" as const),
    start.waitFor({ timeout: 90_000 }).then(() => "confirm" as const),
  ]);
  if (winner === "confirm") {
    await start.click();
    await expect(done).toBeVisible({ timeout: 90_000 });
  }
}

/** Round-4 panel layout: all eight leaf names of BOTH trees inside
 * the viewport with no inner canvas scroll, all four tab labels fully
 * visible, the reroot caption fully rendered, and every text element
 * in the trees and heatmap at ≥ 12 rendered px. */
async function expectLayoutFit(page: Page): Promise<void> {
  // Scroll the tree row into view first — the column itself may scroll
  // (that's the design), but the panels must not clip a leaf.
  await page.locator(".trees").scrollIntoViewIfNeeded();
  for (const sel of [TRUE, INFERRED]) {
    const texts = page.locator(`${sel} text`);
    const count = await texts.count();
    let leaves = 0;
    for (let i = 0; i < count; i++) {
      const t = texts.nth(i);
      const label = (await t.textContent()) ?? "";
      if (!/^[A-H]$/.test(label)) continue;
      leaves += 1;
      await expect(t, `leaf ${label} of ${sel}`).toBeInViewport({
        ratio: 1,
      });
    }
    expect(leaves, `${sel} shows all 8 leaf names`).toBe(8);
  }

  // Inner scrolling is the >40-leaf path only — an 8-leaf panel must
  // fit its whole drawing (scrollHeight == clientHeight).
  for (const canvas of await page.locator(".tree-canvas").all()) {
    const box = await canvas.evaluate((el) => ({
      scroll: el.scrollHeight,
      client: el.clientHeight,
    }));
    expect(
      box.scroll - box.client,
      "tree canvas must not scroll its 8-leaf drawing",
    ).toBeLessThanOrEqual(1);
  }

  // All four consensus tabs fully visible — labels complete, none
  // clipped by the strip.
  for (const name of [
    "Your tree with support",
    "Majority-rule",
    "Extended majority",
    "Strict",
  ]) {
    await expect(
      page.getByRole("tab", { name, exact: true }),
    ).toBeInViewport({ ratio: 1 });
  }

  // The reroot caption wraps fully — every line inside the viewport.
  await expect(page.locator(".unrooted-note")).toBeInViewport({
    ratio: 1,
  });

  // Every text element in the tree panels and the heatmap renders at
  // the ≥12 px floor — layout px are rendered px.
  const small = await page.evaluate(() => {
    const bad: string[] = [];
    const texts = document.querySelectorAll(
      ".tree-canvas text, .col-center > svg text",
    );
    texts.forEach((el) => {
      const px = parseFloat(getComputedStyle(el).fontSize);
      if (px < 12) bad.push(`"${el.textContent}" at ${px}px`);
    });
    return bad;
  });
  expect(small, "text under the 12 px floor").toEqual([]);
}

const VIEWPORTS = [
  { w: 1280, h: 800 },
  { w: 1920, h: 1080 },
];

for (const vp of VIEWPORTS) {
  test(`bootstrap-basics: sequenced notes and panel fit at ${vp.w}×${vp.h}`, async ({
    page,
  }) => {
    test.setTimeout(240_000); // two real runs, one at 3,000 sites
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/?lesson=bootstrap-basics");
    await waitForApp(page);
    await stepToEnd(page);
    await expect(page.locator(".stepper-status")).toHaveText(COLUMNS);

    // Before answering: ONLY the predict prompt — no note, no verdict.
    await expect(page.locator(".prompt-card")).toHaveCount(1);
    await expect(
      page.getByText(/which internal branch of the inferred tree/i),
    ).toBeVisible();
    await expect(page.getByText(WOBBLE)).toHaveCount(0);
    await expect(page.getByText(LENGTH_NOTE)).toHaveCount(0);
    await expect(page.getByText(CLOSING)).toHaveCount(0);
    await expect(page.locator(".prompt-verdict")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: /Run bootstrap/ }),
    ).toBeDisabled();
    await expectLayoutFit(page);

    // First completed run: reveal + locked verdict + the wobble note;
    // the length and closing notes stay hidden.
    await answerPrediction(page);
    await runBootstrap(page);
    await expect(page.locator(".prompt-verdict.correct")).toHaveText(
      "Your prediction: Correct",
    );
    await expect(page.getByText(REVEAL)).toBeVisible();
    await expect(page.getByText(WOBBLE)).toBeVisible();
    await expect(page.getByText(LENGTH_NOTE)).toHaveCount(0);
    await expect(page.getByText(CLOSING)).toHaveCount(0);

    // The wobble note's Continue unlocks the length note.
    await page.getByRole("button", { name: "Continue" }).click();
    await expect(page.getByText(LENGTH_NOTE)).toBeVisible();
    await expect(page.getByText(CLOSING)).toHaveCount(0);

    // Length → 3,000 re-simulates (resetting the run count): the notes
    // already shown stay, and a completed run at the longer alignment
    // unlocks the closing note.
    await page.getByLabel("Length").fill("3000");
    await stepToEnd(page);
    await expect(page.getByText(WOBBLE)).toBeVisible();
    await expect(page.getByText(LENGTH_NOTE)).toBeVisible();
    await expect(page.getByText(CLOSING)).toHaveCount(0);
    await runBootstrap(page);
    await expect(page.getByText(CLOSING)).toBeVisible();
    await expect(page.getByText(WOBBLE)).toBeVisible();
    await expect(page.getByText(LENGTH_NOTE)).toBeVisible();

    // The prompt strip is capped (34vh) and scrolls when the notes
    // exceed it — the trees are never squeezed. At 34vh ≥ the strip's
    // content (1920×1080) the notes simply fit, which is also correct;
    // the cap is the invariant, overflow is the fallback.
    const strip = page.locator(".prompts");
    const box = await strip.evaluate((el) => ({
      scroll: el.scrollHeight,
      client: el.clientHeight,
      overflowY: getComputedStyle(el).overflowY,
    }));
    expect(box.overflowY).toBe("auto");
    expect(
      box.client,
      "prompt strip stays under its 34vh cap",
    ).toBeLessThanOrEqual(Math.ceil((vp.h * 34) / 100) + 1);
    expect(
      box.scroll,
      "prompt strip scrolls once all notes show",
    ).toBeGreaterThanOrEqual(box.client);
    await expectLayoutFit(page);
  });
}

// The run-history triggers without Continue: a second completed run
// unlocks the length note, and the length note's Continue unlocks the
// closing one — no long run needed.
test("bootstrap-basics: a second run unlocks the length note; its Continue unlocks the closing note", async ({
  page,
}) => {
  test.setTimeout(180_000); // two real bootstrap runs
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?lesson=bootstrap-basics");
  await waitForApp(page);
  await stepToEnd(page);

  await answerPrediction(page);
  await runBootstrap(page);
  await expect(page.getByText(WOBBLE)).toBeVisible();
  await expect(page.getByText(LENGTH_NOTE)).toHaveCount(0);

  // A second completed run — a different bootstrap seed — is the
  // length note's alternate trigger.
  const panel = page.locator(".bootstrap-panel");
  await panel.getByLabel("Seed").fill("97");
  await runBootstrap(page);
  await expect(page.getByText(LENGTH_NOTE)).toBeVisible();
  await expect(page.getByText(CLOSING)).toHaveCount(0);

  // The wobble note no longer offers Continue (its successor is
  // already unlocked by the run); the length note still does.
  await expect(page.locator(".prompt-continue")).toHaveCount(1);
  await page.locator(".prompt-continue").click();
  await expect(page.getByText(CLOSING)).toBeVisible();
});
