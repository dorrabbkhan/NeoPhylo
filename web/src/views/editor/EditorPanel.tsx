// The exercise editor's tree workspace (v1.4 plan Task 8, spec §5.1):
// the Newick text view and the branch-length table side by side, both
// bound to the one EditorModel — every edit goes through the model and
// the engine, so the views can never disagree. The drag canvas (Task 9)
// and settings/prompts/preview (Task 10) join this panel later.

import type { EditorModel } from "../../editor/model";

import { BranchTable } from "./BranchTable";
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
        One tree, two ways to edit it: as Newick text or as a table of
        branch lengths. Both views stay in sync; the engine refuses an
        edit that would leave an unusable tree.
      </p>
      <div className="editor-views">
        <NewickView model={model} />
        <BranchTable model={model} />
      </div>
    </section>
  );
}
