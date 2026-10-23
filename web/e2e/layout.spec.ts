// Responsive layout e2e tests (v1.3 plan Task 9, spec §6.1–§6.2).
//
// Breakpoints: wide ≥ 1280, medium 1024–1279, narrow 768–1023,
// compact < 768 (Global Constraints). At every width the page must
// not scroll sideways, the stepper stays pinned to the bottom of the
// viewport, and every leaf label is reachable by scrolling the page
// alone — tree panels scroll horizontally only when a figure is
// genuinely wider than its column. At medium the controls column
// stays left of the center (the wide arrangement minus the third
// column; the explanation moves below the center content) — the
// owner-chosen §6.1 medium until Task 10's settings drawer (PR #73,
// option B). Below 1024 the three columns stack into one — true tree
// above inferred tree over the matrix over the prompts, then the
// explanation, then the controls — until Task 10's settings drawer
// takes the controls.
//
// Review Focus 2: a 1280×800 window at 200 % zoom behaves like
// 640 CSS px — the compact layout, still with no sideways scroll.
// Review Focus 5: rotating a tablet 768×1024 → 1024×768 mid-lesson
// keeps the step number and the answered prediction.
// Header controls (plan addendum, PR #70): at all four viewports and
// in both themes every header control — including the "Dark mode"
// toggle — is fully inside the viewport and takes a real click.

import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import {
  answerPredictPrompt,
  readStep,
  stepToEnd,
  waitForApp,
} from "./helpers";

// The layout specs assert DOM geometry, not device pixels; the PWA
// service worker is unrelated and stays out (like theme.spec.ts).
test.use({ serviceWorkers: "block" });

const VIEWPORTS = [
  { w: 768, h: 1024, bp: "narrow" },
  { w: 1024, h: 768, bp: "medium" },
  { w: 1279, h: 800, bp: "medium" },
  { w: 1280, h: 800, bp: "wide" },
  { w: 1920, h: 1080, bp: "wide" },
] as const;

const LESSONS = ["cytochrome-c", "bootstrap-basics"] as const;

// Leaf labels are the classless <text> children of leaf node groups:
// internal groups carry a .connector line, support pills live one level
// deeper, and the "0" markers and ✕ marks have classes of their own.
const LEAF_LABELS =
  'svg > g[data-node]:not(:has(> .connector)) > text:not([class])';

/** document.documentElement.scrollWidth must fit the viewport — no
 * sideways page scroll at any width (spec §6.2). */
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const { sw, iw } = await page.evaluate(() => ({
    sw: document.documentElement.scrollWidth,
    iw: window.innerWidth,
  }));
  expect(sw, "the page must not scroll sideways").toBeLessThanOrEqual(iw);
}

/** Scroll `loc` into view vertically by scrolling the PAGE only — the
 * nearest scrollable ancestor that is not a tree panel, or the window
 * when nothing else scrolls. Never touches a .tree-canvas. A few
 * corrective passes converge when a scroller's clamp or a relayout
 * leaves the element slightly out after one move. */
async function revealByPageScroll(loc: Locator): Promise<void> {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const done = await loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      if (
        r.top >= 0 &&
        r.bottom <= window.innerHeight
      ) {
        return true;
      }
      // Minimal scroll: reveal the out-of-view edge, no overshoot.
      const delta = r.top < 0 ? r.top : r.bottom - window.innerHeight;
      let sc = el.parentElement;
      while (sc !== null) {
        if (sc.classList.contains("tree-canvas")) {
          sc = sc.parentElement;
          continue;
        }
        const oy = getComputedStyle(sc).overflowY;
        if (
          (oy === "auto" || oy === "scroll") &&
          sc.scrollHeight > sc.clientHeight
        ) {
          sc.scrollTop += delta;
          return false;
        }
        sc = sc.parentElement;
      }
      window.scrollBy(0, delta);
      return false;
    });
    if (done) return;
  }
}

/** Every leaf label of every on-screen tree panel reaches the viewport
 * by page scroll alone (spec §6.2: horizontal scrolling inside a tree
 * panel is only for figures wider than their column). */
async function expectAllLeavesVisible(page: Page, leafCount: number) {
  const vp = page.viewportSize();
  expect(vp, "viewport size is known").not.toBeNull();
  const panels = page.locator(".trees .tree-panel");
  const panelCount = await panels.count();
  expect(panelCount, "two tree panels are on screen").toBe(2);
  for (let p = 0; p < panelCount; p += 1) {
    const labels = panels.nth(p).locator(LEAF_LABELS);
    await expect(
      labels,
      `tree panel ${p} shows ${leafCount} leaf names`,
    ).toHaveCount(leafCount);
    for (let i = 0; i < leafCount; i += 1) {
      const label = labels.nth(i);
      await revealByPageScroll(label);
      const box = await label.boundingBox();
      expect(
        box,
        `leaf label ${i} in panel ${p} has a bounding box`,
      ).not.toBeNull();
      expect(
        box!.x,
        `leaf label ${i} in panel ${p} is inside the viewport's left edge`,
      ).toBeGreaterThanOrEqual(-0.5);
      expect(
        box!.x + box!.width,
        `leaf label ${i} in panel ${p} is inside the viewport's right edge`,
      ).toBeLessThanOrEqual(vp!.width + 0.5);
      expect(
        box!.y,
        `leaf label ${i} in panel ${p} is inside the viewport's top edge`,
      ).toBeGreaterThanOrEqual(-0.5);
      expect(
        box!.y + box!.height,
        `leaf label ${i} in panel ${p} is inside the viewport's bottom edge`,
      ).toBeLessThanOrEqual(vp!.height + 0.5);
    }
  }
}

/** The pinned stepper bar (spec §6.2): fully inside the viewport — it
 * is the .app grid's bottom row, so a visible stepper that fits proves
 * the pinning works. */
async function expectStepperPinned(page: Page): Promise<void> {
  const vp = page.viewportSize();
  const stepper = page.locator(".app-footer");
  await expect(stepper).toBeVisible();
  const box = await stepper.boundingBox();
  expect(box, "the stepper bar has a bounding box").not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp!.height + 0.5);
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(vp!.width + 0.5);
}

/** Two columns (§6.1 medium per PR #73 option B): the controls column
 * visible beside the center — its left edge left of the center's — and
 * the explanation below the center content in the same column track
 * (its top at or below the bottom of the tree row). The "Run
 * bootstrap" control — and on bootstrap-basics the Length field, the
 * sim control the owner's option-B rationale names — must sit inside
 * the viewport with no page scroll at all (cytochrome-c embeds real
 * sequences, so its Simulation section has no Length field). Runs
 * before the leaf check, which legitimately scrolls the page. */
async function expectMediumColumns(page: Page, lesson: string) {
  const vp = page.viewportSize();
  expect(vp, "viewport size is known").not.toBeNull();
  const controls = page.locator(".col-controls");
  const center = page.locator(".col-center");
  const explain = page.locator(".col-explain");
  const trees = page.locator(".trees");
  await expect(controls).toBeVisible();
  await expect(center).toBeVisible();
  await expect(explain).toBeVisible();
  const controlsBox = await controls.boundingBox();
  const centerBox = await center.boundingBox();
  const explainBox = await explain.boundingBox();
  const treesBox = await trees.boundingBox();
  expect(controlsBox, "the controls column has a bounding box").not.toBeNull();
  expect(centerBox, "the center column has a bounding box").not.toBeNull();
  expect(explainBox, "the explanation box has a bounding box").not.toBeNull();
  expect(treesBox, "the tree row has a bounding box").not.toBeNull();
  expect(
    controlsBox!.x,
    "the controls column sits left of the center",
  ).toBeLessThan(centerBox!.x);
  expect(
    explainBox!.y,
    "the explanation starts at or below the bottom of the trees",
  ).toBeGreaterThanOrEqual(treesBox!.y + treesBox!.height - 0.5);

  // Back to the initial, unscrolled position — answering the gating
  // prompt during stepToEnd auto-scrolls the matrix cell into view.
  // "Inside the viewport" at scroll 0 means the controls are reachable
  // without scrolling the page: they sit beside the trees, not below.
  await page.evaluate(() => {
    window.scrollTo(0, 0);
    document.querySelector(".app-grid")?.scrollTo(0, 0);
  });
  const scroll = await page.evaluate(() => ({
    win: window.scrollY,
    grid: document.querySelector(".app-grid")?.scrollTop ?? -1,
  }));
  expect(scroll.win, "the window is at the top").toBe(0);
  expect(scroll.grid, "the grid scroller is at the top").toBe(0);
  // The named controls of the option-B rationale, where each exists:
  // cytochrome-c embeds real sequences (its Simulation section has no
  // Length field), so it asserts "Run bootstrap"; bootstrap-basics is
  // simulated, so it asserts the Length field the owner named — both
  // inside the viewport at scroll 0, beside the trees.
  const targets =
    lesson === "bootstrap-basics"
      ? [page.getByLabel("Length")]
      : [page.getByRole("button", { name: /Run bootstrap/ })];
  for (const target of targets) {
    const box = await target.boundingBox();
    expect(box, "the control has a bounding box").not.toBeNull();
    expect(box!.x, "the control is inside the left edge").toBeGreaterThanOrEqual(-0.5);
    expect(
      box!.x + box!.width,
      "the control is inside the right edge",
    ).toBeLessThanOrEqual(vp!.width + 0.5);
    expect(box!.y, "the control is inside the top edge").toBeGreaterThanOrEqual(-0.5);
    expect(
      box!.y + box!.height,
      "the control is inside the bottom edge",
    ).toBeLessThanOrEqual(vp!.height + 0.5);
  }
}

/** One column (§6.1 narrow/compact): the true tree's panel ends above
 * the inferred tree's column, both at the same left edge. */
async function expectSingleColumn(page: Page): Promise<void> {
  const trueTree = page.locator(".trees > .tree-panel");
  const inferCol = page.locator(".trees > .tree-col");
  await expect(trueTree).toBeVisible();
  await expect(inferCol).toBeVisible();
  const a = await trueTree.boundingBox();
  const b = await inferCol.boundingBox();
  expect(a).not.toBeNull();
  expect(b).not.toBeNull();
  expect(
    a!.y + a!.height,
    "the true tree sits above the inferred tree",
  ).toBeLessThanOrEqual(b!.y + 0.5);
  expect(
    Math.abs(a!.x - b!.x),
    "both tree panels share the left edge",
  ).toBeLessThanOrEqual(1);
}

for (const lesson of LESSONS) {
  for (const vp of VIEWPORTS) {
    test(`${lesson} at ${vp.w}x${vp.h}: no sideways scroll, leaves and stepper reachable`, async ({
      page,
    }) => {
      test.setTimeout(120_000);
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await page.goto(`/?lesson=${lesson}`);
      await waitForApp(page);
      await stepToEnd(page);
      await expect(page.locator(".app")).toHaveAttribute(
        "data-breakpoint",
        vp.bp,
      );
      await expectNoSidewaysScroll(page);
      // Medium geometry runs first — its "no scroll" premise must hold
      // before the leaf check scrolls the page to reveal leaves.
      if (vp.bp === "medium") {
        await expectMediumColumns(page, lesson);
      }
      await expectAllLeavesVisible(page, 8);
      await expectStepperPinned(page);
      // (No compact viewport in VIEWPORTS — the zoom test asserts the
      // compact single column directly.)
      if (vp.bp === "narrow") {
        await expectSingleColumn(page);
      }
    });
  }
}

test("a 1280×800 window zoomed to 200% gives the compact layout", async ({
  browser,
}) => {
  test.setTimeout(120_000);
  // Review Focus 2: 200% browser zoom on a 1280×800 window presents the
  // page with 640×400 CSS px at 2 device pixels per px — a compact
  // viewport. (The plan's `document.body.style.zoom` alternative does
  // not re-evaluate viewport media queries in Chromium — it scales the
  // element instead — so deviceScaleFactor is the faithful emulation.)
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 640, height: 400 },
    deviceScaleFactor: 2,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  // bootstrap-basics, not cytochrome-c: its predict_branch prompt never
  // gates the stepper, so stepToEnd needs no cell click (a cell outside
  // the compact viewport can't take a pointer click anyway).
  await page.goto("/?lesson=bootstrap-basics");
  await waitForApp(page);
  await stepToEnd(page);
  await expect(page.locator(".app")).toHaveAttribute(
    "data-breakpoint",
    "compact",
  );
  await expectNoSidewaysScroll(page);
  await expectSingleColumn(page);
  await expectStepperPinned(page);
  await expectAllLeavesVisible(page, 8);
  await context.close();
});

test("rotating 768×1024 → 1024×768 mid-lesson keeps the step and the prediction", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await expect(page.locator(".app")).toHaveAttribute(
    "data-breakpoint",
    "narrow",
  );
  // nj-basics' first predict_pair gates position 0; the answer is a
  // real pick on the matrix — the verdict card is the selection to keep.
  await answerPredictPrompt(page);
  const verdict = page.locator(".prompt-verdict");
  await expect(verdict).toBeVisible();
  await page.getByRole("button", { name: "Next step" }).click();
  const before = await readStep(page);

  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator(".app")).toHaveAttribute(
    "data-breakpoint",
    "medium",
  );
  expect(await readStep(page)).toEqual(before);
  // The pick survived the reflow: its prompt card shows at the gated
  // position, so step back and the verdict is still there.
  await page.getByRole("button", { name: "Previous step" }).click();
  await expect(verdict).toBeVisible();
  await expectNoSidewaysScroll(page);
});

for (const vp of VIEWPORTS) {
  for (const theme of ["light", "dark"] as const) {
    test(`header controls stay inside the viewport at ${vp.w}x${vp.h} (${theme})`, async ({
      page,
      context,
    }) => {
      await page.setViewportSize({ width: vp.w, height: vp.h });
      await context.addInitScript((t) => {
        try {
          window.localStorage.setItem("neophylo.theme", t);
        } catch {
          // storage can be blocked; the app tolerates it
        }
      }, theme);
      await page.emulateMedia({ colorScheme: theme });
      await page.goto("/?lesson=cytochrome-c");
      await waitForApp(page);

      const controls = page.locator(".app-header button");
      const count = await controls.count();
      // Wordmark, title and toast are not controls; the buttons are the
      // mode switch pair, the Lessons menu, "Coming from PHYLIP?" and
      // the "Dark mode" theme toggle.
      expect(count, "the header has its five buttons").toBe(5);
      await expect(
        page.getByRole("button", { name: "Dark mode" }),
      ).toBeVisible();

      for (let i = 0; i < count; i += 1) {
        const control = controls.nth(i);
        const box = await control.boundingBox();
        expect(box, `header control ${i} has a bounding box`).not.toBeNull();
        expect(box!.x, `header control ${i} inside left edge`).toBeGreaterThanOrEqual(-0.5);
        expect(
          box!.x + box!.width,
          `header control ${i} inside right edge`,
        ).toBeLessThanOrEqual(vp.w + 0.5);
        expect(box!.y, `header control ${i} inside top edge`).toBeGreaterThanOrEqual(-0.5);
        expect(
          box!.y + box!.height,
          `header control ${i} inside bottom edge`,
        ).toBeLessThanOrEqual(vp.h + 0.5);
        // A real Playwright click — actionability checks reject covered
        // or off-screen targets. Anything the click opens (a menu, the
        // PHYLIP help dialog) is dismissed before the next control.
        await control.click();
        await page.keyboard.press("Escape");
      }
    });
  }
}
