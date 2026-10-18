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
const PAD_L = 36;
const PAD_R = 8;
const PAD_T = 14;
const PAD_B = 20;
/** The y-axis window depth, in log units (checkpoint 11). */
const LOG_WINDOW = 15;

export function LikelihoodCurve({
  curve,
  dHat,
  loglHat,
  saturated,
}: LikelihoodCurveProps) {
  const xMax = curve.length > 0 ? curve[curve.length - 1][0] : 1;
  let curveMax = -Infinity;
  for (const [, l] of curve) {
    if (Number.isFinite(l) && l > curveMax) curveMax = l;
  }
  const yTop = loglHat !== null && !saturated ? loglHat : curveMax;
  const yBot = yTop - LOG_WINDOW;

  const x = (d: number) =>
    PAD_L + (xMax > 0 ? (d / xMax) * (W - PAD_L - PAD_R) : 0);
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

  const label = saturated
    ? `Likelihood curve for log L(d): still rising at d = ${xMax.toFixed(1)}, no peak`
    : `Likelihood curve for log L(d): peak at distance ${(dHat ?? 0).toFixed(3)}`;
  const axisY = H - PAD_B;

  return (
    <svg
      className="likelihood-curve"
      role="img"
      aria-label={label}
      viewBox={`0 0 ${W} ${H}`}
    >
      <line
        className="axis"
        x1={PAD_L}
        y1={axisY}
        x2={W - PAD_R}
        y2={axisY}
      />
      <line className="axis" x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={axisY} />
      {/* Ticks: d at 0, d̂ (the peak line) and the right edge; logL at
          the top and bottom of the window. */}
      <text className="axis-label" x={2} y={8}>
        log L(d)
      </text>
      {Number.isFinite(yTop) && (
        <>
          <text
            className="axis-label"
            x={PAD_L - 3}
            y={PAD_T}
            textAnchor="end"
            dy="0.32em"
          >
            {fmt(yTop)}
          </text>
          <text
            className="axis-label"
            x={PAD_L - 3}
            y={axisY}
            textAnchor="end"
            dy="0.32em"
          >
            {fmt(yBot)}
          </text>
          <line
            className="axis"
            x1={PAD_L - 3}
            y1={PAD_T}
            x2={PAD_L}
            y2={PAD_T}
          />
        </>
      )}
      <text
        className="axis-label"
        x={PAD_L}
        y={H - 8}
        textAnchor="middle"
      >
        0
      </text>
      <line
        className="axis"
        x1={PAD_L}
        y1={axisY}
        x2={PAD_L}
        y2={axisY + 3}
      />
      <text className="axis-label" x={W - PAD_R} y={H - 8} textAnchor="end">
        {fmt(xMax)}
      </text>
      <line
        className="axis"
        x1={W - PAD_R}
        y1={axisY}
        x2={W - PAD_R}
        y2={axisY + 3}
      />
      <text
        className="axis-label"
        x={W - PAD_R}
        y={axisY - 3}
        textAnchor="end"
      >
        d
      </text>
      {drawn.length > 0 && (
        <polyline className="curve" points={points} fill="none" />
      )}
      {below.length > 0 && (
        <g className="below-range" aria-hidden="true">
          {below.map((d, i) => (
            <path
              key={i}
              className="below-range-mark"
              d={`M ${x(d) - 2.5} ${axisY + 1} l 5 0 l -2.5 4 z`}
            />
          ))}
        </g>
      )}
      {peak !== null && (
        <g data-peak="true">
          <line
            className="peak-line"
            x1={peak.px}
            y1={peak.py}
            x2={peak.px}
            y2={axisY}
          />
          <circle className="peak-marker" cx={peak.px} cy={peak.py} r={3.5} />
          <text
            className="axis-label"
            x={Math.min(peak.px + 6, W - 40)}
            y={peak.py - 6}
          >
            {`d̂ = ${(dHat ?? 0).toFixed(3)}`}
          </text>
        </g>
      )}
      {saturated && (
        <text
          className="axis-label peak-none"
          x={W - PAD_R}
          y={PAD_T + 8}
          textAnchor="end"
        >
          no peak: still rising
        </text>
      )}
    </svg>
  );
}
