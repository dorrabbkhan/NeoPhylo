// Component tests for TreeView (plan Task 15). Tests run under jsdom with
// Testing Library (plan M3 preamble). Trees are hand-built arenas matching the
// `Tree` type emitted by neophylo-wasm — no wasm needed for view tests.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

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

  it("support below 50% gets a thinner stroke, data-weak and a * in the text", () => {
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
    // The marker glyph is part of the label text — "41*" — so the whole
    // value is one string (checkpoint 12: a clipped "47*" must never
    // render as just "*").
    expect(
      container.querySelector('g[data-node="3"] .support-label')
        ?.textContent,
    ).toBe("41*");
    expect(g?.querySelector(".weak-marker")).toBeNull();
  });

  // Checkpoint 12: the owner's screenshot showed weak pills hanging off
  // the svg's left edge — "47*" drawn as just "*". The viewBox now
  // fits the union of all drawn boxes, so every pill lies fully inside.
  it("keeps every support pill fully inside the svg viewBox", () => {
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
    const svg = container.querySelector("svg")!;
    const [vx, vy, vw, vh] = svg
      .getAttribute("viewBox")!
      .split(" ")
      .map(Number);
    for (const pill of svg.querySelectorAll("rect.support-pill")) {
      const x = Number(pill.getAttribute("x"));
      const y = Number(pill.getAttribute("y"));
      const w = Number(pill.getAttribute("width"));
      const h = Number(pill.getAttribute("height"));
      expect(x).toBeGreaterThanOrEqual(vx);
      expect(y).toBeGreaterThanOrEqual(vy);
      expect(x + w).toBeLessThanOrEqual(vx + vw);
      expect(y + h).toBeLessThanOrEqual(vy + vh);
      // The pill is wide enough for its label (≥ 0.5 em per char).
      const label = pill.parentElement!.querySelector(".support-label")!;
      const fontSize = Number(label.getAttribute("font-size"));
      expect(w).toBeGreaterThanOrEqual(
        label.textContent!.length * 0.5 * fontSize,
      );
    }
  });

  // The degree-2 root after a display reroot: the split's support lives
  // on the ingroup-side edge only (Task 5's single-placement rule), so
  // each grouping's label appears exactly once.
  // Checkpoint 12: labels are pills right of and above the child-end
  // node, and the u1/u2/… internal names hide while labels are shown
  // so they can never overlap.
  it("draws the support value inside a background pill", () => {
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
    const group = container.querySelector('g[data-node="3"] .support');
    expect(group?.querySelector("rect.support-pill")).not.toBeNull();
    expect(group?.querySelector(".support-label")?.textContent).toBe("87");
  });

  it("hides internal node names while support labels are shown", () => {
    const { container } = render(
      <TreeView
        tree={withSupport(0.874)}
        layoutKind="phylogram"
        highlight={new Set([3, 4])}
        wrong={new Set()}
        clampNegative={false}
        title="Inferred tree"
      />,
    );
    const texts = [...container.querySelectorAll("text")].map(
      (t) => t.textContent,
    );
    // u1 and u2 are step-through aids — hidden so the pills can sit
    // where the names would go.
    expect(texts).not.toContain("u1");
    expect(texts).not.toContain("u2");
    // Without support labels the highlighted names are still drawn.
    const plain = render(
      <TreeView
        tree={makeTree()}
        layoutKind="phylogram"
        highlight={new Set([3, 4])}
        wrong={new Set()}
        clampNegative={false}
        title="Inferred tree"
      />,
    );
    const plainTexts = [...plain.container.querySelectorAll("text")].map(
      (t) => t.textContent,
    );
    expect(plainTexts).toContain("u1");
    expect(plainTexts).toContain("u2");
  });

  it("never draws text below the 12px minimum", () => {
    const { container } = render(
      <TreeView
        tree={withSupport(0.41)}
        layoutKind="phylogram"
        highlight={new Set()}
        wrong={new Set()}
        clampNegative={false}
        leafSpacing={18}
        title="Inferred tree"
      />,
    );
    for (const t of container.querySelectorAll("text")) {
      expect(Number(t.getAttribute("font-size"))).toBeGreaterThanOrEqual(12);
    }
  });

  // Owner review: the svg renders at its natural pixel size — the
  // viewBox equals the width/height attributes, so the layout px are
  // the rendered px and the 12px floor is the on-screen floor. The
  // canvas scrolls instead of scaling the drawing down.
  it("draws at natural size: svg width/height equal the viewBox", () => {
    const { container } = render(
      <TreeView
        tree={withSupport(0.41)}
        layoutKind="phylogram"
        highlight={new Set()}
        wrong={new Set()}
        clampNegative={false}
        leafSpacing={18}
        title="Inferred tree"
      />,
    );
    const svg = container.querySelector("svg")!;
    const viewBox = svg.getAttribute("viewBox")!.split(" ").map(Number);
    expect(Number(svg.getAttribute("width"))).toBe(viewBox[2]);
    expect(Number(svg.getAttribute("height"))).toBe(viewBox[3]);
  });

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

describe("onPickBranch (v1.2 spec §7.1)", () => {
  it("internal edges fire onPickBranch with the split key; terminal edges fire onPickTerminal", () => {
    const onPickBranch = vi.fn();
    const onPickTerminal = vi.fn();
    const { container } = render(
      <TreeView
        tree={makeTree()}
        layoutKind="phylogram"
        highlight={new Set()}
        wrong={new Set()}
        clampNegative={false}
        title="Inferred tree"
        onPickBranch={onPickBranch}
        onPickTerminal={onPickTerminal}
      />,
    );
    // Internal node 3 (the (A,B) cherry) has a pickable branch hit line…
    const hit = container.querySelector('g[data-node="3"] .branch-hit');
    expect(hit).not.toBeNull();
    fireEvent.click(hit!);
    expect(onPickBranch).toHaveBeenCalledTimes(1);
    // The callback carries the same canonical grouping key the node
    // advertises via data-split.
    const key = container
      .querySelector('g[data-node="3"]')
      ?.getAttribute("data-split");
    expect(onPickBranch).toHaveBeenCalledWith(key);
    // Terminal (leaf) edges hit onPickTerminal — not an answer.
    const leafHit = container.querySelector('g[data-node="0"] .branch-hit');
    expect(leafHit).not.toBeNull();
    fireEvent.click(leafHit!);
    expect(onPickTerminal).toHaveBeenCalledTimes(1);
    expect(onPickBranch).toHaveBeenCalledTimes(1);
  });

  it("internal hits are named, focusable buttons; Enter picks and arrows rove", () => {
    const onPickBranch = vi.fn();
    const { container } = render(
      <TreeView
        tree={makeTree()}
        layoutKind="phylogram"
        highlight={new Set()}
        wrong={new Set()}
        clampNegative={false}
        title="Inferred tree"
        onPickBranch={onPickBranch}
        onPickTerminal={vi.fn()}
      />,
    );
    const hit = container.querySelector('g[data-node="3"] .branch-hit')!;
    // A real button: focusable, named for the grouping on the edge.
    expect(hit.getAttribute("role")).toBe("button");
    expect(hit.getAttribute("tabindex")).toBe("0");
    expect(hit.getAttribute("aria-label")).toMatch(/^Branch to \(/);
    // Enter/Space selects the branch.
    fireEvent.keyDown(hit, { key: "Enter" });
    expect(onPickBranch).toHaveBeenCalledTimes(1);
    fireEvent.keyDown(hit, { key: " " });
    expect(onPickBranch).toHaveBeenCalledTimes(2);
    // Arrows rove among the internal hits only.
    const buttons = container.querySelectorAll('.branch-hit[role="button"]');
    expect(buttons.length).toBeGreaterThan(0);
    (hit as SVGLineElement).focus();
    fireEvent.keyDown(hit, { key: "ArrowRight" });
    expect(document.activeElement).toBe(
      buttons[(Array.from(buttons).indexOf(hit) + 1) % buttons.length],
    );
    // Terminal hits are pointer-only — no role, no tab stop.
    const leafHit = container.querySelector('g[data-node="0"] .branch-hit')!;
    expect(leafHit.getAttribute("role")).toBeNull();
    expect(leafHit.getAttribute("tabindex")).toBeNull();
  });

  it("terminal edges carry no hit line without an onPickTerminal handler", () => {
    const { container } = render(
      <TreeView
        tree={makeTree()}
        layoutKind="phylogram"
        highlight={new Set()}
        wrong={new Set()}
        clampNegative={false}
        title="Inferred tree"
        onPickBranch={vi.fn()}
      />,
    );
    expect(container.querySelector('g[data-node="0"] .branch-hit')).toBeNull();
  });

  it("no hit lines are drawn without an onPickBranch handler", () => {
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
    expect(container.querySelectorAll(".branch-hit")).toHaveLength(0);
  });
});

describe("fonts-ready gate on remount", () => {
  // Once the page-level font gate has settled, a newly mounted TreeView
  // must render its <svg> on the first render — not replay the wait as
  // a blank frame. document.fonts is faked so the gate is engaged
  // (jsdom has no FontFaceSet).
  it("renders its <svg> on the first render after whenFontsReady resolved", async () => {
    const resolvers: (() => void)[] = [];
    Object.defineProperty(document, "fonts", {
      value: {
        load: () =>
          new Promise<FontFace[]>((resolve) =>
            resolvers.push(() => resolve([])),
          ),
      },
      configurable: true,
    });
    try {
      const { whenFontsReady } = await import("../design/fontsReady");
      const ready = whenFontsReady();
      for (const r of resolvers.splice(0)) r();
      await expect(ready).resolves.toBe("loaded");
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
      expect(container.querySelector("svg")).not.toBeNull();
    } finally {
      delete (document as { fonts?: unknown }).fonts;
    }
  });
});
