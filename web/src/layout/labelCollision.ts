// Collision primitives shared by the figure's label placers
// (supportLabels' pills, internalNames' highlighted node names).
// Pure geometry: obstacle boxes for the things labels may never
// cover — node markers, leaf names and the "0" zero-length markers —
// the drawn branch polyline for leader routing, and the box
// operations the placement ladders share (hit test, monotone climb,
// leader attach-point search). Branch lines and connectors are NOT
// obstacles anywhere: each placer masks them under its own filled
// background (the pill, the halo plate).
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

export function intersects(a: LabelBox, b: LabelBox): boolean {
  return (
    a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY
  );
}

export interface Seg {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

const EPS = 1e-9;

/**
 * True when segment a shares more than its (x2, y2) endpoint with
 * segment b — a proper crossing, a grazing touch at an interior point,
 * or a collinear run. An intersection exactly at (x2, y2) is the
 * leader landing on its node, not a crossing.
 */
export function segHits(a: Seg, b: Seg): boolean {
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

// A name or marker box is slightly larger than the glyph estimate so a
// placed label never visually grazes the text it avoids.
const NAME_PAD = 2;

export interface TextObstacleOptions {
  /** The "0" zero-length markers' font size (smallFont). */
  markerFontSize: number;
  /** Leaf-name font size, for the name obstacle boxes. */
  nameFontSize: number;
  /** Node marker radius including highlight slack. */
  nodeRadius: number;
  /** Gap between a leaf's marker and the start of its name. */
  labelOffset: number;
  /** Estimated character width; defaults to 0.62 em like treePanel.
   * Used only when `measure` is absent or returns null. */
  charWidth?: number;
  /** Real glyph extents in the app's font (TextExtents from
   * src/measureText.ts). Returns null where the DOM can't measure;
   * the estimates then stand in. */
  measure?: (
    text: string,
    fontSize: number,
    baseline?: "middle" | "alphabetic",
  ) => { w: number; top: number; bottom: number } | null;
}

/**
 * The boxes a placed label may never cover: every node marker (and
 * its highlight ring), every leaf's name box, and every "0"
 * zero-length marker. Leaf names render with
 * dominantBaseline="middle" — the obstacle uses the name's REAL glyph
 * box when the DOM can measure it (a font with a bigger ascent or
 * descent than the em estimates is exactly how labels ended up
 * grazing real text); the estimates stand in otherwise.
 */
export function textObstacles(
  tree: Tree,
  laid: Layout,
  opts: TextObstacleOptions,
): LabelBox[] {
  const textW = (t: string, fs: number): number =>
    opts.measure?.(t, fs)?.w ?? t.length * (opts.charWidth ?? fs * 0.62);
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
      const w = textW("0", opts.markerFontSize) + NAME_PAD * 2;
      const m = opts.measure?.("0", opts.markerFontSize, "alphabetic");
      obstacles.push({
        minX: mid - w / 2,
        maxX: mid + w / 2,
        minY: n.y - 4 + (m?.top ?? -opts.markerFontSize) - NAME_PAD,
        maxY: n.y - 4 + (m?.bottom ?? 0) + NAME_PAD,
      });
    }
  }
  return obstacles;
}

/**
 * Every drawn branch polyline, for leader routing: each node's
 * incoming horizontal segment and each internal node's vertical
 * connector (the parent's x, spanning its children's rows, exactly
 * as the renderers draw it).
 */
export function branchSegsFor(tree: Tree, laid: Layout): Seg[] {
  const byId = new Map(laid.nodes.map((n) => [n.id, n]));
  const segs: Seg[] = [];
  for (const n of laid.nodes) {
    if (n.parentX !== n.x) {
      segs.push({ x1: n.parentX, y1: n.y, x2: n.x, y2: n.y });
    }
    const kids = tree.nodes[n.id].children.filter((c) => byId.has(c));
    if (kids.length > 0) {
      const ys = kids.map((c) => byId.get(c)!.y);
      segs.push({
        x1: n.x,
        y1: Math.min(...ys),
        x2: n.x,
        y2: Math.max(...ys),
      });
    }
  }
  return segs;
}

/**
 * Hit test over the fixed obstacles plus the labels placed so far —
 * `placed` is read through each call, so it stays live while the
 * caller's list grows.
 */
export function makeHitTest(
  obstacles: LabelBox[],
  placed: { box: LabelBox }[],
): (box: LabelBox) => LabelBox | null {
  return (box: LabelBox): LabelBox | null => {
    for (const o of obstacles) if (intersects(box, o)) return o;
    for (const p of placed) if (intersects(box, p.box)) return p.box;
    return null;
  };
}

/**
 * Monotone climb: each jump puts the box strictly above the last
 * obstacle it touched, so the loop terminates. The last box is kept
 * regardless — a degenerate tree is still better drawn than dropped.
 */
export function climb(
  start: LabelBox,
  boxH: number,
  firstHit: (box: LabelBox) => LabelBox | null,
): LabelBox {
  let box = start;
  let hit = firstHit(box);
  let guard = 0;
  while (hit !== null && guard++ < 1000) {
    box = { ...box, maxY: hit.minY - 1, minY: hit.minY - 1 - boxH };
    hit = firstHit(box);
  }
  return box;
}

export interface Leader {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

/**
 * Pick the leader's attach point on the label box: bottom edge from
 * the right corner leftward, then up the right edge; the first line
 * to the node that crosses no branch wins. The bottom-right corner
 * (a near-vertical drop just left of the node) is tried first.
 */
export function routeLeader(
  box: LabelBox,
  nx: number,
  ny: number,
  branchSegs: Seg[],
): Leader {
  const attach = (x1: number, y1: number): Leader => ({
    x1,
    y1,
    x2: nx,
    y2: ny,
  });
  for (let ax = box.maxX; ax >= box.minX - EPS; ax -= 1) {
    const l = attach(ax, box.maxY);
    if (!branchSegs.some((s) => segHits(l, s))) return l;
  }
  for (let ay = box.maxY; ay >= box.minY - EPS; ay -= 1) {
    const l = attach(box.maxX, ay);
    if (!branchSegs.some((s) => segHits(l, s))) return l;
  }
  return attach(box.maxX, box.maxY);
}
