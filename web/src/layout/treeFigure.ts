// Shared figure geometry for a drawn tree (v1.2 checkpoint 15). Both
// renderers — the on-screen TreeView (React SVG) and the standalone
// exportSvg document — compute their layout, support-label placement
// and content bounds through this one function, so an exported figure
// is the same drawing as the one on screen, byte for byte modulo
// padding. There is no separate export layout path.
//
// The inputs mirror what TreeView measures: the leaf spacing App
// shares across the row, the drawing panel's width (the measured
// .tree-canvas box; a fixed default stands in before measurement and
// for exports), and the same kind/clamp/visibility selection.

import type { Tree } from "../engine/generated/Tree";
import { nodeName } from "../state/names";

import { layout, type LaidOutNode, type Layout } from "./phylogram";
import { supportLabels, type SupportLabel } from "./supportLabels";
import { leafFontSize, labelRoomFor, MIN_FONT_PX } from "./treePanel";

// Drawing geometry shared by both renderers (moved verbatim out of
// TreeView). PAD is the margin the draw width leaves inside the
// measured panel; each renderer adds its own viewBox padding on top
// of `bounds`.
export const FIGURE_PANEL_PAD = 8;
export const FIGURE_LABEL_OFFSET = 4;
export const FIGURE_NODE_RADIUS = 3;
export const FIGURE_WRONG_PAD = 6;
/** Display-only minimum drawn length for support-carrying internal
 * branches, so the weak (<50%) thin stroke stays visible on short
 * branches (checkpoint 11). */
export const FIGURE_MIN_SUPPORT_BRANCH_PX = 12;
/** Fallback panel width before the first ResizeObserver callback (also
 * used under jsdom, where the observer is a no-op stub). */
export const FIGURE_DEFAULT_PANEL_WIDTH = 560;

export interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface TreeFigureOptions {
  kind: "phylogram" | "cladogram";
  clampNegative: boolean;
  /** Vertical distance between leaves in px — App's shared value, or a
   * fixed default for a standalone export. */
  leafSpacing: number;
  /** The measured .tree-canvas width in px; `<= 0` selects the
   * pre-measurement default. */
  panelWidth: number;
  visibleNodes?: Set<number>;
  /** Highlighted nodes — drawn on screen only; the bounds include
   * their rings and internal u-names so both renderers reserve the
   * same room. */
  highlight?: Set<number>;
  /** Wrong clades — drawn on screen only, but included in the bounds
   * for the same reason. */
  wrong?: Set<number>;
}

export interface TreeFigure {
  laid: Layout;
  placed: SupportLabel[];
  byId: Map<number, LaidOutNode>;
  labelById: Map<number, SupportLabel>;
  fontSize: number;
  smallFont: number;
  /** The content bounding box in layout coordinates — every drawn box
   * (node markers with ring and stroke slack, leaf and internal names,
   * "0" markers, support pills, wrong-clade rects), never the nominal
   * layout width (checkpoint 12). Renderers translate by `bounds` and
   * pad it; nothing clips and no empty margin remains. */
  bounds: Box;
  /** True while support labels are drawn: the u1/u2/… internal names
   * hide so they can never overlap a pill. */
  hideInternalNames: boolean;
  /** Bounding box of a clade's laid-out nodes plus the branch leading
   * to it (the dotted "wrong clade" outline). */
  cladeBox: (id: number) => Box | null;
}

/**
 * The full geometry of a drawn tree: layout, collision-resolved
 * support labels, fonts and the content bounding box. Pure — the same
 * inputs give the same figure on screen and in an export.
 */
export function treeFigure(tree: Tree, opts: TreeFigureOptions): TreeFigure {
  const highlight = opts.highlight ?? new Set<number>();
  const wrong = opts.wrong ?? new Set<number>();

  // Fixed minimum text size: only branch geometry scales (checkpoint
  // 11), so leaf names, node names and support labels never draw below
  // MIN_FONT_PX no matter the tree's scale.
  const fontSize = Math.max(MIN_FONT_PX, leafFontSize(opts.leafSpacing));
  const smallFont = Math.max(MIN_FONT_PX, fontSize - 3);
  const labelRoom = labelRoomFor(
    tree.nodes.map((n) => n.label),
    fontSize,
  );
  const panelWidth =
    opts.panelWidth > 0 ? opts.panelWidth : FIGURE_DEFAULT_PANEL_WIDTH;
  const drawWidth = Math.max(
    80,
    panelWidth - labelRoom - FIGURE_PANEL_PAD * 2,
  );

  // Supported edges get only the 12 px display-only stroke floor:
  // their labels sit just above the incoming segment right-aligned
  // to the node and may overhang left past the segment's start, so
  // no fit-stretch is needed (owner refinement 21-10-26).
  const laid = layout(tree, {
    kind: opts.kind,
    clampNegative: opts.clampNegative,
    leafSpacing: opts.leafSpacing,
    width: drawWidth,
    visibleNodes: opts.visibleNodes,
    minBranchPx: FIGURE_MIN_SUPPORT_BRANCH_PX,
  });
  const byId = new Map(laid.nodes.map((n) => [n.id, n]));

  // Support labels are pills placed above the segment into each
  // labeled node; supportLabels resolves every collision up front
  // (never onto a node marker, a leaf name or another pill). While
  // they are drawn the u1/u2/… internal names hide — they are a
  // step-through aid and would sit exactly where the pills go.
  const placed = supportLabels(tree, laid, {
    fontSize: smallFont,
    nameFontSize: fontSize,
    nodeRadius: FIGURE_NODE_RADIUS,
    labelOffset: FIGURE_LABEL_OFFSET,
  });
  const labelById = new Map(placed.map((p) => [p.id, p]));
  const hideInternalNames = placed.length > 0;

  const cladeBox = (id: number): Box | null => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const stack = [id];
    while (stack.length > 0) {
      const nid = stack.pop()!;
      const cur = byId.get(nid);
      if (cur) {
        minX = Math.min(minX, cur.parentX, cur.x);
        maxX = Math.max(maxX, cur.x);
        minY = Math.min(minY, cur.y);
        maxY = Math.max(maxY, cur.y);
      }
      for (const child of tree.nodes[nid].children) stack.push(child);
    }
    return minX === Infinity ? null : { minX, maxX, minY, maxY };
  };

  // The bounds fit the CONTENT, not the nominal layout width
  // (checkpoint 12): the union of every drawn box, so no label can
  // ever clip at any tree size or view — and no empty margin remains
  // where a fixed label-room reservation used to sit (checkpoint 15).
  const bounds: Box = {
    minX: Infinity,
    maxX: -Infinity,
    minY: Infinity,
    maxY: -Infinity,
  };
  const grow = (b: Box) => {
    bounds.minX = Math.min(bounds.minX, b.minX);
    bounds.maxX = Math.max(bounds.maxX, b.maxX);
    bounds.minY = Math.min(bounds.minY, b.minY);
    bounds.maxY = Math.max(bounds.maxY, b.maxY);
  };
  // Marker radius + highlight ring + half the widest stroke, with slack.
  const NODE_SLACK = FIGURE_NODE_RADIUS + 5;
  for (const n of laid.nodes) {
    grow({
      minX: Math.min(n.x, n.parentX) - NODE_SLACK,
      maxX: n.x + NODE_SLACK,
      minY: n.y - NODE_SLACK,
      maxY: n.y + NODE_SLACK,
    });
    // Text boxes: dominantBaseline="middle" puts glyphs roughly
    // 1em above and 0.4em below the anchor — the estimate covers both.
    if (n.leaf && n.label !== null) {
      grow({
        minX: n.x + FIGURE_LABEL_OFFSET + FIGURE_NODE_RADIUS,
        maxX:
          n.x +
          FIGURE_LABEL_OFFSET +
          FIGURE_NODE_RADIUS +
          n.label.length * fontSize * 0.62,
        minY: n.y - fontSize - 2,
        maxY: n.y + fontSize * 0.5,
      });
    } else if (highlight.has(n.id) && !hideInternalNames) {
      const name = nodeName(tree, n.id);
      grow({
        minX: n.x + FIGURE_LABEL_OFFSET + FIGURE_NODE_RADIUS,
        maxX:
          n.x +
          FIGURE_LABEL_OFFSET +
          FIGURE_NODE_RADIUS +
          name.length * fontSize * 0.62,
        minY: n.y - fontSize - 2,
        maxY: n.y + fontSize * 0.5,
      });
    }
    const parent = tree.nodes[n.id].parent;
    if (parent !== null && byId.has(parent) && tree.branches[n.id].length === 0) {
      const mid = (n.parentX + n.x) / 2;
      const w = smallFont + 4;
      grow({
        minX: mid - w / 2,
        maxX: mid + w / 2,
        minY: n.y - 4 - smallFont - 2,
        maxY: n.y - 2,
      });
    }
  }
  for (const p of placed) grow(p.box);
  for (const id of wrong) {
    const cb = cladeBox(id);
    if (cb !== null) {
      grow({
        minX: cb.minX - FIGURE_WRONG_PAD - 3,
        maxX: cb.maxX + FIGURE_WRONG_PAD + 3,
        // The ✕ glyph's baseline sits near the rect's top edge, so give
        // it a full font above the padded box.
        minY: cb.minY - FIGURE_WRONG_PAD - fontSize - 3,
        maxY: cb.maxY + FIGURE_WRONG_PAD + 3,
      });
    }
  }

  return {
    laid,
    placed,
    byId,
    labelById,
    fontSize,
    smallFont,
    bounds,
    hideInternalNames,
    cladeBox,
  };
}
