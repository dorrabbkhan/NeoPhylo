import { describe, expect, it } from "vitest";

import type { Alignment } from "../engine/generated/Alignment";
import type { Exercise } from "../engine/generated/Exercise";

import { engine } from "../engine/index";
import { reducer } from "./session";
import type { Session } from "./session";

// The spec §7 example exercise file.
const EXERCISE_JSON = `{
  "schema_version": 1,
  "id": "nj-basics",
  "title": "How Neighbor-Joining works",
  "true_tree": "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
  "sim": { "model": "JC69", "length": 1000, "seed": 42 },
  "analysis": { "correction": "JC69", "method": "NJ" },
  "locked": ["sim.model", "analysis.method"],
  "prompts": [
    {
      "at_step": 1,
      "type": "predict_pair",
      "concept": "Which two taxa will join first?",
      "math": "Find the minimum Q(i,j)."
    },
    { "at_step": 3, "type": "note", "concept": "join 3", "math": "check the matrix" }
  ]
}`;

// Long branches plus a short alignment drive JC69 distances to saturation.
const SATURATING_JSON = `{
  "schema_version": 1,
  "id": "saturating",
  "title": "Saturation demo",
  "true_tree": "((A:5,B:5):5,C:5,(D:5,E:5):5);",
  "sim": { "model": "JC69", "length": 1000, "seed": 42 },
  "analysis": { "correction": "JC69", "method": "NJ" }
}`;

function exercise(json: string): Exercise {
  const r = engine.loadExercise(json);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(`loadExercise failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

// Minimal placeholder session; `load`/`recompute` replace everything that
// matters, so only the view-state fields need to be sensible here.
function emptySession(ex: Exercise): Session {
  return {
    exercise: ex,
    trueTree: null,
    alignment: null,
    matrix: null,
    result: null,
    rf: null,
    error: null,
    step: 0,
    mode: "concept",
    clampNegative: false,
    matrixView: "distance",
    branchScale: 1,
    hover: null,
    source: "sandbox",
  };
}

describe("session reducer", () => {
  it("load runs sim → dist → build → rf for the §7 example", () => {
    const ex = exercise(EXERCISE_JSON);
    const s = reducer(emptySession(ex), {
      type: "load",
      exercise: ex,
      source: "lesson",
    });
    expect(s.error).toBeNull();
    expect(s.trueTree).not.toBeNull();
    expect(s.alignment).not.toBeNull();
    expect(s.matrix).not.toBeNull();
    expect(s.result).not.toBeNull();
    expect(s.rf).not.toBeNull();
    expect(s.step).toBe(0);
    expect(s.source).toBe("lesson");
  });

  it("setSim that saturates reports SaturatedMatrix and drops the tree", () => {
    const ex = exercise(SATURATING_JSON);
    const loaded = reducer(emptySession(ex), {
      type: "load",
      exercise: ex,
      source: "lesson",
    });
    const s = reducer(loaded, { type: "setSim", patch: { length: 10 } });
    expect(s.error).not.toBeNull();
    expect(s.error?.kind).toBe("SaturatedMatrix");
    expect(s.result).toBeNull();
  });

  it("step clamps to the trace length", () => {
    const ex = exercise(EXERCISE_JSON);
    const loaded = reducer(emptySession(ex), {
      type: "load",
      exercise: ex,
      source: "lesson",
    });
    const s = reducer(loaded, { type: "step", to: 999 });
    // 5-taxon NJ: 2 join steps + the final three-way join.
    expect(s.result?.trace).not.toBeNull();
    expect(s.step).toBe(3);
  });

  it("an alignment of 60 taxa builds without a trace", () => {
    const ex = exercise(EXERCISE_JSON);
    // Identical sequences keep every distance at 0 (no saturation) and
    // exercise the deterministic zero-matrix path.
    const alignment: Alignment = {
      labels: Array.from({ length: 60 }, (_, i) => `t${i}`),
      seqs: Array.from({ length: 60 }, () => [65, 67, 71, 84, 65, 67, 71, 84]),
    };
    const s = reducer(emptySession(ex), { type: "importAlignment", alignment });
    expect(s.error).toBeNull();
    expect(s.result).not.toBeNull();
    expect(s.result?.trace).toBeNull();
  });
});
