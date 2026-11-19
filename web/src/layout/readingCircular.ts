// Circular reading-tree placement (v1.4d plan Task 6, spec §6): the
// root sits at the centre and the tips span a 330° arc centred on the
// tip direction. Radius is the canonical depth coordinate times a
// scale chosen to fill the box; when the label ring alone is wider
// than the box the radius keeps its floor and the figure scrolls.
// Leaves keep their DFS order along the arc; an internal node's angle
// is the midpoint of its outermost children, like the leaf-axis
// midpoint in the flat layouts.

import type { TipSide } from "../engine/generated/TipSide";

import {
  CIRCULAR_ARC_DEG,
  D2R,
  LABEL_GAP,
  MIN_RADIUS_PX,
  NODE_R,
  PAD,
  rotBox,
  type Box,
} from "./readingGeom";

/** What the circular placement returns: screen positions and label
 * boxes plus the polar data edge paths and branch midpoints need. */
export interface CircularPlace {
  X: number[];
  Y: number[];
  labelBox: (Box | null)[];
  ang: number[];
  rad: number[];
  cx0: number;
  cy0: number;
  width: number;
  height: number;
}

export interface CircularInput {
  tips: TipSide;
  width: number;
  n: number;
  children: (i: number) => number[];
  /** Canonical depth coordinate per node (0 at the root). */
  canon: number[];
  /** Leaf slot index per leaf (−1 on internal nodes). */
  slot: number[];
  leafCount: number;
  labelText: (string | null)[];
  labelW: number[];
  maxLabelW: number;
  asc: number;
  desc: number;
}

export function circularPlace(inp: CircularInput): CircularPlace {
  const availR = inp.width / 2 - PAD - NODE_R - LABEL_GAP - inp.maxLabelW;
  const R = availR >= MIN_RADIUS_PX ? availR : MIN_RADIUS_PX;
  const canonMax = Math.max(1e-9, ...inp.canon);
  const scale = canonMax > 0 ? R / canonMax : 0;
  const centre = { right: 0, down: 90, left: 180, up: -90 }[inp.tips];

  const ang = new Array<number>(inp.n).fill(0);
  const rad = new Array<number>(inp.n).fill(0);
  for (let i = 0; i < inp.n; i += 1) {
    rad[i] = inp.canon[i] * scale;
    const kids = inp.children(i);
    if (kids.length === 0) {
      ang[i] =
        inp.leafCount > 1
          ? centre +
            (inp.slot[i] / (inp.leafCount - 1) - 0.5) * CIRCULAR_ARC_DEG
          : centre;
    } else {
      ang[i] = (ang[kids[0]] + ang[kids[kids.length - 1]]) / 2;
    }
  }

  const half = PAD + NODE_R + LABEL_GAP + inp.maxLabelW + R;
  const X = new Array<number>(inp.n).fill(0);
  const Y = new Array<number>(inp.n).fill(0);
  const labelBox: (Box | null)[] = new Array(inp.n).fill(null);
  for (let i = 0; i < inp.n; i += 1) {
    const a = ang[i] * D2R;
    X[i] = half + rad[i] * Math.cos(a);
    Y[i] = half + rad[i] * Math.sin(a);
    if (inp.labelText[i] !== null) {
      // Radial label, flipped on the left half so it reads outward.
      const flip = Math.cos(a) < 0;
      const off = rotBox(
        inp.labelW[i],
        flip ? ang[i] - 180 : ang[i],
        flip,
        inp.asc,
        inp.desc,
      );
      const ax = X[i] + (NODE_R + LABEL_GAP) * Math.cos(a);
      const ay = Y[i] + (NODE_R + LABEL_GAP) * Math.sin(a);
      labelBox[i] = {
        minX: ax + off.minX,
        maxX: ax + off.maxX,
        minY: ay + off.minY,
        maxY: ay + off.maxY,
      };
    }
  }
  return {
    X,
    Y,
    labelBox,
    ang,
    rad,
    cx0: half,
    cy0: half,
    width: 2 * half,
    height: 2 * half,
  };
}
