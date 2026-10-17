import { describe, expect, it } from "vitest";

import type { Alignment } from "../engine/generated/Alignment";
import type { Exercise } from "../engine/generated/Exercise";

import { engine } from "../engine/index";
import {
  exerciseSim,
  hasImportedData,
  initialSession,
  reducer,
} from "./session";
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
    expect(s.reference).not.toBeNull();
    expect(s.reference?.kind).toBe("true");
    expect(s.reference?.origin).toBe("lesson");
    expect(s.alphabet).toBe("dna");
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

  it("embedded data is tagged with the declared alphabet", () => {
    // The protdist doc sequences detect as DNA but are declared
    // protein; the declared alphabet is authoritative (v1.1 spec §3.6).
    const ex = exercise(EMBEDDED_JSON);
    const s = reducer(emptySession(ex), {
      type: "load",
      exercise: ex,
      source: "lesson",
    });
    expect(s.error).toBeNull();
    // The alignment is exercise data, not user-imported data: the
    // origin stays "simulated" (recompute parses data.fasta), so
    // hasImportedData is false and shared links don't re-embed it.
    expect(s.alignmentOrigin).toBe("simulated");
    expect(hasImportedData(s)).toBe(false);
    expect(s.alphabet).toBe("protein");
    expect(s.alignment?.alphabet).toBe("protein");
    // A protein correction runs on the declared-alphabet alignment.
    expect(s.matrix).not.toBeNull();
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
    expect(exerciseSim(s.exercise)?.seed).toBe(exerciseSim(ex)?.seed);
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
    expect(s.reference?.tree).toBe(parsed.value);
    expect(s.reference?.kind).toBe("true");
    expect(s.reference?.origin).toBe("imported");
    // Deterministic seed: the alignment equals a fresh simulation.
    const sim = exerciseSim(ex);
    if (sim === null) throw new Error("expected a simulated exercise");
    const want = engine.simulate(parsed.value, sim);
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
    expect(s.reference?.tree).toBe(loaded.reference?.tree);
    expect(s.reference?.origin).toBe("lesson");
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
    expect(s.reference?.origin).toBe("lesson");
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
    expect(s.reference).toBeNull();
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
    expect(withTree.reference?.origin).toBe("imported");
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
    expect(s.reference?.tree).toBe(parsed.value);
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

// The protdist documentation sequences as an embedded protein exercise
// (shared by the Task 9 tests below). They detect as DNA; the declared
// alphabet is authoritative (v1.1 spec §3.6).
const EMBEDDED_JSON = `{
  "schema_version": 2,
  "id": "emb",
  "title": "Embedded protein",
  "alphabet": "protein",
  "data": {
    "kind": "embedded",
    "fasta": ">Alpha\\nAACGTGGCCACAT\\n>Beta\\nAAGGTCGCCACAC\\n>Gamma\\nCAGTTCGCCACAA\\n>Delta\\nGAGATTTCCGCCT\\n>Epsilon\\nGAGATCTCCGCCC",
    "source": { "citation": "test", "license": "CC0", "accessions": [] }
  },
  "reference": null,
  "analysis": { "correction": "JTT", "method": "NJ" }
}`;

describe("v1.1 session state (reference, alphabet)", () => {
  it("reference_kinds: a classification reference keeps its kind", () => {
    const json = EMBEDDED_JSON.replace(
      '"reference": null',
      `"reference": {
        "newick": "((Alpha:1,Beta:1):1,(Gamma:1,(Delta:1,Epsilon:1):1):1);",
        "kind": "classification"
      }`,
    );
    const ex = exercise(json);
    const s = reducer(emptySession(ex), {
      type: "load",
      exercise: ex,
      source: "lesson",
    });
    expect(s.error).toBeNull();
    expect(s.reference?.kind).toBe("classification");
    expect(s.reference?.origin).toBe("lesson");
    expect(s.rf).not.toBeNull();
  });

  it("a simulated exercise without reference defaults to the true tree", () => {
    // v1 parity: simulated data is always compared against the tree it
    // was simulated along, even when the file omits `reference`.
    const SIM_NOREF = `{
      "schema_version": 2,
      "id": "sim-noref",
      "title": "Simulated, no reference",
      "alphabet": "dna",
      "data": {
        "kind": "simulated",
        "true_tree": "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
        "sim": { "model": "JC69", "length": 200, "seed": 5 }
      },
      "reference": null,
      "analysis": { "correction": "JC69", "method": "NJ" }
    }`;
    const ex = exercise(SIM_NOREF);
    const s = reducer(emptySession(ex), {
      type: "load",
      exercise: ex,
      source: "lesson",
    });
    expect(s.error).toBeNull();
    expect(s.reference?.kind).toBe("true");
    expect(s.reference?.origin).toBe("lesson");
    expect(s.rf).not.toBeNull();
  });

  it("embedded_not_resimulated: setSim leaves the embedded alignment unchanged", () => {
    const ex = exercise(EMBEDDED_JSON);
    const loaded = reducer(emptySession(ex), {
      type: "load",
      exercise: ex,
      source: "lesson",
    });
    expect(loaded.alignment).not.toBeNull();
    const s = reducer(loaded, { type: "setSim", patch: { seed: 99 } });
    // Sim controls are a no-op on embedded data, as for an import.
    expect(s).toBe(loaded);
    expect(s.alignment).toBe(loaded.alignment);
  });

  it("importTree on embedded data re-parses the FASTA, never simulates", () => {
    // importTree flips alignmentOrigin to "simulated" so the imported
    // tree becomes the reference; for embedded data recompute re-parses
    // data.fasta (imported semantics: never re-simulated), giving the
    // identical alignment back and an RF against the imported tree.
    const ex = exercise(EMBEDDED_JSON);
    const loaded = reducer(emptySession(ex), {
      type: "load",
      exercise: ex,
      source: "lesson",
    });
    const parsed = engine.parseNewick(
      "((Alpha:0.1,Beta:0.1):0.1,(Gamma:0.1,(Delta:0.1,Epsilon:0.1):0.1):0.1);",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const s = reducer(loaded, { type: "importTree", tree: parsed.value });
    expect(s.error).toBeNull();
    expect(s.reference?.origin).toBe("imported");
    expect(s.alignment).toEqual(loaded.alignment);
    expect(s.alignment?.alphabet).toBe("protein");
    expect(s.rf).not.toBeNull();
  });

  it("alphabet_from_import: a protein FASTA flips the session alphabet", () => {
    const ex = exercise(EXERCISE_JSON);
    const loaded = reducer(emptySession(ex), {
      type: "load",
      exercise: ex,
      source: "lesson",
    });
    expect(loaded.alphabet).toBe("dna");
    const parsed = engine.parseFasta(
      ">p1\nMKVL\n>p2\nMKIL\n>p3\nMRVL\n>p4\nMKVA",
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error("unreachable");
    const s = reducer(loaded, {
      type: "importAlignment",
      alignment: parsed.value,
    });
    expect(s.alignment).toBe(parsed.value);
    expect(s.alphabet).toBe("protein");
    // The lesson's JC69 correction is DNA-only, so the engine reports
    // the mismatch; Task 10 auto-switches the correction in the UI.
    expect(s.error?.kind).toBe("ModelAlphabetMismatch");
  });
});
