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
//
// Large matrices (v1.1 Task 14, §3.4's 200-taxon budget): past COMPACT_N
// taxa a per-cell DOM (three SVG nodes × n² cells) cannot render inside
// the 2 s budget, so the cells are drawn as a few fill-bucketed <path>s
// plus one interactive overlay — hover, click-pick and arrow-key + Enter
// picking still work, but there are no per-cell gridcells or value texts
// (at ~2 px per cell they are unreadable anyway).

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

/** Above this many taxa the compact path renderer replaces per-cell
 * gridcell elements (v1.1 §3.4 budget; see the file header). */
const COMPACT_N = 64;
/** Fill buckets for the compact renderer (viridis levels + saturated). */
const BUCKETS = 64;

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

/** Cell value text: dark on the bright (high-t) half of viridis, white
 * on the dark half. Choosing by the scale value t — rather than the
 * interpolated color — keeps the rule independent of the palette. */
function cellTextFill(tv: number): string {
  return tv > 0.5 ? "#1a1a1a" : "#ffffff";
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

  const overlayEl = useRef<SVGRectElement | null>(null);
  const compact = n > COMPACT_N;
  // Compact mode only: the focus-cell outline appears once the user has
  // actually pointed at or keyed into the overlay (not before).
  const [navigated, setNavigated] = useState(false);

  const moveFocus = (i: number, j: number) => {
    const ni = Math.min(n - 1, Math.max(0, i));
    const nj = Math.min(n - 1, Math.max(0, j));
    setFocused([ni, nj]);
    if (compact) overlayEl.current?.focus();
    else cellEls.current.get(ni * n + nj)?.focus();
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

  /** Map a pointer position over the cell area to a cell index pair. */
  const cellAtPointer = (e: {
    clientX: number;
    clientY: number;
    currentTarget: SVGRectElement;
  }): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    if (!(r.width > 0) || !(r.height > 0)) return [0, 0];
    const j = Math.floor(((e.clientX - r.left) / r.width) * n);
    const i = Math.floor(((e.clientY - r.top) / r.height) * n);
    return [
      Math.min(n - 1, Math.max(0, i)),
      Math.min(n - 1, Math.max(0, j)),
    ];
  };

  /** Compact-mode key handling on the overlay: arrows move the focus
   * cell, Enter/Space picks it (same contract as the per-cell path). */
  const onOverlayKeyDown = (e: KeyboardEvent<SVGRectElement>) => {
    const [i, j] = focused;
    setNavigated(true);
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

  return (
    <svg
      role={compact ? "group" : "grid"}
      aria-label={compact ? `${title}, ${n} taxa` : title}
      aria-rowcount={compact ? undefined : n}
      aria-colcount={compact ? undefined : n}
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
          fill="currentColor"
          textAnchor="start"
          transform={`rotate(-60 ${cx(j) + CELL / 2} ${PAD + LABEL - 4})`}
        >
          {label}
        </text>
      ))}

      {compact && <CompactCells n={n} at={at} t={t} />}
      {compact && (
        <>
          <rect
            ref={overlayEl}
            x={cx(0)}
            y={cy(0)}
            width={n * CELL}
            height={n * CELL}
            fill="transparent"
            tabIndex={0}
            focusable="true"
            aria-label={`${title}: arrow keys move between cells, Enter opens a pair`}
            onClick={(e) => {
              const [i, j] = cellAtPointer(e);
              setFocused([i, j]);
              setNavigated(true);
              onPick?.(i, j);
            }}
            onMouseMove={(e) => {
              const [i, j] = cellAtPointer(e);
              setFocused([i, j]);
              setNavigated(true);
              onHover({ i, j });
            }}
            onMouseLeave={() => onHover(null)}
            onKeyDown={onOverlayKeyDown}
          />
          {navigated && (
            <rect
              x={cx(focused[1])}
              y={cy(focused[0])}
              width={CELL}
              height={CELL}
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              pointerEvents="none"
            />
          )}
          {chosen !== null && (
            <rect
              x={cx(chosen[1])}
              y={cy(chosen[0])}
              width={CELL}
              height={CELL}
              fill="none"
              stroke="currentColor"
              strokeWidth={3}
              pointerEvents="none"
            />
          )}
        </>
      )}

      {labels.map((label, i) => (
        <g key={`row-${i}`} role="row" aria-rowindex={i + 1}>
          <text
            x={PAD + LABEL - 6}
            y={cy(i) + CELL / 2}
            fontSize={LABEL_FONT}
            fill="currentColor"
            textAnchor="end"
            dominantBaseline="middle"
          >
            {label}
          </text>
          {compact
            ? null
            : labels.map((_, j) => {
            const v = at(i, j);
            const saturated =
              v === "sat" || (typeof v === "number" && !Number.isFinite(v));
            const tv = saturated ? 0 : t(v as number);
            const fill = saturated ? "url(#hatch)" : viridis(tv);
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
                aria-rowindex={i + 1}
                aria-label={`${labels[i]}, ${labels[j]}: ${saturated ? "saturated" : text}`}
                tabIndex={focused[0] === i && focused[1] === j ? 0 : -1}
                // WebKit ignores tabindex on SVG elements for sequential
                // focus; `focusable` puts the cell in the Tab order.
                focusable="true"
                onClick={() => onPick?.(i, j)}
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
                  fill={saturated ? "#333333" : cellTextFill(tv)}
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

interface CompactCellsProps {
  n: number;
  at: (i: number, j: number) => MatrixCell;
  /** Scale normalization from the parent (min/max over the values). */
  t: (v: number) => number;
}

/** The n² cells as at most BUCKETS+1 fill-keyed <path>s: O(buckets) DOM
 * nodes instead of O(n²) (v1.1 §3.4 budget). Fills are quantized to the
 * BUCKETS viridis levels; saturated cells share the hatch pattern. */
function CompactCells({ n, at, t }: CompactCellsProps) {
  // Segments accumulate in arrays and join once — appending to a growing
  // path string would copy O(n²) path data per cell.
  const paths = new Map<number, string[]>();
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const v = at(i, j);
      const saturated =
        v === "sat" || (typeof v === "number" && !Number.isFinite(v));
      const key = saturated
        ? -1
        : Math.round(t(v as number) * (BUCKETS - 1));
      const x = PAD + LABEL + j * CELL;
      const y = PAD + LABEL + i * CELL;
      const segs = paths.get(key);
      const d = `M${x} ${y}h${CELL}v${CELL}h${-CELL}z`;
      if (segs === undefined) paths.set(key, [d]);
      else segs.push(d);
    }
  }
  return (
    <>
      {[...paths].map(([key, segs]) => (
        <path
          key={key}
          d={segs.join("")}
          fill={key < 0 ? "url(#hatch)" : viridis(key / (BUCKETS - 1))}
        />
      ))}
    </>
  );
}
