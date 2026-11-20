// Loading shared by the worksheet and key pages (v1.4c plan Task 11):
// `?worksheet=<id>` / `?key=<id>` resolve a lesson id (fetched like
// the app resolves `?lesson=`), a lab id (the bundled registry), a
// reading-set id (v1.4d Task 13 — the shipped registry, like `?read=`)
// or `custom` with the exercise in the `#x=` fragment or the reading
// set in an `#r=` fragment — the same payload shapes the share links
// write.

import type { Exercise } from "../../engine/generated/Exercise";
import type { ReadingSet } from "../../engine/generated/ReadingSet";
import { loadLab } from "../../labs/registry";
import type { LabExercise } from "../../labs/registry";
import { loadLesson } from "../../lessons/loader";
import { readErrorMessage } from "../../reading/errors";
import { loadBuiltinReadingSet } from "../../reading/registry";
import { decodeReadingLink } from "../../reading/url";
import { decode, encode } from "../../state/url";

export type WorksheetSource =
  | { kind: "lesson"; exercise: Exercise }
  | { kind: "lab"; lab: LabExercise }
  | { kind: "custom"; exercise: Exercise }
  | { kind: "reading"; set: ReadingSet; builtin: boolean };

export type LoadResult =
  | { ok: true; src: WorksheetSource }
  | { ok: false; msg: string };

export async function loadWorksheetSource(id: string): Promise<LoadResult> {
  if (id === "custom") {
    const href = window.location.href;
    // An `#r=` fragment carries a reading set (Task 13) — decode it
    // before the `#x=` exercise path sees the link.
    if (href.includes("#r=")) {
      const r = decodeReadingLink(href);
      return r.ok
        ? { ok: true, src: { kind: "reading", set: r.value, builtin: false } }
        : { ok: false, msg: readErrorMessage(r.error) };
    }
    const d = decode(href);
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
  // The reading registry is a sync map lookup — probing it before the
  // lesson fetch keeps `?worksheet=trees-…` from 404-ing the exercises
  // URL on every sheet and key load. No reading id is also a lesson
  // id, so the order never shadows one.
  const reading = await loadBuiltinReadingSet(id);
  if (reading.ok) {
    return {
      ok: true,
      src: { kind: "reading", set: reading.value, builtin: true },
    };
  }
  const lesson = await loadLesson(id);
  if (lesson.ok) {
    return { ok: true, src: { kind: "lesson", exercise: lesson.value } };
  }
  return { ok: false, msg: `no lesson, lab or reading set named "${id}"` };
}

/** The link that opens the exact exercise: the normal `?lesson=` or
 * `?lab=` route for built-ins, the `#x=` payload for a custom one —
 * the same forms the menus and the lab page already emit. Resolved
 * against the app root, never the current page: an `#x=` fragment
 * resolved against a `?worksheet=…`/`?key=…` URL would keep the
 * worksheet route and reopen the sheet instead of the exercise
 * (fix round 1, review 1). */
export function exerciseLink(src: WorksheetSource, id: string): string {
  let rel: string;
  if (src.kind === "lesson") rel = `?lesson=${encodeURIComponent(id)}`;
  else if (src.kind === "lab") rel = `?lab=${encodeURIComponent(id)}`;
  else if (src.kind === "reading") {
    // A built-in set opens at `?read=`; a shared one keeps its `#r=`
    // payload (Task 13) — the worksheet/key hrefs re-append it below.
    rel = src.builtin
      ? `?read=${encodeURIComponent(id)}`
      : window.location.hash;
  } else {
    rel = encode({ v: 3, x: src.exercise, step: 0, mode: "concept" });
  }
  const appRoot = new URL(import.meta.env.BASE_URL, window.location.origin);
  return new URL(rel, appRoot).href;
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
