// Support-label placement (v1.2 spec §6.3, checkpoint 11/12 fixes).
// Pure geometry: given the laid-out tree, position each internal
// branch's support percentage as a small pill just RIGHT of the node
// marker at the branch's child end, above the start of the descending
// branch — the usual node-label spot on a horizontal phylogram. The
// candidates also try the node end of the incoming branch (left of the
// node) before the vertical climb — safe now that bounds fit content
// (checkpoint 15; see below).
//
// Collision avoidance: a label's pill box may not intersect any node
// marker, leaf name, "0" zero-length marker or an already-placed label.
// Spots are tried in order of proximity to the node: the four corners
// first — right of and above/below the node, then the same two left of
// it over the node end of its incoming branch (the textbook spot; the
// old fixed viewBox could not contain left pills — they clipped at x=0
// — but content-fit bounds can, checkpoint 15) — then a bounded scan
// of every pill-centre position within 30 px of the node. Crowded leaf
// names used to push labels a whole staircase above their node — ~100
// px away, read as "labels on the wrong groupings"; the vertical
// climb remains, but only after every within-reach spot failed, so
// labels stay by their node. Internal node names (u1, u2, …) are not
// drawn while support labels are shown, so they are not obstacles
// here.
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
  /** Baseline anchor for the text (textAnchor middle). */
  textX: number;
  textY: number;
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
 * One pill per branch carrying `branches[id].support`, placed just
 * right of and above the child-end node. Nodes are processed in layout
 * order (preorder — parents first), so "the later one" that nudges is
 * simply the later id in `laid.nodes`.
 */
export function supportLabels(
  tree: Tree,
  laid: Layout,
  opts: SupportLabelOptions,
): SupportLabel[] {
  const charW = opts.charWidth ?? opts.fontSize * 0.62;
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
    // Leaf names run right of the marker. They render with
    // dominantBaseline="middle", whose glyph box reaches about a full
    // em ABOVE the anchor and a third below — a symmetric ±0.5em box
    // underestimates the top and lets pills graze real text (seen as
    // "pill vs name" overlaps in the computed view).
    if (n.leaf && n.label !== null) {
      obstacles.push({
        minX: n.x + markerR + opts.labelOffset,
        maxX:
          n.x +
          markerR +
          opts.labelOffset +
          n.label.length * opts.nameFontSize * 0.62,
        minY: n.y - opts.nameFontSize - NAME_PAD,
        maxY: n.y + opts.nameFontSize * 0.5 + NAME_PAD,
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
    // One text node per label: the full value including the weak "*"
    // (checkpoint 12 — the number and marker are a single string so the
    // whole label, not just its tail, is what readers see).
    const text = `${Math.round(s * 100)}${weak ? "*" : ""}`;
    const textW = text.length * charW;
    const pillW = textW + PILL_PAD_X * 2;

    // Candidate spots in preference order, first non-colliding wins.
    // Right spots hang the pill off the node (over the descending
    // branch); left spots put it over the node end of the incoming
    // branch. Every candidate keeps the label within ~25 px of its
    // node — far better than the climb's staircase (checkpoint 15).
    const rightX0 = n.x + markerR + GAP;
    const leftX0 = n.x - markerR - GAP - pillW;
    const rightAbove: LabelBox = {
      minX: rightX0,
      maxX: rightX0 + pillW,
      minY: n.y - markerR - GAP - pillH,
      maxY: n.y - markerR - GAP,
    };
    const rightBelow: LabelBox = {
      ...rightAbove,
      minY: n.y + markerR + GAP,
      maxY: n.y + markerR + GAP + pillH,
    };
    const leftAbove: LabelBox = {
      minX: leftX0,
      maxX: leftX0 + pillW,
      minY: rightAbove.minY,
      maxY: rightAbove.maxY,
    };
    const leftBelow: LabelBox = {
      ...leftAbove,
      minY: rightBelow.minY,
      maxY: rightBelow.maxY,
    };
    let box = [rightAbove, rightBelow, leftAbove, leftBelow].find(
      (b) => firstHit(b) === null,
    );

    if (box === undefined) {
      // The four slots are all blocked — dense clusters take the
      // corner spots for later nodes. Scan every pill-centre position
      // whose anchor stays within 30 px of the node (the acceptance
      // distance for figure parity), on each side, nearest first. A
      // 1 px vertical step finds the slivers between already-placed
      // pills that whole-pill nudges jump over.
      const near: { box: LabelBox; d: number }[] = [];
      for (const x0 of [rightX0, leftX0]) {
        const dx = x0 + pillW / 2 - n.x;
        const dyMax = Math.floor(
          Math.sqrt(Math.max(0, 30 * 30 - dx * dx)),
        );
        for (let dy = -dyMax; dy <= dyMax; dy++) {
          const cy = n.y + dy;
          near.push({
            box: {
              minX: x0,
              maxX: x0 + pillW,
              minY: cy - pillH / 2,
              maxY: cy + pillH / 2,
            },
            d: Math.hypot(dx, dy),
          });
        }
      }
      // Nearest anchor first; prefer the right side, then above, on
      // ties.
      near.sort(
        (a, b) =>
          a.d - b.d ||
          b.box.minX - a.box.minX ||
          a.box.minY - b.box.minY,
      );
      const hit = near.find((c) => firstHit(c.box) === null);
      if (hit !== undefined) box = hit.box;
    }

    if (box === undefined) {
      // Last resort: nudge upward past whatever the pill would sit on.
      // Each jump moves the box strictly above the hit obstacle, so the
      // loop is monotone and terminates; running off the canvas top
      // falls back to below.
      box = rightAbove;
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
        // A canvas-bottom overflow can't happen (labels stay inside
        // the laid-out height); the last box is kept regardless — a
        // degenerate tree is still better drawn than dropped.
      }
    }

    const textY = (box.minY + box.maxY) / 2;
    labels.push({
      id: n.id,
      text,
      weak,
      box,
      textX: (box.minX + box.maxX) / 2,
      textY,
    });
  }
  return labels;
}
