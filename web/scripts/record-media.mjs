// Records the docs/media/ assets:
//   nj        — a mid-lesson screenshot of nj-basics plus a Playwright
//               video of stepping through NJ, which a maintainer converts
//               to nj-step-through.gif with ffmpeg (< 3 MB; palette
//               filter, fps=10, 960px);
//   pair-panel — a screenshot of the protein "How was this distance
//               computed?" dialog (aligned sequences, p/Kimura/JTT and
//               the likelihood curve).
// Requires the dev server: npm run dev -- --port 4173
//   node scripts/record-media.mjs           # all scenes
//   node scripts/record-media.mjs pair-panel  # one scene only
// Output: ../docs/media/nj-basics-mid-lesson.png,
//         ../docs/media/nj-step-through.webm (convert to .gif, < 3 MB),
//         ../docs/media/protein-pair-panel.png.

import { chromium } from "playwright";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const BASE = process.env.BASE_URL ?? "http://localhost:4173";
const OUT_DIR = fileURLToPath(new URL("../../docs/media/", import.meta.url));
const P6_150 = fileURLToPath(
  new URL("../../fixtures/inputs/protein/p6_150.fasta", import.meta.url),
);
const VIDEO_DIR = "/tmp/neophylo-video";
const PAUSE = 1100; // ms between actions, so the GIF reads clearly

const SCENES = process.argv.slice(2);
const wanted = (name) => SCENES.length === 0 || SCENES.includes(name);

await mkdir(OUT_DIR, { recursive: true });

const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  recordVideo: wanted("nj")
    ? { dir: VIDEO_DIR, size: { width: 1440, height: 900 } }
    : undefined,
});
const page = await ctx.newPage();

/** Index of the minimum off-diagonal cell in the matrix view on screen. */
async function minCell() {
  const cells = page.locator('[role="gridcell"]');
  const count = await cells.count();
  let best = -1;
  let bestVal = Infinity;
  for (let c = 0; c < count; c++) {
    const cell = cells.nth(c);
    const i = Number(await cell.getAttribute("data-i"));
    const j = Number(await cell.getAttribute("data-j"));
    if (j <= i) continue;
    const label = (await cell.getAttribute("aria-label")) ?? "";
    const v = Number(label.slice(label.lastIndexOf(":") + 1));
    if (v < bestVal) {
      bestVal = v;
      best = c;
    }
  }
  return best;
}

/** Click the minimum-Q cell (the correct predict_pair answer). */
async function answerPredictPrompt() {
  const qToggle = page.getByRole("switch", { name: "Distance / Q" });
  const switched =
    (await qToggle.count()) > 0 &&
    (await qToggle.getAttribute("aria-checked")) === "false";
  if (switched) await qToggle.click();
  const best = await minCell();
  await page.locator('[role="gridcell"]').nth(best).click();
  await page.waitForTimeout(PAUSE);
  if (switched) await qToggle.click();
}

if (wanted("nj")) {
  await page.goto(`${BASE}/?lesson=nj-basics`);
  await page.locator(".app").waitFor();
  await page.waitForTimeout(PAUSE);

  // Prompt at join 1 gates position 0 — answer it (minimum-Q cell).
  await answerPredictPrompt();

  // Two steps lands on position 2, gated by the join-3 prompt: mid-lesson.
  const next = page.getByRole("button", { name: "Next step" });
  await next.click();
  await page.waitForTimeout(PAUSE);
  await next.click();
  await page.waitForTimeout(PAUSE);
  await page.screenshot({
    path: `${OUT_DIR}nj-basics-mid-lesson.png`,
    fullPage: false,
  });
  await page.waitForTimeout(PAUSE / 2);

  // The intended student mistake: pick the closest pair, see the reveal.
  const distMin = await minCell();
  await page.locator('[role="gridcell"]').nth(distMin).click();
  await page.waitForTimeout(PAUSE * 1.5);

  // Step through the remaining joins and hold on the finished tree
  // (RF = 0 / 6).
  for (;;) {
    if (await next.isDisabled()) break;
    await next.click();
    await page.waitForTimeout(PAUSE * 1.4);
  }
  await page.waitForTimeout(PAUSE * 2);
}

if (wanted("pair-panel")) {
  // Sandbox + a protein alignment, then a distance-matrix cell opens the
  // "How was this distance computed?" dialog (v1.1 spec §5.2).
  await page.goto(BASE);
  await page.locator(".app").waitFor();
  await page.getByRole("radio", { name: "Sandbox" }).click();
  await page
    .locator('.import-panel input[type="file"]')
    .setInputFiles(P6_150);
  await page.locator('[role="gridcell"]').first().waitFor();
  await page.waitForTimeout(PAUSE);
  await page.locator('[role="gridcell"][data-i="0"][data-j="1"]').click();
  await page.getByRole("dialog").waitFor();
  await page.waitForTimeout(PAUSE);
  await page.screenshot({
    path: `${OUT_DIR}protein-pair-panel.png`,
    fullPage: false,
  });
}

await ctx.close(); // finalizes the video
if (wanted("nj")) {
  const video = page.video();
  if (video) {
    await video.saveAs(`${OUT_DIR}nj-step-through.webm`);
  }
}
await browser.close();
console.log(`wrote scenes to ${OUT_DIR}`);
