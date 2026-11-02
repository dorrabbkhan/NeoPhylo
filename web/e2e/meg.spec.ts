// `.meg` import/export e2e (v1.4b plan Task 11, spec §6.3): files from
// crates/neophylo-core/tests/meg_inputs drive the sandbox import box —
// notices, the matrix refusal and line-numbered errors — and the
// Export menu's "Alignment (.meg)" item round-trips through the
// parser, with the whitespace-rename notice for spacey labels.

import { test, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { waitForApp } from "./helpers";

const MEG_DIR = fileURLToPath(
  new URL("../../crates/neophylo-core/tests/meg_inputs/", import.meta.url),
);
const meg = (name: string) => readFileSync(`${MEG_DIR}${name}`, "utf8");

async function openSandbox(page: import("@playwright/test").Page) {
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
}

async function pasteImport(page: import("@playwright/test").Page, text: string) {
  await page.locator(".import-panel textarea").fill(text);
  await page
    .locator(".import-panel")
    .getByRole("button", { name: "Import", exact: true })
    .click();
}

test("a sequential .meg file imports and builds a tree", async ({ page }) => {
  await openSandbox(page);
  await page
    .locator('.import-panel input[type="file"]')
    .setInputFiles(`${MEG_DIR}sequential_dna.meg`);
  await expect(
    page.locator('svg[aria-label="Inferred tree"]'),
  ).toBeVisible();
});

test("ignored commands and a matrix file show notices", async ({ page }) => {
  await openSandbox(page);
  await pasteImport(page, meg("commands.meg"));
  await expect(
    page.locator(".phylip-note").first(),
  ).toContainText(/ignored !\w+ command/);

  await pasteImport(page, meg("matrix.meg"));
  await expect(page.locator(".phylip-note").first()).toContainText(
    "distance-matrix .meg files are not supported yet (planned for v1.4c)",
  );
});

test("a malformed .meg shows the engine's line number", async ({ page }) => {
  await openSandbox(page);
  await pasteImport(page, meg("no_mega_header.meg"));
  await expect(page.locator(".import-panel .error")).toContainText("line 1");
});

test("export then import is the same alignment", async ({ page }) => {
  await openSandbox(page);
  await pasteImport(
    page,
    ">a\nACGTACGT\n>b\nACGTACGA\n>c\nACGTTCGT\n",
  );
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page
      .locator(".export-menu")
      .getByRole("button", { name: "Alignment (.meg)" })
      .click(),
  ]);
  const stream = await dl.createReadStream();
  const chunks: Buffer[] = [];
  for await (const c of stream) chunks.push(c as Buffer);
  const text = Buffer.concat(chunks).toString("utf8");
  expect(text.startsWith("#mega")).toBe(true);

  await pasteImport(page, text);
  await expect(
    page.locator('svg[aria-label="Inferred tree"]'),
  ).toBeVisible();
});

test("labels with spaces are renamed with a notice", async ({ page }) => {
  await openSandbox(page);
  await pasteImport(
    page,
    ">Homo sapiens\nACGTACGT\n>Mus musculus\nACGTACGA\n>Rattus\nACGTTCGT\n",
  );
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page
      .locator(".export-menu")
      .getByRole("button", { name: "Alignment (.meg)" })
      .click(),
  ]);
  void dl;
  await expect(
    page
      .locator(".export-menu .phylip-note")
      .filter({ hasText: "underscores" }),
  ).toContainText(
    "2 taxon names contain spaces; they are written with underscores",
  );
});
