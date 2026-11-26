// Student-flow progress persistence (v1.5 plan Task 8, spec
// §5.6/§7.3): progress is keyed
// `neophylo:a:<assignment id>:<normalised id>`. Every access is
// wrapped in try/catch — a blocked or throwing localStorage (third-
// party frames, private windows, quota) never crashes the flow; the
// page shows the "progress won't survive a reload" notice instead
// (conductor note 6).

import type { TaskRecord } from "./flow";

const PREFIX = "neophylo:a:";

/** The record kept under the per-student key. */
export interface StoredProgress {
  v: 1;
  /** The id the student typed — used to rebuild the variant on
   *  resume (the engine re-derives everything from it). */
  studentId: string;
  /** Per-task submission records in assignment order. */
  tasks: TaskRecord[];
  phase: "working" | "finished";
  /** The issued `NP1-…` code once finished — stored so a reopen
   *  shows the SAME code, not a re-encode. */
  code: string | null;
  finishedMin: number | null;
}

export function progressKey(assignmentId: string, normalisedId: string): string {
  return `${PREFIX}${assignmentId}:${normalisedId}`;
}

/** Probe storage with a real write+remove. Any throw means
 *  unavailable — the flow must still work. */
export function storageAvailable(): boolean {
  try {
    const k = `${PREFIX}probe`;
    window.localStorage.setItem(k, "1");
    window.localStorage.removeItem(k);
    return true;
  } catch {
    return false;
  }
}

function isRecord(v: unknown): v is StoredProgress {
  if (typeof v !== "object" || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    o.v === 1 &&
    typeof o.studentId === "string" &&
    Array.isArray(o.tasks) &&
    (o.phase === "working" || o.phase === "finished")
  );
}

/** The stored progress under `key`, or null when storage is
 *  blocked or the record is missing/malformed. */
export function loadProgress(key: string): StoredProgress | null {
  try {
    const raw = window.localStorage.getItem(key);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Write the record; false when storage refused. */
export function saveProgress(key: string, p: StoredProgress): boolean {
  try {
    window.localStorage.setItem(key, JSON.stringify(p));
    return true;
  } catch {
    return false;
  }
}

/** Every stored record for `assignmentId` — used to resume the
 *  single student's session on a reopen. */
export function listProgress(assignmentId: string): StoredProgress[] {
  try {
    const prefix = `${PREFIX}${assignmentId}:`;
    const out: StoredProgress[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const k = window.localStorage.key(i);
      if (k === null || !k.startsWith(prefix)) continue;
      const raw = window.localStorage.getItem(k);
      if (raw === null) continue;
      const parsed: unknown = JSON.parse(raw);
      if (isRecord(parsed)) out.push(parsed);
    }
    return out;
  } catch {
    return [];
  }
}
