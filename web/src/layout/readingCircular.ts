// Circular reading-tree placement (v1.4d plan Task 6, spec §6): the
// root sits at the centre and the tips span a 330° arc centred on the
// tip direction. Radius is the canonical depth coordinate times a
// scale chosen to fill the box; when the label ring alone is wider
// than the box the radius keeps its floor and the figure scrolls.
// Leaves keep their DFS order along the arc; an internal node's angle
// is the midpoint of its outermost children, like the leaf-axis
// midpoint in the flat layouts. An internal node's radius is the age
// coordinate floored at its cladistic-depth slot, so a compressed
// ancestor still sits inside its children (checkpoint §21(b)).

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
  /** The tip radius actually used — the depth extent shared-branch
   * mark slots can ask to grow. */
  R: number;
}

export interface CircularInput {
  tips: TipSide;
  width: number;
  n: number;
  /** Root index — the arena lists leaves first, so it is not 0. */
  root: number;
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
  /** Extra tip radius on top of the box fit — a shared branch's mark
   * slots can ask for a deeper figure (readingLayout's stretch). */
  extraRadius?: number;
}

export function circularPlace(inp: CircularInput): CircularPlace {
  const availR = inp.width / 2 - PAD - NODE_R - LABEL_GAP - inp.maxLabelW;
  const R =
    (availR >= MIN_RADIUS_PX ? availR : MIN_RADIUS_PX) +
    (inp.extraRadius ?? 0);
  const canonMax = Math.max(1e-9, ...inp.canon);
  const scale = canonMax > 0 ? R / canonMax : 0;
  const centre = { right: 0, down: 90, left: 180, up: -90 }[inp.tips];

  const ang = new Array<number>(inp.n).fill(0);
  const rad = new Array<number>(inp.n).fill(0);
  // Cladistic depth per node (edge count from the root). An
  // age-compressed internal node still keeps a ring of its own: its
  // radius is floored at its depth slot, so a deep fan can't collapse
  // onto the centre and a shallow node's children always sit further
  // out than it (checkpoint §21(b)).
  const depth = new Array<number>(inp.n).fill(0);
  let maxDepth = 0;
  const markDepth = (id: number, d: number): void => {
    depth[id] = d;
    if (d > maxDepth) maxDepth = d;
    for (const k of inp.children(id)) markDepth(k, d + 1);
  };
  markDepth(inp.root, 0);
  // Resolve radii bottom-up: a floor only ever helps a node sit
  // strictly INSIDE its shallowest descendant — a fossil tip's age
  // ring can be shallower than its parent's depth floor, and the
  // floor may never push the parent out to or past it.
  const placeRad = (id: number): number => {
    let minDesc = Infinity;
    for (const k of inp.children(id)) {
      minDesc = Math.min(minDesc, placeRad(k));
    }
    let r = inp.canon[id] * scale;
    if (id !== inp.root && maxDepth > 0 && inp.children(id).length > 0) {
      r = Math.max(r, (depth[id] / maxDepth) * R);
    }
    if (r >= minDesc) r = minDesc - Math.min(2, minDesc * 0.1 + 0.2);
    rad[id] = Math.max(0, r);
    return rad[id];
  };
  placeRad(inp.root);
  // Angles resolve bottom-up (post-order from the root): a leaf's slot
  // sets its angle, an internal node sits at the midpoint of its first
  // and last child's RESOLVED angle. Arena index order is leaves then
  // internal nodes in preorder, so an ascending pass would read angles
  // that are still 0.
  const placeAng = (id: number): void => {
    const kids = inp.children(id);
    if (kids.length === 0) {
      ang[id] =
        inp.leafCount > 1
          ? centre +
            (inp.slot[id] / (inp.leafCount - 1) - 0.5) * CIRCULAR_ARC_DEG
          : centre;
      return;
    }
    for (const k of kids) placeAng(k);
    ang[id] = (ang[kids[0]] + ang[kids[kids.length - 1]]) / 2;
  };
  placeAng(inp.root);

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
    R,
  };
}
