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
// builder derives arena order, parent links and clade keys like the
// engine's `reading_tree` does.
interface N {
  label?: string;
  letter?: string;
  age?: number;
  kids?: N[];
}

function buildView(spec: N, extra: Partial<ReadingTreeView> = {}): ReadingTreeView {
  const nodes: ReadingViewNode[] = [];
  const tipsUnder = (n: N, out: string[]) => {
    if (!n.kids || n.kids.length === 0) {
      out.push(n.label ?? "?");
      return;
    }
    n.kids.forEach((k) => tipsUnder(k, out));
  };
  const emit = (n: N, parent: number | null): number => {
    const id = nodes.length;
    nodes.push({
      clade: [],
      parent,
      children: [],
      label: n.label ?? null,
      letter: n.letter ?? null,
      age: n.age ?? null,
    });
    const tips: string[] = [];
    tipsUnder(n, tips);
    nodes[id].clade = tips.slice().sort();
    nodes[id].children = (n.kids ?? []).map((k) => emit(k, id));
    return id;
  };
  const root = emit(spec, null);
  return {
    nodes,
    root,
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
