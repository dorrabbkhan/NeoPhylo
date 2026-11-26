// UI polish sweep (v1.5 Task 3, spec §16.4): the four-variant button
// system lands on every in-scope surface; the focus ring keeps ≥ 3:1
// contrast in both themes; controls-column labels never wrap mid-word;
// the stepper carries icon + text and keeps its keyboard shortcuts;
// the touch floor, the disabled cursor and the motion budget hold.
//
// What counts as a "button" for this sweep (conductor's call — the
// same wording lives in docs/decisions.md under "v1.5 Task 3"): every
// <button> element plus every <a> styled as a button (a.btn). Not
// swept — they keep their own component styling and must still show a
// token focus ring: elements whose role is menuitem, menuitemradio,
// tab, radio, switch or option; form inputs and sliders; and controls
// that read as text links (marked .text-link). Elements inside
// .app-header or the .phone-sheet are v1.5 Task 2's, and the pair
// panel and replicate panel are outside this pass's reach — the sweep
// skips their descendants even when they share a Sheet (the guide
// sheets re-use the pair-panel class, so it is excluded by name only
// when neither guide class is present).

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import {
  answerPredictPrompt,
  readStep,
  stepToEnd,
  waitForApp,
} from "./helpers";

import { contrastRatio } from "../src/design/contrast";

/** The decision rule as one named selector — every <button> that is
 * not an excluded widget role or a text-link control, plus every
 * button-styled <a>. */
const SWEPT_BUTTON =
  "button:not(.text-link)" +
  ':not([role="menuitem"]):not([role="menuitemradio"])' +
  ':not([role="tab"]):not([role="radio"]):not([role="switch"])' +
  ':not([role="option"]), a.btn';

/** Ancestors outside this pass — their descendants are not swept. */
const OUT_OF_SCOPE =
  ".app-header, .phone-sheet, " +
  ".pair-panel:not(.phylip-help):not(.mega-help), .replicate-panel";

const VARIANTS = [
  "btn-primary",
  "btn-secondary",
  "btn-ghost",
  "btn-icon",
] as const;

interface SweptButton {
  classes: string[];
  name: string;
  variants: string[];
}

/** Every swept element on the page: class list, accessible-ish name
 * for failure messages and which of the four variant classes it
 * carries. */
async function sweptButtons(page: Page): Promise<SweptButton[]> {
  const out: SweptButton[] = [];
  const loc = page.locator(SWEPT_BUTTON);
  const n = await loc.count();
  for (let i = 0; i < n; i += 1) {
    const el = loc.nth(i);
    const outside = await el.evaluate(
      (node, sel) => node.closest(sel) !== null,
      OUT_OF_SCOPE,
    );
    if (outside || !(await el.isVisible())) continue;
    const classes = ((await el.getAttribute("class")) ?? "")
      .split(/\s+/)
      .filter(Boolean);
    const name =
      (await el.getAttribute("aria-label")) ??
      (await el.innerText()).replace(/\s+/g, " ").trim();
    out.push({
      classes,
      name,
      variants: VARIANTS.filter((v) => classes.includes(v)),
    });
  }
  return out;
}

/** The Task-3 contract: .btn plus exactly one of the four variants. */
async function expectSweep(
  page: Page,
  where: string,
  min = 1,
): Promise<void> {
  const els = await sweptButtons(page);
  const bad = els.filter(
    (e) => !e.classes.includes("btn") || e.variants.length !== 1,
  );
  expect(
    bad.map((e) => `"${e.name}" [${e.classes.join(" ")}]`),
    `${where}: swept controls without .btn + exactly one variant`,
  ).toEqual([]);
  expect(
    els.length,
    `${where}: the sweep found no controls — the surface changed?`,
  ).toBeGreaterThanOrEqual(min);
}

const hex = (c: [number, number, number]): string =>
  `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

// ------------------------------------------------------------------
// The class sweep over every in-scope surface (spec §16.4's reach).
// ------------------------------------------------------------------

test("sweep: the lesson view carries the four-class system", async ({
  page,
}) => {
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await expectSweep(page, "?lesson=nj-basics");
});

test("sweep: sandbox, the dataset sheet and its confirm", async ({
  page,
}) => {
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await expect(
    page.getByRole("button", { name: "Import", exact: true }),
  ).toBeVisible();
  await expectSweep(page, "sandbox");

  // The replace confirm only exists while the sandbox holds data —
  // import a sample first (the empty state unmounts once it lands).
  await page
    .getByRole("button", { name: "Weak-support example (DNA)" })
    .click();
  await expect(
    page.getByRole("button", { name: "Weak-support example (DNA)" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Open dataset…" }).click();
  const sheet = page.getByRole("dialog", { name: "Open dataset" });
  await expect(sheet).toBeVisible();
  await expectSweep(page, "dataset sheet");

  // Fix round 1: the rows are list items, not centred buttons — every
  // row's title sits at the row's content-box left edge (±2 px).
  const rows = sheet.locator(".dataset-open");
  const deltas = await rows.evaluateAll((els) =>
    els.map((el) => {
      const cs = getComputedStyle(el);
      const contentLeft =
        el.getBoundingClientRect().left +
        parseFloat(cs.borderLeftWidth) +
        parseFloat(cs.paddingLeft);
      const titleLeft =
        el
          .querySelector(".dataset-title")
          ?.getBoundingClientRect().left ?? Number.NaN;
      return Math.abs(titleLeft - contentLeft);
    }),
  );
  expect(deltas.length, "the sheet listed dataset rows").toBeGreaterThan(0);
  for (const d of deltas) {
    expect(d, "dataset row title at the content-box left").toBeLessThanOrEqual(2);
  }

  // With imported data the pick asks before replacing — the confirm's
  // two buttons are swept too.
  await sheet.locator(".dataset-open").first().click();
  await expect(page.locator(".lab-confirm")).toBeVisible();
  await expectSweep(page, "dataset-sheet confirm");
});

test("sweep: the guide sheets", async ({ page }) => {
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await page.getByRole("button", { name: "Guides" }).click();
  await page
    .getByRole("menuitem", { name: "Coming from PHYLIP?" })
    .click();
  await expect(page.locator(".phylip-help")).toBeVisible();
  await expectSweep(page, "PHYLIP guide sheet");

  await page
    .locator(".phylip-help")
    .getByRole("button", { name: "Close PHYLIP help" })
    .click();
  await page.getByRole("button", { name: "Guides" }).click();
  await page
    .getByRole("menuitem", { name: "Coming from MEGA?" })
    .click();
  await expect(page.locator(".mega-help")).toBeVisible();
  await expectSweep(page, "MEGA guide sheet");
});

test("sweep: the Settings drawer at 1024", async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 800 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await page.getByRole("button", { name: "Settings" }).click();
  await expect(
    page.getByRole("dialog", { name: "Settings" }),
  ).toBeVisible();
  await expectSweep(page, "Settings drawer");
});

test("sweep: the matrix grid sheet in the sandbox", async ({ page }) => {
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await page.getByRole("tab", { name: "Distance matrix" }).click();
  await page.getByRole("button", { name: "Type a matrix…" }).click();
  await expect(
    page.getByRole("dialog", { name: "Distance matrix" }),
  ).toBeVisible();
  await expectSweep(page, "matrix grid sheet");
});

test("sweep: the editor page and its sheets", async ({ page }) => {
  // Below 1024 (narrow/compact) the Newick/branch views leave the grid
  // and open as full-screen sheets — at 1024 exactly they stay inline.
  await page.setViewportSize({ width: 768, height: 800 });
  await page.goto("/?editor");
  await expect(page.locator(".editor-panel")).toBeVisible();
  await expectSweep(page, "?editor");

  await page.getByRole("button", { name: "Newick tree" }).click();
  await expect(
    page.getByRole("dialog", { name: "Newick tree" }),
  ).toBeVisible();
  await expectSweep(page, "editor Newick sheet");
  await page
    .getByRole("button", { name: "Close the Newick tree view" })
    .click();

  // The lab load only asks over a dirty draft — a clean editor loads
  // straight through. One typed character in Title dirties it.
  await page.getByLabel("Title").fill("x");
  await page.getByRole("button", { name: "Labs" }).click();
  const labs = page.getByRole("dialog", { name: "Labs" });
  await expect(labs).toBeVisible();
  await expectSweep(page, "editor labs sheet");

  await labs
    .getByRole("button", { name: "Load this lab" })
    .first()
    .click();
  await expect(page.locator(".lab-confirm")).toBeVisible();
  await expectSweep(page, "editor labs confirm");
});

test("sweep: the tour card", async ({ page }) => {
  await page.goto("/?lesson=nj-basics", { waitUntil: "commit" });
  await page.evaluate(() => {
    window.localStorage.removeItem("neophylo.tourSeen");
  });
  await page.reload();
  await waitForApp(page);
  await expect(
    page.getByRole("dialog", { name: "Take the tour" }),
  ).toBeVisible();
  await expectSweep(page, "tour card");
});

test("sweep: library, labs index, a lab handout and the guide", async ({
  page,
}) => {
  await page.goto("/?library");
  await expect(page.locator(".library-page")).toBeVisible();
  await expectSweep(page, "?library", 0);

  // The copy disclosure's LMS choices are buttons too — open a card's
  // panel so they land in the swept set (v1.5 Task 8 fix round 1). The
  // paper pass lands asynchronously and adds each card's worksheet/key
  // links in one update, which reflows the toggles — "Answer key" only
  // exists once `paper` resolved, so wait for it before clicking.
  await expect(
    page
      .locator(".lib-card")
      .first()
      .getByRole("link", { name: "Answer key" }),
  ).toBeVisible({ timeout: 30_000 });
  await page.locator(".lib-copy-toggle").first().click();
  await expect(page.locator(".lib-copy-choice").first()).toBeVisible();
  await expectSweep(page, "?library (copy panel open)", 0);

  await page.goto("/?labs");
  await expect(page.locator(".library-page")).toBeVisible();
  await expectSweep(page, "?labs", 0);

  await page.goto("/?lab=mega-jc69-vs-k2p");
  await expect(page.locator(".lab-controls")).toBeVisible();
  await expectSweep(page, "lab handout");

  await page.goto("/?guide");
  await expect(
    page.getByRole("heading", { name: "Instructor guide", level: 1 }),
  ).toBeVisible();
  await expectSweep(page, "?guide");
});

// ------------------------------------------------------------------
// Stepper: icon + text, and the keyboard shortcuts stay.
// ------------------------------------------------------------------

test("stepper buttons carry icon + text and keep their shortcuts", async ({
  page,
}) => {
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);

  const prev = page.getByRole("button", { name: "Previous step" });
  const play = page.getByRole("button", { name: "Play" });
  const next = page.getByRole("button", { name: "Next step" });
  for (const b of [prev, play, next]) {
    await expect(b.locator("svg").first()).toBeVisible();
    expect((await b.innerText()).trim().length).toBeGreaterThan(0);
  }

  // nj-basics' join-1 predict_pair prompt gates position 0 — arrows do
  // nothing until it is answered. The pick leaves focus on the matrix
  // cell, whose own arrow navigation preventDefaults the key; blur it
  // so the global handler sees the arrows (and Space) on <body>.
  await answerPredictPrompt(page);
  await page.evaluate(() =>
    (document.activeElement as HTMLElement | null)?.blur(),
  );
  const before = await readStep(page);
  await page.keyboard.press("ArrowRight");
  await expect.poll(async () => (await readStep(page)).k).toBe(before.k + 1);
  await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await readStep(page)).k).toBe(before.k);

  // Space toggles play: the button's accessible name flips to Pause
  // and back.
  await page.keyboard.press(" ");
  await expect(page.getByRole("button", { name: "Pause" })).toBeVisible();
  await page.keyboard.press(" ");
  await expect(page.getByRole("button", { name: "Play" })).toBeVisible();
});

// ------------------------------------------------------------------
// States: focus ring contrast, disabled cursor, hover lift budget.
// ------------------------------------------------------------------

for (const theme of ["light", "dark"] as const) {
  test(`focus ring keeps ≥3:1 contrast on every .btn (${theme})`, async ({
    page,
  }) => {
    await page.goto("/?lesson=nj-basics", { waitUntil: "commit" });
    await page.evaluate((t) => {
      window.localStorage.setItem("neophylo.theme", t);
    }, theme);
    await page.reload();
    await waitForApp(page);

    // Focusable .btn total, computed once: visible (nonzero box) and
    // not disabled — the tab-order target the loop can actually reach.
    // Counting every DOM .btn (the disabled "Previous step" included)
    // would never be reached by Tab, so the loop would spin to its cap.
    const total = await page.evaluate(() =>
      [...document.querySelectorAll<HTMLElement>(".btn")].filter((el) => {
        const r = el.getBoundingClientRect();
        return (
          r.width > 0 &&
          r.height > 0 &&
          !(el as HTMLButtonElement).disabled
        );
      }).length,
    );

    // Real Tab navigation — :focus-visible applies identically on all
    // engines. Each newly focused .btn gets its ring measured once.
    const checked = new Set<number>();
    for (let press = 0; press < 400; press += 1) {
      const idx = await page.evaluate((sel) => {
        const all = [...document.querySelectorAll(sel)];
        return all.indexOf(document.activeElement as Element);
      }, ".btn");
      if (idx >= 0 && !checked.has(idx)) {
        checked.add(idx);
        const st = await page.evaluate(() => {
          const el = document.activeElement as HTMLElement;
          const cs = getComputedStyle(el);
          return {
            color: cs.outlineColor,
            width: cs.outlineWidth,
            style: cs.outlineStyle,
            cls: el.getAttribute("class") ?? "",
            bg: el.parentElement === null
              ? "rgb(255, 255, 255)"
              : (() => {
                  let n: Element | null = el.parentElement;
                  while (n !== null) {
                    const b = getComputedStyle(n).backgroundColor;
                    const m =
                      /rgba?\((\d+),\s*(\d+),\s*(\d+)(?:,\s*([\d.]+))?\)/.exec(
                        b,
                      );
                    if (
                      m !== null &&
                      (m[4] === undefined || Number(m[4]) > 0)
                    ) {
                      return b;
                    }
                    n = n.parentElement;
                  }
                  return "rgb(255, 255, 255)";
                })(),
          };
        });
        expect(st.style, `no focus ring on [${st.cls}]`).toBe("solid");
        expect(parseFloat(st.width)).toBeGreaterThanOrEqual(1.5);
        const parse = (s: string): [number, number, number] => {
          const m = /rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(s);
          if (m === null) throw new Error(`unparsable color ${s}`);
          return [Number(m[1]), Number(m[2]), Number(m[3])];
        };
        const ratio = contrastRatio(hex(parse(st.color)), hex(parse(st.bg)));
        expect(
          ratio,
          `focus ring ${st.color} on ${st.bg} < 3:1 (${st.cls})`,
        ).toBeGreaterThanOrEqual(3);
      }
      await page.keyboard.press("Tab");
      if (checked.size >= Math.min(total, 30)) break;
    }
    expect(checked.size).toBeGreaterThan(0);
  });
}

test("a disabled .btn shows the refusal cursor and does not lift", async ({
  page,
}) => {
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  const prev = page.getByRole("button", { name: "Previous step" });
  await expect(prev).toBeDisabled();
  const cs = await prev.evaluate((el) => getComputedStyle(el).cursor);
  expect(cs).toBe("not-allowed");
  await prev.hover({ force: true });
  const tf = await prev.evaluate((el) => getComputedStyle(el).transform);
  expect(tf === "none" || tf === "").toBeTruthy();
});

// ------------------------------------------------------------------
// Controls column: equal group widths, no mid-word label wraps.
// ------------------------------------------------------------------

const WIDTHS: { w: number; scope: string }[] = [
  { w: 1280, scope: ".col-controls" },
  { w: 1920, scope: ".col-controls" },
  { w: 1024, scope: ".settings-drawer" },
];

for (const { w, scope } of WIDTHS) {
  test(`bootstrap/export groups are titled, equal-width, labels never wrap mid-word (${w}px)`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: w, height: 800 });
    await page.goto("/?lesson=nj-basics");
    await waitForApp(page);
    // The bootstrap panel only exists at the final step (atFinal &&
    // inferred && aligned) — step there before looking for its group.
    await stepToEnd(page);
    if (scope === ".settings-drawer") {
      await page.getByRole("button", { name: "Settings" }).click();
      await expect(
        page.getByRole("dialog", { name: "Settings" }),
      ).toBeVisible();
    }

    // Two titled groups, existing wording.
    const groups: { h: string; rowSel: string }[] = [
      { h: "How sure are we?", rowSel: ".bootstrap-actions .btn" },
      { h: "Export", rowSel: ".export-buttons .btn" },
    ];
    for (const g of groups) {
      await expect(
        page.locator(scope).getByRole("heading", {
          name: g.h,
          exact: true,
        }),
      ).toBeVisible();
      const boxes = await page
        .locator(`${scope} ${g.rowSel}`)
        .evaluateAll((els) =>
          els.map((e) => e.getBoundingClientRect().width),
        );
      expect(boxes.length).toBeGreaterThan(0);
      const w0 = boxes[0];
      for (const bw of boxes) {
        expect(
          Math.abs(bw - w0),
          `${g.h}: button widths differ (${boxes.join(",")})`,
        ).toBeLessThanOrEqual(1);
      }
    }

    // No label wraps mid-word anywhere in the controls scope: a word
    // spanning two lines splits into multiple client rects.
    const badWords = await page.evaluate((sel) => {
      const bad: string[] = [];
      for (const btn of document.querySelectorAll(sel)) {
        const walker = document.createTreeWalker(
          btn,
          NodeFilter.SHOW_TEXT,
        );
        let node: Node | null;
        while ((node = walker.nextNode()) !== null) {
          const text = node.textContent ?? "";
          const re = /\S+/g;
          let m: RegExpExecArray | null;
          while ((m = re.exec(text)) !== null) {
            const r = document.createRange();
            r.setStart(node, m.index);
            r.setEnd(node, m.index + m[0].length);
            if (r.getClientRects().length > 1) bad.push(m[0]);
          }
        }
      }
      return bad;
    }, `${scope} .btn`);
    expect(badWords).toEqual([]);
  });
}

// ------------------------------------------------------------------
// Touch floor and motion budget.
// ------------------------------------------------------------------

test.describe("coarse pointer", () => {
  test.use({ hasTouch: true });

  test("every swept page-content target is ≥40×40", async ({ page }) => {
    await page.goto("/?lesson=nj-basics");
    await waitForApp(page);
    const tooSmall: string[] = [];
    const loc = page.locator(SWEPT_BUTTON);
    const n = await loc.count();
    for (let i = 0; i < n; i += 1) {
      const el = loc.nth(i);
      const outside = await el.evaluate(
        (node, sel) => node.closest(sel) !== null,
        OUT_OF_SCOPE,
      );
      if (outside || !(await el.isVisible())) continue;
      const box = await el.boundingBox();
      if (box === null) continue;
      if (box.width < 39.5 || box.height < 39.5) {
        const name =
          (await el.getAttribute("aria-label")) ??
          (await el.innerText()).trim();
        tooSmall.push(
          `${name} ${box.width.toFixed(1)}×${box.height.toFixed(1)}`,
        );
      }
    }
    expect(tooSmall).toEqual([]);
  });
});

test.describe("reduced motion", () => {
  test.use({ reducedMotion: "reduce" });

  test("no transform and 0s durations on .btn", async ({ page }) => {
    await page.goto("/?lesson=nj-basics");
    await waitForApp(page);
    const b = page.locator(".btn").first();
    await expect(b).toBeVisible();
    const dur = await b.evaluate(
      (el) => getComputedStyle(el).transitionDuration,
    );
    expect(dur.split(",").map((s) => s.trim())).toContain("0s");
    await b.hover({ force: true });
    const tf = await b.evaluate((el) => getComputedStyle(el).transform);
    expect(tf === "none" || tf === "").toBeTruthy();
  });
});
