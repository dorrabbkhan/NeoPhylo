// Component tests for the typing grid (v1.4c spec §6.1, §8.3; plan
// Task 8): a real <table> lower triangle, 3–30 taxa, labelled cells,
// arrow-key navigation, one aria-live region for messages, and the
// emit contract — null while empty/invalid or structure-pending, a
// DistanceInput on committed edits and Build tree.

import { useState } from "react";

import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { DistanceInput } from "../../engine/generated/DistanceInput";

import { MatrixGrid } from "./MatrixGrid";

afterEach(cleanup);

/** Mount the grid controlled; `emitted` holds the last onChange args. */
function mount(value: DistanceInput | null = null) {
  const emitted: {
    v: DistanceInput | null | undefined;
    ready: boolean | undefined;
  } = {
    v: undefined,
    ready: undefined,
  };
  function Harness({ v }: { v: DistanceInput | null }) {
    const [cur, setCur] = useState<DistanceInput | null>(v);
    return (
      <MatrixGrid
        value={cur}
        onChange={(i, draftReady) => {
          emitted.v = i;
          emitted.ready = draftReady;
          setCur(i);
        }}
      />
    );
  }
  const r = render(<Harness v={value} />);
  return { emitted, rerender: r.rerender };
}

const wiki5: DistanceInput = {
  names: ["a", "b", "c", "d", "e"],
  lower: [5, 9, 10, 9, 10, 8, 8, 9, 7, 3],
};

function cell(row: string, col: string) {
  return screen.getByLabelText(`Distance between ${row} and ${col}`);
}

describe("MatrixGrid — shape", () => {
  it("starts at 5 taxa A–E with empty cells and a disabled Build tree", () => {
    mount();
    expect(screen.getByLabelText("Taxon 1 name")).toHaveProperty("value", "A");
    expect(screen.getByLabelText("Taxon 5 name")).toHaveProperty("value", "E");
    const build = screen.getByRole("button", { name: "Build tree" });
    expect(build).toHaveProperty("disabled", true);
    expect(screen.getByText(/cells still empty/)).toBeTruthy();
    // 10 cells for 5 taxa.
    expect(
      screen.getAllByLabelText(/Distance between /).length,
    ).toBe(10);
    expect(cell("B", "A")).toBeTruthy();
  });

  it("refuses a 31st taxon and removal below 3", () => {
    mount();
    const add = screen.getByRole("button", { name: "Add taxon" });
    for (let k = 0; k < 25; k += 1) fireEvent.click(add);
    expect(screen.getAllByLabelText(/Taxon \d+ name/)).toHaveLength(30);
    expect(add).toHaveProperty("disabled", true);
    // The one remove control (fix round 2): the select tracks the
    // first taxon, each click removes it.
    const remove = screen.getByRole("button", { name: "Remove taxon" });
    for (let k = 0; k < 27; k += 1) fireEvent.click(remove);
    expect(screen.getAllByLabelText(/Taxon \d+ name/)).toHaveLength(3);
    expect(remove).toHaveProperty("disabled", true);
    expect(screen.getByLabelText("Taxon to remove")).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("labels each cell with both taxon names", () => {
    mount(wiki5);
    expect(cell("d", "c")).toHaveProperty("value", "8");
    expect(cell("e", "d")).toHaveProperty("value", "3");
  });

  it("shows the one caption line above the grid, tied with aria-describedby (round-4 N2)", () => {
    mount();
    // The caption and the row-1 hint merged into one line (round-4
    // N2): it is the table's label and its description.
    const captions = screen.getAllByText(/Lower triangle of the distance matrix/);
    expect(captions).toHaveLength(1);
    const caption = captions[0];
    expect(caption.textContent).toMatch(/the first row is just a name\./);
    const table = document.querySelector("table.matrix-grid");
    expect(table?.getAttribute("aria-labelledby")).toBe(caption.id);
    expect(table?.getAttribute("aria-describedby")).toBe(caption.id);
    // The caption carries no numbers.
    expect(caption.textContent).not.toMatch(/\d/);
  });
});

describe("MatrixGrid — emits", () => {
  it("emits null while a cell is empty or invalid, then the input on Build tree", () => {
    const { emitted } = mount();
    fireEvent.change(cell("B", "A"), { target: { value: "5" } });
    expect(emitted.v).toBeNull();
    // Fill every remaining cell with 1.
    for (const [r, c] of [
      ["C", "A"], ["C", "B"],
      ["D", "A"], ["D", "B"], ["D", "C"],
      ["E", "A"], ["E", "B"], ["E", "C"], ["E", "D"],
    ]) {
      fireEvent.change(cell(r, c), { target: { value: "1" } });
    }
    // Complete, but structure-pending: no emit until Build tree.
    expect(emitted.v).toBeNull();
    const build = screen.getByRole("button", { name: "Build tree" });
    expect(build).toHaveProperty("disabled", false);
    fireEvent.click(build);
    expect(emitted.v).toEqual({
      names: ["A", "B", "C", "D", "E"],
      lower: [5, 1, 1, 1, 1, 1, 1, 1, 1, 1],
    });
  });

  it("marks a non-numeric cell invalid and names it in the live region", () => {
    mount(wiki5);
    const c = cell("b", "a");
    fireEvent.change(c, { target: { value: "x" } });
    expect(c.getAttribute("aria-invalid")).toBe("true");
    expect(screen.getByText("d(b, a) must be a number ≥ 0.")).toBeTruthy();
  });

  it("a cell edit on a committed matrix emits null until Build (fix round 2)", () => {
    const { emitted } = mount(wiki5);
    fireEvent.change(cell("e", "d"), { target: { value: "4" } });
    // The draft is uncommitted — the session drops to
    // "complete the matrix" and the hint explains the rebuild.
    expect(emitted.v).toBeNull();
    expect(
      screen.getByText("The matrix changed — press Build tree to rebuild."),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Build tree" }));
    expect(emitted.v).toEqual({
      names: wiki5.names,
      lower: [5, 9, 10, 9, 10, 8, 8, 9, 7, 4],
    });
  });

  it("clearing a cell on a committed matrix emits null (complete-the-matrix)", () => {
    const { emitted } = mount(wiki5);
    fireEvent.change(cell("c", "b"), { target: { value: "" } });
    expect(emitted.v).toBeNull();
    expect(
      screen.getByRole("button", { name: "Build tree" }),
    ).toHaveProperty("disabled", true);
  });

  // `draftReady` (v1.4c Task 9): the flag beside every null emit tells
  // the session whether the unbuilt draft is complete and valid — the
  // empty-state line's "Press Build tree" vs "Complete the matrix".
  it("editing a cell of a complete grid emits null with draftReady true", () => {
    const { emitted } = mount(wiki5);
    fireEvent.change(cell("e", "d"), { target: { value: "4" } });
    expect(emitted.v).toBeNull();
    expect(emitted.ready).toBe(true);
  });

  it("clearing a cell emits null with draftReady false", () => {
    const { emitted } = mount(wiki5);
    fireEvent.change(cell("c", "b"), { target: { value: "" } });
    expect(emitted.v).toBeNull();
    expect(emitted.ready).toBe(false);
  });

  it("removing a taxon emits null and arms Build tree", () => {
    const { emitted } = mount(wiki5);
    // Pick "a" in the remove select, then the one Remove button.
    fireEvent.change(screen.getByLabelText("Taxon to remove"), {
      target: { value: "0" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove taxon" }));
    expect(emitted.v).toBeNull();
    // b–e remain with their mutual distances intact.
    expect(cell("e", "d")).toHaveProperty("value", "3");
    // Remaining cells are complete but pending: Build is enabled.
    const build = screen.getByRole("button", { name: "Build tree" });
    expect(build).toHaveProperty("disabled", false);
    fireEvent.click(build);
    expect(emitted.v).toEqual({
      names: ["b", "c", "d", "e"],
      lower: [10, 10, 8, 9, 7, 3],
    });
  });

  it("adding a taxon emits null; the new empty row holds Build disabled", () => {
    const { emitted } = mount(wiki5);
    fireEvent.click(screen.getByRole("button", { name: "Add taxon" }));
    expect(emitted.v).toBeNull();
    // a–e continue the letter case.
    expect(screen.getByLabelText("Taxon 6 name")).toHaveProperty(
      "value",
      "f",
    );
    expect(
      screen.getByRole("button", { name: "Build tree" }),
    ).toHaveProperty("disabled", true);
    expect(screen.getByText(/cells still empty/)).toBeTruthy();
  });

  it("shows the engine's structural message for a duplicate name", () => {
    mount(wiki5);
    fireEvent.change(screen.getByLabelText("Taxon 2 name"), {
      target: { value: "a" },
    });
    expect(screen.getByText(/share the name 'a'/)).toBeTruthy();
  });
});

describe("MatrixGrid — the rebuild hint (fix round 2)", () => {
  const HINT = "The matrix changed — press Build tree to rebuild.";

  /** Fill all 10 cells of a fresh grid and click Build tree. */
  function fillAndBuild() {
    for (const [r, c] of [
      ["B", "A"], ["C", "A"], ["C", "B"],
      ["D", "A"], ["D", "B"], ["D", "C"],
      ["E", "A"], ["E", "B"], ["E", "C"], ["E", "D"],
    ]) {
      fireEvent.change(cell(r, c), { target: { value: "1" } });
    }
    fireEvent.click(screen.getByRole("button", { name: "Build tree" }));
  }

  it("a fresh grid's first fill shows no hint — nothing was built yet", () => {
    mount();
    for (const [r, c] of [
      ["B", "A"], ["C", "A"], ["C", "B"],
      ["D", "A"], ["D", "B"], ["D", "C"],
      ["E", "A"], ["E", "B"], ["E", "C"], ["E", "D"],
    ]) {
      fireEvent.change(cell(r, c), { target: { value: "1" } });
    }
    expect(screen.queryByText(HINT)).toBeNull();
    expect(screen.queryByText(/press Build tree/)).toBeNull();
    expect(
      screen.getByRole("button", { name: "Build tree" }),
    ).toHaveProperty("disabled", false);
  });

  it("build, then edit a value → the hint names what changed", () => {
    mount();
    fillAndBuild();
    expect(screen.queryByText(HINT)).toBeNull();
    fireEvent.change(cell("E", "D"), { target: { value: "2" } });
    expect(screen.getByText(HINT)).toBeTruthy();
    // Reverting to the built values clears the hint again.
    fireEvent.change(cell("E", "D"), { target: { value: "1" } });
    expect(screen.queryByText(HINT)).toBeNull();
  });

  it("build, then remove a taxon → the hint shows", () => {
    mount();
    fillAndBuild();
    fireEvent.click(screen.getByRole("button", { name: "Remove taxon" }));
    expect(screen.getByText(HINT)).toBeTruthy();
  });

  it("build, then add a taxon → the hint shows beside the empty-cell reason", () => {
    mount();
    fillAndBuild();
    fireEvent.click(screen.getByRole("button", { name: "Add taxon" }));
    expect(screen.getByText(HINT)).toBeTruthy();
    expect(screen.getByText(/cells still empty/)).toBeTruthy();
  });

  it("a seeded (imported) matrix counts as built: removing a taxon shows the hint", () => {
    mount(wiki5);
    fireEvent.click(screen.getByRole("button", { name: "Remove taxon" }));
    expect(screen.getByText(HINT)).toBeTruthy();
  });
});

describe("MatrixGrid — keyboard", () => {
  it("arrow keys move between cells, names and rows", () => {
    mount(wiki5);
    const start = cell("c", "b");
    start.focus();
    fireEvent.keyDown(start, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cell("c", "a"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(screen.getByLabelText("Taxon 3 name"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(screen.getByLabelText("Taxon 4 name"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cell("d", "a"));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell("e", "a"));
  });
});

describe("MatrixGrid — reseed", () => {
  it("adopts a committed value it did not emit (import, another grid)", () => {
    const { rerender } = render(
      <MatrixGrid value={wiki5} onChange={() => {}} />,
    );
    const other: DistanceInput = {
      names: ["x", "y", "z"],
      lower: [2, 3, 4],
    };
    rerender(<MatrixGrid value={other} onChange={() => {}} />);
    expect(screen.getByLabelText("Taxon 1 name")).toHaveProperty("value", "x");
    expect(cell("z", "y")).toHaveProperty("value", "4");
  });

  it("keeps typed text when its own null emit round-trips", () => {
    const { emitted } = mount(wiki5);
    fireEvent.change(cell("c", "b"), { target: { value: "" } });
    expect(emitted.v).toBeNull();
    // The cleared text stays cleared; every other cell keeps its text.
    expect(cell("c", "b")).toHaveProperty("value", "");
    expect(cell("e", "d")).toHaveProperty("value", "3");
  });

  it("an echo of the grid's own null emit never resets in-progress edits", () => {
    const { emitted } = mount(wiki5);
    // Half-typed text that already parses: "4." emits null like every
    // uncommitted change (fix round 2) and the parent echoes null
    // straight back. The echo must not reseed the cell — the typing
    // stays verbatim.
    fireEvent.change(cell("e", "d"), { target: { value: "4." } });
    expect(emitted.v).toBeNull();
    expect(cell("e", "d")).toHaveProperty("value", "4.");
  });

  it("a new committed value reseeds, replacing in-progress edits", () => {
    const { rerender } = render(
      <MatrixGrid value={wiki5} onChange={() => {}} />,
    );
    fireEvent.change(cell("e", "d"), { target: { value: "4." } });
    const incoming: DistanceInput = {
      names: ["x", "y", "z"],
      lower: [2, 3, 4],
    };
    rerender(<MatrixGrid value={incoming} onChange={() => {}} />);
    // The 5-taxon grid and its half-typed text are gone; the new
    // matrix's names and distances are the draft now.
    expect(screen.getByLabelText("Taxon 1 name")).toHaveProperty("value", "x");
    expect(screen.getByLabelText("Taxon 3 name")).toHaveProperty("value", "z");
    expect(cell("z", "y")).toHaveProperty("value", "4");
    expect(
      screen.getAllByLabelText(/Distance between /),
    ).toHaveLength(3);
    // A reseeded committed matrix needs no rebuild — the live region
    // carries no empty-cell reason.
    expect(screen.queryByText(/cells still empty/)).toBeNull();
  });
});
