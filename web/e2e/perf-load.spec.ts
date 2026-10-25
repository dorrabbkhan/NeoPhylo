// Load-path budgets (v1.3 plan Task 14, spec §7.2 "Lazy KaTeX" and §8.2
// "Performance"):
//
//   - KaTeX is a lazy chunk: the initial document load never requests
//     it; the first Math view shows exactly "Loading formulas…" while
//     the chunk is fetched once through a shared cached promise, and
//     toggling back to Math never refetches it.
//   - The service worker precaches the KaTeX chunk, its CSS and the
//     KaTeX woff2 faces, so after one online load Math renders offline
//     with KaTeX's own fonts, not a fallback.
//   - @perf: time to the first rendered tree under Fast-3G throttling
//     stays within 110% of the v1.2.0 baseline.
//
// All three run against the production preview (:4174) — chunk shape
// and the service worker only exist in the built app, and wall-clock
// budgets are meaningless under dev-mode transforms.

import { test, expect } from "@playwright/test";

import {
  answerPredictPrompt,
  waitForApp,
  waitForServiceWorkerReady,
} from "./helpers";

const PREVIEW_URL = "http://localhost:4174";

/** Chromium DevTools' "Fast 3G" preset as handed to
 * Network.emulateNetworkConditions (devtools-frontend
 * NetworkManager.ts; the same constants are Puppeteer's
 * PredefinedNetworkConditions["Fast 3G"]): the ~1.6 Mbps down /
 * ~750 Kbps up / 150 ms RTT profile with DevTools' correction factors
 * folded in — throughput ×0.9, latency ×3.75. */
const FAST_3G = {
  offline: false,
  latency: 150 * 3.75, // 562.5 ms
  downloadThroughput: (1.6e6 / 8) * 0.9, // 180000 bytes/s
  uploadThroughput: (750e3 / 8) * 0.9, // 84375 bytes/s
};

// v1.2.0 (tag) measured at task start in the pinned Playwright image,
// median of 7 cold loads to the first .trees svg: 6145 ms. The §8.2
// budget is the v1.2 value × 1.10. (main at 679e5f9 measured 5193 ms
// the same way.)
const FIRST_TREE_BUDGET_MS = Math.ceil(6145 * 1.1); // 6760

test.describe("lazy KaTeX chunk", () => {
  // The service worker legitimately precaches the KaTeX chunk during
  // install (spec §7.2); block it here so the request log measures only
  // what the document itself needs.
  test.use({ serviceWorkers: "block" });

  test("initial load fetches no KaTeX chunk; Math shows the placeholder then fetches it once", async ({
    page,
  }) => {
    const jsChunkRequests: string[] = [];
    page.on("request", (r) => {
      const u = new URL(r.url());
      if (u.pathname.startsWith("/assets/") && u.pathname.endsWith(".js")) {
        jsChunkRequests.push(u.pathname);
      }
    });

    await page.goto(`${PREVIEW_URL}/?lesson=nj-basics`);
    await waitForApp(page);
    const initialChunks = new Set(jsChunkRequests);
    // Step 0 sits behind the at_step=1 predict_pair gate — answer it so
    // the explanation panel has math lines to render.
    await answerPredictPrompt(page);

    // Delay every later chunk fetch so the loading state is observable
    // even though the preview server is local.
    await page.route("**/assets/*.js", async (route) => {
      await new Promise((r) => setTimeout(r, 1200));
      await route.continue();
    });

    await page.getByRole("button", { name: "Math", exact: true }).click();
    await expect(
      page.getByText("Loading formulas…").first(),
    ).toBeVisible();
    await expect(page.locator(".katex").first()).toBeVisible();

    const fetched = jsChunkRequests.filter((u) => !initialChunks.has(u));
    expect(
      fetched,
      `expected exactly one lazy chunk fetch, got: ${fetched.join(", ")}`,
    ).toHaveLength(1);

    // The shared promise is cached: toggling Concept → Math refetches
    // nothing and skips the placeholder.
    await page.getByRole("button", { name: "Concept" }).click();
    await page.getByRole("button", { name: "Math", exact: true }).click();
    await expect(page.locator(".katex").first()).toBeVisible();
    await expect(page.getByText("Loading formulas…")).toHaveCount(0);
    expect(jsChunkRequests.filter((u) => !initialChunks.has(u))).toEqual(
      fetched,
    );
  });
});

test("after one online load, Math renders offline with KaTeX's own fonts", async ({
  page,
  context,
  browserName,
}) => {
  // Same Chromium-only driver limitation as the a11y offline spec:
  // Playwright's setOffline rejects SW-served navigations on Firefox and
  // WebKit. The precache contract is identical on every engine.
  test.skip(browserName !== "chromium");

  await page.goto(`${PREVIEW_URL}/?lesson=nj-basics`);
  await waitForApp(page);
  // An ACTIVATED worker means the precache — app shell, the KaTeX chunk,
  // its CSS and the KaTeX woff2 faces — is fully populated. Math is
  // never opened online here: the offline render below comes entirely
  // from the precache.
  await waitForServiceWorkerReady(page);

  await context.setOffline(true);
  await expect(async () => {
    await page.reload({ timeout: 8_000 });
    await waitForApp(page);
  }).toPass({ timeout: 45_000, intervals: [500, 1_000, 2_000] });

  // Same gate as the lazy test: answer the step-0 prediction so the
  // panel has math lines, all offline.
  await answerPredictPrompt(page);
  await page.getByRole("button", { name: "Math", exact: true }).click();
  await expect(page.locator(".katex").first()).toBeVisible();
  // KaTeX's own faces must render the formula — a system fallback would
  // mean the fonts never reached the cache offline.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.fonts.check('12px "KaTeX_Main"') &&
          document.fonts.check('italic 12px "KaTeX_Math"'),
      ),
    )
    .toBe(true);
});

test(
  "first rendered tree within 110% of the v1.2 Fast-3G baseline",
  { tag: "@perf" },
  async ({ page, context, browserName }) => {
    test.skip(browserName !== "chromium");
    const cdp = await context.newCDPSession(page);
    await cdp.send("Network.enable");
    await cdp.send("Network.emulateNetworkConditions", FAST_3G);

    const t0 = Date.now();
    await page.goto(`${PREVIEW_URL}/`, {
      waitUntil: "domcontentloaded",
      timeout: 120_000,
    });
    await page.locator(".trees svg").first().waitFor({
      state: "visible",
      timeout: 120_000,
    });
    const elapsed = Date.now() - t0;

    console.log(
      `perf-load: Fast 3G first rendered tree took ${elapsed} ms ` +
        `(v1.2.0 baseline 6145 ms, budget ${FIRST_TREE_BUDGET_MS} ms)`,
    );
    expect(
      elapsed,
      `first rendered tree took ${elapsed} ms (budget ${FIRST_TREE_BUDGET_MS} ms)`,
    ).toBeLessThanOrEqual(FIRST_TREE_BUDGET_MS);
  },
);
