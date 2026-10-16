// Built-in lesson end-to-end tests (plan Task 23, spec §8.7). Each test
// opens a lesson by its shareable URL (?lesson=<id>) and drives the real
// UI: prompts gate the stepper until a matrix-cell pick, the RF readout
// appears at the final step, and the saturation notice offers fixes that
// re-run the pipeline.

import { test, expect } from "@playwright/test";

import { answerPredictPrompt, readStep, stepToEnd, waitForApp } from "./helpers";

test.describe("nj-basics", () => {
  test("a correct pick ungates the stepper and the lesson ends at RF = 0 / 6", async ({
    page,
  }) => {
    await page.goto("/?lesson=nj-basics");
    await waitForApp(page);
    await expect(page.locator("h1")).toHaveText("How Neighbor-Joining works");

    // The predict_pair prompt at join 1 gates position 0.
    await expect(page.getByRole("button", { name: "Next step" })).toBeDisabled();

    // Answer it correctly: the minimum-Q cell (the helper switches the
    // matrix to the Q view and restores it).
    await answerPredictPrompt(page);
    await expect(page.locator(".prompt-verdict.correct")).toHaveText("Correct");

    await stepToEnd(page);
    expect(await readStep(page)).toEqual({ k: 4, max: 4 });
    await expect(page.locator(".stepper-rf")).toHaveText("RF = 0 / 6");
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
    await expect(page.locator(".stepper-rf")).toHaveText("RF = 0 / 4");
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
