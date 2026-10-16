// Shared-link round trip (plan Task 23, spec §6.4, §8.7). The app syncs
// its state into the URL on every change, so "copying the link" is
// reading page.url(); a fresh browser context opening that URL must land
// on the same lesson, step and matrix values.

import { test, expect } from "@playwright/test";

import {
  answerPredictPrompt,
  matrixLabels,
  readStep,
  waitForApp,
} from "./helpers";

test("a copied URL reproduces the seed, matrix and step", async ({
  page,
  browser,
}) => {
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);

  // Change the seed (the +1 button avoids number-field parsing) and
  // advance one step — the predict_pair prompt gating position 0 must be
  // answered first, exactly as a student would.
  await page.getByRole("button", { name: "New seed" }).click();
  await answerPredictPrompt(page);
  await page.getByRole("button", { name: "Next step" }).click();

  const step = await readStep(page);
  expect(step.k).toBe(1);
  const matrix = await matrixLabels(page);
  const url = page.url();
  expect(url).toContain("lesson=nj-basics");

  // Open the link in a fresh context (new "student").
  const ctx = await browser.newContext();
  const page2 = await ctx.newPage();
  try {
    await page2.goto(url);
    await waitForApp(page2);
    expect(await readStep(page2)).toEqual(step);
    expect(await matrixLabels(page2)).toEqual(matrix);
  } finally {
    await ctx.close();
  }
});
