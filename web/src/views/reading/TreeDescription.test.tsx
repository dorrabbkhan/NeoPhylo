// TreeDescription tests (v1.4d plan Task 7, spec §7.3): the nested
// "Node P contains: …" text a screen reader walks instead of the SVG —
// visually hidden until the "Show as text" toggle opens it, and listing
// every tip exactly once. §21(p) (owner NVDA pass): the toggle controls
// the region, opening focuses the named region and closing returns
// focus to the toggle.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { ReadingTreeView } from "../../engine/generated/ReadingTreeView";

import { TreeDescription } from "./TreeDescription";

afterEach(cleanup);

/** ((a,(b,c)),(d,e)) with letters P=(b,c), Q=(a,b,c), R=(d,e), S=root. */
function makeView(): ReadingTreeView {
  return {
    root: 8,
    nodes: [
      { clade: ["a"], parent: 6, children: [], label: "a", letter: null, age: null },
      { clade: ["b"], parent: 5, children: [], label: "b", letter: null, age: null },
      { clade: ["c"], parent: 5, children: [], label: "c", letter: null, age: null },
      { clade: ["d"], parent: 7, children: [], label: "d", letter: null, age: null },
      { clade: ["e"], parent: 7, children: [], label: "e", letter: null, age: null },
      { clade: ["b", "c"], parent: 6, children: [1, 2], label: null, letter: "P", age: null },
      { clade: ["a", "b", "c"], parent: 8, children: [0, 5], label: null, letter: "Q", age: null },
      { clade: ["d", "e"], parent: 8, children: [3, 4], label: null, letter: "R", age: null },
      { clade: ["a", "b", "c", "d", "e"], parent: null, children: [6, 7], label: null, letter: "S", age: null },
    ],
    points: [],
    marks: [],
    traits: [],
    times: "none",
    unit: null,
  };
}

const PROPS = {
  view: makeView(),
  label: "Tree 1",
  regionId: "test-desc",
  textId: "test-desc-text",
};

describe("TreeDescription", () => {
  it("lists every tip exactly once as a nested list", () => {
    const { container } = render(<TreeDescription {...PROPS} />);
    const tips = Array.from(
      container.querySelectorAll(".rt-desc-tip"),
    ).map((el) => el.textContent);
    expect(tips.sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("names lettered nodes in their containing lines", () => {
    const { container } = render(<TreeDescription {...PROPS} />);
    const text = container.querySelector(".rt-desc")!.textContent!;
    for (const letter of ["P", "Q", "R", "S"]) {
      expect(text).toContain(`Node ${letter}`);
    }
    expect(text).toContain("contains");
  });

  it("names an unlettered internal node without listing its tips", () => {
    const view = makeView();
    view.nodes[5].letter = null;
    const { container } = render(
      <TreeDescription {...PROPS} view={view} />,
    );
    const tips = Array.from(
      container.querySelectorAll(".rt-desc-tip"),
    ).map((el) => el.textContent);
    expect(tips.sort()).toEqual(["a", "b", "c", "d", "e"]);
  });

  it("is visually hidden until the Show as text toggle opens it", () => {
    const { container } = render(<TreeDescription {...PROPS} />);
    const toggle = container.querySelector("button")!;
    expect(toggle.textContent).toMatch(/Show as text/);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    const desc = container.querySelector(".rt-desc")!;
    expect(desc.getAttribute("data-open")).toBeNull();

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(desc.getAttribute("data-open")).toBe("true");
  });

  it("names the description region and links the toggle to it", () => {
    const { container, getByRole } = render(
      <TreeDescription {...PROPS} />,
    );
    // The region is named like the figure — "Tree 1 as text" — and
    // the toggle controls it by id.
    const region = getByRole("region", { name: "Tree 1 as text" });
    const toggle = getByRole("button", { name: "Show as text" });
    expect(toggle.getAttribute("aria-controls")).toBe(region.id);
    // The list carries its own id — the svg's describedby target,
    // separate from the region so the region's name doesn't replace
    // the list text.
    expect(container.querySelector(`#${PROPS.textId}`)).toBe(
      region.querySelector("ul"),
    );
  });

  it("moves focus into the region on open and back to the toggle on close", () => {
    const { getByRole } = render(<TreeDescription {...PROPS} />);
    const toggle = getByRole("button", { name: "Show as text" });
    const region = getByRole("region", { name: "Tree 1 as text" });

    fireEvent.click(toggle);
    expect(document.activeElement).toBe(region);

    fireEvent.click(getByRole("button", { name: "Hide text" }));
    expect(document.activeElement).toBe(toggle);
  });
});
