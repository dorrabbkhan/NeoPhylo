// Observed-vs-true divergence chart (plan Task 19, spec §6.3). Each pair
// of sequences is a point (p, true path length through the true tree);
// the JC69 expectation p = ¾(1 − e^(−4d/3)) and its dashed 0.75
// asymptote show why a corrected distance cannot be estimated once p
// reaches the ceiling.
//
// The p values and path lengths are computed by the caller
// (TeachingNotices): p comes from the engine's uncorrected "P" model —
// no distance math is ever reimplemented in TypeScript.

export interface ChartPoint {
  /** Observed p-distance for the pair (engine "P" model). */
  p: number;
  /** True distance: the pair's path length through the true tree. */
  d: number;
}

export interface SaturationChartProps {
  /** One point per comparable pair of the current alignment. */
  points: ChartPoint[];
}

const W = 280;
const H = 176;
const PAD_L = 32; // y-axis tick labels
const PAD_R = 10;
const PAD_T = 8;
const PAD_B = 26; // x-axis ticks + title
const P_MAX = 1;
const ASYMPTOTE = 0.75;
/** The curve's spec domain (§6.3, "[0, 2]"); the axis extends past it
 * only when a plotted pair's true distance lies further out. */
const D_MAX = 2;
const SAMPLES = 60;
const FONT = 9;

/** JC69 expectation of the observed difference at true distance d. */
const jc69 = (d: number) => ASYMPTOTE * (1 - Math.exp((-4 * d) / 3));

export function SaturationChart({ points }: SaturationChartProps) {
  const xMax = Math.max(D_MAX, ...points.map((pt) => pt.d));
  const px = (d: number) => PAD_L + (d / xMax) * (W - PAD_L - PAD_R);
  const py = (p: number) =>
    PAD_T + (1 - Math.min(P_MAX, p) / P_MAX) * (H - PAD_T - PAD_B);

  const curve: string[] = [];
  for (let k = 0; k <= SAMPLES; k++) {
    const d = (k / SAMPLES) * xMax;
    curve.push(
      `${k === 0 ? "M" : "L"}${px(d).toFixed(2)},${py(jc69(d)).toFixed(2)}`,
    );
  }

  const midY = (PAD_T + py(0)) / 2;

  return (
    <svg
      role="img"
      aria-label="Observed differences p plotted against true distance d, with the JC69 curve approaching its 0.75 asymptote"
      viewBox={`0 0 ${W} ${H}`}
      className="saturation-chart"
    >
      {/* axes */}
      <line
        x1={PAD_L}
        y1={py(0)}
        x2={W - PAD_R}
        y2={py(0)}
        stroke="currentColor"
        strokeWidth={1}
      />
      <line
        x1={PAD_L}
        y1={PAD_T}
        x2={PAD_L}
        y2={py(0)}
        stroke="currentColor"
        strokeWidth={1}
      />

      {/* dashed asymptote at p = 0.75, labeled */}
      <line
        className="asymptote"
        x1={PAD_L}
        y1={py(ASYMPTOTE)}
        x2={W - PAD_R}
        y2={py(ASYMPTOTE)}
        stroke="currentColor"
        strokeWidth={1}
        strokeDasharray="4 3"
      />
      <text
        x={W - PAD_R}
        y={py(ASYMPTOTE) - 3}
        fontSize={FONT}
        fill="currentColor"
        textAnchor="end"
      >
        p = 0.75
      </text>

      {/* JC69 curve p = ¾(1 − e^(−4d/3)) */}
      <path
        className="curve"
        d={curve.join(" ")}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
      />

      {/* ticks and axis titles */}
      <text
        x={PAD_L - 4}
        y={py(0)}
        fontSize={FONT}
        fill="currentColor"
        textAnchor="end"
        dominantBaseline="middle"
      >
        0
      </text>
      <text
        x={PAD_L - 4}
        y={py(P_MAX)}
        fontSize={FONT}
        fill="currentColor"
        textAnchor="end"
        dominantBaseline="middle"
      >
        1
      </text>
      <text
        x={PAD_L}
        y={py(0) + 12}
        fontSize={FONT}
        fill="currentColor"
        textAnchor="middle"
      >
        0
      </text>
      <text
        x={W - PAD_R}
        y={py(0) + 12}
        fontSize={FONT}
        fill="currentColor"
        textAnchor="middle"
      >
        {xMax.toFixed(xMax % 1 === 0 ? 0 : 1)}
      </text>
      <text
        x={(PAD_L + W - PAD_R) / 2}
        y={H - 4}
        fontSize={FONT}
        fill="currentColor"
        textAnchor="middle"
      >
        true distance d
      </text>
      <text
        transform={`rotate(-90 ${PAD_L - 22} ${midY})`}
        x={PAD_L - 22}
        y={midY}
        fontSize={FONT}
        fill="currentColor"
        textAnchor="middle"
        dominantBaseline="middle"
      >
        p
      </text>

      {/* one point per comparable pair; clip to the plot area */}
      <clipPath id="saturation-clip">
        <rect
          x={PAD_L}
          y={PAD_T}
          width={W - PAD_L - PAD_R}
          height={H - PAD_T - PAD_B}
        />
      </clipPath>
      <g clipPath="url(#saturation-clip)">
        {points.map((pt, k) => (
          <circle
            key={k}
            className="point"
            cx={px(pt.d)}
            cy={py(pt.p)}
            r={3}
            fill="currentColor"
          />
        ))}
      </g>
    </svg>
  );
}
