/// <reference types="node" />
// Test helper (v1.3 Task 15): export/fontEmbed fetches the bundled
// woff2 subsets by URL; in jsdom there is no server, so stub fetch to
// serve the real files from web/public/fonts/. Tests that exercise
// exportSvg or the ExportMenu's export handlers need the same stub —
// the embedded bytes are then the genuine committed fonts.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { vi } from "vitest";

/** Stub fetch so only /fonts/*.woff2 URLs resolve, from the committed
 * files under web/public/fonts. Any other request rejects — an export
 * that fetched something unexpected fails loudly. */
export function stubFontFetch(): void {
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    const path = new URL(url, "http://localhost/").pathname;
    if (!path.startsWith("/fonts/") || !path.endsWith(".woff2")) {
      return new Response("not found", { status: 404 });
    }
    const bytes = readFileSync(resolve("public", path.replace(/^\//, "")));
    return new Response(bytes, { status: 200 });
  });
}
