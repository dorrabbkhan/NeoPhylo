// One stored tree's card in the reading-set editor (v1.4d plan Task
// 10): its name, the paste-only Newick field (polytomies enter
// through Newick — the canvas stays binary), the buttons that move
// the tree between the stored Newick and the shared draw canvas, and
// the extras form below.

import type { ReadingTreeView } from "../../../engine/generated/ReadingTreeView";

import type { TreeDraft } from "./readingDraft";
import { TreeExtrasForm } from "./TreeExtrasForm";

export interface TreeSlotProps {
  tree: TreeDraft;
  /** The stored tree resolved for layout; null while its probe fails. */
  view: ReadingTreeView | null;
  /** The engine's message when the probe set refuses the tree. */
  viewError: string | null;
  /** The clade the last tap armed; null = nothing armed. */
  pendingClade: string[] | null;
  /** Tells the parent this card's extras form owns canvas taps. */
  onArm: () => void;
  /** A preview tap armed a clade on this tree. */
  onClade: (clade: string[]) => void;
  onChange: (t: TreeDraft) => void;
  onRemove: () => void;
  /** "Use canvas tree" — the shared canvas's Newick copied in. */
  onTakeCanvas: () => void;
  /** "Edit on the canvas" — the stored Newick put on the canvas. */
  onEditCanvas: () => void;
}

export function TreeSlot({
  tree,
  view,
  viewError,
  pendingClade,
  onArm,
  onClade,
  onChange,
  onRemove,
  onTakeCanvas,
  onEditCanvas,
}: TreeSlotProps) {
  return (
    <div
      className="rde-tree"
      role="group"
      aria-label={`Tree ${tree.name}`}
    >
      <div className="rde-item-head">
        <label className="field">
          <span>Tree name</span>
          <input
            type="text"
            value={tree.name}
            onChange={(e) =>
              onChange({ ...tree, name: e.target.value })
            }
          />
        </label>
        <button type="button" onClick={onTakeCanvas}>
          Use canvas tree
        </button>
        <button type="button" onClick={onEditCanvas}>
          Edit on the canvas
        </button>
        <button
          type="button"
          className="rde-chip-x"
          aria-label={`Remove tree ${tree.name}`}
          onClick={onRemove}
        >
          Remove tree
        </button>
      </div>
      <label className="field">
        <span>Newick</span>
        <textarea
          rows={2}
          value={tree.newick}
          placeholder="((a,b),(c,d));"
          onChange={(e) =>
            onChange({ ...tree, newick: e.target.value })
          }
        />
      </label>
      <TreeExtrasForm
        tree={tree}
        view={view}
        viewError={viewError}
        pendingClade={pendingClade}
        onArm={onArm}
        onClade={onClade}
        onChange={onChange}
      />
    </div>
  );
}
