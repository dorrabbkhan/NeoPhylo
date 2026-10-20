// Standalone SVG export of a tree (plan Task 24, spec §6.6). Uses the
// same pure layout as the on-screen TreeView, but emits a self-contained
// document: system font stack, inline styles and XML-escaped labels, so
// a taxon name containing markup can never be parsed as SVG (Review
// Focus 2).

import type { Tree } from "../engine/generated/Tree";
import { layout, type LaidOutNode } from "../layout/phylogram";
import { supportLabels } from "../layout/supportLabels";
import {
  labelRoomFor,
  leafFontSize,
  MIN_FONT_PX,
} from "../layout/treePanel";

export interface ExportSvgOptions {
  kind: "phylogram" | "cladogram";
  clampNegative: boolean;
}

const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = "#1a1a1a";
// The support pill keeps labels readable over branch lines — the same
// "page fill + hairline border" as the app's --bg/--border (light theme).
const PILL_FILL = "#ffffff";
const PILL_STROKE = "#e5e4e7";

// Fixed export geometry: unlike TreeView there is no panel to measure,
// so a readable default is used regardless of the on-screen size.
const LEAF_SPACING = 22;
const DRAW_WIDTH = 480;
const PAD = 16;
const LABEL_OFFSET = 4;
const NODE_RADIUS = 3;
// Matches TreeView: sub-12px branches stretch so the weak thin stroke
// stays visible (checkpoint 11).
const MIN_SUPPORT_BRANCH_PX = 12;

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
 * Serialize `tree` to a standalone SVG document. Branch geometry comes
 * from `layout()`; negative branches are dashed, matching the on-screen
 * convention (spec §6.3).
 */
export function exportSvg(tree: Tree, opts: ExportSvgOptions): string {
  const laid = layout(tree, {
    kind: opts.kind,
    clampNegative: opts.clampNegative,
    leafSpacing: LEAF_SPACING,
    width: DRAW_WIDTH,
    minBranchPx: MIN_SUPPORT_BRANCH_PX,
  });
  const fontSize = leafFontSize(LEAF_SPACING);
  const labelRoom = labelRoomFor(
    laid.nodes.map((n) => n.label),
    fontSize,
  );
  // Support pills use the same collision-resolved placement as
  // TreeView (v1.2 spec §6.8), with the app's 12 px text floor.
  const smallFont = Math.max(MIN_FONT_PX, fontSize - 3);
  const placed = supportLabels(tree, laid, {
    fontSize: smallFont,
    nameFontSize: fontSize,
    nodeRadius: NODE_RADIUS,
    labelOffset: LABEL_OFFSET,
  });
  // The viewBox fits every drawn box — pills can reach into the label
  // room or below the last leaf, so it is the union, never the layout.
  let minX = 0;
  let minY = 0;
  let maxX = laid.width + labelRoom;
  let maxY = laid.height;
  for (const p of placed) {
    minX = Math.min(minX, p.box.minX);
    minY = Math.min(minY, p.box.minY);
    maxX = Math.max(maxX, p.box.maxX);
    maxY = Math.max(maxY, p.box.maxY);
  }
  const width = maxX - minX + PAD * 2;
  const height = maxY - minY + PAD * 2;
  const tx = (x: number) => PAD + x - minX;
  const ty = (y: number) => PAD + y - minY;
  const byId = new Map(laid.nodes.map((n) => [n.id, n]));
  const labelById = new Map(placed.map((p) => [p.id, p]));

  const parts: string[] = [];
  const line = (
    n: LaidOutNode,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    strokeWidth = 1.5,
  ) => {
    const dash = n.negative ? ' stroke-dasharray="4 3"' : "";
    parts.push(
      `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${INK}" stroke-width="${strokeWidth}"${dash}/>`,
    );
  };

  for (const n of laid.nodes) {
    const parent = tree.nodes[n.id].parent;
    const hasParent = parent !== null && byId.has(parent);
    // Bootstrap support (v1.2 spec §6.8): weak (<50%) edges draw with
    // the same thin stroke as on screen — never color alone (§6.5).
    const support = hasParent ? tree.branches[n.id].support : null;
    const weak = support !== null && support < 0.5;
    if (hasParent) {
      line(
        n,
        tx(n.parentX),
        ty(n.y),
        tx(n.x),
        ty(n.y),
        weak ? 1 : 1.5,
      );
    }
    const children = tree.nodes[n.id].children.filter((c) => byId.has(c));
    if (children.length > 0) {
      const top = byId.get(children[0])!;
      const bottom = byId.get(children[children.length - 1])!;
      parts.push(
        `<line x1="${tx(n.x).toFixed(2)}" y1="${ty(top.y).toFixed(2)}" x2="${tx(n.x).toFixed(2)}" y2="${ty(bottom.y).toFixed(2)}" stroke="${INK}" stroke-width="1.5"/>`,
      );
    }
    parts.push(
      `<circle cx="${tx(n.x).toFixed(2)}" cy="${ty(n.y).toFixed(2)}" r="${NODE_RADIUS}" fill="${INK}"/>`,
    );
    if (n.leaf && n.label !== null) {
      parts.push(
        `<text x="${(tx(n.x) + LABEL_OFFSET + NODE_RADIUS).toFixed(2)}" y="${ty(n.y).toFixed(2)}" font-size="${fontSize}" fill="${INK}" dominant-baseline="middle">${escapeXml(n.label)}</text>`,
      );
    }
    const placedLabel = labelById.get(n.id);
    if (placedLabel !== undefined) {
      const w = placedLabel.box.maxX - placedLabel.box.minX;
      const h = placedLabel.box.maxY - placedLabel.box.minY;
      parts.push(
        `<rect class="support-pill" x="${tx(placedLabel.box.minX).toFixed(2)}" y="${ty(placedLabel.box.minY).toFixed(2)}" width="${w.toFixed(2)}" height="${h.toFixed(2)}" rx="${(h / 2).toFixed(2)}" fill="${PILL_FILL}" stroke="${PILL_STROKE}" stroke-width="1"/>`,
        `<text class="support-label" x="${tx(placedLabel.textX).toFixed(2)}" y="${ty(placedLabel.textY).toFixed(2)}" font-size="${smallFont}" fill="${INK}" text-anchor="middle" dominant-baseline="middle">${escapeXml(placedLabel.text)}</text>`,
      );
    }
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
