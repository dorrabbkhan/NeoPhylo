// EditorHistory tests (v1.4 plan Task 7, spec §5.1): undo/redo restore
// the engine Tree values the wasm layer returned — no recomputation, no
// deep clone. A rejected edit adds no snapshot, a new edit after undo
// clears the redo stack, and undo/redo notify subscribers.

import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { NodeId } from "../engine/generated/NodeId";
import type { Tree } from "../engine/generated/Tree";

import { EditorHistory } from "./history";

function parseTree(newick: string): Tree {
  const r = engine.parseNewick(newick);
  if (!r.ok) throw new Error(`fixture Newick must parse: ${newick}`);
  return r.value;
}

function nodeId(t: Tree, label: string): NodeId {
  const i = t.nodes.findIndex((n) => n.label === label);
  if (i < 0) throw new Error(`no node labelled ${label}`);
  return i;
}

describe("EditorHistory", () => {
  it("undo restores the previous tree value and redo replays it", () => {
    const h = new EditorHistory(parseTree("(A:0.1,B:0.2,C:0.3);"));
    const a = nodeId(h.tree, "A");
    const t0 = h.tree;

    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(false);

    expect(h.apply({ kind: "rename", leaf: a, name: "A2" }).ok).toBe(true);
    const t1 = h.tree;
    expect(t1).not.toBe(t0);
    expect(h.canUndo).toBe(true);

    h.undo();
    expect(h.tree).toBe(t0);
    expect(h.canUndo).toBe(false);
    expect(h.canRedo).toBe(true);

    h.redo();
    expect(h.tree).toBe(t1);
    expect(h.canUndo).toBe(true);
    expect(h.canRedo).toBe(false);
  });

  it("undo after a rejected edit restores the tree before the last ACCEPTED edit", () => {
    const h = new EditorHistory(parseTree("(A:0.1,B:0.2,C:0.3);"));
    const a = nodeId(h.tree, "A");
    const t0 = h.tree;

    expect(h.apply({ kind: "rename", leaf: a, name: "A2" }).ok).toBe(true);
    const t1 = h.tree;
    // Rejected: rename B to the now-taken "A2" adds no snapshot.
    const b = nodeId(h.tree, "B");
    expect(h.apply({ kind: "rename", leaf: b, name: "A2" }).ok).toBe(false);
    expect(h.tree).toBe(t1);

    h.undo();
    expect(h.tree).toBe(t0);
  });

  it("a new edit after undo clears the redo stack", () => {
    const h = new EditorHistory(parseTree("(A:0.1,B:0.2,C:0.3);"));
    const a = nodeId(h.tree, "A");
    const b = nodeId(h.tree, "B");

    h.apply({ kind: "rename", leaf: a, name: "A2" });
    h.undo();
    expect(h.canRedo).toBe(true);
    h.apply({ kind: "setLength", child: b, length: 0.9 });
    expect(h.canRedo).toBe(false);
    h.undo();
    expect(h.tree.nodes[a].label).toBe("A");
  });

  it("undo and redo notify subscribers", () => {
    const h = new EditorHistory(parseTree("(A:0.1,B:0.2,C:0.3);"));
    const a = nodeId(h.tree, "A");
    let calls = 0;
    h.subscribe(() => calls++);

    h.apply({ kind: "rename", leaf: a, name: "A2" });
    expect(calls).toBe(1);
    h.undo();
    expect(calls).toBe(2);
    h.redo();
    expect(calls).toBe(3);
    // A no-op undo at the bottom of the stack does not notify.
    h.undo();
    h.undo();
    expect(calls).toBe(4);
  });
});
