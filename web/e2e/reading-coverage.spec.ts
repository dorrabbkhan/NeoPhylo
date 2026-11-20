// Coverage-set end-to-end (v1.4d plan Task 12, spec §8.3). Two
// checks:
//
// 1. Every coverage set named by exercises/reading/coverage/
//    manifest.json loads through `?read=` and renders each item in
//    every drawing style its manifest entries list (the styles are
//    asserted against the rendered figures' data-shape/data-tips,
//    not just the file).
// 2. The editor round trip: three coverage items of different
//    question types — is_clade on a lettered tree, pairwise
//    closest_relative on a polytomy and a trait-mark question — are
//    rebuilt through the Task-10 reading editor, saved, reloaded and
//    compared to the shipped file's engine answers.

import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

const COVERAGE_DIR = fileURLToPath(
  new URL("../../exercises/reading/coverage/", import.meta.url),
);

interface ManifestEntry {
  id: string;
  format: string;
  mirrors: string;
  items: string[];
  styles: string[];
  features: string[];
}

const manifest = JSON.parse(
  readFileSync(path.join(COVERAGE_DIR, "manifest.json"), "utf8"),
) as { entries: ManifestEntry[]; gaps: unknown[] };

// The coverage set files, read straight from disk so the spec always
// walks the shipped items.
const covSets = new Map(
  readdirSync(COVERAGE_DIR)
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .map((f) => [
      f.replace(/\.json$/, ""),
      JSON.parse(readFileSync(path.join(COVERAGE_DIR, f), "utf8")) as {
        items: { id: string }[];
      },
    ]),
);

test("coverage sets render every manifest style and feature", async ({
  page,
}) => {
  // itemStyles: `${setId}/${itemId}` -> styles its figures render in;
  // itemFeatures: the DOM hooks present in those figures.
  const itemStyles = new Map<string, Set<string>>();
  const itemFeatures = new Map<string, Set<string>>();

  for (const [id, setData] of covSets) {
    await page.goto(`/?read=${id}`);
    await expect(page.getByText(/Question 1 of/)).toBeVisible();
    for (const [i, item] of setData.items.entries()) {
      if (i > 0) {
        await page.getByRole("button", { name: "Next" }).click();
        await expect(
          page.getByText(new RegExp(`Question ${i + 1} of`)),
        ).toBeVisible();
      }
      const figures = page.locator(".rt-figure");
      await expect(figures.first().locator("svg")).toBeVisible();
      // Every figure drew edges and labelled its tips.
      expect(
        await figures.first().locator(".rt-edge").count(),
        `${id}/${item.id}: no edges drawn`,
      ).toBeGreaterThan(0);
      expect(
        await figures.first().locator(".rt-tip-label").count(),
        `${id}/${item.id}: no tip labels drawn`,
      ).toBeGreaterThan(0);
      const k = `${id}/${item.id}`;
      itemStyles.set(
        k,
        new Set(
          await figures.evaluateAll((fs) =>
            fs.map((f) => `${f.dataset.shape}:${f.dataset.tips}`),
          ),
        ),
      );
      const features = new Set<string>();
      for (const [sel, name] of [
        [".rt-badge-letter", "letters"],
        [".rt-point", "points"],
        [".rt-axis", "time-axis"],
        [".rt-mark", "marks"],
      ] as const) {
        if ((await page.locator(`.rt-figure ${sel}`).count()) > 0) {
          features.add(name);
        }
      }
      itemFeatures.set(k, features);
    }
  }

  for (const entry of manifest.entries) {
    const seenStyles = new Set<string>();
    const seenFeatures = new Set<string>();
    for (const itemId of entry.items) {
      const k = `${entry.id}/${itemId}`;
      expect(itemStyles.has(k), `${k} was never visited`).toBe(true);
      itemStyles.get(k)?.forEach((s) => seenStyles.add(s));
      itemFeatures.get(k)?.forEach((f) => seenFeatures.add(f));
    }
    for (const style of entry.styles) {
      expect(
        seenStyles.has(style),
        `${entry.id} (${entry.format}): no listed item renders in ${style}`,
      ).toBe(true);
    }
    // Branch points share the point marker; the data-side check that
    // they sit on branches lives in reading_content.rs.
    const featureSel: Record<string, string> = {
      letters: "letters",
      points: "points",
      "branch-points": "points",
      "time-axis": "time-axis",
      marks: "marks",
    };
    for (const f of entry.features) {
      const sel = featureSel[f];
      if (sel !== undefined) {
        expect(
          seenFeatures.has(sel),
          `${entry.id} (${entry.format}): no listed item shows ${f} in the DOM`,
        ).toBe(true);
      }
    }
  }
});

// --- editor round trip ---------------------------------------------------------

const LETTERS8 = "(((A,B),(C,D)),((E,F),(G,H)));";
const RODENTS = "(cat,(rabbit,((mouse,rat),squirrel,'guinea pig')));";
const BEASTIES = "((a,(b,c)),(d,e));";

const item = (page: Page, id: string) =>
  page.getByRole("group", { name: `Item ${id}` });
const treeSlot = (page: Page, name: string) =>
  page.getByRole("group", { name: `Tree ${name}` });
const tip = (scope: Locator, t: string) =>
  scope.locator(`.rt-hit[data-kind="tip"][data-clade='${JSON.stringify([t])}']`);
const branch = (scope: Locator, clade: string[]) =>
  scope.locator(
    `.rt-branch-hit[data-clade='${JSON.stringify([...clade].sort())}']`,
  );

/** The engine's `Answer:` readout inside one item's editor group. */
async function answerText(scope: Locator): Promise<string> {
  return (await scope.getByText(/^Answer:/).innerText()).trim();
}

test("editor round trip: rebuilt coverage items give the shipped answers", async ({
  page,
}) => {
  await page.goto("/?editor");
  await page.getByRole("radio", { name: "Tree reading set" }).click();
  await expect(
    page.getByRole("heading", { name: "Tree reading set editor" }),
  ).toBeVisible();

  await page.getByRole("textbox", { name: "Set id" }).fill("e2e-cov");
  await page
    .getByRole("textbox", { name: "Set title" })
    .fill("Coverage round trip");
  await page
    .getByRole("textbox", { name: "Summary" })
    .fill("Three coverage items rebuilt.");

  // Three stored trees, one per rebuilt item.
  const t1 = treeSlot(page, "t1");
  await t1.getByRole("textbox", { name: "Newick" }).fill(LETTERS8);
  await expect(
    t1.getByRole("tree", { name: "Extras for t1" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add tree" }).click();
  const t2 = treeSlot(page, "t2");
  await t2.getByRole("textbox", { name: "Newick" }).fill(RODENTS);
  await expect(
    t2.getByRole("tree", { name: "Extras for t2" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Add tree" }).click();
  const t3 = treeSlot(page, "t3");
  await t3.getByRole("textbox", { name: "Newick" }).fill(BEASTIES);
  await expect(
    t3.getByRole("tree", { name: "Extras for t3" }),
  ).toBeVisible();

  // The beasties tree carries two independent venom gains — placed by
  // tapping the extras preview's branches.
  await t3.getByRole("combobox", { name: "Tool" }).selectOption("mark");
  await t3.getByRole("textbox", { name: "Trait", exact: true }).fill("venom");
  await branch(t3, ["a"]).press("Enter");
  await t3.getByRole("button", { name: "Add mark" }).click();
  await expect(
    t3.getByText("venom gain on the branch to a"),
  ).toBeVisible();
  await branch(t3, ["d"]).press("Enter");
  await t3.getByRole("button", { name: "Add mark" }).click();
  await expect(
    t3.getByText("venom gain on the branch to d"),
  ).toBeVisible();

  const addItem = async (type: string, id: string) => {
    await page
      .getByRole("combobox", { name: "New item type" })
      .selectOption(type);
    await page.getByRole("button", { name: "Add item" }).click();
    return item(page, id);
  };

  // q1 — cov-structural/q-clade: do {E,F,G} form a clade? (no)
  const q1 = await addItem("is_clade", "q1");
  await q1
    .getByRole("textbox", { name: "Question text" })
    .fill("Do {set} form a clade?");
  await tip(q1, "E").click();
  await tip(q1, "F").click();
  await tip(q1, "G").click();
  const q1Answer = await answerText(q1);

  // q2 — cov-relatedness/q-pair-poly on the polytomy: squirrel is
  // equally close to guinea pig and mouse.
  const q2 = await addItem("closest_relative", "q2");
  await q2
    .getByRole("textbox", { name: "Question text" })
    .fill("Is {a} more closely related to {b} or to {c}?");
  await q2.getByRole("checkbox", { name: "t1" }).uncheck();
  await q2.getByRole("checkbox", { name: "t2" }).check();
  await q2
    .getByRole("combobox", { name: "Form" })
    .selectOption("pairwise");
  const pick2 = q2.getByRole("combobox", { name: "Pick by tapping" });
  await pick2.selectOption({ label: "tip {a}" });
  await tip(q2, "squirrel").click();
  await pick2.selectOption({ label: "tip {b}" });
  await tip(q2, "guinea pig").click();
  await pick2.selectOption({ label: "tip {c}" });
  await tip(q2, "mouse").click();
  const q2Answer = await answerText(q2);

  // q3 — cov-traits/q-homo on the mark-carrying tree: venom in a and d
  // arose independently.
  const q3 = await addItem("trait", "q3");
  await q3
    .getByRole("textbox", { name: "Question text" })
    .fill("Did venom arise once, or independently in x and y?");
  await q3.getByRole("checkbox", { name: "t1" }).uncheck();
  await q3.getByRole("checkbox", { name: "t3" }).check();
  await q3
    .getByRole("combobox", { name: "Ask" })
    .selectOption("homologous");
  await q3.getByRole("textbox", { name: "Trait name" }).fill("venom");
  const pick3 = q3.getByRole("combobox", { name: "Pick by tapping" });
  await pick3.selectOption({ label: "tip x" });
  await tip(q3, "a").click();
  await pick3.selectOption({ label: "tip y" });
  await tip(q3, "d").click();
  const q3Answer = await answerText(q3);

  // Save, then reload the file through the editor's Import file
  // control — the round trip must not change the engine answers.
  await expect(
    page.getByRole("button", { name: "Save file" }),
  ).toBeEnabled();
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "Save file" }).click(),
  ]);
  const saved = path.join(
    test.info().project.outputDir,
    "e2e-cov.json",
  );
  await download.saveAs(saved);
  await page.locator("#reading-import-file").setInputFiles(saved);
  await expect(page.locator(".editor-notice")).toBeVisible();

  expect(await answerText(item(page, "q1")), "q1 changed across save").toBe(
    q1Answer,
  );
  expect(await answerText(item(page, "q2")), "q2 changed across save").toBe(
    q2Answer,
  );
  expect(await answerText(item(page, "q3")), "q3 changed across save").toBe(
    q3Answer,
  );

  // The shipped coverage items must give the same engine answers as
  // the rebuilt ones. Import each shipped file through the text box.
  for (const [setId, itemId, rebuilt] of [
    ["cov-structural", "q-clade", q1Answer],
    ["cov-relatedness", "q-pair-poly", q2Answer],
    ["cov-traits", "q-homo", q3Answer],
  ] as const) {
    const shipped = readFileSync(
      path.join(COVERAGE_DIR, `${setId}.json`),
      "utf8",
    );
    await page
      .getByRole("textbox", { name: "Import a file or #r= link" })
      .fill(shipped);
    await page.getByRole("button", { name: "Import text" }).click();
    await expect(page.locator(".editor-notice")).toBeVisible();
    const shippedItem = item(page, itemId);
    await expect(shippedItem).toBeVisible();
    expect(
      await answerText(shippedItem),
      `${setId}/${itemId} answer differs from the rebuilt item`,
    ).toBe(rebuilt);
  }
});
