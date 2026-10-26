// Pure helpers for the drag-to-draw canvas (v1.4 plan Task 9, spec
// §5.1, §5.2): pointer gestures become EditOps here, kept out of the
// component so the translation is unit-testable and the view stays a
// view. No tree logic lives in TypeScript — these functions only pick
// WHICH engine op a gesture means and compute its suggested lengths;
// the engine validates everything.

import type { EditOp } from "../../editor/model";
import type { NodeId } from "../../engine/generated/NodeId";
import type { Tree } from "../../engine/generated/Tree";
import { nodeName } from "../../state/names";

/** Arrow-key nudge step in branch-length units. */
export const LENGTH_STEP = 0.01;
/** Edge length each subtree gets on a bare `join` (keyboard J on two
 * component roots, or dropping one component root onto another). */
export const JOIN_EDGE = 0.1;
/** ≥40 px hit pads under (pointer: coarse) — a hair over, like
 * TreeView's hitPad, so fractional viewBox scaling never reports
 * 39.99 px. */
export const HIT_MIN = 40.05;

/** Round a suggested length so fp dust never reaches the Newick text
 * (0.2 + 0.01 would otherwise print as 0.21000000000000002). */
export const round6 = (v: number): number => Math.round(v * 1e6) / 1e6;

/** Parentless, drawn component roots: every arena node with no parent
 * except the main root and the inert husks a spliced-out node leaves
 * behind (childless AND unlabeled). */
export function detachedRoots(tree: Tree): NodeId[] {
  const roots: NodeId[] = [];
  for (let i = 0; i < tree.nodes.length; i += 1) {
    const n = tree.nodes[i];
    if (i === tree.root || n.parent !== null) continue;
    if (n.children.length === 0 && n.label === null) continue;
    roots.push(i);
  }
  return roots;
}

/** Leaf labels under `id` in tree order — display names only. */
export function leafNames(tree: Tree, id: NodeId, out: string[]): void {
  const n = tree.nodes[id];
  if (n === undefined) return;
  if (n.children.length === 0) {
    if (n.label !== null && n.label !== "") out.push(n.label);
    return;
  }
  for (const c of n.children) leafNames(tree, c, out);
}

/** "(A, B)" for an internal node, the label itself for a leaf. */
export function cladeName(tree: Tree, id: NodeId): string {
  const n = tree.nodes[id];
  if (n === undefined) return `#${id}`;
  if (n.children.length === 0) return n.label ?? `#${id}`;
  const names: string[] = [];
  leafNames(tree, id, names);
  return `(${names.join(", ")})`;
}

/** Accessible name for a node handle: "Leaf A" or "Node u2 (A, B)". */
export function nodeAria(tree: Tree, id: NodeId): string {
  const n = tree.nodes[id];
  if (n === undefined) return `Node ${id}`;
  if (n.children.length === 0) return `Leaf ${n.label ?? `#${id}`}`;
  return `Node ${nodeName(tree, id)} ${cladeName(tree, id)}`;
}

/** The op a node-onto-branch drop (or a node+branch J) applies: the
 * edge above `edgeChild` splits at its midpoint; `node` keeps its own
 * previous edge length — a detached root has none and gets the split's
 * remainder instead. One function serves both paths so a drag and the
 * keyboard always produce the same tree. */
export function moveOp(tree: Tree, node: NodeId, edgeChild: NodeId): EditOp {
  const l = tree.branches[edgeChild]?.length ?? 0;
  const prev = tree.branches[node]?.length;
  const own =
    prev !== null && prev !== undefined && Number.isFinite(prev) && prev >= 0
      ? prev
      : l / 2;
  return {
    kind: "move",
    node,
    newParentEdge: edgeChild,
    lengths: [round6(l / 2), round6(own)],
  };
}

/** A ≥40 px pad grown around a segment — the same construction as
 * TreeView's hitPad (v1.3 spec §6.5). */
export function hitPad(x1: number, y1: number, x2: number, y2: number) {
  const w = Math.abs(x2 - x1);
  const h = Math.abs(y2 - y1);
  return {
    x: Math.min(x1, x2) - Math.max(0, (HIT_MIN - w) / 2),
    y: Math.min(y1, y2) - Math.max(0, (HIT_MIN - h) / 2),
    width: Math.max(w, HIT_MIN),
    height: Math.max(h, HIT_MIN),
  };
}
