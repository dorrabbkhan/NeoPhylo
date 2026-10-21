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

  // Terminal edges are unpickable; internal edges carry hit lines. The
  // hit line is a zero-height <line> — invisible per Playwright's
  // actionability check in Chromium/WebKit — so clicks are dispatched
  // directly rather than through click()'s visibility gate.
  const svg = page.locator(INFERRED);
  expect(await svg.locator('g[data-split="E"] .branch-hit').count()).toBe(0);
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
  await expect(
    page.locator('g[data-split="E|F|G|H"] .support-label'),
  ).not.toHaveText("57", { timeout: 60_000 });
  const text = await page
    .locator('g[data-split="E|F|G|H"] .support-label')
    .textContent();
  expect(
    Number(text),
    "premise: support on (E,F,G,H) rises ≥ 20 points at length 3000",
  ).toBeGreaterThanOrEqual(77);
});
