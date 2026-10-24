// Playwright e2e config (plan Task 23, spec §8.7). Runs the built-in
// lesson specs against the Vite dev server — the exercises plugin serves
// /exercises/<id>.json from the repo's exercises/ directory — on all
// three engines the spec supports (Chromium, Firefox, WebKit).

import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: "list",
  use: {
    baseURL: "http://localhost:4173",
    trace: "retain-on-failure",
    // v1.3 Task 12 (spec §6.7): the first-visit tour keys off the
    // device-local neophylo.tourSeen flag. Marking it seen in the
    // shared context keeps the tour out of every spec; tour.spec.ts
    // overrides this back to empty storage.
    storageState: {
      cookies: [],
      origins: [
        {
          origin: "http://localhost:4173",
          localStorage: [{ name: "neophylo.tourSeen", value: "1" }],
        },
        {
          origin: "http://localhost:4174",
          localStorage: [{ name: "neophylo.tourSeen", value: "1" }],
        },
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      testIgnore: /visual\.spec\.ts/,
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "firefox",
      testIgnore: /visual\.spec\.ts/,
      use: { ...devices["Desktop Firefox"] },
    },
    {
      name: "webkit",
      testIgnore: /visual\.spec\.ts/,
      use: { ...devices["Desktop Safari"] },
    },
    {
      // Visual snapshot matrix (v1.3 Task 5, spec §8.3): Chromium only,
      // animations disabled per-assertion. Baselines live in
      // e2e/__screenshots__/ (owner-approved via CODEOWNERS), one file
      // per scene × viewport × theme.
      name: "visual",
      testMatch: /visual\.spec\.ts/,
      snapshotPathTemplate:
        "{testDir}/__screenshots__/{arg}-{platform}{ext}",
      use: {
        ...devices["Desktop Chrome"],
        serviceWorkers: "block",
      },
    },
  ],
  webServer: [
    {
      command: "npm run dev -- --port 4173 --strictPort",
      url: "http://localhost:4173",
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      // Production build + preview for the PWA offline test (Task 25):
      // the dev server never registers a service worker. Always a fresh
      // build — a reused server could serve a stale dist.
      command: "npm run build && npm run preview -- --port 4174 --strictPort",
      url: "http://localhost:4174",
      reuseExistingServer: false,
      timeout: 120_000,
    },
  ],
});
