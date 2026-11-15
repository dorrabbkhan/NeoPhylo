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

import { engine } from "../engine/index";
import type { Alignment } from "../engine/generated/Alignment";
import type { DistanceInput } from "../engine/generated/DistanceInput";
import type { Exercise } from "../engine/generated/Exercise";
import type { SimSpec } from "../engine/generated/SimSpec";

import type { BootstrapView } from "./session";

export interface UrlState {
  /** Schema version; the current version is 3 (v1.2 spec §6.1: adds
   * `bootstrap`; v0–v2 payloads are converted by `migrate`). Only
   * `#x=` fragment payloads carry `v`; `?lesson=` query links are
   * version-free and always decode as v3. */
  v: 3;
  /** Built-in lesson id, when the exercise came from exercises/. */
  lesson?: string;
  /** A full custom exercise, when one was imported. */
  x?: Exercise;
  step: number;
  mode: "concept" | "math";
  /** Present when the session is in sandbox mode. */
  src?: "sandbox";
  overrides?: {
    sim?: Partial<SimSpec>;
    analysis?: Partial<Exercise["analysis"]>;
    branchScale?: number;
  };
  /** Sandbox data pasted/uploaded by the student — not reproducible from
   * `overrides`, so it is carried verbatim. `trueTree` is Newick text
   * (not the parsed `Tree`) so it compresses like any other string.
   * `matrix` is a supplied distance matrix (v1.4c spec §4.3) — mutually
   * exclusive with `alignment` and `dataset` (both together are a
   * restore error). */
  imported?: {
    alignment?: Alignment;
    trueTree?: string;
    matrix?: DistanceInput;
  };
  /** A library dataset id, written `ds=<id>` (v1.4b Task 11): the
   * sandbox shows the unmodified library file, so the link names it
   * instead of embedding the data. Mutually exclusive with `d=` —
   * both together are a restore error. */
  dataset?: string;
  /** Bootstrap settings (v1.2 spec §6.1, URL v3). `ran` records that a
   * run was requested so reopening the link can auto-start it —
   * results themselves are never stored in links. */
  bootstrap?: {
    replicates: number;
    seed: number;
    view: BootstrapView;
    ran: boolean;
  };
}

type DecodeResult =
  | { ok: true; state: UrlState }
  | { ok: false; reason: string };

const DEFAULT_STATE: UrlState = { v: 3, step: 0, mode: "concept" };

/** Link length above which sharing is unreliable (v1.4c spec §4.3): a
 * 200-taxon matrix link crosses it. The notice is advisory only — the
 * link still works. */
export const LONG_LINK_CHARS = 8000;

/** The advisory sentence for an over-long link, or null when the link
 * fits (conductor's call, v1.4c Task 7 notes — Task 8 shows it in the
 * share UI). */
export function longLinkNotice(link: string): string | null {
  return link.length > LONG_LINK_CHARS
    ? "This link is very long; some apps may cut it. Export the matrix file instead."
    : null;
}

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
  if (s.imported !== undefined) {
    p.set("d", compressToEncodedURIComponent(JSON.stringify(s.imported)));
  }
  if (s.dataset !== undefined) {
    p.set("ds", s.dataset);
  }
  if (s.bootstrap !== undefined) {
    p.set("b", compressToEncodedURIComponent(JSON.stringify(s.bootstrap)));
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
    // Same refusal as the `o=` path: a malformed site_filter or κ in
    // the overrides is a restore error, never a dropped field.
    if (
      isRecord(raw) &&
      isRecord(raw.overrides) &&
      invalidAnalysisOverride(raw.overrides.analysis) !== null
    ) {
      return {
        ok: false,
        reason: invalidAnalysisOverride(raw.overrides.analysis)!,
      };
    }
    // v1.4c: matrix-link rules — a matrix never rides beside an
    // alignment, and a matrix link carries no sim/model/gap override.
    if (isRecord(raw)) {
      const bad = matrixLinkError(raw);
      if (bad !== null) return { ok: false, reason: bad };
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
    const bad = invalidAnalysisOverride(raw.analysis);
    if (bad !== null) return { ok: false, reason: bad };
    state.overrides = raw as UrlState["overrides"];
  }

  const dParam = params.get("d");
  if (dParam !== null) {
    const json = decompressFromEncodedURIComponent(dParam);
    if (json === null || json === "") {
      return { ok: false, reason: "the imported data could not be decompressed" };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return { ok: false, reason: "the imported data is not valid JSON" };
    }
    if (!isRecord(raw)) {
      return { ok: false, reason: "the imported data is not an object" };
    }
    const bad = invalidImported(raw);
    if (bad !== null) return { ok: false, reason: bad };
    state.imported = normalizeImported(raw);
  }

  const dsParam = params.get("ds");
  if (dsParam !== null) {
    if (dsParam === "") {
      return { ok: false, reason: "empty library dataset id" };
    }
    if (state.imported !== undefined) {
      return {
        ok: false,
        reason:
          "a link cannot carry both a library dataset (ds=) and imported data (d=)",
      };
    }
    state.dataset = dsParam;
  }

  // v1.4c spec §4.1: a matrix link's overrides may hold only
  // `analysis.method` — every other field is refused at restore,
  // mirroring the exercise loader.
  if (state.imported?.matrix !== undefined) {
    const field = matrixOverrideField(state.overrides);
    if (field !== null) {
      return {
        ok: false,
        reason: `a distance-matrix link cannot carry a ${field} override`,
      };
    }
  }

  const bParam = params.get("b");
  if (bParam !== null) {
    const json = decompressFromEncodedURIComponent(bParam);
    if (json === null || json === "") {
      return { ok: false, reason: "the bootstrap settings could not be decompressed" };
    }
    let raw: unknown;
    try {
      raw = JSON.parse(json);
    } catch {
      return { ok: false, reason: "the bootstrap settings are not valid JSON" };
    }
    if (!validBootstrap(raw)) {
      return { ok: false, reason: "the bootstrap settings are malformed" };
    }
    state.bootstrap = raw;
  }

  return { ok: true, state };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === "object" && x !== null && !Array.isArray(x);
}

/** A `DistanceInput`'s wire shape: `names` strings and `lower` finite
 * numbers. Structural validity (length, uniqueness, ≥ 0) is the
 * engine's job — a bad matrix the shape check misses fails at
 * `importMatrix`, never at decode. */
function validDistanceInput(x: unknown): x is DistanceInput {
  return (
    isRecord(x) &&
    Array.isArray(x.names) &&
    x.names.every((n) => typeof n === "string") &&
    Array.isArray(x.lower) &&
    x.lower.every((v) => typeof v === "number" && Number.isFinite(v))
  );
}

/** The `imported` payload's matrix rules (v1.4c spec §4.3): a matrix
 * and an alignment never ride together — mutually exclusive, like
 * `d=`+`ds=` — and a matrix must hold the `DistanceInput` wire shape.
 * Returns the refusal's reason, or null when the payload is fine. */
function invalidImported(raw: Record<string, unknown>): string | null {
  if (raw.matrix === undefined) return null;
  if (raw.alignment !== undefined) {
    return "a link cannot carry both an imported alignment and a distance matrix";
  }
  if (!validDistanceInput(raw.matrix)) {
    return "the imported distance matrix is malformed";
  }
  return null;
}

/** The override field a matrix link refuses — the name, or null when
 * nothing is forbidden. Mirrors the exercise loader's rule for matrix
 * data (v1.4c spec §4.1): the matrix supplies distances, so `sim`,
 * `analysis.correction`, `analysis.kappa` and `analysis.site_filter`
 * can never apply. */
export function matrixOverrideField(
  o: UrlState["overrides"] | undefined,
): string | null {
  if (o === undefined || !isRecord(o)) return null;
  if (o.sim !== undefined) return "sim";
  const a = o.analysis;
  if (a === undefined || !isRecord(a)) return null;
  if (a.correction !== undefined) return "correction";
  if (a.kappa !== undefined) return "kappa";
  if (a.site_filter !== undefined) return "site_filter";
  return null;
}

/** The reason a decoded payload is refused, or null. Covers the
 * `imported` matrix rules for every payload and the forbidden-override
 * rule when the payload is "a matrix link": `imported.matrix` present
 * or the `#x=` exercise is `data.kind` `"matrix"`. */
function matrixLinkError(raw: Record<string, unknown>): string | null {
  if (isRecord(raw.imported)) {
    const bad = invalidImported(raw.imported);
    if (bad !== null) return bad;
  }
  const matrixLink =
    (isRecord(raw.imported) && raw.imported.matrix !== undefined) ||
    (isRecord(raw.x) &&
      isRecord(raw.x.data) &&
      raw.x.data.kind === "matrix");
  if (!matrixLink) return null;
  const field = matrixOverrideField(
    raw.overrides as UrlState["overrides"],
  );
  return field === null
    ? null
    : `a distance-matrix link cannot carry a ${field} override`;
}

/** The wire shape of `analysis.site_filter` (v1.4b spec §4):
 * `{ "kind": "pairwise" | "complete" | "partial", "cutoff_pct": <integer
 * 0–100> }`, with `cutoff_pct` present only for partial. Anything else —
 * a null, a string, an array, an unknown kind, an out-of-range,
 * non-integer or absent cutoff — is refused rather than dropped. */
function invalidSiteFilter(x: unknown): string | null {
  if (!isRecord(x)) return "the overrides' site filter is not an object";
  const kind = x.kind;
  const cutoff = x.cutoff_pct;
  if (kind === "pairwise" || kind === "complete") {
    return cutoff === undefined
      ? null
      : "the overrides' site filter has a cutoff only partial deletion uses";
  }
  if (kind === "partial") {
    return typeof cutoff === "number" &&
      Number.isInteger(cutoff) &&
      cutoff >= 0 &&
      cutoff <= 100
      ? null
      : "the overrides' partial-deletion cutoff is not a whole number from 0 to 100";
  }
  return "the overrides' site filter has an unknown kind";
}

/** `overrides.analysis` fields that must be right or refused (v1.4b):
 * an invalid `site_filter` or κ makes the whole overrides block a
 * restore error with a reason, like the `d=` failures — never a
 * silently dropped field. Returns the reason, or null when valid. */
function invalidAnalysisOverride(a: unknown): string | null {
  if (a === undefined) return null;
  if (!isRecord(a)) return "the overrides' analysis is not an object";
  if (a.site_filter !== undefined) {
    const bad = invalidSiteFilter(a.site_filter);
    if (bad !== null) return bad;
  }
  if (
    a.kappa !== undefined &&
    (typeof a.kappa !== "number" || !Number.isFinite(a.kappa) || a.kappa <= 0)
  ) {
    return "the overrides' κ is not a positive number";
  }
  return null;
}

function validStep(x: unknown): x is number {
  return typeof x === "number" && Number.isInteger(x) && x >= 0;
}

/** v1 `imported` payloads carried alignments without the `alphabet`
 * field (Task 3 added it with serde default `dna`). Fill that default
 * so downstream code sees a complete `Alignment`; everything else is
 * left untouched. */
function normalizeImported(raw: Record<string, unknown>): UrlState["imported"] {
  const alignment = raw.alignment;
  if (isRecord(alignment) && alignment.alphabet === undefined) {
    return {
      ...(raw as unknown as UrlState["imported"]),
      alignment: { ...alignment, alphabet: "dna" } as unknown as Alignment,
    };
  }
  return raw as unknown as UrlState["imported"];
}

/** The URL v3 `bootstrap` block: exactly the four settings fields
 * (v1.2 spec §6.1). A malformed field rejects the payload, matching
 * the `src`/`overrides` rule — never a silently dropped setting. */
function validBootstrap(x: unknown): x is NonNullable<UrlState["bootstrap"]> {
  return (
    isRecord(x) &&
    typeof x.replicates === "number" &&
    Number.isFinite(x.replicates) &&
    typeof x.seed === "number" &&
    Number.isFinite(x.seed) &&
    (x.view === "support" ||
      x.view === "majority" ||
      x.view === "extended" ||
      x.view === "strict") &&
    typeof x.ran === "boolean"
  );
}

/**
 * Convert a raw parsed payload into a current UrlState. v1 and v2
 * payloads are validated field by field; the v0 format carried only
 * step and mode, which are lifted out while everything else is dropped.
 * Any other or missing version returns null (spec §6.4: invalid state
 * loads the default lesson).
 *
 * v1 → v2 (v1.1 spec §3.6): a custom `x` exercise in the v1 file shape
 * (flat `true_tree`/`sim`) is normalized through `engine.loadExercise`,
 * and imported alignments gain the `alphabet` default.
 */
export function migrate(raw: unknown): UrlState | null {
  if (!isRecord(raw)) return null;
  if (raw.v === 0) {
    return {
      v: 3,
      step: validStep(raw.step) ? raw.step : 0,
      mode: raw.mode === "math" ? "math" : "concept",
    };
  }
  if (raw.v !== 1 && raw.v !== 2 && raw.v !== 3) return null;
  if (!validStep(raw.step)) return null;
  if (raw.mode !== "concept" && raw.mode !== "math") return null;
  if (raw.lesson !== undefined && typeof raw.lesson !== "string") return null;
  if (raw.x !== undefined && !isRecord(raw.x)) return null;
  if (raw.src !== undefined && raw.src !== "sandbox") return null;
  if (raw.overrides !== undefined && !isRecord(raw.overrides)) return null;
  if (
    raw.overrides !== undefined &&
    invalidAnalysisOverride(raw.overrides.analysis) !== null
  ) {
    return null;
  }
  if (raw.imported !== undefined && !isRecord(raw.imported)) return null;
  // v1.4c matrix-link rules (see `matrixLinkError`): `raw.overrides`
  // is known to be a record or absent here.
  if (matrixLinkError(raw) !== null) return null;
  // `bootstrap` exists only at v3; v1/v2 payloads migrate to defaults
  // (no block = replicates 100, seed 1, view "support", ran false).
  if (raw.bootstrap !== undefined && !validBootstrap(raw.bootstrap)) {
    return null;
  }

  const state: UrlState = { v: 3, step: raw.step, mode: raw.mode };
  if (raw.lesson !== undefined) state.lesson = raw.lesson;
  if (raw.x !== undefined) {
    if (raw.v === 1) {
      const migrated = engine.loadExercise(JSON.stringify(raw.x));
      if (!migrated.ok) return null;
      state.x = migrated.value;
    } else {
      // v2 exercises are trusted objects — never re-parsed (the wire
      // shape is the engine's serde shape, not the file shape).
      state.x = raw.x as Exercise;
    }
  }
  if (raw.src !== undefined) state.src = raw.src;
  if (raw.overrides !== undefined) {
    state.overrides = raw.overrides as UrlState["overrides"];
  }
  if (raw.imported !== undefined) {
    state.imported = normalizeImported(raw.imported);
  }
  if (raw.v === 3 && raw.bootstrap !== undefined) {
    state.bootstrap = raw.bootstrap;
  }
  return state;
}
