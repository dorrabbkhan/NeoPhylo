// Component tests for MatrixHeatmap (plan Task 16). Tests run under jsdom
// with Testing Library (plan M3 preamble). `values` is the plain row-major
// cell list the App hands over — no wasm needed for view tests.

import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { cellDecimals } from "./matrix/cellDecimals";
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

/* ---- per-matrix decimal count (v1.4c owner ruling 2A on PR #156,
 * sign-aware after the PR #157 review): one decimal count for the
 * whole displayed matrix so the widest formatted value — the minus
 * sign included — still fits the 34 px cell. 0 when every finite
 * value is an integer; otherwise the largest d ≤ 3 whose every
 * toFixed(d) string is at most 5 characters (5 glyphs fit the cell;
 * 6 glyphs run ~32–37 px — too risky to allow). Matrices with all
 * values in [0, 10) and not
 * all integers keep the shipped 3 decimals byte-identically. ---- */

describe("cellDecimals", () => {
  it("returns 0 when every finite value is an integer", () => {
    expect(cellDecimals([0, 5, 15, 10, 3])).toBe(0);
    expect(cellDecimals([0, -35, -49])).toBe(0);
  });

  it("returns 3 when a non-integer matrix's values are all in [0, 10)", () => {
    expect(cellDecimals([0, 0.5, 9.999])).toBe(3);
  });

  it("returns 2 when some value's 3-decimal string exceeds 5 characters", () => {
    expect(cellDecimals([0, 2.5, 24.5])).toBe(2); // "24.500" is 6
    expect(cellDecimals([0, -0.45, 0.3])).toBe(2); // "-0.450" is 6
    expect(cellDecimals([0, 0.5, 9.999, -1.25])).toBe(2); // "-1.250" is 6
  });

  it("returns 1 when some value's 2-decimal string exceeds 5 characters", () => {
    expect(cellDecimals([0, 150.25])).toBe(1); // "150.25" is 6
    expect(cellDecimals([0, -82.5, -70.5])).toBe(1); // "-82.50" is 6
    expect(cellDecimals([0, -49.5])).toBe(1); // "-49.50" is 6
  });

  it("returns 0 when even the 1-decimal string exceeds 5 characters", () => {
    expect(cellDecimals([0, 1234.5])).toBe(0); // "1234.5" is 6
    expect(cellDecimals([0, -148.5])).toBe(0); // "-148.5" → "-148"
    // No d ≤ 3 fits |v| ≥ 10000 — the fallback is still 0.
    expect(cellDecimals([0, -99999.9])).toBe(0);
  });

  it("ignores non-finite values (saturated/∞ cells)", () => {
    expect(cellDecimals([0.5, Infinity, NaN, -Infinity])).toBe(3);
    expect(cellDecimals([Infinity, NaN])).toBe(3);
  });

  it("does not throw on an empty matrix", () => {
    expect(() => cellDecimals([])).not.toThrow();
    expect(cellDecimals([])).toBe(3);
  });
});

describe("MatrixHeatmap cell digits", () => {
  /** The <text> inside cell (i, j). */
  const cellText = (container: HTMLElement, i: number, j: number) =>
    cell(container, i, j).querySelector("text")?.textContent;

  // fixtures/inputs/matrix/nj_by_hand.phy — the nj-by-hand lesson's
  // step-0 distance matrix (all integers, some ≥ 10). Before the fix
  // "15.000" and "10.000" clipped the 34 px cell.
  const NJ_BY_HAND: number[] = [
    0, 5, 15, 9, 8,
    5, 0, 10, 10, 9,
    15, 10, 0, 8, 7,
    9, 10, 8, 0, 3,
    8, 9, 7, 3, 0,
  ];

  it("an all-integer matrix prints values with no decimals", () => {
    const { container } = renderMatrix({
      labels: ["a", "b", "c", "d", "e"],
      values: NJ_BY_HAND,
    });
    expect(cellText(container, 0, 2)).toBe("15");
    expect(cellText(container, 0, 1)).toBe("5");
    expect(cellText(container, 1, 2)).toBe("10");
    for (const g of container.querySelectorAll('[role="gridcell"] text')) {
      expect(g.textContent).not.toContain(".");
    }
  });

  it("a reduced matrix with 2.5 and 24.5 prints two decimals", () => {
    const { container } = renderMatrix({
      values: [
        0, 2.5, 24.5,
        2.5, 0, 12.5,
        24.5, 12.5, 0,
      ],
    });
    expect(cellText(container, 0, 1)).toBe("2.50");
    expect(cellText(container, 0, 2)).toBe("24.50");
    expect(cellText(container, 1, 2)).toBe("12.50");
  });

  it("the aria-label carries the same displayed text", () => {
    const { container } = renderMatrix({
      labels: ["a", "b", "c", "d", "e"],
      values: NJ_BY_HAND,
    });
    expect(cell(container, 0, 2).getAttribute("aria-label")).toBe(
      "a, c: 15",
    );
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
