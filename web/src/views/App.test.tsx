// App shell tests (plan Task 17, spec §6.1-6.3). These exercise the real
// pipeline: the wasm module is initialized in src/test/setup.ts and every
// render drives sim → dist → build → rf through the session reducer.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Exercise } from "../engine/generated/Exercise";
import { initialSession, reducer } from "../state/session";
import { App } from "./App";

afterEach(cleanup);

// Same content as src/lessons/default.ts (spec §7 example).
const NJ_BASICS: Exercise = {
  schema_version: 1,
  id: "nj-basics",
  title: "How Neighbor-Joining works",
  true_tree: "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
  sim: { model: "Jc69", length: 1000, seed: 42 },
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

const SIXTY: Exercise = {
  schema_version: 1,
  id: "sixty",
  title: "Sixty taxa",
  true_tree: caterpillar(60),
  sim: { model: "Jc69", length: 20, seed: 7 },
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
    fireEvent.keyDown(document.body, { key: "ArrowRight" });
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
