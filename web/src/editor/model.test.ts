// EditorModel tests (v1.4 plan Task 7, spec §5.1): every structural edit
// goes through the wasm edit_* functions — the model holds no tree logic.
// A refused edit must leave `tree` as the SAME object (identity, not just
// equality) and must not notify subscribers.

import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { NodeId } from "../engine/generated/NodeId";
import type { Tree } from "../engine/generated/Tree";

import { EditorHistory } from "./history";
import { EditorModel } from "./model";

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

describe("EditorModel.apply", () => {
  it("detach unlinks a subtree, and join reunites two component roots", () => {
    const m = new EditorModel(parseTree("(A:0.1,B:0.2,C:0.3);"));
    const a = nodeId(m.tree, "A");
    const root = m.tree.root;

    const beforeDetach = m.tree;
    expect(m.apply({ kind: "detach", node: a }).ok).toBe(true);
    expect(m.tree).not.toBe(beforeDetach);
    expect(m.tree.nodes[root].children).not.toContain(a);

    const beforeJoin = m.tree;
    expect(
      m.apply({ kind: "join", a, b: root, lengths: [0.1, 0.05] }).ok,
    ).toBe(true);
    expect(m.tree).not.toBe(beforeJoin);
    expect(m.tree.root).not.toBe(root);
    expect(engine.editValidate(m.tree).ok).toBe(true);
  });

  it("set_length rewrites the edge above a child", () => {
    const m = new EditorModel(parseTree("(A:0.1,B:0.2,C:0.3);"));
    const b = nodeId(m.tree, "B");
    expect(m.apply({ kind: "setLength", child: b, length: 0.9 }).ok).toBe(
      true,
    );
    expect(m.tree.branches[b].length).toBe(0.9);
  });

  it("rename_leaf updates the label", () => {
    const m = new EditorModel(parseTree("(A:0.1,B:0.2,C:0.3);"));
    const a = nodeId(m.tree, "A");
    expect(m.apply({ kind: "rename", leaf: a, name: "A2" }).ok).toBe(true);
    expect(m.tree.nodes[a].label).toBe("A2");
  });

  it("move_subtree relocates a leaf onto another edge", () => {
    const m = new EditorModel(parseTree("(A:0.4,(B:0.2,C:0.3):0.4);"));
    const a = nodeId(m.tree, "A");
    const b = nodeId(m.tree, "B");
    expect(
      m.apply({
        kind: "move",
        node: a,
        newParentEdge: b,
        lengths: [0.05, 0.1],
      }).ok,
    ).toBe(true);
    expect(engine.editValidate(m.tree).ok).toBe(true);
    // The arena keeps spliced-out nodes as inert unlabelled husks.
    const labels = m.tree.nodes
      .filter((n) => n.children.length === 0 && n.label !== null)
      .map((n) => n.label);
    expect(labels.sort()).toEqual(["A", "B", "C"]);
  });

  it("add_leaf adds a parentless leaf found by name", () => {
    const m = new EditorModel(parseTree("(A:0.1,B:0.2,C:0.3);"));
    const before = m.tree;
    expect(m.apply({ kind: "addLeaf", name: "D" }).ok).toBe(true);
    expect(m.tree).not.toBe(before);
    const d = nodeId(m.tree, "D");
    expect(m.tree.nodes[d].parent).toBeNull();
    expect(m.tree.nodes[d].children).toEqual([]);
    expect(m.tree.branches[d].length).toBeNull();
    // A detached new leaf does not affect the main component.
    expect(engine.editValidate(m.tree).ok).toBe(true);
  });

  it("add_leaf with a duplicate name is refused: same tree object, the name in the message, no history entry", () => {
    const h = new EditorHistory(parseTree("(A:0.1,B:0.2,C:0.3);"));
    let calls = 0;
    h.subscribe(() => calls++);
    const before = h.tree;
    const r = h.apply({ kind: "addLeaf", name: "B" });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidEdit");
      if (r.error.kind === "InvalidEdit") {
        expect(r.error.msg).toBe("duplicate taxon name 'B'");
      }
    }
    expect(h.tree).toBe(before);
    expect(calls).toBe(0);
    expect(h.canUndo).toBe(false);
  });

  it("undo removes an added leaf and redo restores it", () => {
    const h = new EditorHistory(parseTree("(A:0.1,B:0.2,C:0.3);"));
    const t0 = h.tree;
    expect(h.apply({ kind: "addLeaf", name: "D" }).ok).toBe(true);
    const t1 = h.tree;
    const d = nodeId(t1, "D");

    h.undo();
    expect(h.tree).toBe(t0);
    expect(h.tree.nodes.some((n) => n.label === "D")).toBe(false);
    expect(h.canRedo).toBe(true);

    h.redo();
    expect(h.tree).toBe(t1);
    expect(h.tree.nodes[d].label).toBe("D");
    expect(h.tree.nodes[d].parent).toBeNull();
  });

  it("a duplicate taxon name is refused: same tree object, no notification", () => {
    const m = new EditorModel(parseTree("(A:0.1,B:0.2,C:0.3);"));
    const a = nodeId(m.tree, "A");
    let calls = 0;
    m.subscribe(() => calls++);
    const before = m.tree;
    const r = m.apply({ kind: "rename", leaf: a, name: "B" });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidEdit");
    expect(m.tree).toBe(before);
    expect(calls).toBe(0);
  });

  it("refuses a negative branch length and a detach that leaves a unary node", () => {
    const m = new EditorModel(parseTree("(A:0.1,B:0.2);"));
    const a = nodeId(m.tree, "A");
    const before = m.tree;
    expect(m.apply({ kind: "setLength", child: a, length: -1 }).ok).toBe(
      false,
    );
    expect(m.apply({ kind: "detach", node: a }).ok).toBe(false);
    expect(m.tree).toBe(before);
  });

  it("a malformed tree argument returns ok:false instead of throwing", () => {
    const malformed = {
      nodes: [],
      branches: [{}],
      root: 0,
      rooted: true,
    } as unknown as Tree;
    const m = new EditorModel(malformed);
    expect(m.apply({ kind: "setLength", child: 0, length: 1 }).ok).toBe(false);
    // The binding layer itself never throws on a non-object argument.
    expect(engine.editJoin({} as Tree, 0, 1, [0.1, 0.1]).ok).toBe(false);
    expect(engine.editValidate(malformed).ok).toBe(false);
  });

  it("notifies subscribers on accepted edits and stops after unsubscribe", () => {
    const m = new EditorModel(parseTree("(A:0.1,B:0.2,C:0.3);"));
    const a = nodeId(m.tree, "A");
    let calls = 0;
    const unsub = m.subscribe(() => calls++);
    m.apply({ kind: "rename", leaf: a, name: "A2" });
    expect(calls).toBe(1);
    unsub();
    m.apply({ kind: "rename", leaf: a, name: "A3" });
    expect(calls).toBe(1);
  });
});
