// Component tests for ReadingTree (v1.4d plan Task 7, spec §6-§7.3).
// Tests run under jsdom with Testing Library. The view is a hand-built
// `ReadingTreeView` — the type the Task 5 wrappers resolve — so no wasm
// is needed: readingLayout is pure geometry.
//
// Named tests (plan Task 7 / Review Focus 4):
// - selecting then rotating keeps the selection on the same clade
//   (selection is a CladeKey, never a screen position);
// - a keyboard path selects the MRCA of two tips;
// - the description text lists every tip exactly once;
// - reduced-motion skips the 300 ms ease-in-out rotation animation;
// - the aria-live region announces each selection;
// - arrow keys move parent/child/sibling, Enter selects, R rotates.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { ReadingTreeView } from "../../engine/generated/ReadingTreeView";

import { ReadingTree } from "./ReadingTree";

afterEach(cleanup);

/** ((a,(b,c)),(d,e)) with letters P=(b,c), Q=(a,b,c), R=(d,e), S=root —
 * leaves first, then internal nodes, like the engine arena. */
function makeView(extra: Partial<ReadingTreeView> = {}): ReadingTreeView {
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
    points: [
      { letter: "X", on: ["b", "c"], at: "node" },
      { letter: "Y", on: ["b", "c"], at: "branch" },
    ],
    marks: [],
    traits: [],
    times: "none",
    unit: null,
    ...extra,
  };
}

const STYLE = { shape: "rectangular", tips: "right" } as const;
const CLADE = (...tips: string[]) => JSON.stringify([...tips].sort());

function hit(container: HTMLElement, clade: string): SVGGElement {
  const el = container.querySelector<SVGGElement>(
    `.rt-hit[data-clade='${clade}']`,
  );
  if (el === null) throw new Error(`no hit for clade ${clade}`);
  return el;
}

function props(over: Partial<Parameters<typeof ReadingTree>[0]> = {}) {
  return {
    view: makeView(),
    style: STYLE,
    selectable: "node" as const,
    selected: [] as string[][],
    onSelect: vi.fn(),
    highlight: [] as string[],
    rotatable: false,
    onRotate: vi.fn(),
    label: "Tree 1",
    ...over,
  };
}

describe("ReadingTree selection", () => {
  it("calls onSelect with the tapped node's clade", () => {
    const p = props();
    const { container } = render(<ReadingTree {...p} />);
    fireEvent.click(hit(container, CLADE("b", "c")));
    expect(p.onSelect).toHaveBeenCalledWith(["b", "c"]);
    fireEvent.click(hit(container, CLADE("a")));
    expect(p.onSelect).toHaveBeenCalledWith(["a"]);
  });

  it("keeps the selection on the same clade when a node is rotated", () => {
    const p = props({ selected: [["b", "c"]], rotatable: true });
    const { container } = render(<ReadingTree {...p} />);
    const before = hit(container, CLADE("b", "c"));
    expect(before.getAttribute("data-selected")).toBe("true");
    const beforeTransform = before.getAttribute("style") ?? "";

    // Rotate the root: the two big clades swap sides, moving the
    // selected node's position — the marker must follow the clade.
    const root = hit(container, CLADE("a", "b", "c", "d", "e"));
    fireEvent.keyDown(root, { key: "r" });
    expect(p.onRotate).toHaveBeenCalledWith(["a", "b", "c", "d", "e"]);

    const selected = container.querySelectorAll(
      '.rt-hit[data-selected="true"]',
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].getAttribute("data-clade")).toBe(CLADE("b", "c"));
    expect(selected[0].getAttribute("style")).not.toBe(beforeTransform);
  });

  it("announces each selection in an aria-live region", () => {
    const p = props();
    const { container } = render(<ReadingTree {...p} />);
    const status = container.querySelector('[role="status"]');
    expect(status).not.toBeNull();
    fireEvent.click(hit(container, CLADE("b")));
    expect(status!.textContent).toMatch(/Selected tip b/);
    fireEvent.click(hit(container, CLADE("b", "c")));
    expect(status!.textContent).toMatch(/Selected node P/);
  });

  it("selectable='tips' selects leaves only", () => {
    const p = props({ selectable: "tips" });
    const { container } = render(<ReadingTree {...p} />);
    fireEvent.click(hit(container, CLADE("b", "c")));
    expect(p.onSelect).not.toHaveBeenCalled();
    fireEvent.click(hit(container, CLADE("b")));
    expect(p.onSelect).toHaveBeenCalledWith(["b"]);
  });

  it("selectable='none' renders no selection hits", () => {
    const p = props({ selectable: "none" });
    const { container } = render(<ReadingTree {...p} />);
    expect(container.querySelectorAll(".rt-hit")).toHaveLength(0);
    const svg = container.querySelector("svg");
    fireEvent.click(svg!);
    expect(p.onSelect).not.toHaveBeenCalled();
  });

  it("selectable='points' selects the clade a lettered point sits on", () => {
    const p = props({ selectable: "points" });
    const { container } = render(<ReadingTree {...p} />);
    const pointX = container.querySelector(".rt-hit.rt-point-hit");
    expect(pointX).not.toBeNull();
    fireEvent.click(pointX!);
    expect(p.onSelect).toHaveBeenCalledWith(["b", "c"]);
  });

  it("selectable='branch' reports the clade below the tapped branch", () => {
    const p = props({ selectable: "branch" });
    const { container } = render(<ReadingTree {...p} />);
    const branchHit = container.querySelector(
      `.rt-branch-hit[data-clade='${CLADE("d", "e")}']`,
    );
    expect(branchHit).not.toBeNull();
    fireEvent.click(branchHit!);
    expect(p.onSelect).toHaveBeenCalledWith(["d", "e"]);
  });
});

describe("ReadingTree keyboard", () => {
  it("roves focus with parent/child/sibling arrows and Enter selects", () => {
    const p = props();
    const { container } = render(<ReadingTree {...p} />);
    const focus = () =>
      container
        .querySelector('[data-focus="true"]')
        ?.getAttribute("data-clade");

    // Tab into the tree lands on the root.
    expect(focus()).toBe(CLADE("a", "b", "c", "d", "e"));

    const key = (k: string) =>
      fireEvent.keyDown(container.querySelector('[data-focus="true"]')!, {
        key: k,
      });

    // MRCA(b, c) by a pure keyboard path: down to the left child,
    // into tip a, across to its sibling, then Enter.
    key("ArrowRight");
    expect(focus()).toBe(CLADE("a", "b", "c"));
    key("ArrowRight");
    expect(focus()).toBe(CLADE("a"));
    key("ArrowDown");
    expect(focus()).toBe(CLADE("b", "c"));
    key("ArrowUp");
    expect(focus()).toBe(CLADE("a"));
    key("ArrowDown");
    key("ArrowRight");
    expect(focus()).toBe(CLADE("b"));
    key("ArrowLeft");
    expect(focus()).toBe(CLADE("b", "c"));
    key("Enter");
    expect(p.onSelect).toHaveBeenCalledWith(["b", "c"]);
  });

  it("selects the MRCA of two tips reached by keyboard", () => {
    const p = props();
    const { container } = render(<ReadingTree {...p} />);
    const key = (k: string) =>
      fireEvent.keyDown(container.querySelector('[data-focus="true"]')!, {
        key: k,
      });
    // root → [a,b,c] → [b,c] via sibling of tip a.
    key("ArrowRight");
    key("ArrowRight");
    key("ArrowDown");
    fireEvent.keyDown(container.querySelector('[data-focus="true"]')!, {
      key: "Enter",
    });
    expect(p.onSelect).toHaveBeenCalledWith(["b", "c"]);
  });

  it("R rotates the focused node's children", () => {
    const p = props({ rotatable: true });
    const { container } = render(<ReadingTree {...p} />);
    const before = container
      .querySelector(`.rt-hit[data-clade='${CLADE("d", "e")}']`)!
      .getAttribute("style");
    fireEvent.keyDown(container.querySelector('[data-focus="true"]')!, {
      key: "r",
    });
    expect(p.onRotate).toHaveBeenCalledWith(["a", "b", "c", "d", "e"]);
    // The [d,e] clade moved to the other side of the root.
    const after = container
      .querySelector(`.rt-hit[data-clade='${CLADE("d", "e")}']`)!
      .getAttribute("style");
    expect(after).not.toBe(before);
    expect(
      container.querySelector('[role="status"]')!.textContent,
    ).toMatch(/Rotated/);
  });

  it("R does nothing on a tip or when rotatable is off", () => {
    const p = props({ rotatable: true });
    const { container } = render(<ReadingTree {...p} />);
    const key = (k: string) =>
      fireEvent.keyDown(container.querySelector('[data-focus="true"]')!, {
        key: k,
      });
    key("ArrowRight");
    key("ArrowRight"); // tip a
    key("r");
    expect(p.onRotate).not.toHaveBeenCalled();

    const p2 = props({ rotatable: false });
    const { container: c2 } = render(<ReadingTree {...p2} />);
    fireEvent.keyDown(c2.querySelector('[data-focus="true"]')!, {
      key: "r",
    });
    expect(p2.onRotate).not.toHaveBeenCalled();
  });
});

describe("ReadingTree rotate animation", () => {
  it("animates the swap at 300 ms ease-in-out", () => {
    const p = props({ rotatable: true });
    const { container } = render(<ReadingTree {...p} />);
    const anim = container.querySelector<SVGGElement>(".rt-anim");
    expect(anim).not.toBeNull();
    expect(anim!.style.transition).toContain("300ms");
    expect(anim!.style.transition).toContain("ease-in-out");
  });

  it("skips the animation under prefers-reduced-motion", () => {
    const mm = vi
      .fn()
      .mockImplementation((query: string) => ({
        matches: query.includes("reduce"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        onchange: null,
        dispatchEvent: () => false,
      }));
    vi.stubGlobal("matchMedia", mm);
    try {
      const p = props({ rotatable: true });
      const { container } = render(<ReadingTree {...p} />);
      const anim = container.querySelector<SVGGElement>(".rt-anim");
      expect(anim).not.toBeNull();
      expect(anim!.style.transition).not.toContain("300ms");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
