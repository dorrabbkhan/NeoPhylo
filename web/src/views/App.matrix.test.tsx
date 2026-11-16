// App-level matrix-session smoke tests (v1.4c spec §6.2; plan Task 8,
// View safety): every view must be safe with `alignment: null`. The
// alignment-only panels — simulation body, model menu, gap control,
// pair panel, saturation chart, bootstrap panel — are replaced by ONE
// line, and the alphabet badge reads "Distance matrix".

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Exercise } from "../engine/generated/Exercise";
import type { Method } from "../engine/generated/Method";

import { App } from "./App";

afterEach(cleanup);

const matrixExercise = (method: Method, names: string[], lower: number[]): Exercise => ({
  schema_version: 5,
  id: "matrix-test",
  title: "Matrix test",
  alphabet: "dna",
  data: {
    kind: "matrix",
    names,
    lower,
    source: { citation: "", license: "", accessions: [] },
  },
  reference: null,
  analysis: { correction: "Supplied", method },
  locked: [],
  prompts: [],
  bootstrap: null,
});

const WIKI5 = {
  names: ["a", "b", "c", "d", "e"],
  lower: [5, 9, 10, 9, 10, 8, 8, 9, 7, 3],
};

/** fixtures/inputs/matrix/nonadditive6.phy — NJ produces a negative
 * branch (paired reference assertion in the wasm parity tests). */
const NONADD6 = {
  names: ["a", "b", "c", "d", "e", "f"],
  lower: [17, 35, 36, 9, 2, 34, 23, 30, 18, 28, 19, 18, 28, 18, 22],
};

const REPLACEMENT =
  "This tree was built from a distance matrix, so there are no sequences to compare or resample.";

/** The alignment-only controls the matrix session must hide. */
const HIDDEN = [
  "Simulation model",
  "Distance correction",
  "Pairwise deletion",
];

describe("App — matrix session", () => {
  it.each(["Nj", "Upgma"] as const)(
    "a %s matrix exercise renders safely at the final step, alignment panels hidden",
    async (method) => {
      render(
        <App exercise={matrixExercise(method, WIKI5.names, WIKI5.lower)} />,
      );
      await screen.findByRole("img", { name: "Inferred tree" });
      // Distance matrix badge, no alphabet badge or override.
      expect(
        document.querySelector(".alphabet-badge-label")?.textContent,
      ).toBe("Distance matrix");
      expect(screen.queryByText(/^DNA$/)).toBeNull();
      // The one replacement line — a lazy chunk (fix round 1).
      expect(await screen.findByText(REPLACEMENT)).toBeTruthy();
      for (const label of HIDDEN) {
        expect(screen.queryByLabelText(label)).toBeNull();
      }
      expect(screen.queryByText("Gap treatment")).toBeNull();
      expect(
        screen.queryByRole("region", { name: "How sure are we?" }),
      ).toBeNull();
      // The grid ISN'T the only matrix surface: the distance heatmap
      // and method control still work.
      expect(
        screen.getByRole("grid", { name: "Distance matrix" }),
      ).toBeTruthy();
      // Drive to the final step, still safe.
      const slider = await screen.findByRole("slider");
      const max = Number(slider.getAttribute("max"));
      fireEvent.change(slider, { target: { value: String(max) } });
      expect(await screen.findByText(REPLACEMENT)).toBeTruthy();
      // Bootstrap is impossible without an alignment — the consensus
      // strip and its empty state never render (fix round 1).
      expect(
        screen.queryByRole("tablist", { name: "Bootstrap tree views" }),
      ).toBeNull();
      expect(
        screen.queryByText("Available after a bootstrap run."),
      ).toBeNull();
    },
  );

  it("a sandbox matrix import lands the same session shape", async () => {
    render(
      <App
        exercise={{
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
        }}
      />,
    );
    fireEvent.click(await screen.findByRole("radio", { name: "Sandbox" }));
    // The import panel is a lazy chunk (fix round 1) — findBy.
    fireEvent.click(
      await screen.findByRole("tab", { name: "Distance matrix" }),
    );
    const area = await screen.findByLabelText("Paste a distance matrix");
    fireEvent.change(area, {
      target: { value: "5\na\nb  5\nc  9  10\nd  9  10  8\ne  8  9  7  3\n" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import matrix" }));
    await screen.findByRole("img", { name: "Inferred tree" });
    expect(
      document.querySelector(".alphabet-badge-label")?.textContent,
    ).toBe("Distance matrix");
    expect(await screen.findByText(REPLACEMENT)).toBeTruthy();
  });

  it("the negative-branch notice gains the matrix sentence only in a matrix session", async () => {
    render(
      <App
        exercise={matrixExercise("Nj", NONADD6.names, NONADD6.lower)}
      />,
    );
    const notice = await screen.findByText(/negative branch length/);
    expect(notice.textContent).toContain(
      "This matrix is not perfectly tree-like.",
    );
    // The clamp control is unchanged.
    expect(
      screen.getByLabelText(/negative branch/i),
    ).toBeTruthy();
  });
});
