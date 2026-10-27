// Lab registry (v1.4 plan Task 11, spec §6.2/§6.5). A lab pack is an
// ordinary exercise file with a `lab` block, kept in the repo-level
// exercises/labs/ directory and bundled as raw text like the lesson
// catalog — so labs work offline and need no fetch path. The shipped
// directory is empty until Task 12 lands the three packs; the lab
// index shows its empty state meanwhile.
//
// web/src/labs/__fixtures__/*.json is the e2e-only half of the
// registry: those files join the listing only when the standard
// `neophylo-e2e` localStorage flag is set (checked per call, so a test
// can toggle it), never for a real visitor.
//
// listLabs needs no engine — it parses the JSON and checks the lab
// block's shape with the same ajv schema the save path uses. loadLab
// additionally runs engine.loadExercise (the page calls it after
// initEngine) and returns the wire Exercise plus the lab block and
// the raw file text; a registry file without its lab block is refused
// with that reason named.

import Ajv2020 from "ajv/dist/2020.js";
import type { ErrorObject } from "ajv";

import schemaJson from "../../../exercises/schema.json";

import { engine, type Result } from "../engine/index";
import type { Exercise } from "../engine/generated/Exercise";
import type { NeoError } from "../engine/generated/NeoError";

/** One row of the lab's settings table (spec §6.2). */
export interface LabSetting {
  option: string;
  phylip_default: string;
  neophylo: string;
}

/** The exercise file's `lab` block (schema_version 3). */
export interface LabBlock {
  id: string;
  title: string;
  objectives: string[];
  handout_md: string;
  settings: LabSetting[];
  phylip_note_md: string;
  chain: string[];
}

/** One lab as the index lists it. `id` is the registry key — the lab
 * file's name without .json, which the `?lab=` route uses. */
export interface LabSummary {
  id: string;
  title: string;
  objectives: string[];
  settings: LabSetting[];
  chain: string[];
  /** True for exercises/labs/ files, false for the e2e fixtures. */
  shipped: boolean;
}

/** A fully validated lab: the wire exercise, its lab block and the
 * raw file text (the editor's import path and the file link consume
 * the text). */
export interface LabExercise {
  id: string;
  exercise: Exercise;
  lab: LabBlock;
  fileName: string;
  text: string;
  shipped: boolean;
}

const SHIPPED = import.meta.glob<string>("../../../exercises/labs/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
});
const FIXTURES = import.meta.glob<string>("./__fixtures__/*.json", {
  query: "?raw",
  import: "default",
  eager: true,
});

const validate = new Ajv2020().compile(
  schemaJson as Record<string, unknown>,
);

function e2eEnabled(): boolean {
  try {
    return window.localStorage.getItem("neophylo-e2e") === "1";
  } catch {
    return false;
  }
}

function stem(path: string): string {
  const base = path.slice(path.lastIndexOf("/") + 1);
  return base.replace(/\.json$/, "");
}

interface LabFile {
  id: string;
  text: string;
  shipped: boolean;
}

/** The whole registry: shipped packs always, e2e fixtures only under
 * the flag. Keyed by file-name stem, which is also the `?lab=` id and
 * must match the lab block's own `id`. */
function labFiles(): Map<string, LabFile> {
  const out = new Map<string, LabFile>();
  for (const [path, text] of Object.entries(SHIPPED)) {
    const id = stem(path);
    out.set(id, { id, text, shipped: true });
  }
  if (e2eEnabled()) {
    for (const [path, text] of Object.entries(FIXTURES)) {
      const id = stem(path);
      out.set(id, { id, text, shipped: false });
    }
  }
  return out;
}

function invalid(field: string, msg: string): Result<never> {
  return {
    ok: false,
    error: { kind: "InvalidExercise", field, msg } as NeoError,
  };
}

/** ajv's first error as `dotted.path: message` — same convention as
 * exerciseFile's save errors. */
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

interface ParsedLab {
  lab: LabBlock;
  /** Dotted path + message when the file fails the schema. */
  schemaError?: string;
}

/** Parse the file and isolate its lab block; the file must also pass
 * exercises/schema.json (which validates the lab block's shape). */
function parseLab(file: LabFile): ParsedLab | Result<never> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(file.text);
  } catch {
    return invalid("lab", `lab "${file.id}" is not valid JSON.`);
  }
  const lab = (parsed as { lab?: unknown }).lab;
  if (lab === undefined || lab === null) {
    return invalid(
      "lab",
      `lab "${file.id}" is an exercise file without a lab block.`,
    );
  }
  return {
    lab: lab as LabBlock,
    schemaError: validate(parsed)
      ? undefined
      : firstError(validate.errors),
  };
}

/**
 * The labs for the index page: every registry file that parses, has a
 * lab block and passes the schema. A broken file is skipped rather
 * than listed — loadLab still refuses it with the reason if its id is
 * opened directly. Sorted by id for a stable order.
 */
export function listLabs(): LabSummary[] {
  const out: LabSummary[] = [];
  for (const file of labFiles().values()) {
    const r = parseLab(file);
    if ("ok" in r || r.schemaError !== undefined) continue;
    out.push({
      id: file.id,
      title: r.lab.title,
      objectives: r.lab.objectives,
      settings: r.lab.settings,
      chain: r.lab.chain,
      shipped: file.shipped,
    });
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Load and fully validate one lab by its registry id (the file-name
 * stem, also the `?lab=` route value). The file must parse, carry a
 * `lab` block whose `id` matches the file name, pass
 * exercises/schema.json and load through engine.loadExercise — the
 * same double gate saveExercise uses. Every failure is a readable
 * InvalidExercise value, never a throw.
 */
export function loadLab(id: string): Result<LabExercise> {
  const file = labFiles().get(id);
  if (file === undefined) {
    return invalid("lab", `there is no lab named "${id}".`);
  }
  const parsed = parseLab(file);
  if ("ok" in parsed) return parsed;
  if (parsed.lab.id !== file.id) {
    return invalid(
      "lab.id",
      `lab "${file.id}" declares lab.id "${parsed.lab.id}" — the block id must match the file name.`,
    );
  }
  if (parsed.schemaError !== undefined) {
    return invalid("lab", `lab "${file.id}": ${parsed.schemaError}.`);
  }
  const r = engine.loadExercise(file.text);
  if (!r.ok) return { ok: false, error: r.error };
  return {
    ok: true,
    value: {
      id: file.id,
      exercise: r.value,
      lab: parsed.lab,
      fileName: `${file.id}.json`,
      text: file.text,
      shipped: file.shipped,
    },
  };
}
