// The typing grid for a distance matrix (v1.4c spec §6.1, §8.3; plan
// Task 8). A real <table> holding the strict lower triangle: row i
// carries taxon i's name plus its distances to taxa 0..i−1. Cells are
// labelled inputs ("Distance between B and A"), arrow keys move
// between them, names edit inline, taxa add and remove within 3–30
// (the grid's own cap; files and paste accept MAX_TAXA).
//
// The grid keeps raw text per cell so half-typed input is never
// clobbered, and on a structural failure the engine's
// `validateMatrix` message is shown verbatim — the grid never
// re-validates names or values beyond "a number ≥ 0 typed as text".
// EVERY change — cell, name or taxon — emits `onChange(null)`: fix
// round 2's commit model drops the session's matrix, tree and
// stepper to "complete the matrix" until Build tree emits the
// finished DistanceInput (Review Focus 3; an in-place editMatrix on
// each keystroke made the rebuild hint a lie — the tree always
// matched the screen). The hint only claims what it means: it shows
// once a matrix this grid committed (or was seeded with) differs
// from the draft on screen — a fresh grid's first fill built nothing
// yet, so it shows no hint.

import { useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";

import { engine } from "../../engine/index";
import { errorMessage } from "../../explain/errors";
import type { DistanceInput } from "../../engine/generated/DistanceInput";

import "./matrix.css";

export interface MatrixGridProps {
  /** The committed matrix — the session's `matrixInput` while a matrix
   * session runs, else the parent's draft. `null` = nothing committed. */
  value: DistanceInput | null;
  /** The commit channel (fix round 2's model): EVERY uncommitted
   * change — cell, name or taxon — emits `(null, draftReady)`, where
   * `draftReady` is true when the draft on screen is complete and
   * valid but waiting on the button; only Build tree emits the
   * finished `DistanceInput`. */
  onChange(input: DistanceInput | null, draftReady?: boolean): void;
}

/** The grid's taxon cap (plan "Decided in this plan": 3–30). */
export const GRID_MIN_TAXA = 3;
export const GRID_MAX_TAXA = 30;

const START_NAMES = ["A", "B", "C", "D", "E"];

/** The next unused spreadsheet-style default name (A…Z, then A1…),
 * continuing the names' letter case — a,b,c,d,e adds f. */
function nextName(names: string[]): string {
  const lower = names.every((n) => n === n.toLowerCase());
  const used = (c: string) =>
    names.some((n) => n.toLowerCase() === c.toLowerCase());
  for (let k = 0; k < 26; k += 1) {
    const c = String.fromCharCode(65 + k);
    if (!used(c)) return lower ? c.toLowerCase() : c;
  }
  let suffix = 1;
  for (;;) {
    for (let k = 0; k < 26; k += 1) {
      const c = `${String.fromCharCode(65 + k)}${suffix}`;
      if (!used(c)) return lower ? c.toLowerCase() : c;
    }
    suffix += 1;
  }
}

/** Lower-triangle index of d(i, j) for j < i. */
function lowerIndex(i: number, j: number): number {
  return (i * (i - 1)) / 2 + j;
}

/** Raw grid state from a committed input (numbers as shortest text). */
function seedCells(m: DistanceInput): string[][] {
  return m.names.map((_, i) =>
    Array.from({ length: i }, (_, j) => String(m.lower[lowerIndex(i, j)])),
  );
}

const EMPTY_CELLS = () => START_NAMES.map((_, i) => Array.from({ length: i }, () => ""));

/** A cell's number, or null when empty or not a finite number ≥ 0.
 * This is the whole per-cell rule — names, uniqueness and structure
 * belong to `engine.validateMatrix`. */
function cellNumber(text: string): number | null {
  const t = text.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) && v >= 0 ? v : null;
}

/** The typed matrix as a DistanceInput, or null while any cell is
 * empty or not a number ≥ 0. */
function completeInput(names: string[], cells: string[][]): DistanceInput | null {
  const lower: number[] = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const v = cellNumber(cells[i][j]);
      if (v === null) return null;
      lower.push(v);
    }
  }
  return { names: [...names], lower };
}

/** The reason Build tree stays disabled (spec §8.3): the first empty
 * or invalid cell, or the engine's structural message when every cell
 * holds a number but the matrix still isn't valid. */
function buildReason(names: string[], cells: string[][]): string | null {
  let empty = 0;
  for (let i = 0; i < names.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const v = cellNumber(cells[i][j]);
      if (v === null) {
        if (cells[i][j].trim() === "") {
          empty += 1;
        } else {
          return `d(${names[i]}, ${names[j]}) must be a number ≥ 0.`;
        }
      }
    }
  }
  if (empty > 0) {
    return `${empty} cell${empty === 1 ? "" : "s"} still empty — every cell below the diagonal needs a distance.`;
  }
  const input = completeInput(names, cells);
  if (input === null) return null;
  const r = engine.validateMatrix(input);
  if (r.ok) return null;
  const m = errorMessage(r.error);
  return `${m.title}. ${m.body}`;
}

/** Per-cell problem lines for the aria-live region (only cells with
 * non-empty, unparseable text; empty cells are covered by the
 * Build-tree reason). */
function cellProblems(names: string[], cells: string[][]): string[] {
  const out: string[] = [];
  for (let i = 0; i < names.length; i += 1) {
    for (let j = 0; j < i; j += 1) {
      if (cells[i][j].trim() !== "" && cellNumber(cells[i][j]) === null) {
        out.push(`d(${names[i]}, ${names[j]}) must be a number ≥ 0.`);
      }
    }
  }
  return out;
}

export function MatrixGrid({ value, onChange }: MatrixGridProps) {
  const statusId = useId();
  const tableRef = useRef<HTMLTableElement>(null);
  const removeRef = useRef<HTMLSelectElement>(null);
  const [names, setNames] = useState<string[]>(
    () => value?.names ?? START_NAMES,
  );
  const [cells, setCells] = useState<string[][]>(() =>
    value === null ? EMPTY_CELLS() : seedCells(value),
  );
  // The matrix the tree was last built from, as JSON: a committed
  // `value` the grid was seeded with, or this grid's last Build-tree
  // emit. `null` = nothing built from this grid yet — the rebuild
  // hint only makes sense against a built matrix (fix round 2).
  const [committed, setCommitted] = useState<string | null>(() =>
    value === null ? null : JSON.stringify(value),
  );

  // Re-seed only when `value` carries a matrix this grid did not emit —
  // an import, a lesson's data or another grid instance's commit. A
  // round-tripped emit serializes equal and never re-seeds, so typed
  // text survives; a null that follows our own null emit leaves the
  // draft alone (Review Focus 3 keeps the typed cells on screen).
  // State, not a ref — the "adjust state when a prop changes" pattern
  // (refs can't be read or written during render).
  const [emittedKey, setEmittedKey] = useState(() => JSON.stringify(value));
  const valueKey = JSON.stringify(value);
  if (valueKey !== emittedKey) {
    setEmittedKey(valueKey);
    setCommitted(value === null ? null : valueKey);
    if (value !== null) {
      setNames([...value.names]);
      setCells(seedCells(value));
    } else {
      setNames(START_NAMES);
      setCells(EMPTY_CELLS());
    }
  }

  /** Every uncommitted change emits null — the session's matrix drops
   * until Build tree emits the finished input (fix round 2's model:
   * an in-place editMatrix on each keystroke made the rebuild hint a
   * lie, since the tree always matched the screen). `draftReady`
   * flags the draft that is complete and valid but still unbuilt, so
   * the empty-state line can ask for the button (v1.4c Task 9). */
  const emitNull = (ns: string[], cs: string[][]) => {
    setEmittedKey("null");
    onChange(
      null,
      completeInput(ns, cs) !== null && buildReason(ns, cs) === null,
    );
  };

  const setCell = (i: number, j: number, text: string) => {
    const cs = cells.map((row) => [...row]);
    cs[i][j] = text;
    setCells(cs);
    emitNull(names, cs);
  };

  const setName = (i: number, text: string) => {
    const ns = [...names];
    ns[i] = text;
    setNames(ns);
    emitNull(ns, cells);
  };

  const addTaxon = () => {
    const ns = [...names, nextName(names)];
    const cs = [...cells.map((row) => [...row]), names.map(() => "")];
    setNames(ns);
    setCells(cs);
    emitNull(ns, cs);
  };

  const removeTaxon = (i: number) => {
    const ns = names.filter((_, k) => k !== i);
    const rebuilt = ns.map((_, r) => {
      const origRow = r < i ? r : r + 1;
      const row: string[] = [];
      for (let j = 0; j < r; j += 1) {
        const origCol = j < i ? j : j + 1;
        row.push(cells[origRow][origCol]);
      }
      return row;
    });
    setNames(ns);
    setCells(rebuilt);
    emitNull(ns, rebuilt);
  };

  /** The one remove control (fix round 2): a per-row Remove button
   * made every row wider than the taxa it showed — a name select and
   * one button carry the same action without touching the table. */
  const removeSelected = () => {
    const i = removeRef.current?.selectedIndex ?? -1;
    if (i >= 0 && i < names.length) removeTaxon(i);
  };

  /** Arrow-key navigation over cell inputs (j ≥ 0) and name inputs
   * (j === -1), both addressable by [data-cell="i,j"]. */
  const onKeyDown = (i: number, j: number, e: KeyboardEvent) => {
    const move = (ti: number, tj: number) => {
      e.preventDefault();
      tableRef.current
        ?.querySelector<HTMLInputElement>(`input[data-cell="${ti},${tj}"]`)
        ?.focus();
    };
    switch (e.key) {
      case "ArrowLeft":
        if (j > 0) move(i, j - 1);
        else if (j === 0) move(i, -1);
        break;
      case "ArrowRight":
        if (j === -1) {
          if (i > 0) move(i, 0);
        } else if (j + 1 < i) {
          move(i, j + 1);
        } else if (i + 1 < names.length) {
          move(i + 1, -1);
        }
        break;
      case "ArrowUp":
        if (i > 0) move(i - 1, j >= i - 1 ? -1 : j);
        break;
      case "ArrowDown":
        if (i + 1 < names.length) move(i + 1, j);
        break;
      default:
        return;
    }
  };

  const input = completeInput(names, cells);
  const reason = buildReason(names, cells);
  const problems = cellProblems(names, cells);
  const ready = input !== null && reason === null;
  // The rebuild hint (fix round 2): a tree exists only for a matrix
  // this grid committed — `committed` — so it shows exactly while the
  // on-screen draft differs from that matrix (an incomplete draft
  // differs by definition; the reason above it says why Build is
  // disabled).
  const differs =
    committed !== null && JSON.stringify(input) !== committed;

  const build = () => {
    if (input === null) return;
    setCommitted(JSON.stringify(input));
    setEmittedKey(JSON.stringify(input));
    onChange(input);
  };

  return (
    <div className="matrix-grid-block">
      {/* The caption wraps inside its container (the 320 px Settings
          drawer included); only the table scrolls, inside its own
          named, focusable region (fix round 1). */}
      <p className="matrix-caption" id={`${statusId}-caption`}>
        Lower triangle of the distance matrix — each row holds one
        taxon's distances to the taxa above it.
      </p>
      <div
        className="matrix-grid-wrap"
        role="region"
        aria-label="Scrollable distance matrix"
        tabIndex={0}
      >
        <table
          className="matrix-grid"
          ref={tableRef}
          aria-labelledby={`${statusId}-caption`}
        >
          <tbody>
            {names.map((name, i) => (
              <tr key={i}>
                <th scope="row">
                  <input
                    className="matrix-name"
                    type="text"
                    value={name}
                    aria-label={`Taxon ${i + 1} name`}
                    data-cell={`${i},-1`}
                    onChange={(e) => setName(i, e.target.value)}
                    onKeyDown={(e) => onKeyDown(i, -1, e)}
                  />
                </th>
                {Array.from({ length: i }, (_, j) => (
                  <td key={j}>
                    <input
                      className="matrix-cell"
                      type="text"
                      inputMode="decimal"
                      value={cells[i][j]}
                      aria-label={`Distance between ${names[i]} and ${names[j]}`}
                      aria-invalid={
                        cells[i][j].trim() !== "" &&
                        cellNumber(cells[i][j]) === null
                      }
                      data-cell={`${i},${j}`}
                      onChange={(e) => setCell(i, j, e.target.value)}
                      onKeyDown={(e) => onKeyDown(i, j, e)}
                    />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="matrix-grid-actions">
        <button
          type="button"
          onClick={addTaxon}
          disabled={names.length >= GRID_MAX_TAXA}
        >
          Add taxon
        </button>
        <span className="matrix-remove">
          <select
            ref={removeRef}
            aria-label="Taxon to remove"
            disabled={names.length <= GRID_MIN_TAXA}
          >
            {names.map((n, i) => (
              <option key={i} value={i}>
                {n}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={names.length <= GRID_MIN_TAXA}
            onClick={removeSelected}
          >
            Remove taxon
          </button>
        </span>
        <button
          type="button"
          className="primary"
          disabled={!ready}
          aria-describedby={ready ? undefined : statusId}
          onClick={build}
        >
          Build tree
        </button>
      </div>
      <div
        id={statusId}
        className="matrix-grid-status"
        role="status"
        aria-live="polite"
      >
        {[...new Set([...problems, ...(reason !== null ? [reason] : [])])].map(
          (p) => (
            <p key={p}>{p}</p>
          ),
        )}
        {differs && (
          <p>The matrix changed — press Build tree to rebuild.</p>
        )}
      </div>
    </div>
  );
}
