// Likelihood curve for the pair panel (v1.1 plan Task 11, spec §5.2):
// logL vs d drawn as an SVG polyline over the engine's 60 samples, with
// the peak marked at d̂. A saturated pair's curve is still rising at
// the domain edge, so it gets the note "no peak: still rising" and no
// marker. The svg is `role="img"` with an aria-label stating d̂ (§6.5).
//
// Readability (checkpoint 11): near d = 0 logL crashes toward −690
// (the engine floors probabilities at 1e-300), which flattens the peak
// when the whole range is drawn. The y-axis therefore shows only the
// 15 log units below the peak — [logL̂ − 15, logL̂], or
// [max logL − 15, max logL] for a saturated pair. Plotting starts at
// the first sampled point whose logL is finite and inside the window;
// sampled points below the window clip to the bottom edge and get a
// small "below range" marker on the axis. Ticks label d at 0, d̂ and
// the right edge, and logL at the top and bottom of the window.

import { size } from "../design/tokens";
import { fmt } from "../explain/math";

export interface LikelihoodCurveProps {
  /** `(d, logL)` samples straight from `PairDetail.curve`. */
  curve: Array<[number, number]>;
  /** The ML estimate; null when saturated. */
  dHat: number | null;
  /** `logL` at `dHat` — the top of the drawn window; null when
   * saturated (the window tops at the curve's own maximum then). */
  loglHat: number | null;
  /** True when `dHat` is null — kept separate so callers pass the
   * engine's two facts without re-deriving either. */
  saturated: boolean;
}

const W = 300;
const H = 140;
const PAD_R = 8;
/** The top pad leaves a full text row above the top tick for the
 * "log L(d)" title. */
const PAD_T = 26;
const PAD_B = 20;
/** The y-axis window depth, in log units (checkpoint 11). */
const LOG_WINDOW = 15;
/** Upper bound on one glyph's ink width at 12 px: digits measure
 * ~7.9 units and "-"/"." less, so `len * CHAR_W` covers any label
 * fmt can produce. */
const CHAR_W = 8;

/** One axis-label element with the pinned font. */
const axisLabel = (
  x: number,
  y: number,
  s: string,
  anchor?: "start" | "middle" | "end",
  dy?: string,
  cls = "",
) => (
  <text
    className={`axis-label ${cls}`}
    /* Axis labels are pinned to the 12 px token: the plot is a fixed
       300×140 viewBox, so a larger font (presenter mode) would
       overflow the padding its geometry is built around. */
    style={{ fontSize: size.xs }}
    x={x}
    y={y}
    textAnchor={anchor}
    dy={dy}
  >
    {s}
  </text>
);

export function LikelihoodCurve({
  curve,
  dHat,
  loglHat,
  saturated,
}: LikelihoodCurveProps) {
  const xMax = curve.at(-1)?.[0] ?? 1;
  let curveMax = -Infinity;
  for (const [, l] of curve) {
    if (Number.isFinite(l) && l > curveMax) curveMax = l;
  }
  const yTop = loglHat !== null && !saturated ? loglHat : curveMax;
  const yBot = yTop - LOG_WINDOW;
  const yOk = Number.isFinite(yTop);
  const yTopS = yOk ? fmt(yTop) : "";
  const yBotS = yOk ? fmt(yBot) : "";
  // The y-tick labels are right-aligned at padL − 3; the pad must cover
  // their widest ink width plus margin, else a multi-digit negative
  // logL runs off the svg's left edge and loses its minus sign.
  const padL = Math.max(36, CHAR_W * Math.max(yTopS.length, yBotS.length));

  const x = (d: number) =>
    padL + (xMax > 0 ? (d / xMax) * (W - padL - PAD_R) : 0);
  const y = (l: number) => {
    const v = Number.isFinite(l) ? Math.min(Math.max(l, yBot), yTop) : yBot;
    return PAD_T + ((yTop - v) / LOG_WINDOW) * (H - PAD_T - PAD_B);
  };

  // Plot from the first sampled point whose logL is finite and inside
  // the window; the flat lead-in toward d = 0 is reported by the
  // below-range markers instead of drawn as a crushed line.
  const firstIn = curve.findIndex(
    ([, l]) => Number.isFinite(l) && l >= yBot,
  );
  const start = firstIn < 0 ? curve.length : firstIn;
  const drawn = curve.slice(start);
  const points = drawn.map(([d, l]) => `${x(d)},${y(l)}`).join(" ");

  // Every sampled d whose true logL sits below the window — the skipped
  // lead-in plus any later dip — gets a marker on the bottom edge.
  const below: number[] = curve
    .slice(0, start)
    .map(([d]) => d)
    .concat(
      drawn
        .filter(([, l]) => !Number.isFinite(l) || l < yBot)
        .map(([d]) => d),
    );

  // The marker sits on the curve at d̂ by interpolating between the two
  // samples bracketing it.
  let peak: { px: number; py: number } | null = null;
  if (!saturated && dHat !== null && curve.length >= 2) {
    let k = 0;
    while (k + 1 < curve.length && curve[k + 1][0] < dHat) k++;
    const [d0, l0] = curve[k];
    const [d1, l1] = curve[Math.min(k + 1, curve.length - 1)];
    const f = d1 > d0 ? (dHat - d0) / (d1 - d0) : 0;
    peak = { px: x(dHat), py: y(l0 + f * (l1 - l0)) };
  }

  // The d̂ label floats above the marker: keep it right of the title
  // and the y-tick labels, and inside the svg's right edge. The
  // combining circumflex (U+0302) after "d" lands on the stem and
  // reads as "â", so the text is "d = …" and the hat is drawn as a
  // separate path over the glyph.
  const dhatText = `d = ${(dHat ?? 0).toFixed(3)}`;
  const dhatX = Math.min(
    Math.max((peak?.px ?? 0) + 6, padL + 9),
    W - 2 - CHAR_W * dhatText.length,
  );

  const label = saturated
    ? `Likelihood curve for log L(d): still rising at d = ${xMax.toFixed(1)}, no peak`
    : `Likelihood curve for log L(d): peak at distance ${(dHat ?? 0).toFixed(3)}`;
  const axisY = H - PAD_B;

  return (
    <svg
      className="likelihood-curve"
      role="img"
      aria-label={label}
      // Must equal `0 0 ${W} ${H}` — written as a literal to save bytes.
      viewBox="0 0 300 140"
    >
      <path
        className="axis"
        d={`M ${padL} ${axisY}H${W - PAD_R}M ${padL} ${axisY}v3M ${W - PAD_R} ${axisY}v3`}
      />
      <line className="axis" x1={padL} y1={PAD_T} x2={padL} y2={axisY} />
      {/* Ticks: d at 0, d̂ (the peak line) and the right edge; logL at
          the top and bottom of the window. */}
      {/* Baseline for the title row (13): keeps its ink inside the top
          edge and above the top tick's label (12 px ink ≈ baseline
          −11.5 to +2.7). */}
      {axisLabel(2, 13, "log L(d)")}
      {yOk && (
        <>
          {axisLabel(padL - 3, PAD_T, yTopS, "end", "0.32em")}
          {axisLabel(padL - 3, axisY, yBotS, "end", "0.32em")}
          <line
            className="axis"
            x1={padL - 3}
            y1={PAD_T}
            x2={padL}
            y2={PAD_T}
          />
        </>
      )}
      {axisLabel(padL + 3, H - 8, "0", "middle")}
      {axisLabel(W - PAD_R, H - 8, fmt(xMax), "end")}
      {/* The "d" axis name goes in the bottom tick row, centred clear
          of the 0 and right-edge labels — at the axis's right end its
          box met the curve's last vertex. */}
      {axisLabel(W / 2, H - 8, "d", "middle")}
      {drawn.length > 0 && (
        <polyline className="curve" points={points} fill="none" />
      )}
      {below.length > 0 && (
        <path
          className="below-range below-range-mark"
          aria-hidden="true"
          d={below.map((d) => `M ${x(d) - 2.5} ${axisY + 1}l5 0-2.5 4z`).join("")}
        />
      )}
      {peak !== null && (
        <>
          <line
            className="peak-line"
            data-peak
            x1={peak.px}
            y1={peak.py}
            x2={peak.px}
            y2={axisY}
          />
          <circle className="peak-marker" cx={peak.px} cy={peak.py} r={3.5} />
          {axisLabel(dhatX, peak.py - 8, dhatText)}
          {/* The d̂ hat: a small wedge centred over the d's bowl, above
              the ascender (the label baseline is peak.py − 8). */}
          <path
            className="axis-label"
            d={`M ${dhatX + 1} ${peak.py - 20}h4l-2-2z`}
          />
        </>
      )}
      {saturated &&
        axisLabel(W - PAD_R, PAD_T + 8, "no peak: still rising", "end", undefined, "peak-none")}
    </svg>
  );
}
