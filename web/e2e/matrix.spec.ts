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

test("the matrix UI's text stays inside the drawer at 768×1024 (ten taxa)", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await openSandbox(page);
  const scope = await importScope(page);
  await scope.getByRole("tab", { name: "Distance matrix" }).click();
  const mi = scope.locator(".matrix-import");
  for (let k = 0; k < 5; k += 1) {
    await mi.getByRole("button", { name: "Add taxon" }).click();
  }
  await expect(mi.getByLabel("Taxon 10 name")).toBeVisible();

  // The page itself never scrolls sideways.
  const doc = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    client: document.documentElement.clientWidth,
  }));
  expect(doc.scroll).toBeLessThanOrEqual(doc.client);

  // Every text-bearing element of the matrix UI — caption, labels,
  // notices — lies within the Settings drawer's box; the only
  // horizontal overflow allowed is inside the table's own named,
  // focusable scroll region.
  const violators = await mi.evaluate((root) => {
    const dlgBox = root.closest("[role=dialog]")?.getBoundingClientRect();
    const bad: string[] = [];
    for (const el of root.querySelectorAll("*")) {
      // Inside the scroll region only the table runs past the edge.
      if (el.closest(".matrix-grid-wrap") !== null) continue;
      const hasText = [...el.childNodes].some(
        (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim() !== "",
      );
      if (!hasText) continue;
      const r = el.getBoundingClientRect();
      const desc = `${el.tagName.toLowerCase()}.${el.className} ` +
        `"${(el.textContent ?? "").trim().slice(0, 40)}"`;
      if (el.scrollWidth > el.clientWidth + 1) {
        bad.push(`${desc} scrollWidth ${el.scrollWidth} > ${el.clientWidth}`);
      }
      if (
        dlgBox !== undefined &&
        (r.left < dlgBox.left - 1 || r.right > dlgBox.right + 1)
      ) {
        bad.push(
          `${desc} box ${r.left.toFixed(1)}..${r.right.toFixed(1)} ` +
            `outside drawer ${dlgBox.left.toFixed(1)}..${dlgBox.right.toFixed(1)}`,
        );
      }
    }
    return bad;
  });
  expect(violators).toEqual([]);

  // The scroll region itself never outgrows the drawer — only its
  // contents scroll.
  const dlgBox = await scope.boundingBox();
  const wrapBox = await mi.locator(".matrix-grid-wrap").boundingBox();
  expect(wrapBox).not.toBeNull();
  expect(dlgBox).not.toBeNull();
  expect(wrapBox!.x + wrapBox!.width).toBeLessThanOrEqual(
    dlgBox!.x + dlgBox!.width + 1,
  );
  expect(wrapBox!.x).toBeGreaterThanOrEqual(dlgBox!.x - 1);
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
  // The parsed names and lower triangle seed the grid.
  for (const [i, n] of ["a", "b", "c"].entries()) {
    await expect(mi.getByLabel(`Taxon ${i + 1} name`)).toHaveValue(n);
  }
  await expect(mi.getByLabel("Distance between b and a")).toHaveValue("5");
  await expect(mi.getByLabel("Distance between c and a")).toHaveValue("9");
  await expect(mi.getByLabel("Distance between c and b")).toHaveValue("10");

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

  // Clear a cell → no tree, no Q matrix, stepper gone.
  await mi.getByLabel("Distance between e and d").fill("");
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Trace stepper" })).toHaveCount(0);
  await expect(page.locator("text=/Complete the distance matrix/")).toBeVisible();
  await expect(mi.getByRole("button", { name: "Build tree" })).toBeDisabled();

  // Refill → the edit path rebuilds at step 0.
  await mi.getByLabel("Distance between e and d").fill("3");
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  expect((await readStep(page)).k).toBe(0);

  // Remove a taxon → back to "complete the matrix"; Build tree rebuilds.
  await stepToEnd(page);
  await mi.getByRole("button", { name: "Remove taxon a" }).click();
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
  // The seeded grid holds the same names and values.
  const scope2 = await importScope(page);
  const grid = scope2.locator(".matrix-import");
  await scope2.getByRole("tab", { name: "Distance matrix" }).click();
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
