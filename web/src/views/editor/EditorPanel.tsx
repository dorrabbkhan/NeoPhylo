// The exercise editor's tree workspace (v1.4 plan Tasks 8–9, spec
// §5.1): the drag canvas on top, then the Newick text view and the
// branch-length table side by side — all bound to the one EditorModel,
// so every edit goes through the engine and the views can never
// disagree. Settings/prompts/preview (Task 10) join this panel later.

import type { EditorModel } from "../../editor/model";

import { BranchTable } from "./BranchTable";
import { DrawCanvas } from "./DrawCanvas";
import { NewickView } from "./NewickView";

export interface EditorPanelProps {
  /** The shared tree model every editor view renders and edits. */
  model: EditorModel;
}

export function EditorPanel({ model }: EditorPanelProps) {
  return (
    <section className="editor-panel" aria-labelledby="editor-panel-title">
      <h1 id="editor-panel-title">Exercise editor</h1>
      <p className="editor-intro">
        One tree, three ways to edit it: drag on the canvas, write
        Newick text, or fill the branch table. All views stay in sync;
        the engine refuses an edit that would leave an unusable tree.
      </p>
      <div className="editor-views">
        <DrawCanvas model={model} />
        <NewickView model={model} />
        <BranchTable model={model} />
      </div>
    </section>
  );
}
