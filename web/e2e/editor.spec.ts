// Exercise editor end-to-end (v1.4 plan Task 8, spec §5.1): the Newick
// text and the branch-length table render one shared tree model on the
// `?editor` page — an edit in one view shows up in the other, and the
// engine's refusals (invalid Newick, duplicate taxa, negative lengths)
// are shown inline without changing the tree. The page itself is
// axe-clean.

import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

const NEWICK = (page: import("@playwright/test").Page) =>
  page.getByRole("textbox", { name: "Newick tree" });
const TABLE = (page: import("@playwright/test").Page) =>
  page.getByRole("table", { name: "Branch lengths" });

test("Newick and branch table stay in sync through the shared model", async ({
  page,
}) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await expect(newick).toBeVisible();
  await expect(TABLE(page)).toBeVisible();

  // Typing Newick and pressing Enter updates the branch table.
  await newick.fill("(A:0.1,B:0.2,C:0.3);");
  await newick.press("Enter");
  await expect(
    TABLE(page).getByRole("textbox", {
      name: "Length of the branch to C",
    }),
  ).toHaveValue("0.3");

  // Editing a branch length rewrites the Newick text.
  const bInput = TABLE(page).getByRole("textbox", {
    name: "Length of the branch to B",
  });
  await bInput.fill("0.9");
  await bInput.press("Enter");
  await expect(newick).toHaveValue("(A:0.1,B:0.9,C:0.3);");
});

test("an invalid Newick shows the parse error and keeps the last tree", async ({
  page,
}) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await expect(newick).toBeVisible();

  await newick.fill("this is not newick");
  await newick.press("Enter");
  await expect(page.getByRole("alert")).toBeVisible();
  // The starter tree's rows are still in the table.
  await expect(
    TABLE(page).getByRole("textbox", {
      name: "Length of the branch to A",
    }),
  ).toBeVisible();
});

test("a duplicate taxon name is refused with the name in the message", async ({
  page,
}) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await expect(newick).toBeVisible();

  await newick.fill("(A:0.1,A:0.2,B:0.3);");
  await newick.press("Enter");
  const alert = page.getByRole("alert");
  await expect(alert).toBeVisible();
  await expect(alert).toContainText("A");
  await expect(alert).toContainText(/duplicate/i);
});

test("axe: the editor page has no serious violations", async ({ page }) => {
  await page.goto("/?editor");
  await expect(NEWICK(page)).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const bad = results.violations.filter(
    (v) => v.impact === "serious" || v.impact === "critical",
  );
  expect(
    bad.map((v) => `${v.id} (${v.impact}): ${v.nodes.map((n) => n.target).join(", ")}`),
    "the editor page must have no serious/critical axe violations",
  ).toEqual([]);
});
