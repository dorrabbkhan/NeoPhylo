// Protein lesson end-to-end tests (v1.1 plan Task 12, spec §5.4).
// `protein-models` asserts its premise — NJ on the p-distance misses the
// true tree while NJ on JTT recovers it — and drives the pair panel from
// the predict prompt's reveal. `cytochrome-c` plays the real-data lesson
// and checks the classification reference title, the UniProt attribution
// and the closing RF wording.

import { test, expect } from "@playwright/test";

import { answerPredictPrompt, readStep, stepToEnd, waitForApp } from "./helpers";

test.describe("protein-models", () => {
  test("p misses the true tree, JTT recovers it, and the reveal opens the pair panel", async ({
    page,
  }) => {
    await page.goto("/?lesson=protein-models");
    await waitForApp(page);
    await expect(page.locator("h1")).toHaveText(
      "Protein distances: when counting isn't enough",
    );
    // The lesson starts on the uncorrected p-distance.
    await expect(page.getByLabel("Distance correction")).toHaveValue("P");

    // The predict_pair prompt at join 1 gates position 0.
    await expect(
      page.getByRole("button", { name: "Next step" }),
    ).toBeDisabled();
    await answerPredictPrompt(page);
    await expect(page.locator(".prompt-verdict.correct")).toHaveText("Correct");

    // The reveal invites opening the pair panel on the misleading pair;
    // answering cleared the gate, so the C–F cell opens the dialog.
    await expect(page.getByText(/Now click the C–F cell/)).toBeVisible();
    await page
      .getByRole("gridcell", { name: /^(C, F|F, C):/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("How was this distance computed?")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // Premise, part 1: under p the inferred tree misses the true tree.
    await stepToEnd(page);
    expect(await readStep(page)).toEqual({ k: 5, max: 5 });
    await expect(page.locator(".stepper-rf")).toHaveText("RF = 2 / 8");

    // Premise, part 2: the closing note's lever — switching to JTT —
    // recovers the true tree on the same alignment.
    await page
      .getByLabel("Distance correction")
      .selectOption({ label: "JTT" });
    await stepToEnd(page);
    await expect(page.locator(".stepper-rf")).toHaveText("RF = 0 / 8");
  });
});

test.describe("cytochrome-c", () => {
  test("plays the real-data lesson with its classification reference and attribution", async ({
    page,
  }) => {
    await page.goto("/?lesson=cytochrome-c");
    await waitForApp(page);
    await expect(page.locator("h1")).toHaveText(
      "Cytochrome c: a real protein tree",
    );

    // Spec §5.3: the reference is labelled as a classification, and the
    // opening note carries the UniProt/CC BY 4.0 attribution.
    await expect(
      page.getByRole("img", {
        name: "Reference (accepted classification), not a known true tree",
      }),
    ).toBeVisible();
    await expect(
      page.getByText(/sequences come from UniProt \(CC BY 4\.0\)/),
    ).toBeVisible();

    // The predict at join 1 gates; the answer is human + macaque, the
    // smallest distance in the matrix.
    await answerPredictPrompt(page);
    await expect(page.locator(".prompt-verdict.correct")).toHaveText("Correct");

    // The reveal invites the pair panel on the deepest pair.
    await expect(
      page.getByText(/click the human–yeast cell/),
    ).toBeVisible();
    await page
      .getByRole("gridcell", { name: /^(human, yeast|yeast, human):/ })
      .first()
      .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);

    // The completed tree disagrees with the classification in 4 clades;
    // the stepper uses the classification wording (spec §5.3).
    await stepToEnd(page);
    expect(await readStep(page)).toEqual({ k: 6, max: 6 });
    await expect(page.locator(".stepper-rf")).toHaveText(
      "differs from the accepted classification in 4 clades",
    );
  });
});
