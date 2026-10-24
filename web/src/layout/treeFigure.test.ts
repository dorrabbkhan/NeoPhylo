// Whole-figure fit tests (owner decision 3A on PR #79, 2026-10-24).
// The checkpoint-11 minBranchPx stretch accumulates down a subtree, so
// the deepest leaf's x plus its name used to overrun the reserved draw
// width — the svg grew wider than .tree-canvas and the leaf label sat
// hidden behind horizontal scroll. treeFigure now refits the layout so
// the whole figure — accumulated stretch, leaf names and pills —
// stays inside the measured panel whenever the tree can fit at all;
// only a tree whose flat minPx floors alone exceed the panel may still
// overflow (the Global Constraints' layout invariant).

import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { Tree } from "../engine/generated/Tree";

import {
  treeFigure,
  FIGURE_LABEL_OFFSET,
  FIGURE_MIN_SUPPORT_BRANCH_PX,
  FIGURE_NODE_RADIUS,
  FIGURE_PANEL_PAD,
} from "./treeFigure";

function parse(nwk: string): Tree {
  const r = engine.parseNewick(nwk);
  if (!r.ok) throw new Error(`parseNewick failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** `support` on every internal non-root edge — the bootstrap case. */
function withSupport(t: Tree, support: number): Tree {
  return {
    ...t,
    branches: t.branches.map((b, id) =>
      t.nodes[id].children.length > 0 && t.nodes[id].parent !== null
        ? { ...b, support }
        : b,
    ),
  };
}

const FIG_OPTS = {
  kind: "phylogram" as const,
  clampNegative: false,
  leafSpacing: 20,
};

/** The label right edge treeFigure itself adds to a leaf's content box
 * (the jsdom path has no glyph probe, so it is the em estimate). */
function leafLabelRight(
  n: { x: number; label: string | null },
  fontSize: number,
): number {
  return (
    n.x +
    FIGURE_LABEL_OFFSET +
    FIGURE_NODE_RADIUS +
    (n.label?.length ?? 0) * fontSize * 0.62
  );
}

describe("treeFigure fit: leaf labels stay inside the panel", () => {
  it("the accumulated support stretch can no longer push a leaf name out", () => {
    // ((A,B),C): A is the deepest leaf AND sits under the stretched
    // internal edge, so its drawn x passed the draw width and its name
    // clipped at the panel's right edge (the PR #79 bug shape).
    const t = withSupport(parse("((A:2,B:1.9):0.02,C:1.5);"), 0.42);
    const panelWidth = 400;
    const fig = treeFigure(t, { ...FIG_OPTS, panelWidth });

    // The stretch really applied — the (A,B) edge draws at the floor.
    const internal = fig.laid.nodes.find(
      (n) => !n.leaf && fig.byId.get(t.nodes[n.id].parent ?? -1) !== undefined,
    );
    expect(internal).toBeDefined();
    expect(internal!.x - internal!.parentX).toBeGreaterThanOrEqual(
      FIGURE_MIN_SUPPORT_BRANCH_PX,
    );

    // Every leaf name's right edge is inside the measured panel…
    const leaves = fig.laid.nodes.filter((n) => n.leaf);
    expect(leaves.length).toBe(3);
    for (const n of leaves) {
      expect(
        leafLabelRight(n, fig.fontSize),
        `leaf ${n.label} overruns the panel`,
      ).toBeLessThanOrEqual(panelWidth);
    }
    // …and so is the whole svg the renderers size from `bounds`.
    const svgWidth = fig.bounds.maxX - fig.bounds.minX + FIGURE_PANEL_PAD * 2;
    expect(svgWidth).toBeLessThanOrEqual(panelWidth);
  });

  it("a stretched ladder refits instead of overflowing", () => {
    // Every leaf shares two stretched ancestors — the accumulated
    // shift overflows the deepest tip by ~2·minPx at the naive scale.
    const t = withSupport(
      parse("(((A:1,B:1):0.01,(C:1,D:1):0.01):0.01,(E:1,F:1):1);"),
      0.35,
    );
    const panelWidth = 320;
    const fig = treeFigure(t, { ...FIG_OPTS, panelWidth });
    for (const n of fig.laid.nodes) {
      if (!n.leaf) continue;
      expect(leafLabelRight(n, fig.fontSize)).toBeLessThanOrEqual(
        panelWidth,
      );
    }
    const svgWidth = fig.bounds.maxX - fig.bounds.minX + FIGURE_PANEL_PAD * 2;
    expect(svgWidth).toBeLessThanOrEqual(panelWidth);
  });

  it("trees without support or without stretch keep their exact fit", () => {
    // No support: the deepest leaf still lands exactly on the draw
    // width — the refit pass only engages on real overflow.
    const t = parse("((A:1,B:2):1,C:3);");
    const fig = treeFigure(t, { ...FIG_OPTS, panelWidth: 400 });
    expect(fig.laid.nodes.every((n) => n.x <= fig.laid.width + 1e-9)).toBe(
      true,
    );
    const svgWidth = fig.bounds.maxX - fig.bounds.minX + FIGURE_PANEL_PAD * 2;
    expect(svgWidth).toBeLessThanOrEqual(400);
  });
});
