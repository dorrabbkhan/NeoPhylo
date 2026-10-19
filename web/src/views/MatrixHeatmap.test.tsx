// Component tests for MatrixHeatmap (plan Task 16). Tests run under jsdom
// with Testing Library (plan M3 preamble). `values` is the plain row-major
// cell list the App hands over — no wasm needed for view tests.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MatrixHeatmap } from "./MatrixHeatmap";

afterEach(cleanup);

const LABELS = ["a", "b", "c"];

// Row-major 3×3: zero diagonal, d(a,b)=0.5, d(a,c)=0.9, d(b,c)=0.3.
const DIST: (number | "sat")[] = [
  0, 0.5, 0.9,
  0.5, 0, 0.3,
  0.9, 0.3, 0,
];

function cell(container: HTMLElement, i: number, j: number): Element {
  const el = container.querySelector(`[data-i="${i}"][data-j="${j}"]`);
  if (!el) throw new Error(`cell (${i},${j}) not found`);
  return el;
}

function renderMatrix(overrides: Partial<Parameters<typeof MatrixHeatmap>[0]> = {}) {
  const onHover = vi.fn();
  const utils = render(
    <MatrixHeatmap
      labels={LABELS}
      values={DIST}
      view="distance"
      chosen={null}
      hover={null}
      onHover={onHover}
      {...overrides}
    />,
  );
  return { ...utils, onHover };
}

describe("MatrixHeatmap", () => {
  it("renders one gridcell per matrix entry with the value at 3 decimals", () => {
    const { container } = renderMatrix();
    expect(container.querySelectorAll('[role="gridcell"]')).toHaveLength(9);
    expect(cell(container, 0, 1).textContent).toContain("0.500");
  });

  it('shows a saturated cell as "∞" with fill="url(#hatch)"', () => {
    const values: (number | "sat")[] = [
      0, 0.5, "sat",
      0.5, 0, 0.3,
      "sat", 0.3, 0,
    ];
    const { container } = renderMatrix({ values });
    const sat = cell(container, 0, 2);
    const rect = sat.querySelector("rect");
    expect(rect?.getAttribute("fill")).toBe("url(#hatch)");
    expect(sat.textContent).toContain("∞");
    expect(container.querySelector("pattern#hatch")).not.toBeNull();
  });

  it('marks the chosen cell with aria-selected="true"', () => {
    const { container } = renderMatrix({ chosen: [0, 1] });
    expect(cell(container, 0, 1).getAttribute("aria-selected")).toBe("true");
    expect(cell(container, 0, 2).getAttribute("aria-selected")).toBe("false");
  });

  it("calls onHover with { i, j } when a cell is hovered", () => {
    const { container, onHover } = renderMatrix();
    fireEvent.mouseEnter(cell(container, 1, 2));
    expect(onHover).toHaveBeenCalledWith({ i: 1, j: 2 });
    fireEvent.mouseLeave(cell(container, 1, 2));
    expect(onHover).toHaveBeenCalledWith(null);
  });

  it("moves focus between cells with the arrow keys", () => {
    const { container } = renderMatrix();
    const start = cell(container, 0, 0) as SVGGElement;
    start.focus();
    expect(document.activeElement).toBe(start);
    fireEvent.keyDown(start, { key: "ArrowRight" });
    expect(document.activeElement).toBe(cell(container, 0, 1));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowDown" });
    expect(document.activeElement).toBe(cell(container, 1, 1));
    fireEvent.keyDown(document.activeElement!, { key: "ArrowLeft" });
    expect(document.activeElement).toBe(cell(container, 1, 0));
    // Clamped at the top edge.
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    fireEvent.keyDown(document.activeElement!, { key: "ArrowUp" });
    expect(document.activeElement).toBe(cell(container, 0, 0));
  });

  it("calls onPick(i, j) when Enter is pressed on a focused cell", () => {
    const onPick = vi.fn();
    const { container } = renderMatrix({ onPick });
    const target = cell(container, 2, 1) as SVGGElement;
    target.focus();
    fireEvent.keyDown(target, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(2, 1);
  });
});

/* ---- compact mode (n > 64, v1.1 §3.4 budget path) ---- */

const BIG_N = 65;
const BIG_LABELS = Array.from({ length: BIG_N }, (_, i) => `t${i}`);
const BIG_VALUES = Array.from({ length: BIG_N * BIG_N }, (_, k) => {
  const i = Math.floor(k / BIG_N);
  const j = k % BIG_N;
  return i === j ? 0 : ((i * 7 + j * 3) % 100) / 100;
});

describe("MatrixHeatmap compact mode", () => {
  it("renders bucketed paths instead of per-cell gridcells", () => {
    const { container } = renderMatrix({
      labels: BIG_LABELS,
      values: BIG_VALUES,
    });
    const svg = container.querySelector("svg");
    expect(svg?.getAttribute("role")).toBe("group");
    expect(svg?.getAttribute("aria-label")).toBe(
      `Distance matrix, ${BIG_N} taxa`,
    );
    expect(container.querySelectorAll('[role="gridcell"]')).toHaveLength(0);
    expect(
      container.querySelectorAll("path").length,
    ).toBeGreaterThan(0);
  });

  it("picks a cell from the overlay with arrow keys + Enter", () => {
    const onPick = vi.fn();
    const { container } = renderMatrix({
      labels: BIG_LABELS,
      values: BIG_VALUES,
      onPick,
    });
    const overlay = container.querySelector('rect[tabindex="0"]');
    expect(overlay).not.toBeNull();
    fireEvent.keyDown(overlay!, { key: "ArrowRight" });
    fireEvent.keyDown(overlay!, { key: "ArrowDown" });
    fireEvent.keyDown(overlay!, { key: "Enter" });
    expect(onPick).toHaveBeenCalledWith(1, 1);
  });
});
