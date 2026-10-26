// The editor's single tree model (v1.4 plan Task 7, spec §5.1). The
// drag canvas, Newick view and branch table all render from this one
// object; every structural edit runs in the engine through the wasm
// edit_* functions — this class holds no tree logic.
//
// `tree` is the engine `Tree` type under the name `EditorTree`:
// `TreeView` is already the React tree component's name in this
// codebase (recorded in docs/decisions.md).
//
// On `ok: false` the tree is the SAME object as before — identity, not
// just equality — and subscribers are not notified, so views can rely
// on a change meaning a new value.

import { engine, type Result } from "../engine/index";
import type { NodeId } from "../engine/generated/NodeId";
import type { Tree } from "../engine/generated/Tree";

/** The engine tree the editor edits. */
export type EditorTree = Tree;

/** One structural edit the editor can apply (spec §5.1). Each variant
 * maps to one `edit_*` engine function; `NodeId`s are the generated
 * `NodeId` type. */
export type EditOp =
  | { kind: "addLeaf"; name: string }
  | { kind: "join"; a: NodeId; b: NodeId; lengths: [number, number] }
  | { kind: "detach"; node: NodeId }
  | {
      kind: "move";
      node: NodeId;
      newParentEdge: NodeId;
      lengths: [number, number];
    }
  | { kind: "setLength"; child: NodeId; length: number }
  | { kind: "rename"; leaf: NodeId; name: string };

function runOp(tree: Tree, op: EditOp): Result<Tree> {
  switch (op.kind) {
    case "addLeaf":
      return engine.editAddLeaf(tree, op.name);
    case "join":
      return engine.editJoin(tree, op.a, op.b, op.lengths);
    case "detach":
      return engine.editDetach(tree, op.node);
    case "move":
      return engine.editMoveSubtree(
        tree,
        op.node,
        op.newParentEdge,
        op.lengths,
      );
    case "setLength":
      return engine.editSetLength(tree, op.child, op.length);
    case "rename":
      return engine.editRenameLeaf(tree, op.leaf, op.name);
  }
}

/**
 * One tree model behind every editor view. `apply` forwards to the
 * engine; `subscribe` registers a listener called after each accepted
 * edit (and by undo/redo via the subclass hook).
 */
export class EditorModel {
  protected current: Tree;
  private readonly listeners = new Set<() => void>();

  constructor(tree: Tree) {
    this.current = tree;
  }

  /** The current tree. Replaced, never mutated, on each accepted edit. */
  get tree(): EditorTree {
    return this.current;
  }

  /** Apply one structural edit through the engine. On `ok: false` the
   * tree keeps the same object identity and subscribers are not
   * notified. */
  apply(op: EditOp): Result<void> {
    const r = runOp(this.current, op);
    if (!r.ok) return { ok: false, error: r.error };
    this.commit(r.value);
    return { ok: true, value: undefined };
  }

  /** Replace the tree wholesale — the Newick view's parse path (spec
   * §5.1). The candidate passes `edit_validate` (the engine's
   * "saveable exercise tree" gate) before commit, so a parsed-but-
   * uneditable tree (duplicate names, missing lengths, a unary node)
   * is refused exactly like a structural edit: the SAME tree object is
   * kept and subscribers are not notified. Through `commit`, so undo
   * covers the replacement. */
  replace(tree: EditorTree): Result<void> {
    const v = engine.editValidate(tree);
    if (!v.ok) return { ok: false, error: v.error };
    this.commit(tree);
    return { ok: true, value: undefined };
  }

  /** Commit an accepted edit's tree: swap it in, then notify.
   * Subclasses (EditorHistory) override this to update their own state
   * before the notification runs — subscribers must already observe
   * the post-edit state. */
  protected commit(next: Tree): void {
    this.current = next;
    this.notify();
  }

  /** Replace the tree directly (undo/redo) and notify subscribers. */
  protected restore(tree: Tree): void {
    this.current = tree;
    this.notify();
  }

  /** Register `fn` to run after every tree change; returns the
   * unsubscribe. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  protected notify(): void {
    for (const fn of this.listeners) fn();
  }
}
