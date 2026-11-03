// Heatmap axis-label fit (v1.4b Task 13 fix round 1). The fixed 90 px
// label band clipped row labels on the left ("Pan_troglodytes" lost
// its first characters) and the last column's rotated label off the
// viewBox's top-right corner ("Hylobates_lar" rendered "Hylobate").
// The bands are now reserved from the longest label's measured glyph
// extents. On the shipped MEGA handout, every row and column label's
// bounding box must lie inside the heatmap svg's own rect and inside
// the viewport at each of the three screenshot viewports.

import { test, expect } from "@playwright/test";

import { waitForApp } from "./helpers";

// DOM geometry, not offline behaviour — the service worker stays out
// (same as layout.spec.ts).
test.use({ serviceWorkers: "block" });

// Row labels are the <text> children of each role="row" group; column
// labels are the direct <text> children of the grid svg (a cell's own
// value text lives one group deeper, inside its role="gridcell").
const AXIS_LABELS = ':scope > text, :scope > g[role="row"] > text';

for (const vp of [
  { w: 1920, h: 1080 },
  { w: 1366, h: 768 },
  { w: 768, h: 1024 },
] as const) {
  test(`MEGA handout 1: heatmap axis labels inside the svg at ${vp.w}x${vp.h}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/?lab=mega-jc69-vs-k2p");
    await page.getByRole("link", { name: "Load this lab" }).click();
    await waitForApp(page);
    const svg = page.locator('svg[aria-label="Distance matrix"]');
    await expect(svg).toBeVisible();
    await svg.scrollIntoViewIfNeeded();

    const clipped = await svg.evaluate((el, selector) => {
      const box = el.getBoundingClientRect();
      const out: string[] = [];
      for (const t of el.querySelectorAll<SVGTextElement>(selector)) {
        const b = t.getBoundingClientRect();
        const insideSvg =
          b.left >= box.left - 0.5 &&
          b.right <= box.right + 0.5 &&
          b.top >= box.top - 0.5 &&
          b.bottom <= box.bottom + 0.5;
        const insideViewport =
          b.left >= -0.5 &&
          b.right <= window.innerWidth + 0.5 &&
          b.top >= -0.5 &&
          b.bottom <= window.innerHeight + 0.5;
        if (!insideSvg || !insideViewport) {
          out.push(
            `${t.textContent} (${Math.round(b.left)},${Math.round(b.top)})-(${Math.round(b.right)},${Math.round(b.bottom)})`,
          );
        }
      }
      return out;
    }, AXIS_LABELS);
    expect(clipped, "a heatmap axis label is clipped").toEqual([]);
  });
}
