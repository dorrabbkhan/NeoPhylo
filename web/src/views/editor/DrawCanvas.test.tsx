// DrawCanvas tests (v1.4 plan Task 9, spec §5.2): the drag canvas is the
// third view over the shared EditorModel — pointer drags translate into
// the same EditOps the keyboard path uses (move, join, setLength,
// detach), every op runs through the engine, and every refusal leaves
// the tree's object identity untouched with the NeoError shown inline.
//
// Drags are simulated with pointer events: pointerDown on a node handle,
// pointerMove past the click tolerance, pointerUp on the drop target's
// element (the browser hit-tests SVG children for us; in jsdom the
// dispatched target stands in for it). Drop coordinates come from the
// event's clientX/Y — jsdom has no real layout, so drops that depend on
// position (length pulls) are exercised in the e2e spec.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EditorHistory } from "../../editor/history";
import { engine } from "../../engine/index";
import type { Tree } from "../../engine/generated/Tree";

import { DrawCanvas } from "./DrawCanvas";
import { EditorPanel } from "./EditorPanel";

afterEach(cleanup);

const STARTER = "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);";

function parseTree(newick: string): Tree {
  const r = engine.parseNewick(newick);
  if (!r.ok) throw new Error(`fixture Newick must parse: ${newick}`);
  return r.value;
}

function renderCanvas(newick = STARTER): EditorHistory {
  const model = new EditorHistory(parseTree(newick));
  render(<DrawCanvas model={model} />);
  return model;
}

function canvas(): HTMLElement {
  return screen.getByRole("application", { name: "Tree canvas" });
}

function node(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

function edge(name: string): HTMLElement {
  return screen.getByRole("button", { name });
}

/** A pointer click on a node handle toggles its selection. */
function select(el: HTMLElement): void {
  fireEvent.pointerDown(el);
  fireEvent.pointerUp(el);
}

describe("DrawCanvas", () => {
  it("renders every node and branch as a named control", () => {
    renderCanvas("(A:0.1,B:0.2,C:0.3);");
    for (const leaf of ["A", "B", "C"]) {
      expect(node(`Leaf ${leaf}`)).toBeTruthy();
      expect(edge(`Branch to ${leaf}`)).toBeTruthy();
    }
    // The root is an internal node control too (selectable for J).
    expect(node("Node (A, B, C)")).toBeTruthy();
  });

  it("a drag onto a branch produces the same tree as the keyboard join, and the Newick text of both is identical", () => {
    const dragged = renderCanvas("(A:0.1,B:0.2,C:0.3);");
    fireEvent.pointerDown(node("Leaf C"), { clientX: 5, clientY: 5 });
    fireEvent.pointerMove(node("Leaf C"), { clientX: 60, clientY: 40 });
    fireEvent.pointerUp(edge("Branch to B"), { clientX: 60, clientY: 40 });
    const byDrag = engine.writeNewick(dragged.tree);
    cleanup();

    const keyed = renderCanvas("(A:0.1,B:0.2,C:0.3);");
    select(node("Leaf C"));
    fireEvent.click(edge("Branch to B"));
    fireEvent.keyDown(canvas(), { key: "j" });

    const byKeys = engine.writeNewick(keyed.tree);
    expect(byKeys).toBe(byDrag);
    expect(byDrag).toBe("(A:0.1,(B:0.1,C:0.3):0.1);");
  });

  it("a drag that would create a unary node is refused", () => {
    const model = renderCanvas("((A:0.1,B:0.2):0.05,C:0.3);");
    const before = model.tree;
    // Dragging A off the tree detaches it — which would leave the
    // (A,B) parent with a single child. The engine refuses and the
    // refusal message shows inline.
    fireEvent.pointerDown(node("Leaf A"), { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(node("Leaf A"), { clientX: 80, clientY: 500 });
    fireEvent.pointerUp(canvas(), { clientX: 80, clientY: 500 });
    expect(screen.getByRole("alert").textContent).toMatch(
      /joins only two branches/,
    );
    expect(model.tree).toBe(before);
  });

  it("a refused detach names the taxon — no bare arena ids in the message", () => {
    const model = renderCanvas("((A:0.1,B:0.2):0.05,C:0.3);");
    const before = model.tree;
    fireEvent.pointerDown(node("Leaf A"), { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(node("Leaf A"), { clientX: 80, clientY: 500 });
    fireEvent.pointerUp(canvas(), { clientX: 80, clientY: 500 });
    const alert = screen.getByRole("alert").textContent ?? "";
    // The title says what was tried in tree terms; the body names the
    // leaf and its sibling, not arena ids.
    expect(alert).toContain("Can't detach A");
    expect(alert).toContain(
      "Its parent joins only two branches — A and B — and every node needs at least two. To move A, drag it onto another branch, or select it and a branch and press J.",
    );
    expect(alert).not.toMatch(/node \d/);
    expect(model.tree).toBe(before);
  });

  // Owner checkpoint 2026-10-27: a refused detach's body names the
  // node and its sibling and says what to do instead — the engine's
  // "(E, D, G) with fewer than two children" phrasing (the parent's
  // clade name, not three children) never reaches the screen.
  it("a refused cherry detach names the cherry and its sibling", () => {
    const model = renderCanvas("((A:0.1,B:0.2):0.05,C:0.3);");
    const before = model.tree;
    // Detaching the (A,B) cherry would unseat the root — refused.
    fireEvent.pointerDown(node("Node (A, B)"), { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(node("Node (A, B)"), { clientX: 80, clientY: 500 });
    fireEvent.pointerUp(canvas(), { clientX: 80, clientY: 500 });
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toContain("Can't detach (A, B)");
    expect(alert).toContain(
      "Its parent joins only two branches — (A, B) and C — and every node needs at least two. To move (A, B), drag it onto another branch, or select it and a branch and press J.",
    );
    expect(alert).not.toMatch(/fewer than two children/);
    expect(alert).not.toMatch(/node \d/);
    expect(model.tree).toBe(before);
  });

  it("a refused nested-clade detach names the clade and its leaf sibling — the (E, D) / G case", () => {
    const model = renderCanvas("((E:0.1,D:0.1):0.1,G:0.1);");
    const before = model.tree;
    // The old message read "removing (E, D) would leave (E, D, G) with
    // fewer than two children" — (E, D, G) is the parent's clade name;
    // its children are (E, D) and G.
    fireEvent.pointerDown(node("Node (E, D)"), { clientX: 10, clientY: 10 });
    fireEvent.pointerMove(node("Node (E, D)"), { clientX: 80, clientY: 500 });
    fireEvent.pointerUp(canvas(), { clientX: 80, clientY: 500 });
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toContain("Can't detach (E, D)");
    expect(alert).toContain(
      "Its parent joins only two branches — (E, D) and G — and every node needs at least two. To move (E, D), drag it onto another branch, or select it and a branch and press J.",
    );
    expect(alert).not.toMatch(/fewer than two children/);
    expect(alert).not.toMatch(/node \d/);
    expect(model.tree).toBe(before);
  });

  it("a refused move names the dragged node and the target branch", () => {
    const model = renderCanvas();
    const before = model.tree;
    // (D,E) cannot move under D — its own descendant. The refusal
    // names the clades, not the arena ids.
    fireEvent.pointerDown(node("Node (D, E)"), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(node("Node (D, E)"), { clientX: 30, clientY: 30 });
    fireEvent.pointerUp(edge("Branch to D"), { clientX: 30, clientY: 30 });
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toContain("Can't move (D, E) onto the branch to D");
    expect(alert).toMatch(/descendant/i);
    expect(model.tree).toBe(before);
  });

  it("Escape cancels an in-progress drag", () => {
    const model = renderCanvas("(A:0.1,B:0.2,C:0.3);");
    const before = model.tree;
    fireEvent.pointerDown(node("Leaf C"), { clientX: 5, clientY: 5 });
    fireEvent.pointerMove(node("Leaf C"), { clientX: 60, clientY: 40 });
    fireEvent.keyDown(canvas(), { key: "Escape" });
    // Dropping on a branch now must not apply the move the drag meant.
    fireEvent.pointerUp(edge("Branch to B"), { clientX: 60, clientY: 40 });
    expect(model.tree).toBe(before);
    expect(engine.writeNewick(model.tree)).toBe("(A:0.1,B:0.2,C:0.3);");
  });

  it("each control has an accessible name", () => {
    renderCanvas();
    expect(canvas().getAttribute("aria-label")).toBe("Tree canvas");
    const buttons = screen.getAllByRole("button");
    expect(buttons.length).toBeGreaterThan(10);
    for (const b of buttons) {
      expect(b.getAttribute("aria-label") ?? "").toMatch(/\S/);
    }
  });

  // Task 10 carry-over (PR #96 review): while a detached or new leaf
  // exists, state/names.ts's leaf count is off by the detached nodes
  // and internal nodes used to read "Node #3". The editor names
  // internal nodes by their clade instead — always correct.
  it("internal nodes keep clade names while a detached leaf exists", () => {
    const model = renderCanvas("(A:0.1,B:0.2,C:0.3);");
    act(() => {
      model.apply({ kind: "addLeaf", name: "F" });
    });
    // F is a fourth childless node — the u-numbering would misread
    // the (A,B,C) root as "#3". The clade name stays right.
    expect(node("Node (A, B, C)")).toBeTruthy();
    expect(node("Leaf F")).toBeTruthy();
    for (const b of screen.getAllByRole("button")) {
      expect(b.getAttribute("aria-label") ?? "").not.toMatch(/^Node #/);
    }
  });

  it("a refused move shows the engine's message and keeps the same tree object", () => {
    const model = renderCanvas();
    const before = model.tree;
    // Dragging the root onto a branch is refused: "the root cannot move".
    fireEvent.pointerDown(node("Node (A, B, C, D, E)"), {
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(node("Node (A, B, C, D, E)"), {
      clientX: 60,
      clientY: 60,
    });
    fireEvent.pointerUp(edge("Branch to B"), { clientX: 60, clientY: 60 });
    expect(screen.getByRole("alert").textContent).toMatch(/root/i);
    expect(model.tree).toBe(before);
  });

  it("dragging a node onto its own subtree's branch is refused", () => {
    const model = renderCanvas();
    const before = model.tree;
    // (D,E) cannot move under D — its own descendant.
    fireEvent.pointerDown(node("Node (D, E)"), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(node("Node (D, E)"), { clientX: 30, clientY: 30 });
    fireEvent.pointerUp(edge("Branch to D"), { clientX: 30, clientY: 30 });
    expect(screen.getByRole("alert").textContent).toMatch(/descendant/i);
    expect(model.tree).toBe(before);
  });

  it("Delete detaches a selected node and the detached subtree draws beside the tree", () => {
    const model = renderCanvas();
    select(node("Node (D, E)"));
    fireEvent.keyDown(canvas(), { key: "Delete" });
    // The main tree keeps A, B, C; (D,E) draws as a detached component.
    expect(engine.writeNewick(model.tree)).toBe("((A:0.1,B:0.2):0.05,C:0.3);");
    expect(screen.getByText(/Detached/)).toBeTruthy();
    expect(node("Leaf D")).toBeTruthy();
    expect(node("Node (D, E)")).toBeTruthy();
  });

  it("J joins two selected component roots back into one tree", () => {
    const model = renderCanvas();
    // Detach (D,E) first — it stays selected — then select the main
    // root too and press J to join the two component roots.
    select(node("Node (D, E)"));
    fireEvent.keyDown(canvas(), { key: "Delete" });
    select(node("Node (A, B, C)"));
    fireEvent.keyDown(canvas(), { key: "j" });
    expect(engine.writeNewick(model.tree)).toBe(
      "((D:0.1,E:0.15):0.1,((A:0.1,B:0.2):0.05,C:0.3):0.1);",
    );
    // The join is undoable like any other edit.
    model.undo();
    expect(engine.writeNewick(model.tree)).toBe(
      "((A:0.1,B:0.2):0.05,C:0.3);",
    );
    model.redo();
    expect(engine.writeNewick(model.tree)).toBe(
      "((D:0.1,E:0.15):0.1,((A:0.1,B:0.2):0.05,C:0.3):0.1);",
    );
  });

  it("arrow keys nudge the selected branch length by a fixed step", () => {
    const model = renderCanvas("(A:0.1,B:0.2);");
    select(node("Leaf B"));
    fireEvent.keyDown(canvas(), { key: "ArrowRight" });
    expect(engine.writeNewick(model.tree)).toBe("(A:0.1,B:0.21);");
    fireEvent.keyDown(canvas(), { key: "ArrowLeft" });
    fireEvent.keyDown(canvas(), { key: "ArrowLeft" });
    expect(engine.writeNewick(model.tree)).toBe("(A:0.1,B:0.19);");
  });

  it("nudging a branch below zero is refused with the engine's message", () => {
    const model = renderCanvas("(A:0.005,B:0.2);");
    const before = model.tree;
    select(node("Leaf A"));
    fireEvent.keyDown(canvas(), { key: "ArrowLeft" });
    expect(screen.getByRole("alert").textContent).toMatch(/negative/i);
    expect(model.tree).toBe(before);
  });

  it("a refused edit adds no undo entry — undo still restores the last accepted edit", () => {
    const model = renderCanvas("(A:0.1,B:0.2,C:0.3);");
    // One accepted edit.
    select(node("Leaf B"));
    fireEvent.keyDown(canvas(), { key: "ArrowRight" });
    expect(engine.writeNewick(model.tree)).toBe("(A:0.1,B:0.21,C:0.3);");
    // One refused edit — dragging the root at a branch.
    fireEvent.pointerDown(node("Node (A, B, C)"), {
      clientX: 10,
      clientY: 10,
    });
    fireEvent.pointerMove(node("Node (A, B, C)"), {
      clientX: 60,
      clientY: 40,
    });
    fireEvent.pointerUp(edge("Branch to B"), { clientX: 60, clientY: 40 });
    expect(screen.getByRole("alert")).toBeTruthy();
    // A single undo must restore the starter tree, proving the refused
    // drag added no history entry.
    model.undo();
    expect(engine.writeNewick(model.tree)).toBe("(A:0.1,B:0.2,C:0.3);");
  });

  it("a drag onto a detached subtree's branch grafts the node there", () => {
    const model = renderCanvas();
    select(node("Node (D, E)"));
    fireEvent.keyDown(canvas(), { key: "Delete" });
    // Drag C onto the branch above D inside the detached component.
    fireEvent.pointerDown(node("Leaf C"), { clientX: 0, clientY: 0 });
    fireEvent.pointerMove(node("Leaf C"), { clientX: 40, clientY: 300 });
    fireEvent.pointerUp(edge("Branch to D"), { clientX: 40, clientY: 300 });
    // The split edge above D is 0.1 → junction at 0.05; C keeps its
    // previous length 0.3. Moving C out of the root's 3-child tree
    // leaves (A,B) as the root component.
    expect(engine.writeNewick(model.tree)).toBe("(A:0.1,B:0.2);");
    // The detached component now contains C, D and E.
    expect(node("Leaf C")).toBeTruthy();
    expect(screen.getByText(/Detached/)).toBeTruthy();
  });

  it("edits on the canvas update the Newick view through the model", () => {
    const model = new EditorHistory(parseTree("(A:0.1,B:0.2,C:0.3);"));
    render(<EditorPanel model={model} />);
    const newick = screen.getByRole("textbox", {
      name: "Newick tree",
    }) as HTMLTextAreaElement;
    fireEvent.pointerDown(node("Leaf C"), { clientX: 5, clientY: 5 });
    fireEvent.pointerMove(node("Leaf C"), { clientX: 60, clientY: 40 });
    fireEvent.pointerUp(edge("Branch to B"), { clientX: 60, clientY: 40 });
    expect(newick.value).toBe("(A:0.1,(B:0.1,C:0.3):0.1);");
  });

  it("J with a single selected node shows a hint, not an error", () => {
    const model = renderCanvas("(A:0.1,B:0.2,C:0.3);");
    const before = model.tree;
    select(node("Leaf A"));
    fireEvent.keyDown(canvas(), { key: "j" });
    expect(screen.getByRole("status").textContent).toMatch(/select/i);
    expect(screen.queryByRole("alert")).toBeNull();
    expect(model.tree).toBe(before);
  });

  // The N key and the "New leaf" button (fix round 2, engine
  // edit::add_leaf from PR #97): a labelled form asks for the taxon
  // name; the engine creates a parentless leaf — a detached component
  // that becomes the selected and focused node, ready for J or a drag.

  it("N opens the new-leaf form; a name and Enter adds a detached, selected leaf", () => {
    const model = renderCanvas("(A:0.1,B:0.2,C:0.3);");
    canvas().focus();
    fireEvent.keyDown(canvas(), { key: "n" });
    const input = screen.getByRole("textbox", { name: "New taxon name" });
    // The shortcut's own letter never lands in the field.
    expect((input as HTMLInputElement).value).toBe("");
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "F" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // The engine added a parentless leaf labelled F: a detached
    // component, drawn with its caption, selected and focused.
    const f = model.tree.nodes.findIndex((n) => n.label === "F");
    expect(f).toBeGreaterThanOrEqual(0);
    expect(model.tree.nodes[f].parent).toBeNull();
    expect(screen.getByText("Detached: F")).toBeTruthy();
    expect(node("Leaf F").getAttribute("aria-pressed")).toBe("true");
    expect(document.activeElement).toBe(node("Leaf F"));
    expect(screen.getByRole("status").textContent).toMatch(
      /Added leaf F/,
    );
  });

  it("the New leaf button opens the same form and adds the leaf", () => {
    const model = renderCanvas("(A:0.1,B:0.2,C:0.3);");
    fireEvent.click(screen.getByRole("button", { name: "New leaf" }));
    const input = screen.getByRole("textbox", { name: "New taxon name" });
    expect(document.activeElement).toBe(input);
    fireEvent.change(input, { target: { value: "G" } });
    fireEvent.click(screen.getByRole("button", { name: "Add leaf" }));
    const g = model.tree.nodes.findIndex((n) => n.label === "G");
    expect(g).toBeGreaterThanOrEqual(0);
    expect(model.tree.nodes[g].parent).toBeNull();
    expect(node("Leaf G").getAttribute("aria-pressed")).toBe("true");
  });

  it("a duplicate name is refused with the name in the message, keeps the form open and adds no history entry", () => {
    const model = renderCanvas("(A:0.1,B:0.2,C:0.3);");
    // One accepted edit first, so undo has somewhere real to land.
    select(node("Leaf B"));
    fireEvent.keyDown(canvas(), { key: "ArrowRight" });
    const afterEdit = model.tree;

    fireEvent.keyDown(canvas(), { key: "n" });
    const input = screen.getByRole("textbox", { name: "New taxon name" });
    fireEvent.change(input, { target: { value: "A" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const alert = screen.getByRole("alert").textContent ?? "";
    expect(alert).toContain("Can't add leaf 'A'");
    expect(alert).toMatch(/duplicate/i);
    expect(model.tree).toBe(afterEdit);
    // The form stays open and keeps the refused name.
    expect((input as HTMLInputElement).value).toBe("A");
    // No history entry: one undo lands on the starter tree.
    model.undo();
    expect(engine.writeNewick(model.tree)).toBe("(A:0.1,B:0.2,C:0.3);");
  });

  it("Escape closes the form with no op and returns focus to the canvas", () => {
    const model = renderCanvas("(A:0.1,B:0.2,C:0.3);");
    const before = model.tree;
    canvas().focus();
    fireEvent.keyDown(canvas(), { key: "n" });
    const input = screen.getByRole("textbox", { name: "New taxon name" });
    fireEvent.change(input, { target: { value: "F" } });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(
      screen.queryByRole("textbox", { name: "New taxon name" }),
    ).toBeNull();
    expect(model.tree).toBe(before);
    expect(document.activeElement).toBe(canvas());
  });

  it("undo removes the added leaf and redo restores it", () => {
    const model = renderCanvas("(A:0.1,B:0.2,C:0.3);");
    fireEvent.keyDown(canvas(), { key: "n" });
    const input = screen.getByRole("textbox", { name: "New taxon name" });
    fireEvent.change(input, { target: { value: "F" } });
    fireEvent.keyDown(input, { key: "Enter" });
    const hasF = () => model.tree.nodes.some((n) => n.label === "F");
    expect(hasF()).toBe(true);
    model.undo();
    expect(hasF()).toBe(false);
    model.redo();
    expect(hasF()).toBe(true);
  });

  it("the full keyboard path — N, name, Enter, select a branch, J — matches dragging the leaf onto it", () => {
    const keyed = renderCanvas("(A:0.1,B:0.2,C:0.3);");
    fireEvent.keyDown(canvas(), { key: "n" });
    const input = screen.getByRole("textbox", { name: "New taxon name" });
    fireEvent.change(input, { target: { value: "F" } });
    fireEvent.keyDown(input, { key: "Enter" });
    // F is already the selected node; selecting the branch to B makes
    // J apply the shared moveOp — the same op the drag below performs.
    fireEvent.click(edge("Branch to B"));
    fireEvent.keyDown(canvas(), { key: "j" });
    const byKeys = engine.writeNewick(keyed.tree);
    expect(byKeys).toBe("(A:0.1,(B:0.1,F:0.1):0.1,C:0.3);");
    cleanup();

    const dragged = renderCanvas("(A:0.1,B:0.2,C:0.3);");
    act(() => {
      dragged.apply({ kind: "addLeaf", name: "F" });
    });
    fireEvent.pointerDown(node("Leaf F"), { clientX: 5, clientY: 5 });
    fireEvent.pointerMove(node("Leaf F"), { clientX: 60, clientY: 40 });
    fireEvent.pointerUp(edge("Branch to B"), { clientX: 60, clientY: 40 });
    expect(engine.writeNewick(dragged.tree)).toBe(byKeys);
  });
});
