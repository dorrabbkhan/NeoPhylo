// SVG distance/Q matrix heatmap (plan Task 16, spec §6.1-6.3, §6.5).
//
// Cells are focusable `role="gridcell"` buttons inside a `role="grid"` svg:
// arrow keys move focus (roving tabindex) and Enter/Space calls `onPick`,
// which lesson prompts use for "which pair joins next" (Task 21).
//
// Accessibility (§6.5): a colorblind-safe sequential palette (viridis) is
// never the only carrier of meaning — the numeric value is printed in each
// cell at 3 decimals, saturated cells use a hatch <pattern> and show "∞",
// and the chosen pair also gets a thick border plus aria-selected.

import { useCallback, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

export type MatrixCell = number | "sat";

export interface MatrixHeatmapProps {
  /** Taxon labels; `values` has labels.length² entries. */
  labels: string[];
  /** Row-major cells; "sat" marks a saturated distance (spec §6.3). */
  values: MatrixCell[];
  /** Which matrix this is; distance or the NJ Q matrix. */
  view: "distance" | "q";
  /** Indices [i, j] of the pair joining next, or null. */
  chosen: [number, number] | null;
  /** Cell currently highlighted by hover/focus, or { axis } to highlight a
   * whole row and column (used when a tree leaf is hovered, Task 17). */
  hover: { i: number; j: number } | { axis: number } | null;
  /** Called with { i, j } on hover/focus and null when the pointer leaves. */
  onHover: (cell: { i: number; j: number } | null) => void;
  /** Called when a cell is activated with Enter/Space (predict prompts). */
  onPick?: (i: number, j: number) => void;
}

// Viridis, sampled at t = i/7 (the same eight stops as R's viridis(8)).
const VIRIDIS = [
  "#440154",
  "#472d7b",
  "#3b528b",
  "#2c728e",
  "#21908c",
  "#28ae80",
  "#5ec962",
  "#fde725",
];

const CELL = 34;
const LABEL = 90; // room for row labels on the left and column labels on top
const PAD = 4;
const FONT = 9;
const LABEL_FONT = 10;

/** Linear interpolation over the VIRIDIS stops; t is clamped to [0, 1]. */
function viridis(t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (VIRIDIS.length - 1);
  const lo = Math.floor(x);
  const hi = Math.min(VIRIDIS.length - 1, lo + 1);
  const f = x - lo;
  const a = parseInt(VIRIDIS[lo].slice(1), 16);
  const b = parseInt(VIRIDIS[hi].slice(1), 16);
  const c =
    (Math.round(
      ((a >> 16) & 0xff) + (((b >> 16) & 0xff) - ((a >> 16) & 0xff)) * f,
    ) <<
      16) |
    (Math.round(
      ((a >> 8) & 0xff) + (((b >> 8) & 0xff) - ((a >> 8) & 0xff)) * f,
    ) <<
      8) |
    Math.round((a & 0xff) + ((b & 0xff) - (a & 0xff)) * f);
  return `#${c.toString(16).padStart(6, "0")}`;
}

/** Dark text on the bright end of viridis, white on the dark end. */
function textFill(hex: string): string {
  const c = parseInt(hex.slice(1), 16);
  const r = ((c >> 16) & 0xff) / 255;
  const g = ((c >> 8) & 0xff) / 255;
  const b = (c & 0xff) / 255;
  // WCAG relative luminance on the sRGB channels (approximation is fine).
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.45 ? "#1a1a1a" : "#ffffff";
}

export function MatrixHeatmap({
  labels,
  values,
  view,
  chosen,
  hover,
  onHover,
  onPick,
}: MatrixHeatmapProps) {
  const n = labels.length;
  const at = (i: number, j: number): MatrixCell => values[i * n + j];

  // Numeric range for the sequential scale; saturated cells are excluded.
  let min = Infinity;
  let max = -Infinity;
  for (const v of values) {
    if (typeof v === "number" && Number.isFinite(v)) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
  }
  const t = (v: number) => (max > min ? (v - min) / (max - min) : 0.5);

  // Roving tabindex: one cell is tabbable, arrow keys move it (WAI-ARIA
  // grid pattern). Defaults to the chosen cell so keyboard focus starts on
  // the pair under discussion.
  const [focused, setFocused] = useState<[number, number]>(
    () => chosen ?? [0, 0],
  );
  const cellEls = useRef(new Map<number, SVGGElement>());
  const setCellEl = useCallback(
    (idx: number) => (el: SVGGElement | null) => {
      if (el) cellEls.current.set(idx, el);
      else cellEls.current.delete(idx);
    },
    [],
  );

  const moveFocus = (i: number, j: number) => {
    const ni = Math.min(n - 1, Math.max(0, i));
    const nj = Math.min(n - 1, Math.max(0, j));
    setFocused([ni, nj]);
    cellEls.current.get(ni * n + nj)?.focus();
  };

  const onKeyDown =
    (i: number, j: number) => (e: KeyboardEvent<SVGGElement>) => {
      switch (e.key) {
        case "ArrowUp":
          e.preventDefault();
          moveFocus(i - 1, j);
          break;
        case "ArrowDown":
          e.preventDefault();
          moveFocus(i + 1, j);
          break;
        case "ArrowLeft":
          e.preventDefault();
          moveFocus(i, j - 1);
          break;
        case "ArrowRight":
          e.preventDefault();
          moveFocus(i, j + 1);
          break;
        case "Enter":
        case " ":
          e.preventDefault();
          onPick?.(i, j);
          break;
      }
    };

  const cx = (j: number) => PAD + LABEL + j * CELL;
  const cy = (i: number) => PAD + LABEL + i * CELL;
  const isChosen = (i: number, j: number) =>
    chosen !== null && chosen[0] === i && chosen[1] === j;
  const isHovered = (i: number, j: number) =>
    hover !== null &&
    ("axis" in hover
      ? hover.axis === i || hover.axis === j
      : hover.i === i && hover.j === j);

  const title = view === "distance" ? "Distance matrix" : "Q matrix";
  const width = PAD * 2 + LABEL + n * CELL;
  const height = width;

  return (
    <svg
      role="grid"
      aria-label={title}
      aria-rowcount={n}
      aria-colcount={n}
      viewBox={`0 0 ${width} ${height}`}
    >
      <defs>
        <pattern
          id="hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          <rect width="6" height="6" fill="#e8e8e8" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke="#666666"
            strokeWidth="1.5"
          />
        </pattern>
      </defs>

      {labels.map((label, j) => (
        <text
          key={`col-${j}`}
          x={cx(j) + CELL / 2}
          y={PAD + LABEL - 4}
          fontSize={LABEL_FONT}
          textAnchor="start"
          transform={`rotate(-60 ${cx(j) + CELL / 2} ${PAD + LABEL - 4})`}
        >
          {label}
        </text>
      ))}

      {labels.map((label, i) => (
        <g key={`row-${i}`} role="row" aria-rowindex={i + 1}>
          <text
            x={PAD + LABEL - 6}
            y={cy(i) + CELL / 2}
            fontSize={LABEL_FONT}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {label}
          </text>
          {labels.map((_, j) => {
            const v = at(i, j);
            const saturated =
              v === "sat" || (typeof v === "number" && !Number.isFinite(v));
            const fill = saturated ? "url(#hatch)" : viridis(t(v as number));
            const text = saturated ? "∞" : (v as number).toFixed(3);
            return (
              <g
                key={`cell-${i}-${j}`}
                role="gridcell"
                ref={setCellEl(i * n + j)}
                data-i={i}
                data-j={j}
                aria-selected={isChosen(i, j)}
                aria-colindex={j + 1}
                aria-label={`${labels[i]}, ${labels[j]}: ${saturated ? "saturated" : text}`}
                tabIndex={focused[0] === i && focused[1] === j ? 0 : -1}
                onKeyDown={onKeyDown(i, j)}
                onFocus={() => {
                  setFocused([i, j]);
                  onHover({ i, j });
                }}
                onBlur={() => onHover(null)}
                onMouseEnter={() => onHover({ i, j })}
                onMouseLeave={() => onHover(null)}
              >
                <rect
                  x={cx(j)}
                  y={cy(i)}
                  width={CELL}
                  height={CELL}
                  fill={fill}
                  stroke={
                    isChosen(i, j)
                      ? "currentColor"
                      : isHovered(i, j)
                        ? "currentColor"
                        : "#ffffff"
                  }
                  strokeWidth={isChosen(i, j) ? 3 : isHovered(i, j) ? 2 : 0.5}
                />
                <text
                  x={cx(j) + CELL / 2}
                  y={cy(i) + CELL / 2}
                  fontSize={FONT}
                  textAnchor="middle"
                  dominantBaseline="middle"
                  fill={saturated ? "#333333" : textFill(fill)}
                  pointerEvents="none"
                >
                  {text}
                </text>
              </g>
            );
          })}
        </g>
      ))}
    </svg>
  );
}
