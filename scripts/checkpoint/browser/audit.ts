// Shared checks for the release-checkpoint browser pass
// (docs/release-checkpoint.md). Each helper records failures with
// expect.soft so one run reports every problem on a page instead of
// stopping at the first.

import { expect, test } from "@playwright/test";
import type { Page, TestInfo } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

export const OUT = process.env.CHECKPOINT_OUT ?? "checkpoint-out";

/** The repository root (browser.sh sets it; the staged copy of this file
 * does not live inside the repo). */
export const REPO = (() => {
  const r = process.env.CHECKPOINT_REPO;
  if (!r) throw new Error("CHECKPOINT_REPO is required");
  return r.endsWith("/") ? r : `${r}/`;
})();

/** Where an artifact for the owner goes: <OUT>/<kind>/<name>. */
export function outPath(kind: string, name: string): string {
  const p = join(OUT, kind, name);
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

/** Safe file-name fragment. */
export const slug = (s: string): string =>
  s.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^-|-$/g, "");

/** Mark the tour seen and pin the theme before any app script runs. */
export async function prime(
  page: Page,
  theme: "light" | "dark",
): Promise<void> {
  await page.addInitScript((t) => {
    try {
      window.localStorage.setItem("neophylo.tourSeen", "1");
      window.localStorage.setItem("neophylo.theme", t);
    } catch {
      /* storage blocked: the app falls back to light */
    }
  }, theme);
}

/** Collect console errors and uncaught page errors; call the returned
 * function at the end of the test to assert there were none. */
export function watchConsole(page: Page): () => void {
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  return () => {
    expect
      .soft(errors, "no console errors or uncaught page errors")
      .toEqual([]);
  };
}

export async function waitForApp(page: Page): Promise<void> {
  // The engine (WebAssembly) can take a while under six parallel workers.
  await expect(page.locator(".app")).toBeVisible({ timeout: 60_000 });
}

export interface LayoutReport {
  sidewaysScroll: number;
  smallText: string[];
  clippedLeaves: string[];
  overlappingLeaves: string[];
}

/** Measure the page as a reader sees it: sideways scroll, visible text
 * rendered under 12 px (SVG text scaled by its screen transform), tree
 * leaf labels outside their SVG (clipped) and leaf labels that overlap. */
export async function measureLayout(page: Page): Promise<LayoutReport> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const sidewaysScroll = doc.scrollWidth - doc.clientWidth;

    const smallText: string[] = [];
    const seen = new Set<Element>();
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
    );
    while (walker.nextNode()) {
      const node = walker.currentNode;
      const text = node.textContent?.trim() ?? "";
      const el = node.parentElement;
      if (text === "" || el === null || seen.has(el)) continue;
      seen.add(el);
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") continue;
      if (Number(cs.opacity) === 0) continue;
      const r = el.getBoundingClientRect();
      // Visually hidden (screen-reader-only) text is ≤1×1 or clipped away.
      if (r.width <= 1 || r.height <= 1) continue;
      if (cs.clip === "rect(0px, 0px, 0px, 0px)") continue;
      if (cs.clipPath === "inset(50%)") continue;
      let px = parseFloat(cs.fontSize);
      if (el instanceof SVGGraphicsElement) {
        const m = el.getScreenCTM();
        if (m !== null) px *= Math.hypot(m.a, m.b);
      }
      if (px < 11.95) {
        const cls =
          typeof el.className === "string"
            ? el.className
            : (el.className as SVGAnimatedString).baseVal;
        smallText.push(
          `${el.tagName.toLowerCase()}${cls ? "." + cls.split(/\s+/).join(".") : ""} "${text.slice(0, 40)}" ${px.toFixed(1)}px`,
        );
      }
    }

    const clippedLeaves: string[] = [];
    const overlappingLeaves: string[] = [];
    for (const svg of document.querySelectorAll<SVGSVGElement>(
      'svg[aria-label="Inferred tree"], svg[aria-label="True tree"]',
    )) {
      const box = svg.getBoundingClientRect();
      if (box.width === 0) continue;
      const labels = [
        ...svg.querySelectorAll<SVGTextElement>("g[data-node] > text"),
      ].filter((t) => (t.textContent ?? "").trim() !== "");
      const rects = labels.map((t) => ({
        name: t.textContent ?? "",
        r: t.getBoundingClientRect(),
      }));
      for (const { name, r } of rects) {
        if (
          r.left < box.left - 0.5 ||
          r.right > box.right + 0.5 ||
          r.top < box.top - 0.5 ||
          r.bottom > box.bottom + 0.5
        ) {
          clippedLeaves.push(name);
        }
      }
      for (let i = 0; i < rects.length; i++) {
        for (let j = i + 1; j < rects.length; j++) {
          const a = rects[i].r;
          const b = rects[j].r;
          const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
          const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
          if (ox > 1 && oy > 1) {
            overlappingLeaves.push(`${rects[i].name} × ${rects[j].name}`);
          }
        }
      }
    }
    return {
      sidewaysScroll,
      smallText: smallText.slice(0, 25),
      clippedLeaves,
      overlappingLeaves: overlappingLeaves.slice(0, 25),
    };
  });
}

/** Soft-assert the layout rules of the UI checklist. */
export async function expectCleanLayout(
  page: Page,
  where: string,
): Promise<void> {
  const r = await measureLayout(page);
  expect
    .soft(r.sidewaysScroll, `${where}: no sideways page scroll`)
    .toBeLessThanOrEqual(0);
  expect.soft(r.smallText, `${where}: all visible text ≥ 12 px`).toEqual([]);
  expect.soft(r.clippedLeaves, `${where}: no clipped leaf labels`).toEqual([]);
  expect
    .soft(r.overlappingLeaves, `${where}: no overlapping leaf labels`)
    .toEqual([]);
}

/** Full-page screenshot for the owner's gallery, named per browser. */
export async function shoot(
  page: Page,
  info: TestInfo,
  section: string,
  name: string,
): Promise<void> {
  const file = outPath(
    "shots",
    `${slug(section)}/${slug(name)}--${info.project.name}.png`,
  );
  await page.screenshot({ path: file, fullPage: true });
}

/** At narrower layouts the sandbox controls live in the Settings drawer:
 * open it when the import panel isn't on screen. */
export async function showControls(page: Page): Promise<void> {
  if (await page.locator(".import-panel textarea").isVisible()) return;
  const toggle = page.getByRole("button", { name: "Settings", exact: true });
  if ((await toggle.getAttribute("aria-expanded")) !== "true") {
    await toggle.click();
  }
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
}

/** Navigate and let the page finish loading (fonts, lazy chunks), so the
 * next navigation never aborts a request — an aborted font or module load
 * logs a console error that is the checker's doing, not the app's. */
export async function visit(page: Page, url: string): Promise<void> {
  await page.goto(url);
  await waitForApp(page);
  await page.waitForLoadState("networkidle");
}

/** Open the sandbox on a library dataset by its share-link id. */
export async function openDataset(page: Page, id: string): Promise<void> {
  await visit(page, `/?sb=1&ds=${id}`);
  await expect(page.locator('svg[aria-label="Inferred tree"]')).toBeVisible({
    timeout: 60_000,
  });
}

/** Paste an alignment into the sandbox import box. */
export async function pasteImport(page: Page, text: string): Promise<void> {
  await showControls(page);
  await page.locator(".import-panel textarea").fill(text);
  await page
    .locator(".import-panel")
    .getByRole("button", { name: "Import", exact: true })
    .click();
}

/** Relative luminance (0 black … 1 white) of what is behind the page's
 * main content and of its heading text. A transparent background is the
 * paper itself, i.e. white. */
export async function printColors(
  page: Page,
): Promise<{ background: number; text: number }> {
  return page.evaluate(() => {
    const lum = (c: string): number | null => {
      const n = (c.match(/[\d.]+/g) ?? []).map(Number);
      if (n.length < 3) return null;
      if (n.length >= 4 && n[3] === 0) return null; // transparent
      return (0.2126 * n[0] + 0.7152 * n[1] + 0.0722 * n[2]) / 255;
    };
    const heading = document.querySelector("h1");
    let el: Element | null = heading;
    let background = 1;
    while (el !== null) {
      const l = lum(getComputedStyle(el).backgroundColor);
      if (l !== null) {
        background = l;
        break;
      }
      el = el.parentElement;
    }
    const text =
      heading === null ? 0 : (lum(getComputedStyle(heading).color) ?? 0);
    return { background, text };
  });
}

/** Chromium alone can print to PDF headlessly and saves the downloads. */
export const isChromium = (): boolean =>
  test.info().project.name === "chromium";
