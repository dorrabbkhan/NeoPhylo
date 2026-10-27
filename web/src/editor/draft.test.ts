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
import type { Exercise } from "../engine/generated/Exercise";
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
    .filter((f) => f.endsWith(".json") && f !== "schema.json")
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
        original.data.kind === "simulated" ? original.data.true_tree : "",
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
