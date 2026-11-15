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

/** Mount the grid controlled; `emitted` holds the last onChange arg. */
function mount(value: DistanceInput | null = null) {
  const emitted: { v: DistanceInput | null | undefined } = {
    v: undefined,
  };
  function Harness({ v }: { v: DistanceInput | null }) {
    const [cur, setCur] = useState<DistanceInput | null>(v);
    return (
      <MatrixGrid
        value={cur}
        onChange={(i) => {
          emitted.v = i;
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
    const remove = screen.getAllByRole("button", { name: /Remove taxon / });
    for (let k = 0; k < 27; k += 1) {
      fireEvent.click(
        screen.getAllByRole("button", { name: /Remove taxon / })[0],
      );
    }
    expect(screen.getAllByLabelText(/Taxon \d+ name/)).toHaveLength(3);
    screen
      .getAllByRole("button", { name: /Remove taxon / })
      .forEach((b) => expect(b).toHaveProperty("disabled", true));
    void remove;
  });

  it("labels each cell with both taxon names", () => {
    mount(wiki5);
    expect(cell("d", "c")).toHaveProperty("value", "8");
    expect(cell("e", "d")).toHaveProperty("value", "3");
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

  it("a committed matrix re-emits on a cell edit (editMatrix path)", () => {
    const { emitted } = mount(wiki5);
    fireEvent.change(cell("e", "d"), { target: { value: "4" } });
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

  it("removing a taxon emits null and arms Build tree", () => {
    const { emitted } = mount(wiki5);
    fireEvent.click(
      screen.getByRole("button", { name: "Remove taxon a" }),
    );
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
});
