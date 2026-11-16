// Loading shared by the worksheet and key pages (v1.4c plan Task 11):
// `?worksheet=<id>` / `?key=<id>` resolve a lesson id (fetched like
// the app resolves `?lesson=`), a lab id (the bundled registry) or
// `custom` with the exercise in the `#x=` fragment — the same payload
// shape the editor's share link writes.

import type { Exercise } from "../../engine/generated/Exercise";
import { loadLab } from "../../labs/registry";
import type { LabExercise } from "../../labs/registry";
import { loadLesson } from "../../lessons/loader";
import { decode, encode } from "../../state/url";

export type WorksheetSource =
  | { kind: "lesson"; exercise: Exercise }
  | { kind: "lab"; lab: LabExercise }
  | { kind: "custom"; exercise: Exercise };

export type LoadResult =
  | { ok: true; src: WorksheetSource }
  | { ok: false; msg: string };

export async function loadWorksheetSource(id: string): Promise<LoadResult> {
  if (id === "custom") {
    const d = decode(window.location.href);
    if (!d.ok) {
      return { ok: false, msg: `the exercise link is broken — ${d.reason}` };
    }
    if (d.state.x === undefined) {
      return {
        ok: false,
        msg: "a custom worksheet needs the exercise's #x= link",
      };
    }
    return { ok: true, src: { kind: "custom", exercise: d.state.x } };
  }
  const lab = loadLab(id);
  if (lab.ok) return { ok: true, src: { kind: "lab", lab: lab.value } };
  const lesson = await loadLesson(id);
  if (lesson.ok) {
    return { ok: true, src: { kind: "lesson", exercise: lesson.value } };
  }
  return { ok: false, msg: `no lesson or lab named "${id}"` };
}

/** The link that opens the exact exercise: the normal `?lesson=` or
 * `?lab=` route for built-ins, the `#x=` payload for a custom one —
 * the same forms the menus and the lab page already emit. */
export function exerciseLink(src: WorksheetSource, id: string): string {
  let rel: string;
  if (src.kind === "lesson") rel = `?lesson=${encodeURIComponent(id)}`;
  else if (src.kind === "lab") rel = `?lab=${encodeURIComponent(id)}`;
  else rel = encode({ v: 3, x: src.exercise, step: 0, mode: "concept" });
  return new URL(rel, window.location.href).href;
}

/** True when the source is a lab — the discriminant shared by every
 * kind switch. */
export function labOf(
  src: WorksheetSource,
): LabExercise | null {
  return src.kind === "lab" ? src.lab : null;
}

/** The Exercise of any source. */
export function exerciseOfSrc(src: WorksheetSource): Exercise {
  return src.kind === "lab" ? src.lab.exercise : src.exercise;
}

/** The matching `?worksheet=` href for an id (a custom exercise keeps
 * its `#x=` fragment). Shared by the worksheet routes' links and the
 * key page's gate escape. */
export function worksheetHref(id: string, kind: string): string {
  const hash = id === "custom" ? window.location.hash : "";
  return `?worksheet=${encodeURIComponent(id)}&kind=${kind}${hash}`;
}

/** The matching `?key=` href (a custom exercise keeps `#x=`). */
export function keyHref(id: string, kind: string): string {
  const hash = id === "custom" ? window.location.hash : "";
  return `?key=${encodeURIComponent(id)}&kind=${kind}${hash}`;
}
