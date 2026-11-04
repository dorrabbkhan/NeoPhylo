// Highlighted internal-node name placement (u1, u2, …) — owner
// follow-up after PR #139's review: the names used to draw
// unconditionally right of their node, so a name could sit on a child
// marker on the same row (the globins NJ run's u20 ended on top of the
// Cow_HBB leaf marker) or on another name. Names now resolve
// collisions against the same obstacles the support pills avoid —
// node markers, leaf names, "0" markers and already-placed names —
// while branch segments and connectors are deliberately NOT
// obstacles: each name rides a halo plate (drawn in the page
// background token) that masks whatever line it covers, the exact
// convention the pills set.
//
// The resting spot is the old anchor — right of the node on its own
// row — so a name whose spot is free draws exactly where it always
// did. When blocked it nudges vertically ±6 px, down first like the
// pills, then further down while its centre stays within 10 px of the
// row; the mirrored spot left of the node (over the incoming segment,
// masked by the plate) is tried at each step. Only an unresolved
// collision earns a leader line: the name climbs to a clear offset
// and a thin leader runs to the node, routed so it crosses no branch
// — the shared labelCollision machinery does all of it.

import type { Tree } from "../engine/generated/Tree";
import { nodeName } from "../state/names";

import {
  branchSegsFor,
  climb,
  makeHitTest,
  routeLeader,
  textObstacles,
  type LabelBox,
  type Leader,
} from "./labelCollision";
import type { Layout } from "./phylogram";

export interface InternalName {
  /** Node the name annotates. */
  id: number;
  /** The drawn text — the u-name. */
  text: string;
  /** The halo plate's bounds in drawing coordinates (TreeView fills it
   * with the page-background token so the lines beneath are masked). */
  box: LabelBox;
  /** Text anchor: `textX` is the glyph run's left edge for "start",
   * right edge for "end", centre for "middle"; `textY` is the
   * dominantBaseline-middle anchor — the plate's vertical centre. */
  textX: number;
  textY: number;
  anchor: "start" | "end" | "middle";
  /** Set only when every in-row spot was blocked: the name sits on a
   * clear offset and a thin leader runs to the node, crossing no
   * branch (the support leaders' convention). */
  leader?: Leader;
}

export interface InternalNameOptions {
  /** Highlighted nodes that get names — only internal ones are used. */
  ids: ReadonlySet<number>;
  /** Name font size in px — the figure's leaf font. */
  fontSize: number;
  /** The "0" markers' font size, for their obstacle boxes (smallFont). */
  markerFontSize: number;
  /** Node marker radius including highlight slack. */
  nodeRadius: number;
  /** Gap between a marker and the start of its label. */
  labelOffset: number;
  /** Real glyph extents (src/measureText.ts probe); null falls back to
   * the 0.62 em estimate, like the other placers. */
  measure?: (
    text: string,
    fontSize: number,
    baseline?: "middle" | "alphabetic",
  ) => { w: number; top: number; bottom: number } | null;
}

// Halo padding around the name's glyph run. PAD_X never exceeds the
// marker→label offset, so a resting plate's inner edge lands exactly
// on the marker's obstacle edge — touching, never covering it.
const PAD_X = 3;
const PAD_Y = 2;
// The spec'd "small vertical nudge", same band the pills use.
const NUDGE = 6;
// How far below its row a name may drift before it stops reading as
// that node's label — the pills' 10 px acceptance bound.
const DROP_PAD = 10;
// Extra lift for a leader-offset name, mirroring the pills'.
const LEADER_RAISE = 10;

/**
 * One name per highlighted internal node in `laid`, resting right of
 * the marker and nudged off obstacles (never onto a marker, a leaf
 * name, a "0" marker or another name; leader-offset only as a last
 * resort). Nodes are processed in layout order (preorder — parents
 * first), like the pills.
 */
export function internalNames(
  tree: Tree,
  laid: Layout,
  opts: InternalNameOptions,
): InternalName[] {
  const plateH = opts.fontSize + PAD_Y * 2;
  // Marker edge plus the label gap — the name's resting anchor offset.
  const edge = opts.nodeRadius + opts.labelOffset;

  const obstacles = textObstacles(tree, laid, {
    markerFontSize: opts.markerFontSize,
    nameFontSize: opts.fontSize,
    nodeRadius: opts.nodeRadius,
    labelOffset: opts.labelOffset,
    measure: opts.measure,
  });
  const branchSegs = branchSegsFor(tree, laid);

  const names: InternalName[] = [];
  const firstHit = makeHitTest(obstacles, names);

  for (const n of laid.nodes) {
    if (n.leaf || !opts.ids.has(n.id)) continue;
    const text = nodeName(tree, n.id);
    const w =
      opts.measure?.(text, opts.fontSize)?.w ??
      text.length * opts.fontSize * 0.62;
    const rightBox = (dy: number): LabelBox => ({
      minX: n.x + edge - PAD_X,
      maxX: n.x + edge + w + PAD_X,
      minY: n.y + dy - plateH / 2,
      maxY: n.y + dy + plateH / 2,
    });
    const leftBox = (dy: number): LabelBox => ({
      minX: n.x - edge - w - PAD_X,
      maxX: n.x - edge + PAD_X,
      minY: n.y + dy - plateH / 2,
      maxY: n.y + dy + plateH / 2,
    });
    // The row first, then the ±NUDGE band (down first — it keeps the
    // name closest to its node's row, same as the pills), then further
    // down while the centre stays within DROP_PAD of the row; each
    // step tries the right side, then the mirrored left.
    const nudges = [0];
    for (let d = 1; d <= NUDGE; d += 1) nudges.push(-d, d);
    for (let d = NUDGE + 1; d <= DROP_PAD; d += 1) nudges.push(-d);

    let box: LabelBox | undefined;
    let anchor: InternalName["anchor"] = "start";
    for (const dy of nudges) {
      const cand = rightBox(dy);
      if (firstHit(cand) === null) {
        box = cand;
        break;
      }
      const mirror = leftBox(dy);
      if (firstHit(mirror) === null) {
        box = mirror;
        anchor = "end";
        break;
      }
    }

    let leader: InternalName["leader"];
    if (box === undefined) {
      // Unresolved marker/name collision — the only case that earns a
      // leader line now (the pills' last resort).
      box = climb(
        rightBox(-(PAD_Y + plateH + LEADER_RAISE)),
        plateH,
        firstHit,
      );
      anchor = "middle";
      leader = routeLeader(box, n.x, n.y, branchSegs);
    }

    names.push({
      id: n.id,
      text,
      box,
      textX:
        anchor === "start"
          ? n.x + edge
          : anchor === "end"
            ? n.x - edge
            : (box.minX + box.maxX) / 2,
      textY: (box.minY + box.maxY) / 2,
      anchor,
      leader,
    });
  }
  return names;
}
