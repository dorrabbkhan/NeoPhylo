// Undo/redo for the editor's tree model (v1.4 plan Task 7, spec §5.1:
// "Undo and redo cover all structural edits and length edits").
//
// Snapshots are the engine `Tree` values the wasm edit_* functions
// returned — undo never recomputes a tree and nothing is deep-cloned.
// A rejected edit adds no snapshot; a new edit after an undo clears the
// redo stack; undo and redo notify subscribers like any other change.

import { EditorModel, type EditOp, type EditorTree } from "./model";
import type { Result } from "../engine/index";

/**
 * An `EditorModel` with undo/redo stacks. Route every edit through
 * `apply` (inherited signature — calls the engine like the plain
 * model) so the history stays complete; `undo`/`redo` restore the
 * engine values recorded at each accepted edit.
 */
export class EditorHistory extends EditorModel {
  private past: EditorTree[] = [];
  private future: EditorTree[] = [];

  get canUndo(): boolean {
    return this.past.length > 0;
  }

  get canRedo(): boolean {
    return this.future.length > 0;
  }

  override apply(op: EditOp): Result<void> {
    const before = this.tree;
    const r = super.apply(op);
    if (!r.ok) return r;
    this.past.push(before);
    this.future = [];
    return r;
  }

  /** Restore the tree from before the last accepted edit. A no-op —
   * and no notification — at the bottom of the stack. */
  undo(): void {
    const t = this.past.pop();
    if (t === undefined) return;
    this.future.push(this.tree);
    this.restore(t);
  }

  /** Replay the last undone edit's resulting tree. */
  redo(): void {
    const t = this.future.pop();
    if (t === undefined) return;
    this.past.push(this.tree);
    this.restore(t);
  }
}
