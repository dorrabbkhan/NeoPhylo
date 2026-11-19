// Reading-set registry (v1.4d plan Task 8). Shipped sets live in
// exercises/reading/ — each file is a lazy `?raw` glob import so the
// JSON stays out of every chunk until the route asks for it
// (the initial-JS budget does not move). Coverage sets (plan Task 12)
// land in exercises/reading/coverage/ and load by id the same way.
//
// `trees-demo` is a real shipped set — the dev/e2e showcase — but it
// is never listed: `?read=trees-demo` resolves it, `listReadingSets`
// skips it (owner decision, Task 8 notes).

import { engine, type Result } from "../engine/index";
import type { ExerciseMeta } from "../engine/generated/ExerciseMeta";
import type { NeoError } from "../engine/generated/NeoError";
import type { ReadingSet } from "../engine/generated/ReadingSet";

const SHIPPED = import.meta.glob<string>(
  "../../../exercises/reading/*.json",
  { query: "?raw", import: "default" },
);
const COVERAGE = import.meta.glob<string>(
  "../../../exercises/reading/coverage/*.json",
  { query: "?raw", import: "default" },
);

/** The set id a `?read=` param names — the file's basename. */
function fileId(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
}

/** The demo set ships in exercises/reading/ but is dev-only content. */
const DEMO_ID = "trees-demo";

export interface ReadingSetSummary {
  id: string;
  title: string;
  summary: string;
  meta?: ExerciseMeta;
}

/**
 * Summaries for the shipped sets the library lists (Task 9 shows the
 * cards). Each file is validated through `loadReadingSet` — a set the
 * engine refuses could never start, so it is skipped rather than
 * listed.
 */
export async function listReadingSets(): Promise<ReadingSetSummary[]> {
  const out: ReadingSetSummary[] = [];
  for (const [path, load] of Object.entries(SHIPPED)) {
    const id = fileId(path);
    if (id === DEMO_ID) continue;
    const r = engine.loadReadingSet(await load());
    if (!r.ok) continue;
    out.push({
      id,
      title: r.value.title,
      summary: r.value.summary,
      meta: r.value.meta,
    });
  }
  out.sort((a, b) => a.id.localeCompare(b.id));
  return out;
}

/**
 * Load a shipped set by id — `?read=<id>` resolves here. Unknown ids
 * refuse with the engine's error kind; malformed files report the
 * engine's own InvalidReading message.
 */
export async function loadBuiltinReadingSet(
  id: string,
): Promise<Result<ReadingSet>> {
  const load =
    SHIPPED[`../../../exercises/reading/${id}.json`] ??
    COVERAGE[`../../../exercises/reading/coverage/${id}.json`];
  if (load === undefined) {
    const error: NeoError = {
      kind: "InvalidReading",
      item: "",
      field: "read",
      msg: `unknown reading set "${id}"`,
    };
    return { ok: false, error };
  }
  return engine.loadReadingSet(await load());
}
