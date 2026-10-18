// App shell tests (plan Task 17, spec §6.1-6.3). These exercise the real
// pipeline: the wasm module is initialized in src/test/setup.ts and every
// render drives sim → dist → build → rf through the session reducer.

import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Exercise } from "../engine/generated/Exercise";
import { initialSession, reducer } from "../state/session";
import { pressKey } from "../test/keys";
import { App } from "./App";

afterEach(cleanup);

// Same content as src/lessons/default.ts (spec §7 example).
const NJ_BASICS_TREE = "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);";
const NJ_BASICS: Exercise = {
  schema_version: 2,
  id: "nj-basics",
  title: "How Neighbor-Joining works",
  alphabet: "dna",
  data: {
    kind: "simulated",
    true_tree: NJ_BASICS_TREE,
    sim: { model: "Jc69", length: 1000, seed: 42 },
  },
  reference: { newick: NJ_BASICS_TREE, kind: "true" },
  analysis: { correction: "Jc69", method: "Nj" },
  locked: ["sim.model", "analysis.method"],
  prompts: [],
};

// Very short branches keep p distances small, so the 60-taxon run is a
// clean pipeline (no saturation) that simply lacks a trace.
function caterpillar(n: number): string {
  let s = "(t0:0.001,t1:0.001)";
  for (let i = 2; i < n; i++) s = `(${s}:0.001,t${i}:0.001)`;
  return `${s};`;
}

const SIXTY_TREE = caterpillar(60);
const SIXTY: Exercise = {
  schema_version: 2,
  id: "sixty",
  title: "Sixty taxa",
  alphabet: "dna",
  data: {
    kind: "simulated",
    true_tree: SIXTY_TREE,
    sim: { model: "Jc69", length: 20, seed: 7 },
  },
  reference: { newick: SIXTY_TREE, kind: "true" },
  analysis: { correction: "Jc69", method: "Nj" },
  locked: [],
  prompts: [],
};

/** The session App builds for `exercise`, computed independently in the test. */
function loaded(ex: Exercise) {
  return reducer(initialSession(ex), {
    type: "load",
    exercise: ex,
    source: "lesson",
  });
}

function svgByTitle(title: string): Element {
  const svg = document.querySelector(`svg[aria-label="${title}"]`);
  if (!svg) throw new Error(`svg "${title}" not found`);
  return svg;
}

const nodeCount = (svg: Element) => svg.querySelectorAll("[data-node]").length;

const cellTexts = (svg: Element) =>
  Array.from(svg.querySelectorAll('[role="gridcell"]')).map(
    (c) => c.textContent,
  );

describe("App shell", () => {
  it("loads the built-in lesson when no exercise is given", async () => {
    render(<App />);
    expect(await screen.findByRole("img", { name: "True tree" })).toBeTruthy();
    expect(
      await screen.findByRole("grid", { name: "Distance matrix" }),
    ).toBeTruthy();
  });

  it("shows only leaves at step 0 and reveals one internal node on →", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    expect(nodeCount(svgByTitle("Inferred tree"))).toBe(5);
    await pressKey("ArrowRight");
    expect(nodeCount(svgByTitle("Inferred tree"))).toBe(6);
  });

  it("sets the slider maximum to the trace length and shows step k of N", async () => {
    const s = loaded(NJ_BASICS);
    const trace = s.result!.trace!;
    const max =
      "Nj" in trace ? trace.Nj.steps.length + 1 : trace.Upgma.steps.length;
    render(<App exercise={NJ_BASICS} />);
    const slider = await screen.findByRole("slider");
    expect(slider.getAttribute("max")).toBe(String(max));
    expect(screen.getByText(`step 0 of ${max}`)).toBeTruthy();
  });

  it("shows RF = x / max once the final step is reached", async () => {
    const s = loaded(NJ_BASICS);
    const trace = s.result!.trace!;
    const max =
      "Nj" in trace ? trace.Nj.steps.length + 1 : trace.Upgma.steps.length;
    render(<App exercise={NJ_BASICS} />);
    const slider = await screen.findByRole("slider");
    fireEvent.change(slider, { target: { value: String(max) } });
    expect(screen.getByText(`step ${max} of ${max}`)).toBeTruthy();
    expect(screen.getByText(/RF = \d+ \/ \d+/)).toBeTruthy();
    // The heatmap shows the final join's own 3×3 matrix, labeled by
    // nodeName of the last three clusters.
    const grid = screen.getByRole("grid", { name: "Distance matrix" });
    expect(grid.getAttribute("aria-rowcount")).toBe("3");
    expect(grid.querySelectorAll('[role="row"]')).toHaveLength(3);
  });

  it("re-simulates on a new seed, changing the matrix in the DOM", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("grid", { name: "Distance matrix" });
    const before = cellTexts(svgByTitle("Distance matrix")).join("|");
    fireEvent.change(screen.getByLabelText("Seed"), {
      target: { value: "43" },
    });
    const after = cellTexts(svgByTitle("Distance matrix")).join("|");
    expect(after).not.toBe(before);
  });

  it("hides the stepper above 50 taxa with an explanation", async () => {
    render(<App exercise={SIXTY} />);
    expect(
      await screen.findByText("Step-through is available for 50 taxa or fewer"),
    ).toBeTruthy();
    expect(screen.queryByRole("slider")).toBeNull();
  });

  it("highlights leaves i and j in both trees while cell (i,j) is hovered", async () => {
    render(<App exercise={NJ_BASICS} />);
    const grid = await screen.findByRole("grid", { name: "Distance matrix" });
    fireEvent.mouseEnter(grid.querySelector('[data-i="0"][data-j="1"]')!);
    for (const title of ["Inferred tree", "True tree"]) {
      for (const id of [0, 1]) {
        const g = svgByTitle(title).querySelector(`g[data-node="${id}"]`);
        expect(g?.getAttribute("data-highlight")).toBe("true");
      }
    }
  });

  it("syncs the heatmap to the highlighted join (5 → 4 rows, u1 cluster)", async () => {
    // The built-in lesson is a 5-taxon NJ; the same sync is verified
    // against the Wikipedia worked example in stepMatrix.test.ts.
    render(<App exercise={NJ_BASICS} />);
    const grid = await screen.findByRole("grid", { name: "Distance matrix" });
    expect(grid.getAttribute("aria-rowcount")).toBe("5");
    expect(grid.querySelectorAll('[role="row"]')).toHaveLength(5);
    expect(grid.querySelector('[aria-selected="true"]')).not.toBeNull();

    await pressKey("ArrowRight");
    expect(grid.getAttribute("aria-rowcount")).toBe("4");
    const rows = Array.from(grid.querySelectorAll('[role="row"]'));
    expect(rows).toHaveLength(4);
    expect(rows.map((r) => r.querySelector("text")?.textContent)).toContain(
      "u1",
    );
  });

  it("shows the current step's Q values (3 decimals) with the Q toggle on", async () => {
    const s = loaded(NJ_BASICS);
    const trace = s.result!.trace!;
    if (!("Nj" in trace)) throw new Error("expected an NJ trace");
    const q = trace.Nj.steps[0].q;
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("grid", { name: "Distance matrix" });
    fireEvent.click(screen.getByRole("switch", { name: "Distance / Q" }));
    const grid = await screen.findByRole("grid", { name: "Q matrix" });
    cellTexts(grid).forEach((text, idx) => {
      const i = Math.floor(idx / q.n);
      const j = idx % q.n;
      expect(text).toContain(q.data[i * q.n + j].toFixed(3));
    });
  });
});

// An embedded protein exercise with a classification reference (v1.1
// spec §5.3): the protdist doc data, declared protein, correction JTT.
const CLASSIFY_TREE =
  "((Alpha:1,Delta:1):1,(Beta:1,(Gamma:1,Epsilon:1):1):1);";
const CLASSIFY: Exercise = {
  schema_version: 2,
  id: "cls",
  title: "Accepted classification",
  alphabet: "protein",
  data: {
    kind: "embedded",
    fasta:
      ">Alpha\nAACGTGGCCACAT\n>Beta\nAAGGTCGCCACAC\n>Gamma\n" +
      "CAGTTCGCCACAA\n>Delta\nGAGATTTCCGCCT\n>Epsilon\nGAGATCTCCGCCC",
    source: { citation: "test", license: "CC0", accessions: [] },
  },
  reference: { newick: CLASSIFY_TREE, kind: "classification" },
  analysis: { correction: "Jtt", method: "Nj" },
  locked: [],
  prompts: [],
};

describe("v1.1 alphabet badge and reference labels", () => {
  it("shows the DNA badge on a DNA lesson", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    expect(screen.getByText("DNA")).toBeTruthy();
  });

  it("shows the protein badge and the classification title", async () => {
    render(<App exercise={CLASSIFY} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    expect(screen.getByText("Protein · 20 amino acids")).toBeTruthy();
    // Spec §5.3: a classification reference is not titled "True tree".
    expect(
      screen.getByRole("img", {
        name: "Reference (accepted classification), not a known true tree",
      }),
    ).toBeTruthy();
  });

  it("replaces the RF readout with classification wording at the last step", async () => {
    const s = loaded(CLASSIFY);
    const trace = s.result!.trace!;
    const max =
      "Nj" in trace ? trace.Nj.steps.length + 1 : trace.Upgma.steps.length;
    render(<App exercise={CLASSIFY} />);
    const slider = await screen.findByRole("slider");
    fireEvent.change(slider, { target: { value: String(max) } });
    const n = s.rf!.missing_in_inferred.length;
    expect(
      screen.getByText(
        `differs from the accepted classification in ${n} clade${
          n === 1 ? "" : "s"
        }`,
      ),
    ).toBeTruthy();
  });

  it("overriding to DNA switches JTT to JC69 with a notice, no error", async () => {
    render(<App exercise={CLASSIFY} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    fireEvent.click(screen.getByRole("button", { name: "Treat as DNA" }));
    expect((await screen.findByRole("status")).textContent).toBe(
      "Switched correction to JC69 because this data is now DNA.",
    );
    expect(screen.getByText("DNA")).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    // The pipeline still produced a tree.
    expect(
      screen.getByRole("img", { name: "Inferred tree" }),
    ).toBeTruthy();
  });
});
