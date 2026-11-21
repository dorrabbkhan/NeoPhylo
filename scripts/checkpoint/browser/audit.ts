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

/** Reading figures move with the 300 ms swap transition the plan gave
 * rotations (web/src/views/reading/readingHelpers.ts `anim`/`animD`):
 * an item change that re-uses a tree keeps its elements live
 * (ItemView keys ReadingTree by tree name+label), so a screenshot
 * taken right after "Next" can catch node/point dots mid-glide while
 * the edge paths have already snapped — node groups transition
 * `transform`, edges transition CSS `d`, and `d` flips discretely when
 * the path structure changes, so the two can disagree for up to
 * 300 ms. Emulating reduced motion cancels the in-flight transition
 * and makes every later relayout instant; the getAnimations poll plus
 * one frame covers whatever was still running when the emulation
 * landed. */
export async function settleReading(page: Page): Promise<void> {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          document.getAnimations().every((a) => a.playState !== "running"),
        ),
      { timeout: 10_000 },
    )
    .toBe(true);
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => resolve());
      }),
  );
}

/** A gallery shot of a page that renders reading figures — settle any
 * running swap transition first, so the owner's clipping/overlap look
 * sees the final frame and never a mid-animation one. */
export async function shootReading(
  page: Page,
  info: TestInfo,
  section: string,
  name: string,
): Promise<void> {
  await settleReading(page);
  await shoot(page, info, section, name);
}

/** How far each positioned group of the rendered reading figures sits
 * from the spot its own transform names — empty once the swap
 * transition has finished everywhere. The group's inline
 * `translate(x y)` is the position readingLayout computed (the node
 * position the component exposes in the DOM); its rendered CTM is
 * where the frame actually drew it. Mid-transition they disagree. */
export async function readingDrift(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const out: string[] = [];
    const translate = /^translate\(([-\d.eE+]+)px[,\s]+([-\d.eE+]+)px\)$/;
    for (const svg of document.querySelectorAll<SVGSVGElement>(
      ".rt-figure svg",
    )) {
      const toScreen = svg.getScreenCTM();
      if (toScreen === null) continue;
      for (const g of svg.querySelectorAll<SVGGElement>(
        ".rt-anim, .rt-hit",
      )) {
        const m = translate.exec(g.style.transform);
        if (m === null) continue;
        const want = new DOMPoint(
          Number(m[1]),
          Number(m[2]),
        ).matrixTransform(toScreen);
        const got = g.getScreenCTM();
        if (got === null) continue;
        const d = Math.hypot(want.x - got.e, want.y - got.f);
        if (d > 2) {
          out.push(`${g.getAttribute("class") ?? "?"}: ${d.toFixed(1)}px off`);
        }
      }
    }
    return out;
  });
}

/** At the wide breakpoint (≥ 1280 px) the controls column — the import
 * panel with its tab strip — is on screen; below it the same sections
 * live in the header's Settings drawer. The panel is a lazy chunk, so
 * wait for whichever the layout mounts rather than probing it once: at
 * ≥ 1280 the drawer's toggle never exists, so a check that runs before
 * the panel lands must not commit to the drawer path. */
export async function showControls(page: Page): Promise<void> {
  const panel = page.locator(".import-panel");
  const toggle = page.getByRole("button", { name: "Settings", exact: true });
  await page.waitForSelector(".import-panel, .drawer-toggle", {
    state: "visible",
    timeout: 60_000,
  });
  if (await panel.isVisible()) return;
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

/** Paste an alignment into the sandbox import box. A matrix session
 * selects the Distance matrix tab, so pick the sequences tab first. */
export async function pasteImport(page: Page, text: string): Promise<void> {
  await showControls(page);
  const panel = page.locator(".import-panel");
  const seqTab = panel.getByRole("tab", { name: "Sequences or tree" });
  if ((await seqTab.getAttribute("aria-selected")) !== "true") {
    await seqTab.click();
  }
  await panel.getByLabel("Paste sequences or a tree").fill(text);
  await panel.getByRole("button", { name: "Import", exact: true }).click();
}

/** Relative luminance (0 black … 1 white) of what is behind the page's
 * main content and of its heading text. A transparent background is the
 * paper itself, i.e. white. */
export async function printColors(
  page: Page,
): Promise<{ background: number; text: number; page: number }> {
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
    // The paper around the content: <html>, <body> and every ancestor of
    // the printed block. A dark one shows below the last line of the
    // last page (and between page blocks) even when the block is light.
    let page = 1;
    const block = document.querySelector(".lab-print") ?? heading;
    const around: Element[] = [document.documentElement, document.body];
    for (let a = block?.parentElement ?? null; a !== null; a = a.parentElement)
      around.push(a);
    for (const a of around) {
      const l = lum(getComputedStyle(a).backgroundColor);
      if (l !== null) page = Math.min(page, l);
    }
    return { background, text, page };
  });
}

/** Chromium alone can print to PDF headlessly and saves the downloads. */
export const isChromium = (): boolean =>
  test.info().project.name === "chromium";
