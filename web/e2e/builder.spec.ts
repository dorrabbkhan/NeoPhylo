// Assignment builder end-to-end (v1.5 plan Task 7, spec §6 + §9.1):
// a library card's "Make an assignment" opens the editor's Assignment
// mode on that content; three graded tasks — two prompt picks and a
// numeric — preview as three sample students side by side with
// different data and the engine's answers; Copy link produces the
// `#a=` link the student start page opens. The spec also drives the
// refusal paths (a premise that never holds, >15 tasks, a >250-char
// completion code), the fixed-data notice, and the draft restore a
// mid-build reload needs.

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

/** The exercise whose `tie_free` premise can never hold: the smallest
 *  join always has two tied pairs sharing a taxon, and a relabel or
 *  matrix shuffle keeps the same distances — every retry fails, so
 *  the variant falls back to the base (spec §5.2). */
const TIED_EXERCISE = JSON.stringify({
  schema_version: 5,
  id: "tied-matrix",
  title: "A matrix with an unbreakable tie",
  alphabet: "dna",
  premises: ["tie_free"],
  data: {
    kind: "matrix",
    names: ["A", "B", "C", "D"],
    lower: [1, 1, 5, 4, 5, 5],
    source: {
      citation: "e2e fixture — constructed for the builder spec",
      license: "CC0 1.0",
      accessions: [],
    },
  },
  analysis: { method: "NJ" },
  locked: [],
  prompts: [],
});

/** The draft a test seeds — the same shape the builder autosaves. */
function builderDraft(patch: Record<string, unknown>): string {
  return JSON.stringify({
    v: 1,
    id: "a-seeded01",
    title: "Seeded homework",
    instructions: "",
    content: { kind: "builtin", id: "nj-basics" },
    idLabel: "Student number (SIS ID)",
    customLabel: "",
    mode: "practice",
    variation: null,
    tasks: [],
    ...patch,
  });
}

/** Seed `neophylo:draft:assignment` before the app boots. */
async function seedDraft(page: Page, draftJson: string): Promise<void> {
  await page.addInitScript((json) => {
    try {
      window.localStorage.setItem("neophylo:draft:assignment", json);
    } catch {
      // storage blocked — the test asserts the page still loads
    }
  }, draftJson);
}

/** The Assignment mode, settled on nj-basics content. */
async function gotoBuilder(page: Page, url = "/?editor&assign=nj-basics") {
  await page.goto(url);
  await expect(
    page.getByRole("radio", { name: "Assignment" }),
  ).toBeChecked();
  await expect(
    page.getByRole("checkbox", {
      name: "Predict the pair joined at step 1",
    }),
  ).toBeVisible({ timeout: 15_000 });
}

test("from a library card, build a 3-task assignment, preview three students and copy the link", async ({
  page,
}) => {
  await page.goto("/?library");
  const card = page.locator(".lib-card", {
    has: page.getByRole("heading", {
      level: 3,
      name: "How Neighbor-Joining works",
    }),
  });
  await expect(card).toBeVisible();
  await card
    .getByRole("link", { name: "Make an assignment" })
    .click();
  await expect(page).toHaveURL(/[?&]assign=nj-basics/);

  // The two predict_pair prompts plus one numeric task — picked from
  // step, quantity and role selects, never JSON.
  await page
    .getByRole("checkbox", { name: "Predict the pair joined at step 1" })
    .check();
  await page
    .getByRole("checkbox", { name: "Predict the pair joined at step 3" })
    .check();
  await page.getByRole("button", { name: "Add numeric task" }).click();
  await expect(page.locator(".builder-task")).toHaveCount(3);

  // The owner's prose-names ruling (PR #187, 2026-11-25): nj-basics
  // names taxa in prompt 2's note, so variation defaults OFF —
  // enabling it warns, naming the prompt that can mismatch.
  const variation = page.getByRole("checkbox", {
    name: "Each student gets their own variation",
  });
  await expect(variation).not.toBeChecked();
  await variation.check();
  await expect(
    page.getByText(/notes name specific taxa/i),
  ).toBeVisible();
  await expect(page.getByText(/prompt 2/)).toBeVisible();

  // Three sample students — the spec's side-by-side preview: each has
  // its own data (distinct seeds) and the engine's answers for the
  // tasks.
  const samples = page.locator(".builder-sample");
  await expect(samples).toHaveCount(3);
  const prints = await samples
    .locator(".builder-sample-data")
    .allTextContents();
  expect(new Set(prints).size).toBe(3);
  for (const s of await samples.all()) {
    await expect(
      s.getByText(/Predict the pair joined at step 1/),
    ).toBeVisible();
    await expect(s.getByText(/Answer:/).first()).toBeVisible();
  }

  // Copy link → a `#a=` URL → the student start page opens it.
  await page.getByRole("button", { name: "Copy link" }).click();
  const linkField = page.getByRole("textbox", {
    name: "Assignment link",
  });
  const link = await linkField.inputValue();
  expect(link).toContain("#a=");
  await page.goto(link);
  await expect(
    page.getByRole("heading", { name: "Assignment" }),
  ).toBeVisible();
  await expect(
    page.getByText("Student assignments arrive in the next release."),
  ).toBeVisible();
});

test("a fixed-data lab tells the instructor every student gets the same data", async ({
  page,
}) => {
  // dnadist-neighbor is embedded FASTA — variation can only relabel;
  // the served numbers are identical for every student (spec §6).
  await page.goto("/?editor&assign=dnadist-neighbor");
  await expect(
    page.getByRole("radio", { name: "Assignment" }),
  ).toBeChecked();
  await expect(
    page.getByText(/every student gets the same data/i),
  ).toBeVisible({ timeout: 15_000 });
});

test("content that names no taxa defaults variation on without the warning", async ({
  page,
}) => {
  // The other half of the owner ruling: upgma-vs-nj-matrix's prose
  // names no taxa, so variation is on and no warning renders.
  await page.goto("/?editor&assign=upgma-vs-nj-matrix");
  const variation = page.getByRole("checkbox", {
    name: "Each student gets their own variation",
  });
  await expect(variation).toBeChecked({ timeout: 15_000 });
  await expect(
    page.getByText(/notes name specific taxa/i),
  ).not.toBeVisible();
});

test("a premise that never holds shows the fallback warning", async ({
  page,
}) => {
  await page.goto("/?editor&assign");
  await expect(
    page.getByRole("radio", { name: "Assignment" }),
  ).toBeChecked();
  await page
    .getByRole("combobox", { name: "Assignment content" })
    .selectOption("file");
  await page
    .getByRole("textbox", { name: "Assignment file JSON" })
    .fill(TIED_EXERCISE);
  // A variant is only built once the file carries a graded task
  // (the engine refuses 0-task assignments).
  await page.getByRole("button", { name: "Add numeric task" }).click();
  // Every sample student's variant fell back to the base exercise —
  // the preview says so instead of hiding it (spec §5.2): the section
  // warning plus a per-card badge.
  await expect(
    page.getByText(/fell back to the base/i).first(),
  ).toBeVisible({ timeout: 15_000 });
  await expect(
    page.locator(".builder-fallback", { hasText: "fell back" }),
  ).toHaveCount(3);
});

test("more than 15 graded tasks is refused with the reason", async ({
  page,
}) => {
  const tasks = Array.from({ length: 16 }, (_, i) => ({
    task: {
      kind: "numeric",
      step: (i % 5) + 1,
      quantity: "q_value",
      role: "chosen",
    },
    points: 1,
  }));
  await seedDraft(page, builderDraft({ tasks }));
  await gotoBuilder(page, "/?editor&assign");
  await expect(page.getByText(/at most 15/i)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy link" }),
  ).toBeDisabled();
});

test("a worst-case completion code over 250 characters is refused with the reason", async ({
  page,
}) => {
  const tasks = Array.from({ length: 8 }, (_, i) => ({
    task: {
      kind: "numeric",
      step: (i % 5) + 1,
      quantity: ["q_value", "branch_length", "new_distance", "corrected_distance"][
        i % 4
      ],
      role: "chosen",
    },
    points: 1,
  }));
  await seedDraft(page, builderDraft({ tasks }));
  await gotoBuilder(page, "/?editor&assign");
  await expect(page.getByText(/250/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Copy link" }),
  ).toBeDisabled();
});

test("reloading mid-build restores the draft (spec §9.1)", async ({
  page,
}) => {
  await gotoBuilder(page);
  const title = page.getByRole("textbox", { name: "Assignment title" });
  await title.fill("Homework 3");
  await page
    .getByRole("checkbox", { name: "Predict the pair joined at step 1" })
    .check();
  await page.reload();
  await expect(
    page.getByRole("radio", { name: "Assignment" }),
  ).toBeChecked();
  const restored = page.getByRole("textbox", { name: "Assignment title" });
  await expect(restored).toHaveValue("Homework 3");
  await expect(
    page.getByRole("checkbox", {
      name: "Predict the pair joined at step 1",
    }),
  ).toBeChecked();
  await expect(page.locator(".builder-task")).toHaveCount(1);
});
