// The harness page body: mounts ReadingTree outside the app
// (v1.4d plan Task 7). Reachable at /e2e/reading-harness.html under the
// Vite dev server; nothing in the app imports this module, so the
// component stays out of the initial bundle and every e2e/visual scene
// drives the real engine path: a reading-set JSON through
// loadReadingSet + readingTree, rendered by ReadingTree.
//
// Query params: ?set=showcase|schematic|fossil|polytomy
//               &shape=rectangular|diagonal|circular
//               &tips=right|up|left|down
//               &selectable=none|node|tips|points|branch
//               &rotatable=0|1  &sel=a,b (preselected clade)
//               &hl=a,b (highlight)  &label=<caption>
//               &w=<cell width px>   &grid=styles (8-tip tree in all
//               twelve shape × side combos)
// The last selection lands in #rt-sel as JSON for spec assertions.

import { useMemo, useState } from "react";

import "./index.css";
import { engine } from "./engine";
import type { ReadingSet } from "./engine/generated/ReadingSet";
import type { ReadingTreeView } from "./engine/generated/ReadingTreeView";
import type { Shape } from "./engine/generated/Shape";
import type { TipSide } from "./engine/generated/TipSide";
import { cladeKey } from "./layout/readingGeom";
import type { ReadingStyle } from "./layout/readingLayout";
import {
  ReadingTree,
  type ReadingSelectable,
} from "./views/reading/ReadingTree";

const TREE8 =
  "(((human,chimp),(gorilla,gibbon)),((cat,dog),(bear,seal)));";

const item = {
  id: "q",
  text: "Tap the most recent common ancestor of {set}.",
  trees: ["main"],
  tips: ["human", "chimp"],
  question: { type: "mrca" },
};

/** Set name → the reading-set JSON (a `reading` document like
 * exercises/reading/* will carry) and the tree key to draw. */
const SETS: Record<string, { json: object; tree: string }> = {
  // Letters on the two big clades, a node point and a branch point,
  // a gain and a loss mark, and a numeric Ma axis.
  showcase: {
    tree: "main",
    json: {
      schema_version: 1,
      kind: "reading",
      id: "harness-showcase",
      title: "Mammals showcase",
      summary: "Letters, points, marks and a numeric axis",
      trees: {
        main: {
          newick: TREE8,
          node_letters: [
            { on: ["human", "chimp", "gorilla", "gibbon"], letter: "P" },
            { on: ["cat", "dog", "bear", "seal"], letter: "Q" },
          ],
          times: {
            unit: "Ma",
            ages: [
              { on: "root", age: 60 },
              { on: ["cat", "dog", "bear", "seal"], age: 45 },
              { on: ["human", "chimp", "gorilla", "gibbon"], age: 20 },
              { on: ["gorilla", "gibbon"], age: 18 },
              { on: ["bear", "seal"], age: 12 },
              { on: ["cat", "dog"], age: 9 },
              { on: ["human", "chimp"], age: 7 },
            ],
          },
          marks: [
            {
              on: ["cat", "dog", "bear", "seal"],
              trait: "fur",
              change: "gain",
            },
            {
              on: ["human", "chimp"],
              trait: "tail",
              change: "loss",
            },
          ],
          traits: [
            { name: "fur", ancestral: "bare", derived: "furry" },
            { name: "tail", ancestral: "tailed", derived: "tailless" },
          ],
          points: [
            {
              letter: "X",
              on: ["human", "chimp", "gorilla", "gibbon"],
              at: "node",
            },
            { letter: "Y", on: ["bear", "seal"], at: "branch" },
          ],
        },
      },
      items: [item],
    },
  },
  // A plain numeric axis: bird genera over Ma, no letters or marks.
  times: {
    tree: "main",
    json: {
      schema_version: 1,
      kind: "reading",
      id: "harness-times",
      title: "Numeric time",
      summary: "Numeric axis",
      trees: {
        main: {
          newick: "(((robin,sparrow),(crow,jay)),(hawk,eagle));",
          times: {
            unit: "Ma",
            ages: [
              { on: "root", age: 80 },
              { on: ["hawk", "eagle"], age: 50 },
              {
                on: ["robin", "sparrow", "crow", "jay"],
                age: 40,
              },
              { on: ["crow", "jay"], age: 20 },
              { on: ["robin", "sparrow"], age: 15 },
            ],
          },
        },
      },
      items: [
        { ...item, tips: ["robin", "sparrow"] },
      ],
    },
  },
  // The same tree with a schematic (older → younger) axis.
  schematic: {
    tree: "main",
    json: {
      schema_version: 1,
      kind: "reading",
      id: "harness-schematic",
      title: "Schematic time",
      summary: "Schematic axis",
      trees: { main: { newick: TREE8, times: "schematic" } },
      items: [item],
    },
  },
  // A fossil tip: mammoth's lineage ends 4 Ma before the present
  // (stylised for visibility at this scale), so the tip stops well
  // short of the younger end of the axis.
  fossil: {
    tree: "main",
    json: {
      schema_version: 1,
      kind: "reading",
      id: "harness-fossil",
      title: "Fossil tip",
      summary: "One tip ends before the present",
      trees: {
        main: {
          newick: "((mammoth,(elephant,manatee)),(moose,dog));",
          times: {
            unit: "Ma",
            ages: [
              { on: "root", age: 25 },
              { on: ["mammoth", "elephant", "manatee"], age: 12 },
              { on: ["moose", "dog"], age: 10 },
              { on: ["elephant", "manatee"], age: 5 },
              { on: ["mammoth"], age: 4 },
            ],
          },
          node_letters: [
            { on: ["mammoth", "elephant", "manatee"], letter: "P" },
          ],
        },
      },
      items: [
        { ...item, tips: ["mammoth", "elephant"] },
      ],
    },
  },
  // A true polytomy beside lettered nodes (robin/sparrow/crow share
  // one parent).
  polytomy: {
    tree: "main",
    json: {
      schema_version: 1,
      kind: "reading",
      id: "harness-polytomy",
      title: "Polytomy",
      summary: "Three-way split",
      trees: {
        main: {
          newick: "((robin,sparrow,crow),hawk);",
          node_letters: [
            { on: ["robin", "sparrow", "crow"], letter: "P" },
            { on: "root", letter: "R" },
          ],
        },
      },
      items: [
        {
          id: "q",
          text: "Is {a} closer to {b} or {c}?",
          trees: ["main"],
          a: "robin",
          b: "sparrow",
          c: "hawk",
          question: { type: "closest_relative", form: "pairwise" },
        },
      ],
    },
  },
};

function resolve(setName: string): ReadingTreeView {
  const entry = SETS[setName] ?? SETS.showcase;
  const loaded = engine.loadReadingSet(JSON.stringify(entry.json));
  if (!loaded.ok) throw new Error(`loadReadingSet: ${loaded.error.kind}`);
  const set: ReadingSet = loaded.value;
  const view = engine.readingTree(set, entry.tree);
  if (!view.ok) throw new Error(`readingTree: ${view.error.kind}`);
  return view.value;
}

function Tree(props: {
  view: ReadingTreeView;
  style: ReadingStyle;
  selectable: ReadingSelectable;
  rotatable: boolean;
  preselected: string[][];
  highlight: string[];
  label: string;
  /** Single-tree pages report selections/rotations through these
   * outputs; grid pages omit them (duplicate ids). */
  outputs: boolean;
}) {
  const [selected, setSelected] = useState<string[][]>(props.preselected);
  return (
    <div className="h-tree">
      <ReadingTree
        view={props.view}
        style={props.style}
        selectable={props.selectable}
        selected={selected}
        onSelect={(clade) => {
          setSelected([clade]);
          window.__rt?.selects.push(clade);
          const out = document.getElementById("rt-sel");
          if (out !== null) out.textContent = JSON.stringify([clade]);
        }}
        highlight={props.highlight}
        rotatable={props.rotatable}
        onRotate={(clade) => {
          window.__rt?.rotations.push(clade);
          const out = document.getElementById("rt-rot");
          if (out !== null) out.textContent = JSON.stringify(clade);
        }}
        label={props.label}
      />
      {props.outputs && (
        <>
          <output id="rt-sel" className="rt-harness-out">
            {JSON.stringify(selected)}
          </output>
          <output id="rt-rot" className="rt-harness-out" />
        </>
      )}
    </div>
  );
}

export function ReadingHarness() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const view = useMemo(() => resolve(q.get("set") ?? "showcase"), [q]);
  const selectable = (q.get("selectable") ?? "node") as ReadingSelectable;
  const rotatable = q.get("rotatable") === "1";
  const pre = q.get("sel");
  const preselected = pre !== null ? [pre.split(",")] : [];
  const highlight = q.get("hl")?.split(",") ?? [];
  const label = q.get("label") ?? "Tree 1";
  const cellWidth = Number(q.get("w") ?? 680);

  const shared = {
    view,
    selectable,
    rotatable,
    preselected,
    highlight,
  };

  if (q.get("grid") === "styles") {
    const combos: ReadingStyle[] = (
      ["rectangular", "diagonal", "circular"] as Shape[]
    ).flatMap((shape) =>
      (["right", "up", "left", "down"] as TipSide[]).map((tips) => ({
        shape,
        tips,
      })),
    );
    return (
      <div className="h-grid">
        {combos.map((s) => (
          <div
            className="h-cell"
            style={{ width: cellWidth }}
            key={cladeKey([s.shape, s.tips])}
          >
            <Tree
              {...shared}
              style={s}
              label={`${s.shape} · tips ${s.tips}`}
              outputs={false}
            />
          </div>
        ))}
      </div>
    );
  }
  const style: ReadingStyle = {
    shape: (q.get("shape") ?? "rectangular") as Shape,
    tips: (q.get("tips") ?? "right") as TipSide,
  };
  return (
    <div className="h-cell" style={{ width: cellWidth }}>
      <Tree {...shared} style={style} label={label} outputs />
    </div>
  );
}

