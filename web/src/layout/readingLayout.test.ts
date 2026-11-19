/// <reference types="node" />
import { describe, expect, it } from "vitest";

import type { ReadingTreeView } from "../engine/generated/ReadingTreeView";
import type { ReadingViewNode } from "../engine/generated/ReadingViewNode";
import type { Shape } from "../engine/generated/Shape";
import type { TipSide } from "../engine/generated/TipSide";

import { intersects } from "./labelCollision";
import { readingLayout, type ReadingFigure } from "./readingLayout";

// Hand-built views (no engine round-trip needed — the layout input is the
// generated ReadingTreeView type). `N` describes a node recursively; the
// builder emits the real engine arena order — leaves 0..L in document
// order, then internal nodes in preorder (so an internal child always has
// a HIGHER index than its parent), like `into_tree` in
// crates/neophylo-core/src/newick.rs — plus parent links and clade keys
// like the engine's `reading_tree` does.
interface N {
  label?: string;
  letter?: string;
  age?: number;
  kids?: N[];
}

function buildView(spec: N, extra: Partial<ReadingTreeView> = {}): ReadingTreeView {
  const tipsUnder = (n: N, out: string[]) => {
    if (!n.kids || n.kids.length === 0) {
      out.push(n.label ?? "?");
      return;
    }
    n.kids.forEach((k) => tipsUnder(k, out));
  };
  // Flatten in preorder (parent before children).
  const flat: { n: N; parent: number | null; kids: number[] }[] = [];
  const flatten = (n: N, parent: number | null): number => {
    const me = flat.length;
    flat.push({ n, parent, kids: [] });
    for (const k of n.kids ?? []) flat[me].kids.push(flatten(k, me));
    return me;
  };
  flatten(spec, null);
  const id = new Array<number>(flat.length).fill(-1);
  let next = 0;
  for (let i = 0; i < flat.length; i += 1)
    if (flat[i].kids.length === 0) id[i] = next++;
  for (let i = 0; i < flat.length; i += 1)
    if (flat[i].kids.length > 0) id[i] = next++;
  const nodes: ReadingViewNode[] = new Array(flat.length);
  for (let i = 0; i < flat.length; i += 1) {
    const tips: string[] = [];
    tipsUnder(flat[i].n, tips);
    const p = flat[i].parent;
    nodes[id[i]] = {
      clade: tips.slice().sort(),
      parent: p === null ? null : id[p],
      children: flat[i].kids.map((k) => id[k]),
      label: flat[i].n.label ?? null,
      letter: flat[i].n.letter ?? null,
      age: flat[i].n.age ?? null,
    };
  }
  return {
    nodes,
    root: id[0],
    points: [],
    marks: [],
    traits: [],
    times: "none",
    unit: null,
    ...extra,
  };
}

const measure = (s: string) => s.length * 7.5;
const BOX = { width: 480, fontPx: 12 };
const SHAPES: Shape[] = ["rectangular", "diagonal", "circular"];
const SIDES: TipSide[] = ["right", "up", "left", "down"];

// A balanced 8-tip tree with node letters on its two 4-tip clades.
const T8: N = {
  kids: [
    {
      letter: "P",
      kids: [
        { kids: [{ label: "a" }, { label: "b" }] },
        { kids: [{ label: "c" }, { label: "d" }] },
      ],
    },
    {
      letter: "Q",
      kids: [
        { kids: [{ label: "e" }, { label: "f" }] },
        { kids: [{ label: "g" }, { label: "h" }] },
      ],
    },
  ],
};

function tip(fig: ReadingFigure, label: string) {
  const n = fig.nodes.find((n) => n.isTip && n.label === label);
  if (!n) throw new Error(`tip ${label} not laid out`);
  return n;
}

function nodeAt(fig: ReadingFigure, clade: string[]) {
  const key = JSON.stringify([...clade].sort());
  const n = fig.nodes.find((n) => JSON.stringify(n.clade) === key);
  if (!n) throw new Error(`node ${key} not laid out`);
  return n;
}

function viewId(view: ReadingTreeView, clade: string[]): number {
  const key = JSON.stringify([...clade].sort());
  const i = view.nodes.findIndex((nd) => JSON.stringify(nd.clade) === key);
  if (i < 0) throw new Error(`clade ${key} not in view`);
  return i;
}

// The tip direction a circular drawing's 330° arc is centred on, per
// side (mirrors readingCircular.ts).
const TIP_DIR: Record<TipSide, number> = {
  right: 0,
  down: 90,
  left: 180,
  up: -90,
};

// Angle of figure node i around the figure centre, in degrees relative
// to the tip direction, wrapped to (−180, 180]. Every non-root node has
// rad > 0 so atan2 is meaningful; the root sits exactly at the centre.
function relAngle(fig: ReadingFigure, i: number, tips: TipSide): number {
  const nd = fig.nodes[i];
  const deg =
    Math.atan2(nd.y - fig.height / 2, nd.x - fig.width / 2) /
    (Math.PI / 180);
  return ((deg - TIP_DIR[tips] + 540) % 360) - 180;
}

// Every internal node's angle is the midpoint of the RESOLVED angles of
// its first and last children (polytomies: still first/last). The root's
// own angle is unobservable (rad 0 — its edges start at the centre), so
// assert its position instead.
function expectMidpointAngles(
  view: ReadingTreeView,
  fig: ReadingFigure,
  tips: TipSide,
): void {
  expect(fig.nodes[view.root].x).toBeCloseTo(fig.width / 2, 6);
  expect(fig.nodes[view.root].y).toBeCloseTo(fig.height / 2, 6);
  for (let i = 0; i < view.nodes.length; i += 1) {
    const kids = view.nodes[i].children;
    if (kids.length === 0 || i === view.root) continue;
    expect(relAngle(fig, i, tips)).toBeCloseTo(
      (relAngle(fig, kids[0], tips) +
        relAngle(fig, kids[kids.length - 1], tips)) /
        2,
      6,
    );
  }
}

describe("readingLayout", () => {
  it.each(SHAPES.flatMap((shape) => SIDES.map((tips) => ({ shape, tips }))))(
    "$shape tips-$tips: every tip drawn, letters on their nodes, no overlapping label boxes",
    ({ shape, tips }) => {
      const view = buildView(T8);
      const fig = readingLayout(view, { shape, tips }, BOX, measure);
      const out = fig.nodes.filter((n) => n.isTip);
      expect(out).toHaveLength(8);
      expect(out.map((n) => n.label).sort()).toEqual([..."abcdefgh"]);
      expect(fig.edges).toHaveLength(view.nodes.length - 1);

      for (const [clade, letter] of [
        [["a", "b", "c", "d"], "P"],
        [["e", "f", "g", "h"], "Q"],
      ] as const) {
        const n = nodeAt(fig, [...clade]);
        expect(n.letter).toBe(letter);
        expect(n.isTip).toBe(false);
        expect(n.x).toBeGreaterThanOrEqual(0);
        expect(n.y).toBeGreaterThanOrEqual(0);
        expect(n.x).toBeLessThanOrEqual(fig.width);
        expect(n.y).toBeLessThanOrEqual(fig.height);
      }

      const boxes = out.map((n) => n.labelBox!);
      for (const b of boxes) {
        expect(b).toBeDefined();
        expect(b.minX).toBeGreaterThanOrEqual(-0.5);
        expect(b.minY).toBeGreaterThanOrEqual(-0.5);
        expect(b.maxX).toBeLessThanOrEqual(fig.width + 0.5);
        expect(b.maxY).toBeLessThanOrEqual(fig.height + 0.5);
      }
      for (let i = 0; i < boxes.length; i += 1) {
        for (let j = i + 1; j < boxes.length; j += 1) {
          expect(intersects(boxes[i], boxes[j])).toBe(false);
        }
      }
    },
  );

  it.each([
    ["rectangular", "right"],
    ["diagonal", "right"],
    ["rectangular", "up"],
    ["circular", "right"],
  ] as [Shape, TipSide][])(
    "%s tips-%s: polytomy children are evenly spaced (Review Focus 1)",
    (shape, tips) => {
      const view = buildView({
        kids: [
          { letter: "P", kids: [{ label: "a" }, { label: "b" }, { label: "c" }] },
          { label: "d" },
        ],
      });
      const fig = readingLayout(view, { shape, tips }, BOX, measure);
      const axis = (l: string): number => {
        const n = tip(fig, l);
        if (shape === "circular") {
          // Angular position around the centre.
          const a = Math.atan2(n.y - fig.height / 2, n.x - fig.width / 2);
          return a;
        }
        return tips === "up" ? n.x : n.y;
      };
      const p = ["a", "b", "c"].map(axis);
      expect(p[1] - p[0]).toBeCloseTo(p[2] - p[1], 6);
      expect(p[1]).toBeGreaterThan(p[0]);
    },
  );

  it.each(SIDES)(
    "circular tips-%s: internal nodes sit at the midpoint of their first/last children's resolved angles",
    (tips) => {
      // Arena order is leaves 0..7, internals preorder — internal
      // children always outrank their parent, so an ascending-index
      // pass would read unresolved angles.
      const view = buildView(T8);
      const fig = readingLayout(view, { shape: "circular", tips }, BOX, measure);
      expectMidpointAngles(view, fig, tips);
      // The nested internals are NOT at the tip-side centre: P and Q
      // sit on the bisectors of their 4-tip arcs (leaf slots 0..3 and
      // 4..7 of 8), ∓330×(0.5−3/14) ≈ ∓94.29°.
      const p = viewId(view, ["a", "b", "c", "d"]);
      const q = viewId(view, ["e", "f", "g", "h"]);
      expect(relAngle(fig, p, tips)).toBeCloseTo(-94.2857, 3);
      expect(relAngle(fig, q, tips)).toBeCloseTo(94.2857, 3);
      expect(Math.abs(relAngle(fig, p, tips))).toBeGreaterThan(45);
      expect(Math.abs(relAngle(fig, q, tips))).toBeGreaterThan(45);
    },
  );

  it.each(SIDES)(
    "circular tips-%s: a 3-way polytomy inside a nested clade resolves bottom-up",
    (tips) => {
      // ((a,(c,d,e)),(f,g)): the polytomy (c,d,e) is nested inside
      // (a,c,d,e); its angle is the midpoint of c and e, not a mean
      // over all three children.
      const view = buildView({
        kids: [
          {
            kids: [
              { label: "a" },
              { kids: [{ label: "c" }, { label: "d" }, { label: "e" }] },
            ],
          },
          { kids: [{ label: "f" }, { label: "g" }] },
        ],
      });
      const fig = readingLayout(view, { shape: "circular", tips }, BOX, measure);
      expectMidpointAngles(view, fig, tips);
      // 6 leaves, slots 0..5: c=−99°, e=+33° ⇒ (c,d,e)=−33°;
      // (a,c,d,e) = midpoint of a (−165°) and (c,d,e) = −99° — both far
      // from the tip-side centre.
      const m = viewId(view, ["c", "d", "e"]);
      const p = viewId(view, ["a", "c", "d", "e"]);
      expect(relAngle(fig, m, tips)).toBeCloseTo(-33, 4);
      expect(relAngle(fig, p, tips)).toBeCloseTo(-99, 4);
      expect(Math.abs(relAngle(fig, m, tips))).toBeGreaterThan(10);
      expect(Math.abs(relAngle(fig, p, tips))).toBeGreaterThan(10);
    },
  );

  it.each(SHAPES.flatMap((shape) => SIDES.map((tips) => ({ shape, tips }))))(
    "$shape tips-$tips: 30-char names abbreviate to 16 + ellipsis, never clipped",
    ({ shape, tips }) => {
      const a30 = "A".repeat(30);
      const b30 = "B".repeat(30);
      const fig = readingLayout(
        buildView({ kids: [{ label: a30 }, { label: b30 }] }),
        { shape, tips },
        { width: 200, fontPx: 12 },
        measure,
      );
      const out = fig.nodes.filter((n) => n.isTip);
      expect(out).toHaveLength(2);
      expect(out.map((n) => n.label).sort()).toEqual([
        `${"A".repeat(16)}…`,
        `${"B".repeat(16)}…`,
      ]);
      for (const n of out) {
        const b = n.labelBox!;
        expect(b).toBeDefined();
        expect(b.minX).toBeGreaterThanOrEqual(-0.5);
        expect(b.minY).toBeGreaterThanOrEqual(-0.5);
        expect(b.maxX).toBeLessThanOrEqual(fig.width + 0.5);
        expect(b.maxY).toBeLessThanOrEqual(fig.height + 0.5);
        if (!fig.scroll) {
          expect(b.maxX).toBeLessThanOrEqual(200 + 0.5);
        }
      }
    },
  );

  it.each(SHAPES)(
    "a 12-tip %s tips-up tree at 360 px fits or sets scroll (Review Focus 5)",
    (shape) => {
      const grp = (p: string): N => ({
        kids: [
          { kids: [{ label: `${p}a` }, { label: `${p}b` }] },
          { kids: [{ label: `${p}c` }, { label: `${p}d` }] },
        ],
      });
      const fig = readingLayout(
        buildView({ kids: [grp("t0"), grp("t1"), grp("t2")] }),
        { shape, tips: "up" },
        { width: 360, fontPx: 12 },
        measure,
      );
      expect(fig.scroll).toBe(fig.width > 360);
    },
  );

  it("never shrinks text below 12 px", () => {
    const a = readingLayout(buildView(T8), { shape: "rectangular", tips: "right" }, { width: 480, fontPx: 8 }, measure);
    const b = readingLayout(buildView(T8), { shape: "rectangular", tips: "right" }, { width: 480, fontPx: 12 }, measure);
    expect(a).toEqual(b);
  });

  it("ages place a fossil tip left of the present line (tips-right)", () => {
    const view = buildView(
      {
        age: 10,
        kids: [
          { age: 4, kids: [{ label: "a" }, { label: "b" }] },
          { label: "c", age: 3 },
        ],
      },
      { times: "ages", unit: "Ma" },
    );
    const fig = readingLayout(view, { shape: "rectangular", tips: "right" }, BOX, measure);
    expect(tip(fig, "c").x).toBeLessThan(tip(fig, "a").x - 1);
    const left = readingLayout(view, { shape: "rectangular", tips: "left" }, BOX, measure);
    expect(tip(left, "c").x).toBeGreaterThan(tip(left, "a").x + 1);
    const up = readingLayout(view, { shape: "rectangular", tips: "up" }, BOX, measure);
    expect(tip(up, "c").y).toBeGreaterThan(tip(up, "a").y + 1);
  });

  it("schematic axis has no numeric ticks", () => {
    const fig = readingLayout(
      buildView(T8, { times: "schematic" }),
      { shape: "rectangular", tips: "right" },
      BOX,
      measure,
    );
    expect(fig.axis).toBeDefined();
    expect(fig.axis!.schematic).toBe(true);
    expect(fig.axis!.ticks.every((tk) => !/\d/.test(tk.label))).toBe(true);
  });

  it("ages axis has numeric ticks and the unit", () => {
    const view = buildView(
      { age: 10, kids: [{ age: 4, kids: [{ label: "a" }, { label: "b" }] }, { label: "c" }] },
      { times: "ages", unit: "Ma" },
    );
    const fig = readingLayout(view, { shape: "rectangular", tips: "right" }, BOX, measure);
    expect(fig.axis?.schematic).toBe(false);
    expect(fig.axis?.unit).toBe("Ma");
    expect(fig.axis!.ticks.length).toBeGreaterThanOrEqual(2);
    for (const tk of fig.axis!.ticks) {
      expect(Number.isFinite(Number(tk.label))).toBe(true);
    }
    // Age 0 (the present) sits at the tips' x.
    const zero = fig.axis!.ticks.find((tk) => Number(tk.label) === 0)!;
    expect(zero.at).toBeCloseTo(tip(fig, "a").x, 6);
  });

  it.each(SHAPES)(
    "%s: marks sit on branch midpoints; gains and losses differ in change",
    (shape) => {
      const view = buildView({
        kids: [
          { letter: "P", kids: [{ label: "a" }, { label: "b" }] },
          { label: "c" },
        ],
      });
      view.marks = [
        { on: ["a", "b"], trait: "hair", change: "gain" },
        { on: ["c"], trait: "fur", change: "loss" },
      ];
      const fig = readingLayout(view, { shape, tips: "right" }, BOX, measure);
      expect(new Set(fig.marks.map((m) => m.change)).size).toBe(2);
      const gain = fig.marks.find((m) => m.trait === "hair")!;
      const loss = fig.marks.find((m) => m.trait === "fur")!;
      expect(gain.change).toBe("gain");
      expect(loss.change).toBe("loss");

      const root = nodeAt(fig, ["a", "b", "c"]);
      const inner = nodeAt(fig, ["a", "b"]);
      expect(gain.x).toBeCloseTo((root.x + inner.x) / 2, 6);
      if (shape === "rectangular") {
        // The branch's horizontal segment sits at the child's row.
        expect(gain.y).toBeCloseTo(inner.y, 6);
      } else {
        expect(gain.y).toBeCloseTo((root.y + inner.y) / 2, 6);
      }
      const c = tip(fig, "c");
      expect(loss.x).toBeCloseTo((root.x + c.x) / 2, 6);
      if (shape === "rectangular") {
        expect(loss.y).toBeCloseTo(c.y, 6);
      } else {
        expect(loss.y).toBeCloseTo((root.y + c.y) / 2, 6);
      }
    },
  );
});
