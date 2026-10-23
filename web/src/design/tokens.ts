// Design tokens — the single source of truth for color, type, spacing,
// radii, shadows and font stacks (v1.3 spec §3). tokensCssPlugin turns
// cssVariables() into generated CSS custom properties
// (src/design/tokens.css, gitignored, never hand-edited); the tree
// renderer and exports import this file directly.
//
// Literal colors and font sizes may live ONLY here:
// scripts/check-token-discipline.mjs enforces §3.4.
//
// Task 6 lands the real themes: light is the projector-friendly
// default (near-white bg, dark text, purple accent ≥ 3:1) and dark is
// the refined low-light palette; the contrast contract in
// design/contrast.test.ts pins the WCAG pairs for both.

export type ThemeName = "light" | "dark";

export interface ColorTokens {
  bg: string;
  surface: string;
  surface2: string;
  border: string;
  text: string;
  textMuted: string;
  accent: string;
  accentContrast: string;
  focus: string;
  supportWeak: string;
  wrongClade: string;
  saturationHatch: string;
  highlight: string;
  danger: string;
  success: string;
}

/** Per-theme colors — identical to the pre-token stylesheet. */
export const color: Record<ThemeName, ColorTokens> = {
  light: {
    bg: "#ffffff",
    surface: "#fafaf9",
    surface2: "#f4f3ec",
    border: "#e5e4e7",
    // --fg: primary content color (text, controls, SVG lines/text).
    text: "#241f2e",
    // --text: the muted body color the old :root painted.
    textMuted: "#6b6375",
    accent: "#aa3bff",
    // --accent-text: accent-colored text legible on accent-bg/white
    // (--accent itself is too light for text).
    accentContrast: "#6d28d9",
    focus: "#6d28d9",
    // Weak support reads as a warm "caution" amber — a supplementary
    // cue only: the thinner stroke + "*" glyph still carry it (never
    // color alone). 5.0:1 on bg.
    supportWeak: "#b45309",
    wrongClade: "#b3261e",
    // The heatmap's saturated-cell hatch stroke (MatrixHeatmap pattern).
    saturationHatch: "#666666",
    // Highlighted clades draw in the accent — thicker stroke carries
    // the emphasis; the color just names it.
    highlight: "#aa3bff",
    danger: "#b3261e",
    // The pre-token `var(--ok, #1a7f37)` value — 4.8:1 on the light
    // ground; dark lifts it (see below).
    success: "#1a7f37",
  },
  dark: {
    bg: "#16171d",
    surface: "#1c1d24",
    surface2: "#1f2028",
    border: "#2e303a",
    text: "#e5e7eb",
    textMuted: "#9ca3af",
    accent: "#c084fc",
    accentContrast: "#c084fc",
    focus: "#c084fc",
    // The same caution amber as light, lifted for the dark ground.
    supportWeak: "#fbbf24",
    wrongClade: "#f28b82",
    saturationHatch: "#666666",
    highlight: "#c084fc",
    danger: "#f28b82",
    // v1.3 Task 6: #1a7f37 was ~3.3:1 on the dark ground — short of
    // the 4.5:1 body-text bar for the "Correct" verdict. 6.4:1.
    success: "#3fb950",
  },
};

/** Type scale in px (§3.2); 12 is the minimum anywhere. Task 6 moved
 * the pre-token 9/11/13/15/17 px uses onto this scale
 * (9/11 → xs, 13 → sm, 15 → md, 17 → lg). */
export const size = { xs: 12, sm: 14, md: 16, lg: 20, xl: 24, xxl: 32 } as const;

/** Spacing scale in px (§3.2). */
export const space = [4, 8, 12, 16, 24, 32, 48] as const;

export const radius = { sm: 4, md: 8, lg: 12 } as const;

/** Full font stacks — bundled faces first (Task 4 ships the subset
 * woff2 files and the @font-face rules in fonts.css; the tails stay
 * the same system fallbacks as before). */
export const font = {
  ui: '"Inter", system-ui, sans-serif',
  mono: '"JetBrains Mono", ui-monospace, monospace',
};

/** Elevation shadows (§3.2) — the two the stylesheet already used. */
export const shadow = {
  sm: "0 4px 16px rgba(0, 0, 0, 0.15)",
  md: "0 8px 30px rgba(0, 0, 0, 0.25)",
} as const;

// --- Derived values (per theme, emitted by cssVariables below) ---

// The stylesheet's third text level for headings (--text-h): kept as
// a derived var — headings take the darkest ink in both themes.
const HEADING_TEXT: Record<ThemeName, string> = {
  light: "#08060d",
  dark: "#f3f4f6",
};

// Accent tints derive from the theme accent at the stylesheet's own
// ratios (fill 0.10 light / 0.15 dark; border 0.50 both).
const ACCENT_BG_ALPHA: Record<ThemeName, number> = { light: 0.1, dark: 0.15 };
const ACCENT_BORDER_ALPHA = 0.5;

// Dialog scrim behind .pair-panel/.replicate-panel — unthemed today.
const SCRIM = "rgba(0, 0, 0, 0.35)";

// The standalone SVG export's ink — kept at the pre-token #1a1a1a so
// Task 3's export is byte-identical (owner decision on PR #65). It is
// deliberately NOT a ColorTokens key: recoloring exports to the §7.3
// print palette is Task 15's scope.
export const exportInk = "#1a1a1a";

// Okabe-Ito property tints behind the pair panel's aligned sequences.
// The residue ink is the theme's own `text` color: on light it sits on
// the near-white composites; on dark the same translucent tints
// composite to deep shades over the dark surface, where the light ink
// reads instead. The dark `special` alpha drops so its composite stays
// dark enough — contrast.test.ts asserts every composited pair ≥ 4.5:1.
const AA_TINT: Record<ThemeName, Record<string, string>> = {
  light: {
    hydro: "rgba(0, 114, 178, 0.22)",
    polar: "rgba(0, 158, 115, 0.22)",
    pos: "rgba(213, 94, 0, 0.22)",
    neg: "rgba(204, 121, 167, 0.32)",
    special: "rgba(240, 228, 66, 0.45)",
  },
  dark: {
    hydro: "rgba(0, 114, 178, 0.22)",
    polar: "rgba(0, 158, 115, 0.22)",
    pos: "rgba(213, 94, 0, 0.22)",
    neg: "rgba(204, 121, 167, 0.32)",
    special: "rgba(240, 228, 66, 0.25)",
  },
};

const kebab = (key: string): string =>
  key.replace(/([a-z0-9])([A-Z0-9])/g, "$1-$2").toLowerCase();

function rgba(hex: string, alpha: number): string {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

/**
 * Every CSS custom property for `theme`: `--color-<kebab>` for each
 * ColorTokens key, the derived heading/accent-tint/scrim/aa colors, and
 * the theme-independent `--font-*`, `--size-*`, `--space-*`,
 * `--radius-*` and `--shadow-*` vars.
 */
export function cssVariables(theme: ThemeName): Record<`--${string}`, string> {
  const vars: Record<`--${string}`, string> = {};
  const c = color[theme];
  for (const [key, value] of Object.entries(c)) {
    vars[`--color-${kebab(key)}` as `--${string}`] = value;
  }
  vars["--color-text-h"] = HEADING_TEXT[theme];
  vars["--color-accent-bg"] = rgba(c.accent, ACCENT_BG_ALPHA[theme]);
  vars["--color-accent-border"] = rgba(c.accent, ACCENT_BORDER_ALPHA);
  vars["--color-scrim"] = SCRIM;
  vars["--color-aa-text"] = c.text;
  for (const [key, value] of Object.entries(AA_TINT[theme])) {
    vars[`--color-aa-${key}`] = value;
  }
  vars["--font-ui"] = font.ui;
  vars["--font-mono"] = font.mono;
  for (const [key, v] of Object.entries(size)) {
    vars[`--size-${key}`] = `${v}px`;
  }
  for (const n of space) {
    vars[`--space-${n}`] = `${n}px`;
  }
  for (const [key, v] of Object.entries(radius)) {
    vars[`--radius-${key}`] = `${v}px`;
  }
  for (const [key, v] of Object.entries(shadow)) {
    vars[`--shadow-${key}`] = v;
  }
  return vars;
}
