// Shared geometry internals for the reading-tree layouts (v1.4d plan
// Task 6, spec §6): the constants every placement shares, the rotated
// label box helper, name abbreviation and the time-axis tick step.
// Not a public surface — `readingLayout` is the entry point.

import type { Box } from "./treeFigure";

export type { Box };

export const PAD = 8;
export const NODE_R = 3;
export const LABEL_GAP = 4;
/** Room reserved for the time axis: below the tree for tips
 * right/left, along its left side for tips up/down. */
export const AXIS_ROOM = 30;
/** Minimum drawable depth extent for tips-right/left; below it the
 * figure keeps its depth and scrolls instead. */
export const MIN_DEPTH_PX = 80;
/** Minimum circular radius; below it the figure scrolls. */
export const MIN_RADIUS_PX = 60;
/** Tips of a circular tree span this arc (spec §6: 330°). */
export const CIRCULAR_ARC_DEG = 330;
/** Slant of tip labels on tips-up/down drawings, degrees off
 * horizontal (spec §6 wants slanted labels on tips-up diagonal
 * trees). */
export const TIP_LABEL_SLANT_DEG = 80;
/** Labels longer than this abbreviate to ABBREV_KEEP chars + "…"
 * (plan decision: first 16 + "…"). */
export const ABBREV_MAX = 18;
export const ABBREV_KEEP = 16;

export const D2R = Math.PI / 180;

export function abbreviate(label: string): string {
  return label.length > ABBREV_MAX
    ? `${label.slice(0, ABBREV_KEEP)}…`
    : label;
}

/** A nice round tick step: 1, 2, 2.5 or 5 times a power of ten. */
export function niceStep(range: number, target: number): number {
  if (!(range > 0)) return 1;
  const raw = range / target;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (raw <= m * mag + 1e-12) return m * mag;
  }
  return 10 * mag;
}

export function fmtNum(v: number): string {
  return String(Number(v.toFixed(9)));
}

export function cladeKey(clade: string[]): string {
  return JSON.stringify([...clade].sort());
}

/** AABB of a label of width `w` rotated `deg` about its anchor
 * (`end`: text occupies [-w, 0] locally — flipped circular labels and
 * tips-left). Offsets relative to the anchor; `asc`/`desc` are the
 * estimated extents above and below a middle baseline. */
export function rotBox(
  w: number,
  deg: number,
  end: boolean,
  asc: number,
  desc: number,
): Box {
  const th = deg * D2R;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const x0 = end ? -w : 0;
  const x1 = end ? 0 : w;
  const xs: number[] = [];
  const ys: number[] = [];
  for (const [lx, ly] of [
    [x0, -asc],
    [x1, -asc],
    [x1, desc],
    [x0, desc],
  ] as const) {
    xs.push(lx * c - ly * s);
    ys.push(lx * s + ly * c);
  }
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}
