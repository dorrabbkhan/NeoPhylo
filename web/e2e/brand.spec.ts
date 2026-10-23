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
