// Standalone SVG export of a tree (plan Task 24, spec §6.6). Uses the
// same pure layout as the on-screen TreeView, but emits a self-contained
// document: system font stack, inline styles and XML-escaped labels, so
// a taxon name containing markup can never be parsed as SVG (Review
// Focus 2).

import type { Tree } from "../engine/generated/Tree";
import { layout, type LaidOutNode } from "../layout/phylogram";
import { labelRoomFor, leafFontSize } from "../layout/treePanel";

export interface ExportSvgOptions {
  kind: "phylogram" | "cladogram";
  clampNegative: boolean;
}

const FONT_FAMILY =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const INK = "#1a1a1a";

// Fixed export geometry: unlike TreeView there is no panel to measure,
// so a readable default is used regardless of the on-screen size.
const LEAF_SPACING = 22;
const DRAW_WIDTH = 480;
const PAD = 16;
const LABEL_OFFSET = 4;
const NODE_RADIUS = 3;

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
  });
  const fontSize = leafFontSize(LEAF_SPACING);
  const labelRoom = labelRoomFor(
    laid.nodes.map((n) => n.label),
    fontSize,
  );
  const width = laid.width + labelRoom + PAD * 2;
  const height = laid.height + PAD * 2;
  const tx = (x: number) => PAD + x;
  const ty = (y: number) => PAD + y;
  const byId = new Map(laid.nodes.map((n) => [n.id, n]));

  const parts: string[] = [];
  const line = (
    n: LaidOutNode,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
  ) => {
    const dash = n.negative ? ' stroke-dasharray="4 3"' : "";
    parts.push(
      `<line x1="${x1.toFixed(2)}" y1="${y1.toFixed(2)}" x2="${x2.toFixed(2)}" y2="${y2.toFixed(2)}" stroke="${INK}" stroke-width="1.5"${dash}/>`,
    );
  };

  for (const n of laid.nodes) {
    const parent = tree.nodes[n.id].parent;
    const hasParent = parent !== null && byId.has(parent);
    if (hasParent) {
      line(n, tx(n.parentX), ty(n.y), tx(n.x), ty(n.y));
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
