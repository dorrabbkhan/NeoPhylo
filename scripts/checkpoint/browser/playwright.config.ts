// Release-checkpoint browser pass (docs/release-checkpoint.md). Unlike
// web/playwright.config.ts this never starts a server: it drives a
// deployed build — the release candidate's Netlify deploy preview — on all
// three engines, saves screenshots, PDFs and exported .meg files for the
// owner, and fails on anything a machine can judge (sideways scroll, text
// under 12 px, clipped or overlapping leaf labels, console errors, wrong
// counts or messages).
//
// Run it through scripts/checkpoint/browser.sh, never directly: the script
// stages these files next to web/node_modules and sets CHECKPOINT_URL,
// CHECKPOINT_OUT and CHECKPOINT_REPO.

import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env.CHECKPOINT_URL;
if (!baseURL) {
  throw new Error(
    "CHECKPOINT_URL is required (the release candidate's deploy preview)",
  );
}
const out = process.env.CHECKPOINT_OUT ?? "checkpoint-out";

export default defineConfig({
  testDir: ".",
  outputDir: `${out}/test-results`,
  fullyParallel: true,
  // Real-network runs against Netlify occasionally stall one navigation
  // under parallel load. One retry; report.py lists every retried test as
  // FLAKY so it is looked at, never silently passed.
  retries: 1,
  workers: 4,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: [
    ["list"],
    ["json", { outputFile: `${out}/playwright.json` }],
    ["html", { outputFolder: `${out}/playwright-report`, open: "never" }],
  ],
  use: {
    baseURL: baseURL.endsWith("/") ? baseURL : `${baseURL}/`,
    trace: "retain-on-failure",
  },
  projects: [
    { name: "chromium", use: { ...devices["Desktop Chrome"] } },
    { name: "firefox", use: { ...devices["Desktop Firefox"] } },
    { name: "webkit", use: { ...devices["Desktop Safari"] } },
  ],
});
