// Release-checkpoint browser pass (docs/release-checkpoint.md, step 3).
// Runs against the deployed release candidate on Chromium, Firefox and
// WebKit. Section numbers (§) match docs/checkpoints/v1.4c-release.md; the
// generic parts (datasets, links, lessons, labs, printing) read their
// lists from the repo, so they carry over to later releases.
//
// Everything it saves lands under $CHECKPOINT_OUT for the owner:
// shots/ (gallery screenshots), print/ (PDFs, Chromium), meg/ (exported
// alignments that scripts/checkpoint/mega_verify.py runs through MEGA-CC).

import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";

import {
  REPO,
  expectCleanLayout,
  isChromium,
  openDataset,
  outPath,
  pasteImport,
  prime,
  printColors,
  shoot,
  showControls,
  visit,
  waitForApp,
  watchConsole,
} from "./audit";

const readJson = <T>(rel: string): T =>
  JSON.parse(readFileSync(`${REPO}${rel}`, "utf8")) as T;

interface DatasetEntry {
  id: string;
  title: string;
  alphabet: "dna" | "protein";
  taxa: number;
  sites: number;
  license: string;
  provenance: string;
}
const DATASETS = readJson<DatasetEntry[]>("web/public/library/index.json");

interface LabFile {
  lab: { id: string; title: string; tool?: string };
}
const LABS = readdirSync(`${REPO}exercises/labs`)
  .filter((f) => f.endsWith(".json"))
  .map((f) => readJson<LabFile>(`exercises/labs/${f}`).lab);

const LESSONS = readdirSync(`${REPO}exercises`)
  .filter((f) => f.endsWith(".json") && f !== "schema.json")
  .map((f) => f.replace(/\.json$/, ""));

const MEG_INPUTS = `${REPO}crates/neophylo-core/tests/meg_inputs/`;

const WIDTHS = [768, 1024, 1280, 1920] as const;
const THEMES = ["light", "dark"] as const;
const HEIGHT: Record<number, number> = {
  768: 1024,
  1024: 768,
  1280: 800,
  1920: 1080,
};

const exportMeg = (page: import("@playwright/test").Page) =>
  Promise.all([
    page.waitForEvent("download"),
    page
      .locator(".export-menu")
      .getByRole("button", { name: "Alignment (.meg)" })
      .click(),
  ]).then(([dl]) => dl);

// ---------------------------------------------------------------- §0
test("§0 the deploy serves the committed library index", async ({
  request,
}) => {
  const res = await request.get("library/index.json");
  expect(res.ok()).toBe(true);
  expect(await res.json(), "stale deploy? redeploy the RC").toEqual(DATASETS);
});

// ---------------------------------------------------------------- §10
for (const theme of THEMES) {
  for (const w of WIDTHS) {
    test(`§10 dataset sheet and every dataset at ${w} px, ${theme}`, async ({
      page,
      request,
    }, info) => {
      test.setTimeout(420_000);
      const done = watchConsole(page);
      await prime(page, theme);
      await page.setViewportSize({ width: w, height: HEIGHT[w] });

      // The sheet lists every dataset with its metadata.
      await visit(page, "/");
      await page.getByRole("radio", { name: "Sandbox" }).click();
      await showControls(page);
      const opener = page.getByRole("button", { name: /Open dataset/ });
      await opener.click();
      const sheet = page.getByRole("dialog", { name: "Open dataset" });
      await expect(sheet).toBeVisible();
      await expect(sheet.locator(".dataset-row")).toHaveCount(DATASETS.length);
      for (const d of DATASETS) {
        const row = sheet.locator(".dataset-row").filter({ hasText: d.title });
        await expect
          .soft(row, `${d.id}: taxa × sites, alphabet`)
          .toContainText(
            `${d.taxa} taxa × ${d.sites} sites · ${d.alphabet === "dna" ? "DNA" : "protein"}`,
          );
        await expect.soft(row, `${d.id}: license`).toContainText(d.license);
        await expect.soft(row, `${d.id}: source`).toContainText("Source:");
        const href = await row.locator("a.dataset-prov").getAttribute("href");
        expect.soft(href, `${d.id}: provenance link`).not.toBeNull();
        if (href !== null) {
          const prov = await request.get(new URL(href, page.url()).toString());
          expect
            .soft(prov.ok(), `${d.id}: provenance link resolves`)
            .toBe(true);
        }
      }
      await expectCleanLayout(page, `sheet ${w}/${theme}`);
      await shoot(page, info, "10-dataset-sheet", `${w}-${theme}`);

      // Below 1024 the sheet is full-screen; Esc closes it and returns
      // focus to the button that opened it.
      if (w < 1024) {
        const box = await sheet.boundingBox();
        expect.soft(box, "sheet has a box").not.toBeNull();
        if (box !== null) {
          expect.soft(box.width, "sheet full width").toBeGreaterThanOrEqual(w - 1);
          expect
            .soft(box.height, "sheet full height")
            .toBeGreaterThanOrEqual(HEIGHT[w] - 1);
        }
      }
      await page.keyboard.press("Escape");
      await expect(sheet).toHaveCount(0);
      // Checklist §7: "Esc closes and returns focus". Below 1024 the
      // opener sits in the Settings drawer, which the sheet closes, so
      // focus may land on the drawer's toggle — but never on <body>.
      const focused = await page.evaluate(() => {
        const a = document.activeElement;
        return a === null || a === document.body
          ? "body"
          : `${a.tagName.toLowerCase()} "${(a.textContent ?? "").trim().slice(0, 30)}"`;
      });
      expect
        .soft(focused, "after Esc, focus returns to the opener (not <body>)")
        .toMatch(/Open dataset|Settings/);

      // Every dataset loads and lays out cleanly at this width and theme.
      for (const d of DATASETS) {
        await openDataset(page, d.id);
        await expectCleanLayout(page, `${d.id} ${w}/${theme}`);
        await shoot(page, info, "10-datasets", `${d.id}-${w}-${theme}`);
      }
      done();
    });
  }
}

test("§10 opening a dataset over unsaved work asks first; declining keeps it", async ({
  page,
}) => {
  const done = watchConsole(page);
  await prime(page, "light");
  await visit(page, "/");
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await pasteImport(page, ">x1\nACGT\n>x2\nACGA\n>x3\nACGG\n");
  await page.getByRole("button", { name: /Open dataset/ }).click();
  const sheet = page.getByRole("dialog", { name: "Open dataset" });
  await sheet
    .getByRole("button", { name: new RegExp(DATASETS[0].title) })
    .click();
  await expect(sheet.getByText("Replace your unsaved work?")).toBeVisible();
  await sheet.getByRole("button", { name: "Keep my work" }).click();
  await expect(sheet.locator(".dataset-row")).toHaveCount(DATASETS.length);
  await expect(page).toHaveURL(/d=/);
  await expect(page).not.toHaveURL(/ds=/);
  done();
});

test("§10 the Licenses page names every library dataset", async ({ page }) => {
  await page.goto("/licenses.html");
  const text = await page.locator("body").innerText();
  for (const d of DATASETS) {
    expect.soft(text, `licenses.html lists ${d.id}`).toContain(d.id);
  }
});

// ---------------------------------------------------------------- §11
test("§11 16S: complete and partial-95 counts, live region, removed columns, cutoff refusals", async ({
  page,
}, info) => {
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  await openDataset(page, "16s-rrna");
  const count = page.locator(".gap-count");
  await expect(count).toHaveAttribute("aria-live", "polite");

  await page.getByRole("radio", { name: "Complete deletion" }).click();
  await expect(count).toContainText(
    "429 of 1,628 sites removed by complete deletion",
  );
  await shoot(page, info, "11-gaps", "16s-complete");

  await page.getByRole("radio", { name: "Partial deletion" }).click();
  const cutoff = page.getByLabel(/Site coverage cutoff/);
  await expect(cutoff).toHaveValue("95");
  await expect(count).toContainText(
    "334 of 1,628 sites removed by partial 95% deletion",
  );
  await shoot(page, info, "11-gaps", "16s-partial95");

  for (const bad of ["101", "2.5"]) {
    await cutoff.fill(bad);
    await expect
      .soft(page.locator(".field-error"), `cutoff ${bad} refused`)
      .toContainText("whole number from 0 to 100");
  }
  await cutoff.fill("95");
  await expect(page.locator(".field-error")).toHaveCount(0);
  done();
});

// The pair panel ("How was this distance computed?") exists in protein
// mode only (App.tsx onPickPairCell), so the removed-column marking is
// checked on globins, the gapped protein dataset — not on 16S.
test("§11 globins: the pair panel marks the columns complete deletion removed", async ({
  page,
}, info) => {
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  await openDataset(page, "globins");
  await page.getByRole("radio", { name: "Complete deletion" }).click();
  await expect(page.locator(".gap-count")).toContainText(
    "removed by complete deletion",
  );
  await page.locator('[role="gridcell"][data-i="0"][data-j="1"]').click();
  await expect(page.locator(".pair-removed-note")).toContainText(
    "Columns marked ∅ were removed by complete deletion",
  );
  expect(await page.locator(".pair-col.removed").count()).toBeGreaterThan(0);
  await shoot(page, info, "11-gaps", "globins-complete-pair-panel");
  done();
});

test("§11 a filter that removes every site, and a pair with no overlap, give messages, never NaN", async ({
  page,
}, info) => {
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  await visit(page, "/");
  await page.getByRole("radio", { name: "Sandbox" }).click();

  // Every column has one gap: pairwise works, complete deletion keeps 0.
  await pasteImport(page, ">a\n-CGT\n>b\nA-GT\n>c\nAC-T\n>d\nACG-\n");
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible();
  await page.getByRole("radio", { name: "Complete deletion" }).click();
  await expect(
    page.getByText("The gap filter removed every site").first(),
  ).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/\bNaN\b/);
  await shoot(page, info, "11-gaps", "no-sites-kept");

  // a and b share no comparable column.
  await page.getByRole("radio", { name: "Pairwise deletion" }).click();
  await pasteImport(page, ">a\nAC--\n>b\n--GT\n>c\nACGT\n");
  await expect(page.getByText(/share no comparable sites/).first()).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/\bNaN\b/);
  await shoot(page, info, "11-gaps", "insufficient-overlap");
  done();
});

// ---------------------------------------------------------------- §13
test("§13 the weak-support sample draws a weak (<50) marker", async ({
  page,
}, info) => {
  test.setTimeout(360_000);
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.goto("/?lab=mega-interpreting-support");
  await page.getByRole("link", { name: "Load this lab" }).click();
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  const controls = page.locator(".col-controls");
  await controls
    .getByRole("button", { name: "Weak-support example (DNA)" })
    .click();
  await expect(
    page
      .locator('svg[aria-label="Inferred tree"] g[data-node] > text')
      .filter({ hasText: /^[A-F]$/ }),
  ).toHaveCount(6);
  // Run from the final step, as the handout says.
  const next = page.getByRole("button", { name: "Next step" });
  while (await next.isEnabled()) await next.click();
  await controls.getByRole("button", { name: /Run bootstrap/ }).click();
  await expect(controls.getByText(/Run complete: /)).toBeVisible({
    timeout: 300_000,
  });
  await expect(
    page.locator('.tree-canvas [data-weak="true"]').first(),
  ).toBeVisible();
  await shoot(page, info, "13-support", "weak-support-sample");
  done();
});

// ---------------------------------------------------------------- §12
test.describe("§12 .meg export", () => {
  test.skip(() => !isChromium(), "downloads are saved from Chromium only");

  for (const id of ["primate-mtdna", "globins", "16s-rrna"]) {
    test(`§12 export ${id} as .meg`, async ({ page }) => {
      const done = watchConsole(page);
      await prime(page, "light");
      await openDataset(page, id);
      const dl = await exportMeg(page);
      const file = outPath("meg", `${id}.meg`);
      await dl.saveAs(file);
      const text = readFileSync(file, "utf8");
      expect(text.startsWith("#mega")).toBe(true);
      const d = DATASETS.find((x) => x.id === id);
      const taxa = text
        .split(/\r?\n/)
        .filter((l) => /^#\S/.test(l) && !/^#mega/i.test(l));
      expect.soft(taxa.length, `${id}: taxa in the .meg`).toBe(d?.taxa);
      done();
    });
  }

  test("§12 names with spaces export with underscores and a notice", async ({
    page,
  }) => {
    await prime(page, "light");
    await visit(page, "/");
    await page.getByRole("radio", { name: "Sandbox" }).click();
    await pasteImport(
      page,
      ">Homo sapiens\nACGTACGT\n>Mus musculus\nACGTACGA\n>Rattus\nACGTTCGT\n",
    );
    const dl = await exportMeg(page);
    await expect(
      page
        .locator(".export-menu .phylip-note")
        .filter({ hasText: "underscores" }),
    ).toContainText(
      "2 taxon names contain spaces; they are written with underscores",
    );
    const file = outPath("meg", "spaces-in-names.meg");
    await dl.saveAs(file);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("#Homo_sapiens");
    expect(text).toContain("#Mus_musculus");
  });
});

// ---------------------------------------------------------------- §8
interface UrlCorpus {
  cases: { name: string; url: string; errorKind: string | null }[];
}
for (const v of ["v1", "v2", "v3", "v3-matrix"]) {
  const corpus = readJson<UrlCorpus>(
    `web/src/state/__fixtures__/${v}-urls.json`,
  );
  test(`§8 every ${v} share link opens on the deploy`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    const done = watchConsole(page);
    await prime(page, "light");
    for (const c of corpus.cases) {
      await visit(page, c.url.startsWith("/") ? c.url : `/${c.url}`);
      const body = await page.locator("body").innerText();
      expect.soft(body, `${v} ${c.name}: no NaN`).not.toMatch(/\bNaN\b/);
      if (c.errorKind === null) {
        await expect
          .soft(page.locator(".toast"), `${v} ${c.name}: no restore error`)
          .toHaveCount(0);
        if (v === "v3-matrix") {
          await expect
            .soft(
              page.locator(TREE_SEL),
              `${v} ${c.name}: the tree draws`,
            )
            .toBeVisible();
        }
      }
      if (isChromium()) await shoot(page, info, `8-links-${v}`, c.name);
    }
    done();
  });
}

test("§8 every built-in lesson opens without the gap control or sandbox-only models", async ({
  page,
}) => {
  const done = watchConsole(page);
  await prime(page, "light");
  for (const id of LESSONS) {
    await visit(page, `/?lesson=${id}`);
    await expect.soft(page.locator(".toast"), `${id}: no error`).toHaveCount(0);
    await expect
      .soft(
        page.getByRole("radio", { name: "Complete deletion" }),
        `${id}: no gap control`,
      )
      .toHaveCount(0);
    const correction = page.getByLabel("Distance correction");
    if ((await correction.count()) > 0) {
      const values = await correction
        .locator("option")
        .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));
      for (const m of ["F84", "K2P_PHYLIP"]) {
        expect
          .soft(values, `${id}: no ${m} in the lesson menu`)
          .not.toContain(m);
      }
    }
  }
  done();
});

for (const lab of LABS) {
  test(`§8/§14 lab ${lab.id}: page, print view, Load this lab`, async ({
    page,
  }, info) => {
    test.setTimeout(240_000);
    const done = watchConsole(page);
    // Dark on screen: the print view must still come out light.
    await prime(page, "dark");
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto(`/?lab=${lab.id}`);
    await expect(page.locator("h1").first()).toContainText(lab.title);
    await expectCleanLayout(page, `lab ${lab.id}`);
    await shoot(page, info, "14-labs-screen", lab.id);

    await page.emulateMedia({ media: "print" });
    await expect.soft(page.locator(".lab-controls")).toBeHidden();
    await expect.soft(page.locator(".lab-nav")).toBeHidden();
    await expect.soft(page.locator(".lab-print-head")).toBeVisible();
    await expect
      .soft(page.getByRole("table", { name: /settings/i }))
      .toBeVisible();
    // spec §7.3: "About N min" is on the index card only, never on the
    // printed handout.
    await expect.soft(page.locator(".lab-minutes")).toHaveCount(0);
    const c = await printColors(page);
    expect
      .soft(c.background, "printed page is light whatever the screen theme")
      .toBeGreaterThan(0.85);
    expect.soft(c.text, "printed heading is dark").toBeLessThan(0.35);
    expect
      .soft(c.page, "paper around the handout (html, body, ancestors) is light")
      .toBeGreaterThan(0.85);
    await shoot(page, info, "14-labs-print", lab.id);
    if (isChromium()) {
      await page.pdf({
        path: outPath("print", `${lab.id}.pdf`),
        format: "A4",
        printBackground: true,
      });
    }
    await page.emulateMedia({ media: "screen" });

    await page.getByRole("link", { name: "Load this lab" }).click();
    await waitForApp(page);
    await expect
      .soft(page.locator(".toast"), "lab loads without error")
      .toHaveCount(0);
    done();
  });
}

test("§14 the lab index lists every lab and prints light", async ({
  page,
}, info) => {
  await prime(page, "dark");
  await page.goto("/?labs");
  await expect(
    page.getByRole("heading", { name: "Labs", level: 1 }),
  ).toBeVisible();
  for (const l of LABS) {
    await expect.soft(page.locator("body")).toContainText(l.title);
  }
  await expectCleanLayout(page, "lab index");
  await page.emulateMedia({ media: "print" });
  const c = await printColors(page);
  expect.soft(c.background, "printed index is light").toBeGreaterThan(0.85);
  expect.soft(c.text, "printed heading is dark").toBeLessThan(0.35);
  expect
    .soft(c.page, "paper around the index (html, body, ancestors) is light")
    .toBeGreaterThan(0.85);
  await shoot(page, info, "14-labs-print", "index");
  if (isChromium()) {
    await page.pdf({
      path: outPath("print", "labs-index.pdf"),
      format: "A4",
      printBackground: true,
    });
  }
});

// ---------------------------------------------------------------- §7
test("§7 correction menu per alphabet, κ field, protein → DNA fallback", async ({
  page,
}, info) => {
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  const menu = page.getByLabel("Distance correction");
  const values = () =>
    menu
      .locator("option")
      .evaluateAll((os) => os.map((o) => (o as HTMLOptionElement).value));

  await openDataset(page, "primate-mtdna");
  const dna = await values();
  expect.soft(dna, "DNA menu has F84").toContain("F84");
  expect.soft(dna, "DNA menu has K2P_PHYLIP").toContain("K2P_PHYLIP");
  expect.soft(dna.join(" "), "no MEGA JTT").not.toMatch(/MEGA/i);

  const kappa = page.getByRole("spinbutton", { name: "Ratio (κ)" });
  await expect.soft(kappa, "κ hidden until K2P_PHYLIP").toHaveCount(0);
  await menu.selectOption("K2P_PHYLIP");
  await expect(kappa).toBeVisible();
  await expect.soft(kappa, "κ default 2.0").toHaveValue(/^2(\.0+)?$/);
  await kappa.fill("0");
  await kappa.press("Tab");
  await expect
    .soft(page.getByText("κ must be a number greater than 0."), "κ = 0 refused")
    .toBeVisible();

  await openDataset(page, "globins");
  const protein = await values();
  expect.soft(protein, "protein menu has Poisson").toContain("Poisson");
  expect.soft(protein.join(" "), "no MEGA JTT").not.toMatch(/MEGA/i);
  await menu.selectOption("Poisson");

  // Switch to a DNA dataset through the sheet: Poisson can't apply.
  await page.getByRole("button", { name: /Open dataset/ }).click();
  const sheet = page.getByRole("dialog", { name: "Open dataset" });
  const primate = DATASETS.find((d) => d.id === "primate-mtdna");
  await sheet
    .getByRole("button", { name: new RegExp(primate?.title ?? "primate") })
    .click();
  const replace = sheet.getByRole("button", { name: /Replace/ });
  if ((await replace.count()) > 0) await replace.first().click();
  await expect(page).toHaveURL(/ds=primate-mtdna/);
  await expect
    .soft(menu, "falls back from Poisson on DNA")
    .not.toHaveValue("Poisson");
  await shoot(page, info, "7-sandbox", "protein-to-dna-fallback");
  done();
});

test("§7 .meg import: CRLF+BOM, interleaved, matrix refusal, ignored commands, line numbers", async ({
  page,
}) => {
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  await visit(page, "/");
  await page.getByRole("radio", { name: "Sandbox" }).click();
  const file = page.locator('.import-panel input[type="file"]');
  const tree = page.locator('svg[aria-label="Inferred tree"]');

  // crlf_bom.meg holds two sequences: it must parse (no line-numbered
  // error) and then meet the ordinary "Need at least 3 sequences" refusal.
  await file.setInputFiles(`${MEG_INPUTS}crlf_bom.meg`);
  await expect
    .soft(page.locator(".import-panel .error"), "crlf_bom.meg parses")
    .toContainText("Need at least 3 sequences");
  for (const ok of ["interleaved_protein.meg", "sequential_dna.meg"]) {
    await file.setInputFiles(`${MEG_INPUTS}${ok}`);
    await expect
      .soft(page.locator(".import-panel .error"), `${ok} parses`)
      .toHaveCount(0);
    await expect.soft(tree, `${ok} builds a tree`).toBeVisible();
  }
  const meg = (n: string) => readFileSync(`${MEG_INPUTS}${n}`, "utf8");
  // v1.4c: a distance-matrix .meg is detected and opens a matrix
  // session (importText routes on detectMatrixFormat before the
  // alignment parsers) instead of v1.4b's refusal.
  await pasteImport(page, meg("matrix.meg"));
  await expect.soft(tree, "matrix.meg builds a tree").toBeVisible();
  await expect
    .soft(page.locator(".alphabet-badge-label"))
    .toHaveText("Distance matrix");
  await pasteImport(page, meg("commands.meg"));
  await expect
    .soft(page.locator(".import-panel > .phylip-note"))
    .toContainText(/ignored !\w+ command/);
  await pasteImport(page, meg("unterminated_comment.meg"));
  await expect
    .soft(page.locator(".import-panel .error"))
    .toContainText("line 4");
  done();
});

// ---------------------------------------------------------------- §1
// Every committed matrix oracle through all three import routes —
// file (.phy and .meg), paste (both texts) and the typing grid. The
// grid is read back out of the sheet the file import seeds, then
// re-typed into a fresh session; every route must export the same
// Newick, so a broken parser or grid shows up as a tree mismatch.

const MATRIX_DIR = `${REPO}fixtures/inputs/matrix/`;
const MATRIX_NAMES = [
  "additive8",
  "nj_by_hand",
  "nonadditive6",
  "real12",
  "upgma_vs_nj",
  "wiki5_lower",
  "wiki5_square",
];
const TREE_SEL = 'svg[aria-label="Inferred tree"]';

type Page_ = import("@playwright/test").Page;
type Locator_ = import("@playwright/test").Locator;

/** The import panel's Distance-matrix tab, mounted and visible. */
async function matrixTab(page: Page_): Promise<Locator_> {
  await showControls(page);
  const panel = page.locator(".import-panel");
  await panel.getByRole("tab", { name: "Distance matrix" }).click();
  const mi = panel.locator(".matrix-import");
  await expect(mi).toBeVisible();
  return mi;
}

/** A lazy route (`?worksheet`, `?key`, `?library`, `?labs`, `?guide`):
 * these mount a `.lab-page` instead of `.app`, so `visit`'s app wait
 * never fires — wait for the page root and idle network instead. */
async function visitPage(page: Page_, url: string): Promise<void> {
  await page.goto(url);
  await expect(page.locator(".lab-page")).toBeVisible({ timeout: 60_000 });
  await page.waitForLoadState("networkidle");
}

/** The clicked export item's downloaded text. Downloads fire on every
 * engine; only the disk saves elsewhere are Chromium-only. */
async function downloadText(
  page: Page_,
  name: string | RegExp,
): Promise<string> {
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page
      .locator(".export-menu")
      .getByRole(
        "button",
        typeof name === "string" ? { name, exact: true } : { name },
      )
      .click(),
  ]);
  const stream = await dl.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

interface GridMatrix {
  names: string[];
  cells: { r: string; c: string; v: string }[];
}

/** Names and lower-triangle cells as the seeded grid shows them. */
async function readGrid(mi: Locator_): Promise<GridMatrix> {
  await mi.getByRole("button", { name: "Type a matrix…" }).click();
  const nameInputs = mi.locator('input[aria-label^="Taxon "]');
  const names: string[] = [];
  for (const el of await nameInputs.all()) names.push(await el.inputValue());
  const cells: GridMatrix["cells"] = [];
  for (const el of await mi
    .locator('input[aria-label^="Distance between "]')
    .all()) {
    const label = (await el.getAttribute("aria-label")) ?? "";
    const m = /^Distance between (.+) and (.+)$/.exec(label);
    if (m === null) throw new Error(`unexpected cell label ${label}`);
    cells.push({ r: m[1], c: m[2], v: await el.inputValue() });
  }
  await mi.getByLabel("Close the matrix grid").click();
  return { names, cells };
}

/** Type `m` into a fresh session's grid and press Build tree. */
async function typeGrid(mi: Locator_, m: GridMatrix): Promise<void> {
  await mi.getByRole("button", { name: "Type a matrix…" }).click();
  const have = await mi.locator('input[aria-label^="Taxon "]').count();
  for (let i = have; i < m.names.length; i++) {
    await mi.getByRole("button", { name: "Add taxon" }).click();
  }
  for (const [i, n] of m.names.entries()) {
    await mi.getByLabel(`Taxon ${i + 1} name`, { exact: true }).fill(n);
  }
  for (const { r, c, v } of m.cells) {
    await mi
      .getByLabel(`Distance between ${r} and ${c}`, { exact: true })
      .fill(v);
  }
  await mi.getByRole("button", { name: "Build tree" }).click();
  await mi.getByLabel("Close the matrix grid").click();
}

for (const name of MATRIX_NAMES) {
  test(`§1 oracle matrix ${name}: file, paste and grid give one tree`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    const done = watchConsole(page);
    await prime(page, "light");
    await page.setViewportSize({ width: 1280, height: 900 });
    const phy = `${MATRIX_DIR}${name}.phy`;
    const meg = `${MATRIX_DIR}${name}.meg`;
    const tree = page.locator(TREE_SEL);
    const badge = page.locator(".alphabet-badge-label");
    const expectTree = (route: string) =>
      expect.soft(tree, `${name} ${route}: a tree`).toBeVisible({
        timeout: 60_000,
      });
    const newick = () => downloadText(page, /^Newick/);

    // File route (.phy) — also read the grid the import seeded for the
    // typed route below.
    await visit(page, "/?sb=1");
    let mi = await matrixTab(page);
    await mi.getByLabel("Open a matrix file").setInputFiles(phy);
    await expectTree(".phy file");
    await expect.soft(badge, "distance badge").toHaveText("Distance matrix");
    const grid = await readGrid(mi);
    const ref = await newick();

    // File route (.meg).
    await visit(page, "/?sb=1");
    mi = await matrixTab(page);
    await mi.getByLabel("Open a matrix file").setInputFiles(meg);
    await expectTree(".meg file");
    expect
      .soft(await newick(), `${name}: .meg file tree`)
      .toBe(ref);

    // Paste route, both texts.
    for (const [tag, file] of [
      ["pasted .phy", phy],
      ["pasted .meg", meg],
    ] as const) {
      await visit(page, "/?sb=1");
      mi = await matrixTab(page);
      await mi
        .getByLabel("Paste a distance matrix")
        .fill(readFileSync(file, "utf8"));
      await mi.getByRole("button", { name: "Import matrix" }).click();
      await expectTree(tag);
      expect.soft(await newick(), `${name}: ${tag} tree`).toBe(ref);
    }

    // Grid route — re-type the seeded names and cells.
    await visit(page, "/?sb=1");
    mi = await matrixTab(page);
    await typeGrid(mi, grid);
    await expectTree("typed grid");
    expect.soft(await newick(), `${name}: typed grid tree`).toBe(ref);
    if (isChromium()) await shoot(page, info, "1-matrix", name);
    done();
  });
}

// ---------------------------------------------------------------- §6
// The supplied matrix as a MEGA distance file — saved under meg/ for
// mega_verify.py, which runs MEGA-CC NJ and UPGMA on it against the
// committed fixtures/mega/matrix trees.
test.describe("§6 matrix .meg export", () => {
  test.skip(
    () => !isChromium(),
    "downloads are saved from Chromium only",
  );
  for (const name of MATRIX_NAMES) {
    test(`§6 export ${name} as matrix .meg`, async ({ page }) => {
      const done = watchConsole(page);
      await prime(page, "light");
      await page.setViewportSize({ width: 1280, height: 900 });
      await visit(page, "/?sb=1");
      const mi = await matrixTab(page);
      await mi
        .getByLabel("Open a matrix file")
        .setInputFiles(`${MATRIX_DIR}${name}.meg`);
      await expect(page.locator(TREE_SEL)).toBeVisible({ timeout: 60_000 });
      const [dl] = await Promise.all([
        page.waitForEvent("download"),
        page
          .locator(".export-menu")
          .getByRole("button", { name: "Matrix (.meg)" })
          .click(),
      ]);
      await dl.saveAs(outPath("meg", `matrix_${name}.meg`));
      const text = await dl.createReadStream().then(async (s) => {
        const chunks: Buffer[] = [];
        for await (const c of s) chunks.push(c as Buffer);
        return Buffer.concat(chunks).toString("utf8");
      });
      expect
        .soft(text, "MEGA distance header")
        .toContain("DataType=Distance");
      done();
    });
  }
});

// ---------------------------------------------------------------- §7
// A matrix session in the sandbox: the badge, the hidden alignment
// panels and their one-line replacement, the matrix-only export
// items, the non-additive notice, and the way back to an alignment
// session.
test("§7 a matrix session hides the alignment panels and restores them on leaving", async ({
  page,
}, info) => {
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  const tree = page.locator(TREE_SEL);
  await visit(page, "/?sb=1");
  const mi = await matrixTab(page);
  await mi
    .getByLabel("Open a matrix file")
    .setInputFiles(`${MATRIX_DIR}wiki5_lower.phy`);
  await expect(tree).toBeVisible({ timeout: 60_000 });
  await expect
    .soft(page.locator(".alphabet-badge-label"))
    .toHaveText("Distance matrix");
  await expect
    .soft(page.locator("body"))
    .toContainText(
      "This tree was built from a distance matrix, so there are no sequences to compare or resample.",
    );
  // Alignment-only controls are absent; matrix exports are present.
  await expect
    .soft(page.getByLabel("Distance correction"))
    .toHaveCount(0);
  const menu = page.locator(".export-menu");
  for (const item of ["Matrix (PHYLIP)", "Matrix (.meg)", "R script"]) {
    await expect
      .soft(menu.getByRole("button", { name: item, exact: true }))
      .toBeVisible();
  }
  await expect
    .soft(menu.getByRole("button", { name: /Alignment/ }))
    .toHaveCount(0);
  await expect
    .soft(menu.getByRole("button", { name: /Consensus/ }))
    .toHaveCount(0);
  await shoot(page, info, "7-matrix-session", "wiki5");

  // Importing an alignment takes the session back to the alignment UI.
  // The seq tab's file input is the one inside .import-file (the
  // matrix tab's input carries its own label).
  await page
    .locator('.import-panel .import-file input[type="file"]')
    .setInputFiles(`${MEG_INPUTS}sequential_dna.meg`);
  await expect
    .soft(page.locator(".alphabet-badge-label"))
    .toHaveText("DNA");
  await expect.soft(page.getByLabel("Distance correction")).toBeVisible();
  done();
});

// ---------------------------------------------------------------- §2
// Every built-in worksheet and answer key, both kinds. The paper set
// is the paperSheet rule (≤ 8 taxa and a printable matrix) resolved
// over the committed exercises — the fallback ids assert their own
// in-app-only message, so a drifting set flags itself here.
const PAPER_IDS = new Set([
  "bootstrap-basics",
  "cytochrome-c",
  "nj-basics",
  "nj-by-hand",
  "protein-models",
  "upgma-fails",
  "upgma-vs-nj-matrix",
  "mega-jc69-vs-k2p",
]);
const WS_IDS = [...LESSONS, ...LABS.map((l) => l.id)];

test("§2 every worksheet renders — paper sheets and in-app fallbacks", async ({
  page,
}, info) => {
  test.setTimeout(600_000);
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const id of WS_IDS) {
    await visitPage(page, `/?worksheet=${id}&kind=app`);
    await expect
      .soft(page.locator("ol.ws-items"), `${id}: in-app sheet items`)
      .toBeVisible();
    await visitPage(page, `/?worksheet=${id}&kind=paper`);
    if (PAPER_IDS.has(id)) {
      await expect
        .soft(
          page.getByRole("heading", { name: "1. The distance matrix" }),
          `${id}: paper sheet`,
        )
        .toBeVisible();
      if (isChromium()) {
        await shoot(page, info, "2-worksheets-paper", id);
      }
    } else {
      await expect
        .soft(page.locator("body"), `${id}: in-app-only message`)
        .toContainText("in-app worksheet instead");
    }
    if (isChromium()) await shoot(page, info, "2-worksheets-app", id);
  }
  done();
});

test("§2 every answer key renders — gated, both kinds", async ({
  page,
}, info) => {
  test.setTimeout(600_000);
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  // The first key of the session meets the gate; later keys in the
  // same session go straight in (§3 checks the gate itself).
  await visitPage(page, `/?key=nj-by-hand&kind=paper`);
  await page.getByRole("button", { name: "I'm an instructor" }).click();
  for (const id of WS_IDS) {
    await visitPage(page, `/?key=${id}&kind=app`);
    await expect
      .soft(page.locator("ol.ws-key-items"), `${id}: in-app key items`)
      .toBeVisible({ timeout: 90_000 });
    await visitPage(page, `/?key=${id}&kind=paper`);
    if (PAPER_IDS.has(id)) {
      await expect
        .soft(
          page.getByRole("heading", { name: "1. The distance matrix" }),
          `${id}: paper key`,
        )
        .toBeVisible();
    } else {
      await expect
        .soft(page.locator("body"), `${id}: in-app-only key`)
        .toContainText("in-app worksheet and key instead");
    }
    if (isChromium()) await shoot(page, info, "2-keys", id);
  }
  done();
});

test("§2/§14 the paper sheet and key print light; a worksheet PDF per id", async ({
  page,
}, info) => {
  const done = watchConsole(page);
  await prime(page, "dark");
  // Pre-grant the instructor flag — §3 checks the gate itself.
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("neophylo.instructor", "1");
    } catch {
      /* storage blocked — the gate shows; that is §3's check */
    }
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const id of PAPER_IDS) {
    for (const [kind, cls] of [
      ["worksheet", "paper-sheet"],
      ["key", "paper-key"],
    ] as const) {
      await visitPage(page, `/?${kind}=${id}&kind=paper`);
      await expect(
        page.getByRole("heading", { name: "1. The distance matrix" }),
      ).toBeVisible();
      await page.emulateMedia({ media: "print" });
      const c = await printColors(page);
      expect
        .soft(c.background, `${id} ${cls}: printed page is light`)
        .toBeGreaterThan(0.85);
      expect
        .soft(c.text, `${id} ${cls}: printed heading is dark`)
        .toBeLessThan(0.35);
      expect
        .soft(c.page, `${id} ${cls}: paper around it is light`)
        .toBeGreaterThan(0.85);
      await expect
        .soft(
          page.locator(".lab-nav"),
          `${id} ${cls}: controls hidden in print`,
        )
        .toBeHidden();
      // PDFs are saved from Chromium only (the sibling lab print
      // tests' rule); the media-emulation checks above run everywhere.
      if (isChromium()) {
        await page.pdf({
          path: outPath("print", `${id}-${cls}.pdf`),
          format: "A4",
          printBackground: true,
        });
      }
      await page.emulateMedia({ media: "screen" });
    }
  }
  done();
});

// ---------------------------------------------------------------- §3
test("§3 the instructor gate asks once per session; storage-blocked asks every time", async ({
  page,
  context,
}) => {
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  // First key of a fresh session: the gate shows the plain sentence.
  await visitPage(page, "/?key=nj-by-hand&kind=paper");
  const gate = page.locator(".ws-gate");
  await expect(gate).toBeVisible();
  await expect
    .soft(gate)
    .toContainText(
      "Answer keys are for instructors. Students: work the sheet first.",
    );
  await expect(page.locator("ol.ws-key-items")).toHaveCount(0);
  await page.getByRole("button", { name: "I'm an instructor" }).click();
  await expect(page.locator("ol.ws-key-items")).toBeVisible({
    timeout: 90_000,
  });
  // Same session, second key: straight in, no gate.
  await visitPage(page, "/?key=nj-basics&kind=app");
  await expect(page.locator(".ws-gate")).toHaveCount(0);
  await expect(page.locator("ol.ws-key-items")).toBeVisible({
    timeout: 90_000,
  });
  done();

  // sessionStorage blocked → the grant can't stick: every key asks.
  const done2 = watchConsole(page);
  await context.addInitScript(() => {
    Object.defineProperty(window, "sessionStorage", {
      configurable: true,
      get() {
        throw new DOMException("storage is blocked", "SecurityError");
      },
    });
  });
  await visitPage(page, "/?key=upgma-fails&kind=app");
  await expect(page.locator(".ws-gate")).toBeVisible();
  await page.getByRole("button", { name: "I'm an instructor" }).click();
  await expect(page.locator("ol.ws-key-items")).toBeVisible({
    timeout: 90_000,
  });
  await visitPage(page, "/?key=cytochrome-c&kind=app");
  await expect
    .soft(page.locator(".ws-gate"), "gate again with storage blocked")
    .toBeVisible();
  done2();
});

// ---------------------------------------------------------------- §4
for (const theme of THEMES) {
  for (const w of WIDTHS) {
    test(`§4 the library at ${w} px, ${theme}`, async ({ page }, info) => {
      test.setTimeout(120_000);
      const done = watchConsole(page);
      await prime(page, theme);
      await page.setViewportSize({ width: w, height: HEIGHT[w] });
      await visitPage(page, "/?library");
      await expect(
        page.getByRole("heading", { name: "Library", level: 1 }),
      ).toBeVisible();
      // Wait for the datasets to land before counting cards.
      const cards = page.locator(".lib-card");
      await expect
        .soft(cards, "every lesson, lab and dataset has a card")
        .toHaveCount(LESSONS.length + LABS.length + DATASETS.length);
      const byKind = (k: string) =>
        page.locator(`.lib-card[data-kind="${k}"]`);
      await expect
        .soft(byKind("lessons"), "lesson cards")
        .toHaveCount(LESSONS.length);
      await expect
        .soft(byKind("phylip"), "PHYLIP lab cards")
        .toHaveCount(LABS.filter((l) => l.tool !== "mega").length);
      await expect
        .soft(byKind("mega"), "MEGA lab cards")
        .toHaveCount(LABS.filter((l) => l.tool === "mega").length);
      await expect
        .soft(byKind("datasets"), "dataset cards")
        .toHaveCount(DATASETS.length);
      for (const group of [
        "Lessons",
        "PHYLIP labs",
        "MEGA labs",
        "Datasets",
      ]) {
        await expect
          .soft(page.getByRole("region", { name: group }))
          .toBeVisible();
      }
      // Every exercise card carries worksheet and key actions.
      await expect
        .soft(page.getByRole("link", { name: "In-app worksheet" }))
        .toHaveCount(LESSONS.length + LABS.length);
      await expect
        .soft(page.getByRole("link", { name: "Answer key" }))
        .toHaveCount(LESSONS.length + LABS.length);
      await expect
        .soft(page.getByRole("link", { name: "Open dataset" }))
        .toHaveCount(DATASETS.length);
      await expectCleanLayout(page, `library ${w} ${theme}`);
      await shoot(page, info, "4-library", `${w}-${theme}`);
      done();
    });
  }
}

test("§4 ?labs opens filtered and a filter change moves the state into ?library", async ({
  page,
}, info) => {
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1280, height: 800 });
  await visitPage(page, "/?labs");
  await expect(
    page.getByRole("heading", { name: "Labs", level: 1 }),
  ).toBeVisible();
  await expect
    .soft(page.locator(".lib-card"))
    .toHaveCount(LABS.length);
  await expect
    .soft(page.getByRole("region", { name: "Lessons" }))
    .toHaveCount(0);
  // Unchecking a type narrows to ?library&type=… (history.replaceState
  // may lag the click — wait for it).
  await page.getByLabel("PHYLIP labs").uncheck();
  await expect(page).toHaveURL(/library.*type=mega/);
  await expect(page.locator(".lib-card")).toHaveCount(
    LABS.filter((l) => l.tool === "mega").length,
  );
  await expectCleanLayout(page, "labs filter");
  await shoot(page, info, "4-library", "labs-filtered");
  done();
});

// ---------------------------------------------------------------- §5
test("§5 the instructor guide renders, its links resolve, it prints light", async ({
  page,
}, info) => {
  const done = watchConsole(page);
  await prime(page, "dark");
  await page.setViewportSize({ width: 1280, height: 900 });
  await visitPage(page, "/?guide");
  await expect(page.locator("h1").first()).toContainText(/guide/i);
  // Every internal link points at a route the app actually serves:
  // ?lesson / ?lab / ?worksheet / ?key with a known id, or a bare
  // ?library / ?labs / ?guide / ?editor route.
  const hrefs = await page
    .locator(".lab-main a[href^='?']")
    .evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  expect.soft(hrefs.length, "the guide has internal links").toBeGreaterThan(0);
  const ids = new Set([...WS_IDS, "custom"]);
  for (const href of hrefs) {
    const m = /^(\?|\/\?)([a-z]+)(?:=([^&]+))?/.exec(href);
    const named = m?.[3];
    const ok =
      m !== null &&
      (["library", "labs", "guide", "editor", "sb"].includes(m[2]) ||
        (["lesson", "lab", "worksheet", "key", "ds"].includes(m[2]) &&
          named !== undefined &&
          (ids.has(named) ||
            DATASETS.some((d) => d.id === named))));
    expect.soft(ok, `guide link ${href} resolves`).toBe(true);
  }
  // The plain caveat — the gate is a nudge, not access control.
  await expect
    .soft(page.locator("body"))
    .toContainText(/not (a |real |true )?(access control|security)/i);
  await expectCleanLayout(page, "guide");
  await shoot(page, info, "5-guide", "screen");
  await page.emulateMedia({ media: "print" });
  const c = await printColors(page);
  expect.soft(c.background, "printed guide is light").toBeGreaterThan(0.85);
  expect.soft(c.text, "printed heading is dark").toBeLessThan(0.35);
  await shoot(page, info, "5-guide", "print");
  if (isChromium()) {
    await page.pdf({
      path: outPath("print", "guide.pdf"),
      format: "A4",
      printBackground: true,
    });
  }
  await page.emulateMedia({ media: "screen" });
  done();
});
