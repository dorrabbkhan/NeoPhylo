// The draw canvas's svg content (v1.4 plan Task 9, spec §5.2, §5.5):
// per component, each node's incoming edge and node handle, the
// detached captions, and the in-flight drag preview. Pure rendering —
// the gesture lifecycle lives in useDrawDrag, the drop→op translation
// in drawOps, and the geometry in drawLayout.
//
// Every handle carries a `.focus-ring` element that is invisible until
// the handle is `:focus-visible`: a ring around the node dot, a
// rounded box around the branch segment — a clearly visible keyboard
// focus indicator that stays distinct from the purple "selected"
// state.

import type { PointerEvent as ReactPointerEvent } from "react";

import type { NodeId } from "../../engine/generated/NodeId";
import type { Tree } from "../../engine/generated/Tree";

import {
  cladeName,
  hitPad,
  HIT_MIN,
  nodeAria,
  type Sel,
} from "./drawOps";
import {
  CAPTION_H,
  EDGE_FOCUS_MIN,
  EDGE_FOCUS_PAD,
  FOCUS_RING_R,
  LABEL_DX,
  NODE_R,
  NODE_SEL_R,
  PAD,
  type CompView,
  type NodePos,
} from "./drawLayout";
import type { Drag } from "./useDrawDrag";

const NODE_HIT_R = 10; // always-on invisible node hit radius, px

interface DrawTreeProps {
  tree: Tree;
  comps: CompView[];
  pos: Map<NodeId, NodePos>;
  fontSize: number;
  smallFont: number;
  selected: Sel[];
  drag: Drag | null;
  beginDrag: (id: NodeId, e: ReactPointerEvent) => void;
  selectEdge: (id: NodeId) => void;
}

export function DrawTree({
  tree,
  comps,
  pos,
  fontSize,
  smallFont,
  selected,
  drag,
  beginDrag,
  selectEdge,
}: DrawTreeProps) {
  const isSelected = (kind: Sel["kind"], id: NodeId) =>
    selected.some((s) => s.kind === kind && s.id === id);
  const dragFrom = drag === null ? undefined : pos.get(drag.node);

  return (
    <>
      {comps.map((comp) => (
        <g key={comp.root}>
          {comp.caption !== null && (
            <text
              className="detached-cap"
              x={PAD}
              y={comp.y0 - CAPTION_H + smallFont}
              fontSize={smallFont}
            >
              {comp.caption}
            </text>
          )}
          {comp.laid.nodes.map((n) => {
            const p = pos.get(n.id);
            if (p === undefined) return null;
            const parent = tree.nodes[n.id].parent;
            const kids = tree.nodes[n.id].children.filter((c) =>
              pos.has(c),
            );
            const edgeSel = isSelected("edge", n.id);
            const nodeSel = isSelected("node", n.id);
            const x1 = PAD + n.parentX;
            const pad = hitPad(x1, p.y, p.x, p.y);
            const edgeW = Math.abs(p.x - x1);
            const ringW = Math.max(edgeW, EDGE_FOCUS_MIN);
            const ringX = Math.min(x1, p.x) - (ringW - edgeW) / 2;
            return (
              <g key={n.id}>
                {parent !== null && (
                  <g
                    className="edge-hit"
                    role="button"
                    tabIndex={0}
                    data-edge={n.id}
                    aria-label={`Branch to ${cladeName(tree, n.id)}`}
                    aria-pressed={edgeSel}
                    data-selected={edgeSel || undefined}
                    onClick={() => selectEdge(n.id)}
                  >
                    <rect
                      className="edge-hit-pad"
                      x={pad.x}
                      y={pad.y}
                      width={pad.width}
                      height={pad.height}
                    />
                    <line
                      className="edge-line"
                      x1={x1}
                      y1={p.y}
                      x2={p.x}
                      y2={p.y}
                      stroke="currentColor"
                      strokeWidth={1.5}
                    />
                    <line
                      className="edge-target"
                      x1={x1}
                      y1={p.y}
                      x2={p.x}
                      y2={p.y}
                    />
                    <rect
                      className="focus-ring"
                      x={ringX}
                      y={p.y - EDGE_FOCUS_PAD}
                      width={ringW}
                      height={EDGE_FOCUS_PAD * 2}
                      rx={EDGE_FOCUS_PAD}
                    />
                  </g>
                )}
                {kids.length > 0 && (
                  <line
                    className="connector"
                    x1={p.x}
                    y1={pos.get(kids[0])!.y}
                    x2={p.x}
                    y2={pos.get(kids[kids.length - 1])!.y}
                    stroke="currentColor"
                    strokeWidth={1.5}
                  />
                )}
                <g
                  className="node-hit"
                  role="button"
                  tabIndex={0}
                  data-node={n.id}
                  aria-label={nodeAria(tree, n.id)}
                  aria-pressed={nodeSel}
                  data-selected={nodeSel || undefined}
                  onPointerDown={(e) => beginDrag(n.id, e)}
                >
                  <circle
                    className="node-hit-pad"
                    cx={p.x}
                    cy={p.y}
                    r={HIT_MIN / 2}
                  />
                  <circle
                    className="node-target"
                    cx={p.x}
                    cy={p.y}
                    r={NODE_HIT_R}
                  />
                  <circle
                    className="focus-ring"
                    cx={p.x}
                    cy={p.y}
                    r={FOCUS_RING_R}
                  />
                  <circle
                    className="node-dot"
                    cx={p.x}
                    cy={p.y}
                    r={nodeSel ? NODE_SEL_R : NODE_R}
                    fill="currentColor"
                  />
                  {n.leaf && n.label !== null && (
                    <text
                      className="leaf-name"
                      x={p.x + LABEL_DX}
                      y={p.y}
                      fontSize={fontSize}
                      dominantBaseline="middle"
                      fill="currentColor"
                    >
                      {n.label}
                    </text>
                  )}
                </g>
              </g>
            );
          })}
        </g>
      ))}
      {drag !== null && drag.moved && dragFrom !== undefined && (
        <g className="drag-preview">
          <line
            className="drag-line"
            x1={dragFrom.x}
            y1={dragFrom.y}
            x2={drag.x}
            y2={drag.y}
          />
          <circle
            className="drag-dot"
            cx={drag.x}
            cy={drag.y}
            r={NODE_R + 2}
          />
        </g>
      )}
    </>
  );
}
