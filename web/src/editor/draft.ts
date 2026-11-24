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

import type { Alphabet } from "../engine/generated/Alphabet";
import type { Analysis } from "../engine/generated/Analysis";
import type { DistanceInput } from "../engine/generated/DistanceInput";
import type { Exercise } from "../engine/generated/Exercise";
import type { Method } from "../engine/generated/Method";
import type { Prompt } from "../engine/generated/Prompt";
import type { SimModel } from "../engine/generated/SimModel";
import type { Source } from "../engine/generated/Source";
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
  | "JTT"
  | "Poisson";

/** The matrix the draft commits when `dataMode` is `"matrix"`
 * (v1.4c spec §6.4): the typed/pasted `DistanceInput` or one derived
 * from the drawn tree, plus the provenance written to `data.source`
 * and the alphabet the file declares the distances were computed
 * from. */
export interface EditorMatrix {
  input: DistanceInput;
  source: Source;
  /** `engine.writeNewick` of the drawn tree at derive time; `null`
   * for a typed, pasted or imported matrix. Drives the "the tree
   * changed" line — a typed matrix never claims to fit the tree. */
  derivedFrom: string | null;
  /** `data.alphabet` — required on every exercise; a fresh matrix
   * takes the current preset's alphabet, an imported file keeps its
   * own. */
  alphabet: Alphabet;
}

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
  /** MEGA gap treatment (v1.4b Task 11): null = the file carries no
   * `analysis.site_filter` (the default pairwise path). An explicit
   * `{kind:"pairwise"}` is a real v4 field that round-trips. */
  siteFilter: { kind: "pairwise" } | { kind: "complete" } | { kind: "partial" } | null;
  /** The partial-deletion site-coverage cutoff, as typed (only used
   * when siteFilter is partial). */
  cutoff: string;
  /** The data step's route (v1.4c spec §6.4): "simulate" keeps today's
   * sim settings visible; "matrix" hides them (they stay in the draft
   * and come back unchanged on the way back) and writes
   * `data.kind: "matrix"`. */
  dataMode: "simulate" | "matrix";
  /** The committed matrix while `dataMode` is "matrix" — `null` until
   * the author types, pastes or derives one. Always `null` in
   * simulate mode: switching back drops the matrix from the draft. */
  matrix: EditorMatrix | null;
  /** The "Hand-worked joins on the paper worksheet" input, as typed
   * (v1.4c §7.2); blank = the worksheet's default rule. Written into
   * `meta.hand_steps` — a meta block must exist, since the editor
   * never fabricates objectives, minutes or level. */
  handSteps: string;
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
  siteFilter: null,
  cutoff: "95",
  dataMode: "simulate",
  matrix: null,
  handSteps: "",
};

export interface SettingProblem {
  /** The form field the message belongs to. */
  field:
    | "kappa"
    | "baseFreqs"
    | "seed"
    | "length"
    | "title"
    | "cutoff"
    | "matrix"
    | "handSteps"
    | "prompts";
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

/** Draft-level context `settingsProblems` needs for the cross-field
 * verdicts the matrix route adds: a `predict_branch` prompt and
 * preserved bootstrap settings are refused on a matrix exercise, so
 * the form must call them out (Review Focus 1 — never a value the
 * form accepts that save refuses). */
export interface DraftContext {
  prompts: Prompt[];
  preserved: PreservedFields;
}

/** The live verdicts behind the form's inline messages and the
 * save/preview gates. Order is stable: κ, then frequencies, seed,
 * length, title. */
export function settingsProblems(
  s: EditorSettings,
  ctx: DraftContext = EMPTY_CONTEXT,
): SettingProblem[] {
  const out: SettingProblem[] = [];
  if (s.dataMode === "matrix") {
    // The simulation fields are hidden — their values are kept, not
    // judged. What save can still refuse: an empty matrix, a
    // predict_branch prompt and preserved bootstrap settings.
    if (s.matrix === null) {
      out.push({
        field: "matrix",
        level: "error",
        msg: "the matrix route needs a matrix — type or paste one, or derive it from the drawn tree.",
      });
    }
    if (ctx.prompts.some((p) => p.type === "predict_branch")) {
      out.push({
        field: "prompts",
        level: "error",
        msg: "a predict_branch prompt needs the bootstrap stage — a matrix exercise has none; remove the prompt to save.",
      });
    }
    if (ctx.preserved.bootstrap !== null) {
      out.push({
        field: "matrix",
        level: "error",
        msg: "the imported bootstrap settings can't go on a matrix exercise — switch back to simulated data to keep them.",
      });
    }
  }
  // The hand-steps input renders only when the file carries a meta
  // block (owner ruling, PR #155) — on a meta-less draft the field is
  // hidden, so a stale value is ignored here rather than blocking
  // save. `meta.hand_steps` can only live inside a complete meta
  // block, and the editor never fabricates objectives, minutes or
  // level.
  const handSteps = parseDecimal(s.handSteps);
  if (s.handSteps.trim() !== "" && ctx.preserved.meta !== undefined) {
    if (
      handSteps === null ||
      !Number.isInteger(handSteps) ||
      handSteps < 1
    ) {
      out.push({
        field: "handSteps",
        level: "error",
        msg: `hand-worked joins must be a whole number of 1 or more (got "${s.handSteps.trim()}") — blank uses the worksheet's default rule.`,
      });
    }
  }
  if (s.model === "K2P_PHYLIP" && s.dataMode === "simulate") {
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
  if (s.model === "F84" && s.dataMode === "simulate") {
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
          msg: `Sum: ${roundTo(sum, 6)} — must be 1 to save.`,
        });
      }
    }
  }
  if (s.siteFilter?.kind === "partial" && s.dataMode === "simulate") {
    const c = parseDecimal(s.cutoff);
    if (c === null || !Number.isInteger(c) || c < 0 || c > 100) {
      out.push({
        field: "cutoff",
        level: "error",
        msg: `the site-coverage cutoff must be a whole number from 0 to 100 (got "${s.cutoff.trim() || "empty"}").`,
      });
    }
  }
  const seed = parseDecimal(s.seed);
  if (
    s.dataMode === "simulate" &&
    (seed === null || !Number.isInteger(seed) || seed < 0)
  ) {
    out.push({
      field: "seed",
      level: "error",
      msg: "the seed must be a non-negative integer.",
    });
  }
  const length = parseDecimal(s.length);
  if (
    s.dataMode === "simulate" &&
    (length === null ||
      !Number.isInteger(length) ||
      length < 10 ||
      length > 10000)
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
  // v1.4b Task 11: MEGA's Poisson correction, simulated under JTT.
  Poisson: {
    alphabet: "protein",
    sim: () => "Jtt",
    correction: () => "Poisson",
  },
};

/** The alphabet the selected preset implies — a fresh matrix's
 * `data.alphabet` too (the hidden model still picks it while the
 * matrix route is on, v1.4c Task 9). */
export function presetAlphabet(s: EditorSettings): Alphabet {
  return PRESETS[s.model].alphabet;
}

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

/** Exercise fields the editor's form can't edit, carried verbatim from
 * an imported file to the saved one — an import must never silently
 * drop `reference`, `locked` or `bootstrap` (fix round 1). The
 * fresh-draft default is `EMPTY_PRESERVED`. */
export interface PreservedFields {
  reference: Exercise["reference"];
  locked: Exercise["locked"];
  bootstrap: Exercise["bootstrap"];
  /** v1.4c Task 9: a lesson's meta block rides through verbatim so an
   * open-and-save keeps objectives/minutes/level byte-identical;
   * the hand-steps input only ever touches `hand_steps`. */
  meta: Exercise["meta"];
  /** v1.5 Task 4: variant premises ride through verbatim like `meta`. */
  premises: Exercise["premises"];
}

export const EMPTY_PRESERVED: PreservedFields = {
  reference: null,
  locked: [],
  bootstrap: null,
  meta: undefined,
  premises: undefined,
};

export const EMPTY_CONTEXT: DraftContext = {
  prompts: [],
  preserved: EMPTY_PRESERVED,
};

/** Short names for the fields `preserved` actually carries, for the
 * Settings section's read-only notice. */
export function preservedFieldNames(p: PreservedFields): string[] {
  const names: string[] = [];
  if (p.reference !== null) names.push("reference");
  if (p.locked.length > 0) names.push("locked controls");
  if (p.bootstrap !== null) names.push("bootstrap");
  if (p.meta !== undefined) names.push("meta");
  if (p.premises !== undefined && p.premises.length > 0)
    names.push("premises");
  return names;
}

/**
 * Assemble the tree, settings and prompts into the `ExerciseState`
 * `saveExercise`, `shareLink` and the preview consume. Fields the form
 * marked invalid are written through as NaN — `JSON.stringify` turns
 * them into `null`, which the schema/engine refuse with the field's
 * name, so the build itself can never invent a saveable value the form
 * called invalid. `preserved` writes through untouched — if an edit
 * makes one invalid (a reference whose taxa no longer match the tree),
 * `saveExercise`'s engine reload refuses it by name as usual.
 */
export function buildExerciseState(
  tree: Tree,
  s: EditorSettings,
  prompts: Prompt[],
  extras?: Record<string, unknown>,
  preserved: PreservedFields = EMPTY_PRESERVED,
): ExerciseState {
  const preset = PRESETS[s.model];
  const seed = parseDecimal(s.seed) ?? NaN;
  const length = parseDecimal(s.length) ?? NaN;
  const analysis: Exercise["analysis"] =
    s.dataMode === "matrix"
      ? // A matrix exercise runs the supplied-distance model (v1.4c
        // §4.3): `method` is its only analysis setting — never kappa
        // or a site filter.
        { correction: "Supplied", method: s.method }
      : { correction: preset.correction(s), method: s.method };
  if (s.dataMode === "simulate" && s.model === "K2P_PHYLIP") {
    analysis.kappa = parseDecimal(s.kappa) ?? NaN;
  }
  if (s.dataMode === "simulate" && s.siteFilter !== null) {
    analysis.site_filter =
      s.siteFilter.kind === "partial"
        ? { kind: "partial", cutoff_pct: parseDecimal(s.cutoff) ?? NaN }
        : s.siteFilter;
  }
  const atStep = bootstrapStep(tree, s.method);
  const handSteps = parseDecimal(s.handSteps);
  // Schema 5 the moment the file carries any v5 field — matrix data,
  // a meta block or premises — else the pre-v1.4c rule (v1.4b Task 11,
  // v1.5 Task 4).
  const schemaVersion =
    s.dataMode === "matrix" ||
    preserved.meta !== undefined ||
    (preserved.premises !== undefined && preserved.premises.length > 0)
      ? 5
      : s.model === "Poisson" || s.siteFilter !== null
        ? 4
        : 3;
  const exercise: Exercise = {
    schema_version: schemaVersion,
    id: s.id.trim() || "exercise",
    title: s.title,
    alphabet:
      s.dataMode === "matrix" && s.matrix !== null
        ? s.matrix.alphabet
        : preset.alphabet,
    data:
      s.dataMode === "matrix" && s.matrix !== null
        ? {
            kind: "matrix",
            names: s.matrix.input.names,
            lower: s.matrix.input.lower,
            source: s.matrix.source,
          }
        : {
            kind: "simulated",
            true_tree: engine.writeNewick(tree),
            sim: { model: preset.sim(s), length, seed },
          },
    reference: preserved.reference,
    analysis,
    locked: preserved.locked,
    prompts: prompts.map((p) =>
      p.type === "predict_branch" ? { ...p, at_step: atStep } : p,
    ),
    bootstrap: s.dataMode === "matrix" ? null : preserved.bootstrap,
  };
  if (preserved.meta !== undefined) {
    // `hand_steps` is the only meta field the form edits — the rest
    // of the block survives byte-identical; blank removes only it.
    exercise.meta = { ...preserved.meta };
    if (
      handSteps !== null &&
      Number.isInteger(handSteps) &&
      handSteps >= 1
    ) {
      exercise.meta.hand_steps = handSteps;
    } else {
      delete exercise.meta.hand_steps;
    }
  }
  if (preserved.premises !== undefined && preserved.premises.length > 0)
    exercise.premises = preserved.premises;
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
  | { settings: EditorSettings; prompts: Prompt[]; preserved: PreservedFields }
  | { error: string } {
  if (ex.data.kind === "matrix") {
    // v1.4c Task 9: a matrix exercise loads into the matrix route
    // verbatim — names, lower triangle, source and the declared
    // alphabet. `derivedFrom` stays null: a file never claims its
    // matrix came from the drawn tree.
    return {
      settings: {
        ...DEFAULT_SETTINGS,
        id: ex.id,
        title: ex.title,
        method: ex.analysis.method,
        dataMode: "matrix",
        matrix: {
          input: { names: ex.data.names, lower: ex.data.lower },
          source: ex.data.source,
          derivedFrom: null,
          alphabet: ex.alphabet,
        },
        handSteps:
          ex.meta?.hand_steps === undefined
            ? ""
            : String(ex.meta.hand_steps),
      },
      prompts: ex.prompts,
      preserved: {
        reference: ex.reference,
        locked: ex.locked,
        bootstrap: ex.bootstrap,
        meta: ex.meta,
        premises: ex.premises,
      },
    };
  }
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
  else if (model === "Jtt" && c === "Poisson") choice = "Poisson";
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
      // v1.4b Task 11: the site filter is a real setting now, not a
      // dropped field — an explicit {kind:"pairwise"} from a v4 file
      // round-trips as Some instead of becoming absent.
      siteFilter:
        ex.analysis.site_filter === undefined
          ? null
          : { kind: ex.analysis.site_filter.kind },
      cutoff:
        ex.analysis.site_filter?.kind === "partial"
          ? String(ex.analysis.site_filter.cutoff_pct)
          : "95",
      // A pre-Task-9 draft has no matrix fields — they take the
      // simulate defaults so an old file loads exactly as before.
      dataMode: "simulate",
      matrix: null,
      handSteps:
        ex.meta?.hand_steps === undefined
          ? ""
          : String(ex.meta.hand_steps),
    },
    prompts: ex.prompts,
    // Fields the form can't edit ride along verbatim so a save writes
    // them back — never silently dropped (fix round 1).
    preserved: {
      reference: ex.reference,
      locked: ex.locked,
      bootstrap: ex.bootstrap,
      meta: ex.meta,
      premises: ex.premises,
    },
  };
}
