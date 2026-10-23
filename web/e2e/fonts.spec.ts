// Bundled-fonts e2e (v1.3 plan Task 4, spec §4, Review Focus 1). The app
// ships Inter and JetBrains Mono woff2 subsets; the tree's layout waits
// for them (≤ 3 s) and re-lays out once if they arrive late. Taxon names
// outside the bundled ranges render in a system fallback that is
// measured as drawn, so labels still never overlap.

import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";

import { waitForApp } from "./helpers";

type E2EWindow = Window & { __neophyloFontLateLoads?: number };

/** All drawn text's SVG bboxes in the first .tree-canvas panel. */
async function textBoxes(page: Page) {
  return page.locator(".tree-canvas svg").first().evaluate((svg) => {
    const vb = (svg.getAttribute("viewBox") ?? "0 0 0 0")
      .split(/\s+/)
      .map(Number);
    return {
      viewBox: { x: vb[0], y: vb[1], maxX: vb[0] + vb[2], maxY: vb[1] + vb[3] },
      boxes: Array.from(svg.querySelectorAll("text")).map((el) => {
        const b = el.getBBox();
        return {
          text: el.textContent ?? "",
          x1: b.x,
          y1: b.y,
          x2: b.x + b.width,
          y2: b.y + b.height,
        };
      }),
    };
  });
}

/** Assert no two text boxes intersect and none leaves the viewBox. */
function expectNoOverlap(boxes: Awaited<ReturnType<typeof textBoxes>>) {
  for (const b of boxes.boxes) {
    expect(b.x2, `label "${b.text}" runs past the viewBox`).toBeLessThanOrEqual(
      boxes.viewBox.maxX + 0.5,
    );
  }
  for (let i = 0; i < boxes.boxes.length; i++) {
    for (let j = i + 1; j < boxes.boxes.length; j++) {
      const a = boxes.boxes[i];
      const b = boxes.boxes[j];
      const hit =
        a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2;
      expect(hit, `"${a.text}" overlaps "${b.text}"`).toBe(false);
    }
  }
}

test.describe("bundled fonts", () => {
  test("Inter and JetBrains Mono faces are declared and loaded", async ({
    page,
  }) => {
    await page.goto("/?lesson=nj-basics");
    await waitForApp(page);
    const fonts = await page.evaluate(async () => {
      await document.fonts.ready;
      const declared: string[] = [];
      for (const f of document.fonts) declared.push(f.family);
      return {
        declared: declared.join("|"),
        inter: document.fonts.check("12px Inter"),
        jbm: document.fonts.check('12px "JetBrains Mono"'),
      };
    });
    // document.fonts.check alone cannot tell a bundled face from a
    // system fallback — the family must also be declared on the page.
    expect(fonts.declared).toMatch(/Inter/);
    expect(fonts.declared).toMatch(/JetBrains Mono/);
    expect(fonts.inter).toBe(true);
    expect(fonts.jbm).toBe(true);
  });

  test("tree text's computed font-family starts with Inter", async ({
    page,
  }) => {
    await page.goto("/?lesson=nj-basics");
    await waitForApp(page);
    const family = await page
      .locator(".tree-canvas text")
      .first()
      .evaluate((el) => getComputedStyle(el).fontFamily);
    expect(family).toMatch(/^"?Inter\b/);
  });

  test("a measured label width matches getComputedTextLength within 0.5 px", async ({
    page,
  }) => {
    await page.goto("/?lesson=nj-basics");
    await waitForApp(page);
    await expect(page.locator(".tree-canvas text").first()).toBeVisible();
    const r = await page.evaluate(() => {
      const t = document.querySelector<SVGTextElement>(".tree-canvas text");
      if (t === null) return null;
      const cs = getComputedStyle(t);
      // The app's probe-measurement (src/measureText.ts) against the same
      // resolved font — identical fonts must measure identically.
      const ns = "http://www.w3.org/2000/svg";
      const svg = document.createElementNS(ns, "svg");
      svg.setAttribute(
        "style",
        "position:absolute;visibility:hidden;width:0;height:0;overflow:hidden",
      );
      const probe = document.createElementNS(ns, "text");
      probe.setAttribute("font-family", cs.fontFamily);
      probe.setAttribute("font-size", cs.fontSize);
      probe.textContent = t.textContent;
      svg.appendChild(probe);
      document.body.appendChild(svg);
      const probeW = probe.getComputedTextLength();
      const drawnW = t.getComputedTextLength();
      svg.remove();
      return { probeW, drawnW };
    });
    expect(r).not.toBeNull();
    expect(Math.abs(r!.probeW - r!.drawnW)).toBeLessThanOrEqual(0.5);
  });

  test("a slow font causes exactly one late re-layout, without overlaps", async ({
    context,
    page,
  }) => {
    await context.addInitScript(() => {
      window.localStorage.setItem("neophylo-e2e", "1");
    });
    // Hold every woff2 request 5 s — past the 3 s fonts-ready gate.
    await page.route("**/fonts/*.woff2", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      await route.continue();
    });
    await page.goto("/?lesson=nj-basics");
    await waitForApp(page);
    await expect
      .poll(
        () =>
          page.evaluate(
            () => (window as E2EWindow).__neophyloFontLateLoads ?? 0,
          ),
        { timeout: 20_000 },
      )
      .toBe(1);
    // After the single late re-layout, labels sit in their real metrics.
    await expect(page.locator(".tree-canvas text").first()).toBeVisible();
    expectNoOverlap(await textBoxes(page));
  });

  test("names outside the bundled subsets use measured fallbacks (no overlap)", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForApp(page);
    await page.getByRole("radio", { name: "Sandbox" }).click();
    await page.locator(".import-panel textarea").fill(
      [
        ">中文名",
        "ACGTACGTACGTACGTACGT",
        ">🦋 Morpho",
        "ACGTACGTACGTACGTACGA",
        ">عربي",
        "ACGTACGTACGTACGTACCC",
        ">quatre",
        "ACGTACGTACGTACGTAGGT",
        ">fünf",
        "ACGTACGTACGTACGTAAGT",
      ].join("\n"),
    );
    await page.getByRole("button", { name: "Import", exact: true }).click();
    for (const name of ["中文名", "🦋 Morpho", "عربي"]) {
      await expect(
        page.locator(".tree-canvas text", { hasText: name }).first(),
      ).toBeVisible();
    }
    expectNoOverlap(await textBoxes(page));
  });
});
