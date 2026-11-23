/// <reference types="node" />
// Corpus-wide layout invariants (v1.4d checkpoint §21(a)/(b)): every
// shipped and coverage reading tree, in every style an item could
// draw it, gets the same guarantees the synthetic tests pin:
//
// - every mark-label box keeps MARK_CLEAR off tip labels, node and
//   tip dots, node- or point-letter badges, other marks' glyphs,
//   other marks' labels and every branch except the mark's own, and
//   every mark box stays inside the figure (a);
// - circular edges never cross: a node's fan arc spans exactly its
//   children's angles at its own ring, and the only point a spoke
//   can touch a fan is the junction where it hangs off it (b);
// - every internal node keeps at least its cladistic-depth ring —
//   radius ≥ R / maxDepth, the minimum step (b).

import { readdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeAll, describe, expect, it } from "vitest";

import { engine, initEngine } from "../engine/index";
import type { ReadingSet } from "../engine/generated/ReadingSet";
import type { ReadingTreeView } from "../engine/generated/ReadingTreeView";
import type { ReadingViewNode } from "../engine/generated/ReadingViewNode";
import type { Shape } from "../engine/generated/Shape";
import type { TipSide } from "../engine/generated/TipSide";

import { intersects, segBoxDist } from "./labelCollision";
import { markGlyphBox } from "./readingMarks";
import {
  cladeKey,
  LETTER_R,
  MARK_CLEAR,
  NODE_R,
  type Box,
} from "./readingGeom";
import { readingLayout } from "./readingLayout";

const READING = resolve(
  dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "..",
  "exercises",
  "reading",
);
const FILES = [
  ...readdirSync(READING)
    .filter((f) => f.endsWith(".json"))
    .map((f) => resolve(READING, f)),
  ...readdirSync(resolve(READING, "coverage"))
    .filter((f) => f.endsWith(".json") && f !== "manifest.json")
    .map((f) => resolve(READING, "coverage", f)),
];

const SETS = new Map<string, ReadingSet>();
beforeAll(async () => {
  await initEngine();
  for (const f of FILES) {
    const r = engine.loadReadingSet(readFileSync(f, "utf8"));
    if (!r.ok) throw new Error(`${f} failed to load`);
    SETS.set(f.slice(f.lastIndexOf("/") + 1), r.value);
  }
});

const measure = (s: string) => s.length * 7.5;
const SHAPES: Shape[] = ["rectangular", "diagonal", "circular"];
const SIDES: TipSide[] = ["right", "up", "left", "down"];

function stem(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
}

describe("mark labels never cover anything they shouldn't (§21(a))", () => {
  it("every shipped tree × all 12 style combinations", () => {
    const bad: string[] = [];
    for (const [file, set] of SETS) {
      for (const tname of Object.keys(set.trees)) {
        const r = engine.readingTree(set, tname);
        if (!r.ok) continue;
        for (const shape of SHAPES) {
          for (const tips of SIDES) {
            const fig = readingLayout(
              r.value,
              { shape, tips },
              { width: 680, fontPx: 12 },
              measure,
            );
            const tag = `${stem(file)}/${tname} ${shape}/${tips}`;
            // Fixed obstacles: tip labels, letter badges, the dot
            // every unlettered node draws — every one keeps
            // MARK_CLEAR off every label.
            const fixed: { what: string; box: Box }[] = [];
            fig.nodes.forEach((nd) => {
              if (nd.labelBox !== undefined) {
                fixed.push({ what: `tip "${nd.label}"`, box: nd.labelBox });
              }
              if (nd.letter !== undefined) {
                fixed.push({
                  what: `letter ${nd.letter}`,
                  box: {
                    minX: nd.x - LETTER_R - 1,
                    maxX: nd.x + LETTER_R + 1,
                    minY: nd.y - LETTER_R - 1,
                    maxY: nd.y + LETTER_R + 1,
                  },
                });
              } else {
                fixed.push({
                  what: `dot (${nd.clade.join(",")})`,
                  box: {
                    minX: nd.x - NODE_R - 1,
                    maxX: nd.x + NODE_R + 1,
                    minY: nd.y - NODE_R - 1,
                    maxY: nd.y + NODE_R + 1,
                  },
                });
              }
            });
            fig.points.forEach((pt) => {
              fixed.push({
                what: `point ${pt.letter}`,
                box: {
                  minX: pt.x - LETTER_R - 1,
                  maxX: pt.x + LETTER_R + 1,
                  minY: pt.y - LETTER_R - 1,
                  maxY: pt.y + LETTER_R + 1,
                },
              });
            });
            // MARK_CLEAR applies to every obstacle, not just crossing:
            // inflate the label and test intersection.
            const near = (b: Box): Box => ({
              minX: b.minX - MARK_CLEAR,
              maxX: b.maxX + MARK_CLEAR,
              minY: b.minY - MARK_CLEAR,
              maxY: b.maxY + MARK_CLEAR,
            });
            const labels: { what: string; box: Box }[] = [];
            fig.marks.forEach((m, j) => {
              const me = `mark "${m.trait}"#${j}`;
              const nb = near(m.labelBox);
              for (const o of fixed) {
                if (intersects(nb, o.box)) {
                  bad.push(`${tag}: ${me} label within ${MARK_CLEAR}px of ${o.what}`);
                }
              }
              for (const o of labels) {
                if (intersects(nb, o.box)) {
                  bad.push(`${tag}: ${me} label within ${MARK_CLEAR}px of ${o.what}`);
                }
              }
              fig.marks.forEach((n, k) => {
                if (k === j) return;
                if (
                  intersects(
                    nb,
                    markGlyphBox(n.change, n.x, n.y, n.angle),
                  )
                ) {
                  bad.push(
                    `${tag}: ${me} label within ${MARK_CLEAR}px of "${n.trait}" glyph`,
                  );
                }
              });
              for (const e of fig.edges) {
                // The label may sit on its own branch but no other.
                if (cladeKey(e.to) === cladeKey(m.on)) continue;
                for (let s = 0; s + 1 < e.pts.length; s += 1) {
                  const d = segBoxDist(
                    {
                      x1: e.pts[s].x,
                      y1: e.pts[s].y,
                      x2: e.pts[s + 1].x,
                      y2: e.pts[s + 1].y,
                    },
                    m.labelBox,
                  );
                  if (d < MARK_CLEAR - 1e-9) {
                    bad.push(
                      `${tag}: ${me} label ${d.toFixed(2)}px from "${e.to.join(",")}" branch`,
                    );
                  }
                }
              }
              labels.push({ what: me, box: m.labelBox });
              if (
                m.labelBox.minX < -0.5 ||
                m.labelBox.minY < -0.5 ||
                m.labelBox.maxX > fig.width + 0.5 ||
                m.labelBox.maxY > fig.height + 0.5
              ) {
                bad.push(`${tag}: ${me} label escapes the figure`);
              }
            });
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
});

// ---- circular edge crossings + the depth floor (§21(b)) ----

/** A synthetic view in engine arena order — the same builder
 * readingLayout.test.ts uses. */
interface N {
  label?: string;
  kids?: N[];
}
function buildView(spec: N): ReadingTreeView {
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
  const tipsUnder = (n: N, out: string[]) => {
    if (!n.kids || n.kids.length === 0) {
      out.push(n.label ?? "?");
      return;
    }
    n.kids.forEach((k) => tipsUnder(k, out));
  };
  for (let i = 0; i < flat.length; i += 1) {
    const tips: string[] = [];
    tipsUnder(flat[i].n, tips);
    const p = flat[i].parent;
    nodes[id[i]] = {
      clade: tips.slice().sort(),
      parent: p === null ? null : id[p],
      children: flat[i].kids.map((k) => id[k]),
      label: flat[i].n.label ?? null,
      letter: null,
      age: null,
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
  };
}

/** A balanced tree with the given leaf count (leaf labels l0..). */
function balanced(leaves: number): N {
  const mk = (lo: number, hi: number): N =>
    hi - lo === 1
      ? { label: `l${lo}` }
      : { kids: [mk(lo, (lo + hi) >> 1), mk((lo + hi) >> 1, hi)] };
  return mk(0, leaves);
}

/** A caterpillar (right comb) with the given leaf count. */
function caterpillar(leaves: number): N {
  let n: N = { label: `l${leaves - 1}` };
  for (let i = leaves - 2; i >= 0; i -= 1) {
    n = { kids: [{ label: `l${i}` }, n] };
  }
  return n;
}

/** A root polytomy with the given leaf count — the case whose fan
 * used to sweep through a middle child's spoke. */
function polytomy(leaves: number): N {
  return { kids: Array.from({ length: leaves }, (_, i) => ({ label: `l${i}` })) };
}

interface Polar {
  rad: number[];
  ang: number[];
  cx: number;
  cy: number;
  R: number;
  depth: number[];
  maxDepth: number;
}

/** Recover the polar layout the figure was drawn with: the root is
 * the centre, radii are distances from it, angles unwrapped into the
 * tip side's 330° arc domain. */
function polarOf(
  view: ReadingTreeView,
  fig: ReturnType<typeof readingLayout>,
  tips: TipSide,
): Polar {
  const root = fig.nodes[view.root];
  const centre = { right: 0, down: 90, left: 180, up: -90 }[tips];
  const rad = fig.nodes.map((nd) => Math.hypot(nd.x - root.x, nd.y - root.y));
  const ang = fig.nodes.map((nd) => {
    let a = (Math.atan2(nd.y - root.y, nd.x - root.x) * 180) / Math.PI;
    while (a < centre - 166) a += 360;
    while (a > centre + 166) a -= 360;
    return a;
  });
  const depth = new Array<number>(view.nodes.length).fill(0);
  let maxDepth = 0;
  const md = (id: number, d: number) => {
    depth[id] = d;
    if (d > maxDepth) maxDepth = d;
    for (const k of view.nodes[id].children) md(k, d + 1);
  };
  md(view.root, 0);
  return {
    rad,
    ang,
    cx: root.x,
    cy: root.y,
    R: Math.max(...rad),
    depth,
    maxDepth,
  };
}

type Prim =
  | { kind: "spoke"; a: number; r1: number; r2: number; child: number }
  | { kind: "arc"; r: number; a1: number; a2: number; owner: number };

/** The primitives the edge paths draw, from the polar data (the same
 * decomposition readingLayout's circular branch uses). */
function primsOf(view: ReadingTreeView, p: Polar): Prim[] {
  const out: Prim[] = [];
  view.nodes.forEach((nd, i) => {
    if (nd.parent === null) return;
    out.push({
      kind: "spoke",
      a: p.ang[i],
      r1: p.rad[nd.parent],
      r2: p.rad[i],
      child: i,
    });
    if (nd.children.length > 1 && p.rad[i] > 1e-9) {
      const aLo = Math.min(...nd.children.map((k) => p.ang[k]));
      const aHi = Math.max(...nd.children.map((k) => p.ang[k]));
      if (aHi - aLo > 1e-9) {
        out.push({ kind: "arc", r: p.rad[i], a1: aLo, a2: aHi, owner: i });
      }
    }
  });
  return out;
}

/** The §21(b) invariants on one figure: no two edge primitives
 * intersect except where a spoke hangs off its parent's fan, and
 * every internal node keeps at least R/maxDepth of ring. */
function checkCircular(
  tag: string,
  view: ReadingTreeView,
  fig: ReturnType<typeof readingLayout>,
  tips: TipSide,
  bad: string[],
): void {
  const p = polarOf(view, fig, tips);
  const step = p.maxDepth > 0 ? p.R / p.maxDepth : 0;
  view.nodes.forEach((nd, i) => {
    if (i !== view.root && nd.children.length > 0 && p.rad[i] < step - 1) {
      bad.push(
        `${tag}: internal node ${i} ring ${p.rad[i].toFixed(1)} under the ${step.toFixed(1)} step`,
      );
    }
    if (nd.parent !== null && p.rad[i] <= p.rad[nd.parent]) {
      bad.push(
        `${tag}: node ${i} not strictly outside its parent (${p.rad[i].toFixed(1)} ≤ ${p.rad[nd.parent].toFixed(1)})`,
      );
    }
  });
  const prims = primsOf(view, p);
  for (let x = 0; x < prims.length; x += 1) {
    for (let y = x + 1; y < prims.length; y += 1) {
      const a = prims[x];
      const b = prims[y];
      const spoke = a.kind === "spoke" ? a : b.kind === "spoke" ? b : null;
      const arc = a.kind === "arc" ? a : b.kind === "arc" ? b : null;
      if (spoke !== null && arc !== null) {
        // A spoke may only TOUCH a fan where it hangs off it (its
        // radial start on the ring); a strict pass-through is a
        // crossing.
        const inRange = spoke.a >= arc.a1 - 1e-4 && spoke.a <= arc.a2 + 1e-4;
        if (inRange && spoke.r1 < arc.r - 1e-6 && spoke.r2 > arc.r + 1e-6) {
          bad.push(
            `${tag}: spoke of node ${spoke.child} crosses the fan of node ${arc.owner}`,
          );
        }
      } else if (spoke !== null && a.kind === "spoke" && b.kind === "spoke") {
        if (
          Math.abs(a.a - b.a) < 1e-4 &&
          Math.min(a.r2, b.r2) - Math.max(a.r1, b.r1) > 1e-6
        ) {
          bad.push(`${tag}: spokes ${a.child}/${b.child} overlap`);
        }
      } else if (arc !== null && a.kind === "arc" && b.kind === "arc") {
        const overlap =
          Math.min(a.a2, b.a2) - Math.max(a.a1, b.a1) > 1e-4;
        if (Math.abs(a.r - b.r) < 1e-6 && overlap) {
          bad.push(`${tag}: fans of ${a.owner}/${b.owner} overlap`);
        }
      }
    }
  }
}

describe("circular edges never cross and keep their rings (§21(b))", () => {
  it("synthetic balanced, caterpillar and polytomy trees, 3–9 tips", () => {
    const bad: string[] = [];
    for (let leaves = 3; leaves <= 9; leaves += 1) {
      for (const [name, spec] of [
        ["balanced", balanced(leaves)],
        ["caterpillar", caterpillar(leaves)],
        ["polytomy", polytomy(leaves)],
      ] as const) {
        const view = buildView(spec);
        for (const tips of SIDES) {
          const fig = readingLayout(
            view,
            { shape: "circular", tips },
            { width: 680, fontPx: 12 },
            measure,
          );
          checkCircular(`${name}-${leaves}/${tips}`, view, fig, tips, bad);
        }
      }
    }
    expect(bad).toEqual([]);
  });

  it("every shipped tree × every tip side", () => {
    const bad: string[] = [];
    for (const [file, set] of SETS) {
      for (const tname of Object.keys(set.trees)) {
        const r = engine.readingTree(set, tname);
        if (!r.ok) continue;
        for (const tips of SIDES) {
          const fig = readingLayout(
            r.value,
            { shape: "circular", tips },
            { width: 680, fontPx: 12 },
            measure,
          );
          checkCircular(
            `${stem(file)}/${tname}/${tips}`,
            r.value,
            fig,
            tips,
            bad,
          );
        }
      }
    }
    expect(bad).toEqual([]);
  });
});
