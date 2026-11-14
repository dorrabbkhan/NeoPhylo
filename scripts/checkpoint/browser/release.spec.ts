// Release-checkpoint browser pass (docs/release-checkpoint.md, step 3).
// Runs against the deployed release candidate on Chromium, Firefox and
// WebKit. Section numbers (§) match docs/checkpoints/v1.4b-release.md; the
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

// ---------------------------------------------------------------- §7
for (const theme of THEMES) {
  for (const w of WIDTHS) {
    test(`§7 dataset sheet and every dataset at ${w} px, ${theme}`, async ({
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
      await shoot(page, info, "7-dataset-sheet", `${w}-${theme}`);

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
        await shoot(page, info, "7-datasets", `${d.id}-${w}-${theme}`);
      }
      done();
    });
  }
}

test("§7 opening a dataset over unsaved work asks first; declining keeps it", async ({
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

test("§7 the Licenses page names every library dataset", async ({ page }) => {
  await page.goto("/licenses.html");
  const text = await page.locator("body").innerText();
  for (const d of DATASETS) {
    expect.soft(text, `licenses.html lists ${d.id}`).toContain(d.id);
  }
});

// ---------------------------------------------------------------- §6
test("§6 16S: complete and partial-95 counts, live region, removed columns, cutoff refusals", async ({
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
  await shoot(page, info, "6-gaps", "16s-complete");

  await page.getByRole("radio", { name: "Partial deletion" }).click();
  const cutoff = page.getByLabel(/Site coverage cutoff/);
  await expect(cutoff).toHaveValue("95");
  await expect(count).toContainText(
    "334 of 1,628 sites removed by partial 95% deletion",
  );
  await shoot(page, info, "6-gaps", "16s-partial95");

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
test("§6 globins: the pair panel marks the columns complete deletion removed", async ({
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
  await shoot(page, info, "6-gaps", "globins-complete-pair-panel");
  done();
});

test("§6 a filter that removes every site, and a pair with no overlap, give messages, never NaN", async ({
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
  await shoot(page, info, "6-gaps", "no-sites-kept");

  // a and b share no comparable column.
  await page.getByRole("radio", { name: "Pairwise deletion" }).click();
  await pasteImport(page, ">a\nAC--\n>b\n--GT\n>c\nACGT\n");
  await expect(page.getByText(/share no comparable sites/).first()).toBeVisible();
  expect(await page.locator("body").innerText()).not.toMatch(/\bNaN\b/);
  await shoot(page, info, "6-gaps", "insufficient-overlap");
  done();
});

// ---------------------------------------------------------------- §4
test("§4 the weak-support sample draws a weak (<50) marker", async ({
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
  await shoot(page, info, "4-support", "weak-support-sample");
  done();
});

// ---------------------------------------------------------------- §5
test.describe("§5 .meg export", () => {
  test.skip(() => !isChromium(), "downloads are saved from Chromium only");

  for (const id of ["primate-mtdna", "globins", "16s-rrna"]) {
    test(`§5 export ${id} as .meg`, async ({ page }) => {
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

  test("§5 names with spaces export with underscores and a notice", async ({
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
for (const v of ["v1", "v2", "v3"]) {
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
  test(`§8/§10 lab ${lab.id}: page, print view, Load this lab`, async ({
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
    await shoot(page, info, "10-labs-screen", lab.id);

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
    await shoot(page, info, "10-labs-print", lab.id);
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

test("§10 the lab index lists every lab and prints light", async ({
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
  await shoot(page, info, "10-labs-print", "index");
  if (isChromium()) {
    await page.pdf({
      path: outPath("print", "labs-index.pdf"),
      format: "A4",
      printBackground: true,
    });
  }
});

// ---------------------------------------------------------------- §9
test("§9 correction menu per alphabet, κ field, protein → DNA fallback", async ({
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
  await shoot(page, info, "9-sandbox", "protein-to-dna-fallback");
  done();
});

test("§9 .meg import: CRLF+BOM, interleaved, matrix refusal, ignored commands, line numbers", async ({
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
  await pasteImport(page, meg("matrix.meg"));
  await expect
    .soft(page.locator(".phylip-note").first())
    .toContainText(
      "distance-matrix .meg files are not supported yet (planned for v1.4c)",
    );
  await pasteImport(page, meg("commands.meg"));
  await expect
    .soft(page.locator(".phylip-note").first())
    .toContainText(/ignored !\w+ command/);
  await pasteImport(page, meg("unterminated_comment.meg"));
  await expect
    .soft(page.locator(".import-panel .error"))
    .toContainText("line 4");
  done();
});
