// Highlighted internal-node names (owner-requested rendering
// follow-up, PR #139 review): the u1/u2/… step names used to be drawn
// unconditionally right of their node, so a name could sit on a child
// marker or another name — the globins NJ run's u20 ended on top of
// the Cow_HBB leaf marker, and the same run's u19/u20 crossed the
// connector spine. Names are now placed clear of markers, leaf names,
// "0" markers and each other (the halo plate behind each name masks
// the branch lines under it, the same convention as the support
// pills). This spec measures the drawn boxes: no name may intersect
// another name, a leaf label or a node marker.

import { test, expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

import { stepToEnd, waitForApp } from "./helpers";

test.use({ serviceWorkers: "block" });

/** Run `fn` against the controls (Settings drawer below 1280 px —
 * same pattern as leaf-labels.spec.ts). */
async function inSettings<T>(
  page: Page,
  fn: (scope: Locator) => Promise<T>,
): Promise<T> {
  const gear = page.getByRole("button", { name: "Settings" });
  if (!(await gear.isVisible())) {
    return await fn(page.locator(".col-controls"));
  }
  await gear.click();
  const dlg = page.getByRole("dialog", { name: "Settings" });
  await expect(dlg).toBeVisible();
  try {
    return await fn(dlg);
  } finally {
    await dlg.getByRole("button", { name: "Close settings" }).click();
    await expect(dlg).toHaveCount(0);
  }
}

interface DomRect {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/** Every drawn name group must hold a plate and its text, and no name
 * text's bounding box may intersect another name text, a leaf label
 * or a node marker's box. */
async function expectNamesClear(page: Page): Promise<void> {
  const result = await page
    .locator('svg[aria-label="Inferred tree"]')
    .evaluate((svg) => {
      const rect = (el: Element): DomRect => {
        const r = el.getBoundingClientRect();
        return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
      };
      const hits = (
        a: DomRect,
        b: DomRect,
      ): boolean =>
        a.left < b.right - 0.5 &&
        a.right > b.left + 0.5 &&
        a.top < b.bottom - 0.5 &&
        a.bottom > b.top + 0.5;

      const names = [
        ...svg.querySelectorAll("g[data-node]:has(> .node-name-plate)"),
      ];
      const nameRects = names.map((g) => {
        const t = g.querySelector(":scope > text:not([class])");
        return { text: t?.textContent ?? "", r: rect(t ?? g) };
      });
      const leafRects = [
        ...svg.querySelectorAll(
          'g[data-node]:not(:has(> .connector)) > text:not([class])',
        ),
      ].map((t) => ({ text: t.textContent ?? "", r: rect(t) }));
      const markerRects = [
        ...svg.querySelectorAll("g[data-node] > circle"),
      ].map((c) => ({ text: "marker", r: rect(c) }));

      const problems: string[] = [];
      for (const g of names) {
        if (g.querySelector(".node-name-plate") === null) {
          problems.push("a node-name group has no halo plate");
        }
      }
      for (const n of nameRects) {
        for (const m of nameRects) {
          if (n !== m && hits(n.r, m.r)) {
            problems.push(`"${n.text}" intersects "${m.text}"`);
          }
        }
        for (const l of leafRects) {
          if (hits(n.r, l.r)) {
            problems.push(`"${n.text}" intersects leaf "${l.text}"`);
          }
        }
        for (const k of markerRects) {
          if (hits(n.r, k.r)) {
            problems.push(`"${n.text}" intersects a node marker`);
          }
        }
      }
      return { count: nameRects.length, problems };
    });
  expect(result.count, "no highlighted internal names drawn").toBeGreaterThan(0);
  expect(result.problems).toEqual([]);
}

async function openGlobins(page: Page, method: "Nj" | "Upgma") {
  await page.goto("/?sb=1&ds=globins");
  await waitForApp(page);
  await inSettings(page, async (scope) => {
    await scope.getByLabel("Tree-building method").selectOption(method);
  });
}

test("globins NJ final step: internal names clear of labels and markers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGlobins(page, "Nj");
  await stepToEnd(page);
  await page.locator('svg[aria-label="Inferred tree"]').scrollIntoViewIfNeeded();
  await expectNamesClear(page);
});

test("globins UPGMA step 20: internal names clear of labels and markers", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await openGlobins(page, "Upgma");
  const next = page.getByRole("button", { name: "Next step" });
  for (;;) {
    const text = await page.locator(".stepper-status").innerText();
    if (/step 20 of /.test(text)) break;
    await next.click();
  }
  await page.locator('svg[aria-label="Inferred tree"]').scrollIntoViewIfNeeded();
  await expectNamesClear(page);
});

test("globins NJ final step at 768x1024: internal names clear", async ({
  page,
}) => {
  await page.setViewportSize({ width: 768, height: 1024 });
  await openGlobins(page, "Nj");
  await stepToEnd(page);
  await page.locator('svg[aria-label="Inferred tree"]').scrollIntoViewIfNeeded();
  await expectNamesClear(page);
});
