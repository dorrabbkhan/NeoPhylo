// Pointer-drag lifecycle for the draw canvas (v1.4 plan Task 9, spec
// §5.2): a pointerdown on a node handle starts a drag; window-level
// listeners track it so the gesture survives the pointer leaving the
// svg (a drop off the drawing is the detach gesture). The hook owns
// the drag state and the drop→op resolution; what each op does is
// the engine's call.
//
// Drop resolution hit-tests the release point with
// elementFromPoint — touch and pen pointers implicitly capture to
// the pointerdown element, so `e.target` on pointerup is always the
// dragged node for them (review fix: every touch drag used to become
// a length pull). `e.target` is the fallback only where no layout
// hit-test exists (jsdom).

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  PointerEvent as ReactPointerEvent,
  RefObject,
} from "react";

import type { EditOp } from "../../editor/model";
import type { NodeId } from "../../engine/generated/NodeId";
import type { Tree } from "../../engine/generated/Tree";
import { LEAF_SPACING_NATURAL } from "../../layout/treePanel";

import { JOIN_EDGE, moveOp, round6, type Sel } from "./drawOps";
import { PAD, type NodePos } from "./drawLayout";

const CLICK_TOL = 6; // pointer travel in px that turns a click into a drag

export interface Drag {
  node: NodeId;
  /** Pointer start in client px (movement is measured on the screen). */
  sx: number;
  sy: number;
  moved: boolean;
  /** Current pointer position in svg px (the preview line's end). */
  x: number;
  y: number;
}

/** Everything the drop resolution reads from the component — the
 * window listeners reach it through a ref so they see the latest
 * render's state instead of re-binding on every pointer move. */
export interface DrawDragApi {
  tree: Tree;
  pos: Map<NodeId, NodePos>;
  apply: (op: EditOp) => void;
  toggleSel: (s: Sel) => void;
  /** Clear the inline error/hint when a new gesture starts. */
  clearMessages: () => void;
}

export function useDrawDrag(
  svgRef: RefObject<SVGSVGElement | null>,
  api: DrawDragApi,
): {
  drag: Drag | null;
  beginDrag: (id: NodeId, e: ReactPointerEvent) => void;
  cancelDrag: () => void;
} {
  const [drag, setDrag] = useState<Drag | null>(null);
  // The drag also lives in a ref: window-level listeners (attached
  // while a drag is live) read it so the gesture survives re-renders.
  // setDragSync is the single writer — never mix in a bare setDrag or
  // the listeners see a stale drag.
  const dragRef = useRef<Drag | null>(null);
  const apiRef = useRef(api);
  useEffect(() => {
    apiRef.current = api;
  });

  const setDragSync = useCallback((d: Drag | null): void => {
    dragRef.current = d;
    setDrag(d);
  }, []);

  /** svg px for a client point — the svg renders at natural size, so
   * the box offset alone converts. */
  const svgPoint = useCallback(
    (e: { clientX: number; clientY: number }) => {
      const r = svgRef.current?.getBoundingClientRect();
      return {
        x: e.clientX - (r?.left ?? 0),
        y: e.clientY - (r?.top ?? 0),
      };
    },
    [svgRef],
  );

  /** Length for the edge above `id` from a pointer x in svg px. The
   * engine refuses a negative/non-finite value with its own message —
   * nothing is clamped here. */
  const setLenAt = useCallback((id: NodeId, svgX: number): void => {
    const p = apiRef.current.pos.get(id);
    if (p === undefined) return;
    const scale =
      p.comp.laid.scale > 0 ? p.comp.laid.scale : p.comp.laid.width;
    const parentX = PAD + p.n.parentX;
    apiRef.current.apply({
      kind: "setLength",
      child: id,
      length: round6((svgX - parentX) / (scale > 0 ? scale : 1)),
    });
  }, []);

  const finishDrag = useCallback(
    (d: Drag, e: PointerEvent): void => {
      const { pos, tree, apply } = apiRef.current;
      const p = svgPoint(e);
      const hit =
        (typeof document.elementFromPoint === "function"
          ? document.elementFromPoint(e.clientX, e.clientY)
          : null) ?? (e.target instanceof Element ? e.target : null);
      const edgeId = Number(
        hit?.closest("[data-edge]")?.getAttribute("data-edge"),
      );
      if (Number.isInteger(edgeId) && edgeId >= 0) {
        if (edgeId === d.node) setLenAt(d.node, p.x);
        else apply(moveOp(tree, d.node, edgeId));
        return;
      }
      const nodeId = Number(
        hit?.closest("[data-node]")?.getAttribute("data-node"),
      );
      if (Number.isInteger(nodeId) && nodeId >= 0) {
        const orphan = (id: NodeId) => tree.nodes[id]?.parent === null;
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
          apply(moveOp(tree, d.node, nodeId));
        }
        return;
      }
      // Empty canvas: still on the node's row → a branch-end length
      // pull; anywhere else → a detach attempt (refusals show the
      // engine's message; an already-detached root needs no op at all).
      const src = pos.get(d.node);
      const sameRow =
        src !== undefined &&
        Math.abs(p.y - src.y) <= LEAF_SPACING_NATURAL / 2;
      if (sameRow) setLenAt(d.node, p.x);
      else if (tree.nodes[d.node]?.parent !== null)
        apply({ kind: "detach", node: d.node });
    },
    [setLenAt, svgPoint],
  );

  // While a drag is live, window-level listeners track it — the
  // gesture survives the pointer leaving the svg (a drop off the
  // drawing is the detach gesture).
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
        apiRef.current.toggleSel({ kind: "node", id: cur.node });
      } else {
        finishDrag(cur, e);
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
  }, [hasDrag, finishDrag, setDragSync, svgRef]);

  const beginDrag = useCallback(
    (id: NodeId, e: ReactPointerEvent): void => {
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
      apiRef.current.clearMessages();
    },
    [setDragSync, svgPoint],
  );

  const cancelDrag = useCallback(
    () => setDragSync(null),
    [setDragSync],
  );

  return { drag, beginDrag, cancelDrag };
}
