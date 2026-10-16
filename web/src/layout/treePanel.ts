// Tree panel sizing (UI polish). Pure functions, kept separate from
// rendering like phylogram.ts: a TreeView measures its panel with a
// ResizeObserver and derives the drawing geometry here.
//
// - leafSpacing fills the measured panel height, clamped to 18–48 px so
//   labels never collide or sprawl.
// - The drawing width leaves room on the right for the longest leaf
//   label; labelRoomFor estimates that room (~0.62 em per character).
// - Leaf labels are 14–16 px and grow with leafSpacing.
// App computes one leafSpacing from the tree row's height and passes it
// to both TreeViews, so their rows line up side by side.

export const LEAF_SPACING_MIN = 18;
export const LEAF_SPACING_MAX = 48;
const DEFAULT_SPACING = 24;

/** Total vertical padding inside the drawing box (top + bottom). */
export const TREE_PAD_Y = 16;
/** Approximate height of the figcaption row above the drawing box; App
 * subtracts it from the measured tree row to get the panel height. */
export const TREE_CAPTION_H = 24;

/** Leaf spacing that fills a panel of `panelHeight` px with `leafCount`
 * leaves, clamped to 18–48 px. Returns a neutral default before the
 * panel has been measured (height 0). */
export function leafSpacingFor(panelHeight: number, leafCount: number): number {
  if (!(panelHeight > 0) || leafCount <= 0) return DEFAULT_SPACING;
  const s = (panelHeight - TREE_PAD_Y) / leafCount;
  return Math.min(LEAF_SPACING_MAX, Math.max(LEAF_SPACING_MIN, s));
}

/** Leaf label size: 14–16 px, growing with the leaf spacing. */
export function leafFontSize(leafSpacing: number): number {
  return Math.min(16, Math.max(14, leafSpacing / 3));
}

/** Pixels reserved on the right of the drawing for the longest leaf
 * label (~0.62 em per character, plus the node dot and breathing room). */
export function labelRoomFor(
  labels: (string | null)[],
  fontSize: number,
): number {
  const longest = labels.reduce((m, l) => Math.max(m, l?.length ?? 0), 0);
  // 11 = label offset (4) + node radius (3) + right padding (4-ish).
  return Math.ceil(longest * fontSize * 0.62) + 15;
}
