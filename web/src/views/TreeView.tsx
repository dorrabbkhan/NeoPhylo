// SVG rendering of a laid-out tree (spec §6.1-6.3, plan Task 15). All
// positioning comes from `treeFigure()` in src/layout — the same pure
// function the SVG/PNG exports serialize, so an exported figure is
// exactly this drawing (v1.2 checkpoint 15). This file only draws.
//
// Styling conventions (spec §6.3, §6.5 — meaning never relies on color alone):
// - Negative branch lengths are dashed and carry the class "negative".
// - Highlighted nodes get data-highlight="true", a thicker stroke and a
//   visible label (their display name via state/names.ts: leaf labels and
//   u1, u2, … for internal nodes) — except while support labels are drawn,
//   when the u-names hide so they can never overlap a support pill
//   (checkpoint 11).
// - Wrong clades get a dotted outline around the clade plus a "✕" marker.
// - Leaf labels are SVG <text> children, so React escapes them and markup in
//   a taxon name can never be parsed as HTML (Review Focus 2).
// - Every node group and support label carries data-split — the canonical
//   grouping key of the edge above the node (src/layout/splitKeys.ts) —
//   so figures match the run's tally (checkpoint 15).

import { useEffect, useRef, useState } from "react";

import type { Tree } from "../engine/generated/Tree";
import type { LaidOutNode } from "../layout/phylogram";
import { splitKeys, treeTaxaOrder } from "../layout/splitKeys";
import {
  FIGURE_LABEL_OFFSET,
  FIGURE_NODE_RADIUS,
  FIGURE_PANEL_PAD,
  FIGURE_WRONG_PAD,
  treeFigure,
} from "../layout/treeFigure";
import { leafSpacingFor } from "../layout/treePanel";
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
  /** Taxon labels in alignment order, for the data-split grouping keys
   * (canonical unrooted sides exclude taxa[0]); defaults to the tree's
   * arena leaf order, which is the input order for engine trees. */
  splitTaxa?: string[];
  /** data-split convention: rooted clusters (UPGMA tallies, reference
   * trees) or unrooted splits (NJ tallies — also on a rerooted NJ
   * drawing, whose groupings are unchanged). Default unrooted. */
  splitRooted?: boolean;
  /** Reports the measured drawing-panel width (px); App feeds it to the
   * figure exports so they share this tree's exact geometry. */
  onPanelSize?: (width: number) => void;
  onHoverLeaf?: (label: string | null) => void;
  /** Called with the leaf's label on click — predict_pair prompts use
   * two leaf picks as an answer (Task 21); unset otherwise. */
  onPickLeaf?: (label: string) => void;
  /** Called with the edge's canonical split key when an internal
   * branch is clicked — predict_branch prompts (v1.2 spec §7.1). A
   * wide invisible hit line is drawn over each internal edge while
   * this is set. */
  onPickBranch?: (splitKey: string) => void;
  /** Called (no argument) when a terminal edge is clicked —
   * predict_branch prompts use it to explain that a leaf's branch
   * can't be the answer (v1.2 spec §7.1). Draws a hit line over each
   * terminal edge while set. */
  onPickTerminal?: () => void;
  /** Panel caption and the svg's accessible name. "True tree" /
   * "Inferred tree", or the classification variant (v1.1 spec §5.3). */
  title: string;
}

interface Size {
  width: number;
  height: number;
}

/** The focusable internal-branch hit lines in the same drawing —
 * arrow keys rove among them while a predict_branch prompt is open
 * (v1.2 spec §7.1). */
function branchHits(el: SVGLineElement): SVGLineElement[] {
  return Array.from(
    el.ownerSVGElement?.querySelectorAll<SVGLineElement>(
      '.branch-hit[role="button"]',
    ) ?? [],
  );
}

/** The pickable overlay on an internal edge while a predict_branch
 * prompt is open: a wide invisible line that is also a real button —
 * Tab/arrows reach it, a dashed outline shows focus, Enter/Space
 * picks. Its accessible name is the grouping on the edge's far side
 * ("Branch to (E, F, G, H)"). */
function BranchHit({
  x1,
  y1,
  x2,
  y2,
  splitKey,
  onPick,
}: {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** The edge's canonical split key, e.g. "E|F|G|H". */
  splitKey: string;
  onPick: (key: string) => void;
}) {
  return (
    <line
      className="branch-hit"
      x1={x1}
      y1={y1}
      x2={x2}
      y2={y2}
      role="button"
      tabIndex={0}
      aria-label={`Branch to (${splitKey.split("|").join(", ")})`}
      onClick={() => onPick(splitKey)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onPick(splitKey);
          return;
        }
        const dir =
          e.key === "ArrowRight" || e.key === "ArrowDown"
            ? 1
            : e.key === "ArrowLeft" || e.key === "ArrowUp"
              ? -1
              : 0;
        if (dir === 0) return;
        e.preventDefault();
        const hits = branchHits(e.currentTarget);
        const i = hits.indexOf(e.currentTarget);
        hits[(i + dir + hits.length) % hits.length]?.focus();
      }}
    />
  );
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

export function TreeView({
  tree,
  layoutKind,
  highlight,
  wrong,
  clampNegative,
  visibleNodes,
  leafSpacing,
  splitTaxa,
  splitRooted = false,
  onPanelSize,
  onHoverLeaf,
  onPickLeaf,
  onPickBranch,
  onPickTerminal,
  title,
}: TreeViewProps) {
  const [boxRef, box] = usePanelSize();
  useEffect(() => {
    onPanelSize?.(box.width);
  }, [box.width, onPanelSize]);

  const leaves = tree.nodes.reduce(
    (n, node) => n + (node.children.length === 0 ? 1 : 0),
    0,
  );
  const spacing = leafSpacing ?? leafSpacingFor(box.height, leaves);

  // Layout, support-label placement and content bounds — shared with
  // the SVG/PNG export path (src/layout/treeFigure.ts).
  const fig = treeFigure(tree, {
    kind: layoutKind,
    clampNegative,
    leafSpacing: spacing,
    panelWidth: box.width,
    visibleNodes,
    highlight,
    wrong,
  });
  const { laid, byId, labelById, fontSize, smallFont, bounds } = fig;
  const hideInternalNames = fig.hideInternalNames;

  // data-split keys: the canonical grouping of the edge above each
  // node — the same key the tally serializes (src/layout/splitKeys.ts).
  const keys = splitKeys(tree, splitTaxa ?? treeTaxaOrder(tree), splitRooted);

  // The viewBox fits the CONTENT plus pad (checkpoint 12): nothing
  // clips at any tree size or view — and no empty margin remains where
  // a fixed label-room reservation used to sit (checkpoint 15).
  const width = bounds.maxX - bounds.minX + FIGURE_PANEL_PAD * 2;
  const height = bounds.maxY - bounds.minY + FIGURE_PANEL_PAD * 2;
  const tx = (x: number) => x - bounds.minX + FIGURE_PANEL_PAD;
  const ty = (y: number) => y - bounds.minY + FIGURE_PANEL_PAD;

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
            // Bootstrap support (v1.2 spec §6.3): the edge above a node
            // carries a 0-1 fraction, drawn as Math.round(100·s) in a
            // pill left of the node. Weak (<50%) gets a thinner stroke
            // plus a marker glyph — never color alone (§6.5).
            const support = hasVisibleParent
              ? tree.branches[n.id].support
              : null;
            const weak = support !== null && support < 0.5;
            const edgeWidth = weak ? Math.min(1, strokeWidth) : strokeWidth;
            const placedLabel = labelById.get(n.id);
            return (
              <g
                key={n.id}
                data-node={n.id}
                data-split={keys.get(n.id)}
                data-highlight={isHighlighted ? "true" : undefined}
                data-weak={weak || undefined}
              >
                {hasVisibleParent && (
                  <line
                    className={branchClass(n)}
                    x1={tx(n.parentX)}
                    y1={ty(n.y)}
                    x2={tx(n.x)}
                    y2={ty(n.y)}
                    stroke="currentColor"
                    strokeWidth={edgeWidth}
                    strokeDasharray={n.negative ? "4 3" : undefined}
                  />
                )}
                {hasVisibleParent && !n.leaf && onPickBranch !== undefined && (
                  <BranchHit
                    x1={tx(n.parentX)}
                    y1={ty(n.y)}
                    x2={tx(n.x)}
                    y2={ty(n.y)}
                    splitKey={keys.get(n.id) ?? ""}
                    onPick={onPickBranch}
                  />
                )}
                {hasVisibleParent && n.leaf && onPickTerminal !== undefined && (
                  <line
                    className="branch-hit"
                    x1={tx(n.parentX)}
                    y1={ty(n.y)}
                    x2={tx(n.x)}
                    y2={ty(n.y)}
                    onClick={() => onPickTerminal()}
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
                  r={
                    isHighlighted ? FIGURE_NODE_RADIUS + 1 : FIGURE_NODE_RADIUS
                  }
                  fill="currentColor"
                />
                {hasVisibleParent && tree.branches[n.id].length === 0 && (
                  <text
                    className="zero-len"
                    x={(tx(n.parentX) + tx(n.x)) / 2}
                    y={ty(n.y) - 4}
                    fontSize={smallFont}
                    textAnchor="middle"
                  >
                    0
                  </text>
                )}
                {placedLabel !== undefined && (
                  <g className="support">
                    {placedLabel.leader !== undefined && (
                      <line
                        className="support-leader"
                        x1={tx(placedLabel.leader.x1)}
                        y1={ty(placedLabel.leader.y1)}
                        x2={tx(placedLabel.leader.x2)}
                        y2={ty(placedLabel.leader.y2)}
                        stroke="currentColor"
                        strokeWidth={1}
                        strokeDasharray="3 2"
                      />
                    )}
                    <rect
                      className="support-pill"
                      x={tx(placedLabel.box.minX)}
                      y={ty(placedLabel.box.minY)}
                      width={placedLabel.box.maxX - placedLabel.box.minX}
                      height={placedLabel.box.maxY - placedLabel.box.minY}
                      rx={(placedLabel.box.maxY - placedLabel.box.minY) / 2}
                    />
                    <text
                      className="support-label"
                      data-split={keys.get(n.id)}
                      x={tx(placedLabel.textX)}
                      y={ty(placedLabel.textY)}
                      fontSize={smallFont}
                      textAnchor="middle"
                      dominantBaseline="middle"
                      fill="currentColor"
                    >
                      {placedLabel.text}
                    </text>
                  </g>
                )}
                {n.leaf ? (
                  <text
                    x={tx(n.x) + FIGURE_LABEL_OFFSET + FIGURE_NODE_RADIUS}
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
                  isHighlighted &&
                  !hideInternalNames && (
                    <text
                      x={tx(n.x) + FIGURE_LABEL_OFFSET + FIGURE_NODE_RADIUS}
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
            const box = fig.cladeBox(id);
            if (!box) return null;
            const x = tx(box.minX) - FIGURE_WRONG_PAD;
            const y = ty(box.minY) - FIGURE_WRONG_PAD;
            const w = box.maxX - box.minX + FIGURE_WRONG_PAD * 2;
            const h = box.maxY - box.minY + FIGURE_WRONG_PAD * 2;
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
