// Touch e2e for ReadingTree (v1.4d plan Task 7, spec §6.5): real CDP
// taps on a tip, an internal node and a lettered point select exactly
// that target, and the invisible hit pads are ≥40×40 under
// (pointer: coarse).
//
// Taps go through Chromium's CDP Input.dispatchTouchEvent — like
// editor.spec.ts's touch tests — because a real touch pointer's
// pointerup target is unreliable for hit testing; the target under
// the finger is always found with elementFromPoint first, never with
// e.target on pointerup. The harness page
// (/e2e/reading-harness.html, dev server only) mounts the component
// directly: the reading area's route arrives in Task 8.

import { test, expect } from "@playwright/test";
import type { Browser, Page } from "@playwright/test";

const HARNESS = "/e2e/reading-harness.html";

/** A new touch-enabled page on the harness; (pointer: coarse) must
 * really present, else the pads under test never appear. */
async function touchPage(browser: Browser, query: string): Promise<Page> {
  const context = await browser.newContext({
    baseURL: "http://localhost:4173",
    viewport: { width: 768, height: 1024 },
    hasTouch: true,
    serviceWorkers: "block",
  });
  const page = await context.newPage();
  await page.goto(`${HARNESS}?${query}`);
  await expect(page.locator(".rt-figure svg")).toBeVisible();
  expect(
    await page.evaluate(() => matchMedia("(pointer: coarse)").matches),
    "the emulation presents a coarse pointer",
  ).toBe(true);
  return page;
}

/** What sits under the tap point (resolved with elementFromPoint —
 * never e.target) and a CDP tap on it; returns the selected clade. */
async function tapTarget(page: Page, selector: string): Promise<string> {
  const core = page.locator(selector).locator(".rt-hit-core");
  const box = await core.boundingBox();
  if (box === null) throw new Error(`no box for ${selector}`);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const under = await page.evaluate(
    ([px, py, sel]) => {
      const el = document.elementFromPoint(px, py);
      const group = el?.closest<SVGGElement>("[data-clade]");
      const wanted = document.querySelector(sel);
      return {
        clade: group?.getAttribute("data-clade") ?? null,
        kind: group?.getAttribute("data-kind") ?? null,
        insideWanted:
          wanted !== null && group !== null && group === wanted,
      };
    },
    [x, y, selector] as const,
  );
  expect(
    under.insideWanted,
    `elementFromPoint lands on ${selector} (found kind=${under.kind} clade=${under.clade})`,
  ).toBe(true);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  return (await page.locator("#rt-sel").textContent()) ?? "";
}

test("CDP taps on a tip and an internal node select exactly those targets", async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP touch input is Chromium-only");
  const page = await touchPage(
    browser,
    "set=showcase&selectable=node&label=T1",
  );

  // A tip tap selects that tip's clade and nothing else.
  const tipSel = await tapTarget(
    page,
    '.rt-hit[data-kind="tip"][data-clade=\'["human"]\']',
  );
  expect(JSON.parse(tipSel)).toEqual([["human"]]);

  // A tap on an internal node selects that clade — the lettered "P"
  // node is the MRCA of the hominoids.
  const nodeSel = await tapTarget(
    page,
    '.rt-hit[data-kind="node"][data-clade=\'["chimp","gibbon","gorilla","human"]\']',
  );
  expect(JSON.parse(nodeSel)).toEqual([
    ["chimp", "gibbon", "gorilla", "human"],
  ]);
  await page.context().close();
});

test("a CDP tap on a lettered point selects exactly that point's clade", async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP touch input is Chromium-only");
  const page = await touchPage(
    browser,
    "set=showcase&selectable=points&label=T1",
  );

  // Point X sits on the lettered P node (de-collided badge, same hit).
  const ptSel = await tapTarget(
    page,
    '.rt-point-hit[data-letter="X"]',
  );
  expect(JSON.parse(ptSel)).toEqual([
    ["chimp", "gibbon", "gorilla", "human"],
  ]);
  await page.context().close();
});

test("under hasTouch every hit pad is invisible and at least 40×40", async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP touch input is Chromium-only");
  const page = await touchPage(
    browser,
    "set=showcase&selectable=node&label=T1",
  );

  const pads = page.locator(".rt-hit-pad");
  const count = await pads.count();
  expect(count, "coarse pads render for every node").toBeGreaterThan(0);
  for (let i = 0; i < count; i += 1) {
    const pad = pads.nth(i);
    const box = await pad.boundingBox();
    if (box === null) throw new Error(`pad ${i} has no box`);
    expect(
      box.width,
      `pad ${i} is at least 40 px wide (got ${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(40);
    expect(
      box.height,
      `pad ${i} is at least 40 px tall (got ${box.width}×${box.height})`,
    ).toBeGreaterThanOrEqual(40);
    // Invisible: transparent fill so the pad never draws over the tree.
    const fill = await pad.evaluate((el) =>
      getComputedStyle(el).getPropertyValue("fill"),
    );
    expect(fill, `pad ${i} stays invisible`).toMatch(
      /rgba\(0, 0, 0, 0\)|transparent/,
    );
  }
  // The always-on core and label-box rects are invisible too.
  for (const cls of [".rt-hit-core", ".rt-hit-labelbox"]) {
    const els = page.locator(cls);
    const n = await els.count();
    for (let i = 0; i < n; i += 1) {
      const fill = await els.nth(i).evaluate((el) =>
        getComputedStyle(el).getPropertyValue("fill"),
      );
      expect(fill, `${cls} ${i} stays invisible`).toMatch(
        /rgba\(0, 0, 0, 0\)|transparent/,
      );
    }
  }
  await page.context().close();
});

test("a tap on a tip label selects the tip (the pad covers the label box)", async ({
  browser,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "CDP touch input is Chromium-only");
  const page = await touchPage(
    browser,
    "set=showcase&selectable=node&label=T1",
  );

  // Tap the centre of the label text, not the node dot.
  const label = page.locator(".rt-tip-label", { hasText: "gorilla" });
  const box = await label.boundingBox();
  if (box === null) throw new Error("no label box");
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const under = await page.evaluate(([px, py]) => {
    const el = document.elementFromPoint(px, py);
    const group = el?.closest<SVGGElement>("[data-clade]");
    return {
      clade: group?.getAttribute("data-clade") ?? null,
      kind: group?.getAttribute("data-kind") ?? null,
    };
  }, [x, y] as const);
  expect(under).toEqual({ clade: '["gorilla"]', kind: "tip" });

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ x, y, id: 1 }],
  });
  await cdp.send("Input.dispatchTouchEvent", {
    type: "touchEnd",
    touchPoints: [],
  });
  const sel = (await page.locator("#rt-sel").textContent()) ?? "";
  expect(JSON.parse(sel)).toEqual([["gorilla"]]);
  await page.context().close();
});
