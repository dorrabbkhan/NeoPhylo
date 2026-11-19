// The drawing layer of ReadingTree (v1.4d plan Task 7, spec §6): every
// visible, non-interactive part of the figure — edges, node dots and
// letter badges, tip labels, lettered points, trait marks and the time
// axis — inside one aria-hidden group (the hit targets and the text
// description carry the semantics). All positions come from
// `readingLayout`; this file only draws.
//
// Positions and edge paths animate with the swap transition the plan
// decided (300 ms ease-in-out, none under prefers-reduced-motion):
// node groups ride a CSS transform, edges transition the CSS `d`
// property where supported (Chromium/Safari; the `d` attribute is the
// fallback elsewhere).

import type { ReadingTreeView } from "../../engine/generated/ReadingTreeView";
import type {
  ReadingFigure,
  ReadingStyle,
} from "../../layout/readingLayout";
import {
  AXIS_ROOM,
  cladeKey,
  D2R,
  LABEL_GAP,
  NODE_R,
  PAD,
  TIP_LABEL_SLANT_DEG,
} from "../../layout/readingGeom";

import { anim, animD, LETTER_R, pointOffsets } from "./readingHelpers";

/** Trait-mark bar half-length and the glyph size. */
const MARK_HALF = 6;
const MARK_GLYPH = 4.5;

export interface ReadingDrawProps {
  fig: ReadingFigure;
  /** The (possibly locally rotated) view — labels, letters and point
   * `on` clades come from here, positions from `fig`. */
  view: ReadingTreeView;
  style: ReadingStyle;
  fontPx: number;
  selected: string[][];
  highlight: string[];
  reduced: boolean;
  markerId: string;
}

function Badge({ letter, fontPx }: { letter: string; fontPx: number }) {
  return (
    <>
      <circle className="rt-badge" r={LETTER_R} />
      <text
        className="rt-badge-letter"
        fontSize={fontPx}
        dominantBaseline="middle"
        textAnchor="middle"
      >
        {letter}
      </text>
    </>
  );
}

export function ReadingDraw({
  fig,
  view,
  style,
  fontPx,
  selected,
  highlight,
  reduced,
  markerId,
}: ReadingDrawProps) {
  const nodes = view.nodes;
  const byKey = new Map(nodes.map((n, i) => [cladeKey(n.clade), i]));
  const selSet = new Set(selected.map(cladeKey));
  const hlSet = new Set(highlight);
  const offs = pointOffsets(view, byKey, style);

  const fullLabel = (clade: string[]) =>
    nodes[byKey.get(cladeKey(clade)) ?? -1]?.label;

  // A tip label at the anchor readingLayout placed it at — the same
  // NODE_R + LABEL_GAP offset and slant/circular conventions.
  const tipLabel = (nd: ReadingFigure["nodes"][number]) => {
    if (nd.label === undefined) return null;
    const full = fullLabel(nd.clade);
    const text = (x: number, y: number, extra: object) => (
      <text
        key={cladeKey(nd.clade)}
        className="rt-tip-label"
        x={x}
        y={y}
        fontSize={fontPx}
        dominantBaseline="middle"
        fill="currentColor"
        {...extra}
      >
        {nd.label}
        <title>{full ?? nd.label}</title>
      </text>
    );
    if (style.shape === "circular") {
      const a = Math.atan2(nd.y - fig.height / 2, nd.x - fig.width / 2);
      const deg = a / D2R;
      const flip = Math.cos(a) < 0;
      const ax = nd.x + (NODE_R + LABEL_GAP) * Math.cos(a);
      const ay = nd.y + (NODE_R + LABEL_GAP) * Math.sin(a);
      return text(ax, ay, {
        transform: `rotate(${flip ? deg - 180 : deg} ${ax} ${ay})`,
        textAnchor: flip ? "end" : "start",
      });
    }
    switch (style.tips) {
      case "left":
        return text(nd.x - NODE_R - LABEL_GAP, nd.y, {
          textAnchor: "end",
        });
      case "up": {
        const ax = nd.x;
        const ay = nd.y - NODE_R - LABEL_GAP;
        return text(ax, ay, {
          transform: `rotate(${-TIP_LABEL_SLANT_DEG} ${ax} ${ay})`,
          textAnchor: "start",
        });
      }
      case "down": {
        const ax = nd.x;
        const ay = nd.y + NODE_R + LABEL_GAP;
        return text(ax, ay, {
          transform: `rotate(${TIP_LABEL_SLANT_DEG} ${ax} ${ay})`,
          textAnchor: "start",
        });
      }
      default:
        return text(nd.x + NODE_R + LABEL_GAP, nd.y, {
          textAnchor: "start",
        });
    }
  };

  return (
    <g aria-hidden="true">
      {fig.edges.map((e) => {
        const toKey = cladeKey(e.to);
        const hl = hlSet.size > 0 && e.to.every((t) => hlSet.has(t));
        return (
          <path
            key={toKey}
            className="rt-edge"
            data-to={toKey}
            data-hl={hl || undefined}
            d={e.path}
            style={animD(e.path, reduced)}
          />
        );
      })}
      {fig.nodes.map((nd) => {
        const key = cladeKey(nd.clade);
        const sel = selSet.has(key);
        const hl =
          hlSet.size > 0 &&
          nd.clade.length === hlSet.size &&
          nd.clade.every((t) => hlSet.has(t));
        return (
          <g
            key={key}
            className="rt-node rt-anim"
            data-clade={key}
            data-kind={nd.isTip ? "tip" : "node"}
            data-selected={sel || undefined}
            data-hl={hl || undefined}
            style={anim(nd.x, nd.y, reduced)}
          >
            {hl && <circle className="rt-hl-ring" r={LETTER_R + 5} />}
            {sel && <circle className="rt-sel-ring" r={LETTER_R + 3} />}
            {nd.letter !== undefined ? (
              <Badge letter={nd.letter} fontPx={fontPx} />
            ) : (
              <circle className="rt-dot" r={NODE_R} />
            )}
          </g>
        );
      })}
      {fig.nodes.map((nd) => tipLabel(nd))}
      {fig.points.map((pt, i) => {
        const off = offs[i] ?? { x: 0, y: 0 };
        return (
          <g
            key={`pt-${pt.letter}-${i}`}
            className="rt-point rt-anim"
            style={anim(pt.x, pt.y, reduced)}
          >
            {(off.x !== 0 || off.y !== 0) && (
              <line
                className="rt-point-leader"
                x1={0}
                y1={0}
                x2={off.x}
                y2={off.y}
              />
            )}
            <g transform={`translate(${off.x} ${off.y})`}>
              <Badge letter={pt.letter} fontPx={fontPx} />
            </g>
          </g>
        );
      })}
      {fig.marks.map((m, i) => (
        <g
          key={`mk-${m.trait}-${i}`}
          className="rt-mark rt-anim"
          data-change={m.change}
          style={anim(m.x, m.y, reduced)}
        >
          <g transform={`rotate(${m.angle})`}>
            <line
              className="rt-mark-bar"
              x1={0}
              y1={-MARK_HALF}
              x2={0}
              y2={MARK_HALF}
            />
            {m.change === "gain" ? (
              <path
                className="rt-mark-gain"
                d={`M ${MARK_GLYPH * 1.6} 0 L ${-MARK_GLYPH} ${-MARK_GLYPH} L ${-MARK_GLYPH} ${MARK_GLYPH} Z`}
              />
            ) : (
              <circle className="rt-mark-loss" r={MARK_GLYPH} />
            )}
          </g>
          <text
            className="rt-mark-label"
            y={-(MARK_HALF + 4)}
            fontSize={fontPx}
            textAnchor="middle"
          >
            {m.trait}
          </text>
        </g>
      ))}
      {fig.axis !== undefined && (
        <AxisLayer fig={fig} style={style} fontPx={fontPx} markerId={markerId} />
      )}
    </g>
  );
}

/** The time-axis drawing (numeric ticks or the schematic
 * older→younger arrow). Runs horizontally under tips-right/left
 * trees, vertically along the left margin of tips-up/down. */
function AxisLayer({
  fig,
  style,
  fontPx,
  markerId,
}: {
  fig: ReadingFigure;
  style: ReadingStyle;
  fontPx: number;
  markerId: string;
}) {
  const axis = fig.axis!;
  const horizontal = style.tips === "right" || style.tips === "left";
  const xs = fig.nodes.map((n) => n.x);
  const ys = fig.nodes.map((n) => n.y);
  const lo = horizontal ? Math.min(...xs) : Math.min(...ys);
  const hi = horizontal ? Math.max(...xs) : Math.max(...ys);
  // The arrow points at the tips: max-x for "right", min-x for "left",
  // min-y for "up" (tips on top), max-y for "down".
  const tipEnd = style.tips === "right" || style.tips === "down" ? hi : lo;
  const oldEnd = style.tips === "right" || style.tips === "down" ? lo : hi;
  const unit = axis.unit !== undefined ? ` ${axis.unit}` : "";

  if (horizontal) {
    const y = fig.height - PAD - 10;
    const labY = fig.height - 5;
    const sign = style.tips === "right" ? 1 : -1;
    return (
      <g className="rt-axis">
        <line
          className="rt-axis-line"
          x1={oldEnd}
          y1={y}
          x2={tipEnd - sign * 6}
          y2={y}
          markerEnd={`url(#${markerId})`}
        />
        <ArrowHead id={markerId} />
        {axis.ticks.map((t, i) => (
          <g key={`tk-${i}`}>
            <line
              className="rt-axis-tick"
              x1={t.at}
              y1={y - 4}
              x2={t.at}
              y2={y}
            />
            <text
              className="rt-axis-label"
              x={t.at}
              y={labY}
              fontSize={fontPx}
              textAnchor="middle"
            >
              {i === 0 ? `${t.label}${unit}` : t.label}
            </text>
          </g>
        ))}
        {axis.schematic && (
          <>
            <text
              className="rt-axis-label"
              x={oldEnd}
              y={labY}
              fontSize={fontPx}
              textAnchor={sign === 1 ? "start" : "end"}
            >
              older
            </text>
            <text
              className="rt-axis-label"
              x={tipEnd}
              y={labY}
              fontSize={fontPx}
              textAnchor={sign === 1 ? "end" : "start"}
            >
              younger{unit}
            </text>
          </>
        )}
      </g>
    );
  }
  // Vertical axis (tips-up/down): the layout reserves the left
  // AXIS_ROOM px for it. Numbers stay horizontal, end-anchored next to
  // their tick; words — the unit and the schematic older/younger —
  // read up the strip rotated, since they cannot fit in 30 px
  // horizontally ("younger Ma" ≈ 60 px).
  const x = PAD + AXIS_ROOM - 4;
  const sign = style.tips === "up" ? -1 : 1;
  const towardTips = tipEnd > oldEnd ? 1 : -1;
  // Rotated captions read up the strip's far-left column; each word is
  // centred inside the strip end it names so it cannot overshoot the
  // figure edge.
  const WORD_X = PAD + 6;
  const rotated = (uy: number, text: string) => (
    <text
      className="rt-axis-label rt-axis-words"
      fontSize={fontPx}
      textAnchor="middle"
      transform={`rotate(-90 ${WORD_X} ${uy})`}
      x={WORD_X}
      y={uy}
    >
      {text}
    </text>
  );
  return (
    <g className="rt-axis">
      <line
        className="rt-axis-line"
        x1={x}
        y1={oldEnd}
        x2={x}
        y2={tipEnd - sign * 6}
        markerEnd={`url(#${markerId})`}
      />
      <ArrowHead id={markerId} />
      {axis.ticks.map((t) => (
        <g key={`tk-${t.at}`}>
          <line className="rt-axis-tick" x1={x - 4} y1={t.at} x2={x} y2={t.at} />
          <text
            className="rt-axis-label"
            x={x - 6}
            y={t.at}
            fontSize={fontPx}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {t.label}
          </text>
        </g>
      ))}
      {unit !== "" && rotated((oldEnd + tipEnd) / 2, `(${unit.trim()})`)}
      {axis.schematic && (
        <>
          {rotated(oldEnd + towardTips * 30, "older")}
          {rotated(tipEnd - towardTips * 30, "younger")}
        </>
      )}
    </g>
  );
}

function ArrowHead({ id }: { id: string }) {
  return (
    <defs>
      <marker
        id={id}
        markerWidth="8"
        markerHeight="8"
        refX="6"
        refY="3"
        orient="auto"
      >
        <path className="rt-arrowhead" d="M 0 0 L 6 3 L 0 6 Z" />
      </marker>
    </defs>
  );
}
