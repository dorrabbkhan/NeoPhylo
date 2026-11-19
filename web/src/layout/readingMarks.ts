// Trait-mark placement for the reading layouts (PR #173 fix): marks
// resolve to the branch leading to their clade's node, and several
// marks on ONE branch must not pile on the midpoint — they spread
// along the stem in input order (first mark nearest the parent), and
// when the stem cannot hold every label on one line the labels climb
// to their own rows above the branch so no two marks, bars or label
// boxes overlap. `readingLayout` calls `placeMarks` after node
// positions are fixed; a figure with no shared branch comes out
// byte-identical to the old all-midpoint behaviour.

import type { ReadingTreeView } from "../engine/generated/ReadingTreeView";
import type { Shape } from "../engine/generated/Shape";

import { intersects } from "./labelCollision";
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
}

export interface MarkLayout {
  /** Placement per input mark index (undefined for unresolvable
   * clades — the mark is dropped like before). */
  placed: (PlacedMark | undefined)[];
  /** Room the mark labels need outside the current figure box, or
   * null when no branch carries two or more marks — the caller then
   * shifts the drawing by (gx, gy) and adds addW/addH. */
  grow: { gx: number; gy: number; addW: number; addH: number } | null;
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
    // The along-stem spacing one shared label row needs: neighbouring
    // boxes must clear each other on at least one screen axis.
    let sLab = 0;
    for (let o = 0; o + 1 < k; o += 1) {
      const need = Math.min(
        Math.abs(st.ux) > 1e-9
          ? ((w[o] + w[o + 1]) / 2 + LABEL_GAP) / Math.abs(st.ux)
          : Infinity,
        Math.abs(st.uy) > 1e-9
          ? (labelH + LABEL_GAP) / Math.abs(st.uy)
          : Infinity,
      );
      if (need > sLab) sLab = need;
    }
    // Anchors stay `margin` inside the stem so the glyph cannot ride
    // past a node; sGlyph keeps two bars/glyphs visually separate.
    const margin = MARK_GLYPH * 1.6 + 1;
    const sMax = Math.max(0, (2 * Math.max(0, st.h - margin)) / (k - 1));
    const sGlyph = 2 * MARK_HALF + 4;
    const sameRow = Math.max(sGlyph, sLab) <= sMax + 1e-9;
    const s = sameRow ? Math.max(sGlyph, sLab) : Math.min(sGlyph, sMax);
    const rowBoxes: Box[] = [];
    js.forEach((j, o) => {
      const d = (o - (k - 1) / 2) * s;
      const ax = st.mx + d * st.ux;
      const ay = st.my + d * st.uy;
      let ly = ay - LABEL_DY;
      let box = markLabelBox(w[o], ax, ly);
      if (!sameRow) {
        while (rowBoxes.some((b) => intersects(b, box))) {
          ly -= labelH + LABEL_GAP;
          box = markLabelBox(w[o], ax, ly);
        }
        rowBoxes.push(box);
      }
      placed[j] = {
        x: ax,
        y: ay,
        angle: st.angle,
        labelX: ax,
        labelY: ly,
        labelBox: box,
      };
    });
  }

  // A shared branch's spread or label stack may reach past the figure
  // edge; report the room the labels need so the caller can shift the
  // drawing and grow the figure — the placements come back already
  // shifted. No shared branch → no growth, and every mark is
  // byte-identical to the old midpoint placement.
  let grow: MarkLayout["grow"] = null;
  if (shared) {
    let gx = 0;
    let gy = 0;
    let addW = 0;
    let addH = 0;
    for (const p of placed) {
      if (p === undefined) continue;
      gx = Math.max(gx, PAD - p.labelBox.minX);
      addW = Math.max(addW, p.labelBox.maxX + PAD - inp.width);
      gy = Math.max(gy, PAD - p.labelBox.minY);
      addH = Math.max(addH, p.labelBox.maxY + PAD - inp.height);
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
  return { placed, grow };
}
