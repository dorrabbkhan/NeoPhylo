// Alphabet badge and model reconciliation e2e tests (v1.1 plan Task 10,
// spec §5.1; checkpoint-10 findings). Simulated data shows the badge
// with no "Treat as" override — the alphabet comes from the sim model
// menu — while a protein import in the sandbox reconciles the correction
// and sim model to JTT and shows the protein badge.

import { test, expect } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { waitForApp } from "./helpers";

const P6_150 = fileURLToPath(
  new URL("../../fixtures/inputs/protein/p6_150.fasta", import.meta.url),
);

test.describe("alphabet badge", () => {
  test("the nj-basics lesson shows the DNA badge with no override", async ({
    page,
  }) => {
    await page.goto("/?lesson=nj-basics");
    await waitForApp(page);

    // Simulated lesson data: the badge names the alphabet, but the
    // override is only for imported/embedded data — checkpoint 10 found
    // the button switching this locked lesson to protein.
    await expect(page.locator(".alphabet-badge")).toContainText("DNA");
    await expect(
      page.getByRole("button", { name: /Treat as/ }),
    ).toHaveCount(0);
  });

  test("importing a protein FASTA in the sandbox reconciles to JTT", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);
    await page.getByRole("radio", { name: "Sandbox" }).click();

    await page
      .locator('.import-panel input[type="file"]')
      .setInputFiles(P6_150);

    // Protein badge with the imported-data override, the correction and
    // sim model reconciled to JTT (each select's value is one of its
    // options), the notice, and the 6×6 matrix for the 6-taxon file.
    await expect(page.locator(".alphabet-badge")).toContainText("Protein");
    await expect(page.getByLabel("Distance correction")).toHaveValue("Jtt");
    await expect(page.getByLabel("Simulation model")).toHaveValue("Jtt");
    await expect(page.locator(".alphabet-notice")).toContainText("JTT");
    await expect(page.locator('[role="gridcell"]')).toHaveCount(36);
  });
});
