/// <reference types="node" />
import { readFileSync } from "node:fs";

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
        l.nodes.find((n) => n.label === (["A", "B", "C"] as const)[k])!.y,
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

  it("stable_positions: stepping reveals nodes without moving them", () => {
    // Wikipedia 5-taxon NJ worked example (fixtures/worked). Build through
    // the real engine so node ids match the trace records.
    const fx = JSON.parse(
      readFileSync(
        new URL("../../../fixtures/worked/nj_wikipedia5.json", import.meta.url),
        "utf8",
      ),
    ) as { labels: string[]; matrix: { data: number[] } };
    const r = engine.buildTree(
      {
        labels: fx.labels,
        model: "P",
        cells: fx.matrix.data.map((v) => ({ Value: v })),
      },
      "Nj",
      { trace: true },
    );
    if (!r.ok) throw new Error(`buildTree failed: ${JSON.stringify(r.error)}`);
    const { tree, trace } = r.value;
    if (!trace || !("Nj" in trace)) throw new Error("expected an NJ trace");
    const steps = trace.Nj.steps;

    const full = layout(tree, OPTS);
    const fullById = new Map(full.nodes.map((n) => [n.id, n]));

    const leaves = tree.nodes.flatMap((n, id) =>
      n.children.length === 0 ? [id] : [],
    );

    // Plan Task 17: at step k the inferred tree shows the leaves plus the
    // nodes created in steps 1..k; the final join adds the root.
    for (let k = 0; k <= steps.length; k++) {
      const visibleNodes = new Set<number>([
        ...leaves,
        ...steps.slice(0, k).map((s) => s.new_node),
        ...(k === steps.length ? [tree.root] : []),
      ]);
      const l = layout(tree, { ...OPTS, visibleNodes });
      for (const n of l.nodes) {
        const f = fullById.get(n.id)!;
        expect(n.x).toBe(f.x);
        expect(n.y).toBe(f.y);
        // A node whose parent is still hidden draws no stub.
        const parent = tree.nodes[n.id].parent;
        if (parent === null || !visibleNodes.has(parent)) {
          expect(n.parentX).toBe(n.x);
        }
      }
    }
  });

  it("no_negative_x: unclamped negative branches stay inside the canvas", () => {
    const t = parse("(A:-1,B:2,C:3);");
    const l = layout(t, OPTS); // OPTS.clampNegative is false
    for (const n of l.nodes) {
      expect(n.x).toBeGreaterThanOrEqual(0);
    }
    expect(Math.max(...l.nodes.map((n) => n.x))).toBeCloseTo(OPTS.width, 9);
  });

  it("visibleNodes omits hidden nodes and keeps leaf rows distinct", () => {
    const t = parse("((A:1,B:1):1,(C:1,D:1):1);");
    const [a, b, c, d] = ["A", "B", "C", "D"].map((s) => idByLabel(t, s));
    const abParent = t.nodes[a].parent!;
    const cdParent = t.nodes[c].parent!;
    const visible = new Set([a, b, abParent, c, d, cdParent]);
    const l = layout(t, { ...OPTS, visibleNodes: visible });
    // Root is omitted; only the six visible nodes appear.
    expect(l.nodes).toHaveLength(6);
    const ys = ["A", "B", "C", "D"].map(
      (label) => l.nodes.find((n) => n.label === label)!.y,
    );
    // Four distinct leaf rows, cherry (A,B) above cherry (C,D).
    expect(new Set(ys).size).toBe(4);
    expect(ys[0]).toBeLessThan(ys[2]);
    expect(ys[1]).toBeLessThan(ys[3]);
    // A visible node whose parent is hidden draws no stub.
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
