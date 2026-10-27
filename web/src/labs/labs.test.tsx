// Lab page/index rendering and the editor's "load this lab" flow
// (v1.4 plan Task 11, spec §6.2/§6.5, Review Focus 5).
//
// Review Focus 5: "load this lab" is reachable inside the editor (the
// PHYLIP labs sheet) so a dirty draft is a real state — the editor
// asks before replacing unsaved work, declining keeps the exact tree
// and settings, accepting replaces them, and a clean editor is not
// asked.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { EditorHistory } from "../editor/history";
import { engine } from "../engine/index";
import type { Tree } from "../engine/generated/Tree";
import { EditorPanel } from "../views/editor/EditorPanel";
import { LabIndex } from "../views/labs/LabIndex";
import { LabPage } from "../views/labs/LabPage";

const LAB_TREE = "((A:0.1,B:0.2):0.05,C:0.3);";

afterEach(cleanup);

beforeEach(() => {
  window.localStorage.setItem("neophylo-e2e", "1");
});

afterEach(() => {
  window.localStorage.removeItem("neophylo-e2e");
});

function parseTree(newick: string): Tree {
  const r = engine.parseNewick(newick);
  if (!r.ok) throw new Error(`fixture Newick must parse: ${newick}`);
  return r.value;
}

function renderPanel(newick = "(X:0.1,Y:0.2);"): EditorHistory {
  const model = new EditorHistory(parseTree(newick));
  render(<EditorPanel model={model} />);
  return model;
}

function newickBox(): HTMLTextAreaElement {
  return screen.getByRole("textbox", { name: "Newick tree" });
}

function titleField(): HTMLInputElement {
  return screen.getByLabelText("Title");
}

function openLabsSheet(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "PHYLIP labs" }));
  return screen.getByRole("dialog", { name: "PHYLIP labs" });
}

function clickLoadThisLab(sheet: HTMLElement) {
  // Scope to the test lab's row — Task 12's shipped dnadist-neighbor
  // pack lists its own "Load this lab" button alongside it.
  const row = within(sheet)
    .getByText("Test lab: dnadist → neighbor")
    .closest("li");
  if (row === null) throw new Error("test-lab row missing from the sheet");
  fireEvent.click(
    within(row as HTMLElement).getByRole("button", {
      name: "Load this lab",
    }),
  );
}

describe("lab index and lab page", () => {
  it("the index lists the lab with its objectives and a link to its page", () => {
    render(<LabIndex />);
    expect(
      screen.getByRole("heading", { name: "PHYLIP labs" }),
    ).toBeTruthy();
    expect(
      screen.getByText("Test lab: dnadist → neighbor"),
    ).toBeTruthy();
    expect(
      screen.getByText(/Run the dnadist → neighbor chain end to end/),
    ).toBeTruthy();
    const card = screen
      .getByText("Test lab: dnadist → neighbor")
      .closest("li");
    if (card === null) throw new Error("test-lab card missing");
    const link = within(card as HTMLElement).getByRole("link", {
      name: /open lab/i,
    });
    expect(link.getAttribute("href")).toBe("?lab=test-lab");
  });

  it("with the e2e flag off only shipped labs list — the dnadist-neighbor pack", () => {
    window.localStorage.removeItem("neophylo-e2e");
    render(<LabIndex />);
    expect(screen.getByText("dnadist → neighbor (F84)")).toBeTruthy();
    expect(screen.queryByText("Test lab: dnadist → neighbor")).toBeNull();
    expect(screen.queryByText(/no lab packs/i)).toBeNull();
  });

  it("the lab page renders the chain, objectives, settings table and handout", async () => {
    render(<LabPage id="test-lab" />);
    expect(
      await screen.findByRole("heading", {
        name: "Test lab: dnadist → neighbor",
      }),
    ).toBeTruthy();
    expect(
      screen.getAllByText(/dnadist → neighbor/).length,
    ).toBeGreaterThan(0);
    for (const cell of ["Distance model", "F84", "JC69", "Replicates", "100"]) {
      expect(screen.getAllByText(cell).length).toBeGreaterThan(0);
    }
    expect(screen.getByText(/Which pair joins first/)).toBeTruthy();
    expect(
      screen.getByText(/PHYLIP's outfile lists the matrix/),
    ).toBeTruthy();
    // The load action links into the app with the exercise payload;
    // the controls area is the element the print view hides.
    const load = screen.getByRole("link", { name: "Load this lab" });
    expect(load.getAttribute("href")).toMatch(/#x=/);
    expect(document.querySelector(".lab-controls")).toBeTruthy();
    expect(screen.getByRole("button", { name: /print/i })).toBeTruthy();
  });

  it("an unknown lab page says so instead of throwing", async () => {
    render(<LabPage id="no-such-lab" />);
    expect(await screen.findByRole("alert")).toBeTruthy();
  });
});

describe("load this lab in the editor (Review Focus 5)", () => {
  it("with no unsaved changes the lab loads without asking", () => {
    const model = renderPanel();
    const expected = engine.writeNewick(parseTree(LAB_TREE));
    const sheet = openLabsSheet();
    expect(sheet.textContent).toContain("Test lab: dnadist → neighbor");
    clickLoadThisLab(sheet);
    expect(screen.queryByText(/unsaved/i)).toBeNull();
    expect(newickBox().value).toBe(expected);
    expect(engine.writeNewick(model.tree)).toBe(expected);
    expect(titleField().value).toBe("Test lab: dnadist chain");
    expect(
      (screen.getByRole("combobox", { name: "Model" }) as HTMLSelectElement)
        .value,
    ).toBe("JC69");
  });

  it("with unsaved changes it asks first and declining keeps the exact tree and settings", () => {
    const model = renderPanel("(X:0.1,Y:0.2);");
    fireEvent.change(titleField(), { target: { value: "My draft" } });
    fireEvent.change(newickBox(), {
      target: { value: "(X:0.5,Y:0.5,Z:0.5);" },
    });
    fireEvent.keyDown(newickBox(), { key: "Enter" });
    expect(newickBox().value).toBe("(X:0.5,Y:0.5,Z:0.5);");

    const sheet = openLabsSheet();
    clickLoadThisLab(sheet);
    expect(
      screen.getAllByText(/unsaved/i).length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /keep my work/i }));
    expect(newickBox().value).toBe("(X:0.5,Y:0.5,Z:0.5);");
    expect(titleField().value).toBe("My draft");
    expect(model.tree.nodes.length).toBe(
      parseTree("(X:0.5,Y:0.5,Z:0.5);").nodes.length,
    );
  });

  it("with unsaved changes it asks first and accepting replaces them; a second load does not ask", () => {
    renderPanel("(X:0.1,Y:0.2);");
    fireEvent.change(newickBox(), {
      target: { value: "(X:0.5,Y:0.5);" },
    });
    fireEvent.keyDown(newickBox(), { key: "Enter" });
    const expected = engine.writeNewick(parseTree(LAB_TREE));

    const sheet = openLabsSheet();
    clickLoadThisLab(sheet);
    expect(
      screen.getAllByText(/unsaved/i).length,
    ).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: /replace/i }));
    expect(newickBox().value).toBe(expected);
    expect(titleField().value).toBe("Test lab: dnadist chain");

    // The loaded lab is the new baseline — loading it again has
    // nothing unsaved to protect, so no question is asked.
    const sheet2 = openLabsSheet();
    clickLoadThisLab(sheet2);
    expect(screen.queryByText(/unsaved/i)).toBeNull();
    expect(newickBox().value).toBe(expected);
  });
});
