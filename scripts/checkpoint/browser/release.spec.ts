// Release-checkpoint browser pass (docs/release-checkpoint.md, step 3).
// Runs against the deployed release candidate on Chromium, Firefox and
// WebKit. Section numbers (§) match docs/checkpoints/v1.4d-release.md;
// the carried v1.4c items keep their §1–§15 numbers (§2, §4 and §5 now
// also cover the reading sets) and the v1.4d reading checks are
// §16–§20. The generic parts (datasets, links, lessons, labs, reading
// sets, printing) read their lists from the repo, so they carry over
// to later releases.
//
// Everything it saves lands under $CHECKPOINT_OUT for the owner:
// shots/ (gallery screenshots), print/ (PDFs, Chromium), meg/ (exported
// alignments that scripts/checkpoint/mega_verify.py runs through MEGA-CC).

import { test, expect } from "@playwright/test";
import { readFileSync, readdirSync } from "node:fs";
import lzstring from "lz-string";

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
  .filter((f) => f.endsWith(".json") && !f.endsWith("schema.json"))
  .map((f) => f.replace(/\.json$/, ""));

// The reading-set registries, read from the repo like the lesson list
// (v1.4d): every shipped file under exercises/reading/ resolves on
// `?read=<id>` — trees-demo included (dev content, but it loads like
// any set) — while the library lists everything but it; the Task-12
// coverage sets open by id but are never listed.
interface ReadingSetFile {
  id: string;
  title: string;
  mode?: string;
  items: { id: string }[];
}
const SHIPPED_READING = readdirSync(`${REPO}exercises/reading`)
  .filter((f) => f.endsWith(".json"))
  .map((f) => readJson<ReadingSetFile>(`exercises/reading/${f}`))
  .sort((a, b) => a.id.localeCompare(b.id));
const COV_READING = readdirSync(`${REPO}exercises/reading/coverage`)
  .filter((f) => f.endsWith(".json") && f !== "manifest.json")
  .map((f) => readJson<ReadingSetFile>(`exercises/reading/coverage/${f}`))
  .sort((a, b) => a.id.localeCompare(b.id));
const ALL_READING = [...SHIPPED_READING, ...COV_READING];
/** The library's Tree reading cards — every shipped set but the demo. */
const LISTED_READING = SHIPPED_READING.filter((s) => s.id !== "trees-demo");

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
        preferCSSPageSize: true,
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
      preferCSSPageSize: true,
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
  // v1.4c: a distance-matrix .meg pasted into the sequences box is
  // detected and opens a matrix session (importText routes on
  // detectMatrixFormat before the alignment parsers) instead of
  // v1.4b's refusal. meg_inputs/matrix.meg is a two-taxon parser
  // input — a session needs ≥ 3 taxa, so this uses an oracle matrix.
  await pasteImport(
    page,
    readFileSync(`${MATRIX_DIR}wiki5_lower.meg`, "utf8"),
  );
  await expect.soft(tree, "wiki5_lower.meg builds a tree").toBeVisible();
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
 * never fires — wait for the page root and idle network instead.
 * Round-3 K6: let the page being LEFT settle its late Inter font
 * loads first — navigating away mid-download aborts them and Firefox
 * logs "downloadable font: download failed … status=2152398850" (the
 * §3 flake). */
async function visitPage(page: Page_, url: string): Promise<void> {
  await page
    .evaluate(() => document.fonts.ready.then(() => undefined))
    .catch(() => undefined);
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
  // The grid sheet is a lazy chunk: .all() runs on whatever is mounted
  // NOW, so wait for the first input or every read comes back empty.
  await expect(nameInputs.first()).toBeVisible();
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
  const taxonInputs = mi.locator('input[aria-label^="Taxon "]');
  // Same lazy sheet as readGrid — wait for it before counting.
  await expect(taxonInputs.first()).toBeVisible();
  const have = await taxonInputs.count();
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
  // same session go straight in (§3 checks the gate itself). Wait for
  // this key's content — not just the click — before navigating on:
  // leaving while its lesson fetch is in flight aborts the request.
  await visitPage(page, `/?key=nj-by-hand&kind=paper`);
  await page.getByRole("button", { name: "I'm an instructor" }).click();
  await expect(
    page.getByRole("heading", { name: "1. The distance matrix" }),
  ).toBeVisible({ timeout: 90_000 });
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
      // Round-3 K1: the finished tree must fit the printed page — the
      // A4 printable width is 210 mm − 2·15 mm = 180 mm ≈ 680 px at
      // 96 dpi. The screen layout stays wide on purpose: print media
      // alone must trigger the refit, exactly as page.pdf does.
      if (cls === "paper-key") {
        const tree = page.locator(".tree-canvas svg");
        await expect(tree, `${id} ${cls}: finished tree svg`).toBeVisible();
        // The width ATTRIBUTE is the figure's own geometry — a
        // refit proves the tree shrank for print, not merely that
        // CSS scaled it (which would shrink text below 12 px).
        await expect
          .poll(
            async () =>
              tree.evaluate((el) =>
                parseFloat(el.getAttribute("width") ?? "0"),
              ),
            { timeout: 10_000 },
          )
          .toBeLessThanOrEqual(681);
        const treeBox = await tree.boundingBox();
        const labels = tree.locator(
          "text:not(.support-label):not(.zero-len)",
        );
        const nLabels = await labels.count();
        expect
          .soft(nLabels, `${id} ${cls}: leaf labels present`)
          .toBeGreaterThan(0);
        for (let i = 0; i < nLabels; i += 1) {
          const bb = await labels.nth(i).boundingBox();
          if (bb === null || treeBox === null) continue;
          // Emulated print keeps the viewport layout, so measure each
          // label against the figure's own left edge, not x=0.
          expect
            .soft(
              bb.x - treeBox.x,
              `${id} ${cls}: leaf ${i} on the page (left)`,
            )
            .toBeGreaterThanOrEqual(-1);
          expect
            .soft(
              bb.x + bb.width - treeBox.x,
              `${id} ${cls}: leaf ${i} on the page (right edge)`,
            )
            .toBeLessThanOrEqual(681);
        }
      }
      // PDFs are saved from Chromium only (the sibling lab print
      // tests' rule); the media-emulation checks above run everywhere.
      if (isChromium()) {
        await page.pdf({
          path: outPath("print", `${id}-${cls}.pdf`),
          format: "A4",
          printBackground: true,
          preferCSSPageSize: true,
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
  // This key is kind=paper: the paper view is sections, so the matrix
  // heading is the rendered marker (ol.ws-key-items is the app view's).
  await expect(
    page.getByRole("heading", { name: "1. The distance matrix" }),
  ).toBeVisible({ timeout: 90_000 });
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
      // Wait for the datasets AND the reading sets to land before
      // counting cards — both lists resolve asynchronously.
      const cards = page.locator(".lib-card");
      await expect
        .soft(cards, "every lesson, lab, reading set and dataset has a card")
        .toHaveCount(
          LESSONS.length +
            LABS.length +
            LISTED_READING.length +
            DATASETS.length,
        );
      const byKind = (k: string) =>
        page.locator(`.lib-card[data-kind="${k}"]`);
      await expect
        .soft(byKind("lessons"), "lesson cards")
        .toHaveCount(LESSONS.length);
      await expect
        .soft(byKind("reading"), "reading-set cards")
        .toHaveCount(LISTED_READING.length);
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
        "Tree reading",
        "PHYLIP labs",
        "MEGA labs",
        "Datasets",
      ]) {
        await expect
          .soft(page.getByRole("region", { name: group }))
          .toBeVisible();
      }
      // Every exercise card carries worksheet and key actions: lessons
      // and labs the in-app pair, reading sets the paper pair.
      await expect
        .soft(page.getByRole("link", { name: "In-app worksheet" }))
        .toHaveCount(LESSONS.length + LABS.length);
      await expect
        .soft(page.getByRole("link", { name: "Open set" }))
        .toHaveCount(LISTED_READING.length);
      await expect
        .soft(page.getByRole("link", { name: "Paper worksheet" }))
        .toHaveCount(PAPER_IDS.size + LISTED_READING.length);
      await expect
        .soft(page.getByRole("link", { name: "Answer key" }))
        .toHaveCount(LESSONS.length + LABS.length + LISTED_READING.length);
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
  // may lag the click — wait for it). The filter shares its accessible
  // name with the group region, so ask for the checkbox by role.
  await page.getByRole("checkbox", { name: "PHYLIP labs" }).uncheck();
  await expect(page).toHaveURL(/library.*type=mega/);
  await expect(page.locator(".lib-card")).toHaveCount(
    LABS.filter((l) => l.tool === "mega").length,
  );
  await expectCleanLayout(page, "labs filter");
  await shoot(page, info, "4-library", "labs-filtered");
  done();
});

test("§4 ?library&type=reading shows only the Tree reading cards", async ({
  page,
}, info) => {
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1280, height: 800 });
  await visitPage(page, "/?library&type=reading");
  await expect(
    page.getByRole("heading", { name: "Library", level: 1 }),
  ).toBeVisible();
  // The reading list resolves asynchronously — wait for a card, then
  // count: every shipped set but trees-demo, nothing else.
  await expect(page.locator(".lib-card").first()).toBeVisible();
  await expect
    .soft(page.locator(".lib-card"), "only reading cards")
    .toHaveCount(LISTED_READING.length);
  await expect
    .soft(page.locator('.lib-card[data-kind="reading"]'))
    .toHaveCount(LISTED_READING.length);
  for (const s of LISTED_READING) {
    await expect
      .soft(page.locator("body"), `${s.id}: its card`)
      .toContainText(s.title);
  }
  await expect(
    page.getByRole("region", { name: "Tree reading" }),
  ).toBeVisible();
  await expect(page.getByRole("region", { name: "Lessons" })).toHaveCount(0);
  // Each card opens its set and offers the paper worksheet and key.
  await expect
    .soft(page.getByRole("link", { name: "Open set" }))
    .toHaveCount(LISTED_READING.length);
  await expect
    .soft(page.getByRole("link", { name: "Paper worksheet" }))
    .toHaveCount(LISTED_READING.length);
  await expect
    .soft(page.getByRole("link", { name: "Answer key" }))
    .toHaveCount(LISTED_READING.length);
  await expectCleanLayout(page, "library reading filter");
  await shoot(page, info, "4-library", "reading-filtered");
  done();
});

test('§4 the header "Reading trees" link opens the filtered library', async ({
  page,
}) => {
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  await visit(page, "/?sb=1");
  // A direct link at ≥ 1280 px; a clean sandbox goes straight through
  // (the unsaved-work question only asks when there is work to lose).
  const link = page.getByRole("link", { name: "Reading trees" });
  await expect(link).toBeVisible();
  expect(await link.getAttribute("href")).toBe("?library&type=reading");
  await link.click();
  await expect(
    page.getByRole("heading", { name: "Library", level: 1 }),
  ).toBeVisible({ timeout: 60_000 });
  await expect(page).toHaveURL(/type=reading/);
  await expect(page.locator(".lib-card").first()).toBeVisible();
  await expect
    .soft(page.locator(".lib-card"), "filtered to reading cards")
    .toHaveCount(LISTED_READING.length);
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
  // ?lesson / ?lab / ?worksheet / ?key / ?read with a known id, or a
  // bare ?library / ?labs / ?guide / ?editor route. v1.4d: reading-set
  // ids (including the coverage sets) resolve for ?read, ?worksheet
  // and ?key alike.
  const hrefs = await page
    .locator(".lab-main a[href^='?']")
    .evaluateAll((as) => as.map((a) => a.getAttribute("href") ?? ""));
  expect.soft(hrefs.length, "the guide has internal links").toBeGreaterThan(0);
  const ids = new Set([...WS_IDS, "custom"]);
  const readIds = new Set(ALL_READING.map((s) => s.id));
  for (const href of hrefs) {
    const m = /^(\?|\/\?)([a-z]+)(?:=([^&]+))?/.exec(href);
    const named = m?.[3];
    const ok =
      m !== null &&
      (["library", "labs", "guide", "editor", "sb"].includes(m[2]) ||
        (["lesson", "lab", "worksheet", "key", "ds", "read"].includes(m[2]) &&
          named !== undefined &&
          (ids.has(named) ||
            readIds.has(named) ||
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
      preferCSSPageSize: true,
    });
  }
  await page.emulateMedia({ media: "screen" });
  done();
});

// ---------------------------------------------------------------- §2
// The reading paper worksheets and keys (v1.4d Task 13, checklist §2):
// every shipped set and every coverage set gets `?worksheet=<id>
// &kind=paper` and `?key=<id>&kind=paper`. Item counts are read from
// the committed files. `kind=app` for a reading id points at the paper
// kind — a reading set's in-app work is the reading area itself.

test("§2 every reading paper worksheet renders and carries no answers", async ({
  page,
}, info) => {
  test.setTimeout(600_000);
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const set of ALL_READING) {
    await visitPage(page, `/?worksheet=${set.id}&kind=paper`);
    await expect(
      page.getByRole("heading", { name: set.title, level: 1 }),
      `${set.id}: sheet title`,
    ).toBeVisible({ timeout: 90_000 });
    await expect
      .soft(
        page.locator("ol.ws-items .ws-item"),
        `${set.id}: one block per item`,
      )
      .toHaveCount(set.items.length);
    await expect(
      page.locator(".rt-figure svg").first(),
      `${set.id}: a drawn tree`,
    ).toBeVisible();
    // The student sheet carries no key text — no answers,
    // explanations, notes or authored labels anywhere in the DOM.
    await expect(
      page.locator(".ws-answer, .ws-explain, .ws-note"),
      `${set.id}: no key text on the sheet`,
    ).toHaveCount(0);
    await expect(
      page.getByText("authored answer"),
      `${set.id}: no authored label on the sheet`,
    ).toHaveCount(0);
    expect(
      await page.locator("body").innerText(),
      `${set.id}: no NaN`,
    ).not.toMatch(/\bNaN\b/);
    // kind=app points at the paper kind — the set's in-app work is the
    // reading area itself.
    await visitPage(page, `/?worksheet=${set.id}&kind=app`);
    await expect
      .soft(page.locator("body"), `${set.id}: in-app fallback`)
      .toContainText("no in-app worksheet");
    if (isChromium()) {
      await shoot(page, info, "2-worksheets-reading", set.id);
    }
  }
  done();
});

test("§2 every reading answer key renders, gated", async ({ page }, info) => {
  test.setTimeout(600_000);
  const done = watchConsole(page);
  await prime(page, "light");
  // Pre-grant the instructor flag — §3 checks the gate itself.
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("neophylo.instructor", "1");
    } catch {
      /* storage blocked — the gate shows; that is §3's check */
    }
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const set of ALL_READING) {
    await visitPage(page, `/?key=${set.id}&kind=paper`);
    await expect(
      page.getByRole("heading", { name: /— answer key/ }),
      `${set.id}: key heading`,
    ).toBeVisible({ timeout: 90_000 });
    await expect
      .soft(
        page.locator(".ws-key-items .ws-item"),
        `${set.id}: one key block per item`,
      )
      .toHaveCount(set.items.length);
    await expect
      .soft(page.locator(".ws-answer"), `${set.id}: an answer per item`)
      .toHaveCount(set.items.length);
    await expect
      .soft(
        page.locator(".ws-explain"),
        `${set.id}: an explanation per item`,
      )
      .toHaveCount(set.items.length);
    if (isChromium()) await shoot(page, info, "2-keys-reading", set.id);
  }
  done();
});

test("§2/§14 every reading sheet and key prints light; a PDF per id", async ({
  page,
}, info) => {
  test.setTimeout(600_000);
  const done = watchConsole(page);
  await prime(page, "dark");
  // Dark on screen: the printed page must still come out light.
  await page.addInitScript(() => {
    try {
      window.sessionStorage.setItem("neophylo.instructor", "1");
    } catch {
      /* storage blocked — the gate shows; that is §3's check */
    }
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const set of ALL_READING) {
    for (const [route, marker, cls] of [
      ["worksheet", ".rt-figure svg", "read-sheet"],
      ["key", ".ws-key-items", "read-key"],
    ] as const) {
      await visitPage(page, `/?${route}=${set.id}&kind=paper`);
      await expect(
        page.locator(marker).first(),
        `${set.id} ${cls}: rendered`,
      ).toBeVisible({ timeout: 90_000 });
      await page.emulateMedia({ media: "print" });
      const c = await printColors(page);
      expect
        .soft(c.background, `${set.id} ${cls}: printed page is light`)
        .toBeGreaterThan(0.85);
      expect
        .soft(c.text, `${set.id} ${cls}: printed heading is dark`)
        .toBeLessThan(0.35);
      expect
        .soft(c.page, `${set.id} ${cls}: paper around it is light`)
        .toBeGreaterThan(0.85);
      await expect
        .soft(
          page.locator(".lab-nav"),
          `${set.id} ${cls}: controls hidden in print`,
        )
        .toBeHidden();
      // PDFs are saved from Chromium only (the sibling worksheet
      // print tests' rule); the media-emulation checks run everywhere.
      if (isChromium()) {
        await page.pdf({
          path: outPath("print", `${set.id}-${cls}.pdf`),
          format: "A4",
          printBackground: true,
          preferCSSPageSize: true,
        });
      }
      await page.emulateMedia({ media: "screen" });
    }
  }
  done();
});

// ---------------------------------------------------------------- §16
// The reading area on the deploy (v1.4d checklist §16): every shipped
// set opens on `?read=<id>` and walks to its results screen — titles
// and item counts come from the committed files. trees-demo is dev
// content but resolves like any built-in, so it is walked too. The
// five coverage sets open by id the same way; their style/feature
// coverage is §18's job.

/** `?read=`/`#r=` mount `.read-page`, not `.lab-page` — its own wait.
 * Same fonts-first settle as visitPage, so a late Inter load on the
 * page being left never aborts mid-navigation. */
async function visitReading(page: Page_, url: string): Promise<void> {
  await page
    .evaluate(() => document.fonts.ready.then(() => undefined))
    .catch(() => undefined);
  await page.goto(url);
  await expect(page.locator(".read-page")).toBeVisible({ timeout: 60_000 });
  await page.waitForLoadState("networkidle");
}

for (const set of SHIPPED_READING) {
  test(`§16 ?read=${set.id} opens and walks its ${set.items.length} items`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    const done = watchConsole(page);
    await prime(page, "light");
    await page.setViewportSize({ width: 1280, height: 900 });
    await visitReading(page, `/?read=${set.id}`);
    await expect(
      page.getByRole("heading", { name: set.title }),
      `${set.id}: its title`,
    ).toBeVisible({ timeout: 60_000 });
    for (let i = 0; i < set.items.length; i++) {
      if (i > 0) {
        await page.getByRole("button", { name: "Next" }).click();
      }
      await expect(
        page.getByText(`Question ${i + 1} of ${set.items.length}`),
        `${set.id}: item ${i + 1} header`,
      ).toBeVisible();
      await expect(
        page.locator(".rt-figure svg").first(),
        `${set.id}: item ${i + 1} draws a tree`,
      ).toBeVisible();
      expect(
        await page.locator("body").innerText(),
        `${set.id}: item ${i + 1} no NaN`,
      ).not.toMatch(/\bNaN\b/);
    }
    if (isChromium()) await shoot(page, info, "16-reading", `${set.id}-last`);
    // Every mode ends on the results screen — Finish exists in
    // practice and test alike (practice shows verdicts along the way,
    // test only here).
    await page.getByRole("button", { name: "Finish" }).click();
    await expect(
      page.getByText(
        new RegExp(`You answered \\d+ of ${set.items.length} correctly`),
      ),
      `${set.id}: results screen`,
    ).toBeVisible();
    await expectCleanLayout(page, `read ${set.id} summary`);
    if (isChromium()) {
      await shoot(page, info, "16-reading", `${set.id}-summary`);
    }
    done();
  });
}

for (const set of COV_READING) {
  test(`§16 coverage set ${set.id} opens on ?read=`, async ({
    page,
  }, info) => {
    const done = watchConsole(page);
    await prime(page, "light");
    await page.setViewportSize({ width: 1280, height: 900 });
    await visitReading(page, `/?read=${set.id}`);
    await expect(
      page.getByRole("heading", { name: set.title }),
      `${set.id}: its title`,
    ).toBeVisible({ timeout: 60_000 });
    await expect(page.getByText(/Question 1 of \d+/)).toBeVisible();
    await expect(
      page.locator(".rt-figure svg").first(),
      `${set.id}: item 1 draws a tree`,
    ).toBeVisible();
    if (isChromium()) await shoot(page, info, "16-reading", set.id);
    done();
  });
}

test("§16 an unknown ?read= id and a malformed #r= link refuse plainly", async ({
  page,
}) => {
  const done = watchConsole(page);
  await prime(page, "light");
  await visitReading(page, "/?read=no-such-set");
  await expect(
    page.getByRole("alert"),
    "unknown set id names the id",
  ).toContainText('unknown reading set "no-such-set"');
  // Each link corruption reports its own refusal — the empty fragment
  // the decompression failure, a non-JSON payload the JSON failure, a
  // well-formed link carrying a bad set the engine's InvalidReading.
  // Each gets a fresh cold load (goto("/") first): a fragment-only
  // navigation doesn't remount the page, and a user landing on a
  // corrupted link arrives cold anyway. One wart recorded in the
  // checklist's §21: a fragment lz-string can't even decode (`zzz`)
  // falls through to the generic "The NeoPhylo engine could not be
  // loaded." catch.
  for (const [frag, msg] of [
    ["#r=", "the shared set could not be decompressed"],
    [
      `#r=${lzstring.compressToEncodedURIComponent("not json")}`,
      "the shared set is not valid JSON",
    ],
    [
      `#r=${lzstring.compressToEncodedURIComponent(
        JSON.stringify({ v: 1, set: { bogus: true } }),
      )}`,
      "",
    ],
  ] as const) {
    await page.goto("/");
    await visitReading(page, `/${frag}`);
    const alert = page.getByRole("alert");
    await expect(
      alert,
      `${frag.slice(0, 30)}… refuses plainly`,
    ).toBeVisible();
    if (msg !== "") await expect(alert).toContainText(msg);
    else
      // A well-formed link carrying a bad set reports the engine's
      // InvalidReading — `field: msg` — not the generic catches.
      await expect(alert).toContainText(/:|\bread\b|\blink\b/);
  }
  done();
});

// ---------------------------------------------------------------- §17
// The input matrix (v1.4d checklist §17): every listed set — the four
// lessons and forms A/B — on a phone and a tablet with real touch
// taps, and every set completable by keyboard alone. The laptop,
// mouse-only leg is the §16 walk itself (mouse clicks at 1280 px);
// NVDA stays the owner's item.

/** The four lessons plus forms A and B — the listed sets. */
const DEVICE_SETS = LISTED_READING;

/** Answer item 1 where a plain control allows it: a radio or a
 * checkbox takes a tap or a Space; a tree hit pad takes a tap or an
 * Enter — the same gesture the student makes. */
async function answerItem1(page: Page_, how: "tap" | "key"): Promise<void> {
  const radio = page.getByRole("radio").first();
  if ((await radio.count()) > 0) {
    if (how === "tap") await radio.tap();
    else await radio.press(" ");
    return;
  }
  const box = page.getByRole("checkbox").first();
  if ((await box.count()) > 0) {
    if (how === "tap") await box.tap();
    else await box.press(" ");
    return;
  }
  const hit = page.locator(".rt-hit").first();
  if ((await hit.count()) > 0) {
    if (how === "tap") await hit.tap();
    else await hit.press("Enter");
  }
}

for (const [device, vp] of [
  ["phone", { width: 360, height: 740 }],
  ["tablet", { width: 768, height: 1024 }],
] as const) {
  test.describe(`§17 ${device} (touch only)`, () => {
    test.use({ hasTouch: true, viewport: vp });
    for (const set of DEVICE_SETS) {
      test(`§17 ${set.id} on a ${device} (${vp.width}px, taps only)`, async ({
        page,
      }, info) => {
        test.setTimeout(300_000);
        const done = watchConsole(page);
        await prime(page, "light");
        // Pin that the emulation really presents a coarse pointer —
        // else the ≥40px pads under test never appear.
        expect(
          await page.evaluate(() =>
            window.matchMedia("(pointer: coarse)").matches,
          ),
          "the emulation presents a coarse pointer",
        ).toBe(true);
        await visitReading(page, `/?read=${set.id}`);
        await expect(page.getByText(/Question 1 of/)).toBeVisible({
          timeout: 60_000,
        });
        // Every hit pad on item 1 is ≥ 40×40 under (pointer: coarse).
        for (const sel of [".rt-hit", ".rt-point-hit", ".rt-branch-hit"]) {
          for (const el of await page.locator(`.rt-figure ${sel}`).all()) {
            const b = await el.boundingBox();
            expect(
              b !== null && b.width >= 40 && b.height >= 40,
              `${set.id}: ${sel} pad is ${b?.width}×${b?.height}`,
            ).toBe(true);
          }
        }
        // A real tap answers item 1 where the control allows it, and
        // the verdict arrives by tap too on a practice set.
        await answerItem1(page, "tap");
        if (set.mode !== "test") {
          const check = page.getByRole("button", { name: "Check" });
          if (await check.isEnabled()) {
            await check.tap();
            await expect(
              page.getByRole("status", { name: "Verdict" }),
              `${set.id}: a verdict by tap`,
            ).toBeVisible();
          }
        }
        await expectCleanLayout(page, `${set.id} ${device}`);
        if (isChromium()) {
          await shoot(page, info, "17-devices", `${set.id}-${device}`);
        }
        // Tap through the rest of the set to the results screen.
        for (let i = 1; i < set.items.length; i++) {
          await page.getByRole("button", { name: "Next" }).tap();
          await expect(
            page.getByText(`Question ${i + 1} of`),
            `${set.id}: tap Next to item ${i + 1}`,
          ).toBeVisible();
        }
        await page.getByRole("button", { name: "Finish" }).tap();
        await expect(
          page.getByText(
            new RegExp(`You answered \\d+ of ${set.items.length}`),
          ),
          `${set.id}: reached the results by taps`,
        ).toBeVisible();
        done();
      });
    }
  });
}

test("§17 every lesson and form completes by keyboard alone", async ({
  page,
}) => {
  test.setTimeout(300_000);
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  for (const set of DEVICE_SETS) {
    await visitReading(page, `/?read=${set.id}`);
    await expect(page.getByText(/Question 1 of/)).toBeVisible({
      timeout: 60_000,
    });
    // Item 1 answered by key where the control allows — a radio or a
    // checkbox takes Space, a hit pad takes Enter; a practice set's
    // verdict arrives by Enter on Check.
    await answerItem1(page, "key");
    if (set.mode !== "test") {
      const check = page.getByRole("button", { name: "Check" });
      if (await check.isEnabled()) {
        await check.press("Enter");
        await expect(
          page.getByRole("status", { name: "Verdict" }),
          `${set.id}: a verdict by keyboard`,
        ).toBeVisible();
      }
    }
    for (let i = 1; i < set.items.length; i++) {
      await page.getByRole("button", { name: "Next" }).press("Enter");
      await expect(
        page.getByText(`Question ${i + 1} of`),
        `${set.id}: Enter on Next reaches item ${i + 1}`,
      ).toBeVisible();
    }
    await page.getByRole("button", { name: "Finish" }).press("Enter");
    await expect(
      page.getByText(
        new RegExp(`You answered \\d+ of ${set.items.length}`),
      ),
      `${set.id}: reached the results by keyboard`,
    ).toBeVisible();
  }
  done();
});

// ---------------------------------------------------------------- §18
// Every drawing style in both themes (v1.4d checklist §18): the
// layout's full shape × tip-side grid — the three Shapes × four
// TipSides of ReadingStyle in web/src/layout/readingLayout.ts —
// must appear in the DOM across the shipped sets. cov-styles alone
// draws nine; cov-statements adds rectangular:down; the lessons add
// diagonal:right and rectangular:up.

const STYLE_SETS = ["cov-styles", "cov-statements", "trees-clades-traits"];
const ALL_STYLES = (["rectangular", "diagonal", "circular"] as const).flatMap(
  (shape) =>
    (["right", "up", "left", "down"] as const).map(
      (tips) => `${shape}:${tips}`,
    ),
);

for (const theme of THEMES) {
  test(`§18 all twelve drawing styles render, ${theme}`, async ({
    page,
  }, info) => {
    test.setTimeout(300_000);
    const done = watchConsole(page);
    await prime(page, theme);
    await page.setViewportSize({ width: 1280, height: 900 });
    const seen = new Set<string>();
    for (const id of STYLE_SETS) {
      const n = ALL_READING.find((s) => s.id === id)?.items.length ?? 0;
      await visitReading(page, `/?read=${id}`);
      await expect(page.getByText(/Question 1 of/)).toBeVisible({
        timeout: 60_000,
      });
      for (let i = 0; i < n; i++) {
        if (i > 0) {
          await page.getByRole("button", { name: "Next" }).click();
          await expect(
            page.getByText(`Question ${i + 1} of`),
            `${id}: item ${i + 1}`,
          ).toBeVisible();
        }
        for (const s of await page
          .locator(".rt-figure")
          .evaluateAll((fs) =>
            fs.map((f) => `${f.dataset.shape}:${f.dataset.tips}`),
          )) {
          seen.add(s);
        }
      }
      if (isChromium()) await shoot(page, info, "18-styles", `${id}-${theme}`);
    }
    expect(
      [...seen].sort(),
      `every shape × tip-side style renders (${theme})`,
    ).toEqual([...ALL_STYLES].sort());
    done();
  });
}

// ---------------------------------------------------------------- §19
// The editor's reading mode on the deploy (v1.4d checklist §19):
// build a small set — one stored tree, one item whose {set} tips are
// picked by tapping the preview — share it, and reopen the `?read=`
// link whose `#r=` fragment carries the whole set.

test("§19 the editor builds a reading set and its #r= link reopens it", async ({
  page,
}, info) => {
  test.setTimeout(300_000);
  const done = watchConsole(page);
  await prime(page, "light");
  // The editor's Share handler also tries navigator.clipboard.writeText
  // — a rejected promise there is an unhandled pageerror (the try/catch
  // around it only catches synchronous throws; recorded as a §21 wart).
  // Where the context allows it (http has no clipboard-write grant), a
  // resolved stub keeps the pageerror out so the test still proves the
  // share-notice path on every engine.
  await page.addInitScript(() => {
    try {
      Object.defineProperty(navigator.clipboard, "writeText", {
        value: () => Promise.resolve(),
        configurable: true,
      });
    } catch {
      /* no clipboard object on insecure contexts — the app's catch covers it */
    }
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("/?editor");
  await page.getByRole("radio", { name: "Tree reading set" }).click();
  await expect(
    page.getByRole("heading", { name: "Tree reading set editor" }),
  ).toBeVisible({ timeout: 60_000 });

  await page.getByRole("textbox", { name: "Set id" }).fill("checkpoint-set");
  await page
    .getByRole("textbox", { name: "Set title" })
    .fill("Checkpoint set");
  await page
    .getByRole("textbox", { name: "Summary" })
    .fill("One stored tree, one question — the checkpoint's editor pass.");
  const t1 = page.getByRole("group", { name: "Tree t1" });
  await t1.getByRole("textbox", { name: "Newick" }).fill("((a,b),(c,d));");
  await expect(
    t1.getByRole("tree", { name: "Extras for t1" }),
  ).toBeVisible();

  await page
    .getByRole("combobox", { name: "New item type" })
    .selectOption("is_clade");
  await page.getByRole("button", { name: "Add item" }).click();
  const q1 = page.getByRole("group", { name: "Item q1" });
  await q1
    .getByRole("textbox", { name: "Question text" })
    .fill("Are {set} a clade in this tree?");
  for (const t of ["a", "b"]) {
    await q1
      .locator(
        `.rt-hit[data-kind="tip"][data-clade='${JSON.stringify([t])}']`,
      )
      .click();
  }
  // The engine's answer readout shows once the item is bound.
  await expect(q1.getByText(/^Answer:/)).toBeVisible();

  const share = page.getByRole("button", { name: "Share link" });
  await expect(share, "the set loads, so Share is live").toBeEnabled();
  await share.click();
  const url = await page
    .getByRole("textbox", { name: "Share link URL" })
    .inputValue();
  expect(url, "the share link carries an #r= set").toContain("#r=");
  if (isChromium()) await shoot(page, info, "19-editor", "reading-set");

  // Reopen the link: the reading area mounts the same set.
  await visitReading(page, url);
  await expect(
    page.getByRole("heading", { name: "Checkpoint set" }),
    "the shared set's title",
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Question 1 of 1/)).toBeVisible();
  await expect(page.locator(".rt-figure svg")).toBeVisible();
  done();
});

// ---------------------------------------------------------------- §16
// `#r=` shared links (v1.4d checklist §16): a whole set rides in
// the fragment, lz-compressed like `#x=` — decode a link built here
// the way the editor's Share writes it, and a shared set's paper
// worksheet resolves on `?worksheet=custom&kind=paper` too.

const SHARED_SET = {
  schema_version: 1,
  kind: "reading",
  id: "cp-shared",
  title: "Checkpoint shared set",
  summary: "A set carried by its #r= link.",
  mode: "practice",
  taxa_pool: {},
  trees: { t: { newick: "((a,b),(c,d));" } },
  items: [
    {
      id: "q-clade",
      text: "Are {set} a clade in this tree?",
      trees: ["t"],
      tips: ["a", "b"],
      question: { type: "is_clade" },
    },
  ],
};

test("§16 a #r= link opens its set and its custom paper worksheet", async ({
  page,
}, info) => {
  const done = watchConsole(page);
  await prime(page, "light");
  await page.setViewportSize({ width: 1280, height: 900 });
  const hash = `#r=${lzstring.compressToEncodedURIComponent(
    JSON.stringify({ v: 1, set: SHARED_SET }),
  )}`;
  await visitReading(page, `/${hash}`);
  await expect(
    page.getByRole("heading", { name: "Checkpoint shared set" }),
    "the shared set's title",
  ).toBeVisible({ timeout: 60_000 });
  await expect(page.getByText(/Question 1 of 1/)).toBeVisible();
  await expect(page.locator(".rt-figure svg")).toBeVisible();

  await visitPage(page, `/?worksheet=custom&kind=paper${hash}`);
  await expect(
    page.getByRole("heading", { name: "Checkpoint shared set", level: 1 }),
    "the shared set's paper sheet",
  ).toBeVisible({ timeout: 90_000 });
  await expect(page.locator(".rt-figure svg")).toBeVisible();
  // The sheet's own link block carries the #r= payload back.
  await expect(page.locator(".ws-link-text a")).toHaveAttribute(
    "href",
    /#r=/,
  );
  if (isChromium()) await shoot(page, info, "20-shared", "set-and-sheet");
  done();
});

// ---------------------------------------------------------------- §20
// The guide's "Known gaps" list tracks the coverage manifest
// (v1.4d checklist §5/§20): same count, same deferred-to milestones —
// a static repo check, no browser needed.

test("§20 the guide's known-gaps list matches the coverage manifest", () => {
  const manifest = readJson<{
    gaps: { format: string; deferred_to: string }[];
  }>("exercises/reading/coverage/manifest.json");
  const guide = readFileSync(`${REPO}docs/instructor-guide.md`, "utf8");
  const start = guide.indexOf("**Known gaps.**");
  expect(start, "the guide has a Known gaps list").toBeGreaterThanOrEqual(0);
  const block = guide.slice(start, guide.indexOf("\n## ", start));
  const bullets = block.match(/^- .+$/gm) ?? [];
  expect(
    bullets.length,
    "the guide lists every manifest gap",
  ).toBe(manifest.gaps.length);
  const milestones = bullets
    .map((b) => /—\s*(v[\d.x]+)/.exec(b)?.[1] ?? "")
    .sort();
  expect(
    milestones,
    "each guide gap names the manifest's deferred milestone",
  ).toEqual(manifest.gaps.map((g) => g.deferred_to).sort());
});
