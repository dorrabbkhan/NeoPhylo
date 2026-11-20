// The library end to end (v1.4c plan Task 12, spec §7.1): `?library`
// lists one card per lesson, lab and dataset, straight from the
// registries — the expected counts below are read from the exercises
// dirs and the dataset index, never re-typed. `?labs` is the same page
// pre-filtered to the two lab types; filters ride `?library&…` through
// history.replaceState and survive reload; unknown values are ignored.
// Card actions use Task 11's worksheet/key routes; datasets open
// through the `ds=` path; "prepares for / follows" comes from the
// exercise metas. The in-app Library entries (Lessons menu, More
// menu) ask "Leave your unsaved work?" before a dirty sandbox is
// left, and every control is ≥40×40 under a coarse pointer.

import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { test, expect } from "@playwright/test";

import { waitForApp } from "./helpers";

const EXERCISES = fileURLToPath(
  new URL("../../exercises/", import.meta.url),
);
const LIBRARY_INDEX = fileURLToPath(
  new URL("../public/library/index.json", import.meta.url),
);
const GAP_INPUT = fileURLToPath(
  new URL("../../fixtures/inputs/jc8_gaps.fasta", import.meta.url),
);

const LESSON_IDS = readdirSync(EXERCISES)
  .filter((f) => f.endsWith(".json") && !f.endsWith("schema.json"))
  .map((f) => f.slice(0, -".json".length))
  .sort();
const LAB_IDS = readdirSync(new URL("../../exercises/labs/", import.meta.url))
  .filter((f) => f.endsWith(".json"))
  .map((f) => f.slice(0, -".json".length))
  .sort();
const DATASETS = JSON.parse(readFileSync(LIBRARY_INDEX, "utf8")) as {
  id: string;
  title: string;
}[];

const READING_DIR = fileURLToPath(
  new URL("../../exercises/reading/", import.meta.url),
);
/** The sets the library lists — shipped files minus the dev-only
 * trees-demo (registry.ts's exclusion); the Task-12 coverage sets
 * live in a subdirectory the *.json filter never reaches. */
const READING_IDS = readdirSync(READING_DIR)
  .filter((f) => f.endsWith(".json") && f !== "trees-demo.json")
  .map((f) => f.slice(0, -".json".length))
  .sort();
/** Reading sets carry level and minutes from their meta, so the
 * intro-level filter shows the ones marked intro. */
const READING_INTRO = READING_IDS.filter(
  (id) =>
    (
      JSON.parse(readFileSync(`${READING_DIR}/${id}.json`, "utf8")) as {
        meta?: { level?: string };
      }
    ).meta?.level === "intro",
).length;

/** Each lab's title and its own settings count, read from the lab
 * files — the summaries below are checked against these, never
 * re-typed. */
const LAB_SETTINGS = new Map(
  LAB_IDS.map((id) => {
    const lab = (
      JSON.parse(
        readFileSync(`${EXERCISES}/labs/${id}.json`, "utf8"),
      ) as { lab: { title: string; settings: unknown[] } }
    ).lab;
    return [id, { title: lab.title, settings: lab.settings.length }];
  }),
);

const TOTAL =
  LESSON_IDS.length +
  LAB_IDS.length +
  READING_IDS.length +
  DATASETS.length;

/** The cards' locator — one `li` per registry item, tagged by type. */
const cards = (page: import("@playwright/test").Page, kind?: string) =>
  page.locator(
    kind === undefined ? ".lib-card" : `.lib-card[data-kind="${kind}"]`,
  );

/** Wait for every registry item's card (datasets and the worksheet
 * actions load asynchronously). */
async function allCards(page: import("@playwright/test").Page) {
  await expect(cards(page)).toHaveCount(TOTAL);
  // The paperSheet pass adds the answer-key links once every exercise
  // resolves — before it finishes the action row is incomplete.
  await expect(
    page.getByRole("link", { name: "Answer key" }),
  ).toHaveCount(LESSON_IDS.length + LAB_IDS.length);
}

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    // No neophylo-e2e flag here: the shipped-only registry keeps the
    // card counts below fully determined (labs.spec.ts owns the
    // fixture-lab behaviour). tourSeen keeps the first-visit tour out
    // of the header.
    try {
      window.localStorage.setItem("neophylo.tourSeen", "1");
    } catch {
      // storage can be blocked; the app tolerates it
    }
  });
});

test("the library lists one card per lesson, lab and dataset with the header's guide link", async ({
  page,
}) => {
  await page.goto("/?library");
  await expect(
    page.getByRole("heading", { name: "Library", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Instructor guide" }),
  ).toHaveAttribute("href", "?guide");
  for (const group of [
    "Lessons",
    "Tree reading",
    "PHYLIP labs",
    "MEGA labs",
    "Datasets",
  ]) {
    await expect(
      page.getByRole("region", { name: group }),
    ).toBeVisible();
  }
  await allCards(page);
  await expect(cards(page, "lessons")).toHaveCount(LESSON_IDS.length);
  await expect(cards(page, "reading")).toHaveCount(READING_IDS.length);
  // PHYLIP vs MEGA is read from the registry's tool field — the
  // shipped packs are dnadist/protdist/seqboot + the four MEGA
  // handouts, the counts the dirs above gave.
  await expect(cards(page, "phylip")).toHaveCount(3);
  await expect(cards(page, "mega")).toHaveCount(4);
  await expect(cards(page, "datasets")).toHaveCount(DATASETS.length);
});

test("?labs opens the library filtered to labs and keeps the short URL until a filter changes", async ({
  page,
}) => {
  await page.goto("/?labs");
  await expect(
    page.getByRole("heading", { name: "Labs", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "PHYLIP labs" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "MEGA labs" }),
  ).toBeVisible();
  await expect(
    page.getByRole("region", { name: "Lessons" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Datasets" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("heading", {
      name: "dnadist → neighbor (F84)",
      level: 3,
    }),
  ).toBeVisible();
  // `?labs` holds until the visitor changes a filter.
  expect(new URL(page.url()).search).toBe("?labs");
  await page.getByRole("checkbox", { name: "Datasets" }).check();
  await expect(page).toHaveURL(/\?library&type=phylip,mega,datasets/);
  await expect(cards(page, "datasets")).toHaveCount(DATASETS.length);
});

test("filters combine, ignore unknown values and survive a reload", async ({
  page,
}) => {
  await page.goto("/?library&type=datasets&level=bogus");
  // An unknown level is ignored — the dataset cards still show, and
  // nothing else does.
  await expect(cards(page)).toHaveCount(DATASETS.length);

  await page.goto("/?library&level=intro");
  // Only the intro lessons and intro reading sets survive — the labs
  // and datasets carry no level and are hidden by any level filter.
  await expect(cards(page).first()).toBeVisible();
  // The reading cards arrive asynchronously — wait for them before
  // the one-shot total count.
  await expect(cards(page, "reading")).toHaveCount(READING_INTRO);
  const introCount = await cards(page).count();
  expect(introCount).toBeGreaterThan(READING_INTRO);
  await expect(
    page.getByRole("region", { name: "Lessons" }),
  ).toBeVisible();
  await expect(cards(page, "lessons")).toHaveCount(
    introCount - READING_INTRO,
  );
  await expect(cards(page, "phylip")).toHaveCount(0);
  await expect(cards(page, "mega")).toHaveCount(0);
  await expect(cards(page, "datasets")).toHaveCount(0);

  // The ≤ 30 min filter narrows further and the state rides the URL.
  await page.getByRole("checkbox", { name: /30 min/ }).check();
  await expect(page).toHaveURL(/short=1/);
  await expect(page).toHaveURL(/level=intro/);
  const filtered = await cards(page).count();
  expect(filtered).toBeLessThanOrEqual(introCount);

  // The same URL on a fresh load restores the filters.
  const url = new URL(page.url());
  await page.goto(`${url.pathname}${url.search}`);
  await expect(cards(page)).toHaveCount(filtered);
});

test("unticking every type writes type=, and a reload keeps none checked with the empty line", async ({
  page,
}) => {
  await page.goto("/?library");
  await allCards(page);
  for (const name of [
    "Lessons",
    "Tree reading",
    "PHYLIP labs",
    "MEGA labs",
    "Datasets",
  ]) {
    await page.getByRole("checkbox", { name }).uncheck();
  }
  await expect(page).toHaveURL(/\?library&type=$/);
  await expect(cards(page)).toHaveCount(0);
  await expect(
    page.getByText("No items match these filters."),
  ).toBeVisible();

  // The empty selection round-trips: the reload restores no types —
  // before the fix, `type=` decoded to every type.
  await page.reload();
  for (const name of [
    "Lessons",
    "Tree reading",
    "PHYLIP labs",
    "MEGA labs",
    "Datasets",
  ]) {
    await expect(
      page.getByRole("checkbox", { name }),
    ).not.toBeChecked();
  }
  await expect(cards(page)).toHaveCount(0);
  await expect(
    page.getByText("No items match these filters."),
  ).toBeVisible();
});

test("a lesson card shows the actions; a dataset card shows only Open dataset", async ({
  page,
}) => {
  await page.goto("/?library");
  await allCards(page);

  // `has:` on the card's own h3 — hasText would also match the cards
  // that name the lesson in a prepares/follows link.
  const lesson = page.locator('.lib-card[data-kind="lessons"]', {
    has: page.getByRole("heading", {
      level: 3,
      name: "Neighbor-Joining, by hand",
    }),
  });
  await expect(
    lesson.getByRole("link", { name: "Open lesson" }),
  ).toHaveAttribute("href", "?lesson=nj-by-hand");
  await expect(
    lesson.getByRole("link", { name: "In-app worksheet" }),
  ).toHaveAttribute("href", "?worksheet=nj-by-hand&kind=app");
  // nj-by-hand is a 4-taxon exercise — the paper worksheet exists and
  // the key points at it.
  await expect(
    lesson.getByRole("link", { name: "Paper worksheet" }),
  ).toHaveAttribute("href", "?worksheet=nj-by-hand&kind=paper");
  await expect(
    lesson.getByRole("link", { name: "Answer key" }),
  ).toHaveAttribute("href", "?key=nj-by-hand&kind=paper");

  // prepares_for/follows ride the exercise metas: nj-by-hand prepares
  // for the dnadist lab; dnadist's card follows the lessons that name
  // it.
  await expect(lesson).toContainText("Prepares for:");
  const lab = page.locator('.lib-card[data-kind="phylip"]', {
    has: page.getByRole("heading", {
      level: 3,
      name: "dnadist → neighbor (F84)",
    }),
  });
  await expect(lab).toContainText("Follows:");
  await expect(
    lab.getByRole("link", { name: "Open lab" }),
  ).toHaveAttribute("href", "?lab=dnadist-neighbor");
  await expect(
    lab.getByRole("link", { name: "Answer key" }),
  ).toHaveAttribute("href", /^\?key=dnadist-neighbor&kind=/);

  const ds = page.locator('.lib-card[data-kind="datasets"]', {
    has: page.getByRole("heading", { level: 3, name: DATASETS[0].title }),
  });
  await expect(
    ds.getByRole("link", { name: "Open dataset" }),
  ).toHaveAttribute("href", `?ds=${DATASETS[0].id}`);
  await expect(
    ds.getByRole("link", { name: /worksheet|answer key/i }),
  ).toHaveCount(0);
  await expect(ds).toContainText(/\d+ taxa × \d+ sites/);
  await expect(ds).toContainText(/License:/);
});

test("the library folds each lab card's settings table behind a disclosure; ?labs keeps them open", async ({
  page,
}) => {
  await page.goto("/?library");
  await allCards(page);

  // Every lab card — and only lab cards — carries one fold, and the
  // summary counts the lab's own settings rows (owner request
  // 2026-11-17). Folded means no `open` attribute and a hidden table.
  const folds = page.locator(".lib-card details.lib-settings-details");
  await expect(folds).toHaveCount(LAB_IDS.length);
  for (const [id, lab] of LAB_SETTINGS) {
    const card = page.locator(".lib-card", {
      has: page.getByRole("heading", { level: 3, name: lab.title }),
    });
    const fold = card.locator("details.lib-settings-details");
    await expect(fold).not.toHaveAttribute("open", "");
    await expect(fold.locator("summary")).toHaveText(
      `Settings (${lab.settings} options)`,
    );
    await expect(
      fold.locator("table.lab-settings"),
      `${id}: the folded table is hidden`,
    ).toBeHidden();
    await expect(
      fold.locator(".lab-settings-scroll"),
    ).toHaveAttribute("aria-label", `${lab.title} settings`);
  }

  // The disclosure is keyboard-operable natively: Enter on the
  // focused summary reveals the table, and a click does the same on
  // the next fold. `nth` keeps each locator bound to its fold — a lazy
  // `:not([open])` query would re-resolve to the following closed fold
  // after the toggle.
  const first = folds.first();
  await first.locator("summary").press("Enter");
  await expect(first.locator("table.lab-settings")).toBeVisible();
  const second = folds.nth(1);
  await expect(second).not.toHaveAttribute("open", "");
  await second.locator("summary").click();
  await expect(second.locator("table.lab-settings")).toBeVisible();

  // ?labs keeps showing its tables, as before — no fold at all.
  await page.goto("/?labs");
  await expect(
    page.getByRole("heading", { name: "Labs", exact: true }),
  ).toBeVisible();
  await expect(
    page.locator(".lib-card details.lib-settings-details"),
  ).toHaveCount(0);
  await expect(page.locator("table.lab-settings:visible")).toHaveCount(
    LAB_IDS.length,
  );
});

test("print emulation shows every folded settings table on ?library, and screen restores the folds", async ({
  page,
}) => {
  await page.goto("/?library");
  await allCards(page);
  await expect(page.locator("table.lab-settings:visible")).toHaveCount(0);

  // The print media change opens every fold for paper.
  await page.emulateMedia({ media: "print" });
  await expect(page.locator("table.lab-settings:visible")).toHaveCount(
    LAB_IDS.length,
  );

  // Back on screen the folds are restored to closed.
  await page.emulateMedia({ media: "screen" });
  await expect(page.locator("table.lab-settings:visible")).toHaveCount(0);
});

test("choosing Library over unsaved sandbox work asks first; declining keeps the work", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await page
    .locator('.import-file input[type="file"]')
    .setInputFiles(GAP_INPUT);
  // The imported 8-taxon alignment is now the unsaved work.
  await expect(page.locator(".gap-count")).toContainText("0 of 500");

  await page.getByRole("button", { name: "Lessons" }).click();
  await page.getByRole("menuitem", { name: "Library" }).click();
  await expect(
    page.getByRole("heading", { name: "Leave your unsaved work?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /keep my work/i }).click();
  // Declining keeps the imported work exactly — still on the app.
  await expect(page.locator(".gap-count")).toContainText("0 of 500");
  await expect(page.locator(".app")).toBeVisible();

  await page.getByRole("button", { name: "Lessons" }).click();
  await page.getByRole("menuitem", { name: "Library" }).click();
  await page
    .getByRole("button", { name: /leave and open the library/i })
    .click();
  await expect(
    page.getByRole("heading", { name: "Library", exact: true }),
  ).toBeVisible();
  await allCards(page);
});

test("the More menu's Library item asks the same way below 1024 px; a clean sandbox navigates directly", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 900 });
  await page.goto("/");
  await waitForApp(page);
  // Clean session: no question, straight to the library.
  await page.getByRole("button", { name: "More" }).click();
  await page.getByRole("menuitem", { name: "Library" }).click();
  await expect(
    page.getByRole("heading", { name: "Library", exact: true }),
  ).toBeVisible();
  await allCards(page);
});

test("under (pointer: coarse) every link and control on the library is ≥40×40", async ({
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
      window.localStorage.setItem("neophylo.tourSeen", "1");
    } catch {
      // storage can be blocked; the app tolerates it
    }
  });
  const page = await context.newPage();
  await page.goto("/?library");
  await expect(
    page.getByRole("heading", { name: "Library", exact: true }),
  ).toBeVisible();
  await allCards(page);
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    "the emulation presents a coarse pointer",
  ).toBe(true);

  // The settings disclosure's summary joins the ≥40×40 floor with the
  // links, buttons and filter controls (owner request 2026-11-17).
  const targets = page.locator("a, button, input, select, summary");
  const count = await targets.count();
  expect(count).toBeGreaterThan(10);
  for (let i = 0; i < count; i++) {
    const target = targets.nth(i);
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    if (box === null) continue;
    const label =
      (await target.getAttribute("aria-label")) ??
      (await target.innerText().catch(() => "")).slice(0, 40) ??
      `target ${i}`;
    // The same 0.05 unit-conversion tolerance labs.spec.ts uses —
    // Gecko reports a 40 px box as 39.99998.
    expect(
      box.width,
      `library: "${label}" ≥40 px wide (${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(39.95);
    expect(
      box.height,
      `library: "${label}" ≥40 px tall (${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(39.95);
  }
  await context.close();
});

// v1.4c Task 13 (spec §7.5): the header's guide link — shipped in
// Task 12 pointing at a route that did not exist — now opens the
// instructor guide.
test("the library's Instructor guide link opens the guide", async ({
  page,
}) => {
  await page.goto("/?library");
  await page.getByRole("link", { name: "Instructor guide" }).click();
  await expect(page).toHaveURL(/\?guide/);
  await expect(
    page.getByRole("heading", { name: "Instructor guide", level: 1 }),
  ).toBeVisible();
});

// The guide gets the same ≥40×40 coarse-pointer floor: plan items are
// whole-row block links, inline prose links grow their hit box with
// padding, and the nav/Print controls ride labs.css's own coarse
// rules.
test("under (pointer: coarse) every link and control on the guide is ≥40×40", async ({
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
      window.localStorage.setItem("neophylo.tourSeen", "1");
    } catch {
      // storage can be blocked; the app tolerates it
    }
  });
  const page = await context.newPage();
  await page.goto("/?guide");
  await expect(
    page.getByRole("heading", { name: "Instructor guide", level: 1 }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    "the emulation presents a coarse pointer",
  ).toBe(true);

  const targets = page.locator("a, button");
  const count = await targets.count();
  expect(count).toBeGreaterThan(10);
  for (let i = 0; i < count; i++) {
    const target = targets.nth(i);
    if (!(await target.isVisible())) continue;
    const box = await target.boundingBox();
    if (box === null) continue;
    const label =
      (await target.getAttribute("aria-label")) ??
      (await target.innerText().catch(() => "")).slice(0, 40) ??
      `target ${i}`;
    expect(
      box.width,
      `guide: "${label}" ≥40 px wide (${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(39.95);
    expect(
      box.height,
      `guide: "${label}" ≥40 px tall (${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(39.95);
  }
  await context.close();
});


/* ---- v1.4d Task 9: the "Tree reading" type and the header entry ---- */

test("every shipped listed reading set has exactly one card opening ?read=<id>", async ({
  page,
}) => {
  await page.goto("/?library&type=reading");
  await expect(
    page.getByRole("region", { name: "Tree reading" }),
  ).toBeVisible();
  await expect(cards(page, "reading")).toHaveCount(READING_IDS.length);
  for (const id of READING_IDS) {
    const set = JSON.parse(
      readFileSync(`${READING_DIR}/${id}.json`, "utf8"),
    ) as { title: string };
    const card = page.locator('.lib-card[data-kind="reading"]', {
      has: page.getByRole("heading", { level: 3, name: set.title }),
    });
    await expect(
      card.getByRole("link", { name: "Open set" }),
    ).toHaveAttribute("href", `?read=${id}`);
    // The worksheet and key actions stay hidden until Task 13.
    await expect(
      card.getByRole("link", { name: /worksheet|answer key/i }),
    ).toHaveCount(0);
  }
});

test("the Tree reading filter combines with the other filters and survives a reload", async ({
  page,
}) => {
  await page.goto("/?library&type=reading");
  await expect(cards(page, "reading")).toHaveCount(READING_IDS.length);
  await expect(cards(page, "lessons")).toHaveCount(0);

  await page.getByRole("checkbox", { name: "Datasets" }).check();
  await expect(page).toHaveURL(/type=reading,datasets/);
  await page.getByRole("checkbox", { name: /30 min/ }).check();
  await expect(page).toHaveURL(/short=1/);
  await page
    .getByRole("combobox", { name: /level/i })
    .selectOption("intro");
  await expect(page).toHaveURL(/level=intro/);

  // The same URL on a fresh load restores the filters.
  const url = new URL(page.url());
  await page.goto(`${url.pathname}${url.search}`);
  await expect(
    page.getByRole("checkbox", { name: "Tree reading" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Datasets" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", { name: "Lessons" }),
  ).not.toBeChecked();
});

test('the header "Reading trees" link is a plain ≥40×40 link under a coarse pointer', async ({
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
      window.localStorage.setItem("neophylo.tourSeen", "1");
    } catch {
      // storage can be blocked; the app tolerates it
    }
  });
  const page = await context.newPage();
  await page.goto("/");
  await waitForApp(page);
  const link = page.locator('header.app-header a.reading-link');
  await expect(link).toBeVisible();
  await expect(link).toHaveAttribute("href", "?library&type=reading");
  const box = await link.boundingBox();
  expect(box, "the header Reading trees link has a box").not.toBeNull();
  expect(box!.width).toBeGreaterThanOrEqual(39.95);
  expect(box!.height).toBeGreaterThanOrEqual(39.95);
  await link.click();
  await expect(page).toHaveURL(/\?library&type=reading/);
  await expect(
    page.getByRole("region", { name: "Tree reading" }),
  ).toBeVisible();
  await context.close();
});

test("the Lessons menu's Reading trees item asks over unsaved work and opens the filtered library", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await page
    .locator('.import-file input[type="file"]')
    .setInputFiles(GAP_INPUT);
  await expect(page.locator(".gap-count")).toContainText("0 of 500");

  await page.getByRole("button", { name: "Lessons" }).click();
  await page.getByRole("menuitem", { name: "Reading trees" }).click();
  await expect(
    page.getByRole("heading", { name: "Leave your unsaved work?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /keep my work/i }).click();
  await expect(page.locator(".gap-count")).toContainText("0 of 500");

  await page.getByRole("button", { name: "Lessons" }).click();
  await page.getByRole("menuitem", { name: "Reading trees" }).click();
  await page
    .getByRole("button", { name: /leave and open the library/i })
    .click();
  await expect(page).toHaveURL(/\?library&type=reading/);
  await expect(
    page.getByRole("region", { name: "Tree reading" }),
  ).toBeVisible();
});

test("the header's Reading trees link asks over unsaved work like the menus; a clean sandbox navigates directly", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await page
    .locator('.import-file input[type="file"]')
    .setInputFiles(GAP_INPUT);
  await expect(page.locator(".gap-count")).toContainText("0 of 500");

  // The ≥ 1280 header link routes a plain click through onOpenReading
  // (fix round 1), so the same sheet as the menus' items opens.
  await page.getByRole("link", { name: "Reading trees" }).click();
  await expect(
    page.getByRole("heading", { name: "Leave your unsaved work?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /keep my work/i }).click();
  await expect(page.locator(".gap-count")).toContainText("0 of 500");

  await page.getByRole("link", { name: "Reading trees" }).click();
  await page
    .getByRole("button", { name: /leave and open the library/i })
    .click();
  await expect(page).toHaveURL(/\?library&type=reading/);
  await expect(
    page.getByRole("region", { name: "Tree reading" }),
  ).toBeVisible();

  // A clean sandbox goes straight through the link with no sheet.
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("link", { name: "Reading trees" }).click();
  await expect(page).toHaveURL(/\?library&type=reading/);
  await expect(
    page.getByRole("region", { name: "Tree reading" }),
  ).toBeVisible();
});
