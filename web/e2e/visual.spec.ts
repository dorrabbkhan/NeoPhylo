// Visual snapshot matrix (v1.3 plan Task 5, spec §8.3): every scene
// from visualScenes.ts at 1920×1080, 1024×768 and 768×1024, in both
// themes, Chromium only (the dedicated `visual` project). Baselines
// live in e2e/__screenshots__/ and are owned by the owner via
// CODEOWNERS — any change to them needs owner approval.
//
// Runs against the dev server like the other UI specs. Determinism:
// bundled fonts (Task 4), fixed viewports, `animations: "disabled"`,
// seeded bootstrap runs, scroll positions reset before the shot.

import { test, expect } from "@playwright/test";

import { SCENES } from "./visualScenes";

const VIEWPORTS = [
  { w: 1920, h: 1080 },
  { w: 1024, h: 768 },
  { w: 768, h: 1024 },
] as const;

const THEMES = ["light", "dark"] as const;

test.beforeEach(async ({ context }) => {
  await context.addInitScript(() => {
    // neophylo-e2e: the standard page hook the other specs install.
    // neophylo.tourSeen: keeps Task 12's first-visit tour out of every
    // scene once it exists (it keys off this device-local flag).
    try {
      window.localStorage.setItem("neophylo-e2e", "1");
      window.localStorage.setItem("neophylo.tourSeen", "1");
    } catch {
      // storage can be blocked; the app tolerates it
    }
  });
});

for (const scene of SCENES) {
  for (const vp of VIEWPORTS) {
    for (const theme of THEMES) {
      test(`${scene.name} ${vp.w}x${vp.h} ${theme}`, async ({ page }) => {
        test.setTimeout(240_000); // scenes run a real bootstrap
        await page.setViewportSize({ width: vp.w, height: vp.h });
        await page.emulateMedia({ colorScheme: theme });
        await scene.setup(page);
        await page.evaluate(() => document.fonts.ready.then(() => undefined));
        // Deterministic frame: nothing mid-scroll, caret hidden.
        await page.evaluate(() => {
          for (const el of document.querySelectorAll("*")) {
            if (el.scrollTop !== 0 || el.scrollLeft !== 0) {
              el.scrollTop = 0;
              el.scrollLeft = 0;
            }
          }
          window.scrollTo(0, 0);
        });
        await expect(page).toHaveScreenshot(
          `${scene.name}-${vp.w}x${vp.h}-${theme}.png`,
          { maxDiffPixelRatio: 0.001, animations: "disabled", caret: "hide" },
        );
      });
    }
  }
}
