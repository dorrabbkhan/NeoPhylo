// SVG rendering of a laid-out tree (spec §6.1-6.3, plan Task 15). All
// positioning comes from `layout()` in src/layout — this file only draws.
//
// Styling conventions (spec §6.3, §6.5 — meaning never relies on color alone):
// - Negative branch lengths are dashed and carry the class "negative".
// - Highlighted nodes get data-highlight="true", a thicker stroke and a
//   visible label (their display name via state/names.ts: leaf labels and
//   u1, u2, … for internal nodes).
// - Wrong clades get a dotted outline around the clade plus a "✕" marker.
// - Leaf labels are SVG <text> children, so React escapes them and markup in
//   a taxon name can never be parsed as HTML (Review Focus 2).

import { useEffect, useRef, useState } from "react";

import type { Tree } from "../engine/generated/Tree";
import { layout, type LaidOutNode } from "../layout/phylogram";
import {
  leafFontSize,
  leafSpacingFor,
  labelRoomFor,
} from "../layout/treePanel";
import { nodeName } from "../state/names";

export interface TreeViewProps {
  tree: Tree;
  layoutKind: "phylogram" | "cladogram";
  highlight: Set<number>;
  wrong: Set<number>;
  clampNegative: boolean;
  visibleNodes?: Set<number>;
  /** Vertical distance between leaves in px. Both trees in a view share
   * one value (passed by App) so their rows line up; when omitted, it is
   * derived from the measured panel height. */
  leafSpacing?: number;
  onHoverLeaf?: (label: string | null) => void;
  /** Called with the leaf's label on click — predict_pair prompts use
   * two leaf picks as an answer (Task 21); unset otherwise. */
  onPickLeaf?: (label: string) => void;
  /** Panel caption and the svg's accessible name. "True tree" /
   * "Inferred tree", or the classification variant (v1.1 spec §5.3). */
  title: string;
}

// Drawing geometry. The panel is measured with a ResizeObserver; the
// spacing/font/label-room math lives in src/layout/treePanel.ts.
const PAD = 8;
const LABEL_OFFSET = 4;
const NODE_RADIUS = 3;
const WRONG_PAD = 6;
/** Fallback panel width before the first ResizeObserver callback (also
 * used under jsdom, where the observer is a no-op stub). */
const DEFAULT_PANEL_WIDTH = 560;

interface Size {
  width: number;
  height: number;
}

/** Measures the drawing box via ResizeObserver; {0,0} until it fires. */
function usePanelSize(): [React.RefObject<HTMLDivElement | null>, Size] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<Size>({ width: 0, height: 0 });
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const r = entries[0].contentRect;
      setSize({ width: r.width, height: r.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

interface Box {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

export function TreeView({
  tree,
  layoutKind,
  highlight,
  wrong,
  clampNegative,
  visibleNodes,
  leafSpacing,
  onHoverLeaf,
  onPickLeaf,
  title,
}: TreeViewProps) {
  const [boxRef, box] = usePanelSize();

  const leaves = tree.nodes.reduce(
    (n, node) => n + (node.children.length === 0 ? 1 : 0),
    0,
  );
  const spacing = leafSpacing ?? leafSpacingFor(box.height, leaves);
  const fontSize = leafFontSize(spacing);
  const labelRoom = labelRoomFor(
    tree.nodes.map((n) => n.label),
    fontSize,
  );
  const panelWidth = box.width > 0 ? box.width : DEFAULT_PANEL_WIDTH;
  const drawWidth = Math.max(80, panelWidth - labelRoom - PAD * 2);

  const laid = layout(tree, {
    kind: layoutKind,
    clampNegative,
    leafSpacing: spacing,
    width: drawWidth,
    visibleNodes,
  });
  const byId = new Map(laid.nodes.map((n) => [n.id, n]));

  const width = laid.width + labelRoom + PAD * 2;
  const height = laid.height + PAD * 2;
  const tx = (x: number) => PAD + x;
  const ty = (y: number) => PAD + y;

  // Bounding box of a clade's laid-out nodes (plus the branch leading to it),
  // used for the dotted "wrong clade" outline. Descendants hidden by
  // visibleNodes are simply left out.
  const cladeBox = (id: number): Box | null => {
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const stack = [id];
    while (stack.length > 0) {
      const nid = stack.pop()!;
      const cur = byId.get(nid);
      if (cur) {
        minX = Math.min(minX, cur.parentX, cur.x);
        maxX = Math.max(maxX, cur.x);
        minY = Math.min(minY, cur.y);
        maxY = Math.max(maxY, cur.y);
      }
      for (const child of tree.nodes[nid].children) stack.push(child);
    }
    return minX === Infinity ? null : { minX, maxX, minY, maxY };
  };

  const branchClass = (n: LaidOutNode) =>
    n.negative ? "branch negative" : "branch";

  // The figure wrapper makes the tree's title visible above the panel;
  // the svg keeps title as its accessible name. All lines and text use
  // currentColor so the theme's --fg token styles them (see index.css).
  return (
    <figure className="tree-panel">
      <figcaption>{title}</figcaption>
      <div className="tree-canvas" ref={boxRef}>
        <svg role="img" aria-label={title} viewBox={`0 0 ${width} ${height}`}>
          {laid.nodes.map((n) => {
            const children = tree.nodes[n.id].children.filter((c) =>
              byId.has(c),
            );
            const parent = tree.nodes[n.id].parent;
            const hasVisibleParent = parent !== null && byId.has(parent);
            const isHighlighted = highlight.has(n.id);
            const strokeWidth = isHighlighted ? 3 : 1.5;
            return (
              <g
                key={n.id}
                data-node={n.id}
                data-highlight={isHighlighted ? "true" : undefined}
              >
                {hasVisibleParent && (
                  <line
                    className={branchClass(n)}
                    x1={tx(n.parentX)}
                    y1={ty(n.y)}
                    x2={tx(n.x)}
                    y2={ty(n.y)}
                    stroke="currentColor"
                    strokeWidth={strokeWidth}
                    strokeDasharray={n.negative ? "4 3" : undefined}
                  />
                )}
                {children.length > 0 && (
                  <line
                    className="connector"
                    x1={tx(n.x)}
                    y1={ty(byId.get(children[0])!.y)}
                    x2={tx(n.x)}
                    y2={ty(byId.get(children[children.length - 1])!.y)}
                    stroke="currentColor"
                    strokeWidth={strokeWidth}
                  />
                )}
                <circle
                  cx={tx(n.x)}
                  cy={ty(n.y)}
                  r={isHighlighted ? NODE_RADIUS + 1 : NODE_RADIUS}
                  fill="currentColor"
                />
                {hasVisibleParent && tree.branches[n.id].length === 0 && (
                  <text
                    className="zero-len"
                    x={(tx(n.parentX) + tx(n.x)) / 2}
                    y={ty(n.y) - 4}
                    fontSize={fontSize - 3}
                    textAnchor="middle"
                  >
                    0
                  </text>
                )}
                {n.leaf ? (
                  <text
                    x={tx(n.x) + LABEL_OFFSET + NODE_RADIUS}
                    y={ty(n.y)}
                    fontSize={fontSize}
                    fill="currentColor"
                    dominantBaseline="middle"
                    onMouseEnter={() => onHoverLeaf?.(n.label)}
                    onMouseLeave={() => onHoverLeaf?.(null)}
                    onClick={
                      onPickLeaf === undefined || n.label === null
                        ? undefined
                        : () => onPickLeaf(n.label as string)
                    }
                  >
                    {n.label}
                  </text>
                ) : (
                  isHighlighted && (
                    <text
                      x={tx(n.x) + LABEL_OFFSET + NODE_RADIUS}
                      y={ty(n.y)}
                      fontSize={fontSize}
                      fill="currentColor"
                      dominantBaseline="middle"
                    >
                      {nodeName(tree, n.id)}
                    </text>
                  )
                )}
              </g>
            );
          })}
          {[...wrong].map((id) => {
            const box = cladeBox(id);
            if (!box) return null;
            const x = tx(box.minX) - WRONG_PAD;
            const y = ty(box.minY) - WRONG_PAD;
            const w = box.maxX - box.minX + WRONG_PAD * 2;
            const h = box.maxY - box.minY + WRONG_PAD * 2;
            return (
              <g key={`wrong-${id}`} className="wrong">
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={1.5}
                  strokeDasharray="1 3"
                  strokeLinecap="round"
                />
                <text
                  x={x + 2}
                  y={y + fontSize - 2}
                  fontSize={fontSize}
                  fill="currentColor"
                >
                  ✕
                </text>
              </g>
            );
          })}
        </svg>
      </div>
    </figure>
  );
}
