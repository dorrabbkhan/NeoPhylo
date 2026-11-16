// Distance-matrix sessions end to end (v1.4c plan Task 8, spec §6.1–
// §6.4): the three import routes (file, paste, grid), the ambiguity
// questions with one-click answers, the asymmetric offer, mid-session
// grid edits (Review Focus 3), leaving the session (Review Focus 4),
// the matrix exports and their round-trip, the negative-branch
// sentence and the long-link advisory.

import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { fileURLToPath } from "node:url";

import { readStep, stepToEnd, waitForApp } from "./helpers";

const MATRIX_DIR = fileURLToPath(
  new URL("../../fixtures/inputs/matrix/", import.meta.url),
);

const PROTEIN_DIR = fileURLToPath(
  new URL("../../fixtures/inputs/protein/", import.meta.url),
);

const WIKI5_LOWER = {
  names: ["a", "b", "c", "d", "e"],
  lower: [5, 9, 10, 9, 10, 8, 8, 9, 7, 3],
};

const REPLACEMENT =
  "This tree was built from a distance matrix, so there are no sequences to compare or resample.";

async function openSandbox(page: Page): Promise<void> {
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
}

/** The import panel's scope: the wide layout's column or — below
 * 1280 px — the Settings drawer (the same pattern as visualScenes'
 * inSettings). Stays open: matrix specs interact repeatedly. */
async function importScope(page: Page): Promise<Locator> {
  const dlg = page.getByRole("dialog", { name: "Settings" });
  if (await dlg.isVisible().catch(() => false)) return dlg;
  const gear = page.getByRole("button", { name: "Settings" });
  if (!(await gear.isVisible())) {
    return page.locator(".col-controls");
  }
  await gear.click();
  return dlg;
}

async function openMatrixTab(page: Page): Promise<Locator> {
  const scope = await importScope(page);
  await scope.getByRole("tab", { name: "Distance matrix" }).click();
  return scope.locator(".matrix-import");
}

/** Open the typing grid's Sheet from the matrix tab (fix round 2: the
 * grid left the sidebar for the lazy "Type a matrix…" sheet). The
 * returned locator names the dialog; the grid's own controls are also
 * reachable through the `mi` scope since the sheet is DOM-nested
 * inside `.matrix-import`. */
async function openGridSheet(
  page: Page,
  mi: Locator,
): Promise<Locator> {
  await mi.getByRole("button", { name: "Type a matrix…" }).click();
  const sheet = page.getByRole("dialog", { name: "Distance matrix" });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Every grid control inside the viewport, the scroll container
 * never scrolling sideways and cell text ≥ 12 px — fix round 2's
 * fit contract, at each named viewport. One evaluate pass: the
 * per-element locator round-trips blew the default timeout on
 * Firefox. */
async function expectGridFits(sheet: Locator): Promise<void> {
  const bad = await sheet.evaluate((root) => {
    const out: string[] = [];
    const wrap = root.querySelector(".matrix-grid-wrap");
    if (
      wrap !== null &&
      wrap.scrollWidth > wrap.clientWidth + 1
    ) {
      out.push(
        `scroll region ${wrap.scrollWidth} > clientWidth ${wrap.clientWidth}`,
      );
    }
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const controls = root.querySelectorAll(
      ".matrix-grid input, .matrix-grid-block button, " +
        ".matrix-grid-block select",
    );
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) continue;
      const label =
        el.getAttribute("aria-label") ??
        (el.textContent ?? "").trim().slice(0, 30);
      if (
        r.left < -0.5 ||
        r.right > vw + 0.5 ||
        r.top < -0.5 ||
        r.bottom > vh + 0.5
      ) {
        out.push(
          `"${label}" box ${r.left.toFixed(1)},${r.top.toFixed(1)} ` +
            `${r.width.toFixed(1)}×${r.height.toFixed(1)} outside ` +
            `${vw}×${vh}`,
        );
      }
    }
    const cell = root.querySelector(".matrix-cell");
    const fs =
      cell === null ? 0 : parseFloat(getComputedStyle(cell).fontSize);
    if (fs < 11.95) out.push(`cell text ${fs} px < 12`);
    return out;
  });
  expect(bad).toEqual([]);
}

/** The inferred tree's exported Newick, for comparing builds. */
async function exportedNewick(page: Page): Promise<string> {
  const scope = await importScope(page);
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    scope
      .locator(".export-menu")
      .getByRole("button", { name: /^Newick/ })
      .click(),
  ]);
  const stream = await dl.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function exportedItem(page: Page, name: string): Promise<string> {
  const scope = await importScope(page);
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    scope.locator(".export-menu").getByRole("button", { name }).click(),
  ]);
  const stream = await dl.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

test("a PHYLIP matrix file and its .meg copy build the same tree", async ({
  page,
}) => {
  await openSandbox(page);
  const scope = await importScope(page);
  await scope
    .locator('.import-file input[type="file"]')
    .setInputFiles(`${MATRIX_DIR}wiki5_lower.phy`);
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  await expect(page.locator(".alphabet-badge-label")).toHaveText(
    "Distance matrix",
  );
  await expect(page.locator("text=" + REPLACEMENT)).toBeVisible();
  const phylipTree = await exportedNewick(page);

  await page.reload();
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  const scope2 = await importScope(page);
  await scope2
    .locator('.import-file input[type="file"]')
    .setInputFiles(`${MATRIX_DIR}wiki5_lower.meg`);
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  expect(await exportedNewick(page)).toBe(phylipTree);
});

test("hidden panels: no bootstrap result tabs or empty state in a matrix session", async ({
  page,
}) => {
  await openSandbox(page);
  const scope = await importScope(page);
  await scope
    .locator('.import-file input[type="file"]')
    .setInputFiles(`${MATRIX_DIR}wiki5_lower.phy`);
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  await stepToEnd(page);
  // Bootstrap is impossible without an alignment — the consensus
  // strip and its "Available after a bootstrap run" empty state never
  // render (fix round 1).
  await expect(
    page.getByRole("tablist", { name: "Bootstrap tree views" }),
  ).toHaveCount(0);
  for (const name of [
    "Your tree with support",
    "Majority-rule",
    "Extended majority",
    "Strict",
  ]) {
    await expect(page.getByRole("tab", { name })).toHaveCount(0);
  }
  await expect(
    page.getByText("Available after a bootstrap run."),
  ).toHaveCount(0);
});

test("the grid sheet fits 5 and 10 taxa at every named viewport (fix round 2)", async ({
  page,
}) => {
  for (const vp of [
    { width: 1920, height: 1080 },
    { width: 1024, height: 768 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(vp);
    await page.goto("/");
    await waitForApp(page);
    await page.getByRole("radio", { name: "Sandbox" }).click();
    const mi = await openMatrixTab(page);
    const sheet = await openGridSheet(page, mi);

    // Five taxa — the sheet's default grid.
    await expect(mi.getByLabel("Taxon 5 name")).toBeVisible();
    await expectGridFits(sheet);

    // Ten taxa — still no sideways scroll anywhere.
    for (let k = 0; k < 5; k += 1) {
      await mi.getByRole("button", { name: "Add taxon" }).click();
    }
    await expect(mi.getByLabel("Taxon 10 name")).toBeVisible();
    await expectGridFits(sheet);

    // The page itself never scrolls sideways either.
    const doc = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(
      doc.scroll,
      `no sideways page scroll at ${vp.width}×${vp.height}`,
    ).toBeLessThanOrEqual(doc.client);
    await page.keyboard.press("Escape");
  }
});

test("a matrix file opened in the Sequences tab mounts the matrix tab's content (fix round 2, 1920 and the 768 drawer)", async ({
  page,
}) => {
  for (const vp of [
    { width: 1920, height: 1080 },
    { width: 768, height: 1024 },
  ]) {
    await page.setViewportSize(vp);
    await page.goto("/");
    await waitForApp(page);
    await page.getByRole("radio", { name: "Sandbox" }).click();
    const scope = await importScope(page);
    await scope
      .locator('.import-file input[type="file"]')
      .setInputFiles(`${MATRIX_DIR}wiki5_lower.phy`);
    await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
    // The origin change selected the Distance matrix tab…
    await expect(
      scope.getByRole("tab", { name: "Distance matrix" }),
    ).toHaveAttribute("aria-selected", "true");
    // …and the tabpanel mounted its content — the bug this round
    // fixes rendered it EMPTY behind the selected tab.
    const mi = scope.locator(".matrix-import");
    await openGridSheet(page, mi);
    for (const [i, n] of ["a", "b", "c", "d", "e"].entries()) {
      await expect(mi.getByLabel(`Taxon ${i + 1} name`)).toHaveValue(n);
    }
    await expect(mi.getByLabel("Distance between e and d")).toHaveValue("3");
    await page.keyboard.press("Escape");
  }
});

test("a .meg matrix !Title becomes the session's display name", async ({
  page,
}) => {
  await openSandbox(page);
  const scope = await importScope(page);
  await scope
    .locator('.import-file input[type="file"]')
    .setInputFiles(`${MATRIX_DIR}wiki5_lower.meg`);
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  // The file's !Title is the session's display name — it comes back
  // out as the exported figure's title.
  const meg = await exportedItem(page, "Matrix (.meg)");
  expect(meg).toContain("!Title wiki5_lower;");
});

test("pasting each matrix form: tab-separated header, lower triangle, CSV question", async ({
  page,
}) => {
  await openSandbox(page);
  const mi = await openMatrixTab(page);

  // Tab-separated square with a header row of names. The engine
  // parses this paste without asking (parse_pasted_matrix raises no
  // MatrixAmbiguous for it — pinned by the Vitest engine test in
  // MatrixImport.test.tsx), so no question renders and the same path
  // is asserted unconditionally.
  await mi.getByLabel("Paste a distance matrix").fill(
    "\ta\tb\tc\n" + "a\t0\t5\t9\n" + "b\t5\t0\t10\n" + "c\t9\t10\t0\n",
  );
  await mi.getByRole("button", { name: "Import matrix" }).click();
  await expect(
    mi.getByRole("group", { name: "Matrix question" }),
  ).toHaveCount(0);
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  // The parsed names and lower triangle seed the grid (in its sheet).
  await openGridSheet(page, mi);
  for (const [i, n] of ["a", "b", "c"].entries()) {
    await expect(mi.getByLabel(`Taxon ${i + 1} name`)).toHaveValue(n);
  }
  await expect(mi.getByLabel("Distance between b and a")).toHaveValue("5");
  await expect(mi.getByLabel("Distance between c and a")).toHaveValue("9");
  await expect(mi.getByLabel("Distance between c and b")).toHaveValue("10");
  await page.keyboard.press("Escape");

  // A lower-triangle tabular paste.
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  const mi2 = await openMatrixTab(page);
  await mi2.getByLabel("Paste a distance matrix").fill(
    "a 0\nb 5 0\nc 9 10 0\n",
  );
  await mi2.getByRole("button", { name: "Import matrix" }).click();
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
});

test("a plain CSV paste asks DecimalComma once, then imports", async ({
  page,
}) => {
  await openSandbox(page);
  const mi = await openMatrixTab(page);
  await mi.getByLabel("Paste a distance matrix").fill(
    "A,0,5,9\nB,5,0,10\nC,9,10,0",
  );
  await mi.getByRole("button", { name: "Import matrix" }).click();
  await expect(mi.getByText("What does the comma mean?")).toBeVisible();
  await mi
    .getByRole("button", { name: "Comma separates cells" })
    .click();
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  // The heatmap carries the parsed values (5/9/10).
  const labels = await page
    .locator('[role="gridcell"]')
    .allTextContents();
  expect(labels.some((t) => t.includes("5"))).toBe(true);
  expect(labels.some((t) => t.includes("9"))).toBe(true);
  expect(labels.some((t) => t.includes("10"))).toBe(true);
});

test("a decimal-comma paste keeps three cells, never six", async ({
  page,
}) => {
  await openSandbox(page);
  const mi = await openMatrixTab(page);
  await mi.getByLabel("Paste a distance matrix").fill(
    "A 0\nB 0,25 0\nC 0,5 0,75 0",
  );
  await mi.getByRole("button", { name: "Import matrix" }).click();
  // Answer the question(s) the engine asks — the decimal-mark reading.
  for (let k = 0; k < 3; k += 1) {
    const decimal = mi.getByRole("button", { name: "Comma is a decimal mark" });
    const names = mi.getByRole("button", { name: "First column holds names" });
    const data = mi.getByRole("button", { name: "First row is data" });
    if (await decimal.isVisible().catch(() => false)) await decimal.click();
    else if (await names.isVisible().catch(() => false)) await names.click();
    else if (await data.isVisible().catch(() => false)) await data.click();
    else break;
  }
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  const labels = await page.locator('[role="gridcell"]').allTextContents();
  expect(labels.some((t) => t.includes("0.25"))).toBe(true);
  expect(labels.some((t) => t.includes("0.75"))).toBe(true);
});

test("tab-separated paste with spaced names asks no question", async ({
  page,
}) => {
  await openSandbox(page);
  const mi = await openMatrixTab(page);
  await mi.getByLabel("Paste a distance matrix").fill(
    "Homo sapiens\t0\nMus musculus\t0.25\t0\nRattus\t0.5\t0.75\t0",
  );
  await mi.getByRole("button", { name: "Import matrix" }).click();
  await expect(
    mi.getByRole("group", { name: "Matrix question" }),
  ).toHaveCount(0);
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  await expect(
    page.locator('svg[aria-label="Inferred tree"]'),
  ).toContainText("Homo sapiens");
});

test("an asymmetric PHYLIP square offers the lower triangle", async ({
  page,
}) => {
  await openSandbox(page);
  const mi = await openMatrixTab(page);
  await mi
    .getByLabel("Paste a distance matrix")
    .fill("3\na  0 5 9\nb  6 0 10\nc  9 10 0\n");
  await mi.getByRole("button", { name: "Import matrix" }).click();
  await expect(mi.getByText(/not symmetric/)).toBeVisible();
  await mi
    .getByRole("button", { name: "Use the lower triangle" })
    .click();
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  await expect(mi.getByText(/used the lower triangle/)).toBeVisible();
  // d(b,a) is 6, not the upper triangle's 5.
  const labels = await page.locator('[role="gridcell"]').allTextContents();
  expect(labels.some((t) => t.includes("6"))).toBe(true);
});

test("typing wiki5 into the grid builds the same tree as the file", async ({
  page,
}) => {
  await openSandbox(page);
  const scope = await importScope(page);
  await scope
    .locator('.import-file input[type="file"]')
    .setInputFiles(`${MATRIX_DIR}wiki5_lower.phy`);
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  const fileTree = await exportedNewick(page);

  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  const mi = await openMatrixTab(page);
  await openGridSheet(page, mi);
  // The wiki5 names (lowercase in the fixture), then the lower
  // triangle typed cell by cell.
  for (const [i, n] of ["a", "b", "c", "d", "e"].entries()) {
    await mi.getByLabel(`Taxon ${i + 1} name`).fill(n);
  }
  for (const [r, c, v] of [
    ["b", "a", "5"], ["c", "a", "9"], ["c", "b", "10"],
    ["d", "a", "9"], ["d", "b", "10"], ["d", "c", "8"],
    ["e", "a", "8"], ["e", "b", "9"], ["e", "c", "7"], ["e", "d", "3"],
  ] as const) {
    await mi
      .getByLabel(`Distance between ${r} and ${c}`)
      .fill(v);
  }
  await mi.getByRole("button", { name: "Build tree" }).click();
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  // The sheet's scrim covers the export menu — close it first.
  await page.keyboard.press("Escape");
  expect(await exportedNewick(page)).toBe(fileTree);
});

test("keyboard-only grid entry builds the same tree as the file (fix round 2)", async ({
  page,
}) => {
  await openSandbox(page);
  const scope = await importScope(page);
  await scope
    .locator('.import-file input[type="file"]')
    .setInputFiles(`${MATRIX_DIR}wiki5_lower.phy`);
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  const fileTree = await exportedNewick(page);

  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  const mi = await openMatrixTab(page);
  const sheet = await openGridSheet(page, mi);

  // The sheet focuses its first control (the × close) on open —
  // everything from here is keyboard: Tab into the grid, a name edit
  // is select-all + retype, arrows walk cells row by row.
  const rename = async (name: string) => {
    await page.keyboard.press("ControlOrMeta+a");
    await page.keyboard.type(name);
  };
  const cell = (data: string) =>
    sheet.locator(`input[data-cell="${data}"]`);
  // Tab #1 lands on the grid's named scroll region (tabindex=0),
  // Tab #2 on the first cell — Taxon 1's name input.
  await page.keyboard.press("Tab");
  await page.keyboard.press("Tab");
  await expect(cell("0,-1")).toBeFocused();
  await rename("a");
  for (const n of ["b", "c", "d", "e"]) {
    await page.keyboard.press("ArrowDown"); // → next name input
    await rename(n);
  }
  await expect(cell("0,-1")).toHaveValue("a");
  await expect(cell("4,-1")).toHaveValue("e");

  // From the last name input: ArrowUp three times to row b's name,
  // ArrowRight into the first distance cell, then arrow-key through
  // the lower triangle typing each value.
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("ArrowUp");
  await expect(cell("1,-1")).toBeFocused(); // taxon b's name
  await page.keyboard.press("ArrowRight");
  await expect(cell("1,0")).toBeFocused();
  await page.keyboard.type("5"); // d(b,a)
  await page.keyboard.press("ArrowDown");
  await expect(cell("2,0")).toBeFocused();
  await page.keyboard.type("9"); // d(c,a)
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("10"); // d(c,b)
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("10"); // d(d,b)
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("9"); // d(d,a)
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("8"); // d(d,c)
  await page.keyboard.press("ArrowDown");
  await page.keyboard.type("7"); // d(e,c) — (4,2)
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.press("ArrowLeft");
  await page.keyboard.type("8"); // d(e,a)
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("9"); // d(e,b)
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowRight");
  await page.keyboard.type("3"); // d(e,d)

  // Tab past Add taxon, the remove select and Remove taxon to Build
  // tree — the keyboard reaches it and Enter fires it.
  for (let k = 0; k < 4; k += 1) await page.keyboard.press("Tab");
  await expect(
    sheet.getByRole("button", { name: "Build tree" }),
  ).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  // The sheet's scrim covers the export menu — close it first.
  await page.keyboard.press("Escape");
  expect(await exportedNewick(page)).toBe(fileTree);
});

test("Review Focus 3: mid-session edits return to 'complete the matrix'", async ({
  page,
}) => {
  await openSandbox(page);
  const scope = await importScope(page);
  await scope
    .locator('.import-file input[type="file"]')
    .setInputFiles(`${MATRIX_DIR}wiki5_lower.phy`);
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  await stepToEnd(page);
  expect((await readStep(page)).k).toBeGreaterThanOrEqual(3);

  const mi = scope.locator(".matrix-import");
  await scope.getByRole("tab", { name: "Distance matrix" }).click();
  const sheet = await openGridSheet(page, mi);

  // Clear a cell → no tree, no Q matrix, stepper gone.
  await mi.getByLabel("Distance between e and d").fill("");
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Trace stepper" })).toHaveCount(0);
  await expect(page.locator("text=/Complete the distance matrix/")).toBeVisible();
  await expect(mi.getByRole("button", { name: "Build tree" })).toBeDisabled();
  // …and the rebuild hint names what changed (fix round 2).
  await expect(
    sheet.getByText("The matrix changed — press Build tree to rebuild."),
  ).toBeVisible();

  // Refill stays an uncommitted draft — Build tree rebuilds at step 0
  // (fix round 2's commit model: no keystroke ever rebuilds).
  await mi.getByLabel("Distance between e and d").fill("3");
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toHaveCount(0);
  await mi.getByRole("button", { name: "Build tree" }).click();
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  expect((await readStep(page)).k).toBe(0);

  // Remove a taxon → back to "complete the matrix"; Build tree rebuilds.
  // The sheet hides for the stepper, then reopens with the matrix.
  await page.keyboard.press("Escape");
  await stepToEnd(page);
  await openGridSheet(page, mi);
  await mi.getByLabel("Taxon to remove").selectOption({ label: "a" });
  await mi.getByRole("button", { name: "Remove taxon" }).click();
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Trace stepper" })).toHaveCount(0);
  await mi.getByRole("button", { name: "Build tree" }).click();
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  expect((await readStep(page)).k).toBe(0);

  // Add a taxon → the empty new row keeps Build disabled.
  await mi.getByRole("button", { name: "Add taxon" }).click();
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toHaveCount(0);
  await expect(mi.getByRole("button", { name: "Build tree" })).toBeDisabled();
});

test("UPGMA builds on a matrix session too", async ({ page }) => {
  await openSandbox(page);
  const scope = await importScope(page);
  await scope
    .locator('.import-file input[type="file"]')
    .setInputFiles(`${MATRIX_DIR}wiki5_lower.phy`);
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  await scope.getByLabel("Tree-building method").selectOption("Upgma");
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  await stepToEnd(page);
});

test("the negative-branch notice gains the matrix sentence", async ({
  page,
}) => {
  await openSandbox(page);
  const scope = await importScope(page);
  await scope
    .locator('.import-file input[type="file"]')
    .setInputFiles(`${MATRIX_DIR}nonadditive6.phy`);
  const notice = page.locator('section[aria-label="Negative branches"]');
  await expect(notice).toBeVisible();
  await expect(notice).toContainText("This matrix is not perfectly tree-like.");
  await expect(
    notice.getByRole("switch", { name: /negative branches to zero/ }),
  ).toBeVisible();
});

test("matrix exports: PHYLIP and .meg round-trip; no alignment exports", async ({
  page,
}) => {
  await openSandbox(page);
  let scope = await importScope(page);
  await scope
    .locator('.import-file input[type="file"]')
    .setInputFiles(`${MATRIX_DIR}wiki5_lower.phy`);
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();

  // No alignment-only items are offered.
  scope = await importScope(page);
  const menu = scope.locator(".export-menu");
  await expect(menu.getByRole("button", { name: "Alignment (.meg)" })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: "Consensus (Newick)" })).toHaveCount(0);
  await expect(menu.getByRole("button", { name: "Matrix (.meg)" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "Matrix (PHYLIP)" })).toBeVisible();
  await expect(menu.getByRole("button", { name: "R script" })).toBeVisible();

  // The matrix R script writes the square inline.
  const rScript = await exportedItem(page, "R script");
  expect(rScript).toContain("ape::nj(as.dist(m))");
  expect(rScript).toContain('dimnames(m) <- list(c("a","b","c","d","e")');
  expect(rScript).toContain("0,5,9,9,8,");

  // .meg round-trip: identical names and lower values, exactly.
  const meg = await exportedItem(page, "Matrix (.meg)");
  expect(meg).toContain("DataType=Distance");
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  const mi = await openMatrixTab(page);
  await mi.getByLabel("Paste a distance matrix").fill(meg);
  await mi.getByRole("button", { name: "Import matrix" }).click();
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  // The seeded grid holds the same names and values (in its sheet).
  const scope2 = await importScope(page);
  const grid = scope2.locator(".matrix-import");
  await scope2.getByRole("tab", { name: "Distance matrix" }).click();
  await openGridSheet(page, grid);
  for (const [i, n] of WIKI5_LOWER.names.entries()) {
    await expect(grid.getByLabel(`Taxon ${i + 1} name`)).toHaveValue(n);
  }
  const cells: [string, string, string][] = [
    ["b", "a", "5"], ["c", "a", "9"], ["c", "b", "10"],
    ["d", "a", "9"], ["d", "b", "10"], ["d", "c", "8"],
    ["e", "a", "8"], ["e", "b", "9"], ["e", "c", "7"], ["e", "d", "3"],
  ];
  for (const [r, c, v] of cells) {
    await expect(grid.getByLabel(`Distance between ${r} and ${c}`)).toHaveValue(v);
  }
});

test("a 200-taxon import shows the long-link advisory", async ({ page }) => {
  await openSandbox(page);
  // 200 taxa pass the parser cap but the encoded link exceeds
  // LONG_LINK_CHARS — the advisory shows since there is no share
  // button. The distances vary so the compressed `d=` payload stays
  // long; a constant table would compress to a few hundred bytes.
  const n = 200;
  const names = Array.from({ length: n }, (_, i) => `t${i + 1}`);
  const rows = names.map(
    (name, i) =>
      `${name}  ` +
      Array.from(
        { length: i },
        (_, j) => (((i + 1) * (j + 7) * 7919) % 997) / 100,
      ).join(" "),
  );
  const scope = await importScope(page);
  await scope
    .locator('.import-file input[type="file"]')
    .setInputFiles({
      name: "big200.phy",
      mimeType: "text/plain",
      buffer: Buffer.from(`${n}\n${rows.join("\n")}\n`),
    });
  await expect(
    page.locator(
      "text=This link is very long; some apps may cut it. Export the matrix file instead.",
    ),
  ).toBeVisible({ timeout: 30_000 });
});

test("Review Focus 4: leaving a matrix session restores the alignment UI", async ({
  page,
}) => {
  await openSandbox(page);
  const scope = await importScope(page);
  await scope
    .locator('.import-file input[type="file"]')
    .setInputFiles(`${MATRIX_DIR}wiki5_lower.phy`);
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  expect(page.url()).toContain("d=");

  // Alignment paste → the panels return and the badge is the alphabet.
  const scope2 = await importScope(page);
  await scope2.getByRole("tab", { name: "Sequences or tree" }).click();
  await scope2
    .locator(".import-panel textarea")
    .fill(">a\nACGTACGT\n>b\nACGTACGA\n>c\nACGTTCGT\n");
  await scope2.getByRole("button", { name: "Import", exact: true }).click();
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  await expect(page.locator(".alphabet-badge-label")).toHaveText("DNA");
  await expect(scope2.getByLabel("Distance correction")).toBeVisible();
  await expect(page.locator("text=Gap treatment")).toBeVisible();
  await expect(
    page.locator("text=" + REPLACEMENT),
  ).toHaveCount(0);
  expect(page.url()).not.toContain("matrix");

  // The pair panel and the bootstrap panel return too (fix round 2 —
  // the original check stopped at the correction/gap controls). The
  // pair panel is a protein feature (spec §5.2), so a protein file
  // goes in and a distance cell opens it.
  const scope2b = await importScope(page);
  await scope2b
    .locator('.import-file input[type="file"]')
    .setInputFiles(`${PROTEIN_DIR}p6_150.fasta`);
  await expect(page.locator(".alphabet-badge-label")).toContainText("Protein");
  await stepToEnd(page);
  // "How sure are we?" — the bootstrap panel the matrix session hid
  // (a named <section>, so its ARIA role is `region`).
  await expect(
    page.getByRole("region", { name: "How sure are we?" }),
  ).toBeVisible();
  // The pair details panel opens from a distance-matrix cell.
  await page.locator('[role="gridcell"][data-i="0"][data-j="1"]').click();
  const pairDlg = page.getByRole("dialog", {
    name: /How was this distance computed/,
  });
  await expect(pairDlg).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(pairDlg).toHaveCount(0);

  // A lesson load clears the imported alignment from the link.
  await page.getByRole("button", { name: "Lessons" }).click();
  await page
    .getByRole("menuitemradio", { name: /How Neighbor-Joining works/ })
    .click();
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  expect(page.url()).toContain("lesson=");

  // Back to a matrix session: `d=` carries only the matrix data —
  // the lesson id stays by design (the sandbox overlays that
  // exercise), but no dataset or stale alignment rides along.
  await page.getByRole("radio", { name: "Sandbox" }).click();
  const scope3 = await importScope(page);
  await scope3
    .locator('.import-file input[type="file"]')
    .setInputFiles(`${MATRIX_DIR}wiki5_lower.meg`);
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  await expect(page.locator(".alphabet-badge-label")).toHaveText(
    "Distance matrix",
  );
  expect(page.url()).toContain("d=");
  expect(page.url()).not.toContain("ds=");
});

// Cell-digit fit (v1.4c owner ruling 2A on PR #156): values ≥ 10 at 3
// decimals ("15.000") used to run to the cell edges. Every cell value
// text must measure within the 34 px cell — getComputedTextLength is
// in viewBox units, so the check is scale-independent. Chromium only:
// the bundled fonts pin the metrics. nj_by_hand is all-integer (0
// decimals); upgma_vs_nj reduces to .5 values ≥ 10 (2 decimals).
test("cell value text never exceeds the 34 px cell (Chromium)", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium");

  /** Every gridcell value text wider than the 34 px cell. */
  const overflowing = (page: Page) =>
    page.evaluate(() => {
      const out: string[] = [];
      for (const g of document.querySelectorAll('[role="gridcell"]')) {
        const t = g.querySelector("text");
        if (t === null) continue;
        const w = t.getComputedTextLength();
        if (w > 34) {
          out.push(`"${t.textContent}" ${w.toFixed(1)}px > 34px cell`);
        }
      }
      return out;
    });

  for (const file of ["nj_by_hand.phy", "upgma_vs_nj.phy"]) {
    await openSandbox(page);
    const scope = await importScope(page);
    await scope
      .locator('.import-file input[type="file"]')
      .setInputFiles(`${MATRIX_DIR}${file}`);
    await expect(
      page.locator('svg[aria-label="Inferred tree"]'),
    ).toBeVisible();
    await page.keyboard.press("Escape");

    // Every step position, both the distance and (NJ) Q views.
    const qToggle = page.getByRole("switch", { name: "Distance / Q" });
    for (;;) {
      expect(await overflowing(page), `${file} distance view`).toEqual(
        [],
      );
      if (await qToggle.isEnabled().catch(() => false)) {
        await qToggle.click();
        expect(await overflowing(page), `${file} Q view`).toEqual([]);
        await qToggle.click();
      }
      const { k, max } = await readStep(page);
      if (k === max) break;
      await page.getByRole("button", { name: "Next step" }).click();
    }
  }
});
