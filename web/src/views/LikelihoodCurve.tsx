// Likelihood curve for the pair panel (v1.1 plan Task 11, spec §5.2):
// logL vs d drawn as an SVG polyline over the engine's 60 samples, with
// the peak marked at d̂. A saturated pair's curve is still rising at
// the domain edge, so it gets the note "no peak: still rising" and no
// marker. The svg is `role="img"` with an aria-label stating d̂ (§6.5).

export interface LikelihoodCurveProps {
  /** `(d, logL)` samples straight from `PairDetail.curve`. */
  curve: Array<[number, number]>;
  /** The ML estimate; null when saturated. */
  dHat: number | null;
  /** True when `dHat` is null — kept separate so callers pass the
   * engine's two facts without re-deriving either. */
  saturated: boolean;
}

const W = 300;
const H = 130;
const PAD_L = 8;
const PAD_R = 8;
const PAD_T = 10;
const PAD_B = 18;

export function LikelihoodCurve({
  curve,
  dHat,
  saturated,
}: LikelihoodCurveProps) {
  const xMax = curve.length > 0 ? curve[curve.length - 1][0] : 1;
  let yMin = Infinity;
  let yMax = -Infinity;
  for (const [, l] of curve) {
    if (l < yMin) yMin = l;
    if (l > yMax) yMax = l;
  }
  // A flat curve (identical pair: logL barely moves near d̂ = 0) still
  // gets a visible band so the polyline doesn't sit on an axis.
  const span = yMax - yMin;
  if (span > 0) {
    yMin -= span * 0.08;
    yMax += span * 0.08;
  } else {
    yMin -= 1;
    yMax += 1;
  }

  const x = (d: number) =>
    PAD_L + (xMax > 0 ? (d / xMax) * (W - PAD_L - PAD_R) : 0);
  const y = (l: number) =>
    PAD_T + ((yMax - l) / (yMax - yMin)) * (H - PAD_T - PAD_B);

  const points = curve.map(([d, l]) => `${x(d)},${y(l)}`).join(" ");

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
        y1={H - PAD_B}
        x2={W - PAD_R}
        y2={H - PAD_B}
      />
      <line className="axis" x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={H - PAD_B} />
      <text className="axis-label" x={W - PAD_R} y={H - 4} textAnchor="end">
        d
      </text>
      <text className="axis-label" x={PAD_L + 4} y={PAD_T + 4}>
        log L(d)
      </text>
      <polyline className="curve" points={points} fill="none" />
      {peak !== null && (
        <g data-peak="true">
          <line
            className="peak-line"
            x1={peak.px}
            y1={peak.py}
            x2={peak.px}
            y2={H - PAD_B}
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
