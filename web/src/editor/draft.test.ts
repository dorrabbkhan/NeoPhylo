// Editor draft tests (v1.4 plan Task 10, spec §5.3–5.4): the settings
// the form collects assemble into an ExerciseState that `saveExercise`
// (Task 7's real save path — schema + engine) accepts, and the form's
// own verdicts AGREE with that path: a value the form accepts never
// fails save, and a value save refuses is never shown as valid
// (Review Focus 1). The κ ≤ 0.5 rule is a warning, not a refusal —
// dnadist itself accepts the ratio and clamps it (owner decision,
// PR #88).

import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { DistanceInput } from "../engine/generated/DistanceInput";
import type { Exercise } from "../engine/generated/Exercise";
import type { Prompt } from "../engine/generated/Prompt";
import type { Tree } from "../engine/generated/Tree";

import {
  buildExerciseState,
  DEFAULT_SETTINGS,
  EMPTY_PRESERVED,
  preservedFieldNames,
  settingsFromExercise,
  settingsProblems,
  type EditorSettings,
} from "./draft";
import { importExercise, saveExercise } from "./exerciseFile";

const STARTER = "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);";

function parseTree(newick: string): Tree {
  const r = engine.parseNewick(newick);
  if (!r.ok) throw new Error(`fixture Newick must parse: ${newick}`);
  return r.value;
}

const settings = (patch: Partial<EditorSettings>): EditorSettings => ({
  ...DEFAULT_SETTINGS,
  ...patch,
});

const errors = (s: EditorSettings) =>
  settingsProblems(s).filter((p) => p.level === "error");
const warnings = (s: EditorSettings) =>
  settingsProblems(s).filter((p) => p.level === "warning");

/** The form's verdict on one named field: "valid", "warning" or "error". */
function verdict(s: EditorSettings, field: string): string {
  const ps = settingsProblems(s).filter((p) => p.field === field);
  if (ps.some((p) => p.level === "error")) return "error";
  if (ps.length > 0) return "warning";
  return "valid";
}

const tree = () => parseTree(STARTER);

describe("settingsProblems — κ (K2P_PHYLIP only)", () => {
  it("reports nothing about κ for non-K2P models", () => {
    for (const model of ["JC69", "K80", "F84", "Kimura", "JTT"] as const) {
      expect(errors(settings({ model, kappa: "0" }))).toEqual([]);
    }
  });

  it("requires κ only for K2P_PHYLIP, defaulting to 2", () => {
    const s = settings({ model: "K2P_PHYLIP", kappa: "2" });
    expect(errors(s)).toEqual([]);
    expect(warnings(s)).toEqual([]);
  });

  it.each(["0", "-1", "-0.5"])(
    'refuses κ = "%s" with a readable error',
    (kappa) => {
      const s = settings({ model: "K2P_PHYLIP", kappa });
      expect(verdict(s, "kappa")).toBe("error");
      const msg = errors(s).find((p) => p.field === "kappa")?.msg ?? "";
      expect(msg).toMatch(/positive/i);
    },
  );

  it.each(["abc", "", "0x10", "1e400"])(
    'refuses non-numeric κ = "%s" with a readable error',
    (kappa) => {
      const s = settings({ model: "K2P_PHYLIP", kappa });
      expect(verdict(s, "kappa")).toBe("error");
      expect(errors(s).find((p) => p.field === "kappa")?.msg ?? "").toMatch(
        /number/i,
      );
    },
  );

  // Review Focus 1 / owner decision on PR #88: a ratio in (0, 0.5] is
  // legal — dnadist clamps it to 0.5 — so the form warns with exactly
  // that fact instead of pretending the value fails.
  it.each(["0.1", "0.4", "0.5"])(
    'warns on κ = "%s": "dnadist treats ratios ≤ 0.5 as 0.5"',
    (kappa) => {
      const s = settings({ model: "K2P_PHYLIP", kappa });
      expect(verdict(s, "kappa")).toBe("warning");
      const msg = warnings(s).find((p) => p.field === "kappa")?.msg ?? "";
      expect(msg).toContain("dnadist treats ratios ≤ 0.5 as 0.5");
    },
  );
});

describe("settingsProblems — F84 base frequencies", () => {
  const f84 = (baseFreqs: [string, string, string, string]) =>
    settings({ model: "F84", baseFreqs });

  it("defaults to 0.25 each and reports no problem", () => {
    expect(DEFAULT_SETTINGS.baseFreqs).toEqual([
      "0.25",
      "0.25",
      "0.25",
      "0.25",
    ]);
    expect(errors(f84(DEFAULT_SETTINGS.baseFreqs))).toEqual([]);
  });

  it("reports the current sum and fails a sum that is not 1", () => {
    const s = f84(["0.3", "0.2", "0.2", "0.2"]);
    expect(verdict(s, "baseFreqs")).toBe("error");
    const msg = errors(s).find((p) => p.field === "baseFreqs")?.msg ?? "";
    expect(msg).toContain("0.9");
    expect(msg).toMatch(/sum/i);
  });

  it("accepts a sum within 1e-6 of 1", () => {
    const s = f84(["0.2500001", "0.25", "0.25", "0.2499999"]);
    expect(verdict(s, "baseFreqs")).not.toBe("error");
  });

  it.each(["0", "-0.1", "abc", ""])(
    'refuses a frequency of "%s" with a readable error',
    (bad) => {
      const s = f84(["0.5", bad, "0.25", "0.25"]);
      expect(verdict(s, "baseFreqs")).toBe("error");
      expect(
        errors(s).find((p) => p.field === "baseFreqs")?.msg ?? "",
      ).toMatch(/positive|number/i);
    },
  );

  it("ignores base frequencies for non-F84 models", () => {
    expect(
      errors(settings({ model: "JC69", baseFreqs: ["1", "1", "1", "1"] })),
    ).toEqual([]);
  });
});

describe("settingsProblems — seed and length", () => {
  it.each(["5", "9", "10001", "-1", "1.5", "abc"])(
    'refuses length/seed-shaped input "%s" in the right field',
    (bad) => {
      // 5 and 9 fail length's minimum; 10001 its maximum; -1, 1.5 and
      // abc are non-integer/negative for both fields.
      const s = settings({ length: bad, seed: bad });
      expect(errors(s).length).toBeGreaterThan(0);
    },
  );
});

describe("buildExerciseState + saveExercise agreement", () => {
  it("builds a saveable exercise for every model preset", () => {
    for (const model of [
      "JC69",
      "K80",
      "F84",
      "K2P_PHYLIP",
      "Kimura",
      "JTT",
    ] as const) {
      const state = buildExerciseState(tree(), settings({ model }), []);
      const saved = saveExercise(state);
      expect(
        "json" in saved,
        `${model}: ${"error" in saved ? saved.error : ""}`,
      ).toBe(true);
    }
  });

  it("writes alphabet protein for the protein models", () => {
    for (const model of ["Kimura", "JTT"] as const) {
      const state = buildExerciseState(tree(), settings({ model }), []);
      expect(state.exercise.alphabet).toBe("protein");
    }
  });

  it("maps K2P_PHYLIP's κ to analysis.kappa AND the K80 sim model (spec §2.1)", () => {
    const state = buildExerciseState(
      tree(),
      settings({ model: "K2P_PHYLIP", kappa: "4" }),
      [],
    );
    expect(state.exercise.analysis.correction).toEqual({
      K2pPhylip: { ratio: 4 },
    });
    expect(state.exercise.analysis.kappa).toBe(4);
    if (state.exercise.data.kind !== "simulated") throw new Error("sim");
    expect(state.exercise.data.sim.model).toEqual({ K80: { kappa: 4 } });
  });

  it("maps F84 base frequencies to the sim model only — the correction stays observed-frequency", () => {
    const state = buildExerciseState(
      tree(),
      settings({ model: "F84", baseFreqs: ["0.3", "0.2", "0.2", "0.3"] }),
      [],
    );
    if (state.exercise.data.kind !== "simulated") throw new Error("sim");
    expect(state.exercise.data.sim.model).toEqual({
      F84: { kappa: 2, base_freqs: [0.3, 0.2, 0.2, 0.3] },
    });
    expect(state.exercise.analysis.correction).toBe("F84");
    // No stray kappa: F84's analysis ratio is dnadist's fixed 2.0.
    expect(state.exercise.analysis.kappa).toBeUndefined();
  });

  // The named Review Focus 1 pin: the form's verdict and the real save
  // path (schema + engine) must never disagree.
  it.each([
    "2", "4", "0.5", "0.4", "0.1", "100", "0.500001",
    "0", "-1", "-0.5", "abc", "", "1e400",
  ])("κ = %s: the form accepts iff saveExercise does", (kappa) => {
    const s = settings({ model: "K2P_PHYLIP", kappa });
    const accepted = verdict(s, "kappa") !== "error";
    const saved = saveExercise(buildExerciseState(tree(), s, []));
    expect(
      "json" in saved,
      `κ=${kappa}: form ${accepted ? "accepts" : "refuses"}, save ${"json" in saved ? "accepts" : "refuses"}${"error" in saved ? ` (${saved.error})` : ""}`,
    ).toBe(accepted);
  });

  it.each([
    // accepted — save must produce JSON
    ["0.25", "0.25", "0.25", "0.25"],
    ["0.3", "0.2", "0.2", "0.3"],
    ["0.2500001", "0.25", "0.25", "0.2499999"],
    // refused — save must fail
    ["0.3", "0.2", "0.2", "0.2"],
    ["0.5", "0", "0.25", "0.25"],
    ["0.5", "-0.1", "0.35", "0.25"],
    ["0.5", "abc", "0.25", "0.25"],
  ])(
    "base frequencies %s,%s,%s,%s: the form accepts iff saveExercise does",
    (a, c, g, t) => {
      const s = settings({ model: "F84", baseFreqs: [a, c, g, t] });
      const accepted = verdict(s, "baseFreqs") !== "error";
      const saved = saveExercise(buildExerciseState(tree(), s, []));
      expect(
        "json" in saved,
        `freqs ${a},${c},${g},${t}: form ${accepted ? "accepts" : "refuses"}, save ${"json" in saved ? "accepts" : "refuses"}${"error" in saved ? ` (${saved.error})` : ""}`,
      ).toBe(accepted);
    },
  );

  it.each([
    ["1", "300", true],
    ["0", "10", true],
    ["9007199254740991", "10000", true],
    ["-1", "300", false],
    ["1.5", "300", false],
    ["abc", "300", false],
    ["1", "9", false],
    ["1", "10001", false],
    ["1", "1.5", false],
  ])(
    "seed %s / length %s: the form accepts iff saveExercise does",
    (seed, length, expected) => {
      const s = settings({ seed, length });
      const accepted = errors(s).length === 0;
      expect(accepted).toBe(expected);
      const saved = saveExercise(buildExerciseState(tree(), s, []));
      expect("json" in saved).toBe(accepted);
    },
  );
});

describe("settingsFromExercise (import)", () => {
  function load(json: string): Exercise {
    const r = engine.loadExercise(json);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value;
  }

  const fileFor = (exercise: Exercise): string => {
    const saved = saveExercise({ exercise });
    if (!("json" in saved)) throw new Error(saved.error);
    return saved.json;
  };

  it("round-trips every preset's settings", () => {
    for (const model of [
      "JC69",
      "K80",
      "F84",
      "K2P_PHYLIP",
      "Kimura",
      "JTT",
    ] as const) {
      const s = settings({ model, kappa: "3", baseFreqs: ["0.3","0.2","0.2","0.3"] });
      const built = buildExerciseState(tree(), s, []);
      const ex = load(fileFor(built.exercise));
      const back = settingsFromExercise(ex);
      expect("settings" in back, `${model}: ${"error" in back ? back.error : ""}`).toBe(true);
      if ("settings" in back) {
        expect(back.settings.model).toBe(model);
        if (model === "K2P_PHYLIP") expect(back.settings.kappa).toBe("3");
        if (model === "F84") {
          expect(back.settings.baseFreqs).toEqual(["0.3", "0.2", "0.2", "0.3"]);
        }
      }
    }
  });

  it("refuses an embedded-data exercise with a readable reason", () => {
    const ex = load(
      JSON.stringify({
        schema_version: 2,
        id: "t",
        title: "t",
        summary: "t",
        alphabet: "dna",
        data: {
          kind: "embedded",
          fasta: ">A\nACGT\n>B\nACGA\n",
          source: {
            citation: "test",
            license: "CC0",
            accessions: [],
          },
        },
        analysis: { correction: "JC69", method: "NJ" },
      }),
    );
    const back = settingsFromExercise(ex);
    expect("error" in back).toBe(true);
  });
});

// Fix round 1: an imported exercise's uneditable fields (reference,
// locked, bootstrap) ride through the draft to the saved file —
// earlier they were hardcoded away, so import → save silently lost
// them. For every importable built-in, import then save with no edits
// must give an exercise deep-equal to the migrated original.
describe("import → save preserves uneditable fields", () => {
  const dir = resolve("..", "exercises");
  const files = readdirSync(dir)
    // content-hashes.json is engine metadata (v1.5 Task 6), not a lesson.
    .filter(
      (f) =>
        f.endsWith(".json") &&
        !f.endsWith("schema.json") &&
        f !== "content-hashes.json",
    )
    .sort();

  function load(json: string): Exercise {
    const r = engine.loadExercise(json);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value;
  }

  /** The Exercise normalized for comparison: its true_tree
   * re-serialized to the canonical writeNewick form (a textually
   * different-but-equal Newick never falsifies the comparison) and
   * schema_version set to the current one — saving a v2 file writes
   * v3, the migration the comparison is "after". */
  function canonical(ex: Exercise): Exercise {
    if (ex.data.kind !== "simulated") {
      return { ...ex, schema_version: 3 };
    }
    const t = parseTree(ex.data.true_tree);
    return {
      ...ex,
      schema_version: 3,
      data: { ...ex.data, true_tree: engine.writeNewick(t) },
    };
  }

  const IMPORTABLE = files.filter(
    (f) => !["cytochrome-c.json", "protein-models.json"].includes(f),
  );

  it.each(IMPORTABLE)(
    "importing %s then saving untouched is deep-equal to the migrated file",
    (f) => {
      const imp = importExercise(readFileSync(resolve(dir, f), "utf8"));
      if (!imp.ok) throw new Error(`${f} must import: ${JSON.stringify(imp.error)}`);
      const original = imp.value.exercise;
      const conv = settingsFromExercise(original, imp.value.fileExtras);
      if ("error" in conv) throw new Error(`${f}: ${conv.error}`);
      expect(
        preservedFieldNames(conv.preserved).length,
        `${f} carries at least one uneditable field`,
      ).toBeGreaterThan(0);
      const t = parseTree(
        original.data.kind === "simulated"
          ? original.data.true_tree
          : "(a:0.1,b:0.2,c:0.3);", // matrix data (v1.4c Task 10): the
        // drawn tree is unused on the matrix route — a placeholder
        // satisfies buildExerciseState's signature.
      );
      const saved = saveExercise(
        buildExerciseState(
          t,
          conv.settings,
          conv.prompts,
          imp.value.fileExtras,
          conv.preserved,
        ),
      );
      if (!("json" in saved)) throw new Error(`${f}: ${saved.error}`);
      expect(canonical(load(saved.json))).toEqual(canonical(original));
    },
  );

  it("the two unimportable built-ins stay refused with their reasons", () => {
    for (const [f, reason] of [
      ["cytochrome-c.json", /embeds fixed sequences/],
      ["protein-models.json", /can't represent/],
    ] as const) {
      const imp = importExercise(readFileSync(resolve(dir, f), "utf8"));
      if (!imp.ok) throw new Error(`${f} must load`);
      const conv = settingsFromExercise(imp.value.exercise, imp.value.fileExtras);
      expect("error" in conv, `${f} is refused`).toBe(true);
      if ("error" in conv) expect(conv.error).toMatch(reason);
    }
  });

  it("a preserved reference the tree no longer matches is refused by name, not dropped", () => {
    // nj-basics' reference names A–F; a draft tree with different
    // taxa must fail saveExercise's engine reload with the field's
    // error — never silently pass because the field was dropped.
    const imp = importExercise(
      readFileSync(resolve(dir, "nj-basics.json"), "utf8"),
    );
    if (!imp.ok) throw new Error("nj-basics must import");
    const conv = settingsFromExercise(imp.value.exercise, imp.value.fileExtras);
    if ("error" in conv) throw new Error(conv.error);
    const mismatched = parseTree("(A:0.1,B:0.2,C:0.3);");
    const saved = saveExercise(
      buildExerciseState(
        mismatched,
        conv.settings,
        conv.prompts,
        imp.value.fileExtras,
        conv.preserved,
      ),
    );
    expect("error" in saved, "the mismatched reference must refuse").toBe(
      true,
    );
  });

  it("a fresh draft's EMPTY_PRESERVED writes no reference, locks or bootstrap", () => {
    const state = buildExerciseState(
      tree(),
      settings({}),
      [],
      undefined,
      EMPTY_PRESERVED,
    );
    expect(state.exercise.reference).toBeNull();
    expect(state.exercise.locked).toEqual([]);
    expect(state.exercise.bootstrap).toBeNull();
    expect(preservedFieldNames(EMPTY_PRESERVED)).toEqual([]);
  });
});

describe("site filter and Poisson (v1.4b Task 11)", () => {
  /** A schema-4 file loaded through the engine, with the requested
   * analysis fields (protein so Poisson is legal). */
  function v4Exercise(
    siteFilter: Record<string, unknown> | null,
    correction = "JTT",
  ): Exercise {
    const r = engine.loadExercise(
      JSON.stringify({
        schema_version: 4,
        id: "v4",
        title: "v4",
        summary: "v4",
        alphabet: "protein",
        data: {
          kind: "simulated",
          true_tree: STARTER,
          sim: { model: "JTT", length: 100, seed: 1 },
        },
        analysis: {
          correction,
          method: "NJ",
          ...(siteFilter !== null ? { site_filter: siteFilter } : {}),
        },
      }),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.value;
  }

  it("settingsFromExercise maps a v4 partial site filter", () => {
    const r = settingsFromExercise(
      v4Exercise({ kind: "partial", cutoff_pct: 95 }),
    );
    if ("error" in r) throw new Error(r.error);
    expect(r.settings.siteFilter).toEqual({ kind: "partial" });
    expect(r.settings.cutoff).toBe("95");
  });

  it("an explicit pairwise filter round-trips instead of dropping", () => {
    const r = settingsFromExercise(v4Exercise({ kind: "pairwise" }));
    if ("error" in r) throw new Error(r.error);
    expect(r.settings.siteFilter).toEqual({ kind: "pairwise" });
    const state = buildExerciseState(tree(), r.settings, []);
    expect(state.exercise.analysis.site_filter).toEqual({
      kind: "pairwise",
    });
    expect(state.exercise.schema_version).toBe(4);
  });

  it("settingsFromExercise maps a Poisson correction", () => {
    const r = settingsFromExercise(v4Exercise(null, "Poisson"));
    if ("error" in r) throw new Error(r.error);
    expect(r.settings.model).toBe("Poisson");
    const state = buildExerciseState(tree(), r.settings, []);
    expect(state.exercise.analysis.correction).toBe("Poisson");
    expect(state.exercise.schema_version).toBe(4);
  });

  it("schema_version is 4 only when a v4 field is used", () => {
    expect(
      buildExerciseState(tree(), settings({ model: "Poisson" }), [])
        .exercise.schema_version,
    ).toBe(4);
    expect(
      buildExerciseState(
        tree(),
        settings({ siteFilter: { kind: "complete" } }),
        [],
      ).exercise.schema_version,
    ).toBe(4);
    expect(
      buildExerciseState(tree(), settings({}), []).exercise.schema_version,
    ).toBe(3);
  });

  it.each(["101", "-1", "2.5", ""])(
    "the partial cutoff refuses %s with a message",
    (cutoff) => {
      expect(
        verdict(
          settings({ siteFilter: { kind: "partial" }, cutoff }),
          "cutoff",
        ),
      ).toBe("error");
    },
  );

  it("a valid partial cutoff writes cutoff_pct", () => {
    const state = buildExerciseState(
      tree(),
      settings({ siteFilter: { kind: "partial" }, cutoff: "80" }),
      [],
    );
    expect(state.exercise.analysis.site_filter).toEqual({
      kind: "partial",
      cutoff_pct: 80,
    });
  });
});

// --- v1.4c Task 9: matrix exercises, derive-from-tree and meta ------
//
// The editor's data step gains "Start from a matrix" (spec §6.4): the
// draft carries the committed matrix (typed, pasted or derived), and
// the saved file writes `data.kind: "matrix"`, `schema_version: 5` and
// a method-only analysis. Switching back to "simulate" restores the
// simulation settings exactly and drops the matrix from the draft and
// the saved file. `meta` rides through like the other uneditable
// fields; the hand-steps input edits only `meta.hand_steps`.

const MATRIX4: DistanceInput = {
  names: ["A", "B", "C", "D"],
  lower: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
};
const MATRIX_SOURCE = { citation: "", license: "", accessions: [] };

function matrixSettings(
  patch: Partial<EditorSettings> = {},
): EditorSettings {
  return settings({
    dataMode: "matrix",
    matrix: {
      input: MATRIX4,
      source: MATRIX_SOURCE,
      derivedFrom: null,
      alphabet: "dna",
    },
    ...patch,
  });
}

describe("matrix data mode (v1.4c Task 9)", () => {
  it("the matrix route needs a committed matrix before save", () => {
    const s = settings({ dataMode: "matrix", matrix: null });
    expect(verdict(s, "matrix")).toBe("error");
    expect(
      errors(s).find((p) => p.field === "matrix")?.msg ?? "",
    ).toMatch(/type|paste|derive/i);
  });

  it("a committed matrix draft saves as kind matrix with a method-only analysis", () => {
    const state = buildExerciseState(tree(), matrixSettings(), []);
    expect(state.exercise.data).toEqual({
      kind: "matrix",
      names: MATRIX4.names,
      lower: MATRIX4.lower,
      source: MATRIX_SOURCE,
    });
    expect(state.exercise.analysis).toEqual({
      correction: "Supplied",
      method: "Nj",
    });
    const saved = saveExercise(state);
    if ("error" in saved) throw new Error(saved.error);
    const file = JSON.parse(saved.json) as Record<string, unknown>;
    expect(file.schema_version).toBe(5);
    expect((file.data as Record<string, unknown>).kind).toBe("matrix");
    expect(file.analysis).not.toHaveProperty("correction");
    // The engine loader accepts the saved file: Supplied correction,
    // names/lower identical (the end-to-end pin from the task notes).
    const back = engine.loadExercise(saved.json);
    if (!back.ok) throw new Error(JSON.stringify(back.error));
    expect(back.value.analysis.correction).toBe("Supplied");
    if (back.value.data.kind !== "matrix") throw new Error("matrix");
    expect(back.value.data.names).toEqual(MATRIX4.names);
    expect(back.value.data.lower).toEqual(MATRIX4.lower);
  });

  it("hidden simulation fields can't block a matrix save", () => {
    const s = matrixSettings({
      model: "F84",
      baseFreqs: ["1", "1", "1", "1"],
      seed: "abc",
      length: "5",
      siteFilter: { kind: "partial" },
      cutoff: "x",
    });
    expect(errors(s)).toEqual([]);
    const saved = saveExercise(buildExerciseState(tree(), s, []));
    expect(
      "json" in saved,
      "error" in saved ? saved.error : "",
    ).toBe(true);
  });

  it("switching back to simulate restores the sim settings and drops the matrix", () => {
    const back: EditorSettings = {
      ...matrixSettings({ model: "K80", seed: "42", length: "400" }),
      dataMode: "simulate",
      matrix: null,
    };
    const state = buildExerciseState(tree(), back, []);
    expect(state.exercise.data.kind).toBe("simulated");
    expect(state.exercise.analysis.correction).toBe("K80");
    if (state.exercise.data.kind === "simulated") {
      expect(state.exercise.data.sim.seed).toBe(42);
      expect(state.exercise.data.sim.length).toBe(400);
    }
    const saved = saveExercise(state);
    if ("error" in saved) throw new Error(saved.error);
    const file = JSON.parse(saved.json) as {
      data: Record<string, unknown>;
    };
    expect(file.data.kind).toBe("simulated");
    expect(file.data).not.toHaveProperty("names");
  });

  it("an unsaved matrix draft survives the save-path reload", () => {
    // The unsaved draft reloaded through the save path — the same
    // round trip the preview handshake runs (decisions.md, fix
    // round 3): build → save → import → settings → build gives the
    // same exercise.
    const state = buildExerciseState(
      tree(),
      matrixSettings({ method: "Upgma" }),
      [],
    );
    const saved = saveExercise(state);
    if ("error" in saved) throw new Error(saved.error);
    const re = importExercise(saved.json);
    if (!re.ok) throw new Error(JSON.stringify(re.error));
    const conv = settingsFromExercise(
      re.value.exercise,
      re.value.fileExtras,
    );
    if ("error" in conv) throw new Error(conv.error);
    expect(conv.settings.dataMode).toBe("matrix");
    expect(conv.settings.matrix?.input).toEqual(MATRIX4);
    expect(conv.settings.method).toBe("Upgma");
    const rebuilt = buildExerciseState(
      tree(),
      conv.settings,
      conv.prompts,
      re.value.fileExtras,
      conv.preserved,
    );
    expect(rebuilt.exercise).toEqual(state.exercise);
  });

  it("a predict_branch prompt blocks a matrix save with the reason", () => {
    const prompts: Prompt[] = [
      {
        at_step: 2,
        type: "predict_branch",
        concept: "support",
        math: null,
        reveal: null,
        reveal_pair: null,
        after: null,
      },
    ];
    const probs = settingsProblems(matrixSettings(), {
      prompts,
      preserved: EMPTY_PRESERVED,
    });
    const p = probs.find(
      (p) => p.field === "prompts" && p.level === "error",
    );
    expect(p, JSON.stringify(probs)).toBeDefined();
    expect(p?.msg).toMatch(/predict_branch|bootstrap/i);
  });

  it("imported bootstrap settings block a matrix save", () => {
    const probs = settingsProblems(matrixSettings(), {
      prompts: [],
      preserved: {
        ...EMPTY_PRESERVED,
        bootstrap: { replicates: 100, seed: 1 },
      },
    });
    expect(probs.some((p) => p.level === "error")).toBe(true);
  });

  it("a pre-Task-9 draft blob (schema 3, no matrix fields) loads as a simulate draft", () => {
    const r = engine.loadExercise(
      JSON.stringify({
        schema_version: 3,
        id: "old-draft",
        title: "Old draft",
        summary: "Old draft",
        alphabet: "dna",
        data: {
          kind: "simulated",
          true_tree: STARTER,
          sim: { model: "JC69", length: 100, seed: 1 },
        },
        analysis: { correction: "JC69", method: "NJ" },
      }),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    const conv = settingsFromExercise(r.value);
    if ("error" in conv) throw new Error(conv.error);
    expect(conv.settings.dataMode).toBe("simulate");
    expect(conv.settings.matrix).toBeNull();
    expect(conv.settings.handSteps).toBe("");
    expect(conv.preserved.meta).toBeUndefined();
  });
});

describe("derive from the drawn tree (v1.4c Task 9, spec §5.3)", () => {
  it("the drawn 5-leaf tree's additive matrix is the draft's matrix, and NJ recovers the drawn topology", () => {
    // The editor calls engine.additiveMatrix on the drawn tree — the
    // draft stores exactly what the engine returns, and NJ on that
    // matrix recovers the drawn tree (the preview's truth, compared
    // via the engine's RF, never a drawn view).
    const drawn = parseTree(STARTER);
    const m = engine.additiveMatrix(drawn, null);
    if (!m.ok) throw new Error(JSON.stringify(m.error));
    const state = buildExerciseState(
      drawn,
      matrixSettings({
        matrix: {
          input: m.value,
          source: MATRIX_SOURCE,
          derivedFrom: engine.writeNewick(drawn),
          alphabet: "dna",
        },
      }),
      [],
    );
    const saved = saveExercise(state);
    if ("error" in saved) throw new Error(saved.error);
    const back = engine.loadExercise(saved.json);
    if (!back.ok) throw new Error(JSON.stringify(back.error));
    if (back.value.data.kind !== "matrix") throw new Error("matrix");
    const dm = engine.matrixToDistances({
      names: back.value.data.names,
      lower: back.value.data.lower,
    });
    if (!dm.ok) throw new Error(JSON.stringify(dm.error));
    const built = engine.buildTree(dm.value, "Nj", { trace: false });
    if (!built.ok) throw new Error(JSON.stringify(built.error));
    const cmp = engine.compare(drawn, built.value.tree);
    if (!cmp.ok) throw new Error(JSON.stringify(cmp.error));
    expect(cmp.value.rf).toBe(0);
  });
});

describe("meta.hand_steps (v1.4c Task 9)", () => {
  const META = {
    objectives: ["read a tree"],
    minutes: 15,
    level: "intermediate" as const,
    prepares_for: ["nj-basics"],
  };
  const withMeta = { ...EMPTY_PRESERVED, meta: META };

  it("a lesson's meta rides through untouched — import and re-save are byte-identical", () => {
    const imp = importExercise(
      readFileSync(
        resolve("src", "lessons", "__fixtures__", "v5-meta-valid.json"),
        "utf8",
      ),
    );
    if (!imp.ok) throw new Error(JSON.stringify(imp.error));
    const conv = settingsFromExercise(
      imp.value.exercise,
      imp.value.fileExtras,
    );
    if ("error" in conv) throw new Error(conv.error);
    expect(conv.preserved.meta).toEqual(imp.value.exercise.meta);
    // hand_steps initializes from the file's value so an untouched
    // draft writes it back unchanged.
    expect(conv.settings.handSteps).toBe(
      String(imp.value.exercise.meta?.hand_steps ?? ""),
    );
    const saved = saveExercise(
      buildExerciseState(
        tree(),
        conv.settings,
        conv.prompts,
        imp.value.fileExtras,
        conv.preserved,
      ),
    );
    if ("error" in saved) throw new Error(saved.error);
    const file = JSON.parse(saved.json) as { meta: unknown };
    expect(file.meta).toEqual(imp.value.exercise.meta);
  });

  it("a ≥1 integer lands in meta.hand_steps; blank removes only that key", () => {
    const metaWithSteps = { ...META, hand_steps: 2 };
    const preserved = { ...EMPTY_PRESERVED, meta: metaWithSteps };
    const set = buildExerciseState(
      tree(),
      settings({ handSteps: "4" }),
      [],
      undefined,
      preserved,
    );
    expect(set.exercise.meta).toEqual({ ...META, hand_steps: 4 });
    const blanked = buildExerciseState(
      tree(),
      settings({ handSteps: "" }),
      [],
      undefined,
      preserved,
    );
    expect(blanked.exercise.meta).toEqual(META);
    expect(blanked.exercise.meta).not.toHaveProperty("hand_steps");
  });

  it.each(["0", "-2", "1.5", "abc"])(
    'hand-steps "%s" is refused with a message and never written',
    (bad) => {
      const s = settings({ handSteps: bad });
      // The field only exists with a meta block — the verdict it
      // gates on is the with-meta one.
      const probs = settingsProblems(s, {
        prompts: [],
        preserved: withMeta,
      });
      expect(
        probs.some(
          (p) => p.field === "handSteps" && p.level === "error",
        ),
        JSON.stringify(probs),
      ).toBe(true);
      const state = buildExerciseState(tree(), s, [], undefined, withMeta);
      expect(state.exercise.meta).toEqual(META);
    },
  );

  it("no meta → the hidden field's value is ignored: no verdict, nothing written (owner ruling, PR #155)", () => {
    const s = settings({ handSteps: "3" });
    const probs = settingsProblems(s, {
      prompts: [],
      preserved: EMPTY_PRESERVED,
    });
    expect(probs.filter((p) => p.field === "handSteps")).toEqual([]);
    const state = buildExerciseState(
      tree(),
      s,
      [],
      undefined,
      EMPTY_PRESERVED,
    );
    expect(state.exercise.meta).toBeUndefined();
  });
});
