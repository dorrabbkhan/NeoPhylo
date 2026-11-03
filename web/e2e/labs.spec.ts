// PHYLIP lab pages end to end (v1.4 plan Task 11, spec §6.2/§6.5/§7,
// Review Focus 5; Task 12 pack 1 adds the shipped dnadist-neighbor
// checks). The test lab lives in web/src/labs/__fixtures__/ and joins
// the registry only under the neophylo-e2e flag; the shipped pack is
// listed for every visitor, so every test-lab locator below is scoped
// to the test lab's own card or row.
//
// Covered here: the index listing and its link, the lab page's
// objectives/settings/handout and axe cleanliness, "load this lab"
// into the app, the editor's unsaved-work confirmation (ask → keep →
// ask → replace, and no question on a clean editor), and the print
// view hiding the controls while keeping the handout and settings
// table.

import { readFileSync } from "node:fs";

import { test, expect } from "@playwright/test";
import { AxeBuilder } from "@axe-core/playwright";

import { stepToEnd, waitForApp } from "./helpers";

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

/** The test lab's row in the editor's lab sheet — the shipped
 * dnadist-neighbor pack carries its own "Load this lab" button. */
const testLabRow = (sheet: import("@playwright/test").Locator) =>
  sheet.locator("li").filter({ hasText: "Test lab: dnadist → neighbor" });

test("the lab index lists the test lab and links to its page; both pages are axe-clean", async ({
  page,
}) => {
  await page.goto("/?labs");
  await expect(page.getByRole("heading", { name: "Labs", exact: true })).toBeVisible();
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

  const testCard = page.locator(".lab-card", { hasText: "Test lab:" });
  await testCard.getByRole("link", { name: /open lab/i }).click();
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

// Task 12 pack 1 (conductor note 5): "Load this lab" on the shipped
// dnadist-neighbor pack really loads — the exercise travels in the
// unbounded #x= fragment, so this replays the real link end to end:
// model F84 and method NJ on the loaded exercise, and a matrix cell
// equal to the dnadist fixture's printed value at the displayed
// precision (cells render toFixed(3)). The expected value is read
// from the fixture, never hard-coded.
test("the shipped dnadist-neighbor pack loads through its lab page into the app", async ({
  page,
}) => {
  const fx = JSON.parse(
    readFileSync(
      new URL(
        "../../fixtures/phylip/f84/k80_10.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    labels: string[];
    distances: Record<string, number[][]>;
  };
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?lab=dnadist-neighbor");
  await expect(
    page.getByRole("heading", { name: "dnadist → neighbor (F84)" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Load this lab" }).click();
  await waitForApp(page);
  await expect(page.locator(".app-header h1")).toContainText(
    "dnadist → neighbor lab",
  );
  await expect(page.getByLabel("Distance correction")).toHaveValue("F84");
  await expect(page.getByLabel("Tree-building method")).toHaveValue("Nj");

  // One whole row of cells at the displayed 3-decimal precision — the
  // grid's per-cell aria-labels carry the value.
  const n = fx.labels.length;
  for (let j = 0; j < n; j++) {
    const shown =
      j === 0 ? "0.000" : fx.distances.F84[0][j].toFixed(3);
    await expect(
      page.locator(
        `g[role="gridcell"][aria-label="${fx.labels[0]}, ${fx.labels[j]}: ${shown}"]`,
      ),
      `cell ${fx.labels[0]}/${fx.labels[j]} shows ${shown}`,
    ).toBeVisible();
  }
});

// Task 12 pack 2 (conductor note 4): the shipped protdist-neighbor
// pack loads the same way — the exercise travels in the #x= fragment,
// and the app must show JTT + NJ on the loaded protein alignment with
// a row of matrix cells equal to protdist's fixture at the displayed
// precision (cells render toFixed(3)). The correction <select>'s
// value is the DistModel variant name, "Jtt". Expected values are
// read from the fixture, never hard-coded.
test("the shipped protdist-neighbor pack loads through its lab page into the app", async ({
  page,
}) => {
  const fx = JSON.parse(
    readFileSync(
      new URL(
        "../../fixtures/ref/protein/p10_400.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    labels: string[];
    distances: Record<string, number[][]>;
  };
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?lab=protdist-neighbor");
  await expect(
    page.getByRole("heading", { name: "protdist → neighbor (JTT)" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Load this lab" }).click();
  await waitForApp(page);
  await expect(page.locator(".app-header h1")).toContainText(
    "protdist → neighbor lab",
  );
  await expect(page.getByLabel("Distance correction")).toHaveValue("Jtt");
  await expect(page.getByLabel("Tree-building method")).toHaveValue("Nj");

  // One whole row of cells at the displayed 3-decimal precision — the
  // grid's per-cell aria-labels carry the value.
  const n = fx.labels.length;
  for (let j = 0; j < n; j++) {
    const shown =
      j === 0 ? "0.000" : fx.distances.JTT[0][j].toFixed(3);
    await expect(
      page.locator(
        `g[role="gridcell"][aria-label="${fx.labels[0]}, ${fx.labels[j]}: ${shown}"]`,
      ),
      `cell ${fx.labels[0]}/${fx.labels[j]} shows ${shown}`,
    ).toBeVisible();
  }
});

// Task 12 pack 3 (conductor note 4): the shipped seqboot-consense
// pack loads the same way — F84 + NJ, and the bootstrap panel shows
// the exercise's own settings: 100 replicates (seqboot's menu default,
// recorded in fixtures/README.md) and the chain's odd seed. The
// expected values are read from the chain fixture, never hard-coded.
test("the shipped seqboot-consense pack loads through its lab page into the app", async ({
  page,
}) => {
  const fx = JSON.parse(
    readFileSync(
      new URL(
        "../../fixtures/phylip/chain/jc12_boot100.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    seed: number;
    replicates: number;
  };
  const f84 = JSON.parse(
    readFileSync(
      new URL(
        "../../fixtures/phylip/f84/jc12.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    labels: string[];
    distances: Record<string, number[][]>;
  };
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?lab=seqboot-consense");
  await expect(
    page.getByRole("heading", {
      name: "seqboot → dnadist → neighbor → consense",
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Load this lab" }).click();
  await waitForApp(page);
  await expect(page.locator(".app-header h1")).toContainText(
    "seqboot → consense lab",
  );
  await expect(page.getByLabel("Distance correction")).toHaveValue("F84");
  await expect(page.getByLabel("Tree-building method")).toHaveValue("Nj");

  // One whole row of cells at the displayed 3-decimal precision — the
  // grid's per-cell aria-labels carry the value.
  const n = f84.labels.length;
  for (let j = 0; j < n; j++) {
    const shown =
      j === 0 ? "0.000" : f84.distances.F84[0][j].toFixed(3);
    await expect(
      page.locator(
        `g[role="gridcell"][aria-label="${f84.labels[0]}, ${f84.labels[j]}: ${shown}"]`,
      ),
      `cell ${f84.labels[0]}/${f84.labels[j]} shows ${shown}`,
    ).toBeVisible();
  }

  // The bootstrap panel renders at the final step; the exercise's own
  // replicates and seed populate its fields.
  await stepToEnd(page);
  await expect(page.getByLabel("Replicates")).toHaveValue(
    String(fx.replicates),
  );
  await expect(page.getByLabel("Seed")).toHaveValue(String(fx.seed));
});

// Fix round 1 (owner decision): the pack's `locked` list names
// bootstrap.replicates and bootstrap.seed so the static reveal can't
// be contradicted by a student's own settings — the loaded lesson
// shows both fields disabled, still holding the pack's values.
test("the shipped seqboot-consense pack locks its bootstrap settings", async ({
  page,
}) => {
  const fx = JSON.parse(
    readFileSync(
      new URL(
        "../../fixtures/phylip/chain/jc12_boot100.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    seed: number;
    replicates: number;
  };
  await page.goto("/?lab=seqboot-consense");
  await expect(
    page.getByRole("heading", {
      name: "seqboot → dnadist → neighbor → consense",
    }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Load this lab" }).click();
  await waitForApp(page);
  await stepToEnd(page);
  await expect(page.getByLabel("Replicates")).toHaveValue(
    String(fx.replicates),
  );
  await expect(page.getByLabel("Replicates")).toBeDisabled();
  await expect(page.getByLabel("Seed")).toHaveValue(String(fx.seed));
  await expect(page.getByLabel("Seed")).toBeDisabled();
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

test("a MEGA lab groups under MEGA labs on the index and its page shows the MEGA columns and note heading", async ({
  page,
}) => {
  await page.goto("/?labs");
  await expect(
    page.getByRole("heading", { name: "MEGA labs" }),
  ).toBeVisible();
  const megaCard = page.locator(".lab-card", {
    hasText: "Test MEGA lab: distances → NJ",
  });
  await expect(megaCard).toBeVisible();
  await megaCard.getByRole("link", { name: /open lab/i }).click();
  await expect(
    page.getByRole("heading", { name: "Test MEGA lab: distances → NJ" }),
  ).toBeVisible();
  for (const col of ["Option", "MEGA menu", "MEGA setting", "NeoPhylo"]) {
    await expect(
      page.getByRole("columnheader", { name: col }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("heading", {
      name: "What MEGA shows you vs what NeoPhylo shows you",
    }),
  ).toBeVisible();
  await expect(page.getByText(/MEGA prints the matrix/)).toBeVisible();
});

test("a MEGA lab loads through its lab page into the app", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?lab=mega-test-lab");
  await expect(
    page.getByRole("heading", { name: "Test MEGA lab: distances → NJ" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Load this lab" }).click();
  await waitForApp(page);
  await expect(page.locator(".app-header h1")).toContainText(
    "Test MEGA lab: K2P distances → NJ",
  );
  await expect(page.getByLabel("Distance correction")).toHaveValue("K80");
  await expect(page.getByLabel("Tree-building method")).toHaveValue("Nj");
});

// Task 13 handout 1 (conductor note 7): the shipped MEGA handout is
// listed without the e2e flag, and "Load this lab" replays the real
// link — JC69, NJ and pairwise deletion on the embedded primate-mtDNA
// alignment. The gap control is sandbox-only, so the check enters the
// sandbox (which keeps the loaded settings) and reads the checked
// radio; the matrix row is the fixture's printed JC69/pairwise row at
// the displayed 3-decimal precision, read from the fixture.
test("the shipped MEGA handout loads JC69 + NJ + pairwise into the sandbox", async ({
  page,
}) => {
  const fx = JSON.parse(
    readFileSync(
      new URL(
        "../../fixtures/mega/library/primate-mtdna.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ) as {
    distances: Record<string, { labels: string[]; matrix: (number | null)[][] }>;
  };
  const run = fx.distances["JC69/pairwise"];
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?lab=mega-jc69-vs-k2p");
  await expect(
    page.getByRole("heading", { name: "MEGA: JC69 vs K2P on primate mtDNA" }),
  ).toBeVisible();
  await page.getByRole("link", { name: "Load this lab" }).click();
  await waitForApp(page);
  await expect(page.getByLabel("Distance correction")).toHaveValue("Jc69");
  await expect(page.getByLabel("Tree-building method")).toHaveValue("Nj");

  // The gap treatment is the lab's pairwise deletion — visible on the
  // sandbox's gap control once Sandbox keeps the loaded settings.
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await expect(
    page.getByRole("radio", { name: "Pairwise deletion" }),
  ).toBeChecked();
  // Pairwise keeps every column: 0 of the alignment's 1,138 removed.
  await expect(page.locator(".gap-count")).toContainText(
    "0 of 1,138 sites removed by pairwise deletion",
  );

  // One whole row of cells at the displayed 3-decimal precision — the
  // grid's per-cell aria-labels carry the value.
  const n = run.labels.length;
  for (let j = 0; j < n; j++) {
    const v = run.matrix[0][j];
    if (v === null) throw new Error("n/c cell in the JC69 row");
    const shown = j === 0 ? "0.000" : v.toFixed(3);
    await expect(
      page.locator(
        `g[role="gridcell"][aria-label="${run.labels[0]}, ${run.labels[j]}: ${shown}"]`,
      ),
      `cell ${run.labels[0]}/${run.labels[j]} shows ${shown}`,
    ).toBeVisible();
  }
});

// Task 13 handout 1 (Review Focus 5): the editor's lab sheet lists the
// shipped MEGA handout too — loading it over unsaved work asks first
// and declining keeps the draft.
test("with unsaved editor work, Load this lab on the MEGA handout asks first", async ({
  page,
}) => {
  await page.goto("/?editor");
  const newick = NEWICK(page);
  await expect(newick).toBeVisible();
  await newick.fill("(X:0.5,Y:0.5,Z:0.5);");
  await newick.press("Enter");
  await page.getByLabel("Title").fill("My draft");

  await page.getByRole("button", { name: "Labs" }).click();
  const sheet = page.getByRole("dialog", { name: "Labs" });
  const row = sheet
    .locator("li")
    .filter({ hasText: "MEGA: JC69 vs K2P on primate mtDNA" });
  await expect(row).toBeVisible();
  await row.getByRole("button", { name: "Load this lab" }).click();
  await expect(
    page.getByRole("heading", { name: "Replace your unsaved work?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /keep my work/i }).click();
  await expect(newick).toHaveValue("(X:0.5,Y:0.5,Z:0.5);");
  await expect(page.getByLabel("Title")).toHaveValue("My draft");
});

test("a clean editor loads the lab without asking", async ({ page }) => {
  await page.goto("/?editor");
  await expect(NEWICK(page)).toBeVisible();
  await page.getByRole("button", { name: "Labs" }).click();
  const sheet = page.getByRole("dialog", { name: "Labs" });
  await expect(sheet).toBeVisible();
  await expect(
    sheet.getByText("Test lab: dnadist → neighbor"),
  ).toBeVisible();
  await testLabRow(sheet)
    .getByRole("button", { name: "Load this lab" })
    .click();
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

  await page.getByRole("button", { name: "Labs" }).click();
  const sheet = page.getByRole("dialog", { name: "Labs" });
  await testLabRow(sheet)
    .getByRole("button", { name: "Load this lab" })
    .click();
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
  await testLabRow(sheet)
    .getByRole("button", { name: "Load this lab" })
    .click();
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

  // The header's "Labs" chip at the wide breakpoint.
  const headerLink = page.locator("a.labs-link");
  await expect(headerLink).toBeVisible();
  await expectFloor(headerLink, 'header "Labs" link at 1366 px');

  // Its Settings-drawer mirror at the medium breakpoint.
  await page.setViewportSize({ width: 1024, height: 900 });
  await page.getByRole("button", { name: "Settings" }).click();
  const drawerLink = page.locator("a.settings-drawer-labs");
  await expect(drawerLink).toBeVisible();
  await expectFloor(drawerLink, 'drawer "Labs" link at 1024 px');
  await page.keyboard.press("Escape");

  // And the More-menu item below 1024 px.
  await page.setViewportSize({ width: 768, height: 900 });
  await page.getByRole("button", { name: "More" }).click();
  const moreItem = page.getByRole("menuitem", { name: "Labs" });
  await expect(moreItem).toBeVisible();
  await expectFloor(moreItem, 'More-menu "Labs" item at 768 px');

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
    page.getByRole("heading", { name: "Labs", exact: true }),
  ).toBeVisible();
  await checkAll("the lab index");

  await page.goto("/?lab=mega-test-lab");
  await expect(
    page.getByRole("heading", { name: "Test MEGA lab: distances → NJ" }),
  ).toBeVisible();
  await checkAll("the MEGA lab page");

  // The shipped MEGA handout's page gets the same pass (Task 13).
  await page.goto("/?lab=mega-jc69-vs-k2p");
  await expect(
    page.getByRole("heading", { name: "MEGA: JC69 vs K2P on primate mtDNA" }),
  ).toBeVisible();
  await checkAll("the shipped MEGA lab page");

  await page.goto("/?lab=test-lab");
  await expect(
    page.getByRole("heading", { name: "Test lab: dnadist → neighbor" }),
  ).toBeVisible();
  await checkAll("the test lab page");

  await context.close();
});

test("without the e2e flag the index lists only the shipped packs", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
  });
  const page = await context.newPage();
  await page.goto("/?labs");
  await expect(
    page.getByRole("heading", { name: "Labs", exact: true }),
  ).toBeVisible();
  await expect(page.getByText("dnadist → neighbor (F84)")).toBeVisible();
  await expect(page.getByText("protdist → neighbor (JTT)")).toBeVisible();
  await expect(
    page.getByRole("heading", {
      name: "seqboot → dnadist → neighbor → consense",
    }),
  ).toBeVisible();
  // Task 13 handout 1 is a shipped lab: it lists under "MEGA labs"
  // without the flag and the coming-soon line is gone.
  await expect(
    page.getByText("MEGA: JC69 vs K2P on primate mtDNA"),
  ).toBeVisible();
  await expect(
    page.getByText("Test lab: dnadist → neighbor"),
  ).toHaveCount(0);
  await expect(page.getByText(/no lab packs/i)).toHaveCount(0);
  await expect(
    page.getByText(/MEGA handouts are coming/i),
  ).toHaveCount(0);
  await context.close();
});

// v1.4b Task 12 (owner decision, 2026-11-02): the header's "Coming
// from PHYLIP?" button became a "Guides" menu holding both guides;
// below 1024 px the More menu carries them. Each guide must be
// reachable at every width.
for (const vp of [
  { w: 1366, h: 900 },
  { w: 1024, h: 768 },
  { w: 768, h: 1024 },
]) {
  test(`both guides are reachable at ${vp.w} px (${vp.w < 1024 ? "More menu" : "Guides menu"})`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/?lesson=nj-basics");
    await waitForApp(page);

    const openMenu = async () => {
      if (vp.w < 1024) {
        await page.getByRole("button", { name: "More" }).click();
      } else {
        await page.getByRole("button", { name: "Guides" }).click();
      }
    };

    for (const guide of ["Coming from PHYLIP?", "Coming from MEGA?"]) {
      await openMenu();
      await page.getByRole("menuitem", { name: guide }).click();
      const dialog = page.getByRole("dialog", { name: guide });
      await expect(dialog).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(dialog).toHaveCount(0);
    }
  });
}

// v1.4b Task 12 fix round 1 (plan Step 1): "reachable from the PHYLIP
// guide" means clicking through — each guide's cross-link swaps the
// open sheet for the other guide's.
test("each guide's cross-link opens the other guide", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);

  await page.getByRole("button", { name: "Guides" }).click();
  await page
    .getByRole("menuitem", { name: "Coming from PHYLIP?" })
    .click();
  const phylip = page.getByRole("dialog", {
    name: "Coming from PHYLIP?",
  });
  await expect(phylip).toBeVisible();

  await phylip
    .getByRole("button", { name: "Coming from MEGA?" })
    .click();
  const mega = page.getByRole("dialog", { name: "Coming from MEGA?" });
  await expect(mega).toBeVisible();
  await expect(phylip).toHaveCount(0);

  await mega
    .getByRole("button", { name: "Coming from PHYLIP?" })
    .click();
  await expect(phylip).toBeVisible();
  await expect(mega).toHaveCount(0);
});

// v1.4b Task 12 (conductor note 7): every link/button in MegaHelp,
// the Guides menu and the cross-links is ≥ 40×40 under a coarse
// pointer — plain links are not covered by the generic coarse rule,
// so this test enumerates a, button like the lab-pages pass above.
test("under (pointer: coarse) every Guides menu, MegaHelp and cross-link target is ≥40×40", async ({
  browser,
}) => {
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 1366, height: 900 },
    hasTouch: true,
    serviceWorkers: "block",
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
    // Gecko reports a 40 px box as 39.99998 — unit-conversion noise in
    // the layout value, not a short target; 0.05 absorbs it while a
    // genuinely smaller control still fails.
    const floor = 40 - 0.05;
    expect(
      box.width,
      `${name} is at least 40 px wide (got ${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(floor);
    expect(
      box.height,
      `${name} is at least 40 px tall (got ${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(floor);
  };
  const checkAll = async (
    scope: import("@playwright/test").Locator | import("@playwright/test").Page,
    what: string,
  ) => {
    const targets = scope.locator("a, button");
    const count = await targets.count();
    expect(count, `${what}: targets on screen`).toBeGreaterThan(0);
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

  // The Guides menu itself.
  await page.getByRole("button", { name: "Guides" }).click();
  await checkAll(page.getByRole("menu"), "the Guides menu");

  // MegaHelp: the sheet and everything inside it, including the
  // "Coming from PHYLIP?" cross-link.
  await page.getByRole("menuitem", { name: "Coming from MEGA?" }).click();
  const mega = page.getByRole("dialog", { name: "Coming from MEGA?" });
  await expect(mega).toBeVisible();
  await checkAll(mega, "MegaHelp");
  await mega.getByRole("button", { name: /Coming from PHYLIP\?/ }).click();

  // PhylipHelp: same pass — its "Coming from MEGA?" cross-link is a
  // plain-styled control too.
  const phylip = page.getByRole("dialog", {
    name: "Coming from PHYLIP?",
  });
  await expect(phylip).toBeVisible();
  await checkAll(phylip, "PhylipHelp cross-link");

  await context.close();
});
