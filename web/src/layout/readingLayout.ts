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
import { placeMarks } from "./readingMarks";
import { resolveMarkLabels } from "./readingMarkLabels";
import {
  abbreviate,
  AXIS_ROOM,
  cladeKey,
  D2R,
  fmtNum,
  LABEL_GAP,
  LETTER_R,
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
    /** Anchor of the mark's trait text in figure coordinates — the
     * renderer centres the label on it. For a lone mark this is the
     * spot it has always used (10 px above the anchor); marks sharing
     * a branch each get a stem slot and a label beside the stem level
     * with their own glyph. */
    labelX: number;
    labelY: number;
    /** Estimated AABB of the label text (same asc/desc estimates the
     * tip-label boxes use). */
    labelBox: Box;
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

  let X: number[] = [];
  let Y: number[] = [];
  let labelBox: (Box | null)[] = [];
  let width = 0;
  let height = 0;
  /** Coordinate of a canonical depth value on the axis (x or y). */
  let axisAt: (c: number) => number = () => 0;
  /** The depth extent the positions were laid out with (DE for the
   * flat shapes, the tip radius for circular). */
  let extent = 0;

  // Node and tip-label placement as a redoable step: a shared
  // branch's mark slots can ask for a deeper extent (placeMarks'
  // `stretch`) — the block re-runs with `extraDepth` added to the
  // depth extent so the stem holds its marks and the figure grows
  // rather than displacing a label from its glyph. It returns the
  // circular placement it made (null for the flat shapes) so `circ`
  // stays in the caller's flow where TypeScript can see it.
  const placeNodes = (extraDepth: number): CircularPlace | null => {
    if (circular) {
      const c = circularPlace({
        tips: style.tips,
        width: box.width,
        n,
        root: t.root,
        children: (i) => t.nodes[i].children,
        canon,
        slot,
        leafCount,
        labelText,
        labelW,
        maxLabelW,
        asc,
        desc,
        extraRadius: extraDepth,
      });
      X = c.X;
      Y = c.Y;
      labelBox = c.labelBox;
      width = c.width;
      height = c.height;
      extent = c.R;
      axisAt = () => 0;
      return c;
    }
    X = new Array(n).fill(0);
    Y = new Array(n).fill(0);
    labelBox = new Array(n).fill(null);
    if (horizontal) {
      const leafH = leafCount * spacing;
      const avail = box.width - 2 * PAD - NODE_R - LABEL_GAP - maxLabelW;
      const DE = (avail >= MIN_DEPTH_PX ? avail : MIN_DEPTH_PX) + extraDepth;
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
      extent = DE;
      axisAt = (c) =>
        style.tips === "right"
          ? PAD + c * scale
          : PAD + maxLabelW + LABEL_GAP + NODE_R + (DE - c * scale);
    } else {
      // tips up/down: leaf spread horizontal, depth vertical. The
      // slanted labels can overhang the leaf slots at either end;
      // both overhangs widen the figure so no box clips.
      const leafW = leafCount * spacing;
      const DE = Math.max(MIN_DEPTH_PX, leafW) + extraDepth;
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
      extent = DE;
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
    return null;
  };
  let circ = placeNodes(0);

  const idByClade = new Map<string, number>();
  for (let i = 0; i < n; i += 1) {
    idByClade.set(cladeKey(t.nodes[i].clade), i);
  }
  const find = (clade: string[]): number | undefined =>
    idByClade.get(cladeKey(clade));

  // Marks resolve to the branch leading to their clade's node.
  // Several marks on ONE branch get a slot each along the stem and a
  // label beside the stem level with its own glyph — readingMarks.ts.
  // A stem too short for the slots asks for `stretch` and the node
  // layout re-runs deeper (the figure grows; `scroll` keeps its
  // meaning). A lone mark keeps the midpoint placement it has always
  // had.
  let markLay = placeMarks({
    view: t,
    shape: style.shape,
    horizontal,
    X,
    Y,
    circ,
    asc,
    desc,
    measure,
    find,
    width,
    height,
    canon,
    canonMax,
    extent,
  });
  if (markLay.stretch > 1e-9) {
    circ = placeNodes(markLay.stretch);
    markLay = placeMarks({
      view: t,
      shape: style.shape,
      horizontal,
      X,
      Y,
      circ,
      asc,
      desc,
      measure,
      find,
      width,
      height,
      canon,
      canonMax,
      extent,
    });
  }
  const { placed: placedMark } = markLay;

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

  const points = t.points.flatMap((pt) => {
    const i = find(pt.on);
    if (i === undefined) return [];
    const pos = pt.at === "branch" ? branchMid(i) : { x: X[i], y: Y[i] };
    return [{ letter: pt.letter, x: pos.x, y: pos.y }];
  });

  // A shared branch's spread or a resolved mark label may reach past
  // the figure edge; shift the whole drawing by the reported (gx, gy)
  // so every mark label stays inside and grow the figure if one still
  // escapes on the right or bottom (`scroll` keeps its width > box
  // width meaning). Both grow sources shift their own placements; the
  // helper takes care of the rest of the figure.
  const applyGrow = (g: {
    gx: number;
    gy: number;
    addW: number;
    addH: number;
  }): void => {
    for (let i = 0; i < n; i += 1) {
      X[i] += g.gx;
      Y[i] += g.gy;
      const lb = labelBox[i];
      if (lb !== null) {
        labelBox[i] = {
          minX: lb.minX + g.gx,
          maxX: lb.maxX + g.gx,
          minY: lb.minY + g.gy,
          maxY: lb.maxY + g.gy,
        };
      }
    }
    if (circ !== null) {
      circ.cx0 += g.gx;
      circ.cy0 += g.gy;
    }
    const baseAt = axisAt;
    axisAt = (c) => baseAt(c) + (horizontal ? g.gx : g.gy);
    width += g.gx + g.addW;
    height += g.gy + g.addH;
    for (const pt of points) {
      pt.x += g.gx;
      pt.y += g.gy;
    }
  };
  if (markLay.grow !== null) applyGrow(markLay.grow);

  // No mark-label box may cover a tip label, a letter badge (node or
  // point), another mark's glyph or another mark's label (checkpoint
  // §21(a)) — the resolver nudges any that does.
  const badges: Box[] = [];
  t.nodes.forEach((nd, i) => {
    if (nd.letter !== null) {
      badges.push({
        minX: X[i] - LETTER_R - 1,
        maxX: X[i] + LETTER_R + 1,
        minY: Y[i] - LETTER_R - 1,
        maxY: Y[i] + LETTER_R + 1,
      });
    }
  });
  for (const pt of points) {
    badges.push({
      minX: pt.x - LETTER_R - 1,
      maxX: pt.x + LETTER_R + 1,
      minY: pt.y - LETTER_R - 1,
      maxY: pt.y + LETTER_R + 1,
    });
  }
  const resolveGrow = resolveMarkLabels({
    view: t,
    placed: placedMark,
    tipBoxes: labelBox,
    badges,
    asc,
    desc,
    measure,
    width,
    height,
  });
  if (resolveGrow !== null) applyGrow(resolveGrow);

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
  // parent's depth; diagonal is a straight line. A circular edge is
  // the radial spoke into the node; when the node is internal its
  // edge ALSO carries the node's fan — one arc spanning its
  // children's full angle range. Drawing the fan once per internal
  // node (instead of a per-child arc from the node's own angle)
  // keeps a polytomy's fan from sweeping through a middle child's
  // spoke (checkpoint §21(b)).
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
      path = `M ${polar(c.rad[p], c.ang[i])} L ${polar(c.rad[i], c.ang[i])}`;
      const kids = t.nodes[i].children;
      if (kids.length > 1 && c.rad[i] > 1e-9) {
        const aLo = Math.min(...kids.map((k) => c.ang[k]));
        const aHi = Math.max(...kids.map((k) => c.ang[k]));
        if (aHi - aLo > 1e-9) {
          path += ` M ${polar(c.rad[i], aLo)} A ${c.rad[i]} ${c.rad[i]} 0 ${aHi - aLo > 180 ? 1 : 0} 1 ${polar(c.rad[i], aHi)}`;
        }
      }
    }
    edges.push({ from: t.nodes[p].clade, to: t.nodes[i].clade, path });
  }

  const marks = t.marks.flatMap((m, j) => {
    const p = placedMark[j];
    if (p === undefined) return [];
    return [{ trait: m.trait, change: m.change, ...p }];
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
