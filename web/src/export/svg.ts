// Standalone SVG export of a tree (plan Task 24, spec §6.6; geometry
// unified in v1.2 checkpoint 15). There is NO separate export layout:
// this serializes the same `treeFigure()` output the on-screen
// TreeView draws — same layout, same support-label placement, same
// content-fit bounds — given the same inputs (App passes the measured
// panel width and shared leaf spacing). Only the output format
// differs: a self-contained document with a system font stack, inline
// styles and XML-escaped labels, so a taxon name containing markup can
// never be parsed as SVG (Review Focus 2).

import type { Tree } from "../engine/generated/Tree";
import { splitKeys, treeTaxaOrder } from "../layout/splitKeys";
import {
  FIGURE_LABEL_OFFSET,
  FIGURE_NODE_RADIUS,
  snapDevicePx,
  treeFigure,
} from "../layout/treeFigure";
import { makeTextMeasurer } from "../measureText";
import { labelRoomFor, leafFontSize } from "../layout/treePanel";
import { color, exportInk } from "../design/tokens";

export interface ExportSvgOptions {
  kind: "phylogram" | "cladogram";
  clampNegative: boolean;
  /** Leaf spacing the on-screen figure used; a readable default stands
   * in for standalone calls. */
  leafSpacing?: number;
  /** The measured .tree-canvas width of the displayed figure, so the
   * export lays out identically; <= 0/omitted picks a default that
   * reproduces the pre-checkpoint-15 drawing width. */
  panelWidth?: number;
  visibleNodes?: Set<number>;
  /** Taxon labels in alignment order for data-split grouping keys
   * (defaults to the tree's arena leaf order); `splitRooted` selects
   * the UPGMA-cluster convention over the NJ unrooted-split one. */
  splitTaxa?: string[];
  splitRooted?: boolean;
}

const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
// Ink stays the pre-token #1a1a1a via the exportInk token — moving to
// the §7.3 print palette is Task 15's scope (owner decision on PR
// #65). The support pill keeps the "page fill + hairline border" of
// the light --bg/--border, unchanged from the literals.
const INK = exportInk;
const PILL_FILL = color.light.bg;
const PILL_STROKE = color.light.border;

// Standalone-document geometry: no panel exists to measure, so when
// the caller does not pass the on-screen values a readable default is
// used. PAD is the viewBox margin — the content-fit bounds leave no
// empty areas (checkpoint 15: the old fixed label-room reservation
// produced the large empty right area).
const LEAF_SPACING = 22;
const DRAW_WIDTH = 480;
const PAD = 16;

/** Escape a string for use as XML character data or an attribute value. */
export function escapeXml(s: string): string {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

/**
 * Serialize `tree` to a standalone SVG document of the same figure the
 * screen draws. Branch geometry and label placement come from
 * `treeFigure()`; negative branches are dashed, matching the on-screen
 * convention (spec §6.3). Every node group and support label carries
 * the same `data-split` key as the on-screen tree.
 */
export function exportSvg(tree: Tree, opts: ExportSvgOptions): string {
  const leafSpacing = opts.leafSpacing ?? LEAF_SPACING;
  // Default the panel width to reproduce the legacy drawing width
  // (DRAW_WIDTH = panelWidth - labelRoom - 2·panel-pad).
  const fontSize = leafFontSize(leafSpacing);
  const panelWidth =
    opts.panelWidth !== undefined && opts.panelWidth > 0
      ? opts.panelWidth
      : DRAW_WIDTH +
        labelRoomFor(
          tree.nodes.map((n) => n.label),
          fontSize,
        ) +
        16;

  const fig = treeFigure(tree, {
    kind: opts.kind,
    clampNegative: opts.clampNegative,
    leafSpacing,
    panelWidth,
    visibleNodes: opts.visibleNodes,
    // The standalone document declares FONT_FAMILY — measure against
    // it so pills and bounds match the text the export will draw.
    measure: makeTextMeasurer(undefined, FONT_FAMILY),
  });
  const { laid, byId, labelById, fontSize: leafFont, smallFont, bounds } = fig;
  const keys = splitKeys(
    tree,
    opts.splitTaxa ?? treeTaxaOrder(tree),
    opts.splitRooted ?? false,
  );

  const width = bounds.maxX - bounds.minX + PAD * 2;
  const height = bounds.maxY - bounds.minY + PAD * 2;
  const tx = (x: number) => x - bounds.minX + PAD;
  const ty = (y: number) => y - bounds.minY + PAD;

  const parts: string[] = [];
  const line = (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    cls: string,
    negative: boolean,
    strokeWidth = 1.5,
  ) => {
    const dash = negative ? ' stroke-dasharray="4 3"' : "";
    parts.push(
      `<line class="${cls}" x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${INK}" stroke-width="${strokeWidth}"${dash}/>`,
    );
  };

  for (const n of laid.nodes) {
    const parent = tree.nodes[n.id].parent;
    const hasParent = parent !== null && byId.has(parent);
    // Bootstrap support (v1.2 spec §6.8): weak (<50%) edges draw with
    // the same thin stroke as on screen — never color alone (§6.5).
    const support = hasParent ? tree.branches[n.id].support : null;
    const weak = support !== null && support < 0.5;
    const key = keys.get(n.id) ?? "";
    parts.push(`<g data-node="${n.id}" data-split="${escapeXml(key)}">`);
    if (hasParent) {
      line(
        tx(n.parentX),
        ty(n.y),
        tx(n.x),
        ty(n.y),
        n.negative ? "branch negative" : "branch",
        n.negative,
        weak ? 1 : 1.5,
      );
    }
    const children = tree.nodes[n.id].children.filter((c) => byId.has(c));
    if (children.length > 0) {
      const top = byId.get(children[0])!;
      const bottom = byId.get(children[children.length - 1])!;
      line(
        tx(n.x),
        ty(top.y),
        tx(n.x),
        ty(bottom.y),
        "connector",
        false,
      );
    }
    parts.push(
      `<circle cx="${tx(n.x).toFixed(2)}" cy="${ty(n.y).toFixed(2)}" r="${FIGURE_NODE_RADIUS}" fill="${INK}"/>`,
    );
    if (hasParent && tree.branches[n.id].length === 0) {
      parts.push(
        `<text class="zero-len" x="${((tx(n.parentX) + tx(n.x)) / 2).toFixed(2)}" y="${(ty(n.y) - 4).toFixed(2)}" font-size="${smallFont}" fill="${INK}" text-anchor="middle">0</text>`,
      );
    }
    const placedLabel = labelById.get(n.id);
    if (placedLabel !== undefined) {
      const w = placedLabel.box.maxX - placedLabel.box.minX;
      const h = placedLabel.box.maxY - placedLabel.box.minY;
      const leader = placedLabel.leader;
      parts.push(`<g class="support">`);
      if (leader !== undefined) {
        parts.push(
          `<line class="support-leader" x1="${tx(leader.x1).toFixed(2)}" y1="${ty(leader.y1).toFixed(2)}" x2="${tx(leader.x2).toFixed(2)}" y2="${ty(leader.y2).toFixed(2)}" stroke="${INK}" stroke-width="1" stroke-dasharray="3 2"/>`,
        );
      }
      parts.push(
        `<rect class="support-pill" x="${tx(placedLabel.box.minX).toFixed(2)}" y="${ty(placedLabel.box.minY).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${(h / 2).toFixed(2)}" fill="${PILL_FILL}" stroke="${PILL_STROKE}" stroke-width="1"/>`,
        `<text class="support-label" data-split="${escapeXml(key)}" x="${tx(placedLabel.textX).toFixed(2)}" y="${ty(placedLabel.textY).toFixed(2)}" font-size="${smallFont}" fill="${INK}" text-anchor="middle" dominant-baseline="middle">${escapeXml(placedLabel.text)}</text>`,
        `</g>`,
      );
    }
    if (n.leaf && n.label !== null) {
      // Same device-pixel snap as the on-screen draw (origin 0 — the
      // document has no screen offset), so the exported label lands on
      // the same pixel grid the screen draws.
      parts.push(
        `<text x="${snapDevicePx(tx(n.x) + FIGURE_LABEL_OFFSET + FIGURE_NODE_RADIUS, 0).toFixed(2)}" y="${snapDevicePx(ty(n.y), 0).toFixed(2)}" font-size="${leafFont}" fill="${INK}" dominant-baseline="middle">${escapeXml(n.label)}</text>`,
      );
    }
    parts.push("</g>");
  }

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" ` +
    `viewBox="0 0 ${width.toFixed(2)} ${height.toFixed(2)}" ` +
    `width="${Math.ceil(width)}" height="${Math.ceil(height)}" ` +
    `font-family="${FONT_FAMILY}">` +
    parts.join("") +
    `</svg>`
  );
}
