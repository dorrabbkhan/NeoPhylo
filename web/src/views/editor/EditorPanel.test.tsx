// EditorPanel tests (v1.4 plan Task 8, spec §5.1): the Newick text and
// the branch-length table are two views of ONE tree model — an edit in
// either shows up in the other, and refused edits (invalid Newick,
// duplicate taxon names, negative lengths) leave the model's tree
// untouched while naming the problem inline.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { EditorHistory } from "../../editor/history";
import type { EditorModel } from "../../editor/model";
import { engine } from "../../engine/index";
import type { Tree } from "../../engine/generated/Tree";

import { EditorPanel } from "./EditorPanel";

afterEach(cleanup);

function parseTree(newick: string): Tree {
  const r = engine.parseNewick(newick);
  if (!r.ok) throw new Error(`fixture Newick must parse: ${newick}`);
  return r.value;
}

function renderPanel(newick = "(A:0.1,B:0.2);"): EditorModel {
  const model = new EditorHistory(parseTree(newick));
  render(<EditorPanel model={model} />);
  return model;
}

function newickBox(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Newick tree" });
}

function branchInput(name: string): HTMLInputElement {
  return screen.getByRole("textbox", {
    name: `Length of the branch to ${name}`,
  });
}

function branchTable(): HTMLElement {
  return screen.getByRole("table", { name: "Branch lengths" });
}

describe("EditorPanel", () => {
  it("renders the model's Newick text and one table row per branch", () => {
    renderPanel("((A:0.1,B:0.2):0.05,C:0.3);");
    expect(newickBox().value).toBe("((A:0.1,B:0.2):0.05,C:0.3);");
    const rows = within(branchTable()).getAllByRole("row");
    // Header row + A, B, the (A,B) clade and C.
    expect(rows).toHaveLength(5);
    expect(branchInput("A").value).toBe("0.1");
    expect(branchInput("B").value).toBe("0.2");
    expect(branchInput("C").value).toBe("0.3");
  });

  it("typing Newick updates the table", () => {
    renderPanel();
    fireEvent.change(newickBox(), {
      target: { value: "(A:0.1,B:0.2,C:0.3);" },
    });
    fireEvent.blur(newickBox());
    expect(branchInput("C").value).toBe("0.3");
    expect(newickBox().value).toBe("(A:0.1,B:0.2,C:0.3);");
  });

  it("parses Newick on Enter as well as on blur", () => {
    renderPanel();
    fireEvent.change(newickBox(), {
      target: { value: "(A:0.1,B:0.2,C:0.3,D:0.4);" },
    });
    fireEvent.keyDown(newickBox(), { key: "Enter" });
    expect(branchInput("D").value).toBe("0.4");
  });

  it("editing a table length updates the Newick text", () => {
    renderPanel();
    fireEvent.change(branchInput("B"), { target: { value: "0.9" } });
    fireEvent.keyDown(branchInput("B"), { key: "Enter" });
    expect(newickBox().value).toBe("(A:0.1,B:0.9);");
  });

  it("an invalid Newick shows the engine's position detail, not a FASTA hint", () => {
    const model = renderPanel();
    const before = model.tree;
    fireEvent.change(newickBox(), { target: { value: "not a tree" } });
    fireEvent.blur(newickBox());
    const alert = screen.getByRole("alert");
    // The engine's own detail comes through verbatim — `expected ';'
    // (line 1, column 5)` — with a Newick hint, never the shared
    // message's FASTA one (meaningless in a Newick-only field).
    expect(alert.textContent).toContain("expected");
    expect(alert.textContent).toMatch(/\(line 1, column \d+\)/);
    expect(alert.textContent).not.toContain("FASTA");
    // The model is untouched: same tree object, table still shows A and B.
    expect(model.tree).toBe(before);
    expect(branchInput("A").value).toBe("0.1");
    expect(branchInput("B").value).toBe("0.2");
    expect(screen.queryByRole("textbox", {
      name: "Length of the branch to C",
    })).toBeNull();
  });

  it("a duplicate taxon name is refused with the name in the message", () => {
    const model = renderPanel();
    const before = model.tree;
    fireEvent.change(newickBox(), {
      target: { value: "(Homo:0.1,Homo:0.2,Pan:0.3);" },
    });
    fireEvent.keyDown(newickBox(), { key: "Enter" });
    const alert = screen.getByRole("alert");
    // The engine quotes the offending name: `duplicate taxon name
    // 'Homo'` — a bare letter would pass on almost any message.
    expect(alert.textContent).toContain("'Homo'");
    expect(alert.textContent).toMatch(/duplicate/i);
    expect(model.tree).toBe(before);
    expect(newickBox().value).toBe("(Homo:0.1,Homo:0.2,Pan:0.3);");
  });

  it("a negative length is refused with the reason, tree unchanged", () => {
    const model = renderPanel();
    const before = model.tree;
    fireEvent.change(branchInput("B"), { target: { value: "-1" } });
    fireEvent.blur(branchInput("B"));
    expect(screen.getByRole("alert").textContent).toMatch(/negative/i);
    expect(model.tree).toBe(before);
    expect(newickBox().value).toBe("(A:0.1,B:0.2);");
  });

  it("a non-numeric length is refused before it reaches the engine", () => {
    const model = renderPanel();
    const before = model.tree;
    fireEvent.change(branchInput("B"), { target: { value: "abc" } });
    fireEvent.keyDown(branchInput("B"), { key: "Enter" });
    expect(screen.getByRole("alert")).toBeTruthy();
    expect(model.tree).toBe(before);
  });

  it.each(["0x10", "0b1", "1e400"])(
    'a length of "%s" is not plain decimal — refused, tree unchanged',
    (typed) => {
      const model = renderPanel();
      const before = model.tree;
      fireEvent.change(branchInput("B"), { target: { value: typed } });
      fireEvent.keyDown(branchInput("B"), { key: "Enter" });
      // Hex/binary fail the decimal syntax check; 1e400 parses but is
      // non-finite — both get the "is not a number" refusal.
      expect(screen.getByRole("alert").textContent).toContain(
        "is not a number",
      );
      expect(model.tree).toBe(before);
      expect(newickBox().value).toBe("(A:0.1,B:0.2);");
    },
  );

  it("a fresh valid Newick clears an earlier parse error", () => {
    renderPanel();
    fireEvent.change(newickBox(), { target: { value: "(((" } });
    fireEvent.blur(newickBox());
    expect(screen.getByRole("alert")).toBeTruthy();
    fireEvent.change(newickBox(), {
      target: { value: "(X:0.5,Y:0.5);" },
    });
    fireEvent.blur(newickBox());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(branchInput("X").value).toBe("0.5");
  });
});
