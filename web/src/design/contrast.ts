// WCAG 2.x contrast ratio (v1.3 spec §3.3): the check that keeps every
// text/focus/graphics token pair at AA — 4.5:1 for text, 3:1 for
// interface components and graphics — in both themes. contrastRatio
// takes opaque hex colors (#rgb/#rrggbb); compositeOver composites an
// rgb()/rgba() over a hex ground first, for translucent tokens like
// --color-accent-bg and the pair-panel aa tints.

/** sRGB channels (0–255) of a #rgb or #rrggbb color. */
function rgbChannels(hexColor: string): [number, number, number] {
  let hex = hexColor.startsWith("#") ? hexColor.slice(1) : hexColor;
  if (hex.length === 3) {
    hex = [...hex].map((c) => c + c).join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`unparseable hex color "${hexColor}"`);
  }
  return [
    parseInt(hex.slice(0, 2), 16),
    parseInt(hex.slice(2, 4), 16),
    parseInt(hex.slice(4, 6), 16),
  ];
}

function channel(v: number): number {
  const s = v / 255;
  return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a #rgb or #rrggbb color. */
export function luminance(hexColor: string): number {
  const [r, g, b] = rgbChannels(hexColor);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** WCAG 2.x contrast ratio between two opaque colors (1–21). */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Alpha-composite an `rgb()`/`rgba()` color over an opaque hex ground
 * and return the result as `#rrggbb`. The browser blends the encoded
 * sRGB channels (not linear light), so this does the same. */
export function compositeOver(rgbaColor: string, hexBg: string): string {
  const m =
    /^rgba?\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*(?:,\s*([\d.]+)\s*)?\)$/.exec(
      rgbaColor.trim(),
    );
  if (m === null) {
    throw new Error(`unparseable color "${rgbaColor}"`);
  }
  const a = m[4] === undefined ? 1 : Number(m[4]);
  const bg = rgbChannels(hexBg);
  const mix = (i: number) =>
    Math.round(Number(m[i]) * a + bg[i - 1] * (1 - a))
      .toString(16)
      .padStart(2, "0");
  return `#${mix(1)}${mix(2)}${mix(3)}`;
}
