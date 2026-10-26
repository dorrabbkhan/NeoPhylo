// Editor Newick view (v1.4 plan Task 8, spec §5.1): one of the three
// views over the shared EditorModel — the tree's canonical Newick text
// (`engine.writeNewick`) in an editable field.
//
// Text commits on blur or Enter (the plan's Produces contract): the
// input goes through `engine.parseNewick` — never a TypeScript parser —
// and the parsed tree enters the model through `model.replace`, which
// gates it on the engine's `edit_validate`. A refusal (syntax error,
// duplicate taxon name, missing length, unary node) shows the NeoError
// message inline as an alert and the model keeps the last valid tree.
//
// While the field carries uncommitted edits a change elsewhere (a
// branch-table edit, an undo) does not clobber the user's text; once it
// commits, every view redraws from the model's new tree.

import { useCallback, useState, useSyncExternalStore } from "react";
import type { KeyboardEvent } from "react";

import type { EditorModel } from "../../editor/model";
import { engine } from "../../engine/index";
import type { NeoError } from "../../engine/generated/NeoError";
import { errorMessage } from "../../explain/errors";

export interface NewickViewProps {
  model: EditorModel;
}

export function NewickView({ model }: NewickViewProps) {
  const subscribe = useCallback(
    (fn: () => void) => model.subscribe(fn),
    [model],
  );
  const tree = useSyncExternalStore(subscribe, () => model.tree);

  const [text, setText] = useState(() => engine.writeNewick(model.tree));
  const [error, setError] = useState<NeoError | null>(null);
  // True while the field holds uncommitted edits — model changes then
  // do not overwrite what the user is typing. State, not a ref: the
  // resync below reads it during render (refs are lint-forbidden there).
  const [dirty, setDirty] = useState(false);

  // The model changed from another view (or undo): resync unless the
  // user is mid-edit. Render-phase adjustment (the tree prop changed),
  // not an effect — set-state-in-effect is lint-forbidden here.
  const [syncedTree, setSyncedTree] = useState(tree);
  if (syncedTree !== tree) {
    setSyncedTree(tree);
    if (!dirty) {
      setText(engine.writeNewick(tree));
      setError(null);
    }
  }

  const commit = () => {
    if (text.trim() === engine.writeNewick(tree)) {
      // No real change — no undo entry for a no-op commit.
      setDirty(false);
      setError(null);
      return;
    }
    const parsed = engine.parseNewick(text);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    const applied = model.replace(parsed.value);
    if (!applied.ok) {
      setError(applied.error);
      return;
    }
    setDirty(false);
    setError(null);
  };

  const revert = () => {
    setDirty(false);
    setText(engine.writeNewick(tree));
    setError(null);
  };

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter") {
      // Newick is one line — Enter commits instead of inserting one.
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      revert();
    }
  };

  const m = error === null ? null : errorMessage(error);

  return (
    <div className="editor-view newick-view">
      <label className="editor-view-label" htmlFor="editor-newick">
        Newick tree
      </label>
      <textarea
        id="editor-newick"
        className="newick-input"
        value={text}
        spellCheck={false}
        aria-invalid={error !== null || undefined}
        aria-describedby={error !== null ? "editor-newick-error" : undefined}
        onChange={(e) => {
          setDirty(true);
          setText(e.target.value);
          setError(null);
        }}
        onBlur={commit}
        onKeyDown={onKeyDown}
      />
      {m !== null && (
        <p role="alert" className="editor-error" id="editor-newick-error">
          <strong>{m.title}:</strong> {m.body}
        </p>
      )}
      <p className="editor-hint">
        Enter or leaving the field applies the text; Escape restores the
        current tree's Newick.
      </p>
    </div>
  );
}
