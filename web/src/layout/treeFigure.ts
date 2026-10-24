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
/** Clearance the refit requires between the svg's right edge and the
 * measured panel: a build that lands flush (or within a hair) of the
 * canvas edge counts as a miss and keeps shrinking — flush fits are
 * where sub-pixel clips hide (PR #80 round 1: a leaf label's ink box
 * ended up a 0.00003 px sliver wider than the box the
 * IntersectionObserver quantizes against, and `ratio: 1` failed). */
export const FIGURE_FIT_MARGIN = 2;
/** Extra room the content bounds leave on the left and right, so a
 * label's rasterized ink box — a hairline wider than its measured
 * advance at unlucky sub-pixel positions, or nudged ≤0.5 px by the
 * renderer's device-pixel snap — can never poke past the svg's own
 * overflow clip (same PR #80 mechanism). */
export const FIGURE_INK_SLACK = 1;
/** Fallback panel width before the first ResizeObserver callback (also
 * used under jsdom, where the observer is a no-op stub). */
export const FIGURE_DEFAULT_PANEL_WIDTH = 560;

/** Snap a drawn coordinate to whole pixels in the element's own space:
 * `origin` is the svg's screen offset — the canvas's content-box
 * origin on screen (scrollLeft 0), or 0 for the standalone export —
 * so the snapped position lands on a device pixel. Leaf-name anchors
 * snap to this grid because an unlucky fractional position can leave
 * the rasterized ink box a hairline wider than the metric box the
 * IntersectionObserver intersects, dropping the observed ratio just
 * under 1 (PR #80 round 1: leaf D lost a 0.00003 px sliver at
 * 1920×1080). */
export function snapDevicePx(v: number, origin: number): number {
  return Math.round(v + origin) - origin;
}

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
  /** Real glyph extents (src/measureText.ts probe) for label
   * collision boxes and content bounds — null falls back to the
   * em estimates, which is what jsdom unit tests exercise. */
  measure?: (
    text: string,
    fontSize: number,
    baseline?: "middle" | "alphabetic",
  ) => { w: number; top: number; bottom: number } | null;
  /** Presenter mode (v1.3 §6.6): scales the figure's text by this
   * factor (the design tokens' PRESENTER_SCALE on screen). Defaults
   * to 1 — exports never scale. */
  textScale?: number;
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
  // MIN_FONT_PX no matter the tree's scale. textScale (presenter mode,
  // §6.6) multiplies the sizes after that floor is applied, so the
  // scaled text is exactly 1.5× the normal figure's.
  const textScale = opts.textScale ?? 1;
  const baseFont = Math.max(MIN_FONT_PX, leafFontSize(opts.leafSpacing));
  const fontSize = baseFont * textScale;
  const smallFont = Math.max(MIN_FONT_PX, baseFont - 3) * textScale;
  const labelRoom = labelRoomFor(
    tree.nodes.map((n) => n.label),
    fontSize,
  );
  const panelWidth =
    opts.panelWidth > 0 ? opts.panelWidth : FIGURE_DEFAULT_PANEL_WIDTH;
  let drawWidth = Math.max(
    80,
    panelWidth - labelRoom - FIGURE_PANEL_PAD * 2,
  );

  // Build the whole figure at one draw width. Supported edges get only
  // the 12 px display-only stroke floor: their labels sit just above
  // the incoming segment right-aligned to the node and may overhang
  // left past the segment's start, so no fit-stretch is needed (owner
  // refinement 21-10-26). layout() already shrinks its scale so the
  // accumulated stretch stays inside `drawWidth` (owner decision 3A),
  // but the CONTENT box also spans pills overhanging left and node
  // slack — if it still exceeds the panel, the draw width shrinks by
  // the measured overflow and the figure is rebuilt (the "second pass
  // that rescales" the same decision allowed).
  //
  // A build counts as fitted only when its svg clears the panel by at
  // least FIGURE_FIT_MARGIN — a flush fit is not a fit (PR #80 round
  // 1). When no pass reaches the margin, the least-shrunk build that
  // is merely inside the panel stands; when nothing fits inside at
  // all, the FIRST build stands — a tree that truly can't fit keeps
  // the panel's horizontal scroll instead of squashing to a narrower
  // pass that still overflows (the layout invariant).
  let first: TreeFigure | null = null;
  let borderline: TreeFigure | null = null;
  for (let pass = 0; pass < 8; pass += 1) {
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
      measure: opts.measure,
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
      // 1em above and 0.4em below the anchor — measured extents replace
      // the estimates when the DOM can provide them, so the bounds (and
      // the export's viewBox) cover the real text at any installed font.
      if (n.leaf && n.label !== null) {
        const m = opts.measure?.(n.label, fontSize);
        grow({
          minX: n.x + FIGURE_LABEL_OFFSET + FIGURE_NODE_RADIUS,
          maxX:
            n.x +
            FIGURE_LABEL_OFFSET +
            FIGURE_NODE_RADIUS +
            (m?.w ?? n.label.length * fontSize * 0.62),
          minY: n.y + (m?.top ?? -fontSize - 2),
          maxY: n.y + (m?.bottom ?? fontSize * 0.5),
        });
      } else if (highlight.has(n.id) && !hideInternalNames) {
        const name = nodeName(tree, n.id);
        const m = opts.measure?.(name, fontSize);
        grow({
          minX: n.x + FIGURE_LABEL_OFFSET + FIGURE_NODE_RADIUS,
          maxX:
            n.x +
            FIGURE_LABEL_OFFSET +
            FIGURE_NODE_RADIUS +
            (m?.w ?? name.length * fontSize * 0.62),
          minY: n.y + (m?.top ?? -fontSize - 2),
          maxY: n.y + (m?.bottom ?? fontSize * 0.5),
        });
      }
      const parent = tree.nodes[n.id].parent;
      if (parent !== null && byId.has(parent) && tree.branches[n.id].length === 0) {
        const mid = (n.parentX + n.x) / 2;
        const m = opts.measure?.("0", smallFont, "alphabetic");
        const w = (m?.w ?? smallFont) + 4;
        grow({
          minX: mid - w / 2,
          maxX: mid + w / 2,
          minY: n.y - 4 + (m?.top ?? -smallFont - 2),
          maxY: n.y - 4 + (m?.bottom ?? 2),
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

    // The bounds get 1 px of extra room on the left and right
    // (FIGURE_INK_SLACK) so a label's rasterized ink — a hairline
    // wider than its measured advance, or nudged by the renderer's
    // device-pixel snap — can never poke past the svg's own clip.
    bounds.minX -= FIGURE_INK_SLACK;
    bounds.maxX += FIGURE_INK_SLACK;

    const figure: TreeFigure = {
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
    if (first === null) first = figure;
    const svgWidth = bounds.maxX - bounds.minX + FIGURE_PANEL_PAD * 2;
    // The least-shrunk margin-fitting build wins outright; the loop
    // only continues while a narrower pass might still reach the
    // margin.
    if (svgWidth <= panelWidth - FIGURE_FIT_MARGIN) return figure;
    if (svgWidth <= panelWidth && borderline === null) {
      borderline = figure;
    }
    const overflow = svgWidth - (panelWidth - FIGURE_FIT_MARGIN);
    // Snap the next draw width DOWN to an integer: the fixed point the
    // iteration aims at is svg == panel − margin, so a non-snapped
    // step lands within fp noise of the edge — sometimes a hair over
    // it. Flooring guarantees the build that fits lands strictly
    // inside the margin (at most 1 px extra shrink).
    const next = Math.max(80, Math.floor(drawWidth - overflow));
    if (next >= drawWidth - 0.5) break;
    drawWidth = next;
  }
  return borderline ?? first!;
}
