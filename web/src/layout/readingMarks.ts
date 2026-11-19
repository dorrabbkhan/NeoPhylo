// Trait-mark placement for the reading layouts (PR #173 fix): marks
// resolve to the branch leading to their clade's node, and several
// marks on ONE branch must stay readable one by one — every glyph
// gets its own slot along the stem in input order (first mark nearest
// the parent) and its label rides BESIDE the stem level with that
// glyph: above a horizontal stem, toward the roomier figure edge of a
// vertical one. A label's nearest glyph is then always its own, no
// label box touches any glyph (bar, arrowhead or loss circle), and no
// two label boxes overlap. When the stem is too short to hold the
// slots the caller re-runs the node layout with a deeper extent
// (`stretch` — the figure grows and `scroll` keeps its meaning); a
// stem the depth scale cannot lengthen (a zero-length branch) keeps
// its slots anyway and `grow` shifts/widens the figure around them.
// `readingLayout` calls `placeMarks` after node positions are fixed;
// a figure with no shared branch comes out byte-identical to the old
// all-midpoint behaviour.

import type { ReadingTreeView } from "../engine/generated/ReadingTreeView";
import type { Shape } from "../engine/generated/Shape";

import {
  D2R,
  LABEL_GAP,
  MARK_GLYPH,
  MARK_HALF,
  PAD,
  type Box,
} from "./readingGeom";

/** One mark's resolved geometry: the branch anchor plus where its
 * trait label goes and the label's estimated box. */
export interface PlacedMark {
  x: number;
  y: number;
  angle: number;
  labelX: number;
  labelY: number;
  labelBox: Box;
}

/** The stem of the branch leading to a node: midpoint, unit
 * direction pointing away from the parent, half-length and the
 * branch's screen angle for the glyph rotation. */
interface Stem {
  mx: number;
  my: number;
  ux: number;
  uy: number;
  h: number;
  angle: number;
}

export interface MarkLayoutInput {
  view: ReadingTreeView;
  shape: Shape;
  /** tips right/left — the stem axis is horizontal. */
  horizontal: boolean;
  X: number[];
  Y: number[];
  /** Circular placement (null for the flat shapes). */
  circ: { rad: number[]; ang: number[]; cx0: number; cy0: number } | null;
  /** Label box estimates, same as the tip-label boxes use. */
  asc: number;
  desc: number;
  /** Text width probe (the same `measure` the layout got). */
  measure: (s: string) => number;
  /** Clade → node index resolution (the layout's own `find`). */
  find: (clade: string[]) => number | undefined;
  width: number;
  height: number;
  /** Canonical depth coordinate per node and its maximum, plus the
   * depth extent the positions were laid out with (DE for the flat
   * shapes, the tip radius for circular) — the stretch check maps a
   * needed stem length back to a needed extent. */
  canon: number[];
  canonMax: number;
  extent: number;
}

export interface MarkLayout {
  /** Placement per input mark index (undefined for unresolvable
   * clades — the mark is dropped like before). */
  placed: (PlacedMark | undefined)[];
  /** Room the mark labels need outside the current figure box, or
   * null when no branch carries two or more marks — the caller then
   * shifts the drawing by (gx, gy) and adds addW/addH. */
  grow: { gx: number; gy: number; addW: number; addH: number } | null;
  /** Extra depth extent (px) every shared stem needs so its slots
   * fit — the caller re-runs the node layout with
   * `extent += stretch`, then calls placeMarks again. 0 when every
   * stem is already long enough. */
  stretch: number;
}

/** The mark glyph's AABB in figure coordinates: the perpendicular
 * bar (half-length MARK_HALF) plus the change glyph — a gain
 * arrowhead reaching MARK_GLYPH×1.6 along the branch, a loss circle
 * of radius MARK_GLYPH — rotated by `angle` like the renderer's
 * `<g transform="rotate(angle)">` does. Exported so the layout tests
 * check label-vs-glyph clearance against exactly what is drawn. */
export function markGlyphBox(
  change: "gain" | "loss",
  x: number,
  y: number,
  angle: number,
): Box {
  const xHi = change === "gain" ? MARK_GLYPH * 1.6 : MARK_GLYPH;
  const th = angle * D2R;
  const c = Math.cos(th);
  const s = Math.sin(th);
  const box: Box = {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
  };
  for (const [lx, ly] of [
    [-MARK_GLYPH, -MARK_HALF],
    [xHi, -MARK_HALF],
    [xHi, MARK_HALF],
    [-MARK_GLYPH, MARK_HALF],
  ] as const) {
    const gx = x + lx * c - ly * s;
    const gy = y + lx * s + ly * c;
    box.minX = Math.min(box.minX, gx);
    box.minY = Math.min(box.minY, gy);
    box.maxX = Math.max(box.maxX, gx);
    box.maxY = Math.max(box.maxY, gy);
  }
  return box;
}

export function placeMarks(inp: MarkLayoutInput): MarkLayout {
  const { view, shape, horizontal, X, Y, circ, asc, desc, measure, find } =
    inp;

  const stemOf = (i: number): Stem => {
    const p = view.nodes[i].parent;
    if (p === null)
      return { mx: X[i], my: Y[i], ux: 1, uy: 0, h: 0, angle: 0 };
    if (shape === "diagonal") {
      const dx = X[i] - X[p];
      const dy = Y[i] - Y[p];
      const len = Math.hypot(dx, dy);
      if (len < 1e-9)
        return { mx: X[i], my: Y[i], ux: 1, uy: 0, h: 0, angle: 0 };
      return {
        mx: (X[p] + X[i]) / 2,
        my: (Y[p] + Y[i]) / 2,
        ux: dx / len,
        uy: dy / len,
        h: len / 2,
        angle: Math.atan2(dy, dx) / D2R,
      };
    }
    if (shape === "rectangular") {
      return horizontal
        ? {
            mx: (X[p] + X[i]) / 2,
            my: Y[i],
            ux: Math.sign(X[i] - X[p]),
            uy: 0,
            h: Math.abs(X[i] - X[p]) / 2,
            angle: X[i] >= X[p] ? 0 : 180,
          }
        : {
            mx: X[i],
            my: (Y[p] + Y[i]) / 2,
            ux: 0,
            uy: Math.sign(Y[i] - Y[p]),
            h: Math.abs(Y[i] - Y[p]) / 2,
            angle: Y[i] >= Y[p] ? 90 : -90,
          };
    }
    const c = circ!;
    const a = c.ang[i] * D2R;
    const midR = (c.rad[p] + c.rad[i]) / 2;
    return {
      mx: c.cx0 + midR * Math.cos(a),
      my: c.cy0 + midR * Math.sin(a),
      ux: Math.cos(a),
      uy: Math.sin(a),
      h: Math.abs(c.rad[i] - c.rad[p]) / 2,
      angle: c.ang[i],
    };
  };

  // A mark label's estimated AABB: the renderer anchors the trait
  // text centred on (x, y) on the default baseline.
  const markLabelBox = (w: number, x: number, y: number): Box => ({
    minX: x - w / 2,
    maxX: x + w / 2,
    minY: y - asc,
    maxY: y + desc,
  });
  const LABEL_DY = MARK_HALF + 4;
  const labelH = asc + desc;

  const groups = new Map<number, number[]>();
  view.marks.forEach((m, j) => {
    const i = find(m.on);
    if (i === undefined) return;
    const g = groups.get(i);
    if (g === undefined) groups.set(i, [j]);
    else g.push(j);
  });
  const placed = new Array<PlacedMark | undefined>(view.marks.length);
  let shared = false;
  let neededExtent = 0;
  for (const [i, js] of groups) {
    const st = stemOf(i);
    if (js.length === 1) {
      const w = measure(view.marks[js[0]].trait);
      placed[js[0]] = {
        x: st.mx,
        y: st.my,
        angle: st.angle,
        labelX: st.mx,
        labelY: st.my - LABEL_DY,
        labelBox: markLabelBox(w, st.mx, st.my - LABEL_DY),
      };
      continue;
    }
    shared = true;
    const k = js.length;
    const w = js.map((j) => measure(view.marks[j].trait));
    // The stem's parent: needed for the stem-length stretch below.
    const p = view.nodes[i].parent;

    // Label side: perpendicular to the stem. A horizontal-ish stem
    // gets its labels above (the mark's established look); a
    // vertical-ish one toward whichever figure edge is nearer — the
    // outside of the tree, away from the other columns' stems. The
    // preference is projected perpendicular to the stem direction so
    // diagonal stems get a true perpendicular offset.
    let px: number;
    let py: number;
    if (Math.abs(st.ux) >= Math.abs(st.uy)) {
      px = 0;
      py = -1;
    } else {
      px = st.mx - inp.width / 2 < 0 ? -1 : 1;
      py = 0;
    }
    const pdot = px * st.ux + py * st.uy;
    let nx = px - st.ux * pdot;
    let ny = py - st.uy * pdot;
    const nl = Math.hypot(nx, ny);
    if (nl < 1e-9) {
      nx = -st.uy;
      ny = st.ux;
    } else {
      nx /= nl;
      ny /= nl;
    }

    // Per-mark glyph box at a candidate anchor and its extent along
    // the stem (u) and the label direction (perp).
    const gBox = js.map((j) =>
      markGlyphBox(view.marks[j].change, 0, 0, st.angle),
    );
    // Glyph extents relative to the anchor: ahead/behind along u and
    // out/in along perp.
    const proj = (
      b: Box,
      vx: number,
      vy: number,
    ): [number, number] => {
      let lo = Infinity;
      let hi = -Infinity;
      for (const [cx, cy] of [
        [b.minX, b.minY],
        [b.maxX, b.minY],
        [b.maxX, b.maxY],
        [b.minX, b.maxY],
      ] as const) {
        const v = cx * vx + cy * vy;
        lo = Math.min(lo, v);
        hi = Math.max(hi, v);
      }
      return [lo, hi];
    };
    const gAhead = new Array<number>(k);
    const gBehind = new Array<number>(k);
    const gOut = new Array<number>(k);
    for (let o = 0; o < k; o += 1) {
      const [uLo, uHi] = proj(gBox[o], st.ux, st.uy);
      gBehind[o] = -uLo;
      gAhead[o] = uHi;
      gOut[o] = proj(gBox[o], nx, ny)[1];
    }

    // Each label's box sits LABEL_GAP off its glyph along perp: its
    // centre is the glyph's out-extent + the gap + the box's own
    // in-extent along perp.
    const rL = new Array<number>(k);
    const labD = new Array<number>(k);
    for (let o = 0; o < k; o += 1) {
      rL[o] = (w[o] / 2) * Math.abs(nx) + (ny > 0 ? asc : desc) * Math.abs(ny);
      labD[o] = gOut[o] + LABEL_GAP + rL[o];
    }

    // Along-stem spacing: neighbouring label boxes must be disjoint
    // on the stem axis (they all share the perp side, so they cannot
    // separate perpendicular to it), and neighbouring glyph boxes
    // keep a small gap.
    let s = 0;
    for (let o = 0; o + 1 < k; o += 1) {
      const labU =
        (w[o] / 2) * Math.abs(st.ux) +
        (labelH / 2) * Math.abs(st.uy);
      const labU1 =
        (w[o + 1] / 2) * Math.abs(st.ux) +
        (labelH / 2) * Math.abs(st.uy);
      const need = Math.max(
        labU + labU1 + LABEL_GAP,
        gAhead[o] + gBehind[o + 1] + LABEL_GAP,
      );
      if (need > s) s = need;
    }

    // Anchors stay `margin` inside the stem ends so a glyph cannot
    // ride onto a node; needLen is the stem length the slots want.
    const margin = MARK_GLYPH * 1.6 + LABEL_GAP + 1;
    const needLen = (k - 1) * s + 2 * margin;
    const stemLen = 2 * st.h;
    // A stem the depth scale can lengthen asks for `stretch`: the
    // figure grows instead of the slots leaving the stem.
    if (p !== null && needLen > stemLen + 1e-9) {
      const cdiff = inp.canon[i] - inp.canon[p];
      if (cdiff > 1e-9) {
        let scaleNeed: number;
        if (shape === "diagonal") {
          // Only the depth-axis component scales; the leaf-axis
          // offset of the edge is fixed.
          const dLeaf = horizontal
            ? Math.abs(Y[i] - Y[p])
            : Math.abs(X[i] - X[p]);
          scaleNeed =
            Math.sqrt(Math.max(0, needLen * needLen - dLeaf * dLeaf)) /
            cdiff;
        } else {
          scaleNeed = needLen / cdiff;
        }
        neededExtent = Math.max(neededExtent, scaleNeed * inp.canonMax);
      }
    }

    js.forEach((j, o) => {
      const d = (o - (k - 1) / 2) * s;
      const ax = st.mx + d * st.ux;
      const ay = st.my + d * st.uy;
      const cx = ax + nx * labD[o];
      const cy = ay + ny * labD[o];
      placed[j] = {
        x: ax,
        y: ay,
        angle: st.angle,
        labelX: cx,
        labelY: cy,
        labelBox: markLabelBox(w[o], cx, cy),
      };
    });
  }

  // A shared branch's spread or label side may reach past the figure
  // edge; report the room the labels and glyphs need so the caller
  // can shift the drawing and grow the figure — the placements come
  // back already shifted. No shared branch → no growth, and every
  // mark is byte-identical to the old midpoint placement.
  let grow: MarkLayout["grow"] = null;
  if (shared) {
    let gx = 0;
    let gy = 0;
    let addW = 0;
    let addH = 0;
    for (let j = 0; j < placed.length; j += 1) {
      const pm = placed[j];
      if (pm === undefined) continue;
      const boxes = [
        pm.labelBox,
        markGlyphBox(view.marks[j].change, pm.x, pm.y, pm.angle),
      ];
      for (const b of boxes) {
        gx = Math.max(gx, PAD - b.minX);
        addW = Math.max(addW, b.maxX + PAD - inp.width);
        gy = Math.max(gy, PAD - b.minY);
        addH = Math.max(addH, b.maxY + PAD - inp.height);
      }
    }
    if (gx > 0 || gy > 0 || addW > 0 || addH > 0) {
      grow = { gx, gy, addW, addH };
      for (const p of placed) {
        if (p === undefined) continue;
        p.x += gx;
        p.y += gy;
        p.labelX += gx;
        p.labelY += gy;
        p.labelBox = {
          minX: p.labelBox.minX + gx,
          maxX: p.labelBox.maxX + gx,
          minY: p.labelBox.minY + gy,
          maxY: p.labelBox.maxY + gy,
        };
      }
    }
  }
  return {
    placed,
    grow,
    stretch: Math.max(0, neededExtent - inp.extent),
  };
}
