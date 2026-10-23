// Brand asset checks that need a real browser (v1.3 plan Task 8,
// spec §5): the wordmark in the header, and the maskable icon's safe
// zone verified against rendered pixels (canvas getImageData — the
// unit test only sees container sizes).

import { expect, test } from "@playwright/test";

import { waitForApp } from "./helpers";

test("the header shows the wordmark", async ({ page }) => {
  await page.goto("/");
  await waitForApp(page);
  const wordmark = page.locator(".app-header .wordmark");
  await expect(wordmark).toBeVisible();
  await expect(wordmark).toContainText("NeoPhylo");
  await expect(wordmark.locator("img")).toBeVisible();
});

// Below the wide breakpoint the wordmark collapses to the icon (owner
// decision on PR #72) so the header is exactly as tall as it was
// before the wordmark — the fix for the clipped/wrapped controls the
// full wordmark caused at these viewports. "As tall as before" is
// measured directly: hiding the wordmark reproduces main's header (it
// had no wordmark), and the icon-only header must match that height
// within 2 px. At 768 px main's own header could already wrap, so the
// invariant is parity, not a single row.
for (const vp of [
  { w: 1024, h: 768 },
  { w: 768, h: 1024 },
]) {
  test(`header keeps main's height, icon-only wordmark at ${vp.w}x${vp.h}`, async ({
    page,
  }) => {
    await page.setViewportSize({ width: vp.w, height: vp.h });
    await page.goto("/");
    await waitForApp(page);
    const header = page.locator(".app-header");
    const wordmark = header.locator(".wordmark");

    await expect(wordmark.locator("img")).toBeVisible();
    // "NeoPhylo" is still in the DOM (the accessible name survives) but
    // visually hidden: its box collapses to the 1 px clip, which is why
    // the visibility matcher can't see the hiding.
    await expect(wordmark).toContainText("NeoPhylo");
    const textBox = await wordmark.locator(".wordmark-text").boundingBox();
    expect(textBox, "wordmark text has a bounding box").not.toBeNull();
    expect(textBox!.width).toBeLessThanOrEqual(1);
    expect(textBox!.height).toBeLessThanOrEqual(1);

    const withIcon = await header.boundingBox();
    expect(withIcon, "header has a bounding box").not.toBeNull();
    await page.addStyleTag({
      content: ".wordmark { display: none !important; }",
    });
    const mainLike = await header.boundingBox();
    expect(mainLike, "header still has a bounding box").not.toBeNull();
    expect(
      Math.abs(withIcon!.height - mainLike!.height),
      "header is as tall as without the wordmark",
    ).toBeLessThanOrEqual(2);

    // Nothing the user needs is clipped: the Lesson|Sandbox switch and
    // the Lessons button sit fully inside the viewport. (Later controls
    // may still run off the right edge at 768 px — main did the same;
    // that reflow is Task 9's job.)
    for (const selector of [".mode-switch", ".lessons-menu > button"]) {
      const child = await page.locator(selector).boundingBox();
      expect(child, `${selector} has a bounding box`).not.toBeNull();
      expect(
        child!.x,
        `${selector} starts inside the viewport`,
      ).toBeGreaterThanOrEqual(0);
      expect(
        child!.x + child!.width,
        `${selector} ends inside the viewport`,
      ).toBeLessThanOrEqual(vp.w);
    }
  });
}

test("icon-maskable-512 keeps its mark inside the 10% safe margin", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const img = new Image();
    img.src = "/brand/icon-maskable-512.png";
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.drawImage(img, 0, 0);
    const { data, width, height } = ctx.getImageData(0, 0, c.width, c.height);
    const px = (x: number, y: number) =>
      [0, 1, 2, 3].map((k) => data[(y * width + x) * 4 + k]);
    const bg = px(0, 0);
    const margin = Math.floor(width * 0.1);
    let different = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (x >= margin && x < width - margin && y >= margin && y < height - margin)
          continue;
        const p = px(x, y);
        if (p.some((v, k) => v !== bg[k])) different += 1;
      }
    }
    return { width, height, margin, different };
  });
  expect(result).toMatchObject({ width: 512, height: 512, margin: 51 });
  // The outer 10% band is uniform background — the mark can't be cut.
  expect(result.different).toBe(0);
});
