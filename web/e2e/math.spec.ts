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
  fadeLeft: boolean;
  fadeRight: boolean;
}

/** For every .math-line under `selector`: the formula's right edge is
 * within the line's own box, or the box scrolls horizontally
 * (scrollWidth > clientWidth + overflow-x:auto) and is a labelled
 * tab stop. Reads the fade affordance on the line's .math-line-box
 * wrapper too — a static hint per edge still hiding content, since
 * the scrollbar itself is overlay-only. Returns the per-line checks
 * plus the page's sideways overflow. */
async function checkMathLines(
  page: import("@playwright/test").Page,
  selector: string,
): Promise<{ lines: LineCheck[]; pageScrolls: boolean }> {
  // The fade attributes are React state driven by measure callbacks
  // (scroll, mutation, observer) — they land a tick after the KaTeX
  // markup. Wait until every line's affordance matches its geometry so
  // the one-shot read below isn't racy.
  await page.waitForFunction((sel) => {
    for (const el of document.querySelectorAll(sel)) {
      const box = el.parentElement;
      if (box === null) return false;
      const wantLeft = el.scrollLeft > 1;
      const wantRight =
        el.scrollLeft + el.clientWidth < el.scrollWidth - 1;
      if (box.hasAttribute("data-fade-left") !== wantLeft) return false;
      if (box.hasAttribute("data-fade-right") !== wantRight) return false;
    }
    return true;
  }, selector);
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
      const box = el.parentElement;
      return {
        fits,
        scrolls,
        focusable,
        fadeLeft: box?.hasAttribute("data-fade-left") ?? false,
        fadeRight: box?.hasAttribute("data-fade-right") ?? false,
      };
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
      // Checked at scrollLeft 0 (settle resets scroll): only the right
      // edge still hides content, so only the right fade shows.
      expect(
        l.fadeRight,
        `${where} line ${i}: right-edge fade at scroll start`,
      ).toBe(true);
      expect(
        l.fadeLeft,
        `${where} line ${i}: no left-edge fade at scroll start`,
      ).toBe(false);
    } else {
      expect(
        l.fadeLeft || l.fadeRight,
        `${where} line ${i}: a line that fits shows no fade`,
      ).toBe(false);
    }
  }
}

/** Scroll every overflowing .math-line under `selector` to its end and
 * back: the affordance must track the position — left-edge fade at the
 * end, right-edge fade back at the start. */
async function expectFadesTrackScroll(
  page: import("@playwright/test").Page,
  selector: string,
  where: string,
) {
  const count = await page
    .locator(selector)
    .evaluateAll((els) =>
      els.filter((el) => el.scrollWidth > el.clientWidth + 1).length,
    );
  expect(count, `${where} has a scrolling math line`).toBeGreaterThan(0);
  for (const [i, line] of (await page.locator(selector).all()).entries()) {
    if (!(await line.evaluate((el) => el.scrollWidth > el.clientWidth + 1)))
      continue;
    const box = line.locator("xpath=..");
    await line.evaluate((el) => {
      el.scrollLeft = el.scrollWidth;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect(
      box,
      `${where} line ${i}: left-edge fade at the scroll end`,
    ).toHaveAttribute("data-fade-left", "true");
    await expect(
      box,
      `${where} line ${i}: no right-edge fade at the scroll end`,
    ).not.toHaveAttribute("data-fade-right", "true");
    await line.evaluate((el) => {
      el.scrollLeft = 0;
      el.dispatchEvent(new Event("scroll"));
    });
    await expect(
      box,
      `${where} line ${i}: right-edge fade back at the start`,
    ).toHaveAttribute("data-fade-right", "true");
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
  await expectFadesTrackScroll(page, ".explain-body .math-line", "Math tab");
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
  await expectFadesTrackScroll(
    page,
    ".bootstrap-explain .math-line",
    "How sure are we?",
  );
  expect(
    pageScrolls,
    "document.documentElement.scrollWidth <= innerWidth",
  ).toBe(false);
});
