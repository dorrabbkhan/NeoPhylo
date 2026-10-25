// Bundled font subsets (v1.3 spec §4.1): the single structured source
// for family, weight, subset name, file and unicode-range. The
// committed src/design/fonts.css is the stylesheet form of this list
// (fonts.test.ts asserts every rule matches, so the two can never
// drift), and export/fontEmbed.ts picks the faces a figure's text
// needs from the same ranges — the range lists live here and here
// only.

export type FontSubset = "latin" | "latin-ext" | "greek" | "cyrillic";

export interface FontFaceDef {
  family: string;
  weight: number;
  subset: FontSubset;
  /** File name under web/public/fonts/. */
  file: string;
  /** The unicode-range spec text (whitespace-folded, as fonts.css
   * writes it). */
  rangeSpec: string;
}

// The standard Google Fonts subset ranges (spec §4.1).
const RANGE_SPEC: Record<FontSubset, string> = {
  latin:
    "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, " +
    "U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, " +
    "U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
  "latin-ext":
    "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, " +
    "U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, " +
    "U+2020, U+20A0-20AB, U+20AD-20C4, U+2113, U+2C60-2C7F, U+A720-A7FF",
  greek: "U+0370-0377, U+037A-037F, U+0384-038A, U+038C, U+038E-03A1, U+03A3-03FF",
  cyrillic: "U+0301, U+0400-045F, U+0490-0491, U+04B0-04B1, U+2116",
};

const FAMILIES: { family: string; slug: string; weights: number[] }[] = [
  { family: "Inter", slug: "inter", weights: [400, 500, 600] },
  { family: "JetBrains Mono", slug: "jetbrains-mono", weights: [400] },
];

export const FONT_SUBSETS = [
  "latin",
  "latin-ext",
  "greek",
  "cyrillic",
] as const satisfies readonly FontSubset[];

/** Every bundled face, in fonts.css's declaration order — family by
 * family, weight by weight, subset by subset. The order is part of
 * the contract: fontEmbed emits faces in this order so its output is
 * deterministic. */
export const FONT_FACES: FontFaceDef[] = FAMILIES.flatMap(
  ({ family, slug, weights }) =>
    weights.flatMap((weight) =>
      FONT_SUBSETS.map((subset) => ({
        family,
        weight,
        subset,
        file: `${slug}-${weight}-${subset}.woff2`,
        rangeSpec: RANGE_SPEC[subset],
      })),
    ),
);

/** Inclusive [lo, hi] code-point ranges of a subset's rangeSpec. */
export function rangesOf(rangeSpec: string): [number, number][] {
  const out: [number, number][] = [];
  for (const part of rangeSpec.split(",")) {
    const m = /U\+([0-9A-Fa-f]{1,6})(?:-([0-9A-Fa-f]{1,6}))?/.exec(
      part.trim(),
    );
    if (m === null) continue;
    const lo = parseInt(m[1], 16);
    out.push([lo, m[2] === undefined ? lo : parseInt(m[2], 16)]);
  }
  return out;
}
