// PHYLIP lab pages end to end (v1.4 plan Task 11, spec §6.2/§6.5/§7,
// Review Focus 5). The shipped registry (exercises/labs/) is empty
// until Task 12; the test lab lives in web/src/labs/__fixtures__/ and
// joins the registry only under the neophylo-e2e flag, so the shipped
// index correctly shows its empty state for everyone else.
//
// Covered here: the index listing and its link, the lab page's
// objectives/settings/handout and axe cleanliness, "load this lab"
// into the app, the editor's unsaved-work confirmation (ask → keep →
// ask → replace, and no question on a clean editor), and the print
// view hiding the controls while keeping the handout and settings
// table.

import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

import { waitForApp } from "./helpers";

const LAB_NEWICK = "((A:0.1,B:0.2):0.05,C:0.3);";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("neophylo-e2e", "1");
    } catch {
      // storage can be blocked; the app tolerates it
    }
  });
});

const NEWICK = (page: import("@playwright/test").Page) =>
  page.getByRole("textbox", { name: "Newick tree" });

test("the lab index lists the test lab and links to its page; both pages are axe-clean", async ({
  page,
}) => {
  await page.goto("/?labs");
  await expect(
    page.getByRole("heading", { name: "PHYLIP labs" }),
  ).toBeVisible();
  await expect(
    page.getByText("Test lab: dnadist → neighbor"),
  ).toBeVisible();
  await expect(
    page.getByText(/Run the dnadist → neighbor chain end to end/),
  ).toBeVisible();
  expect(
    await new AxeBuilder({ page }).analyze().then((r) => r.violations),
  ).toEqual([]);

  await page.getByRole("link", { name: /open lab/i }).click();
  await expect(
    page.getByRole("heading", { name: "Test lab: dnadist → neighbor" }),
  ).toBeVisible();
  expect(
    await new AxeBuilder({ page }).analyze().then((r) => r.violations),
  ).toEqual([]);
});

test("the lab page shows the chain, objectives, settings table and handout; Load this lab opens the app", async ({
  page,
}) => {
  await page.goto("/?lab=test-lab");
  await expect(
    page.getByRole("heading", { name: "Test lab: dnadist → neighbor" }),
  ).toBeVisible();
  for (const cell of ["Distance model", "F84", "Replicates", "100"]) {
    await expect(
      page.getByRole("cell", { name: cell }).first(),
    ).toBeVisible();
  }
  await expect(page.getByText(/Which pair joins first/)).toBeVisible();
  await expect(
    page.getByText(/PHYLIP's outfile lists the matrix/),
  ).toBeVisible();

  await page.getByRole("link", { name: "Load this lab" }).click();
  await waitForApp(page);
  await expect(page.locator(".app-header h1")).toContainText(
    "Test lab: dnadist chain",
  );
});

test("the print view hides the controls and keeps the handout and settings table", async ({
  page,
}) => {
  await page.goto("/?lab=test-lab");
  await expect(
    page.getByRole("heading", { name: "Test lab: dnadist → neighbor" }),
  ).toBeVisible();
  await page.emulateMedia({ media: "print" });
  await expect(page.locator(".lab-controls")).toBeHidden();
  await expect(page.locator(".lab-nav")).toBeHidden();
  await expect(page.locator(".lab-print-head")).toBeVisible();
  await expect(page.getByText(/Which pair joins first/)).toBeVisible();
  await expect(
    page.getByRole("table", { name: /settings/i }),
  ).toBeVisible();
});

test("a clean editor loads the lab without asking", async ({ page }) => {
  await page.goto("/?editor");
  await expect(NEWICK(page)).toBeVisible();
  await page.getByRole("button", { name: "PHYLIP labs" }).click();
  const sheet = page.getByRole("dialog", { name: "PHYLIP labs" });
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByText("Test lab: dnadist → neighbor"),
  ).toBeVisible();
  await sheet.getByRole("button", { name: "Load this lab" }).click();
  await expect(
    page.getByRole("heading", { name: "Replace your unsaved work?" }),
  ).toHaveCount(0);
  await expect(NEWICK(page)).toHaveValue(LAB_NEWICK);
  await expect(page.getByLabel("Title")).toHaveValue(
    "Test lab: dnadist chain",
  );
});

test("with unsaved editor work Load this lab asks first; keep declines, replace loads", async ({
  page,
}) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await expect(newick).toBeVisible();
  await newick.fill("(X:0.5,Y:0.5,Z:0.5);");
  await newick.press("Enter");
  await page.getByLabel("Title").fill("My draft");

  await page.getByRole("button", { name: "PHYLIP labs" }).click();
  const sheet = page.getByRole("dialog", { name: "PHYLIP labs" });
  await sheet.getByRole("button", { name: "Load this lab" }).click();
  await expect(
    page.getByRole("heading", { name: "Replace your unsaved work?" }),
  ).toBeVisible();

  // Declining keeps the exact draft.
  await page
    .getByRole("button", { name: /keep my work/i })
    .click();
  await expect(newick).toHaveValue("(X:0.5,Y:0.5,Z:0.5);");
  await expect(page.getByLabel("Title")).toHaveValue("My draft");

  // Asking again and accepting replaces it.
  await sheet.getByRole("button", { name: "Load this lab" }).click();
  await page.getByRole("button", { name: /replace/i }).click();
  await expect(newick).toHaveValue(LAB_NEWICK);
  await expect(page.getByLabel("Title")).toHaveValue(
    "Test lab: dnadist chain",
  );
});

test("under (pointer: coarse) every lab link and button — header, drawer, More menu and the lab pages — is ≥40×40", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 1366, height: 900 },
    hasTouch: true,
    serviceWorkers: "block",
  });
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("neophylo-e2e", "1");
      window.localStorage.setItem("neophylo.tourSeen", "1");
    } catch {
      // storage can be blocked; the app tolerates it
    }
  });
  const page = await context.newPage();
  await page.goto("/");
  await waitForApp(page);
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    "the emulation presents a coarse pointer",
  ).toBe(true);

  const expectFloor = async (
    target: import("@playwright/test").Locator,
    name: string,
  ) => {
    const box = await target.boundingBox();
    expect(box, `${name} has a bounding box`).not.toBeNull();
    if (box === null) return;
    expect(
      box.width,
      `${name} is at least 40 px wide (got ${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(40);
    expect(
      box.height,
      `${name} is at least 40 px tall (got ${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(40);
  };

  // The header's "PHYLIP labs" chip at the wide breakpoint.
  const headerLink = page.locator("a.labs-link");
  await expect(headerLink).toBeVisible();
  await expectFloor(headerLink, 'header "PHYLIP labs" link at 1366 px');

  // Its Settings-drawer mirror at the medium breakpoint.
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.getByRole("button", { name: "Settings" }).click();
  const drawerLink = page.locator("a.settings-drawer-labs");
  await expect(drawerLink).toBeVisible();
  await expectFloor(drawerLink, 'drawer "PHYLIP labs" link at 1024 px');
  await page.keyboard.press("Escape");

  // And the More-menu item below 1024 px.
  await page.setViewportSize({ width: 768, height: 900 });
  await page.getByRole("button", { name: "More" }).click();
  const moreItem = page.getByRole("menuitem", { name: "PHYLIP labs" });
  await expect(moreItem).toBeVisible();
  await expectFloor(moreItem, 'More-menu "PHYLIP labs" item at 768 px');

  // Every link and button the lab index and the lab page render —
  // wordmark, nav links, "Open lab", "Load this lab" and the print
  // button (the e2e flag registers the test lab).
  const checkAll = async (what: string) => {
    const targets = page.locator("a, button");
    const count = await targets.count();
    expect(count, `${what}: targets on screen`).toBeGreaterThan(2);
    for (let i = 0; i < count; i++) {
      const target = targets.nth(i);
      if (!(await target.isVisible())) continue;
      const label =
        (await target.getAttribute("aria-label")) ??
        (await target.innerText().catch(() => "")).slice(0, 40) ??
        `target ${i}`;
      await expectFloor(target, `${what}: "${label}"`);
    }
  };

  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/?labs");
  await expect(
    page.getByRole("heading", { name: "PHYLIP labs" }),
  ).toBeVisible();
  await checkAll("the lab index");

  await page.goto("/?lab=test-lab");
  await expect(
    page.getByRole("heading", { name: "Test lab: dnadist → neighbor" }),
  ).toBeVisible();
  await checkAll("the test lab page");

  await context.close();
});

test("without the e2e flag the shipped registry is empty and the index says so", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
  });
  const page = await context.newPage();
  await page.goto("/?labs");
  await expect(
    page.getByRole("heading", { name: "PHYLIP labs" }),
  ).toBeVisible();
  await expect(page.getByText(/no lab packs/i)).toBeVisible();
  await context.close();
});
