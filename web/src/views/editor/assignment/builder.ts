// The assignment builder's model (v1.5 plan Task 7, spec §6, §5.1–5.3
// and §5.7). The builder wraps a piece of content — a shipped lesson
// or lab (`builtin` id + recorded content hash), a reading set, the
// exercise or reading draft the editors are holding, or a pasted
// saved file — in an assignment file the engine validates and the
// `#a=` link carries (Task 6's `encodeAssignmentLink`).
//
// Nothing here recomputes science: content loads through
// `loadExercise`/`loadReadingSet`, task answers come from `taskKey`
// on a `makeVariant` probe, the worst-case code length is
// `maxCodeLen`, and the `prose_names_taxa` list drives the owner's
// variation default (PR #187 fix round, 2026-11-25).

import type { AssignmentFile } from "../../../assess/url";
import { builtinText } from "../../../assess/url";
import { engine } from "../../../engine/index";
import type { Accepted } from "../../../engine/generated/Accepted";
import type { AcceptedAnswer } from "../../../engine/generated/AcceptedAnswer";
import type { Content } from "../../../engine/generated/Content";
import type { Exercise } from "../../../engine/generated/Exercise";
import type { GradedTask } from "../../../engine/generated/GradedTask";
import type { Mode } from "../../../engine/generated/Mode";
import type { NeoError } from "../../../engine/generated/NeoError";
import type { Quantity } from "../../../engine/generated/Quantity";
import type { ReadingSet } from "../../../engine/generated/ReadingSet";
import type { TaskRef } from "../../../engine/generated/TaskRef";
import { listLabs } from "../../../labs/registry";
import { LESSONS } from "../../../lessons/catalog";
import { listReadingSets } from "../../../reading/registry";

import { errorMessage } from "../../../explain/errors";

import { autosave, exerciseDraftState } from "../autosave";
import { leafNames } from "../drawOps";
import {
  buildWireSet,
  storedDraft,
} from "../reading/readingDraft";

/** What the assignment wraps (spec §6's "Which lesson or lab" step). */
export type BuilderContent =
  | { kind: "builtin"; id: string }
  | { kind: "exercise-draft" }
  | { kind: "reading-draft" }
  | { kind: "file"; file: unknown };

/** The builder draft — the `neophylo:draft:assignment` payload. */
export interface BuilderDraft {
  v: 1;
  /** The assignment's own id — variant seeds key off it, so the
   *  builder generates it once and the draft keeps it stable. */
  id: string;
  title: string;
  instructions: string;
  content: BuilderContent | null;
  /** One of `ID_PRESETS`, or "custom" → `customLabel`. */
  idLabel: string;
  customLabel: string;
  mode: Mode;
  /** null = the content's default (the owner's prose-names ruling). */
  variation: boolean | null;
  tasks: GradedTask[];
}

/** The LMS id-prompt presets (spec §6): the labels Canvas, Moodle and
 *  Forms exports actually carry. */
export const ID_PRESETS = [
  "Student number (SIS ID)",
  "ID number",
  "Email address",
] as const;

/** The three fixed ids the side-by-side preview plays. */
export const SAMPLE_IDS = ["student-1", "student-2", "student-3"];

/** The completion code's graded-task and length limits (spec §5.4). */
export const MAX_TASKS = 15;
export const CODE_LEN_LIMIT = 250;

const ID_CHARS = "abcdefghjkmnpqrstvwxyz0123456789";

/** A fresh assignment id — `a-` plus eight unambiguous characters. */
export function newAssignmentId(): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return `a-${[...bytes].map((b) => ID_CHARS[b % ID_CHARS.length]).join("")}`;
}

export function defaultBuilderDraft(): BuilderDraft {
  return {
    v: 1,
    id: newAssignmentId(),
    title: "",
    instructions: "",
    content: null,
    idLabel: ID_PRESETS[0],
    customLabel: "",
    mode: "practice",
    variation: null,
    tasks: [],
  };
}

function isTaskRef(t: unknown): t is TaskRef {
  if (typeof t !== "object" || t === null) return false;
  const o = t as Record<string, unknown>;
  switch (o.kind) {
    case "predict_pair":
      return typeof o.step === "number";
    case "predict_branch":
      return true;
    case "numeric":
      return (
        typeof o.step === "number" &&
        typeof o.quantity === "string" &&
        typeof o.role === "string"
      );
    case "reading":
      return typeof o.item === "number";
    default:
      return false;
  }
}

function isBuilderContent(c: unknown): c is BuilderContent {
  if (typeof c !== "object" || c === null) return false;
  const o = c as Record<string, unknown>;
  switch (o.kind) {
    case "builtin":
      return typeof o.id === "string";
    case "exercise-draft":
    case "reading-draft":
      return true;
    case "file":
      return "file" in o;
    default:
      return false;
  }
}

function isGradedTask(t: unknown): t is GradedTask {
  if (typeof t !== "object" || t === null) return false;
  const o = t as Record<string, unknown>;
  return isTaskRef(o.task) && typeof o.points === "number";
}

/** The stored draft back into shape, or null — a corrupt payload is
 *  ignored, never crashes the builder (spec §9.1's silent restore). */
export function validateBuilderDraft(d: unknown): BuilderDraft | null {
  if (typeof d !== "object" || d === null) return null;
  const o = d as Record<string, unknown>;
  if (
    o.v !== 1 ||
    typeof o.id !== "string" ||
    typeof o.title !== "string" ||
    typeof o.instructions !== "string" ||
    !(o.content === null || isBuilderContent(o.content)) ||
    typeof o.idLabel !== "string" ||
    typeof o.customLabel !== "string" ||
    (o.mode !== "practice" && o.mode !== "test") ||
    !(o.variation === null || typeof o.variation === "boolean") ||
    !Array.isArray(o.tasks) ||
    !o.tasks.every(isGradedTask)
  ) {
    return null;
  }
  return {
    v: 1,
    id: o.id,
    title: o.title,
    instructions: o.instructions,
    content: o.content,
    idLabel: o.idLabel,
    customLabel: o.customLabel,
    mode: o.mode,
    variation: o.variation,
    tasks: o.tasks,
  };
}

/** One optgroup's option in the content select. */
export interface BuiltinOption {
  id: string;
  title: string;
  group: string;
}

/** Shipped content, grouped for the select — the same registries the
 *  library's cards come from. */
export async function listBuiltins(): Promise<BuiltinOption[]> {
  const out: BuiltinOption[] = LESSONS.map((l) => ({
    id: l.id,
    title: l.title,
    group: "Lessons",
  }));
  for (const lab of listLabs()) {
    out.push({
      id: lab.id,
      title: lab.title,
      group: lab.tool === "mega" ? "MEGA labs" : "PHYLIP labs",
    });
  }
  for (const s of await listReadingSets()) {
    out.push({ id: s.id, title: s.title, group: "Tree reading" });
  }
  return out;
}

/** The content resolved far enough to build on: the loaded wire
 *  object (previews, taskKey), the authored `content` block the
 *  `.neophylo-assignment.json` carries, and for a `builtin` the
 *  served bytes the engine probes need injected as `content.file`. */
export interface ResolvedContent {
  content: Content;
  authored: AssignmentFile["content"];
  fileText: string | null;
  /** The content's own title — seeds an empty assignment title. */
  title: string;
  exercise: Exercise | null;
  reading: ReadingSet | null;
}

export type Resolution =
  | { ok: true; value: ResolvedContent }
  | { ok: false; error: string };

function err(error: string): Resolution {
  return { ok: false, error };
}

function resolvedExercise(
  ex: Exercise,
  authored: AssignmentFile["content"],
  fileText: string | null,
): Resolution {
  return {
    ok: true,
    value: {
      content: { kind: "exercise", value: ex },
      authored,
      fileText,
      title: ex.title,
      exercise: ex,
      reading: null,
    },
  };
}

function resolvedReading(
  set: ReadingSet,
  authored: AssignmentFile["content"],
  fileText: string | null,
): Resolution {
  return {
    ok: true,
    value: {
      content: { kind: "reading", value: set },
      authored,
      fileText,
      title: set.title,
      exercise: null,
      reading: set,
    },
  };
}

/** File text → resolved content; `kind:"reading"` decides which
 *  loader runs (the same split `load_assignment`'s builtin path
 *  uses). */
function resolveText(
  text: string,
  authored: AssignmentFile["content"],
): Resolution {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return err("the file is not valid JSON");
  }
  const isReading =
    typeof parsed === "object" &&
    parsed !== null &&
    (parsed as { kind?: unknown }).kind === "reading";
  if (isReading) {
    const r = engine.loadReadingSet(text);
    return r.ok
      ? resolvedReading(r.value, authored, text)
      : err(errorMessage(r.error).body);
  }
  const r = engine.loadExercise(text);
  return r.ok
    ? resolvedExercise(r.value, authored, text)
    : err(errorMessage(r.error).body);
}

/** A pasted/uploaded file object → resolved content (the same rule
 *  as `resolveText`, on the already-parsed object). */
function resolveFile(file: unknown): Resolution {
  const isReading =
    typeof file === "object" &&
    file !== null &&
    (file as { kind?: unknown }).kind === "reading";
  const text = JSON.stringify(file);
  if (isReading) {
    const r = engine.loadReadingSet(text);
    return r.ok
      ? resolvedReading(r.value, { reading: file }, null)
      : err(errorMessage(r.error).body);
  }
  const r = engine.loadExercise(text);
  return r.ok
    ? resolvedExercise(r.value, { exercise: file }, null)
    : err(errorMessage(r.error).body);
}

/**
 * Resolve the draft's content choice to something the engine can
 * probe. `builtin` fetches the served bytes and records
 * `content_hash` (spec §5.7 — the link stays a reference, grading
 * flags a later edit); the editor drafts rebuild through the same
 * round-trip their own restore path uses; a pasted file embeds its
 * object verbatim.
 */
export async function resolveContent(
  c: BuilderContent,
): Promise<Resolution> {
  switch (c.kind) {
    case "builtin": {
      const text = await builtinText(c.id);
      if (text === null) {
        return err(
          `'${c.id}' is not a built-in lesson, lab or reading set.`,
        );
      }
      const hash = engine.contentHash(text);
      if (!hash.ok) return err(errorMessage(hash.error).body);
      return resolveText(text, {
        builtin: c.id,
        content_hash: hash.value,
      });
    }
    case "exercise-draft": {
      const d =
        autosave.load("exercise") ?? autosave.load("matrix");
      const r = exerciseDraftState(d);
      if (r === null) {
        return err(
          "No usable exercise draft — build the exercise under " +
            "“Distance exercise” first (it autosaves as you work).",
        );
      }
      return resolvedExercise(
        r.state.exercise,
        { exercise: r.file },
        null,
      );
    }
    case "reading-draft": {
      const d = storedDraft(autosave.load("reading"));
      if (d === null) {
        return err(
          "No usable reading-set draft — build it under " +
            "“Tree reading set” first (it autosaves as you work).",
        );
      }
      const wire = buildWireSet(d);
      const r = engine.loadReadingSet(JSON.stringify(wire));
      return r.ok
        ? resolvedReading(r.value, { reading: wire }, null)
        : err(errorMessage(r.error).body);
    }
    case "file":
      return resolveFile(c.file);
  }
}

/** The id-prompt label the file carries (spec §6 presets or the
 *  custom text). */
export function idPromptLabel(d: BuilderDraft): string {
  return d.idLabel === "custom"
    ? d.customLabel.trim() || "Student ID"
    : d.idLabel;
}

/** The authored `.neophylo-assignment.json` — what Copy link and
 *  Save file emit. `builtin` content keeps only id + hash here; the
 *  served text is re-resolved by whoever opens it (spec §5.7). */
export function assignmentFile(
  d: BuilderDraft,
  r: ResolvedContent,
  variation: boolean,
): AssignmentFile {
  const instructions = d.instructions.trim();
  return {
    schema_version: 1,
    kind: "assignment",
    id: d.id,
    title: d.title.trim(),
    ...(instructions === "" ? {} : { instructions }),
    content: r.authored,
    id_prompt: { label: idPromptLabel(d), rule: "trim_lower" },
    mode: d.mode,
    variation,
    tasks: d.tasks.map((t) => ({ task: t.task, points: t.points })),
  };
}

/** The file as the engine probes see it — a `builtin` content block
 *  gets its served text injected as `content.file` (the same shape
 *  `decodeAssignmentLink` injects at open time). */
export function probeJson(
  file: AssignmentFile,
  fileText: string | null,
): string {
  const copy = structuredClone(file) as AssignmentFile & {
    content: AssignmentFile["content"] & { file?: string };
  };
  if ("builtin" in copy.content && fileText !== null) {
    copy.content.file = fileText;
  }
  return JSON.stringify(copy);
}

/** The 1-based prompt numbers whose prose names specific taxa —
 *  the owner's variation-warning list (engine `prose_names_taxa`;
 *  reading sets and failures report none). */
export function prosePrompts(exercise: Exercise | null): number[] {
  if (exercise === null) return [];
  const r = engine.proseNamesTaxa(exercise);
  return r.ok ? r.value.map(([i]) => i + 1) : [];
}

/** True for content whose data is fixed — embedded FASTA or a
 *  matrix: variation relabels names but every student gets the same
 *  data (spec §6's notice). */
export function isFixedData(content: Content | null): boolean {
  return (
    content !== null &&
    content.kind === "exercise" &&
    content.value.data.kind !== "simulated"
  );
}

/** Leaf labels in the engine's preorder — the order a simulated
 *  alignment's rows take when no `tip_order` is set. */
function treeLeafLabels(newick: string): string[] {
  const r = engine.parseNewick(newick);
  if (!r.ok) return [];
  const out: string[] = [];
  leafNames(r.value, r.value.root, out);
  return out;
}

/** The labels a piece of content serves, in served order — the
 *  names task answers map onto (simulated: the variant's
 *  `tip_order`; embedded: FASTA order; matrix: `names`). */
export function servedLabels(content: Content): string[] {
  if (content.kind === "reading") return [];
  const d = content.value.data;
  if (d.kind === "matrix") return d.names;
  if (d.kind === "embedded") {
    const a = engine.parseFasta(d.fasta);
    return a.ok ? a.value.labels : [];
  }
  return d.sim.tip_order ?? treeLeafLabels(d.true_tree);
}

/** The join count of an exercise — taxa − 1, the numeric-task
 *  step select's upper bound. */
export function joinCount(exercise: Exercise): number {
  const c: Content = { kind: "exercise", value: exercise };
  return Math.max(0, servedLabels(c).length - 1);
}

/** What makes this student's data theirs — shown on each sample card:
 *  the served taxa order plus, for a simulated exercise, the variant's
 *  own sim seed (the fingerprint that really differs). */
export function dataFingerprint(content: Content): string {
  if (content.kind === "reading") {
    const first = Object.entries(content.value.trees)[0];
    if (first === undefined) return "no trees";
    const labels = treeLeafLabels(first[1].newick);
    return `Tree ${first[0]} tips: ${labels.join(", ")}`;
  }
  const labels = servedLabels(content);
  const d = content.value.data;
  return d.kind === "simulated"
    ? `Order: ${labels.join(", ")} · seed ${d.sim.seed}`
    : `Order: ${labels.join(", ")}`;
}

const QUANTITY_LABEL: Record<Quantity, string> = {
  q_value: "Q-value",
  branch_length: "Branch length",
  new_distance: "New distance",
  corrected_distance: "Corrected distance",
};

function rolePhrase(role: string, step: number): string {
  switch (role) {
    case "closest_raw":
      return `the closest pair at step ${step}`;
    case "chosen_first_to_new":
      return `the first member's branch to the new node at step ${step}`;
    case "chosen_second_to_new":
      return `the second member's branch to the new node at step ${step}`;
    default:
      return `the pair joined at step ${step}`;
  }
}

/** A task's plain-word label (spec §6 — the instructor never edits
 *  JSON; a numeric task reads "Q-value of the pair joined at step
 *  2"). */
export function taskLabel(task: TaskRef, set: ReadingSet | null): string {
  switch (task.kind) {
    case "predict_pair":
      return `Predict the pair joined at step ${task.step}`;
    case "predict_branch":
      return "Predict the least-supported grouping";
    case "numeric":
      return `${QUANTITY_LABEL[task.quantity] ?? task.quantity} of ${rolePhrase(task.role, task.step)}`;
    case "reading": {
      const item = set?.items[task.item];
      const text = item === undefined ? "" : ` — ${item.text}`;
      return `Item ${task.item + 1}${text.length > 80 ? `${text.slice(0, 77)}…` : text}`;
    }
  }
}

/** A reading item's accepted answer as short text — enough for the
 *  instructor to recognise the answer, never a student-facing
 *  rubric. */
function formatReadingAccepted(a: Accepted): string {
  switch (a.kind) {
    case "choices":
      return `options ${a.value.map((i) => i + 1).join(", ")}`;
    case "clade":
    case "tip_set":
    case "any_tip_of":
      return a.value.join(", ");
    case "point":
      return a.value;
    case "orders":
      return `an ordering (${a.value.rule})`;
    case "number":
      return String(a.value);
    case "pairwise":
      return a.value;
    case "statements":
      return a.value.map((b) => (b ? "T" : "F")).join("");
    case "two_tier":
      return `${formatReadingAccepted(a.value.first)} — reason ${a.value.reason + 1}`;
  }
}

/** `taskKey`'s answer as display text: pairs become served tip
 *  names, a number is un-scaled by the precision table's decimals. */
export function formatAccepted(
  a: AcceptedAnswer,
  labels: string[],
  decimals?: number,
): string {
  switch (a.kind) {
    case "pairs":
      return a.value
        .map(
          ([i, j]) =>
            `${labels[i] ?? `#${i + 1}`} + ${labels[j] ?? `#${j + 1}`}`,
        )
        .join(" or ");
    case "branch":
      return `{${a.value.join(", ")}}`;
    case "number":
      return decimals === undefined
        ? String(a.value)
        : (a.value / 10 ** decimals).toFixed(decimals);
    case "reading":
      return formatReadingAccepted(a.value);
  }
}

/** The engine's display-precision table as a map (number answers
 *  scale by `PRECISION[quantity]` — the web formats to match). */
export function precisionMap(): Map<Quantity, number> {
  const r = engine.precision();
  return r.ok ? new Map(r.value) : new Map();
}

/** The decimals a numeric task's answer displays at. */
export function taskDecimals(
  task: TaskRef,
  table: Map<Quantity, number>,
): number | undefined {
  return task.kind === "numeric" ? table.get(task.quantity) : undefined;
}

/** The reasons Copy link / Save file refuse — each rendered so the
 *  instructor sees the spec's exact refusal wording (spec §6). */
export function refusals(input: {
  title: string;
  tasks: GradedTask[];
  loadError: NeoError | null;
  codeLen: number | null;
  hasContent: boolean;
}): string[] {
  const out: string[] = [];
  if (!input.hasContent) {
    out.push("Pick the assignment's content first.");
  }
  if (input.title.trim() === "") {
    out.push("The assignment needs a title.");
  }
  if (input.tasks.length === 0) {
    out.push("Add at least one graded task.");
  }
  if (input.tasks.length > MAX_TASKS) {
    out.push(
      `The completion code carries at most ${MAX_TASKS} graded tasks — this assignment has ${input.tasks.length}.`,
    );
  }
  if (input.codeLen !== null && input.codeLen > CODE_LEN_LIMIT) {
    out.push(
      `The longest completion code would be ${input.codeLen} characters — the limit is ${CODE_LEN_LIMIT}. Remove graded tasks.`,
    );
  }
  if (input.loadError !== null) {
    out.push(errorMessage(input.loadError).body);
  }
  return out;
}

/** Whether two task references are the same task (dedupe — a prompt
 *  checkbox and its task row are one task). */
export function sameTask(a: TaskRef, b: TaskRef): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** The stored draft `?editor&assign` honours: the `assign` param
 *  seeds content on top of whatever the autosave restored — a card's
 *  "Make an assignment" always lands on that card's content, other
 *  draft fields keep their values. */
export function draftForParam(
  initialBuiltin: string | undefined,
): BuilderDraft {
  const stored = validateBuilderDraft(autosave.load("assignment"));
  const d = stored ?? defaultBuilderDraft();
  if (initialBuiltin !== undefined && initialBuiltin !== "") {
    return { ...d, content: { kind: "builtin", id: initialBuiltin } };
  }
  return d;
}

/** The content-select value ↔ `BuilderContent` encoding. */
export function contentSelectValue(c: BuilderContent | null): string {
  if (c === null) return "";
  return c.kind === "builtin" ? `builtin:${c.id}` : c.kind;
}

export function contentFromSelectValue(
  v: string,
  file: unknown,
): BuilderContent | null {
  if (v === "") return null;
  if (v === "file") return { kind: "file", file };
  if (v.startsWith("builtin:")) {
    return { kind: "builtin", id: v.slice("builtin:".length) };
  }
  return { kind: v as "exercise-draft" | "reading-draft" };
}
