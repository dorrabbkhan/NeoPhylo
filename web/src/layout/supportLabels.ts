// Support-label placement (v1.2 spec §6.3; owner checkpoint 21-10-26).
// Pure geometry: given the laid-out tree, each internal branch's
// support percentage is drawn as a small pill centred just ABOVE the
// horizontal segment that leads into its node — right-aligned near the
// node end. Every node has exactly one such segment, so the label can
// never read as belonging to a neighbour (the corner-candidate scheme
// left pills floating between nodes in dense clusters).
//
// Segment fit: layout() stretches a supported edge until it can hold
// its pill with headroom (SEG_MARGIN px beyond the pill at its left —
// the owner's "label width + 4 px" rule applied to the padded pill).
// When the stretch would widen the drawing by more than 20% the cap
// refuses it (see treeFigure): the pill is then drawn OFFSET above
// the node with a thin leader line down to it — the callout keeps the
// association explicit where on-segment placement is impossible.
//
// Collision avoidance: a pill box may not intersect any node marker,
// leaf name, "0" zero-length marker or an already-placed label. The
// right-aligned spot slides left along its own segment when blocked
// (staying over the segment keeps the association unambiguous); only
// a fully blocked segment falls back to stacking straight up. Branch
// lines and connector elbows are not obstacles — the opaque pill is
// meant to sit over them. Internal node names (u1, u2, …) are not
// drawn while support labels are shown, so they are not obstacles.
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
  /** Set when the segment could not hold the pill (stretch capped):
   * the pill is offset and a thin leader runs from its bottom centre
   * to the node. Both renderers draw it from the same geometry. */
  leader?: { x1: number; y1: number; x2: number; y2: number };
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
// Headroom the fitted segment keeps free left of the pill — the
// owner's "segment at least label width + 4 px" rule.
const SEG_MARGIN = 4;
// Extra lift for a leader-offset pill: clearly off the row it
// annotates, close enough that the leader reads as a callout.
const LEADER_RAISE = 10;

/** The drawn text: the rounded percent, "*" merged in for weak. */
export function supportText(s: number): string {
  return `${Math.round(s * 100)}${s < 0.5 ? "*" : ""}`;
}

/** Padded pill width for `text` at `fontSize` (0.62 em estimate). */
export function pillWidth(text: string, fontSize: number): number {
  return text.length * fontSize * 0.62 + PILL_PAD_X * 2;
}

/**
 * Drawn segment length (px) needed to hold this label's pill:
 * pill + marker clearance at the node end + SEG_MARGIN headroom.
 * layout() uses this to stretch supported edges; supportLabels uses
 * the same value to decide whether a pill rides on its segment or is
 * leader-offset.
 */
export function segFitPx(
  text: string,
  fontSize: number,
  nodeRadius: number,
): number {
  return pillWidth(text, fontSize) + nodeRadius + 1 + GAP + SEG_MARGIN;
}

function intersects(a: LabelBox, b: LabelBox): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minY < b.maxY && a.maxY > b.minY;
}

/**
 * One pill per branch carrying `branches[id].support`, centred just
 * above the horizontal segment into its node and right-aligned near
 * the node end. Nodes are processed in layout order (preorder —
 * parents first), so "the later one" that nudges is simply the later
 * id in `laid.nodes`.
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
    const text = supportText(s);
    const textW = text.length * charW;
    const pillW = textW + PILL_PAD_X * 2;
    // Pill + marker clearance + headroom, mirroring segFitPx (kept in
    // terms of the actual pill width so a charWidth override stays
    // consistent).
    const fitPx = pillW + markerR + 1 + GAP + SEG_MARGIN;
    // The horizontal segment into the node runs [parentX, x] at y.
    const segLen = n.x - n.parentX;
    // Right edge clears the marker box plus a gap — "right-aligned
    // near the node end".
    const right = n.x - markerR - 1 - GAP;

    const rightBox = (raise: number): LabelBox => ({
      minX: right - pillW,
      maxX: right,
      minY: n.y - raise - pillH,
      maxY: n.y - raise,
    });
    // Monotone climb: each jump puts the box strictly above the last
    // obstacle it touched, so the loop terminates.
    const climb = (start: LabelBox): LabelBox => {
      let box = start;
      let hit = firstHit(box);
      let guard = 0;
      while (hit !== null && guard++ < 1000) {
        box = { ...box, maxY: hit.minY - 1, minY: hit.minY - 1 - pillH };
        hit = firstHit(box);
      }
      // The last box is kept regardless — a degenerate tree is still
      // better drawn than dropped.
      return box;
    };

    let box: LabelBox | undefined;
    if (segLen >= fitPx - 0.5) {
      // On-segment: right-aligned just above the line; when blocked,
      // slide left while the box still lies over its own segment.
      const leftEdge = n.parentX + 1;
      let x0 = right - pillW;
      box = rightBox(GAP);
      let hit = firstHit(box);
      let guard = 0;
      while (hit !== null && x0 > leftEdge && guard++ < 1000) {
        x0 = Math.max(leftEdge, hit.minX - pillW - 1);
        box = { ...box, minX: x0, maxX: x0 + pillW };
        hit = firstHit(box);
      }
      if (hit !== null) box = undefined;
    }

    let leader: SupportLabel["leader"];
    if (box === undefined) {
      // The pill cannot sit on its segment — the 20%-of-width cap
      // refused the stretch, or every spot over the segment collided.
      // A stacked label that strays toward a neighbour's segment is
      // exactly the ambiguity this checkpoint removes, so instead the
      // pill is offset above the node (right-aligned, still hanging
      // over its own edge) with a thin leader down to the node.
      box = climb(rightBox(GAP + pillH + LEADER_RAISE));
      leader = {
        x1: (box.minX + box.maxX) / 2,
        y1: box.maxY,
        x2: n.x,
        y2: n.y,
      };
    }

    const textY = (box.minY + box.maxY) / 2;
    labels.push({
      id: n.id,
      text,
      weak,
      box,
      textX: (box.minX + box.maxX) / 2,
      textY,
      leader,
    });
  }
  return labels;
}
