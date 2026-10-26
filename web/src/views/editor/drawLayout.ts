// Drawing geometry for the drag-to-draw canvas (v1.4 plan Task 9,
// spec §5.2): the same pure layout() call as the lesson TreeView,
// once per drawn component, stacked vertically with captions for the
// detached subtrees. Coordinates only — no structure decisions.

import type { NodeId } from "../../engine/generated/NodeId";
import type { Tree } from "../../engine/generated/Tree";
import {
  layout,
  type LaidOutNode,
  type Layout,
} from "../../layout/phylogram";
import { LEAF_SPACING_NATURAL } from "../../layout/treePanel";

import { cladeName, detachedRoots } from "./drawOps";

// Node decorations DrawTree paints and their reach past a node
// centre. The label offset and the svg margin are derived from these
// so the largest decoration — the selected dot, the :focus-visible
// ring, both at once — never overlaps a leaf's own label and never
// clips at the viewBox edge, for the main tree and detached
// components alike.
export const NODE_R = 3; // node marker radius, px (matches the tree panels)
export const NODE_SEL_R = NODE_R + 1; // a selected marker grows 1 px
export const FOCUS_RING_R = 8; // :focus-visible ring radius around a node, px
export const FOCUS_RING_W = 2.5; // ring stroke width, px (index.css .focus-ring)
export const EDGE_FOCUS_PAD = 8; // edge ring reach above/below a branch, px
export const EDGE_FOCUS_MIN = 16; // smallest focus box an edge gets, px

/** Furthest any decoration reaches past a node centre — the selected
 * dot or the focus ring's outer stroke edge. An edge ring reaches the
 * same distance: EDGE_FOCUS_PAD above/below the row, or half of
 * EDGE_FOCUS_MIN past the end of a shorter-than-minimum branch. */
export const DECOR_R = Math.max(
  NODE_SEL_R,
  FOCUS_RING_R + FOCUS_RING_W / 2,
  EDGE_FOCUS_PAD + FOCUS_RING_W / 2,
  EDGE_FOCUS_MIN / 2 + FOCUS_RING_W / 2,
);
/** Clear space around a decoration — between its outer edge and a
 * leaf label, and between it and the viewBox edge. */
export const DECOR_GAP = 2;
/** Leaf label x offset from its node centre, px. */
export const LABEL_DX = DECOR_R + DECOR_GAP;
/** Margin inside the svg, px — a focus ring around a leftmost or
 * rightmost node (roots, detached roots, the deepest leaf) stays
 * fully inside the viewBox on every side. */
export const PAD = DECOR_R + DECOR_GAP;
export const COMP_GAP = 24; // gap above each detached component
export const CAPTION_H = 16; // room for a detached component's caption

export interface CompView {
  root: NodeId;
  laid: Layout;
  /** Top of this component's rows inside the svg. */
  y0: number;
  /** Caption for a detached component, null for the main tree. */
  caption: string | null;
}

export interface NodePos {
  n: LaidOutNode;
  /** The node's marker position in svg px. */
  x: number;
  y: number;
  comp: CompView;
}

/** Lay out the main tree and every detached component, stacked top
 * to bottom inside the svg. Returns the components, each drawn
 * node's svg position, and the total svg height. */
export function layoutComps(
  tree: Tree,
  drawWidth: number,
): { comps: CompView[]; pos: Map<NodeId, NodePos>; svgH: number } {
  const comps: CompView[] = [];
  const pos = new Map<NodeId, NodePos>();
  let cursor = PAD;
  for (const root of [tree.root, ...detachedRoots(tree)]) {
    const detached = root !== tree.root;
    const laid = layout(
      { ...tree, root },
      {
        kind: "phylogram",
        clampNegative: true,
        leafSpacing: LEAF_SPACING_NATURAL,
        width: drawWidth,
      },
    );
    if (detached) cursor += COMP_GAP;
    const caption = detached ? `Detached: ${cladeName(tree, root)}` : null;
    const y0 = detached ? cursor + CAPTION_H : cursor;
    const comp: CompView = { root, laid, y0, caption };
    for (const n of laid.nodes) {
      pos.set(n.id, { n, x: PAD + n.x, y: y0 + n.y, comp });
    }
    comps.push(comp);
    cursor = y0 + laid.height;
  }
  return { comps, pos, svgH: cursor + PAD };
}
