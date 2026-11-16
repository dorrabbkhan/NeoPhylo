// Shared print pieces for the worksheet and key pages (v1.4c plan
// Task 11, spec §7.2): the lower-triangle matrix table (filled or
// ruled blank), writing-space blanks, the sketch box and the
// link-plus-QR footer block. Formatting only — every number rendered
// here is an engine value the callers already hold.

import type { ReactNode } from "react";

import { fmt } from "../../explain/math";
import { qrMatrix } from "../../worksheets/qr";

/** A lower-triangle matrix table for print: `names` labels the axes
 * (row names[1..], columns names[0..n-2]) and `values` carries the
 * packed strict lower triangle — null renders the same grid with
 * blank cells to write in. `caption` labels the table for the reader
 * ("Distances", "Q values", "Cluster averages"); `blankHeaders` keeps
 * the same grid shape but empties the header cells so the student
 * writes the cluster names in — naming them would reveal which pair
 * the previous join merged (fix round 1, R1). Values render through
 * the same `fmt` the rest of the key uses (R5). */
export function PrintMatrix({
  names,
  values,
  label,
  caption,
  blankHeaders = false,
}: {
  names: string[];
  values: number[] | null;
  label: string;
  caption?: string;
  blankHeaders?: boolean;
}) {
  return (
    <div
      className="ws-matrix-scroll"
      role="region"
      tabIndex={0}
      aria-label={label}
    >
      <table className="ws-matrix" aria-label={label}>
        {caption !== undefined && <caption>{caption}</caption>}
        <thead>
          <tr>
            <th scope="col" className={blankHeaders ? "ws-cell-blank" : undefined}>
              {blankHeaders ? (
                ""
              ) : (
                <span className="visually-hidden">cluster</span>
              )}
            </th>
            {names.slice(0, -1).map((n, i) => (
              <th
                key={blankHeaders ? i : n}
                scope="col"
                className={blankHeaders ? "ws-cell-blank" : undefined}
              >
                {blankHeaders ? "" : n}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {names.slice(1).map((row, i) => {
            const r = i + 1;
            return (
              <tr key={blankHeaders ? r : row}>
                <th
                  scope="row"
                  className={blankHeaders ? "ws-cell-blank" : undefined}
                >
                  {blankHeaders ? "" : row}
                </th>
                {names.slice(0, r).map((col, j) => {
                  const idx = (r * (r - 1)) / 2 + j;
                  const v = values === null ? null : values[idx];
                  return (
                    <td
                      key={blankHeaders ? j : col}
                      className={v === null ? "ws-cell-blank" : undefined}
                    >
                      {v === null ? "" : fmt(v)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** A "label = ___" fill-in line; `wide` gives a longer ruled space. */
export function Blank({ label, wide = false }: { label: ReactNode; wide?: boolean }) {
  return (
    <span className="ws-fill">
      <span>{label}</span>
      <span className={wide ? "ws-blank ws-blank-wide" : "ws-blank"} aria-hidden="true" />
    </span>
  );
}

/** A ruled writing line for open answers. */
export function RuledLines({ count }: { count: number }) {
  const lines = [];
  for (let i = 0; i < count; i += 1) {
    lines.push(<span key={i} className="ws-rule" aria-hidden="true" />);
  }
  return <span className="ws-rules">{lines}</span>;
}

/** The empty box the student sketches the finished tree into. */
export function SketchBox() {
  return (
    <div
      className="ws-sketch"
      role="img"
      aria-label="blank space to sketch the finished tree"
    />
  );
}

/** The exercise link with its QR code; over-capacity links get the
 * text plus the one-line note and no QR (plan: QR capacity is
 * limited). The QR is literal black-on-white so it scans in either
 * theme — it is a machine-readable code, not UI chrome. */
export function LinkBlock({ link }: { link: string }) {
  const m = qrMatrix(link);
  return (
    <div className="ws-linkblock">
      {m === null ? (
        <p className="ws-link-note">
          This link is too long for a QR code — copy it from below.
        </p>
      ) : (
        <QrSvg matrix={m} />
      )}
      <p className="ws-link-text">
        <a href={link}>{link}</a>
      </p>
    </div>
  );
}

function QrSvg({ matrix }: { matrix: boolean[][] }) {
  const quiet = 4;
  const size = matrix.length + quiet * 2;
  const path: string[] = [];
  matrix.forEach((row, y) => {
    row.forEach((dark, x) => {
      if (dark) path.push(`M${x} ${y}h1v1h-1z`);
    });
  });
  return (
    <svg
      className="ws-qr"
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="QR code linking to this exercise"
    >
      <path fill="#ffffff" d={`M0 0h${size}v${size}h-${size}z`} />
      <path
        fill="#000000"
        d={path.join("")}
        transform={`translate(${quiet} ${quiet})`}
      />
    </svg>
  );
}
