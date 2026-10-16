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
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
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
