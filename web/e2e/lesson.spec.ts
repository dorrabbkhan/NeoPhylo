// Built-in lesson end-to-end tests (plan Task 23, spec §8.7). Each test
// opens a lesson by its shareable URL (?lesson=<id>) and drives the real
// UI: prompts gate the stepper until a matrix-cell pick, the RF readout
// appears at the final step, and the saturation notice offers fixes that
// re-run the pipeline.

import { test, expect } from "@playwright/test";

import {
  answerPredictPrompt,
  minCell,
  minQCell,
  readStep,
  stepToEnd,
  waitForApp,
} from "./helpers";

test.describe("nj-basics", () => {
  test("a correct pick ungates the stepper and the lesson ends matching the true tree", async ({
    page,
  }) => {
    await page.goto("/?lesson=nj-basics");
    await waitForApp(page);
    await expect(page.locator("h1")).toHaveText("How Neighbor-Joining works");

    // The predict_pair prompt at join 1 gates position 0.
    await expect(
      page.getByRole("button", { name: "Next step" }),
    ).toBeDisabled();

    // Answer it correctly: the minimum-Q cell (the helper switches the
    // matrix to the Q view and restores it).
    await answerPredictPrompt(page);
    await expect(page.locator(".prompt-verdict.correct")).toHaveText("Correct");

    // Advance to position 2, where the step-3 predict_pair prompt gates.
    const next = page.getByRole("button", { name: "Next step" });
    await next.click();
    await next.click();
    expect(await readStep(page)).toMatchObject({ k: 2 });
    await expect(next).toBeDisabled();

    // Premise (checkpoint 7): the closest pair is not the pair NJ joins.
    // The Q toggle is disabled while a prompt gates (checkpoint 12), so
    // the min-Q cell is computed from the distance matrix.
    const distMin = await minCell(page);
    const qMin = await minQCell(page);
    expect(
      distMin,
      "lesson premise: min-distance cell differs from min-Q cell at join 3",
    ).not.toBe(qMin);
    await expect(
      page.getByRole("switch", { name: "Distance / Q" }),
    ).toBeDisabled();

    // Picking the closest pair is wrong and reveals why.
    const cells = page.locator('[role="gridcell"]');
    const distLabel = await cells.nth(distMin).getAttribute("aria-label");
    await cells.nth(distMin).click();
    await expect(page.locator(".prompt-verdict.wrong")).toContainText(
      "Not quite",
    );
    await expect(
      page.getByText(
        "u1 and u2 are closest, but NJ joins E and F: they are close relative to how far each is from everything else.",
      ),
    ).toBeVisible();
    expect(distLabel).toContain("u1");
    expect(distLabel).toContain("u2");

    // The answered prompt no longer gates; step through to the end.
    await stepToEnd(page);
    expect(await readStep(page)).toEqual({ k: 4, max: 4 });
    await expect(page.locator(".stepper-rf")).toHaveText("matches the true tree in every clade");
    await expect(
      page.getByText(
        "The tree is complete: RF = 0, so every grouping in the true tree was recovered.",
      ),
    ).toBeVisible();
  });
});

test.describe("upgma-fails", () => {
  test("UPGMA misses the true tree and NJ recovers it", async ({ page }) => {
    await page.goto("/?lesson=upgma-fails");
    await waitForApp(page);
    await expect(page.locator("h1")).toHaveText(
      "When UPGMA fails: the molecular clock",
    );

    await stepToEnd(page);
    // UPGMA cannot recover this non-clock-like tree; the exact split
    // count is asserted by the lesson file's pinned seed.
    const rf = await page.locator(".stepper-rf").innerText();
    expect(rf).toMatch(/^RF = [1-9]\d* \/ 4$/);

    // The closing note invites the switch; Method is the unlocked lever.
    await page
      .getByLabel("Tree-building method")
      .selectOption({ label: "Neighbor-Joining" });
    await stepToEnd(page);
    await expect(page.locator(".stepper-rf")).toHaveText("matches the true tree in every clade");
  });
});

test.describe("saturation", () => {
  test("saturated JC69 distances block the build; longer sequences fix it", async ({
    page,
  }) => {
    await page.goto("/?lesson=saturation");
    await waitForApp(page);
    await expect(page.locator("h1")).toHaveText(
      "Saturation and distance correction",
    );

    // Pinned seed 42: several pairs are past the JC69 ceiling at 50
    // sites, so no tree is built and the notice explains the fixes.
    await expect(
      page.getByText("Some distances can't be estimated"),
    ).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Trace stepper" }),
    ).toHaveCount(0);

    const longer = page.getByRole("button", {
      name: /Use longer sequences/,
    });
    await longer.click(); // 50 → 100 sites: still saturated at this seed
    await expect(
      page.getByText("Some distances can't be estimated"),
    ).toBeVisible();
    await longer.click(); // 100 → 200 sites: every pair is estimable
    await expect(page.getByText("Inferred tree")).toBeVisible();
    await expect(
      page.getByRole("group", { name: "Trace stepper" }),
    ).toBeVisible();
  });
});
