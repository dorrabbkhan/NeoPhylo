// Support-label placement (v1.2 spec §6.3, checkpoint 11 fixes). Pure
// geometry: given the laid-out tree, position each internal branch's
// support percentage as a small pill just left of and above the node at
// the branch's child end — near the node, never on top of it, so even
// on a short branch the label stays readable and clear of the marker.
//
// Collision avoidance: a label's pill box may not intersect any node
// marker, leaf name, "0" zero-length marker or an already-placed label.
// The later label nudges vertically — upward past the obstacle, falling
// back to below the node when the canvas top is reached. Internal node
// names (u1, u2, …) are not drawn while support labels are shown, so
// they are not obstacles here.
//
// Text metrics are estimates (0.62 em per character, like
// labelRoomFor): the browser never gives layout real glyph widths, so
// the pill is padded and the collision boxes include slack.

import type { Tree } from "../engine/generated/Tree";
import type { Layout } from "./phylogram";

export interface LabelBox {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export interface SupportLabel {
  /** Node whose incoming branch carries the value. */
  id: number;
  /** The drawn text, Math.round(100·s). */
  text: string;
  /** s < 0.5: the branch's thin "weak" styling plus a marker glyph. */
  weak: boolean;
  /** Pill bounds in drawing coordinates (before TreeView's pad). */
  box: LabelBox;
  /** Baseline anchor for the number (textAnchor middle). */
  textX: number;
  textY: number;
  /** Baseline anchor for the weak "*" marker inside the pill. */
  markerX: number | null;
}

export interface SupportLabelOptions {
  /** Support-label font size in px (the app's minimum is 12). */
  fontSize: number;
  /** Leaf-name font size in px, for the name obstacle boxes. */
  nameFontSize: number;
  /** Node marker radius including highlight slack. */
  nodeRadius: number;
  /** Gap between a leaf's marker and the start of its name. */
  labelOffset: number;
  /** Estimated character width; defaults to 0.62 em like treePanel. */
  charWidth?: number;
}

const GAP = 2;
const PILL_PAD_X = 5;
const PILL_PAD_Y = 2;
// A name or marker box is slightly larger than the glyph estimate so a
// pill never visually grazes the text it avoids.
const NAME_PAD = 2;

function intersects(a: LabelBox, b: LabelBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/**
 * One pill per branch carrying `branches[id].support`, placed just left
 * of and above the child-end node. Nodes are processed in layout order
 * (preorder — parents first), so "the later one" that nudges is simply
 * the later id in `laid.nodes`.
 */
export function supportLabels(
  tree: Tree,
  laid: Layout,
  opts: SupportLabelOptions,
): SupportLabel[] {
  const charW = opts.charWidth ?? opts.fontSize * 0.62;
  const markerW = charW;
  const pillH = opts.fontSize + PILL_PAD_Y * 2;
  const markerR = opts.nodeRadius;
  const byId = new Map(laid.nodes.map((n) => [n.id, n]));

  const obstacles: LabelBox[] = [];
  for (const n of laid.nodes) {
    // Node markers (and their highlight ring) are hard obstacles.
    obstacles.push({
      minX: n.x - markerR - 1,
      maxX: n.x + markerR + 1,
      minY: n.y - markerR - 1,
      maxY: n.y + markerR + 1,
    });
    // Leaf names run right of the marker, vertically centered on y.
    if (n.leaf && n.label !== null) {
      obstacles.push({
        minX: n.x + markerR + opts.labelOffset,
        maxX:
          n.x +
          markerR +
          opts.labelOffset +
          n.label.length * opts.nameFontSize * 0.62,
        minY: n.y - opts.nameFontSize / 2 - NAME_PAD,
        maxY: n.y + opts.nameFontSize / 2 + NAME_PAD,
      });
    }
    // The "0" zero-length marker sits above the branch's midpoint.
    const parent = tree.nodes[n.id].parent;
    if (parent !== null && byId.has(parent) && tree.branches[n.id].length === 0) {
      const mid = (n.parentX + n.x) / 2;
      const w = charW + NAME_PAD * 2;
      obstacles.push({
        minX: mid - w / 2,
        maxX: mid + w / 2,
        minY: n.y - 4 - opts.fontSize - NAME_PAD,
        maxY: n.y - 4 + NAME_PAD,
      });
    }
  }

  const labels: SupportLabel[] = [];
  const firstHit = (box: LabelBox): LabelBox | null => {
    for (const o of obstacles) if (intersects(box, o)) return o;
    for (const p of labels) if (intersects(box, p.box)) return p.box;
    return null;
  };

  for (const n of laid.nodes) {
    const s = tree.branches[n.id].support;
    const parent = tree.nodes[n.id].parent;
    if (s === null || parent === null || !byId.has(parent)) continue;

    const weak = s < 0.5;
    const text = String(Math.round(s * 100));
    const textW = text.length * charW;
    const pillW = textW + PILL_PAD_X * 2 + (weak ? markerW : 0);

    // Preferred spot: bottom-right corner tucked just left of and above
    // the node marker — the branch's child end.
    let box: LabelBox = {
      minX: n.x - markerR - GAP - pillW,
      maxX: n.x - markerR - GAP,
      minY: n.y - markerR - GAP - pillH,
      maxY: n.y - markerR - GAP,
    };

    // Nudge upward past whatever the pill would sit on. Each jump moves
    // the box strictly above the hit obstacle, so the loop is monotone
    // and terminates; running off the canvas top falls back to below.
    let hit = firstHit(box);
    let guard = 0;
    while (hit !== null && guard++ < 1000) {
      box = { ...box, maxY: hit.minY - 1, minY: hit.minY - 1 - pillH };
      if (box.minY < 0) break;
      hit = firstHit(box);
    }
    if (hit !== null || box.minY < 0) {
      box = {
        ...box,
        minY: n.y + markerR + GAP,
        maxY: n.y + markerR + GAP + pillH,
      };
      hit = firstHit(box);
      guard = 0;
      while (hit !== null && guard++ < 1000) {
        box = { ...box, minY: hit.maxY + 1, maxY: hit.maxY + 1 + pillH };
        hit = firstHit(box);
      }
      // A canvas-bottom overflow can't happen (labels stay inside the
      // laid-out height); the last box is kept regardless — a degenerate
      // tree is still better drawn than dropped.
    }

    const textY = (box.minY + box.maxY) / 2;
    labels.push({
      id: n.id,
      text,
      weak,
      box,
      // The number centers on the pill's text area; a weak marker gets
      // its own slot at the pill's right edge.
      textX: weak ? box.minX + PILL_PAD_X + textW / 2 : (box.minX + box.maxX) / 2,
      textY,
      markerX: weak ? box.maxX - PILL_PAD_X - markerW / 2 : null,
    });
  }
  return labels;
}
