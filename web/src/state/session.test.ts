import { describe, expect, it } from "vitest";

import type { Alignment } from "../engine/generated/Alignment";
import type { Exercise } from "../engine/generated/Exercise";

import { engine } from "../engine/index";
import { initialSession, reducer } from "./session";
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
  return initialSession(ex);
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

  it("setSim leaves an imported alignment unchanged", () => {
    const ex = exercise(EXERCISE_JSON);
    const loaded = reducer(emptySession(ex), {
      type: "load",
      exercise: ex,
      source: "lesson",
    });
    const alignment: Alignment = {
      labels: ["x1", "x2", "x3", "x4"],
      seqs: [
        [65, 67, 71, 84],
        [65, 67, 71, 84],
        [65, 67, 71, 84],
        [65, 67, 71, 84],
      ],
      alphabet: "dna",
    };
    const imported = reducer(loaded, { type: "importAlignment", alignment });
    expect(imported.alignmentOrigin).toBe("imported");
    const s = reducer(imported, { type: "setSim", patch: { seed: 99 } });
    // Sim controls are a no-op while alignmentOrigin is "imported".
    expect(s).toBe(imported);
    expect(s.alignment).toBe(alignment);
    expect(s.exercise.sim.seed).toBe(ex.sim.seed);
  });

  it("importTree re-simulates the alignment from the new tree", () => {
    const ex = exercise(EXERCISE_JSON);
    const loaded = reducer(emptySession(ex), {
      type: "load",
      exercise: ex,
      source: "lesson",
    });
    const alignment: Alignment = {
      labels: ["x1", "x2", "x3", "x4"],
      seqs: [
        [65, 67, 71, 84],
        [65, 67, 71, 84],
        [65, 67, 71, 84],
        [65, 67, 71, 84],
      ],
      alphabet: "dna",
    };
    const imported = reducer(loaded, { type: "importAlignment", alignment });
    const parsed = engine.parseNewick("((P:0.2,Q:0.2):0.1,R:0.3);");
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const s = reducer(imported, { type: "importTree", tree: parsed.value });
    expect(s.alignmentOrigin).toBe("simulated");
    expect(s.error).toBeNull();
    expect(s.trueTree).toBe(parsed.value);
    // Deterministic seed: the alignment equals a fresh simulation.
    const want = engine.simulate(parsed.value, ex.sim);
    expect(want.ok).toBe(true);
    if (!want.ok) throw new Error("unreachable");
    expect(s.alignment).toEqual(want.value);
    expect(s.alignment?.labels.slice().sort()).toEqual(["P", "Q", "R"]);
  });

  it("enterSandbox flips the source and leaves the pipeline untouched", () => {
    const ex = exercise(EXERCISE_JSON);
    const loaded = reducer(emptySession(ex), {
      type: "load",
      exercise: ex,
      source: "lesson",
    });
    const s = reducer(loaded, { type: "enterSandbox" });
    expect(s.source).toBe("sandbox");
    // Same simulated data — nothing jumps on screen.
    expect(s.alignment).toBe(loaded.alignment);
    expect(s.result).toBe(loaded.result);
    expect(s.trueTree).toBe(loaded.trueTree);
    expect(s.trueTreeOrigin).toBe("lesson");
  });

  it("exitSandbox reloads the lesson at step 0", () => {
    const ex = exercise(EXERCISE_JSON);
    const loaded = reducer(emptySession(ex), {
      type: "load",
      exercise: ex,
      source: "lesson",
    });
    const sb = reducer(loaded, { type: "enterSandbox" });
    const stepped = reducer(sb, { type: "step", to: 2 });
    const s = reducer(stepped, { type: "exitSandbox" });
    expect(s.source).toBe("lesson");
    expect(s.step).toBe(0);
    expect(s.trueTreeOrigin).toBe("lesson");
    expect(s.alignmentOrigin).toBe("simulated");
    expect(s.error).toBeNull();
  });

  it("importAlignment drops a lesson true tree: no comparison, no RF", () => {
    const ex = exercise(EXERCISE_JSON);
    const loaded = reducer(emptySession(ex), {
      type: "load",
      exercise: ex,
      source: "lesson",
    });
    // Six sequences whose labels don't match the lesson tree A–E.
    const alignment: Alignment = {
      labels: ["T1", "T2", "T3", "T4", "T5", "T6"],
      seqs: [
        [65, 67, 71, 84],
        [65, 67, 71, 84],
        [65, 67, 71, 84],
        [65, 67, 71, 84],
        [65, 67, 71, 84],
        [65, 67, 71, 84],
      ],
      alphabet: "dna",
    };
    const s = reducer(loaded, { type: "importAlignment", alignment });
    expect(s.error).toBeNull();
    expect(s.trueTree).toBeNull();
    expect(s.rf).toBeNull();
    expect(s.result).not.toBeNull();
    expect(s.alignment?.labels).toHaveLength(6);
  });

  it("importAlignment keeps an imported true tree and compares — LabelMismatch", () => {
    const ex = exercise(EXERCISE_JSON);
    const loaded = reducer(emptySession(ex), {
      type: "load",
      exercise: ex,
      source: "lesson",
    });
    const parsed = engine.parseNewick(
      "((T1:0.1,T2:0.1):0.1,(T3:0.1,T4:0.1):0.1,(T5:0.1,T6:0.1):0.1);",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const withTree = reducer(loaded, {
      type: "importTree",
      tree: parsed.value,
    });
    expect(withTree.trueTreeOrigin).toBe("imported");
    // A FASTA with one different label (X6 instead of T6).
    const alignment: Alignment = {
      labels: ["T1", "T2", "T3", "T4", "T5", "X6"],
      seqs: [
        [65, 67, 71, 84],
        [65, 67, 71, 84],
        [65, 67, 71, 84],
        [65, 67, 71, 84],
        [65, 67, 71, 84],
        [65, 67, 71, 84],
      ],
      alphabet: "dna",
    };
    const s = reducer(withTree, { type: "importAlignment", alignment });
    expect(s.trueTree).toBe(parsed.value);
    expect(s.error?.kind).toBe("LabelMismatch");
  });

  it("an alignment of 60 taxa builds without a trace", () => {
    const ex = exercise(EXERCISE_JSON);
    // Identical sequences keep every distance at 0 (no saturation) and
    // exercise the deterministic zero-matrix path.
    const alignment: Alignment = {
      labels: Array.from({ length: 60 }, (_, i) => `t${i}`),
      seqs: Array.from({ length: 60 }, () => [65, 67, 71, 84, 65, 67, 71, 84]),
      alphabet: "dna",
    };
    const s = reducer(emptySession(ex), { type: "importAlignment", alignment });
    expect(s.error).toBeNull();
    expect(s.result).not.toBeNull();
    expect(s.result?.trace).toBeNull();
  });
});
