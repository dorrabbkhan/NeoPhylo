// The point and branch hit layers of ReadingTree (split out so the
// shell stays single-purpose). Same contract as the node hits in
// ReadingTree.tsx: invisible always-on core plus an ≥40×40 pad under
// `(pointer: coarse)`, treeitem role, Enter/Space selects, and the
// same 300 ms ease-in-out (or instant under reduced-motion) position
// animation so the targets ride along with a rotation.

import type { ReadingTreeView } from "../../engine/generated/ReadingTreeView";
import type {
  ReadingFigure,
  ReadingStyle,
} from "../../layout/readingLayout";
import { cladeKey } from "../../layout/readingGeom";

import {
  anim,
  describe,
  FOCUS_R,
  HIT_CORE,
  hitPad,
  type PickFn,
  pointOffsets,
} from "./readingHelpers";

interface CommonProps {
  fig: ReadingFigure;
  view: ReadingTreeView;
  style: ReadingStyle;
  byKey: Map<string, number>;
  selSet: Set<string>;
  reduced: boolean;
  pick: PickFn;
}

/** A hit group for one lettered point — sits at the (possibly
 * de-collided) badge spot and reports the underlying clade. */
export function PointHits({
  fig,
  view,
  style,
  byKey,
  selSet,
  reduced,
  pick,
}: CommonProps) {
  const offs = pointOffsets(view, byKey, style);
  return (
    <>
      {fig.points.map((pt, i) => {
        const off = offs[i] ?? { x: 0, y: 0 };
        const p = view.points[i];
        if (p === undefined) return null;
        const key = cladeKey(p.on);
        const j = byKey.get(key) ?? -1;
        if (j < 0) return null;
        return (
          <g
            key={`pth-${pt.letter}-${i}`}
            className="rt-hit rt-point-hit"
            role="treeitem"
            aria-selected={selSet.has(key) || undefined}
            aria-label={`Point ${pt.letter}`}
            tabIndex={0}
            data-clade={key}
            data-kind="point"
            data-letter={pt.letter}
            style={anim(pt.x + off.x, pt.y + off.y, reduced)}
            onClick={() => pick(j, "point", pt.letter)}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                pick(j, "point", pt.letter);
              }
            }}
          >
            <rect className="rt-hit-pad" {...hitPad(0, 0)} />
            <circle className="rt-hit-core" r={HIT_CORE} />
            <circle className="rt-hit-ring" r={FOCUS_R} />
          </g>
        );
      })}
    </>
  );
}

/** A hit group per edge — an invisible fat line over the branch plus
 * the coarse pad at its midpoint. */
export function BranchHits({
  fig,
  view,
  byKey,
  selSet,
  reduced,
  pick,
}: Omit<CommonProps, "style">) {
  const pos = new Map(fig.nodes.map((n) => [cladeKey(n.clade), n]));
  return (
    <>
      {fig.edges.map((e) => {
        const key = cladeKey(e.to);
        const j = byKey.get(key) ?? -1;
        if (j < 0) return null;
        const a = pos.get(cladeKey(e.from));
        const b = pos.get(key);
        if (a === undefined || b === undefined) return null;
        const mx = (a.x + b.x) / 2;
        const my = (a.y + b.y) / 2;
        return (
          <g
            key={`bh-${key}`}
            className="rt-hit rt-branch-hit"
            role="treeitem"
            aria-selected={selSet.has(key) || undefined}
            aria-label={`Branch to ${describe(e.to, view.nodes[j].letter, null)}`}
            tabIndex={0}
            data-clade={key}
            data-kind="branch"
            style={anim(mx, my, reduced)}
            onClick={() => pick(j, "branch")}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                pick(j, "branch");
              }
            }}
          >
            <path
              className="rt-branch-line"
              d={e.path}
              transform={`translate(${-mx} ${-my})`}
            />
            <rect className="rt-hit-pad" {...hitPad(0, 0)} />
            <circle className="rt-hit-ring" r={FOCUS_R} />
          </g>
        );
      })}
    </>
  );
}
