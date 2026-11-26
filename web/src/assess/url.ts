// `#a=` assignment links (v1.5 spec §7.1, plan Task 6): the whole
// assignment file rides in the URL fragment, lz-compressed like the
// app's `#x=`/`#r=` links, so nothing is sent to a server. The
// envelope is `{ v: 1, assignment }` where `assignment` is the
// authored `.neophylo-assignment.json` shape — `content` an embedded
// `exercise`/`reading` file or a `builtin` reference. The engine's
// `loadAssignment` is the only validator: TypeScript never re-checks
// a file itself, so a bad link surfaces the engine's own
// `InvalidAssignment` message.
//
// A `builtin` reference is resolved at open time against the content
// files this build serves — lessons, labs and reading sets — and the
// served text is injected as `content.file` before `loadAssignment`
// runs (the saved link never carries it: that is what lets grading
// flag `ContentChanged` when the file has since been edited).

import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";

import { engine, type Result } from "../engine/index";
import type { Assignment } from "../engine/generated/Assignment";
import type { IdRule } from "../engine/generated/IdRule";
import type { Mode } from "../engine/generated/Mode";
import type { NeoError } from "../engine/generated/NeoError";
import type { TaskRef } from "../engine/generated/TaskRef";

const LINK_VERSION = 1;

/**
 * The authored assignment file shape (`exercises/assignment.schema.json`)
 * — what a `.neophylo-assignment.json` saves and what a `#a=` link
 * carries. `content.builtin` references a shipped lesson, lab or
 * reading set by its file id and records the content hash as served
 * at authoring time.
 */
export interface AssignmentFile {
  schema_version: 1;
  kind: "assignment";
  id: string;
  title: string;
  instructions?: string;
  content:
    | { exercise: unknown }
    | { reading: unknown }
    | { builtin: string; content_hash: string };
  id_prompt: { label: string; rule?: IdRule };
  mode: Mode;
  variation: boolean;
  tasks: { task: TaskRef; points?: number }[];
}

/** A pre-engine refusal, shaped like the engine's error so the page
 *  renders link failures and load failures identically. */
function linkError<T>(msg: string): Result<T> {
  const error: NeoError = {
    kind: "InvalidAssignment",
    field: "link",
    msg,
  };
  return { ok: false, error };
}

// The built-in content files, bundled as raw text and fetched lazily —
// the same `?raw` glob pattern the lab and reading registries use.
const LESSON_FILES = import.meta.glob<string>("../../../exercises/*.json", {
  query: "?raw",
  import: "default",
});
const LAB_FILES = import.meta.glob<string>("../../../exercises/labs/*.json", {
  query: "?raw",
  import: "default",
});
const READING_FILES = import.meta.glob<string>(
  "../../../exercises/reading/**/*.json",
  { query: "?raw", import: "default" },
);

/** The served bytes of the built-in content `id` names, or `null`
 *  when no lesson, lab or reading set carries that file stem. An id
 *  with path separators can never match — glob keys are fixed literal
 *  paths, so `..` just misses. The Task-7 assignment builder resolves
 *  its `builtin` content the same way (spec §6). */
export async function builtinText(id: string): Promise<string | null> {
  const load =
    LESSON_FILES[`../../../exercises/${id}.json`] ??
    LAB_FILES[`../../../exercises/labs/${id}.json`] ??
    READING_FILES[`../../../exercises/reading/${id}.json`] ??
    READING_FILES[`../../../exercises/reading/coverage/${id}.json`];
  return load ? load() : null;
}

/**
 * Serialize an assignment file for a `#a=` link — the authored shape,
 * verbatim (a `builtin` reference keeps its recorded hash; the served
 * text is resolved again at open time).
 */
export function encodeAssignmentLink(a: AssignmentFile): string {
  return (
    "#a=" +
    compressToEncodedURIComponent(
      JSON.stringify({ v: LINK_VERSION, assignment: a }),
    )
  );
}

/** The decoded assignment plus the resolved file text — what
 * `makeVariant`, `checkTask`, `encodeCode` and `grade` consume
 * (`builtin` references carry the injected `file` text, so the
 * served content hash is set on every engine load). */
export interface ResolvedAssignment {
  assignment: Assignment;
  json: string;
}

/**
 * Decode an `#a=` fragment (or a whole href containing one) back to
 * the loaded `Assignment` and the resolved file text it was loaded
 * from. Failures are `NeoError` values: a malformed fragment
 * reports what failed — "the assignment could not be decompressed"
 * for `#a=zzz`, never the engine-load message (checkpoint §21(h))
 * — a well-formed fragment carrying a bad file reports the
 * engine's `InvalidAssignment`.
 */
export async function resolveAssignmentLink(
  href: string,
): Promise<Result<ResolvedAssignment>> {
  const start = href.indexOf("#a=");
  if (start < 0) {
    return linkError("this link carries no assignment");
  }
  let json: string | null;
  try {
    json = decompressFromEncodedURIComponent(href.slice(start + 3));
  } catch {
    json = null;
  }
  if (json === null || json === "") {
    return linkError("the assignment could not be decompressed");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    return linkError("the assignment is not valid JSON");
  }
  if (
    typeof raw !== "object" ||
    raw === null ||
    (raw as { v?: unknown }).v !== LINK_VERSION ||
    typeof (raw as { assignment?: unknown }).assignment !== "object" ||
    (raw as { assignment?: unknown }).assignment === null
  ) {
    return linkError("the assignment has an unsupported link version");
  }
  const assignment = (raw as { assignment: unknown }).assignment;
  // Resolve `builtin` content against the files this build serves and
  // inject the served text — the engine owns every other check.
  const content = (assignment as { content?: unknown }).content;
  if (
    typeof content === "object" &&
    content !== null &&
    typeof (content as { builtin?: unknown }).builtin === "string"
  ) {
    const id = (content as { builtin: string }).builtin;
    const text = await builtinText(id);
    if (text === null) {
      return linkError(
        `the assignment references unknown built-in content '${id}'`,
      );
    }
    (content as { file?: string }).file = text;
  }
  const resolved = JSON.stringify(assignment);
  const r = engine.loadAssignment(resolved);
  return r.ok
    ? { ok: true, value: { assignment: r.value, json: resolved } }
    : r;
}

/**
 * Decode an `#a=` fragment back to the loaded `Assignment`, dropping
 * the resolved file text — the link-resolution half of
 * `resolveAssignmentLink` for callers that only need the
 * validated shape.
 */
export async function decodeAssignmentLink(
  href: string,
): Promise<Result<Assignment>> {
  const r = await resolveAssignmentLink(href);
  return r.ok ? { ok: true, value: r.value.assignment } : r;
}
