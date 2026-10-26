// Drag-to-draw canvas — the exercise editor's third view (v1.4 plan
// Task 9, spec §5.1, §5.2). The drawing comes from the same pure
// layout() functions as the lesson TreeView — TypeScript computes
// coordinates only; every structural change is an EditOp the shared
// EditorModel runs through the engine, so a refusal leaves the tree
// untouched and its message shows inline.
//
// Gestures and their keyboard equivalents (spec §5.2):
// - Drag a node onto a branch (or another node) → `move` (drawOps.moveOp
//   supplies the default split/lengths both paths share).
// - Drag a node along its own branch (same row, off other branches)
//   or onto its own edge/marker → `setLength` from the drop position.
// - Drag a node onto empty canvas → `detach` (the engine refuses when
//   the result would be unary or root-less and says why).
// - Click a node or branch to select it (two slots, oldest evicted);
//   J joins two component roots or moves the node onto the branch;
//   ←/→ nudge the selected branch length by a fixed step; Delete
//   detaches the selection; Escape cancels a drag or clears the
//   selection.
//
// "Create a leaf" (the plan's `N`) is deferred: the engine has no
// create-leaf op and spec §5.1 requires node creation to be one — see
// docs/decisions.md. New taxa are added through the Newick view.
//
// Detached components draw below the main tree, each laid out with the
// same layout() call so they can be dragged back onto a branch.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { KeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

import type { EditOp, EditorModel } from "../../editor/model";
import type { NodeId } from "../../engine/generated/NodeId";
import type { NeoError } from "../../engine/generated/NeoError";
import { errorMessage } from "../../explain/errors";
import { layout, type LaidOutNode, type Layout } from "../../layout/phylogram";
import {
  labelRoomFor,
  leafFontSize,
  LEAF_SPACING_NATURAL,
  MIN_FONT_PX,
} from "../../layout/treePanel";

import {
  cladeName,
  detachedRoots,
  hitPad,
  HIT_MIN,
  JOIN_EDGE,
  LENGTH_STEP,
  moveOp,
  nodeAria,
  round6,
} from "./drawOps";

export interface DrawCanvasProps {
  model: EditorModel;
}

const PAD = 8; // margin inside the svg, px
const COMP_GAP = 24; // gap above each detached component
const CAPTION_H = 16; // room for a detached component's caption
const NODE_R = 3; // node marker radius (px, matches the tree panels)
const LABEL_OFF = 4; // gap between marker and leaf label
const CLICK_TOL = 6; // pointer travel in px that turns a click into a drag
const NODE_HIT_R = 10; // always-on invisible node hit radius, px
const FALLBACK_PANEL_W = 560; // before the ResizeObserver fires / jsdom

/** One selection slot: a node, or the incoming edge of a node. */
interface Sel {
  kind: "node" | "edge";
  id: NodeId;
}

interface Drag {
  node: NodeId;
  /** Pointer start in client px (movement is measured on the screen). */
  sx: number;
  sy: number;
  moved: boolean;
  /** Current pointer position in svg px (the preview line's end). */
  x: number;
  y: number;
}

interface CompView {
  root: NodeId;
  laid: Layout;
  /** Top of this component's rows inside the svg. */
  y0: number;
  /** Caption for a detached component, null for the main tree. */
  caption: string | null;
}

interface NodePos {
  n: LaidOutNode;
  /** The node's marker position in svg px. */
  x: number;
  y: number;
  comp: CompView;
}

/** Measures the drawing box via ResizeObserver; 0 until it fires. */
function usePanelWidth(): [React.RefObject<HTMLDivElement | null>, number] {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (el === null || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      setWidth(entries[0].contentRect.width);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

export function DrawCanvas({ model }: DrawCanvasProps) {
  const subscribe = useCallback(
    (fn: () => void) => model.subscribe(fn),
    [model],
  );
  const tree = useSyncExternalStore(subscribe, () => model.tree);

  const [selected, setSelected] = useState<Sel[]>([]);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [error, setError] = useState<NeoError | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [boxRef, panelW] = usePanelWidth();

  // The drag also lives in a ref: window-level listeners (attached while
  // a drag is live) read it so the gesture survives re-renders and the
  // svg's bounds. setDragSync is the single writer — never mix in a bare
  // setDrag or the listeners see a stale drag.
  const dragRef = useRef<Drag | null>(null);
  const setDragSync = (d: Drag | null): void => {
    dragRef.current = d;
    setDrag(d);
  };

  // On every accepted edit (tree object swap), drop selection entries
  // that no longer point at a drawn node or a real edge, and clear the
  // inline messages — the views moved on. State-only here: dragRef is
  // re-synced by the drag-listeners effect when `hasDrag` flips off.
  const [seenTree, setSeenTree] = useState(tree);
  if (seenTree !== tree) {
    setSeenTree(tree);
    setDrag(null);
    setError(null);
    setHint(null);
    setSelected((sel) =>
      sel.filter((s) => {
        const n = tree.nodes[s.id];
        if (n === undefined) return false;
        if (n.children.length === 0 && n.label === null) return false; // husk
        return s.kind !== "edge" || n.parent !== null;
      }),
    );
  }

  const fontSize = Math.max(MIN_FONT_PX, leafFontSize(LEAF_SPACING_NATURAL));
  const smallFont = Math.max(MIN_FONT_PX, fontSize - 3);
  const labelRoom = labelRoomFor(
    tree.nodes.map((n) => n.label),
    fontSize,
  );
  const panel = panelW > 0 ? panelW : FALLBACK_PANEL_W;
  const drawWidth = Math.max(80, panel - labelRoom - PAD * 2);

  // One layout() call per drawn component — detached subtrees stack
  // below the main tree with a caption, same coordinates pipeline.
  const comps: CompView[] = [];
  const pos = new Map<NodeId, NodePos>();
  let cursor = PAD;
  for (const root of [tree.root, ...detachedRoots(tree)]) {
    const detached = root !== tree.root;
    const laid = layout(
      { ...tree, root },
      {
        kind: "phylogram",
        clampNegative: true,
        leafSpacing: LEAF_SPACING_NATURAL,
        width: drawWidth,
      },
    );
    if (detached) cursor += COMP_GAP;
    const caption = detached ? `Detached: ${cladeName(tree, root)}` : null;
    const y0 = detached ? cursor + CAPTION_H : cursor;
    const comp: CompView = { root, laid, y0, caption };
    for (const n of laid.nodes) {
      pos.set(n.id, { n, x: PAD + n.x, y: y0 + n.y, comp });
    }
    comps.push(comp);
    cursor = y0 + laid.height;
  }
  const svgH = cursor + PAD;
  const svgW = drawWidth + labelRoom + PAD * 2;

  const isSelected = (kind: Sel["kind"], id: NodeId) =>
    selected.some((s) => s.kind === kind && s.id === id);

  const parentless = (id: NodeId): boolean =>
    tree.nodes[id] !== undefined && tree.nodes[id].parent === null;

  const apply = (op: EditOp): void => {
    const r = model.apply(op);
    if (!r.ok) {
      setError(r.error);
      setHint(null);
    } else {
      setError(null);
      setHint(null);
    }
  };

  const toggleSel = (s: Sel): void => {
    setSelected((cur) => {
      const i = cur.findIndex((x) => x.kind === s.kind && x.id === s.id);
      if (i >= 0) return cur.filter((_, k) => k !== i);
      return [...cur, s].slice(-2);
    });
    setHint(null);
  };

  /** svg px for a client point — the svg renders at natural size, so
   * the box offset alone converts. */
  const svgPoint = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current?.getBoundingClientRect();
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) };
  };

  /** Length for the edge above `id` from a pointer x in svg px. The
   * engine refuses a negative/non-finite value with its own message —
   * nothing is clamped here. */
  const setLenAt = (id: NodeId, svgX: number): void => {
    const p = pos.get(id);
    if (p === undefined) return;
    const scale =
      p.comp.laid.scale > 0 ? p.comp.laid.scale : p.comp.laid.width;
    const parentX = PAD + p.n.parentX;
    apply({
      kind: "setLength",
      child: id,
      length: round6((svgX - parentX) / (scale > 0 ? scale : 1)),
    });
  };

  const onNodePointerDown = (id: NodeId, e: ReactPointerEvent): void => {
    if (e.button !== 0) return;
    const p = svgPoint(e);
    setDragSync({
      node: id,
      sx: e.clientX,
      sy: e.clientY,
      moved: false,
      x: p.x,
      y: p.y,
    });
    setError(null);
    setHint(null);
  };

  const finishDrag = (d: Drag, e: globalThis.PointerEvent): void => {
    const p = svgPoint(e);
    const t = e.target instanceof Element ? e.target : null;
    const edgeId = Number(
      t?.closest("[data-edge]")?.getAttribute("data-edge"),
    );
    if (Number.isInteger(edgeId) && edgeId >= 0) {
      if (edgeId === d.node) setLenAt(d.node, p.x);
      else apply(moveOp(model.tree, d.node, edgeId));
      return;
    }
    const nodeId = Number(
      t?.closest("[data-node]")?.getAttribute("data-node"),
    );
    if (Number.isInteger(nodeId) && nodeId >= 0) {
      const orphan = (id: NodeId) => model.tree.nodes[id]?.parent === null;
      if (nodeId === d.node) {
        setLenAt(d.node, p.x);
      } else if (orphan(d.node) && orphan(nodeId)) {
        apply({
          kind: "join",
          a: d.node,
          b: nodeId,
          lengths: [JOIN_EDGE, JOIN_EDGE],
        });
      } else {
        apply(moveOp(model.tree, d.node, nodeId));
      }
      return;
    }
    // Empty canvas: still on the node's row → a branch-end length pull;
    // anywhere else → a detach attempt (refusals show the engine's
    // message; an already-detached root needs no op at all).
    const src = pos.get(d.node);
    const sameRow =
      src !== undefined &&
      Math.abs(p.y - src.y) <= LEAF_SPACING_NATURAL / 2;
    if (sameRow) setLenAt(d.node, p.x);
    else if (!parentless(d.node)) apply({ kind: "detach", node: d.node });
  };

  // While a drag is live, window-level listeners track it — the gesture
  // survives the pointer leaving the svg (a drop off the drawing is the
  // detach gesture). No pointer capture: `e.target` on pointerup stays
  // the element under the pointer, which resolves the drop. The latest
  // drop handler is reached through a ref so the listeners attach once
  // per gesture instead of re-binding on every move.
  const handlers = useRef({ finishDrag, toggleSel });
  useEffect(() => {
    handlers.current = { finishDrag, toggleSel };
  });
  const hasDrag = drag !== null;
  useEffect(() => {
    if (!hasDrag) {
      dragRef.current = null;
      return;
    }
    const move = (e: PointerEvent): void => {
      const cur = dragRef.current;
      if (cur === null) return;
      const r = svgRef.current?.getBoundingClientRect();
      setDragSync({
        ...cur,
        moved:
          cur.moved ||
          Math.hypot(e.clientX - cur.sx, e.clientY - cur.sy) > CLICK_TOL,
        x: e.clientX - (r?.left ?? 0),
        y: e.clientY - (r?.top ?? 0),
      });
    };
    const up = (e: PointerEvent): void => {
      const cur = dragRef.current;
      if (cur === null) return;
      setDragSync(null);
      if (!cur.moved) {
        handlers.current.toggleSel({ kind: "node", id: cur.node });
      } else {
        handlers.current.finishDrag(cur, e);
      }
    };
    const cancel = (e: Event): void => {
      if (e instanceof KeyboardEvent && e.key !== "Escape") return;
      setDragSync(null);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", cancel);
    window.addEventListener("keydown", cancel);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", cancel);
      window.removeEventListener("keydown", cancel);
    };
  }, [hasDrag]);

  const joinSelection = (): void => {
    const nodes = selected
      .filter((s) => s.kind === "node")
      .map((s) => s.id);
    const edges = selected
      .filter((s) => s.kind === "edge")
      .map((s) => s.id);
    if (nodes.length === 2 && edges.length === 0) {
      apply({
        kind: "join",
        a: nodes[0],
        b: nodes[1],
        lengths: [JOIN_EDGE, JOIN_EDGE],
      });
    } else if (nodes.length === 1 && edges.length === 1) {
      apply(moveOp(model.tree, nodes[0], edges[0]));
    } else {
      setHint(
        "Select two nodes, or a node and a branch, then press J to join them.",
      );
    }
  };

  const onKeyDown = (e: KeyboardEvent<SVGSVGElement>): void => {
    const t = e.target instanceof Element ? e.target : null;
    const nodeAttr = t?.closest("[data-node]")?.getAttribute("data-node");
    const edgeAttr = t?.closest("[data-edge]")?.getAttribute("data-edge");
    const nodeId =
      nodeAttr === null || nodeAttr === undefined ? null : Number(nodeAttr);
    const edgeId =
      edgeAttr === null || edgeAttr === undefined ? null : Number(edgeAttr);
    switch (e.key) {
      case "Enter":
      case " ":
        if (nodeId !== null) {
          e.preventDefault();
          toggleSel({ kind: "node", id: nodeId });
        } else if (edgeId !== null) {
          e.preventDefault();
          toggleSel({ kind: "edge", id: edgeId });
        }
        return;
      case "Escape":
        if (drag !== null) {
          setDragSync(null);
        } else {
          setSelected([]);
          setHint(null);
        }
        return;
      case "j":
      case "J":
        e.preventDefault();
        joinSelection();
        return;
      case "Delete":
      case "Backspace":
        e.preventDefault();
        if (selected.length === 0) {
          setHint("Select a node first, then press Delete to detach it.");
          return;
        }
        for (const s of selected) {
          apply({ kind: "detach", node: s.id });
        }
        return;
      case "ArrowLeft":
      case "ArrowRight": {
        e.preventDefault();
        if (selected.length === 0) {
          setHint(
            "Select a node or branch first, then use ← and → to change its length.",
          );
          return;
        }
        const d = e.key === "ArrowRight" ? LENGTH_STEP : -LENGTH_STEP;
        for (const s of selected) {
          const cur = model.tree.branches[s.id]?.length ?? 0;
          apply({ kind: "setLength", child: s.id, length: round6(cur + d) });
        }
        return;
      }
      default:
        return;
    }
  };

  const err = error === null ? null : errorMessage(error);
  const dragFrom = drag === null ? undefined : pos.get(drag.node);

  return (
    <div className="editor-view draw-view">
      <span className="editor-view-label" id="draw-canvas-label">
        Tree canvas
      </span>
      <div className="draw-canvas-box" ref={boxRef}>
        <svg
          className="draw-canvas"
          ref={svgRef}
          role="application"
          aria-label="Tree canvas"
          aria-describedby="draw-canvas-hint"
          viewBox={`0 0 ${svgW} ${svgH}`}
          width={svgW}
          height={svgH}
          tabIndex={0}
          onKeyDown={onKeyDown}
          onClick={(e) => {
            if (e.target === svgRef.current) setSelected([]);
          }}
        >
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
                        onClick={() =>
                          toggleSel({ kind: "edge", id: n.id })
                        }
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
                      onPointerDown={(e) => onNodePointerDown(n.id, e)}
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
                        className="node-dot"
                        cx={p.x}
                        cy={p.y}
                        r={nodeSel ? NODE_R + 1 : NODE_R}
                        fill="currentColor"
                      />
                      {n.leaf && n.label !== null && (
                        <text
                          className="leaf-name"
                          x={p.x + NODE_R + LABEL_OFF}
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
        </svg>
      </div>
      {err !== null && (
        <p role="alert" className="editor-error">
          <strong>{err.title}:</strong> {err.body}
        </p>
      )}
      <p role="status" className="editor-hint">
        {hint ?? ""}
      </p>
      <p className="editor-hint" id="draw-canvas-hint">
        Drag a node onto a branch to move it, off the tree to detach it,
        or along its own branch to change its length. Select with a
        click or Enter; J joins two nodes or moves a node onto the
        selected branch; Delete detaches; ← and → nudge the selected
        branch. Add taxa in the Newick view.
      </p>
    </div>
  );
}
