// Regenerates the committed brand assets in web/public/brand/ from the
// owner-chosen mark web/public/brand/icon.svg (v1.3 spec §5 — Option C,
// docs/decisions.md "v1.3 Task 7"). Every asset renders that file
// through Playwright: the mark is never redrawn. favicon.ico packs the
// 16/32/48 px PNGs; the maskable icon and the og-image use the light
// palette's bg/text tokens (brand assets are theme-independent).
//
// Run inside the pinned CI Playwright image — the same renderer the
// visual baselines use (web/node_modules must be installed):
//
//   node scripts/brand/generate.ts

import { readFile, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { color } from "../../web/src/design/tokens.ts";

/** The spec §5 tagline, rendered verbatim into og-image.png. */
export const OG_TAGLINE =
  "Learn how phylogenetic trees are built, step by step";

/** Maskable safe margin each side (spec §5: ≥ 10%). */
export const MASKABLE_MARGIN = 0.15;

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const BRAND = join(ROOT, "web/public/brand");
const ICON_FILE = join(BRAND, "icon.svg");
const FONT_DIR = join(ROOT, "web/public/fonts");
const LIGHT = color.light;

type Browser = Awaited<
  ReturnType<typeof import("playwright").chromium.launch>
>;
type Page = Awaited<ReturnType<Browser["newPage"]>>;

/** icon.svg sized to `px` (it carries a viewBox, so width/height scale it). */
function sizedSvg(svg: string, px: number): string {
  return svg.replace("<svg ", `<svg width="${px}" height="${px}" `);
}

function pageHtml(body: string): string {
  return `<!doctype html><html><body style="margin:0;padding:0">${body}</body></html>`;
}

/** The og-image card: icon, "NeoPhylo" in Inter 600 and the tagline. */
export function ogImageHtml(
  svg: string,
  inter600: string,
  inter400: string,
): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
@font-face{font-family:Inter;src:url(data:font/woff2;base64,${inter400}) format("woff2");font-weight:400}
@font-face{font-family:Inter;src:url(data:font/woff2;base64,${inter600}) format("woff2");font-weight:600}
*{margin:0;box-sizing:border-box}
body{width:1200px;height:630px;background:${LIGHT.bg};display:flex;align-items:center;padding:0 80px}
.brand{display:flex;align-items:center;gap:40px}
.icon svg{display:block;width:160px;height:160px}
h1{font:600 110px Inter,system-ui,sans-serif;color:${LIGHT.text};letter-spacing:-0.02em}
p{margin-top:24px;font:400 44px Inter,system-ui,sans-serif;color:${LIGHT.textMuted}}
</style></head><body><div class="brand"><div class="icon">${svg}</div><div><h1>NeoPhylo</h1><p>${OG_TAGLINE}</p></div></div></body></html>`;
}

/** ICO container with PNG-compressed entries (Vista+). */
export function packIco(
  images: { size: number; png: Uint8Array }[],
): Uint8Array {
  const header = Buffer.alloc(6 + images.length * 16);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  const parts: Uint8Array[] = [header];
  let offset = header.length;
  images.forEach((img, i) => {
    const entry = 6 + i * 16;
    const dim = img.size >= 256 ? 0 : img.size;
    header.writeUInt8(dim, entry);
    header.writeUInt8(dim, entry + 1);
    header.writeUInt8(0, entry + 2); // palette colors
    header.writeUInt8(0, entry + 3); // reserved
    header.writeUInt16LE(1, entry + 4); // color planes
    header.writeUInt16LE(32, entry + 6); // bpp
    header.writeUInt32LE(img.png.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += img.png.length;
    parts.push(img.png);
  });
  return Buffer.concat(parts);
}

async function shot(
  page: Page,
  html: string,
  w: number,
  h: number,
  transparent: boolean,
): Promise<Uint8Array> {
  await page.setViewportSize({ width: w, height: h });
  await page.setContent(html);
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  return page.screenshot({ omitBackground: transparent });
}

async function main(): Promise<void> {
  const require = createRequire(join(ROOT, "web/package.json"));
  const { chromium } = require("playwright") as typeof import("playwright");

  const svg = await readFile(ICON_FILE, "utf8");
  const browser = await chromium.launch();
  const written: string[] = [];
  const write = async (name: string, data: Uint8Array) => {
    await writeFile(join(BRAND, name), data);
    written.push(`${name} (${data.length} B)`);
  };
  try {
    const page = await browser.newPage();
    const transparentIcon = async (px: number) =>
      shot(page, pageHtml(sizedSvg(svg, px)), px, px, true);

    // favicon.ico: 16/32/48 px PNG entries.
    const ico = packIco([
      { size: 16, png: await transparentIcon(16) },
      { size: 32, png: await transparentIcon(32) },
      { size: 48, png: await transparentIcon(48) },
    ]);
    await write("favicon.ico", ico);

    // Solid-background icons: the apple touch icon (transparency would
    // composite onto black) and the maskable icon, whose mark stays
    // inside the (1 − 2·MASKABLE_MARGIN) safe square.
    await write(
      "apple-touch-icon.png",
      await shot(
        page,
        pageHtml(
          `<div style="width:180px;height:180px;background:${LIGHT.bg};display:grid;place-items:center">${sizedSvg(svg, 140)}</div>`,
        ),
        180,
        180,
        false,
      ),
    );
    await write("icon-192.png", await transparentIcon(192));
    await write("icon-512.png", await transparentIcon(512));
    const markPx = Math.round(512 * (1 - 2 * MASKABLE_MARGIN));
    await write(
      "icon-maskable-512.png",
      await shot(
        page,
        pageHtml(
          `<div style="width:512px;height:512px;background:${LIGHT.bg};display:grid;place-items:center">${sizedSvg(svg, markPx)}</div>`,
        ),
        512,
        512,
        false,
      ),
    );

    // og-image.png (1200×630): wordmark, icon and the spec §5 tagline.
    const [inter600, inter400] = await Promise.all(
      ["inter-600-latin.woff2", "inter-400-latin.woff2"].map(async (f) =>
        (await readFile(join(FONT_DIR, f))).toString("base64"),
      ),
    );
    await write(
      "og-image.png",
      await shot(page, ogImageHtml(svg, inter600, inter400), 1200, 630, false),
    );
  } finally {
    await browser.close();
  }
  console.log(`brand assets written to ${basename(BRAND)}/:`);
  for (const line of written) console.log(`  ${line}`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await main();
}
