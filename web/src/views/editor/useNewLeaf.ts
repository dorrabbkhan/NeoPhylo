// The new-leaf flow behind the canvas's `N` key and "New leaf" button
// (v1.4 Task 9 fix round 2, spec §5.2): open/cancel/submit for the
// inline NewLeafForm, plus its focus bookkeeping — the element to
// return to on Escape, and the added leaf's handle to focus once the
// commit that draws it lands. No tree logic lives here: the name goes
// to the engine's `add_leaf` through the canvas's `apply`, and a
// refusal keeps the form open with its value (the canvas only closes
// it on success or cancel).

import { useEffect, useRef, useState } from "react";
import type { RefObject } from "react";

import type { EditOp, EditorModel } from "../../editor/model";
import type { Result } from "../../engine/index";
import type { NodeId } from "../../engine/generated/NodeId";

/** Everything the flow reads from the component — the same shape as
 * useDrawDrag's api: the shared model, the canvas's apply (which
 * records refusals) and the callbacks for an accepted add. */
export interface NewLeafApi {
  model: EditorModel;
  apply: (op: EditOp) => Result<void>;
  /** Clear the canvas's inline error/hint when the form opens. */
  clearMessages: () => void;
  /** An accepted add_leaf: select the new node and announce it. */
  onAdded: (id: NodeId, name: string) => void;
}

export function useNewLeaf(
  svgRef: RefObject<SVGSVGElement | null>,
  api: NewLeafApi,
): {
  newLeafOpen: boolean;
  openNewLeaf: () => void;
  cancelNewLeaf: () => void;
  submitNewLeaf: (name: string) => void;
} {
  const [newLeafOpen, setNewLeafOpen] = useState(false);
  const preFocusRef = useRef<Element | null>(null);
  const [focusNode, setFocusNode] = useState<NodeId | null>(null);

  // A successful add_leaf marks its node for focus; once the commit
  // that draws it lands, move keyboard focus to its handle.
  useEffect(() => {
    if (focusNode === null) return;
    const el = svgRef.current?.querySelector(`[data-node="${focusNode}"]`);
    if (el instanceof HTMLElement || el instanceof SVGElement) {
      el.focus();
    }
  }, [focusNode, svgRef]);

  const openNewLeaf = (): void => {
    if (newLeafOpen) {
      document.getElementById("new-leaf-name")?.focus();
      return;
    }
    preFocusRef.current = document.activeElement;
    setNewLeafOpen(true);
    api.clearMessages();
  };

  const cancelNewLeaf = (): void => {
    setNewLeafOpen(false);
    const el = preFocusRef.current;
    if (
      (el instanceof HTMLElement || el instanceof SVGElement) &&
      el.isConnected
    ) {
      el.focus();
    } else {
      svgRef.current?.focus();
    }
  };

  const submitNewLeaf = (name: string): void => {
    // No pre-checks — the engine's add_leaf owns the name rules; a
    // refusal shows through refusalMessage and the form stays open.
    const r = api.apply({ kind: "addLeaf", name });
    if (!r.ok) return;
    setNewLeafOpen(false);
    // The name is engine-unique, so the new leaf is found by label in
    // the post-apply tree — never by a predicted arena id.
    const id = api.model.tree.nodes.findIndex(
      (n) => n.children.length === 0 && n.label === name,
    );
    if (id >= 0) {
      setFocusNode(id);
      api.onAdded(id, name);
    }
  };

  return { newLeafOpen, openNewLeaf, cancelNewLeaf, submitNewLeaf };
}
