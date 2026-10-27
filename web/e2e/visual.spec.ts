// Visual snapshot matrix (v1.3 plan Task 5, spec §8.3): every scene
// from visualScenes.ts at 1920×1080, 1024×768 and 768×1024, in both
// themes, Chromium only (the dedicated `visual` project). Baselines
// live in e2e/__screenshots__/ and are owned by the owner via
// CODEOWNERS — any change to them needs owner approval.
//
// Runs against the dev server like the other UI specs. Determinism:
// bundled fonts (Task 4), fixed viewports, `animations: "disabled"`,
// seeded bootstrap runs; each scene's setup ends in settleFrame()
// (visualScenes.ts), which settles fonts and scroll positions.

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
  const viewports = scene.only
    ? [scene.only.viewport]
    : (scene.viewports ?? VIEWPORTS);
  const themes = scene.only ? [scene.only.theme] : THEMES;
  for (const vp of viewports) {
    for (const theme of themes) {
      test(`${scene.name} ${vp.w}x${vp.h} ${theme}`, async ({
        page,
        context,
      }) => {
        test.setTimeout(240_000); // scenes run a real bootstrap
        await page.setViewportSize({ width: vp.w, height: vp.h });
        // Task 6: the app reads the device-local neophylo.theme pref —
        // prefers-color-scheme no longer picks the palette (spec §3.3
        // default-light). Set both so the emulated OS matches the pref.
        await context.addInitScript((t) => {
          try {
            window.localStorage.setItem("neophylo.theme", t);
          } catch {
            // storage can be blocked; the app tolerates it
          }
        }, theme);
        await page.emulateMedia({ colorScheme: theme });
        // A setup may hand back a different page to shoot — the
        // editor preview opens the exercise in a new tab (v1.4 Task
        // 10); that popup is the frame, not the editor page.
        const target = (await scene.setup(page)) ?? page;
        await expect(target).toHaveScreenshot(
          `${scene.name}-${vp.w}x${vp.h}-${theme}.png`,
          {
            maxDiffPixelRatio: 0.001,
            animations: "disabled",
            caret: "hide",
            fullPage: scene.fullPage === true,
          },
        );
      });
    }
  }
}
