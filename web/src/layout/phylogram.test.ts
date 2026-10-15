import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { Tree } from "../engine/generated/Tree";

import { layout } from "./phylogram";

function parse(nwk: string): Tree {
  const r = engine.parseNewick(nwk);
  if (!r.ok) throw new Error(`parseNewick failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

function idByLabel(tree: Tree, label: string): number {
  const i = tree.nodes.findIndex((n) => n.label === label);
  if (i < 0) throw new Error(`no node labeled ${label}`);
  return i;
}

const OPTS = {
  kind: "phylogram" as const,
  clampNegative: false,
  leafSpacing: 20,
  width: 400,
};

describe("layout", () => {
  it("phylogram x is cumulative branch length times scale", () => {
    const t = parse("((A:1,B:2):1,C:3);");
    const l = layout(t, OPTS);
    const xa = l.nodes.find((n) => n.label === "A")!.x;
    const xb = l.nodes.find((n) => n.label === "B")!.x;
    const xc = l.nodes.find((n) => n.label === "C")!.x;
    // Root-to-tip lengths: A = 2, B = 3, C = 3.
    expect(xa / 2).toBeCloseTo(xb / 3, 9);
    expect(xb).toBeCloseTo(xc, 9);
    // Leaves spaced evenly, strictly increasing in preorder (A, B, C).
    const leafYs = [xa, xb, xc].map(
      (_, k) =>
        l.nodes.find(
          (n) => n.label === (["A", "B", "C"] as const)[k],
        )!.y,
    );
    expect(leafYs[0]).toBeLessThan(leafYs[1]);
    expect(leafYs[1]).toBeLessThan(leafYs[2]);
  });

  it("cladogram aligns all leaves at the same x", () => {
    const t = parse("((A:1,B:2):1,C:3);");
    const l = layout(t, { ...OPTS, kind: "cladogram" });
    const xs = ["A", "B", "C"].map(
      (label) => l.nodes.find((n) => n.label === label)!.x,
    );
    expect(xs[0]).toBeCloseTo(xs[1], 9);
    expect(xs[1]).toBeCloseTo(xs[2], 9);
  });

  it("clampNegative draws a negative branch as zero but keeps the flag", () => {
    const t = parse("((A:1,B:-1):1,C:3);");
    const clamped = layout(t, { ...OPTS, clampNegative: true });
    const b = clamped.nodes.find((n) => n.label === "B")!;
    // Child x equals the parent's x: the −1 branch contributes 0.
    expect(b.x).toBeCloseTo(b.parentX, 9);
    expect(b.negative).toBe(true);
    // Without clamping the flag still marks the branch for styling.
    const unclamped = layout(t, OPTS);
    const bu = unclamped.nodes.find((n) => n.label === "B")!;
    expect(bu.negative).toBe(true);
    expect(bu.x).toBeLessThan(bu.parentX);
  });

  it("visibleNodes lays out two cherries as a forest without overlap", () => {
    const t = parse("((A:1,B:1):1,(C:1,D:1):1);");
    const [a, b, c, d] = ["A", "B", "C", "D"].map((s) => idByLabel(t, s));
    const abParent = t.nodes[a].parent!;
    const cdParent = t.nodes[c].parent!;
    const visible = new Set([a, b, abParent, c, d, cdParent]);
    const l = layout(t, { ...OPTS, visibleNodes: visible });
    // Root and its edges are omitted; only the six visible nodes appear.
    expect(l.nodes).toHaveLength(6);
    const ys = ["A", "B", "C", "D"].map(
      (label) => l.nodes.find((n) => n.label === label)!.y,
    );
    // Four distinct rows, cherry (A,B) above cherry (C,D).
    expect(new Set(ys).size).toBe(4);
    expect(ys[0]).toBeLessThan(ys[2]);
    expect(ys[1]).toBeLessThan(ys[3]);
    // Forest roots have no stub to an invisible parent.
    const ab = l.nodes.find((n) => n.id === abParent)!;
    expect(ab.parentX).toBe(ab.x);
  });

  it("is pure: same input gives deep-equal output", () => {
    const t = parse("((A:1,B:2):1,C:3);");
    const first = layout(t, OPTS);
    const second = layout(t, OPTS);
    expect(second).toEqual(first);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });
});
