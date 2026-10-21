// bootstrap-basics lesson e2e (v1.2 plan Task 14, spec §7.1/§7.2).
// Drives the real lesson through the real UI and asserts its recorded
// premises: the predict_branch prompt gates Run until an internal
// branch click, the verdict names the weakest grouping — the 0.005
// branch's {E,F,G,H} split at 57% for seeds 4/96 — and raising Length
// to 3,000 lifts that grouping's support by ≥ 20 points.
//
// The designed split keys: NJ tallies canonicalize to the side without
// taxa[0] (A), so the {E,F,G,H} grouping is "E|F|G|H" and the {C,D}
// cherry is "C|D".

import { test, expect } from "@playwright/test";

import { readStep, stepToEnd, waitForApp } from "./helpers";

const INFERRED = 'svg[aria-label="Inferred tree"]';

test("bootstrap-basics: branch pick gates Run; the verdict names (E, F, G, H)", async ({
  page,
}) => {
  await page.goto("/?lesson=bootstrap-basics");
  await waitForApp(page);
  await expect(page.locator("h1")).toHaveText(
    "Bootstrap: how sure is the tree?",
  );

  await stepToEnd(page);
  expect(await readStep(page)).toMatchObject({ k: 6, max: 6 });

  // §7.1: the predict_branch prompt asks for an internal-branch click
  // and gates the panel's Run button; no support labels show yet.
  await expect(
    page.getByText(/which internal branch of the inferred tree/i),
  ).toBeVisible();
  const run = page.getByRole("button", { name: /Run bootstrap/ });
  await expect(run).toBeDisabled();
  expect(
    await page.locator(`${INFERRED} .support-label`).count(),
  ).toBe(0);

  // Every edge carries a hit line — but a terminal click isn't an
  // answer: it explains itself and Run stays gated. Hit lines are
  // zero-height <line> elements — invisible per Playwright's
  // actionability check in Chromium/WebKit — so clicks are dispatched
  // directly rather than through click()'s visibility gate.
  const svg = page.locator(INFERRED);
  const leafHit = svg.locator('g[data-split="E"] .branch-hit');
  expect(await leafHit.count()).toBe(1);
  await leafHit.dispatchEvent("click");
  await expect(
    page.getByText("Pick a branch that joins two or more taxa."),
  ).toBeVisible();
  await expect(run).toBeDisabled();
  expect(await svg.locator('g[data-split="C|D"] .branch-hit').count()).toBe(1);

  // A wrong pick answers the prompt but does not hide the truth: the
  // verdict names the real weakest grouping.
  await svg.locator('g[data-split="C|D"] .branch-hit').dispatchEvent("click");
  await expect(run).toBeEnabled();
  await run.click();
  await expect(
    page.getByText("Not quite: the weakest group was (E, F, G, H) at 57%."),
  ).toBeVisible({ timeout: 60_000 });

  // Premise (§7.2): at 300 columns the designed grouping is the weakest
  // at 57 — the label now shows on its branch.
  await expect(
    svg.locator('g[data-split="E|F|G|H"] .support-label'),
  ).toHaveText("57");
});

test("bootstrap-basics: at 3,000 sites the weak grouping's support rises ≥ 20 points", async ({
  page,
}) => {
  test.setTimeout(120_000); // two real bootstrap runs, one at 3,000 sites
  await page.goto("/?lesson=bootstrap-basics");
  await waitForApp(page);
  await stepToEnd(page);

  // Answer the prompt by clicking the designed-weakest branch — the
  // lesson is meant to teach exactly that read — then run.
  const svg = page.locator(INFERRED);
  await svg.locator('g[data-split="E|F|G|H"] .branch-hit').dispatchEvent("click");
  await page.getByRole("button", { name: /Run bootstrap/ }).click();
  await expect(page.locator(".prompt-verdict.correct")).toHaveText(
    "Correct",
    { timeout: 60_000 },
  );
  await expect(
    svg.locator('g[data-split="E|F|G|H"] .support-label'),
  ).toHaveText("57");

  // The follow-up the lesson's note asks for: Length 300 → 3000. The
  // prompt stays answered across the re-sim (answers live on the
  // prompt, not the data), so Run is immediately enabled.
  await page.getByLabel("Length").fill("3000");
  await stepToEnd(page);
  const run = page.getByRole("button", { name: /Run bootstrap/ });
  await expect(run).toBeEnabled();
  await run.click();
  await expect(async () => {
    const v = await page
      .locator('g[data-split="E|F|G|H"] .support-label')
      .textContent();
    expect(
      Number(v),
      "premise: support on (E,F,G,H) rises ≥ 20 points at length 3000",
    ).toBeGreaterThanOrEqual(77);
  }).toPass({ timeout: 60_000 });
});

test("bootstrap-basics: seeds vary and reproduce; the lesson applies its own seed", async ({
  page,
}) => {
  test.setTimeout(180_000); // three real bootstrap runs + a lesson switch
  const WEAK = 'g[data-split="E|F|G|H"] .support-label';
  const panel = page.locator(".bootstrap-panel");

  // Arrive from a lesson where the student changed the bootstrap seed:
  // the exercise's own block must take over on load (Task 10 fix).
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await stepToEnd(page);
  await panel.getByLabel("Seed").fill("7");
  await page.getByRole("button", { name: "Lessons" }).click();
  await page
    .getByRole("menuitemradio", { name: /Bootstrap: how sure is the tree/ })
    .click();
  await waitForApp(page);
  await stepToEnd(page);
  await expect(panel.getByLabel("Seed")).toHaveValue("96");

  // First run at the lesson's seed: 57 on the designed grouping.
  const svg = page.locator(INFERRED);
  await svg
    .locator('g[data-split="E|F|G|H"] .branch-hit')
    .dispatchEvent("click");
  const run = page.getByRole("button", { name: /Run bootstrap/ });
  await run.click();
  const label = svg.locator(WEAK);
  await expect(label).toHaveText("57", { timeout: 60_000 });

  // A different bootstrap seed resamples differently — the estimate
  // moves (the lesson's seed-variance note).
  await panel.getByLabel("Seed").fill("97");
  await run.click();
  await expect(async () => {
    const v = await label.textContent();
    expect(v).not.toBeNull();
    expect(Number(v)).not.toBe(57);
  }).toPass({ timeout: 60_000 });

  // The same seed reproduces the same value — the tally is seeded.
  await panel.getByLabel("Seed").fill("96");
  await run.click();
  await expect(label).toHaveText("57", { timeout: 60_000 });
});
