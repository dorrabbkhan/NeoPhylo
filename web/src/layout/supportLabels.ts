// Support-label placement (v1.2 spec §6.3; owner checkpoint 21-10-26,
// refined same day). Pure geometry: given the laid-out tree, each
// internal branch's support percentage is drawn as a small pill just
// ABOVE the horizontal segment that leads into its node, right-aligned
// near the node end and holding the node's own y. A short incoming
// segment is NOT stretched to fit: the pill simply extends left past
// the segment's start, over the parent's vertical line — the opaque
// pill background masks the line beneath it.
//
// Collision avoidance: only labels, leaf names and node markers are
// obstacles (the drawn "0" marker counts as a marker — covering text
// with a pill would look broken). Branch lines and connectors are NOT
// obstacles; the pill is meant to mask whatever it covers. When the
// right-aligned spot is blocked the pill is nudged vertically, ± 6 px
// down first — it stays closest to its node's row that way — then
// further DOWN while its centre stays within 10 px of the row (it may
// cover its own segment; masked like any line). Only an unresolved
// collision earns a leader line: the pill climbs
// to a clear offset and a thin leader runs to the node, routed so it
// crosses no branch — attach points are tried along the pill's bottom
// edge right-to-left, then up its right edge, keeping the first one
// whose straight line to the node clears every drawn segment and
// connector.
//
// The collision machinery — obstacle boxes, hit test, climb, leader
// routing — is shared with the internal-node name placer in
// labelCollision.ts.

import type { Tree } from "../engine/generated/Tree";

import {
  branchSegsFor,
  climb,
  makeHitTest,
  routeLeader,
  textObstacles,
  type LabelBox,
} from "./labelCollision";
import type { Layout } from "./phylogram";

export type { LabelBox } from "./labelCollision";

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
  /** Set only when a collision survived the ±6 px nudge: the pill is
   * offset and a thin leader runs to the node, crossing no branch.
   * Both renderers draw it from the same geometry. */
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
  /** Estimated character width; defaults to 0.62 em like treePanel.
   * Used only when `measure` is absent or returns null. */
  charWidth?: number;
  /** Real glyph extents of `text` rendered at `fontSize` in the app's
   * font — a getComputedTextLength + getBBox probe (TextExtents from
   * src/measureText.ts). Returns null where the DOM can't measure;
   * the estimates then stand in. */
  measure?: (
    text: string,
    fontSize: number,
    baseline?: "middle" | "alphabetic",
  ) => { w: number; top: number; bottom: number; } | null;
}

const GAP = 2;
const PILL_PAD_X = 5;
const PILL_PAD_Y = 2;
// The spec'd "small vertical nudge": ±NUDGE px around the base spot.
const NUDGE = 6;
// If even that band is blocked the pill keeps descending — it may
// cover its own incoming segment (masked like any branch line) and
// still belongs to its node's row as long as its centre stays within
// the 10 px acceptance bound. Upward is not extended: a pill pushed
// above its row starts to read as the row above's label.
const DROP_PAD = 10;
// The on-segment convention is verified by measuring the DRAWN pill:
// the e2e check allows only ~1e-6 of slop on a centre offset, and
// Firefox's getBBox is float32-precise (~1e-5 at viewBox scale) where
// Chromium's is exact. A pill resting exactly on the ±DROP_PAD bound
// therefore passes in Chromium and fails in Firefox on rounding alone.
// Placements keep the centre strictly inside the bound by this inset —
// a fraction of a pixel, invisible in the drawing.
const BOUND_INSET = 0.25;
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
 * One pill per branch carrying `branches[id].support`, right-aligned
 * just above the horizontal segment into its node (nudged ≤ 6 px when
 * blocked; leader-offset only as a last resort). Nodes are processed
 * in layout order (preorder — parents first), so "the later one" that
 * nudges is simply the later id in `laid.nodes`.
 */
export function supportLabels(
  tree: Tree,
  laid: Layout,
  opts: SupportLabelOptions,
): SupportLabel[] {
  const textW = (t: string, fs: number): number =>
    opts.measure?.(t, fs)?.w ?? t.length * (opts.charWidth ?? fs * 0.62);
  const pillH = opts.fontSize + PILL_PAD_Y * 2;
  const markerR = opts.nodeRadius;
  const byId = new Map(laid.nodes.map((n) => [n.id, n]));

  const obstacles = textObstacles(tree, laid, {
    markerFontSize: opts.fontSize,
    nameFontSize: opts.nameFontSize,
    nodeRadius: opts.nodeRadius,
    labelOffset: opts.labelOffset,
    charWidth: opts.charWidth,
    measure: opts.measure,
  });
  const branchSegs = branchSegsFor(tree, laid);

  const labels: SupportLabel[] = [];
  const firstHit = makeHitTest(obstacles, labels);

  for (const n of laid.nodes) {
    const s = tree.branches[n.id].support;
    const parent = tree.nodes[n.id].parent;
    if (s === null || parent === null || !byId.has(parent)) continue;

    const weak = s < 0.5;
    const text = supportText(s);
    const measured = textW(text, opts.fontSize);
    const pillW = measured + PILL_PAD_X * 2;
    // Right edge clears the marker box plus a gap — "right-aligned
    // near the node end". A short segment lets the pill overhang left
    // past its start, over the parent's vertical (masked by the pill).
    const right = n.x - markerR - 1 - GAP;
    // Bottom edge just above the segment, capped so the pill's centre
    // stays strictly within 10 px of the node's row when the font
    // allows (BOUND_INSET — landing on the bound itself flakes under
    // Firefox's float32 getBBox).
    const raise0 = Math.max(
      // Binds only ≥14 px, where the cap would put the centre on/past the 10 px bound; smallFont is 12–13 px.
      1,
      Math.min(GAP, DROP_PAD - BOUND_INSET - pillH / 2),
    );
    const atRaise = (raise: number): LabelBox => ({
      minX: right - pillW,
      maxX: right,
      minY: n.y - raise - pillH,
      maxY: n.y - raise,
    });

    let box: LabelBox | undefined;
    // Nudge ladder: the base spot, then the ±NUDGE band (down first —
    // it keeps the pill closest to the row), then further downward
    // until the pill's centre would drop 10 px below the node's row.
    const nudges = [0];
    for (let d = 1; d <= NUDGE; d += 1) nudges.push(-d, d);
    for (
      let d = NUDGE + 1;
      raise0 - d >= BOUND_INSET - DROP_PAD - pillH / 2;
      d += 1
    )
      nudges.push(-d);
    for (const d of nudges) {
      const cand = atRaise(raise0 + d);
      if (firstHit(cand) === null) {
        box = cand;
        break;
      }
    }

    let leader: SupportLabel["leader"];
    if (box === undefined) {
      // Unresolved label/name/marker collision — the only case that
      // earns a leader line now.
      box = climb(atRaise(GAP + pillH + LEADER_RAISE), pillH, firstHit);
      leader = routeLeader(box, n.x, n.y, branchSegs);
    }

    labels.push({
      id: n.id,
      text,
      weak,
      box,
      textX: (box.minX + box.maxX) / 2,
      textY: (box.minY + box.maxY) / 2,
      leader,
    });
  }
  return labels;
}
