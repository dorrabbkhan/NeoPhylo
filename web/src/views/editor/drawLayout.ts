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

export const PAD = 8; // margin inside the svg, px
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
