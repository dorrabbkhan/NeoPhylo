// Component tests for TreeView (plan Task 15). Tests run under jsdom with
// Testing Library (plan M3 preamble). Trees are hand-built arenas matching the
// `Tree` type emitted by neophylo-wasm — no wasm needed for view tests.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Tree } from "../engine/generated/Tree";

import { TreeView } from "./TreeView";

afterEach(cleanup);

/** ((A:1,B:2):1,C:3) as an arena: leaves 0-2, cherry 3, root 4. */
function makeTree(labels: [string, string, string] = ["A", "B", "C"], cLen = 3): Tree {
  return {
    rooted: true,
    root: 4,
    nodes: [
      { parent: 3, children: [], label: labels[0] },
      { parent: 3, children: [], label: labels[1] },
      { parent: 4, children: [], label: labels[2] },
      { parent: 4, children: [0, 1], label: null },
      { parent: null, children: [3, 2], label: null },
    ],
    branches: [{ length: 1 }, { length: 2 }, { length: cLen }, { length: 1 }, { length: null }],
  };
}

describe("TreeView", () => {
  it("renders one <text> per leaf", () => {
    const { container } = render(
      <TreeView
        tree={makeTree()}
        layoutKind="phylogram"
        highlight={new Set()}
        wrong={new Set()}
        clampNegative={false}
        title="Inferred tree"
      />,
    );
    expect(container.querySelectorAll("text")).toHaveLength(3);
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("img");
    expect(svg?.getAttribute("aria-label")).toBe("Inferred tree");
  });

  // Review Focus 2: labels must render as literal text, never as markup.
  it("renders a markup-like label as text", () => {
    const { container } = render(
      <TreeView
        tree={makeTree(["A", "B", "<b>x</b>"])}
        layoutKind="phylogram"
        highlight={new Set()}
        wrong={new Set()}
        clampNegative={false}
        title="True tree"
      />,
    );
    expect(container.querySelector("b")).toBeNull();
    const texts = [...container.querySelectorAll("text")].map((t) => t.textContent);
    expect(texts).toContain("<b>x</b>");
  });

  it("draws a negative branch with stroke-dasharray", () => {
    const { container } = render(
      <TreeView
        tree={makeTree(["A", "B", "C"], -1)}
        layoutKind="phylogram"
        highlight={new Set()}
        wrong={new Set()}
        clampNegative={true}
        title="Inferred tree"
      />,
    );
    const neg = container.querySelector(".negative");
    expect(neg).not.toBeNull();
    expect(neg?.getAttribute("stroke-dasharray")).not.toBeNull();
  });

  it("marks a highlighted node with data-highlight", () => {
    const { container } = render(
      <TreeView
        tree={makeTree()}
        layoutKind="phylogram"
        highlight={new Set([3])}
        wrong={new Set()}
        clampNegative={false}
        title="Inferred tree"
      />,
    );
    expect(container.querySelector('[data-highlight="true"]')).not.toBeNull();
  });
});
