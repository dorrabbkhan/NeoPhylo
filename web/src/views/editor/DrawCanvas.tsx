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
//   ←/→ nudge the selected branch lengths by a fixed step; Delete
//   detaches the selection; Escape cancels a drag or clears the
//   selection.
//
// "Create a leaf" (the plan's `N`) is deferred: the engine has no
// create-leaf op and spec §5.1 requires node creation to be one — see
// docs/decisions.md. New taxa are added through the Newick view.
//
// Detached components draw below the main tree, each laid out with the
// same layout() call so they can be dragged back onto a branch.
//
// Split for the file-size rule: drawOps (gesture→op + names + refusal
// text), drawLayout (geometry), useDrawDrag (pointer lifecycle),
// DrawTree (svg content). This file keeps the state and the keyboard
// path.

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { KeyboardEvent } from "react";

import type { EditOp, EditorModel } from "../../editor/model";
import type { NeoError } from "../../engine/generated/NeoError";
import {
  labelRoomFor,
  leafFontSize,
  LEAF_SPACING_NATURAL,
  MIN_FONT_PX,
} from "../../layout/treePanel";

import {
  JOIN_EDGE,
  LENGTH_STEP,
  moveOp,
  refusalMessage,
  round6,
  type Sel,
} from "./drawOps";
import { layoutComps, PAD } from "./drawLayout";
import { DrawTree } from "./DrawTree";
import { useDrawDrag } from "./useDrawDrag";

export interface DrawCanvasProps {
  model: EditorModel;
}

const FALLBACK_PANEL_W = 560; // before the ResizeObserver fires / jsdom

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
  // The refused op is kept with its error so the message can say what
  // was tried in tree terms, not arena ids (refusalMessage).
  const [refusal, setRefusal] = useState<{
    op: EditOp;
    error: NeoError;
  } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [boxRef, panelW] = usePanelWidth();

  const apply = (op: EditOp): void => {
    const r = model.apply(op);
    if (!r.ok) {
      setRefusal({ op, error: r.error });
      setHint(null);
    } else {
      setRefusal(null);
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
  const { comps, pos, svgH } = layoutComps(tree, drawWidth);
  const svgW = drawWidth + labelRoom + PAD * 2;

  const { drag, beginDrag, cancelDrag } = useDrawDrag(svgRef, {
    tree,
    pos,
    apply,
    toggleSel,
    clearMessages: () => {
      setRefusal(null);
      setHint(null);
    },
  });

  // On every accepted edit (tree object swap), drop selection entries
  // that no longer point at a drawn node or a real edge, and clear the
  // inline messages — the views moved on.
  const [seenTree, setSeenTree] = useState(tree);
  if (seenTree !== tree) {
    setSeenTree(tree);
    cancelDrag();
    setRefusal(null);
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
          cancelDrag();
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

  const err =
    refusal === null
      ? null
      : refusalMessage(tree, refusal.op, refusal.error);

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
          <DrawTree
            tree={tree}
            comps={comps}
            pos={pos}
            fontSize={fontSize}
            smallFont={smallFont}
            selected={selected}
            drag={drag}
            beginDrag={beginDrag}
            selectEdge={(id) => toggleSel({ kind: "edge", id })}
          />
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
        selected branch; Delete detaches the selected nodes; ← and →
        nudge the selected branches. Add taxa in the Newick view.
      </p>
    </div>
  );
}
