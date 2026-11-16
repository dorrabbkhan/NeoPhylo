// Component tests for the Distance-matrix tab (v1.4c spec §6.1;
// plan Task 8): paste ambiguities are answered one click at a time
// and re-parsed, never guessed; an asymmetric square offers the
// lower-triangle re-parse; a finished grid commit imports the matrix.

import { useState } from "react";

import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { engine } from "../../engine/index";
import type { Exercise } from "../../engine/generated/Exercise";
import type { Session } from "../../state/session";
import { initialSession, reducer } from "../../state/session";

import { MatrixImport } from "./MatrixImport";

afterEach(cleanup);

const NJ_BASICS: Exercise = {
  schema_version: 2,
  id: "nj-basics",
  title: "How Neighbor-Joining works",
  alphabet: "dna",
  data: {
    kind: "simulated",
    true_tree: "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
    sim: { model: "Jc69", length: 1000, seed: 42 },
  },
  reference: null,
  analysis: { correction: "Jc69", method: "Nj" },
  locked: [],
  prompts: [],
  bootstrap: null,
};

function sandbox(): Session {
  return reducer(initialSession(NJ_BASICS), {
    type: "load",
    exercise: NJ_BASICS,
    source: "sandbox",
  });
}

function mount(initial: Session = sandbox()) {
  const holder = { s: initial };
  function Harness() {
    const [s, setS] = useState(initial);
    holder.s = s;
    return (
      <MatrixImport session={s} dispatch={(a) => setS((c) => reducer(c, a))} />
    );
  }
  render(<Harness />);
  return holder;
}

function paste(text: string) {
  fireEvent.change(screen.getByLabelText("Paste a distance matrix"), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: "Import matrix" }));
}

describe("MatrixImport — paste", () => {
  it("a plain CSV paste asks DecimalComma once, then imports", () => {
    const holder = mount();
    paste("A,0,5,9\nB,5,0,10\nC,9,10,0");
    expect(
      screen.getByText("What does the comma mean?"),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Comma separates cells" }),
    );
    expect(holder.s.alignmentOrigin).toBe("matrix");
    expect(holder.s.matrixInput).toEqual({
      names: ["A", "B", "C"],
      lower: [5, 9, 10],
    });
    expect(holder.s.error).toBeNull();
  });

  it("a decimal-comma paste answers 'decimal mark' and keeps the values", () => {
    const holder = mount();
    paste("A 0\nB 0,25 0\nC 0,5 0,75 0");
    // Answer every question the engine asks, picking the decimal-mark
    // reading when offered.
    for (let k = 0; k < 3; k += 1) {
      const decimal = screen.queryByRole("button", {
        name: "Comma is a decimal mark",
      });
      const names = screen.queryByRole("button", {
        name: "First column holds names",
      });
      const headerData = screen.queryByRole("button", {
        name: "First row is data",
      });
      if (decimal !== null) fireEvent.click(decimal);
      else if (names !== null) fireEvent.click(names);
      else if (headerData !== null) fireEvent.click(headerData);
      else break;
    }
    expect(holder.s.alignmentOrigin).toBe("matrix");
    expect(holder.s.matrixInput?.lower).toEqual([0.25, 0.5, 0.75]);
  });

  it("a tab-separated paste with spaced names parses without a question", () => {
    const holder = mount();
    paste(
      "Homo sapiens\t0\nMus musculus\t0.25\t0\nRattus norvegicus\t0.5\t0.75\t0",
    );
    expect(
      screen.queryByRole("group", { name: "Matrix question" }),
    ).toBeNull();
    expect(holder.s.matrixInput?.names).toEqual([
      "Homo sapiens",
      "Mus musculus",
      "Rattus norvegicus",
    ]);
  });

  it("a PHYLIP paste imports straight through detection", () => {
    const holder = mount();
    paste("3\na\nb  5\nc  9  10\n");
    expect(holder.s.alignmentOrigin).toBe("matrix");
    expect(holder.s.matrixInput?.lower).toEqual([5, 9, 10]);
  });

  // The e2e header-row paste, pinned through the real engine wrapper
  // (fix round 1): a tab-separated square whose first row repeats the
  // first column's names is UNAMBIGUOUS — no MatrixAmbiguous is
  // raised, so the question group never renders and the e2e asserts
  // the same path unconditionally.
  it("the tab-separated header paste parses without asking (engine pin)", () => {
    const text =
      "\ta\tb\tc\n" + "a\t0\t5\t9\n" + "b\t5\t0\t10\n" + "c\t9\t10\t0\n";
    // Detection refuses it (no file header) — parse_pasted_matrix is
    // the path MatrixImport takes.
    const det = engine.detectMatrixFormat(text);
    expect(det.ok && det.value === null).toBe(true);
    const r = engine.parsePastedMatrix(text, {
      first_column_names: null,
      header_row: null,
      decimal_comma: null,
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.matrix.names).toEqual(["a", "b", "c"]);
      expect(r.value.matrix.lower).toEqual([5, 9, 10]);
    }
    // Same through the component: no question, imported matrix.
    const holder = mount();
    paste(text);
    expect(
      screen.queryByRole("group", { name: "Matrix question" }),
    ).toBeNull();
    expect(holder.s.matrixInput?.names).toEqual(["a", "b", "c"]);
    expect(holder.s.matrixInput?.lower).toEqual([5, 9, 10]);
  });
});

describe("MatrixImport — asymmetric square", () => {
  const ASYM = "3\na  0 5 9\nb  6 0 10\nc  9 10 0\n";

  it("offers the lower triangle and re-parses with it", () => {
    const holder = mount();
    paste(ASYM);
    expect(screen.getByText(/not symmetric/)).toBeTruthy();
    fireEvent.click(
      screen.getByRole("button", { name: "Use the lower triangle" }),
    );
    expect(holder.s.alignmentOrigin).toBe("matrix");
    expect(holder.s.matrixInput?.lower).toEqual([6, 9, 10]);
    expect(screen.getByText(/used the lower triangle/)).toBeTruthy();
  });
});

describe("MatrixImport — grid wiring", () => {
  /** Open the lazy "Type a matrix…" sheet and fill every cell. */
  async function openSheetAndFill() {
    fireEvent.click(
      screen.getByRole("button", { name: "Type a matrix…" }),
    );
    // The sheet is a lazy chunk — findBy, not getBy.
    await screen.findByLabelText("Distance between B and A");
    for (const [r, c] of [
      ["B", "A"], ["C", "A"], ["C", "B"],
      ["D", "A"], ["D", "B"], ["D", "C"],
      ["E", "A"], ["E", "B"], ["E", "C"], ["E", "D"],
    ]) {
      fireEvent.change(
        screen.getByLabelText(`Distance between ${r} and ${c}`),
        { target: { value: "1" } },
      );
    }
  }

  it("a finished grid commits through importMatrix", async () => {
    const holder = mount();
    await openSheetAndFill();
    fireEvent.click(screen.getByRole("button", { name: "Build tree" }));
    expect(holder.s.alignmentOrigin).toBe("matrix");
    expect(holder.s.matrixInput?.names).toEqual(["A", "B", "C", "D", "E"]);
    expect(holder.s.matrix).not.toBeNull();
    expect(holder.s.result).not.toBeNull();
  });

  it("a mid-session clear returns to 'complete the matrix'; Build rebuilds (fix round 2)", async () => {
    const holder = mount();
    await openSheetAndFill();
    fireEvent.click(screen.getByRole("button", { name: "Build tree" }));
    expect(holder.s.result).not.toBeNull();
    // Clearing one cell edits the session back to incomplete.
    fireEvent.change(screen.getByLabelText("Distance between C and B"), {
      target: { value: "" },
    });
    expect(holder.s.matrixInput).toBeNull();
    expect(holder.s.result).toBeNull();
    expect(holder.s.alignmentOrigin).toBe("matrix");
    // Refill stays uncommitted — Build tree rebuilds at step 0.
    fireEvent.change(screen.getByLabelText("Distance between C and B"), {
      target: { value: "2" },
    });
    expect(holder.s.result).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Build tree" }));
    expect(holder.s.result).not.toBeNull();
    expect(holder.s.matrixInput?.lower).toEqual([1, 1, 2, 1, 1, 1, 1, 1, 1, 1]);
  });

  it("a close hides the sheet but keeps the typed draft (fix round 2)", async () => {
    mount();
    await openSheetAndFill();
    // Esc closes: the sheet hides (it stays mounted — the draft is
    // grid state an unmount would destroy).
    const dialog = screen.getByRole("dialog", { name: "Distance matrix" });
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(
      screen.queryByRole("dialog", { name: "Distance matrix" }),
    ).toBeNull();
    // Reopen: the typed values are still there.
    fireEvent.click(
      screen.getByRole("button", { name: "Type a matrix…" }),
    );
    expect(
      screen.getByLabelText("Distance between E and D"),
    ).toHaveProperty("value", "1");
  });
});
