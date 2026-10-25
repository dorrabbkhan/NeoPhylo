// Figure-export fonts and print palette e2e (v1.3 plan Task 15,
// spec §4.3/§7.3, Review Focus 1). The exported SVG embeds the bundled
// font subsets its text needs as base64 data URIs — so the document
// renders the same faces the app drew even where none of them are
// installed — and it prints the light-theme palette by default, the
// screen theme only when "Match screen theme" is checked. Names
// outside the bundled subsets get the Review-Focus-1 warning.

import { readFile } from "node:fs/promises";

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { stepToEnd, waitForApp, waitForServiceWorkerReady } from "./helpers";

const PREVIEW_URL = "http://localhost:4174";

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("neophylo-e2e", "1");
      window.localStorage.setItem("neophylo.tourSeen", "1");
    } catch {
      // storage can be blocked; the app tolerates it
    }
  });
});

/** Click an export-menu item and return the downloaded text. */
async function download(page: Page, name: string | RegExp): Promise<string> {
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.locator(".export-menu").getByRole("button", { name }).click(),
  ]);
  return readFile((await dl.path())!, "utf8");
}

/** cytochrome-c at the final step after the seeded run (support
 * labels drawn → the export needs both bundled weights). */
async function cytcReady(page: Page): Promise<void> {
  await page.goto("/?lesson=cytochrome-c");
  await waitForApp(page);
  await stepToEnd(page);
  await page.getByRole("button", { name: /Run bootstrap/ }).click();
  await expect(
    page.locator(".bootstrap-panel [role=status]"),
  ).toContainText("Run complete", { timeout: 30_000 });
}

test("the exported SVG embeds exactly the bundled faces its text uses", async ({
  page,
}) => {
  await cytcReady(page);
  const svg = await download(page, /^SVG/);
  expect(svg).toContain("@font-face");
  expect(svg).toContain("data:font/woff2;base64,");
  // Cytochrome-c's latin names draw at weight 400 and the support
  // labels at 500: two Inter faces, no other subset, weight or family.
  expect(svg.match(/@font-face/g)).toHaveLength(2);
  expect(svg).toContain('font-family:"Inter"');
  expect(svg).toContain("font-weight:400");
  expect(svg).toContain("font-weight:500");
  expect(svg).not.toContain("font-weight:600");
  expect(svg).not.toContain("JetBrains Mono");
  expect(svg).not.toContain("U+0370");
  expect(svg).not.toContain("U+0400");
});

test("dark mode exports the light palette until Match screen theme is on", async ({
  page,
  context,
}) => {
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("neophylo.theme", "dark");
    } catch {
      // storage can be blocked; the app tolerates it
    }
  });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await stepToEnd(page);

  const box = page.getByRole("checkbox", { name: "Match screen theme" });
  await expect(box).toBeVisible();
  await expect(box).not.toBeChecked();

  // §7.3: the default is the print palette — light tokens whatever
  // the screen shows.
  const printed = await download(page, /^SVG/);
  expect(printed).toContain('stroke="#241f2e"');
  expect(printed).not.toContain('stroke="#e5e7eb"');

  await box.check();
  const matched = await download(page, /^SVG/);
  expect(matched).toContain('stroke="#e5e7eb"');
});

test("outside-subset names warn on figure export; greek names do not", async ({
  page,
}) => {
  const WARNING =
    "Some names use characters outside the bundled fonts and may look " +
    "different in other programs.";
  const fasta = (names: string[]) =>
    names
      .map((n, i) => `>${n}\nACGTACGTACGTACGTACG${"ACGT"[i % 4]}`)
      .join("\n");

  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  // 中文 (CJK), 🦋 (emoji), عربي (Arabic): no bundled subset covers them.
  await page.locator(".import-panel textarea").fill(
    fasta(["中文名", "🦋 Morpho", "عربي", "four", "five"]),
  );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await stepToEnd(page);
  await download(page, /^SVG/);
  await expect(page.getByText(WARNING)).toBeVisible();

  // Greek names sit inside the greek subset: no warning. A fresh page
  // keeps this independent of the first export's menu state.
  await page.goto("/");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await page.locator(".import-panel textarea").fill(
    fasta(["Ω", "Δ", "Ψ", "four", "five"]),
  );
  await page.getByRole("button", { name: "Import", exact: true }).click();
  await stepToEnd(page);
  await download(page, /^SVG/);
  await expect(page.getByText(WARNING)).toHaveCount(0);
});

test("the exported figure renders with only its embedded fonts", async ({
  page,
  context,
}) => {
  await cytcReady(page);

  // The in-app figure's text elements, serialized — transplanted into
  // the blocked document below, they render through the same embedded
  // faces at the same scale. Any width gap between an exported <text>
  // and its transplanted twin is then a real font difference, not a
  // cross-document artifact: getComputedTextLength pixel-fits glyph
  // advances to the svg's display scale, so lengths are only
  // comparable inside one document at one scale.
  const appTexts = await page
    .locator('svg[aria-label="Inferred tree"] text')
    .evaluateAll((els) =>
      els.map((t) => ({
        html: t.outerHTML,
        // The app's support labels get weight 500 from a CSS class —
        // outerHTML alone loses it, so carry the computed weight over.
        weight: getComputedStyle(t).fontWeight,
      })),
    );

  const svg = await download(page, /^SVG/);

  const blocked = await context.newPage();
  // Every font request dies; text may use only the embedded faces —
  // with no @font-face payload "Inter" would fall back to a generic
  // face and the widths below would diverge from the app's.
  await blocked.route("**/*", (route) =>
    route.request().resourceType() === "font"
      ? route.abort()
      : route.continue(),
  );
  await blocked.setContent(
    `<!DOCTYPE html><html><head><style>` +
      `html,body{margin:0;background:#fff}` +
      `svg text{font-family:"Inter"}` +
      `</style></head><body>${svg}</body></html>`,
  );
  const rendered = await blocked
    .locator("svg")
    .first()
    .evaluate(async (svg, appEls) => {
      await document.fonts.ready;
      const doc = new DOMParser().parseFromString(
        `<svg xmlns="http://www.w3.org/2000/svg">` +
          appEls.map((e) => e.html).join("") +
          `</svg>`,
        "image/svg+xml",
      );
      const transplanted: Record<string, number> = {};
      const els = Array.from(doc.querySelectorAll("text"));
      for (const [i, a] of els.entries()) {
        const t = svg.appendChild(
          document.adoptNode(a) as SVGTextElement,
        ) as SVGTextElement;
        t.setAttribute("font-weight", appEls[i].weight);
        transplanted[t.textContent ?? ""] = t.getComputedTextLength();
        t.remove();
      }
      return {
        inter400: document.fonts.check('12px "Inter"'),
        inter500: document.fonts.check('500 12px "Inter"'),
        transplanted,
        texts: Array.from(svg.querySelectorAll("text")).map((t) => ({
          text: t.textContent ?? "",
          size: Number(t.getAttribute("font-size") ?? "0"),
          len: t.getComputedTextLength(),
        })),
      };
    }, appTexts);
  await blocked.close();

  // The embedded faces registered in the rendered document — the data
  // URIs, not any installed or fetched font, satisfy "Inter".
  expect(rendered.inter400).toBe(true);
  expect(rendered.inter500).toBe(true);
  // Each exported label draws the same width the same <text> element
  // draws in the same document — the embedded faces are the Inter
  // subsets the app measured with, by the font-measurement contract.
  for (const got of rendered.texts) {
    const want = rendered.transplanted[got.text];
    expect(want, `app label "${got.text}"`).toBeDefined();
    expect(
      Math.abs(got.len - want),
      `"${got.text}" app ${want} vs export ${got.len}`,
    ).toBeLessThanOrEqual(0.5);
  }
});

test("an offline export still embeds the bundled fonts", async ({
  page,
  context,
  browserName,
}) => {
  // Same Chromium-only driver limitation as the other offline specs.
  test.skip(browserName !== "chromium");
  await page.goto(`${PREVIEW_URL}/?lesson=nj-basics`);
  await waitForApp(page);
  await waitForServiceWorkerReady(page);

  await context.setOffline(true);
  await expect(async () => {
    await page.reload({ timeout: 8_000 });
    await waitForApp(page);
  }).toPass({ timeout: 45_000, intervals: [500, 1_000, 2_000] });

  await stepToEnd(page);
  // The woff2 payloads come from the SW precache — the export still
  // embeds them fully offline.
  const svg = await download(page, /^SVG/);
  expect(svg).toContain("@font-face");
  expect(svg).toContain("data:font/woff2;base64,");
});
