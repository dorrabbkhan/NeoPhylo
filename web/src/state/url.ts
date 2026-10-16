// Shareable URL state (plan Task 22, spec §6.4). A built-in exercise
// lives in the query string — `?lesson=<id>&s=<step>&m=<mode>&o=<lz>`
// — while a custom (imported) exercise is the whole UrlState as
// lz-compressed JSON in the `#x=` fragment, so it is never sent to a
// server. `migrate` converts older payloads; anything unrecognized
// returns null and the caller falls back to the default lesson with a
// toast.

import {
  compressToEncodedURIComponent,
  decompressFromEncodedURIComponent,
} from "lz-string";

import type { Exercise } from "../engine/generated/Exercise";

export interface UrlState {
  /** Schema version; the only current version is 1 (spec §6.4). */
  v: 1;
  /** Built-in lesson id, when the exercise came from exercises/. */
  lesson?: string;
  /** A full custom exercise, when one was imported. */
  x?: Exercise;
  step: number;
  mode: "concept" | "math";
  /** Present when the session is in sandbox mode. */
  src?: "sandbox";
  overrides?: {
    sim?: Partial<Exercise["sim"]>;
    analysis?: Partial<Exercise["analysis"]>;
    branchScale?: number;
  };
}

type DecodeResult =
  | { ok: true; state: UrlState }
  | { ok: false; reason: string };

const DEFAULT_STATE: UrlState = { v: 1, step: 0, mode: "concept" };

/**
 * Serialize `s` for `history.replaceState`. The returned string is a
 * relative URL: `?lesson=…` for a built-in exercise or `#x=…` when the
 * state carries a custom one (a custom exercise wins over `lesson`).
 */
export function encode(s: UrlState): string {
  if (s.x !== undefined) {
    return "#x=" + compressToEncodedURIComponent(JSON.stringify(s));
  }
  const p = new URLSearchParams();
  if (s.lesson !== undefined) p.set("lesson", s.lesson);
  p.set("s", String(s.step));
  p.set("m", s.mode);
  if (s.src === "sandbox") p.set("sb", "1");
  if (s.overrides !== undefined) {
    p.set("o", compressToEncodedURIComponent(JSON.stringify(s.overrides)));
  }
  return "?" + p.toString();
}

/**
 * Parse an href (full URL or relative path) back into a UrlState.
 * A bare URL yields the default state; a recognizable-but-broken link
 * (`#x=` garbage, malformed `s`/`m`/`o`, unknown schema version) fails
 * with a human-readable reason.
 */
export function decode(href: string): DecodeResult {
  // Fragment first: an `#x=` payload carries the complete state.
  const xStart = href.indexOf("#x=");
  if (xStart >= 0) {
    const payload = href.slice(xStart + 3);
    const json = decompressFromEncodedURIComponent(payload);
    if (json === null || json === "") {
      return { ok: false, reason: "the shared state could not be decompressed" };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return { ok: false, reason: "the shared state is not valid JSON" };
    }
    const state = migrate(raw);
    if (state === null) {
      return { ok: false, reason: "the shared state has an unsupported version" };
    }
    return { ok: true, state };
  }

  // Query string: built-in lesson plus step/mode/overrides params.
  const qStart = href.indexOf("?");
  if (qStart < 0) return { ok: true, state: DEFAULT_STATE };
  const qEnd = href.indexOf("#", qStart);
  const params = new URLSearchParams(
    href.slice(qStart + 1, qEnd < 0 ? undefined : qEnd),
  );

  const state: UrlState = { ...DEFAULT_STATE };

  const lesson = params.get("lesson");
  if (lesson !== null) {
    if (lesson === "") return { ok: false, reason: "empty lesson id" };
    state.lesson = lesson;
  }

  const sParam = params.get("s");
  if (sParam !== null) {
    const step = Number(sParam);
    if (!Number.isInteger(step) || step < 0) {
      return { ok: false, reason: `invalid step "${sParam}"` };
    }
    state.step = step;
  }

  const mParam = params.get("m");
  if (mParam !== null) {
    if (mParam !== "concept" && mParam !== "math") {
      return { ok: false, reason: `invalid mode "${mParam}"` };
    }
    state.mode = mParam;
  }

  if (params.get("sb") === "1") state.src = "sandbox";

  const oParam = params.get("o");
  if (oParam !== null) {
    const json = decompressFromEncodedURIComponent(oParam);
    if (json === null || json === "") {
      return { ok: false, reason: "the overrides could not be decompressed" };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return { ok: false, reason: "the overrides are not valid JSON" };
    }
    if (!isRecord(raw)) {
      return { ok: false, reason: "the overrides are not an object" };
    }
    state.overrides = raw as UrlState["overrides"];
  }

  return { ok: true, state };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

function validStep(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0;
}

/**
 * Convert a raw parsed payload into a current UrlState. v1 payloads are
 * validated field by field; the v0 format carried only step and mode,
 * which are lifted out while everything else is dropped. Any other or
 * missing version returns null (spec §6.4: invalid state loads the
 * default lesson).
 */
export function migrate(raw: unknown): UrlState | null {
  if (!isRecord(raw)) return null;
  if (raw.v === 0) {
    return {
      v: 1,
      step: validStep(raw.step) ? raw.step : 0,
      mode: raw.mode === "math" ? "math" : "concept",
    };
  }
  if (raw.v !== 1) return null;
  if (!validStep(raw.step)) return null;
  if (raw.mode !== "concept" && raw.mode !== "math") return null;
  if (raw.lesson !== undefined && typeof raw.lesson !== "string") return null;
  if (raw.x !== undefined && !isRecord(raw.x)) return null;
  if (raw.src !== undefined && raw.src !== "sandbox") return null;
  if (raw.overrides !== undefined && !isRecord(raw.overrides)) return null;

  const state: UrlState = { v: 1, step: raw.step, mode: raw.mode };
  if (raw.lesson !== undefined) state.lesson = raw.lesson;
  if (raw.x !== undefined) state.x = raw.x as Exercise;
  if (raw.src !== undefined) state.src = raw.src;
  if (raw.overrides !== undefined) {
    state.overrides = raw.overrides as UrlState["overrides"];
  }
  return state;
}
