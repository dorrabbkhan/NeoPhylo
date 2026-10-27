// The editor's non-tree exercise draft (v1.4 plan Task 10, spec §5.3,
// §5.4): the settings the form collects — model, κ, base frequencies,
// seed, length, method and file metadata — plus the mapping that turns
// them into the `ExerciseState` `saveExercise` consumes.
//
// The one "Model" select drives a matched (sim model, distance
// correction, alphabet) triple, following the lesson convention that a
// exercise simulates and corrects under the same model: JC69→JC69,
// K80→K80 at the dnadist/app default κ = 2, F84→F84 (the instructor's
// base frequencies apply to SIMULATION only — estimation uses observed
// frequencies, as dnadist does), K2P_PHYLIP→K80{κ} for simulation with
// the same κ as the analysis ratio (spec §2.1), and the protein models
// Kimura/JTT→JTT simulation on a protein alphabet.
//
// The numeric fields stay STRINGS until build time: `settingsProblems`
// is the single validation source the form displays live and the
// save/preview buttons gate on, so a value the form accepts can never
// fail saveExercise and a value saveExercise refuses is never shown as
// valid (Review Focus 1). κ in (0, 0.5] is a WARNING, not an error —
// the engine, like dnadist, accepts it and clamps to 0.5 (owner
// decision, PR #88).

import type { Analysis } from "../engine/generated/Analysis";
import type { Exercise } from "../engine/generated/Exercise";
import type { Method } from "../engine/generated/Method";
import type { Prompt } from "../engine/generated/Prompt";
import type { SimModel } from "../engine/generated/SimModel";
import type { Tree } from "../engine/generated/Tree";
import { engine } from "../engine/index";

import type { ExerciseState } from "./exerciseFile";

/** The model select's choices — each a matched (sim, correction,
 * alphabet) preset. */
export type EditorModelChoice =
  | "JC69"
  | "K80"
  | "F84"
  | "K2P_PHYLIP"
  | "Kimura"
  | "JTT";

export interface EditorSettings {
  id: string;
  title: string;
  /** Short description — the file's `summary` (falls back to title). */
  summary: string;
  /** Free-text author metadata (spec §4); omitted when blank. */
  author: string;
  model: EditorModelChoice;
  /** The K2P_PHYLIP transition/transversion ratio, as typed. */
  kappa: string;
  /** F84's A, C, G, T base frequencies, as typed. */
  baseFreqs: [string, string, string, string];
  seed: string;
  length: string;
  method: Method;
}

export const DEFAULT_SETTINGS: EditorSettings = {
  id: "my-exercise",
  title: "My exercise",
  summary: "",
  author: "",
  model: "JC69",
  kappa: "2",
  baseFreqs: ["0.25", "0.25", "0.25", "0.25"],
  seed: "1",
  length: "300",
  method: "Nj",
};

export interface SettingProblem {
  /** The form field the message belongs to. */
  field: "kappa" | "baseFreqs" | "seed" | "length" | "title";
  level: "error" | "warning";
  msg: string;
}

// Plain decimal or scientific notation only — the same lexical rule the
// branch table uses (`Number()` also accepts hex and binary, which an
// exercise file must never carry).
const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;

/** A finite decimal number from a text field, or null. */
function parseDecimal(t: string): number | null {
  const v = t.trim();
  if (v === "" || !DECIMAL.test(v)) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseFreqs(s: EditorSettings): [number, number, number, number] {
  return s.baseFreqs.map((t) => parseDecimal(t) ?? NaN) as [
    number,
    number,
    number,
    number,
  ];
}

const SUM_EPS = 1e-6;

/** The live verdicts behind the form's inline messages and the
 * save/preview gates. Order is stable: κ, then frequencies, seed,
 * length, title. */
export function settingsProblems(s: EditorSettings): SettingProblem[] {
  const out: SettingProblem[] = [];
  if (s.model === "K2P_PHYLIP") {
    const k = parseDecimal(s.kappa);
    if (k === null) {
      out.push({
        field: "kappa",
        level: "error",
        msg: `κ must be a positive number (got "${s.kappa.trim() || "empty"}").`,
      });
    } else if (k <= 0) {
      out.push({
        field: "kappa",
        level: "error",
        msg: "κ must be positive.",
      });
    } else if (k <= 0.5) {
      out.push({
        field: "kappa",
        level: "warning",
        msg: "dnadist treats ratios ≤ 0.5 as 0.5 — the exercise will behave as if κ were 0.5.",
      });
    }
  }
  if (s.model === "F84") {
    const names = ["A", "C", "G", "T"];
    const vals = s.baseFreqs.map((t) => parseDecimal(t));
    const bad = vals.findIndex((v) => v === null || (v as number) <= 0);
    if (bad >= 0) {
      out.push({
        field: "baseFreqs",
        level: "error",
        msg: `the ${names[bad]} frequency must be a positive number.`,
      });
    } else {
      const sum = (vals as number[]).reduce((a, b) => a + b, 0);
      if (Math.abs(sum - 1) > SUM_EPS) {
        out.push({
          field: "baseFreqs",
          level: "error",
          msg: `the base frequencies sum to ${roundTo(sum, 6)}, not 1.`,
        });
      }
    }
  }
  const seed = parseDecimal(s.seed);
  if (seed === null || !Number.isInteger(seed) || seed < 0) {
    out.push({
      field: "seed",
      level: "error",
      msg: "the seed must be a non-negative integer.",
    });
  }
  const length = parseDecimal(s.length);
  if (
    length === null ||
    !Number.isInteger(length) ||
    length < 10 ||
    length > 10000
  ) {
    out.push({
      field: "length",
      level: "error",
      msg: "the sequence length must be an integer in 10–10,000.",
    });
  }
  if (s.title.trim() === "") {
    out.push({
      field: "title",
      level: "error",
      msg: "the exercise needs a title.",
    });
  }
  return out;
}

function roundTo(v: number, digits: number): number {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
}

interface Preset {
  alphabet: "dna" | "protein";
  sim: (s: EditorSettings) => SimModel;
  correction: (s: EditorSettings) => Analysis["correction"];
}

const PRESETS: Record<EditorModelChoice, Preset> = {
  JC69: { alphabet: "dna", sim: () => "Jc69", correction: () => "Jc69" },
  // dnadist's and the app's default κ.
  K80: {
    alphabet: "dna",
    sim: () => ({ K80: { kappa: 2 } }),
    correction: () => "K80",
  },
  F84: {
    alphabet: "dna",
    // dnadist's fixed ratio is 2.0; the instructor sets the
    // frequencies, which apply to simulation only.
    sim: (s) => ({ F84: { kappa: 2, base_freqs: parseFreqs(s) } }),
    correction: () => "F84",
  },
  // Spec §2.1: K2P_PHYLIP simulation reuses the K80 simulator with κ
  // set to the analysis ratio.
  K2P_PHYLIP: {
    alphabet: "dna",
    sim: (s) => ({ K80: { kappa: parseDecimal(s.kappa) ?? NaN } }),
    correction: (s) => ({
      K2pPhylip: { ratio: parseDecimal(s.kappa) ?? NaN },
    }),
  },
  Kimura: {
    alphabet: "protein",
    sim: () => "Jtt",
    correction: () => "Kimura",
  },
  JTT: { alphabet: "protein", sim: () => "Jtt", correction: () => "Jtt" },
};

/** Leaves of the ROOT component only — the alignment's taxa (detached
 * components never reach the saved file's true_tree). */
function mainLeafCount(tree: Tree): number {
  let n = 0;
  const visit = (id: number): void => {
    const node = tree.nodes[id];
    if (node === undefined) return;
    if (node.children.length === 0) {
      n += 1;
      return;
    }
    for (const c of node.children) visit(c);
  };
  visit(tree.root);
  return n;
}

/** The stepper position a `predict_branch` prompt resolves to at load
 * (exercise.rs: n−1 for NJ, n for UPGMA on n taxa). The file shape
 * writes `at: "bootstrap"` instead; the wire value keeps the editor's
 * in-memory Exercise faithful to what a load produces. */
function bootstrapStep(tree: Tree, method: Method): number {
  const n = mainLeafCount(tree);
  return method === "Nj" ? Math.max(1, n - 1) : n;
}

/**
 * Assemble the tree, settings and prompts into the `ExerciseState`
 * `saveExercise`, `shareLink` and the preview consume. Fields the form
 * marked invalid are written through as NaN — `JSON.stringify` turns
 * them into `null`, which the schema/engine refuse with the field's
 * name, so the build itself can never invent a saveable value the form
 * called invalid.
 */
export function buildExerciseState(
  tree: Tree,
  s: EditorSettings,
  prompts: Prompt[],
  extras?: Record<string, unknown>,
): ExerciseState {
  const preset = PRESETS[s.model];
  const seed = parseDecimal(s.seed) ?? NaN;
  const length = parseDecimal(s.length) ?? NaN;
  const correction = preset.correction(s);
  const analysis: Exercise["analysis"] = { correction, method: s.method };
  if (s.model === "K2P_PHYLIP") {
    analysis.kappa = parseDecimal(s.kappa) ?? NaN;
  }
  const atStep = bootstrapStep(tree, s.method);
  const exercise: Exercise = {
    schema_version: 3,
    id: s.id.trim() || "exercise",
    title: s.title,
    alphabet: preset.alphabet,
    data: {
      kind: "simulated",
      true_tree: engine.writeNewick(tree),
      sim: { model: preset.sim(s), length, seed },
    },
    reference: null,
    analysis,
    locked: [],
    prompts: prompts.map((p) =>
      p.type === "predict_branch" ? { ...p, at_step: atStep } : p,
    ),
    bootstrap: null,
  };
  const fileExtras: Record<string, unknown> = { ...extras };
  // `summary` is required by the schema and lives outside Exercise —
  // keep it in fileExtras like an imported file's would be.
  fileExtras.summary =
    s.summary.trim() === "" ? s.title : s.summary.trim();
  const author = s.author.trim();
  if (author === "") delete fileExtras.author;
  else fileExtras.author = author;
  return { exercise, fileExtras };
}

/**
 * The inverse of `buildExerciseState`, for import: the exercise's
 * (sim, correction, alphabet) must match one preset or the file is
 * refused rather than silently rewritten — an out-of-vocabulary
 * combination (a K80 sim at κ ≠ 2, a p correction, embedded data) names
 * what it found in the error.
 */
export function settingsFromExercise(
  ex: Exercise,
  extras?: Record<string, unknown>,
):
  | { settings: EditorSettings; prompts: Prompt[] }
  | { error: string } {
  if (ex.data.kind !== "simulated") {
    return {
      error:
        "this exercise embeds fixed sequences — the editor builds simulated-data exercises.",
    };
  }
  const { sim } = ex.data;
  const c = ex.analysis.correction;
  const model = sim.model;
  const k = (m: SimModel): number | null =>
    typeof m === "object" && "K80" in m ? m.K80.kappa : null;
  const f84k = (m: SimModel): number | null =>
    typeof m === "object" && "F84" in m ? m.F84.kappa : null;

  let choice: EditorModelChoice;
  let kappa = "2";
  let baseFreqs: EditorSettings["baseFreqs"] = [
    "0.25",
    "0.25",
    "0.25",
    "0.25",
  ];
  if (model === "Jc69" && c === "Jc69") choice = "JC69";
  else if (k(model) === 2 && c === "K80") choice = "K80";
  else if (typeof model === "object" && "F84" in model && c === "F84") {
    if (f84k(model) !== 2) {
      return {
        error: `the exercise simulates F84 at κ = ${f84k(model)}, which the editor can't represent (it writes dnadist's fixed 2.0).`,
      };
    }
    choice = "F84";
    baseFreqs = model.F84.base_freqs.map(String) as EditorSettings["baseFreqs"];
  } else if (
    k(model) !== null &&
    typeof c === "object" &&
    "K2pPhylip" in c
  ) {
    if (k(model) !== c.K2pPhylip.ratio) {
      return {
        error: `the exercise simulates K80 at κ = ${k(model)} but corrects at ratio ${c.K2pPhylip.ratio} — the editor keeps the two equal (spec §2.1).`,
      };
    }
    choice = "K2P_PHYLIP";
    kappa = String(c.K2pPhylip.ratio);
  } else if (model === "Jtt" && c === "Kimura") choice = "Kimura";
  else if (model === "Jtt" && c === "Jtt") choice = "JTT";
  else {
    const simName =
      typeof model === "string" ? model : Object.keys(model)[0];
    const corrName = typeof c === "string" ? c : Object.keys(c)[0];
    return {
      error: `the editor can't represent sim "${simName}" with correction "${corrName}" — the model select covers JC69, K80, F84, K2P_PHYLIP, Kimura and JTT.`,
    };
  }

  const str = (v: unknown): string =>
    typeof v === "string" ? v : "";
  return {
    settings: {
      id: ex.id,
      title: ex.title,
      summary: str(extras?.summary),
      author: str(extras?.author),
      model: choice,
      kappa,
      baseFreqs,
      seed: String(sim.seed),
      length: String(sim.length),
      method: ex.analysis.method,
    },
    prompts: ex.prompts,
  };
}
