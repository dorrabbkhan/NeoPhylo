// Save, import and share-link helpers for the exercise editor (v1.4
// plan Task 7, spec §5.4).
//
// The wire `Exercise` (what `engine.loadExercise` returns) is not the
// file shape: `sim.model` and `analysis.correction` are engine enums
// (not the file's strings plus flat `kappa`/`base_freqs`), a
// `predict_branch` prompt carries the resolved `at_step` where the file
// says `at: "bootstrap"`, and the wasm serializer sends `None` as
// `null` for optional keys the schema refuses. `exerciseToFile`
// translates wire → file and omits every `null` the schema does not
// allow.
//
// `saveExercise` validates the file against exercises/schema.json with
// ajv AND reloads it through `engine.loadExercise`; only then is the
// JSON returned — a failing file names its first failing field in
// `{ error }` (ajv's instancePath as a dotted path, or the engine's
// `InvalidExercise.field`).
//
// `importExercise` accepts JSON file text or a `#x=` link/bare fragment
// decoded by the existing url.ts `decode` (no second decoder); both go
// through the same `engine.loadExercise` path, so schema 1, 2 and 3
// equivalents yield the same exercise.
//
// `shareLink` saves first — an unsaveable exercise gives `{ error }`,
// a link longer than SHARE_LINK_MAX_LENGTH gives `{ tooLong }`, never
// a truncated URL.

import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";

import schemaJson from "../../../exercises/schema.json";

import { engine, type Result } from "../engine/index";
import type { Exercise } from "../engine/generated/Exercise";
import type { NeoError } from "../engine/generated/NeoError";
import type { SimSpec } from "../engine/generated/SimSpec";

import { decode, encode } from "../state/url";

/**
 * The maximum length of a share link. PROVISIONAL — owner decision
 * pending (docs/decisions.md): the plan pins `maxLength` to "the
 * existing browser-safe limit already used by that encoder", but the
 * `#x=` encoder in url.ts defines none. 8000 octets is the minimum
 * request-line length RFC 9110 §4.1 recommends servers support; every
 * built-in exercise encodes well under it (cytochrome-c ≈ 4,500
 * characters).
 */
export const SHARE_LINK_MAX_LENGTH = 8000;

/**
 * The `schema_version` written on save: `CURRENT_SCHEMA_VERSION` in
 * crates/neophylo-core/src/exercise.rs (the constant is not exported to
 * TypeScript — ts-rs exports types only).
 */
export const CURRENT_SCHEMA_VERSION = 3;

/**
 * The state save/import/share operate on: the engine `Exercise` plus
 * `fileExtras`, the top-level file keys `loadExercise` drops (`summary`,
 * `lab`, author metadata, anything else) preserved verbatim so a save
 * round-trips them. There is no existing type that covers this — the
 * session's `LessonState` is a different concept.
 */
export interface ExerciseState {
  exercise: Exercise;
  fileExtras?: Record<string, unknown>;
}

// Top-level file keys consumed by the Exercise itself — v2/v3 keys and
// the v1 flat `true_tree`/`sim`, which load_exercise migrates and never
// re-emits. Everything else is fileExtras.
const EXERCISE_KEYS = new Set([
  "schema_version",
  "id",
  "title",
  "alphabet",
  "data",
  "reference",
  "analysis",
  "locked",
  "prompts",
  "bootstrap",
  "true_tree",
  "sim",
]);

const validate = new Ajv2020().compile(
  schemaJson as Record<string, unknown>,
);

function correctionName(
  c: Exclude<Exercise["analysis"]["correction"], object>,
): string {
  switch (c) {
    case "P":
      return "p";
    case "Jc69":
      return "JC69";
    case "K80":
      return "K80";
    case "Kimura":
      return "Kimura";
    case "Jtt":
      return "JTT";
    case "Poisson":
      return "Poisson";
    case "JttMega":
      return "JTT_MEGA";
    case "F84":
      return "F84";
  }
}

function simToFile(sim: SimSpec): Record<string, unknown> {
  const m = sim.model;
  if (m === "Jc69") {
    return { model: "JC69", length: sim.length, seed: sim.seed };
  }
  if (m === "Jtt") {
    return { model: "JTT", length: sim.length, seed: sim.seed };
  }
  if ("K80" in m) {
    return {
      model: "K80",
      kappa: m.K80.kappa,
      length: sim.length,
      seed: sim.seed,
    };
  }
  const [a, c, g, t] = m.F84.base_freqs;
  return {
    model: "F84",
    kappa: m.F84.kappa,
    base_freqs: { A: a, C: c, G: g, T: t },
    length: sim.length,
    seed: sim.seed,
  };
}

function analysisToFile(
  a: Exercise["analysis"],
): Record<string, unknown> {
  const method = a.method === "Nj" ? "NJ" : "UPGMA";
  const c = a.correction;
  if (typeof c === "string") {
    return { correction: correctionName(c), method };
  }
  return {
    correction: "K2P_PHYLIP",
    method,
    kappa: a.kappa ?? c.K2pPhylip.ratio,
  };
}

function promptToFile(
  p: Exercise["prompts"][number],
): Record<string, unknown> {
  const out: Record<string, unknown> = { type: p.type, concept: p.concept };
  if (p.type === "predict_branch") {
    // The file anchors a predict_branch prompt to the bootstrap panel;
    // the wire `at_step` is the stepper position resolved at load.
    out.at = "bootstrap";
  } else {
    out.at_step = p.at_step;
  }
  if (p.math !== null) out.math = p.math;
  if (p.reveal !== null) out.reveal = p.reveal;
  if (p.reveal_pair !== null) out.reveal_pair = p.reveal_pair;
  if (p.after !== null) out.after = p.after;
  return out;
}

/** Wire `Exercise` → the file object schema.json validates. */
function exerciseToFile(state: ExerciseState): Record<string, unknown> {
  const ex = state.exercise;
  const file: Record<string, unknown> = {
    schema_version: CURRENT_SCHEMA_VERSION,
    id: ex.id,
    title: ex.title,
    alphabet: ex.alphabet,
    data:
      ex.data.kind === "simulated"
        ? {
            kind: "simulated",
            true_tree: ex.data.true_tree,
            sim: simToFile(ex.data.sim),
          }
        : { kind: "embedded", fasta: ex.data.fasta, source: ex.data.source },
    analysis: analysisToFile(ex.analysis),
    locked: ex.locked,
    prompts: ex.prompts.map(promptToFile),
  };
  // `reference: null` is schema-valid; `bootstrap` and `after` are not —
  // omit every optional key rather than write a null it refuses.
  if (ex.reference !== null) file.reference = ex.reference;
  if (ex.bootstrap !== null) file.bootstrap = ex.bootstrap;
  // `summary` is required by the schema but not part of Exercise (a
  // display field the engine ignores): keep the imported one, else fall
  // back to the title so a bare { exercise } still produces a valid file.
  return { summary: ex.title, ...state.fileExtras, ...file };
}

/** ajv's first error as `dotted.path: message` (a `required` failure
 * names the missing property). */
function firstError(errors: ErrorObject[] | null | undefined): string {
  const err = errors?.[0];
  if (!err) return "schema validation failed";
  let path = err.instancePath.replace(/^\//, "").replaceAll("/", ".");
  if (err.keyword === "required") {
    const missing = (err.params as { missingProperty?: string })
      .missingProperty;
    if (missing) path = path ? `${path}.${missing}` : missing;
  }
  return path ? `${path}: ${err.message ?? "invalid"}` : `root: ${err.message ?? "invalid"}`;
}

function formatNeoError(e: NeoError): string {
  if (e.kind === "InvalidExercise") return `${e.field}: ${e.msg}`;
  if (e.kind === "InvalidEdit") return e.msg;
  const { kind, ...rest } = e;
  const detail = Object.entries(rest)
    .map(([k, v]) => `${k}=${JSON.stringify(v)}`)
    .join(", ");
  return detail ? `${kind}: ${detail}` : kind;
}

/**
 * Serialize the exercise to its file JSON. Returns `{ json }` only when
 * the file passes schema.json AND `engine.loadExercise`; `{ error }`
 * names the first failing field.
 */
export function saveExercise(
  state: ExerciseState,
): { json: string } | { error: string } {
  let json: string;
  let parsed: unknown;
  try {
    const file = exerciseToFile(state);
    json = JSON.stringify(file, null, 2) + "\n";
    // Validate the parsed text — the exact bytes written, not the object.
    parsed = JSON.parse(json);
  } catch {
    return { error: "the exercise could not be serialized" };
  }
  if (!validate(parsed)) {
    return { error: firstError(validate.errors) };
  }
  const r = engine.loadExercise(json);
  if (!r.ok) return { error: formatNeoError(r.error) };
  return { json };
}

function defaultBase(): string {
  if (typeof window === "undefined") return "";
  return window.location.origin + window.location.pathname;
}

/**
 * Build the `#x=` share link for the SAVED content: `base` +
 * `encode({ v: 3, x, step: 0, mode: "concept" })`, where `x` is the
 * exercise reloaded from the saved file. `base` defaults to the app's
 * origin+path and is injectable for tests. Over SHARE_LINK_MAX_LENGTH
 * returns `{ tooLong: true, maxLength }` — never a truncated URL. An
 * unsaveable exercise returns `{ error }`.
 */
export function shareLink(
  state: ExerciseState,
  base: string = defaultBase(),
):
  | { url: string }
  | { tooLong: true; maxLength: number }
  | { error: string } {
  const saved = saveExercise(state);
  if ("error" in saved) return saved;
  const loaded = engine.loadExercise(saved.json);
  if (!loaded.ok) return { error: formatNeoError(loaded.error) };
  const url = base + encode({ v: 3, x: loaded.value, step: 0, mode: "concept" });
  if (url.length > SHARE_LINK_MAX_LENGTH) {
    return { tooLong: true, maxLength: SHARE_LINK_MAX_LENGTH };
  }
  return { url };
}

/**
 * Validate an in-memory (wire-shape) exercise the same way an `#x=`
 * link's `x` is: re-serialize it to the file shape and run
 * `engine.loadExercise` — schema 1/2/3 migration included. Anything the
 * file shape can't represent or the engine refuses is a readable
 * `InvalidExercise`/`NeoError` value, never a throw. `importExercise`'s
 * link branch and the preview handshake share this path (fix round 3).
 */
export function loadWireExercise(raw: unknown): Result<Exercise> {
  let file: Record<string, unknown>;
  try {
    file = exerciseToFile({ exercise: raw as Exercise });
  } catch {
    return {
      ok: false,
      error: {
        kind: "InvalidExercise",
        field: "exercise",
        msg: "the exercise could not be read",
      },
    };
  }
  const r = engine.loadExercise(JSON.stringify(file));
  if (!r.ok) return { ok: false, error: r.error };
  return { ok: true, value: r.value };
}

function extrasFrom(parsed: unknown): Record<string, unknown> | undefined {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(parsed)) {
    if (!EXERCISE_KEYS.has(k)) out[k] = v;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function linkError(msg: string): Result<ExerciseState> {
  return {
    ok: false,
    error: { kind: "InvalidExercise", field: "link", msg },
  };
}

/**
 * Import an exercise from (a) JSON file text or (b) a `#x=` link or
 * bare `#x=` fragment. Files go through `engine.loadExercise` (schema
 * 1, 2 and 3 all migrate); links go through url.ts `decode` and then
 * the same loadExercise path on the exercise re-serialized to the file
 * shape. A `?lesson=` link or `#x=` garbage is a readable
 * `InvalidExercise` error, never a throw.
 */
export function importExercise(text: string): Result<ExerciseState> {
  const trimmed = text.trim();
  if (trimmed.startsWith("{")) {
    const r = engine.loadExercise(trimmed);
    if (!r.ok) return { ok: false, error: r.error };
    // loadExercise succeeded, so the text parses.
    const extras = extrasFrom(JSON.parse(trimmed));
    return { ok: true, value: { exercise: r.value, fileExtras: extras } };
  }
  const d = decode(trimmed);
  if (!d.ok) return linkError(d.reason);
  if (d.state.x === undefined) {
    return linkError("the link does not contain a custom exercise");
  }
  // The decoded `x` is the wire shape; loadWireExercise re-serializes
  // it to the file shape so it goes through the same engine.loadExercise
  // validation and migration as a file import.
  const loaded = loadWireExercise(d.state.x);
  if (!loaded.ok) return { ok: false, error: loaded.error };
  return { ok: true, value: { exercise: loaded.value } };
}
