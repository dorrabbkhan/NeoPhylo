// Layout for the tree-reading styles (v1.4d plan Task 6, spec §4.5 and
// §6): rectangular, diagonal and rooted circular drawings in four tip
// directions, node letters, lettered points, trait marks and a time
// axis (numeric or schematic). Pure geometry — the renderer (Task 7)
// draws exactly what this returns and no engine math lives here: ages,
// letters, marks and points arrive resolved in the `ReadingTreeView`.
//
// Conventions:
// - Positions are computed in a canonical frame (cx = distance from
//   the root toward the tips, cy = leaf spread) and mapped to screen
//   coordinates per tip direction: "right" is the identity, "left"
//   mirrors x, "up"/"down" swap the axes so the leaf spread runs
//   horizontally and depth vertically. Circular placement lives in
//   readingCircular.ts; shared internals in readingGeom.ts.
// - Without ages the drawing is a cladogram: branch lengths are
//   ignored and all tips align at the deepest level (spec §4.5). With
//   `times: "ages"` positions come from node ages — a tip with its own
//   age is a fossil and ends before the present line.
// - Text is never shrunk below MIN_FONT_PX; a tree wider than
//   `box.width` keeps its geometry and sets `scroll` instead.
// - The time axis runs along the depth axis: below the tree for
//   tips-left/right (ticks' `at` is an x), to its left for
//   tips-up/down (`at` is a y). A schematic axis carries no ticks.

import type { ReadingTreeView } from "../engine/generated/ReadingTreeView";
import type { Shape } from "../engine/generated/Shape";
import type { TipSide } from "../engine/generated/TipSide";

import { circularPlace, type CircularPlace } from "./readingCircular";
import {
  abbreviate,
  AXIS_ROOM,
  cladeKey,
  D2R,
  fmtNum,
  LABEL_GAP,
  MIN_DEPTH_PX,
  niceStep,
  NODE_R,
  PAD,
  rotBox,
  TIP_LABEL_SLANT_DEG,
  type Box,
} from "./readingGeom";
import { LEAF_SPACING_NATURAL, MIN_FONT_PX } from "./treePanel";

export interface ReadingStyle {
  shape: Shape;
  tips: TipSide;
}

export interface ReadingBox {
  width: number;
  fontPx: number;
}

export interface ReadingFigureNode {
  clade: string[];
  x: number;
  y: number;
  letter?: string;
  isTip: boolean;
  label?: string;
  labelBox?: Box;
}

export interface ReadingFigureEdge {
  from: string[];
  to: string[];
  path: string;
}

export interface ReadingAxis {
  ticks: { at: number; label: string }[];
  schematic: boolean;
  unit?: string;
}

export interface ReadingFigure {
  width: number;
  height: number;
  nodes: ReadingFigureNode[];
  edges: ReadingFigureEdge[];
  points: { letter: string; x: number; y: number }[];
  marks: {
    trait: string;
    change: "gain" | "loss";
    x: number;
    y: number;
    angle: number;
  }[];
  axis?: ReadingAxis;
  scroll: boolean;
}

interface Mid {
  x: number;
  y: number;
  angle: number;
}

/**
 * The full geometry of a reading tree: node positions keyed by clade,
 * one edge path per branch, lettered points, trait marks on branch
 * midpoints, an optional time axis and the scroll flag. Pure — the
 * same inputs always give the same figure.
 */
export function readingLayout(
  t: ReadingTreeView,
  style: ReadingStyle,
  box: ReadingBox,
  measure: (s: string) => number,
): ReadingFigure {
  const fontPx = Math.max(MIN_FONT_PX, box.fontPx);
  // Estimated glyph extents for label boxes: dominantBaseline="middle"
  // puts roughly 0.75 em above and 0.6 em below the anchor, padded.
  const asc = fontPx * 0.75 + 2;
  const desc = fontPx * 0.6 + 2;

  const n = t.nodes.length;
  const empty: ReadingFigure = {
    width: 0,
    height: 0,
    nodes: [],
    edges: [],
    points: [],
    marks: [],
    scroll: false,
  };
  if (n === 0) return empty;

  // Displayed label per node (tips only) and its measured width.
  const labelText = t.nodes.map((nd) =>
    nd.children.length === 0 && nd.label !== null
      ? abbreviate(nd.label)
      : null,
  );
  const labelW = labelText.map((l) => (l === null ? 0 : measure(l)));
  const maxLabelW = labelW.reduce((m, w) => Math.max(m, w), 0);

  const vertical = style.tips === "up" || style.tips === "down";
  const horizontal = !vertical;
  const circular = style.shape === "circular";
  const flatDeg = vertical
    ? style.tips === "up"
      ? -TIP_LABEL_SLANT_DEG
      : TIP_LABEL_SLANT_DEG
    : 0;
  // tips-left labels end at their anchor (text occupies [-w, 0]).
  const labEnd = style.tips === "left";
  // Every tip label's box relative to its anchor (unused by circular,
  // which places radial labels itself).
  const offs = labelW.map((w) => rotBox(w, flatDeg, labEnd, asc, desc));

  // Leaf spacing: fixed at the natural pitch, except tips-up/down
  // where the slanted label boxes bound it from below.
  let spacing = LEAF_SPACING_NATURAL;
  if (vertical && !circular) {
    const need =
      Math.max(0, ...offs.map((o) => o.maxX - o.minX)) + LABEL_GAP;
    spacing = Math.max(LEAF_SPACING_NATURAL, need);
  }

  // One pass over the tree: cladogram depth, effective age and the
  // leaf-axis position (leaves get slots in DFS order; an internal
  // node sits at the midpoint of its outermost children — polytomy
  // children of single leaves are therefore evenly spaced). Effective
  // age: explicit age wins; a tip without one sits at the present (0)
  // and an internal node without one a small step above its oldest
  // child — defensive only, the engine lists every internal age.
  const depth = new Array<number>(n).fill(0);
  const effAge = new Array<number>(n).fill(0);
  const cy = new Array<number>(n).fill(0);
  const slot = new Array<number>(n).fill(-1);
  let leafCount = 0;
  let maxDepth = 0;
  const visitDepth = (id: number, d: number): void => {
    depth[id] = d;
    if (d > maxDepth) maxDepth = d;
    for (const k of t.nodes[id].children) visitDepth(k, d + 1);
  };
  visitDepth(t.root, 0);
  const ageGap =
    t.nodes.reduce((m, nd) => Math.max(m, nd.age ?? 0), 0) /
    Math.max(1, maxDepth);
  const visit = (id: number): void => {
    const kids = t.nodes[id].children;
    if (kids.length === 0) {
      slot[id] = leafCount;
      cy[id] = (leafCount + 0.5) * spacing;
      leafCount += 1;
      effAge[id] = t.nodes[id].age ?? 0;
      return;
    }
    for (const k of kids) visit(k);
    cy[id] = (cy[kids[0]] + cy[kids[kids.length - 1]]) / 2;
    effAge[id] =
      t.nodes[id].age ?? Math.max(...kids.map((k) => effAge[k])) + ageGap;
  };
  visit(t.root);

  // Canonical depth coordinate: larger means closer to the tips.
  const useAges = t.times === "ages";
  const maxAge = effAge.reduce((m, a) => Math.max(m, a), 0);
  const canon = new Array<number>(n);
  for (let i = 0; i < n; i += 1) {
    canon[i] = useAges
      ? maxAge - effAge[i]
      : t.nodes[i].children.length === 0
        ? maxDepth
        : depth[i];
  }
  const canonMax = Math.max(1e-9, ...canon);

  const hasAxis = t.times !== "none" && !circular;
  const axisRoom = hasAxis ? AXIS_ROOM : 0;

  let X: number[];
  let Y: number[];
  let labelBox: (Box | null)[];
  let circ: CircularPlace | null = null;
  let width: number;
  let height: number;
  /** Coordinate of a canonical depth value on the axis (x or y). */
  let axisAt: (c: number) => number = () => 0;

  if (circular) {
    circ = circularPlace({
      tips: style.tips,
      width: box.width,
      n,
      children: (i) => t.nodes[i].children,
      canon,
      slot,
      leafCount,
      labelText,
      labelW,
      maxLabelW,
      asc,
      desc,
    });
    X = circ.X;
    Y = circ.Y;
    labelBox = circ.labelBox;
    width = circ.width;
    height = circ.height;
  } else {
    X = new Array(n).fill(0);
    Y = new Array(n).fill(0);
    labelBox = new Array(n).fill(null);
    if (horizontal) {
      const leafH = leafCount * spacing;
      const avail = box.width - 2 * PAD - NODE_R - LABEL_GAP - maxLabelW;
      const DE = avail >= MIN_DEPTH_PX ? avail : MIN_DEPTH_PX;
      const scale = canonMax > 0 ? DE / canonMax : 0;
      for (let i = 0; i < n; i += 1) {
        const cxp = canon[i] * scale;
        X[i] =
          style.tips === "right"
            ? PAD + cxp
            : PAD + maxLabelW + LABEL_GAP + NODE_R + (DE - cxp);
        Y[i] = PAD + cy[i];
      }
      width = 2 * PAD + NODE_R + LABEL_GAP + maxLabelW + DE;
      height = 2 * PAD + leafH + axisRoom;
      axisAt = (c) =>
        style.tips === "right"
          ? PAD + c * scale
          : PAD + maxLabelW + LABEL_GAP + NODE_R + (DE - c * scale);
    } else {
      // tips up/down: leaf spread horizontal, depth vertical. The
      // slanted labels can overhang the leaf slots at either end;
      // both overhangs widen the figure so no box clips.
      const leafW = leafCount * spacing;
      const DE = Math.max(MIN_DEPTH_PX, leafW);
      const scale = canonMax > 0 ? DE / canonMax : 0;
      let labelRoom = 0;
      let overL = 0;
      let overR = 0;
      for (let i = 0; i < n; i += 1) {
        if (labelText[i] === null) continue;
        const off = offs[i];
        labelRoom = Math.max(
          labelRoom,
          style.tips === "up" ? -off.minY : off.maxY,
        );
        overL = Math.max(overL, -off.minX - spacing / 2);
        overR = Math.max(overR, off.maxX - spacing / 2);
      }
      for (let i = 0; i < n; i += 1) {
        const cxp = canon[i] * scale;
        X[i] = PAD + axisRoom + overL + cy[i];
        Y[i] =
          style.tips === "up"
            ? PAD + NODE_R + LABEL_GAP + labelRoom + (DE - cxp)
            : PAD + cxp;
      }
      width = 2 * PAD + axisRoom + overL + leafW + overR;
      height =
        style.tips === "up"
          ? 2 * PAD + NODE_R + LABEL_GAP + labelRoom + DE
          : 2 * PAD + DE + NODE_R + LABEL_GAP + labelRoom;
      axisAt = (c) =>
        style.tips === "up"
          ? PAD + NODE_R + LABEL_GAP + labelRoom + (DE - c * scale)
          : PAD + c * scale;
    }
    // Tip labels: one shared pass over the anchor spec per side
    // (right/left sit beside the tip, up/down slant off it).
    const dir = style.tips === "right" || style.tips === "down" ? 1 : -1;
    for (let i = 0; i < n; i += 1) {
      if (labelText[i] === null) continue;
      const off = offs[i];
      const ax = horizontal ? X[i] + dir * (NODE_R + LABEL_GAP) : X[i];
      const ay = horizontal ? Y[i] : Y[i] + dir * (NODE_R + LABEL_GAP);
      labelBox[i] = {
        minX: ax + off.minX,
        maxX: ax + off.maxX,
        minY: ay + off.minY,
        maxY: ay + off.maxY,
      };
    }
  }

  const nodes: ReadingFigureNode[] = t.nodes.map((nd, i) => ({
    clade: nd.clade,
    x: X[i],
    y: Y[i],
    ...(nd.letter !== null ? { letter: nd.letter } : {}),
    isTip: nd.children.length === 0,
    ...(labelText[i] !== null
      ? { label: labelText[i], labelBox: labelBox[i]! }
      : {}),
  }));

  // Edges: one path per non-root node. Rectangular elbows run at the
  // parent's depth; diagonal is a straight line; circular arcs at the
  // parent's radius then runs radially out.
  const edges: ReadingFigureEdge[] = [];
  for (let i = 0; i < n; i += 1) {
    const p = t.nodes[i].parent;
    if (p === null) continue;
    let path: string;
    if (style.shape === "diagonal") {
      path = `M ${X[p]} ${Y[p]} L ${X[i]} ${Y[i]}`;
    } else if (style.shape === "rectangular") {
      path = horizontal
        ? `M ${X[p]} ${Y[p]} L ${X[p]} ${Y[i]} L ${X[i]} ${Y[i]}`
        : `M ${X[p]} ${Y[p]} L ${X[i]} ${Y[p]} L ${X[i]} ${Y[i]}`;
    } else {
      const c = circ!;
      const polar = (r: number, a: number) =>
        `${c.cx0 + r * Math.cos(a * D2R)} ${c.cy0 + r * Math.sin(a * D2R)}`;
      if (c.rad[p] < 1e-9) {
        path = `M ${polar(c.rad[p], c.ang[p])} L ${polar(c.rad[i], c.ang[i])}`;
      } else {
        const dA = c.ang[i] - c.ang[p];
        const large = Math.abs(dA) > 180 ? 1 : 0;
        const sweep = dA >= 0 ? 1 : 0;
        path = `M ${polar(c.rad[p], c.ang[p])} A ${c.rad[p]} ${c.rad[p]} 0 ${large} ${sweep} ${polar(c.rad[p], c.ang[i])} L ${polar(c.rad[i], c.ang[i])}`;
      }
    }
    edges.push({ from: t.nodes[p].clade, to: t.nodes[i].clade, path });
  }

  // Midpoint of the branch leading to node i (its "stem") and the
  // branch's direction, used by points at:"branch" and trait marks.
  const branchMid = (i: number): Mid => {
    const p = t.nodes[i].parent;
    if (p === null) return { x: X[i], y: Y[i], angle: 0 };
    if (style.shape === "diagonal") {
      return {
        x: (X[p] + X[i]) / 2,
        y: (Y[p] + Y[i]) / 2,
        angle: Math.atan2(Y[i] - Y[p], X[i] - X[p]) / D2R,
      };
    }
    if (style.shape === "rectangular") {
      return horizontal
        ? { x: (X[p] + X[i]) / 2, y: Y[i], angle: X[i] >= X[p] ? 0 : 180 }
        : { x: X[i], y: (Y[p] + Y[i]) / 2, angle: Y[i] >= Y[p] ? 90 : -90 };
    }
    const c = circ!;
    const midR = (c.rad[p] + c.rad[i]) / 2;
    return {
      x: c.cx0 + midR * Math.cos(c.ang[i] * D2R),
      y: c.cy0 + midR * Math.sin(c.ang[i] * D2R),
      angle: c.ang[i],
    };
  };

  const idByClade = new Map<string, number>();
  for (let i = 0; i < n; i += 1) {
    idByClade.set(cladeKey(t.nodes[i].clade), i);
  }
  const find = (clade: string[]): number | undefined =>
    idByClade.get(cladeKey(clade));

  const points = t.points.flatMap((pt) => {
    const i = find(pt.on);
    if (i === undefined) return [];
    const pos = pt.at === "branch" ? branchMid(i) : { x: X[i], y: Y[i] };
    return [{ letter: pt.letter, x: pos.x, y: pos.y }];
  });

  const marks = t.marks.flatMap((m) => {
    const i = find(m.on);
    if (i === undefined) return [];
    const mid = branchMid(i);
    return [
      {
        trait: m.trait,
        change: m.change,
        x: mid.x,
        y: mid.y,
        angle: mid.angle,
      },
    ];
  });

  // The axis runs along the depth axis; ticks sit at round ages.
  let axis: ReadingAxis | undefined;
  if (hasAxis) {
    if (t.times === "schematic") {
      axis = { ticks: [], schematic: true, unit: t.unit ?? undefined };
    } else {
      const step = niceStep(maxAge, 4);
      const ticks: ReadingAxis["ticks"] = [];
      for (let v = 0; v <= maxAge + 1e-9; v += step) {
        ticks.push({ at: axisAt(maxAge - v), label: fmtNum(v) });
      }
      axis = { ticks, schematic: false, unit: t.unit ?? undefined };
    }
  }

  return {
    width,
    height,
    nodes,
    edges,
    points,
    marks,
    ...(axis ? { axis } : {}),
    scroll: width > box.width + 1e-6,
  };
}
