// Undo/redo for the editor's tree model (v1.4 plan Task 7, spec §5.1:
// "Undo and redo cover all structural edits and length edits").
//
// Snapshots are the engine `Tree` values the wasm edit_* functions
// returned — undo never recomputes a tree and nothing is deep-cloned.
// A rejected edit adds no snapshot; a new edit after an undo clears the
// redo stack; undo and redo notify subscribers like any other change.

import { EditorModel, type EditorTree } from "./model";

/**
 * An `EditorModel` with undo/redo stacks. Every accepted edit goes
 * through `commit` (called by the inherited `apply` only on `ok`), so
 * the pre-edit snapshot is recorded BEFORE subscribers are notified —
 * a listener already sees the updated `canUndo`/`canRedo`. `undo` and
 * `redo` update the stacks themselves, then `restore` notifies.
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

  /** Record the outgoing tree on the undo stack and clear redo before
   * the swap-and-notify in `super.commit`. Only reached for accepted
   * edits — a refused edit never gets here. */
  protected override commit(next: EditorTree): void {
    this.past.push(this.tree);
    this.future = [];
    super.commit(next);
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
