// Lesson loader (plan Task 21, spec §7): lesson files live in the
// repo's exercises/ directory and are served (dev) and copied (build) as
// `/exercises/<id>.json` by the exercises plugin in vite.config.ts. The
// fetched text goes through engine.loadExercise, so a lesson is
// validated exactly like a sandbox exercise file — errors stay values.

import { engine } from "../engine";
import type { Result } from "../engine";
import type { Exercise } from "../engine/generated/Exercise";

/**
 * Fetch and validate the lesson `id`. Network and HTTP failures come
 * back as InvalidExercise on the "id" field; an unparsable or invalid
 * file passes through engine.loadExercise's own error.
 */
export async function loadLesson(id: string): Promise<Result<Exercise>> {
  let res: Response;
  try {
    res = await fetch(`/exercises/${encodeURIComponent(id)}.json`);
  } catch (e) {
    return {
      ok: false,
      error: {
        kind: "InvalidExercise",
        field: "id",
        msg: `could not fetch lesson "${id}" (${e instanceof Error ? e.message : String(e)})`,
      },
    };
  }
  if (!res.ok) {
    return {
      ok: false,
      error: {
        kind: "InvalidExercise",
        field: "id",
        msg: `lesson "${id}" not found (HTTP ${res.status})`,
      },
    };
  }
  return engine.loadExercise(await res.text());
}
