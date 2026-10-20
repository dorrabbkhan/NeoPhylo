// Component tests for TreeView (plan Task 15). Tests run under jsdom with
// Testing Library (plan M3 preamble). Trees are hand-built arenas matching the
// `Tree` type emitted by neophylo-wasm — no wasm needed for view tests.

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Tree } from "../engine/generated/Tree";
import {
  leafFontSize,
  leafSpacingFor,
  labelRoomFor,
} from "../layout/treePanel";

import { TreeView } from "./TreeView";

afterEach(cleanup);

/** ((A:1,B:2):1,C:3) as an arena: leaves 0-2, cherry 3, root 4. */
function makeTree(
  labels: [string, string, string] = ["A", "B", "C"],
  cLen = 3,
): Tree {
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
    branches: [
      { length: 1, support: null },
      { length: 2, support: null },
      { length: cLen, support: null },
      { length: 1, support: null },
      { length: null, support: null },
    ],
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
    const texts = [...container.querySelectorAll("text")].map(
      (t) => t.textContent,
    );
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

// Bootstrap support labels (v1.2 plan Task 11, spec §6.3): internal
// branches carry `branches[id].support`, a fraction 0–1 drawn as
// Math.round(100·s). Terminal branches never carry support.
describe("support labels", () => {
  /** makeTree with a support value on the cherry branch (node 3). */
  function withSupport(s: number): Tree {
    const t = makeTree();
    t.branches[3].support = s;
    return t;
  }

  it("shows Math.round(100·s) on internal branches only", () => {
    const { container } = render(
      <TreeView
        tree={withSupport(0.874)}
        layoutKind="phylogram"
        highlight={new Set()}
        wrong={new Set()}
        clampNegative={false}
        title="Inferred tree"
      />,
    );
    const labels = container.querySelectorAll(".support-label");
    expect(labels).toHaveLength(1);
    expect(labels[0].textContent).toBe("87");
    // The label sits on node 3's branch group.
    expect(
      container.querySelector('g[data-node="3"] .support-label'),
    ).not.toBeNull();
    expect(
      container.querySelector('g[data-node="0"] .support-label'),
    ).toBeNull();
  });

  it("support below 50% gets a thinner stroke, data-weak and a marker glyph", () => {
    const { container } = render(
      <TreeView
        tree={withSupport(0.41)}
        layoutKind="phylogram"
        highlight={new Set()}
        wrong={new Set()}
        clampNegative={false}
        title="Inferred tree"
      />,
    );
    const g = container.querySelector('g[data-node="3"]');
    expect(g?.getAttribute("data-weak")).toBe("true");
    const line = g?.querySelector("line.branch");
    expect(Number(line?.getAttribute("stroke-width"))).toBeLessThan(1.5);
    expect(g?.querySelector(".weak-marker")).not.toBeNull();
    expect(
      container.querySelector('g[data-node="3"] .support-label')
        ?.textContent,
    ).toBe("41");
  });

  // The degree-2 root after a display reroot: the split's support lives
  // on the ingroup-side edge only (Task 5's single-placement rule), so
  // each grouping's label appears exactly once.
  it("labels each grouping exactly once on a rerooted degree-2 root", () => {
    const t: Tree = {
      rooted: true,
      root: 4,
      nodes: [
        { parent: 3, children: [], label: "A" },
        { parent: 3, children: [], label: "B" },
        { parent: 4, children: [], label: "C" },
        { parent: 4, children: [0, 1], label: null },
        { parent: null, children: [2, 3], label: null },
      ],
      branches: [
        { length: 0.5, support: null },
        { length: 0.5, support: null },
        // The outgroup-side edge of the root: support is None so the
        // split's value is never drawn twice (spec §3.7).
        { length: 0.25, support: null },
        { length: 0.25, support: 0.9 },
        { length: null, support: null },
      ],
    };
    const { container } = render(
      <TreeView
        tree={t}
        layoutKind="phylogram"
        highlight={new Set()}
        wrong={new Set()}
        clampNegative={false}
        title="Inferred tree"
      />,
    );
    const labels = Array.from(
      container.querySelectorAll(".support-label"),
    );
    expect(labels).toHaveLength(1);
    expect(labels[0].textContent).toBe("90");
    expect(
      container.querySelector('g[data-node="3"] .support-label'),
    ).not.toBeNull();
  });
});

describe("tree panel sizing", () => {
  // ResizeObserver is a no-op stub under jsdom (src/test/setup.ts), so
  // the geometry helpers are exercised directly.
  it("clamps leafSpacing to 48px for 5 leaves in a 300px panel", () => {
    expect(leafSpacingFor(300, 5)).toBe(48);
  });

  it("clamps leafSpacing to 18px for 40 leaves in a 300px panel", () => {
    expect(leafSpacingFor(300, 40)).toBe(18);
  });

  it("fills the panel between the clamps", () => {
    expect(leafSpacingFor(300, 10)).toBeCloseTo((300 - 16) / 10);
  });

  it("grows the label room with the longest label", () => {
    const font = leafFontSize(24);
    expect(labelRoomFor(["A", "B", "C"], font)).toBeLessThan(
      labelRoomFor(["A", "B", "very-long-taxon-name"], font),
    );
  });

  it("keeps leaf labels between 14 and 16px", () => {
    expect(leafFontSize(18)).toBe(14);
    expect(leafFontSize(48)).toBe(16);
  });
});
