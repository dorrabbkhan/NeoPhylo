// assignment_resume.spec.ts (v1.5 plan Task 8, spec §7.2–7.3 —
// Review Focus 1): a mid-assignment reload restores the stored
// progress in the same browser, and a different browser/context
// starts fresh but the same id still lands on the same variant.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import { assignmentLink } from "./assess";
import { matrixLabels, minQCell, waitForApp } from "./helpers";

const NJ_BASICS = JSON.parse(
  readFileSync(
    fileURLToPath(
      new URL("../../exercises/nj-basics.json", import.meta.url),
    ),
    "utf8",
  ),
) as unknown;

const ASSIGNMENT = {
  schema_version: 1,
  kind: "assignment",
  id: "e2e-resume",
  title: "E2E resume assignment",
  content: { exercise: NJ_BASICS },
  id_prompt: { label: "university email", rule: "trim_lower" },
  mode: "practice",
  variation: true,
  tasks: [
    { task: { kind: "predict_pair", step: 1 } },
    {
      task: {
        kind: "numeric",
        step: 2,
        quantity: "q_value",
        role: "chosen",
      },
    },
  ],
};

async function startFlow(
  page: import("@playwright/test").Page,
): Promise<void> {
  await page.goto(assignmentLink(ASSIGNMENT));
  await page.getByLabel(/university email/i).fill("sara");
  await page.getByRole("button", { name: "Start" }).click();
  await waitForApp(page);
}

test("a mid-assignment reload restores the stored progress", async ({
  page,
}) => {
  await startFlow(page);
  // Answer + commit the position-0 graded pair so one of two tasks
  // is recorded, then reload mid-way through the second.
  await page
    .locator('[role="gridcell"]')
    .nth(await minQCell(page))
    .click();
  await page.getByRole("button", { name: "Next step" }).click();
  await expect(page.locator(".assess-progress")).toContainText(
    "1 of 2 graded tasks answered",
  );

  await page.reload();

  // Exactly one stored student → the flow resumes without asking
  // for the id again, straight to the working page (spec §7.3).
  await expect(page.locator(".assess-progress")).toContainText(
    "1 of 2 graded tasks answered",
    { timeout: 30_000 },
  );
  // The export menu's lazy panel chunk resolves a beat after mount and
  // reflows the controls column — a stepper click that lands in that
  // window can miss the button entirely (hit-test vs dispatch race).
  // Wait for the lazy body the way settleFrame does before clicking.
  await page.waitForSelector(".export-menu .export-buttons", {
    state: "attached",
  });
  await page.getByRole("button", { name: "Previous step" }).click();
  await expect(page.locator(".assess-gate")).toContainText(
    "Answer locked in.",
  );
});

test("a second context starts fresh but the same id gets the same variant", async ({
  page,
  browser,
}) => {
  await startFlow(page);
  const labels = await matrixLabels(page);

  // A fresh context has no stored progress — the link asks for the
  // id again, then the same typed id lands on the same variant.
  const fresh = await browser.newContext({
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://localhost:4173",
          localStorage: [
            { name: "neophylo.tourSeen", value: "1" },
          ],
        },
      ],
    },
  });
  try {
    const page2 = await fresh.newPage();
    await page2.goto(assignmentLink(ASSIGNMENT));
    await expect(page2.getByLabel(/university email/i)).toBeVisible({
      timeout: 30_000,
    });
    await page2.getByLabel(/university email/i).fill("sara");
    await page2.getByRole("button", { name: "Start" }).click();
    await waitForApp(page2);
    expect(await matrixLabels(page2)).toEqual(labels);
    // …and a different id lands on a different one (variation on).
    await page2
      .getByRole("button", { name: "Use a different ID" })
      .click();
    await page2.getByLabel(/university email/i).fill("marco");
    await page2.getByRole("button", { name: "Start" }).click();
    await waitForApp(page2);
    expect(await matrixLabels(page2)).not.toEqual(labels);
  } finally {
    await fresh.close();
  }
});
