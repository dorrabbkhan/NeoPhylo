// WCAG 2.x contrast ratio (v1.3 spec §3.3): the check that keeps every
// text/focus/graphics token pair at AA — 4.5:1 for text, 3:1 for
// interface components and graphics — in both themes. Tokens are hex
// colors, so only #rgb and #rrggbb parse.

function channel(hex: string, i: number): number {
  const v = parseInt(hex.slice(i, i + 2), 16) / 255;
  return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
}

/** WCAG relative luminance of a #rgb or #rrggbb color. */
export function luminance(hexColor: string): number {
  let hex = hexColor.startsWith("#") ? hexColor.slice(1) : hexColor;
  if (hex.length === 3) {
    hex = [...hex].map((c) => c + c).join("");
  }
  if (!/^[0-9a-fA-F]{6}$/.test(hex)) {
    throw new Error(`contrastRatio: unparseable color "${hexColor}"`);
  }
  return (
    0.2126 * channel(hex, 0) +
    0.7152 * channel(hex, 2) +
    0.0722 * channel(hex, 4)
  );
}

/** WCAG 2.x contrast ratio between two opaque colors (1–21). */
export function contrastRatio(fg: string, bg: string): number {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}
