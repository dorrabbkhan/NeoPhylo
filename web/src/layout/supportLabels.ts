// Support-label placement (v1.2 spec §6.3; owner checkpoint 21-10-26,
// refined same day). Pure geometry: given the laid-out tree, each
// internal branch's support percentage is drawn as a small pill just
// ABOVE the horizontal segment that leads into its node, right-aligned
// near the node end and holding the node's own y. A short incoming
// segment is NOT stretched to fit: the pill simply extends left past
// the segment's start, over the parent's vertical line — the opaque
// pill background masks the line beneath it.
//
// Collision avoidance: only labels, leaf names and node markers are
// obstacles (the drawn "0" marker counts as a marker — covering text
// with a pill would look broken). Branch lines and connectors are NOT
// obstacles; the pill is meant to mask whatever it covers. When the
// right-aligned spot is blocked the pill is nudged vertically, ± 6 px
// down first — it stays closest to its node's row that way — then
// further DOWN while its centre stays within 10 px of the row (it may
// cover its own segment; masked like any line). Only an unresolved
// collision earns a leader line: the pill climbs
// to a clear offset and a thin leader runs to the node, routed so it
// crosses no branch — attach points are tried along the pill's bottom
// edge right-to-left, then up its right edge, keeping the first one
// whose straight line to the node clears every drawn segment and
// connector.
//
// Text metrics come from the caller's `measure` (a real
// getComputedTextLength probe — see src/measureText.ts) so placement
// is correct whatever font is installed; when the DOM is unavailable
// (jsdom, workers) it returns null and the 0.62 em per character
// estimate (like labelRoomFor) stands in, padded as before.

import type { Tree } from "../engine/generated/Tree";
import type { Layout } from "./phylogram";

export interface LabelBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface SupportLabel {
  /** Node whose incoming branch carries the value. */
  id: number;
  /** The drawn text, Math.round(100·s). */
  text: string;
  /** s < 0.5: the branch's thin "weak" styling plus a marker glyph. */
  weak: boolean;
  /** Pill bounds in drawing coordinates (before TreeView's pad). */
  box: LabelBox;
  /** Baseline anchor for the text (textAnchor middle). */
  textX: number;
  textY: number;
  /** Set only when a collision survived the ±6 px nudge: the pill is
   * offset and a thin leader runs to the node, crossing no branch.
   * Both renderers draw it from the same geometry. */
  leader?: { x1: number; y1: number; x2: number; y2: number };
}

export interface SupportLabelOptions {
  /** Support-label font size in px (the app's minimum is 12). */
  fontSize: number;
  /** Leaf-name font size in px, for the name obstacle boxes. */
  nameFontSize: number;
  /** Node marker radius including highlight slack. */
  nodeRadius: number;
  /** Gap between a leaf's marker and the start of its name. */
  labelOffset: number;
  /** Estimated character width; defaults to 0.62 em like treePanel.
   * Used only when `measure` is absent or returns null. */
  charWidth?: number;
  /** Real glyph extents of `text` rendered at `fontSize` in the app's
   * font — a getComputedTextLength + getBBox probe (TextExtents from
   * src/measureText.ts). Returns null where the DOM can't measure;
   * the estimates then stand in. */
  measure?: (
    text: string,
    fontSize: number,
    baseline?: "middle" | "alphabetic",
  ) => { w: number; top: number; bottom: number } | null;
}

const GAP = 2;
const PILL_PAD_X = 5;
const PILL_PAD_Y = 2;
// A name or marker box is slightly larger than the glyph estimate so a
// pill never visually grazes the text it avoids.
const NAME_PAD = 2;
// The spec'd "small vertical nudge": ±NUDGE px around the base spot.
const NUDGE = 6;
// If even that band is blocked the pill keeps descending — it may
// cover its own incoming segment (masked like any branch line) and
// still belongs to its node's row as long as its centre stays within
// the 10 px acceptance bound. Upward is not extended: a pill pushed
// above its row starts to read as the row above's label.
const DROP_PAD = 10;
// Extra lift for a leader-offset pill: clearly off the row it
// annotates, close enough that the leader reads as a callout.
const LEADER_RAISE = 10;

const EPS = 1e-9;

/** The drawn text: the rounded percent, "*" merged in for weak. */
export function supportText(s: number): string {
  return `${Math.round(s * 100)}${s < 0.5 ? "*" : ""}`;
}

/** Padded pill width for `text` at `fontSize` (0.62 em estimate). */
export function pillWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.62 + PILL_PAD_X * 2;
}

function intersects(a: LabelBox, b: LabelBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * True when segment a shares more than its (x2, y2) endpoint with
 * segment b — a proper crossing, a grazing touch at an interior point,
 * or a collinear run. An intersection exactly at (x2, y2) is the
 * leader landing on its node, not a crossing.
 */
function segHits(a: Seg, b: Seg): boolean {
  const rx = a.x2 - a.x1;
  const ry = a.y2 - a.y1;
  const sx = b.x2 - b.x1;
  const sy = b.y2 - b.y1;
  const den = rx * sy - ry * sx;
  const qx = b.x1 - a.x1;
  const qy = b.y1 - a.y1;
  if (Math.abs(den) < EPS) {
    // Parallel: collinear only when the offset is perpendicular-zero.
    if (Math.abs(qx * ry - qy * rx) > EPS) return false;
    const rr = rx * rx + ry * ry;
    if (rr < EPS) return false;
    const t0 = (qx * rx + qy * ry) / rr;
    const t1 = t0 + (sx * rx + sy * ry) / rr;
    const lo = Math.max(0, Math.min(t0, t1));
    const hi = Math.min(1, Math.max(t0, t1));
    if (lo > hi) return false;
    // Overlap confined to t≈1 is the landing itself; anything
    // reaching back along the leader is a collinear run.
    return lo < 1 - 1e-6;
  }
  const t = (qx * sy - qy * sx) / den;
  const u = (qx * ry - qy * rx) / den;
  if (t < -EPS || t > 1 + EPS || u < -EPS || u > 1 + EPS) return false;
  return t < 1 - 1e-6;
}

/**
 * One pill per branch carrying `branches[id].support`, right-aligned
 * just above the horizontal segment into its node (nudged ≤ 6 px when
 * blocked; leader-offset only as a last resort). Nodes are processed
 * in layout order (preorder — parents first), so "the later one" that
 * nudges is simply the later id in `laid.nodes`.
 */
export function supportLabels(
  tree: Tree,
  laid: Layout,
  opts: SupportLabelOptions,
): SupportLabel[] {
  // Real glyph extents when the caller can measure (src/measureText.ts),
  // the per-char estimate otherwise.
  const textW = (t: string, fs: number): number =>
    opts.measure?.(t, fs)?.w ?? t.length * (opts.charWidth ?? fs * 0.62);
  const pillH = opts.fontSize + PILL_PAD_Y * 2;
  const markerR = opts.nodeRadius;
  const byId = new Map(laid.nodes.map((n) => [n.id, n]));

  const obstacles: LabelBox[] = [];
  for (const n of laid.nodes) {
    // Node markers (and their highlight ring) are hard obstacles.
    obstacles.push({
      minX: n.x - markerR - 1,
      maxX: n.x + markerR + 1,
      minY: n.y - markerR - 1,
      maxY: n.y + markerR + 1,
    });
    // Leaf names run right of the marker. They render with
    // dominantBaseline="middle" — the obstacle uses the name's REAL
    // glyph box when the DOM can measure it (a font with a bigger
    // ascent or descent than the em estimates is exactly how pills
    // ended up grazing real text); the estimates stand in otherwise.
    if (n.leaf && n.label !== null) {
      const m = opts.measure?.(n.label, opts.nameFontSize);
      obstacles.push({
        minX: n.x + markerR + opts.labelOffset,
        maxX:
          n.x +
          markerR +
          opts.labelOffset +
          (m?.w ?? n.label.length * opts.nameFontSize * 0.62),
        minY: n.y + (m?.top ?? -opts.nameFontSize) - NAME_PAD,
        maxY: n.y + (m?.bottom ?? opts.nameFontSize * 0.5) + NAME_PAD,
      });
    }
    // The "0" zero-length marker sits above the branch's midpoint on
    // the default (alphabetic) baseline — drawn text, treated as a
    // marker.
    const parent = tree.nodes[n.id].parent;
    if (parent !== null && byId.has(parent) && tree.branches[n.id].length === 0) {
      const mid = (n.parentX + n.x) / 2;
      const w = textW("0", opts.fontSize) + NAME_PAD * 2;
      const m = opts.measure?.("0", opts.fontSize, "alphabetic");
      obstacles.push({
        minX: mid - w / 2,
        maxX: mid + w / 2,
        minY: n.y - 4 + (m?.top ?? -opts.fontSize) - NAME_PAD,
        maxY: n.y - 4 + (m?.bottom ?? 0) + NAME_PAD,
      });
    }
  }

  // Every drawn branch polyline, for leader routing: each node's
  // incoming horizontal segment and each internal node's vertical
  // connector (the parent's x, spanning its children's rows, exactly
  // as the renderers draw it).
  const branchSegs: Seg[] = [];
  for (const n of laid.nodes) {
    if (n.parentX !== n.x) {
      branchSegs.push({ x1: n.parentX, y1: n.y, x2: n.x, y2: n.y });
    }
    const kids = tree.nodes[n.id].children.filter((c) => byId.has(c));
    if (kids.length > 0) {
      const ys = kids.map((c) => byId.get(c)!.y);
      branchSegs.push({
        x1: n.x,
        y1: Math.min(...ys),
        x2: n.x,
        y2: Math.max(...ys),
      });
    }
  }

  const labels: SupportLabel[] = [];
  const firstHit = (box: LabelBox): LabelBox | null => {
    for (const o of obstacles) if (intersects(box, o)) return o;
    for (const p of labels) if (intersects(box, p.box)) return p.box;
    return null;
  };
  // Monotone climb: each jump puts the box strictly above the last
  // obstacle it touched, so the loop terminates.
  const climb = (start: LabelBox): LabelBox => {
    let box = start;
    let hit = firstHit(box);
    let guard = 0;
    while (hit !== null && guard++ < 1000) {
      box = { ...box, maxY: hit.minY - 1, minY: hit.minY - 1 - pillH };
      hit = firstHit(box);
    }
    // The last box is kept regardless — a degenerate tree is still
    // better drawn than dropped.
    return box;
  };
  // Pick the leader's attach point on the pill: bottom edge from the
  // right corner leftward, then up the right edge; the first line to
  // the node that crosses no branch wins. The bottom-right corner
  // (a near-vertical drop just left of the node) is tried first.
  const routeLeader = (
    box: LabelBox,
    nx: number,
    ny: number,
  ): NonNullable<SupportLabel["leader"]> => {
    const attach = (x1: number, y1: number) => ({ x1, y1, x2: nx, y2: ny });
    for (let ax = box.maxX; ax >= box.minX - EPS; ax -= 1) {
      const l = attach(ax, box.maxY);
      if (!branchSegs.some((s) => segHits(l, s))) return l;
    }
    for (let ay = box.maxY; ay >= box.minY - EPS; ay -= 1) {
      const l = attach(box.maxX, ay);
      if (!branchSegs.some((s) => segHits(l, s))) return l;
    }
    return attach(box.maxX, box.maxY);
  };

  for (const n of laid.nodes) {
    const s = tree.branches[n.id].support;
    const parent = tree.nodes[n.id].parent;
    if (s === null || parent === null || !byId.has(parent)) continue;

    const weak = s < 0.5;
    const text = supportText(s);
    const measured = textW(text, opts.fontSize);
    const pillW = measured + PILL_PAD_X * 2;
    // Right edge clears the marker box plus a gap — "right-aligned
    // near the node end". A short segment lets the pill overhang left
    // past its start, over the parent's vertical (masked by the pill).
    const right = n.x - markerR - 1 - GAP;
    // Bottom edge just above the segment, capped so the pill's centre
    // stays within 10 px of the node's row when the font allows.
    const raise0 = Math.max(1, Math.min(GAP, 10 - pillH / 2));
    const atRaise = (raise: number): LabelBox => ({
      minX: right - pillW,
      maxX: right,
      minY: n.y - raise - pillH,
      maxY: n.y - raise,
    });

    let box: LabelBox | undefined;
    // Nudge ladder: the base spot, then the ±NUDGE band (down first —
    // it keeps the pill closest to the row), then further downward
    // until the pill's centre would drop 10 px below the node's row.
    const nudges = [0];
    for (let d = 1; d <= NUDGE; d += 1) nudges.push(-d, d);
    for (let d = NUDGE + 1; raise0 - d >= -DROP_PAD - pillH / 2; d += 1)
      nudges.push(-d);
    for (const d of nudges) {
      const cand = atRaise(raise0 + d);
      if (firstHit(cand) === null) {
        box = cand;
        break;
      }
    }

    let leader: SupportLabel["leader"];
    if (box === undefined) {
      // Unresolved label/name/marker collision — the only case that
      // earns a leader line now.
      box = climb(atRaise(GAP + pillH + LEADER_RAISE));
      leader = routeLeader(box, n.x, n.y);
    }

    labels.push({
      id: n.id,
      text,
      weak,
      box,
      textX: (box.minX + box.maxX) / 2,
      textY: (box.minY + box.maxY) / 2,
      leader,
    });
  }
  return labels;
}
