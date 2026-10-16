/// <reference types="node" />
// ExplanationPanel tests (plan Task 18, spec §6.2): the panel owns the
// global Concept/Math toggle (Session.mode) and announces step changes
// through an aria-live region. The Wikipedia 5-taxon NJ trace is built
// through the real engine.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { engine } from "../engine";
import type { Trace } from "../engine/generated/Trace";
import { nodeName } from "../state/names";

import { ExplanationPanel } from "./ExplanationPanel";

afterEach(cleanup);

// Vitest runs with cwd = web/, so fixtures live at ../fixtures.
function readRepoFile(rel: string): string {
  return readFileSync(resolve(`../${rel}`), "utf8");
}

const wiki = JSON.parse(readRepoFile("fixtures/worked/nj_wikipedia5.json")) as {
  labels: string[];
  matrix: { data: number[] };
};

const built = engine.buildTree(
  {
    labels: wiki.labels,
    model: "P",
    cells: wiki.matrix.data.map((v) => ({ Value: v })),
  },
  "Nj",
  { trace: true },
);
if (!built.ok || built.value.trace === null) {
  throw new Error("expected an NJ trace");
}
const trace: Trace = built.value.trace;
const labels = built.value.tree.nodes.map((_, id) =>
  nodeName(built.value.tree, id),
);

describe("ExplanationPanel", () => {
  it("shows the concept text inside an aria-live region", () => {
    render(
      <ExplanationPanel
        trace={trace}
        step={0}
        labels={labels}
        mode="concept"
        dispatch={vi.fn()}
      />,
    );
    const live = document.querySelector('[aria-live="polite"]');
    expect(live).not.toBeNull();
    expect(live!.textContent).toContain("a and b");
  });

  it("dispatches setMode from the global toggle", () => {
    const dispatch = vi.fn();
    render(
      <ExplanationPanel
        trace={trace}
        step={0}
        labels={labels}
        mode="concept"
        dispatch={dispatch}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Math" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "setMode", mode: "math" });
  });

  it("renders math lines as KaTeX in math mode", () => {
    render(
      <ExplanationPanel
        trace={trace}
        step={0}
        labels={labels}
        mode="math"
        dispatch={vi.fn()}
      />,
    );
    expect(document.querySelector(".katex")).not.toBeNull();
    expect(
      screen.getByText(
        "Values shown rounded; calculations use full precision.",
      ),
    ).toBeTruthy();
  });
});
