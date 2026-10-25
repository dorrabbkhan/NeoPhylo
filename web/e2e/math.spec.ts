// Math-mode formula overflow (v1.3 fixes). At 1280 the narrow right
// column's Explanation "Math" tab and the controls column's "How sure
// are we?" panel both render KaTeX lines wider than their box: the
// line must scroll horizontally INSIDE its own box — never the page —
// and a scrolling line must be a labelled tab stop so keyboard users
// can reach the clipped end.

import { test, expect } from "@playwright/test";

import { stepToEnd, waitForApp } from "./helpers";

interface LineCheck {
  fits: boolean;
  scrolls: boolean;
  focusable: boolean;
}

/** For every .math-line under `selector`: the formula's right edge is
 * within the line's own box, or the box scrolls horizontally
 * (scrollWidth > clientWidth + overflow-x:auto) and is a labelled
 * tab stop. Returns the per-line checks plus the page's sideways
 * overflow. */
async function checkMathLines(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<{ lines: LineCheck[]; pageScrolls: boolean }> {
  return await page.evaluate((sel) => {
    const lines = Array.from(document.querySelectorAll(sel)).map((el) => {
      const cs = getComputedStyle(el);
      const katex = el.querySelector(".katex") ?? el;
      const fits =
        katex.getBoundingClientRect().right <=
        el.getBoundingClientRect().right + 1;
      const scrolls =
        el.scrollWidth > el.clientWidth + 1 && cs.overflowX === "auto";
      const focusable =
        el.getAttribute("tabindex") === "0" &&
        el.getAttribute("role") === "group" &&
        el.getAttribute("aria-label") !== null;
      return { fits, scrolls, focusable };
    });
    return {
      lines,
      pageScrolls: document.documentElement.scrollWidth > window.innerWidth,
    };
  }, selector);
}

function expectLinesOk(lines: LineCheck[], where: string) {
  expect(lines.length, `${where} rendered math lines`).toBeGreaterThan(0);
  for (const [i, l] of lines.entries()) {
    expect(
      l.fits || l.scrolls,
      `${where} line ${i}: fits its box or scrolls inside it`,
    ).toBe(true);
    if (l.scrolls) {
      expect(
        l.focusable,
        `${where} line ${i}: a scrolling formula is a labelled tab stop`,
      ).toBe(true);
    }
  }
}

// The wide formulas only exist once a trace is built — step to the
// end, then switch the shared Concept/Math toggle to Math (the lazy
// KaTeX chunk renders on first use).
test("1280x800: Math tab formulas scroll inside their box, page never sideways", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await stepToEnd(page);
  await page.getByRole("button", { name: "Math" }).click();
  const first = page.locator(".explain-body .math-line .katex").first();
  await expect(first).toBeVisible();

  const { lines, pageScrolls } = await checkMathLines(
    page,
    ".explain-body .math-line",
  );
  expectLinesOk(lines, "Math tab");
  expect(
    pageScrolls,
    "document.documentElement.scrollWidth <= innerWidth",
  ).toBe(false);
});

test("1280x720: 'How sure are we?' formulas scroll inside their box", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto("/?lesson=nj-basics");
  await waitForApp(page);
  await stepToEnd(page);
  await page.getByRole("button", { name: "Math" }).click();
  await expect(
    page.locator(".bootstrap-explain .math-line .katex").first(),
  ).toBeVisible();

  const { lines, pageScrolls } = await checkMathLines(
    page,
    ".bootstrap-explain .math-line",
  );
  expectLinesOk(lines, "How sure are we?");
  expect(
    pageScrolls,
    "document.documentElement.scrollWidth <= innerWidth",
  ).toBe(false);
});
