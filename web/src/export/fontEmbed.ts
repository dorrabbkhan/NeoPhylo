// Font embedding for figure exports (v1.3 plan Task 15, spec §4.3):
// an exported SVG carries @font-face rules whose woff2 payloads are
// the bundled subsets — fetched by URL (the service worker precaches
// them, so exporting works offline after first load) and inlined as
// base64 data URIs.
//
// The faces' families, weights, files and unicode-ranges come from
// design/fontSubsets.ts — the one structured source src/design/
// fonts.css is written from (fonts.test.ts keeps them in sync), so
// the range lists are never duplicated.
//
// Reachable only from the lazy export chunk (Task 14's budget: this
// code must never enter the initial chunk).

import { FONT_FACES, rangesOf, type FontFaceDef } from "../design/fontSubsets";

/** The code points `texts` uses — `for…of` iterates code points, not
 * UTF-16 units, so an astral name like "🦋" counts once. */
function codePointsOf(texts: string[]): Set<number> {
  const cps = new Set<number>();
  for (const t of texts) {
    for (const ch of t) cps.add(ch.codePointAt(0)!);
  }
  return cps;
}

const covers = (face: FontFaceDef, cps: Set<number>): boolean =>
  rangesOf(face.rangeSpec).some(([lo, hi]) =>
    [...cps].some((cp) => cp >= lo && cp <= hi),
  );

/** The bundled files live at <base>/fonts/ — rebased onto the deploy
 * base so the fetch hits the precached URL on subpath installs too. */
function fontUrl(file: string): string {
  return `${import.meta.env.BASE_URL}fonts/${file}`;
}

/** One @font-face rule with the subset's bytes as a base64 data URI. */
async function faceCss(face: FontFaceDef): Promise<string> {
  const res = await fetch(fontUrl(face.file));
  if (!res.ok) {
    throw new Error(`font fetch failed: ${face.file} (${res.status})`);
  }
  const bytes = new Uint8Array(await res.arrayBuffer());
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return (
    `@font-face{font-family:"${face.family}";font-style:normal;` +
    `font-weight:${face.weight};font-display:block;` +
    `src:url("data:font/woff2;base64,${btoa(bin)}") format("woff2");` +
    `unicode-range:${face.rangeSpec}}`
  );
}

/**
 * @font-face CSS for exactly the bundled faces `texts` needs: every
 * declared face whose family is in `families` (all bundled families
 * when omitted), whose weight is in `weights`, and whose unicode-range
 * intersects the text's code points. The same input always produces
 * byte-identical output (FONT_FACES order, one rule per face).
 */
export async function fontFacesFor(
  texts: string[],
  weights: number[],
  families?: string[],
): Promise<string> {
  const cps = codePointsOf(texts);
  if (cps.size === 0) return "";
  const wanted = new Set(weights);
  const faces = FONT_FACES.filter(
    (f) =>
      (families === undefined || families.includes(f.family)) &&
      wanted.has(f.weight) &&
      covers(f, cps),
  );
  const css: string[] = [];
  for (const f of faces) {
    css.push(await faceCss(f));
  }
  return css.join("\n");
}

/**
 * The distinct characters in `texts` covered by no bundled subset —
 * the names that fall back per glyph on screen and may render
 * differently where an export is opened (Review Focus 1). Sorted for
 * a deterministic result.
 */
export function uncoveredChars(texts: string[]): string[] {
  const out = new Set<number>();
  for (const cp of codePointsOf(texts)) {
    const covered = FONT_FACES.some((f) =>
      rangesOf(f.rangeSpec).some(([lo, hi]) => cp >= lo && cp <= hi),
    );
    if (!covered) out.add(cp);
  }
  return [...out].map((cp) => String.fromCodePoint(cp)).sort();
}
