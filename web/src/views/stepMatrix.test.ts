/// <reference types="node" />
// stepMatrix tests (spec §6.2): the heatmap must show the distance matrix
// of the join highlighted at step k — trace.steps[k].distance — labelled
// by the active clusters' nodeName; NJ's final position shows the stored
// final_join.distance. The oracle is the Wikipedia 5-taxon NJ worked
// example (fixtures/worked/nj_wikipedia5.json), driven through the real
// engine; no distances are recomputed in the test.
//
// Like test/setup.ts, the fixture is read from cwd (vitest runs in web/)
// because import.meta.url is an http URL under jsdom.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { engine } from "../engine";
import type { DistanceMatrix } from "../engine/generated/DistanceMatrix";

import { stepMatrix } from "./stepMatrix";

interface Worked {
  labels: string[];
  matrix: { n: number; data: number[] };
  steps: {
    distance: { n: number; data: number[] };
    chosen: [number, number];
  }[];
}

const fixtureUrl = new URL(
  "../../../fixtures/worked/nj_wikipedia5.json",
  import.meta.url,
);
const fixturePath =
  fixtureUrl.protocol === "file:"
    ? fileURLToPath(fixtureUrl)
    : resolve("../fixtures/worked/nj_wikipedia5.json");
const wiki = JSON.parse(readFileSync(fixturePath, "utf8")) as Worked;

const matrix: DistanceMatrix = {
  labels: wiki.labels,
  model: "Jc69",
  cells: wiki.matrix.data.map((v) => ({ Value: v })),
};

const built = engine.buildTree(matrix, "Nj", { trace: true });
if (!built.ok) throw new Error(`buildTree failed: ${built.error.kind}`);
const { tree, trace } = built.value;
if (trace === null || !("Nj" in trace)) {
  throw new Error("expected an NJ trace");
}

function view(step: number, matrixView: "distance" | "q" = "distance") {
  const sm = stepMatrix({ trace, step, matrix, matrixView, inferred: tree });
  if (sm === null) throw new Error("stepMatrix returned null");
  return sm;
}

describe("stepMatrix (Wikipedia 5-taxon NJ)", () => {
  it("shows the 5×5 distance matrix of join 1 at step 0", () => {
    const sm = view(0);
    expect(sm.labels).toHaveLength(5);
    expect(sm.labels).toEqual(["a", "b", "c", "d", "e"]);
    expect(sm.values).toEqual(wiki.steps[0].distance.data);
    expect(sm.chosen).toEqual(wiki.steps[0].chosen);
  });

  it("shrinks to 4 rows at step 1 and labels the new cluster u1", () => {
    const sm = view(1);
    expect(sm.labels).toHaveLength(4);
    expect(sm.labels).toEqual(["c", "d", "e", "u1"]);
    expect(sm.values).toEqual(wiki.steps[1].distance.data);
    expect(sm.chosen).toEqual(wiki.steps[1].chosen);
  });

  it("shows the final join's own 3×3 matrix at the last step", () => {
    // steps.length = 2, so position 2 is the final three-way join; its
    // rows are the last three actives d, e, u2 (nodeName headers).
    const sm = view(2);
    expect(sm.view).toBe("distance");
    expect(sm.labels).toEqual(["d", "e", "u2"]);
    expect(sm.labels).toHaveLength(3);
    expect(sm.values).toHaveLength(9);
    expect(sm.values).toEqual([0, 3, 4, 3, 0, 3, 4, 3, 0]);
    // The final join has no single pair, so no cell is marked.
    expect(sm.chosen).toBeNull();
    // Positions past the end keep showing the final join.
    expect(view(3).values).toEqual(sm.values);
  });

  it("switches to the step's Q matrix in Q view", () => {
    const sm = view(0, "q");
    expect(sm.view).toBe("q");
    expect(sm.values).toEqual(
      (trace as { Nj: { steps: { q: { data: number[] } }[] } }).Nj.steps[0].q
        .data,
    );
  });

  it("falls back to the full leaf matrix when there is no trace", () => {
    const sm = stepMatrix({
      trace: null,
      step: 0,
      matrix,
      matrixView: "distance",
      inferred: null,
    });
    expect(sm).not.toBeNull();
    expect(sm!.labels).toEqual(wiki.labels);
    expect(sm!.active).toBeNull();
    expect(sm!.values).toHaveLength(25);
  });
});
