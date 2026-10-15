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

import type { Tree } from "../engine/generated/Tree";
import { layout, type LaidOutNode } from "../layout/phylogram";
import { nodeName } from "../state/names";

export interface TreeViewProps {
  tree: Tree;
  layoutKind: "phylogram" | "cladogram";
  highlight: Set<number>;
  wrong: Set<number>;
  clampNegative: boolean;
  visibleNodes?: Set<number>;
  onHoverLeaf?: (label: string | null) => void;
  title: "True tree" | "Inferred tree";
}

// Fixed drawing geometry; the svg scales to its container via viewBox.
const LAYOUT_WIDTH = 400;
const LEAF_SPACING = 24;
const PAD = 8;
const LABEL_OFFSET = 4;
const LABEL_SPACE = 140; // room for leaf labels to the right of the tree
const FONT_SIZE = 12;
const NODE_RADIUS = 3;
const WRONG_PAD = 6;

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
  onHoverLeaf,
  title,
}: TreeViewProps) {
  const laid = layout(tree, {
    kind: layoutKind,
    clampNegative,
    leafSpacing: LEAF_SPACING,
    width: LAYOUT_WIDTH,
    visibleNodes,
  });
  const byId = new Map(laid.nodes.map((n) => [n.id, n]));

  const width = laid.width + LABEL_SPACE + PAD * 2;
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

  return (
    <svg role="img" aria-label={title} viewBox={`0 0 ${width} ${height}`}>
      {laid.nodes.map((n) => {
        const children = tree.nodes[n.id].children.filter((c) => byId.has(c));
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
            {n.leaf ? (
              <text
                x={tx(n.x) + LABEL_OFFSET + NODE_RADIUS}
                y={ty(n.y)}
                fontSize={FONT_SIZE}
                dominantBaseline="middle"
                onMouseEnter={() => onHoverLeaf?.(n.label)}
                onMouseLeave={() => onHoverLeaf?.(null)}
              >
                {n.label}
              </text>
            ) : (
              isHighlighted && (
                <text
                  x={tx(n.x) + LABEL_OFFSET + NODE_RADIUS}
                  y={ty(n.y)}
                  fontSize={FONT_SIZE}
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
            <text x={x + 2} y={y + FONT_SIZE - 2} fontSize={FONT_SIZE}>
              ✕
            </text>
          </g>
        );
      })}
    </svg>
  );
}
