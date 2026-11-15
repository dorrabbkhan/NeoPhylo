// Matrix sessions and links (v1.4c plan Task 7, spec §4.1, §4.3,
// §6.2). A supplied distance matrix is a third analysis origin: the
// session holds `matrixInput` and no alignment, and `hasAlignment` is
// the single check every alignment-only panel uses. Matrix data
// travels in the `d=` payload's `imported.matrix` (or inside a `#x=`
// matrix exercise); a matrix link's overrides carry only
// `analysis.method`.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { compressToEncodedURIComponent } from "lz-string";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { engine } from "../engine/index";
import type { Alignment } from "../engine/generated/Alignment";
import type { DistanceInput } from "../engine/generated/DistanceInput";
import type { Exercise } from "../engine/generated/Exercise";

import {
  hasAlignment,
  initialSession,
  matrixIsImported,
  reducer,
} from "./session";
import type { Session } from "./session";
import {
  decode,
  encode,
  LONG_LINK_CHARS,
  longLinkNotice,
  migrate,
  type UrlState,
} from "./url";
import { applyUrlState, resolveInitial, sessionUrlState } from "./urlRestore";

// The spec §7 example exercise's shape, as a schema-2 simulated lesson.
const LESSON_JSON = `{
  "schema_version": 2,
  "id": "sim-lesson",
  "title": "Simulated lesson",
  "alphabet": "dna",
  "data": {
    "kind": "simulated",
    "true_tree": "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
    "sim": { "model": "JC69", "length": 200, "seed": 7 }
  },
  "reference": null,
  "analysis": { "correction": "JC69", "method": "NJ" },
  "locked": [],
  "prompts": []
}`;

// A schema-5 matrix exercise (v1.4c spec §4.1): `analysis` holds only
// `method`; the loader sets `correction` to `Supplied`.
const MATRIX_EXERCISE_JSON = `{
  "schema_version": 5,
  "id": "mx-test",
  "title": "Matrix exercise",
  "alphabet": "dna",
  "data": {
    "kind": "matrix",
    "names": ["A", "B", "C", "D"],
    "lower": [0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
    "source": { "citation": "test", "license": "CC0", "accessions": [] }
  },
  "analysis": { "method": "NJ" },
  "locked": [],
  "prompts": []
}`;

// The same matrix exercise with a declared reference (like
// `upgma-vs-nj-matrix`'s tree-of-origin, spec §7.4).
const MATRIX_REF_JSON = `{
  "schema_version": 5,
  "id": "mx-ref",
  "title": "Matrix exercise with a reference",
  "alphabet": "dna",
  "data": {
    "kind": "matrix",
    "names": ["A", "B", "C", "D"],
    "lower": [0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
    "source": { "citation": "test", "license": "CC0", "accessions": [] }
  },
  "reference": { "newick": "((A:0.1,B:0.2):0.05,C:0.3,D:0.4);", "kind": "true" },
  "analysis": { "method": "NJ" },
  "locked": [],
  "prompts": []
}`;

// A 5-taxon input carrying the awkward values the notes pin: `0.1+0.2`
// (the 0.30000000000000004 double — links must round-trip bitwise) and
// a zero distance (identical taxa, spec §4.1).
const INPUT5: DistanceInput = {
  names: ["a", "b", "c", "d", "e"],
  lower: [5, 9, 0.1 + 0.2, 9, 8, 10, 8, 7, 0, 3],
};

const ALIGNMENT: Alignment = {
  labels: ["x1", "x2", "x3", "x4"],
  seqs: [
    [65, 67, 71, 84],
    [65, 67, 71, 84],
    [65, 67, 71, 84],
    [65, 67, 71, 84],
  ],
  alphabet: "dna",
};

function exercise(json: string): Exercise {
  const r = engine.loadExercise(json);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error(`loadExercise failed: ${JSON.stringify(r.error)}`);
  return r.value;
}

/** A session loaded for `ex` (source "lesson"). */
function loadedSession(ex: Exercise): Session {
  return reducer(initialSession(ex), {
    type: "load",
    exercise: ex,
    source: "lesson",
  });
}

/** A sandbox session holding INPUT5: the simulated lesson, then the
 * matrix import the import panel dispatches. */
function matrixSession(input: DistanceInput = INPUT5): Session {
  const s = reducer(loadedSession(exercise(LESSON_JSON)), {
    type: "enterSandbox",
  });
  return reducer(s, { type: "importMatrix", input, name: "test.phy" });
}

function parsed(newick: string) {
  const r = engine.parseNewick(newick);
  expect(r.ok).toBe(true);
  if (!r.ok) throw new Error("unreachable");
  return r.value;
}

describe("matrix sessions", () => {
  it("a matrix exercise's session starts on the matrix origin", () => {
    const s = loadedSession(exercise(MATRIX_EXERCISE_JSON));
    expect(s.error).toBeNull();
    expect(s.alignmentOrigin).toBe("matrix");
    expect(s.alignment).toBeNull();
    expect(s.matrixInput).toEqual({
      names: ["A", "B", "C", "D"],
      lower: [0.2, 0.3, 0.4, 0.5, 0.6, 0.7],
    });
    expect(hasAlignment(s)).toBe(false);
    // The model of every matrix-built DistanceMatrix is Supplied.
    expect(s.matrix?.model).toBe("Supplied");
    expect(s.matrix?.labels).toEqual(["A", "B", "C", "D"]);
    expect(s.result).not.toBeNull();
    expect(s.step).toBe(0);
    // Loading must not rewrite the exercise's Supplied correction.
    expect(s.exercise.analysis.correction).toBe("Supplied");
    // A matrix lesson's matrix is lesson data, not imported data.
    expect(matrixIsImported(s)).toBe(false);
  });

  it("a matrix exercise keeps its declared reference and computes RF", () => {
    const s = loadedSession(exercise(MATRIX_REF_JSON));
    expect(s.error).toBeNull();
    expect(s.reference?.origin).toBe("lesson");
    expect(s.rf).not.toBeNull();
  });

  it("importMatrix switches a sandbox session to the matrix origin", () => {
    const s = matrixSession();
    expect(s.error).toBeNull();
    expect(s.alignmentOrigin).toBe("matrix");
    expect(s.alignment).toBeNull();
    expect(s.matrixInput).toEqual(INPUT5);
    expect(hasAlignment(s)).toBe(false);
    // A matrix has no comparison tree: every reference is dropped.
    expect(s.reference).toBeNull();
    expect(s.rf).toBeNull();
    expect(s.libraryDataset).toBeNull();
    expect(s.step).toBe(0);
    expect(s.source).toBe("sandbox");
    expect(s.alignmentName).toBe("test.phy");
    // The exercise's declared alphabet stands (Task 8 shows
    // "Distance matrix" instead of the badge).
    expect(s.alphabet).toBe("dna");
    expect(s.matrix?.model).toBe("Supplied");
    expect(s.result).not.toBeNull();
  });

  it("importMatrix drops an imported reference too", () => {
    const withTree = reducer(matrixSession(), {
      type: "importTree",
      tree: parsed("((P:0.2,Q:0.2):0.1,R:0.3);"),
    });
    expect(withTree.reference?.origin).toBe("imported");
    const s = reducer(withTree, {
      type: "importMatrix",
      input: INPUT5,
      name: null,
    });
    expect(s.reference).toBeNull();
    expect(s.rf).toBeNull();
    expect(s.alignmentOrigin).toBe("matrix");
  });

  it("matrix then alignment ends with hasAlignment true and no matrixInput", () => {
    const s = reducer(matrixSession(), {
      type: "importAlignment",
      alignment: ALIGNMENT,
    });
    expect(hasAlignment(s)).toBe(true);
    expect(s.alignmentOrigin).toBe("imported");
    expect(s.alignment).toBe(ALIGNMENT);
    expect(s.matrixInput).toBeNull();
    expect(s.error).toBeNull();
    // The link carries the alignment, never both kinds of data.
    const st = sessionUrlState(s, { kind: "lesson" });
    expect(st.imported?.alignment).toBeDefined();
    expect(st.imported?.matrix).toBeUndefined();
  });

  it("importMatrix over a ds= dataset clears libraryDataset", () => {
    const withDs = reducer(loadedSession(exercise(LESSON_JSON)), {
      type: "importDataset",
      id: "globins",
      title: "Globins",
      alignment: ALIGNMENT,
    });
    expect(withDs.libraryDataset).toBe("globins");
    const s = reducer(withDs, {
      type: "importMatrix",
      input: INPUT5,
      name: "m.phy",
    });
    expect(s.libraryDataset).toBeNull();
    expect(s.alignmentOrigin).toBe("matrix");
    // The link carries the matrix, never `ds` next to it.
    const st = sessionUrlState(s, { kind: "lesson" });
    expect(st.dataset).toBeUndefined();
    expect(st.imported?.matrix).toBeDefined();
  });

  it("editMatrix(null) at step 3 leaves step 0, result null, no error (Review Focus 3)", () => {
    let s = matrixSession();
    s = reducer(s, { type: "step", to: 3 });
    expect(s.step).toBe(3);
    s = reducer(s, { type: "editMatrix", input: null });
    expect(s.step).toBe(0);
    expect(s.result).toBeNull();
    expect(s.matrix).toBeNull();
    expect(s.rf).toBeNull();
    expect(s.error).toBeNull();
    expect(s.matrixInput).toBeNull();
    // The session stays a matrix session — an incomplete grid, not a
    // return to the lesson's data.
    expect(s.alignmentOrigin).toBe("matrix");
    expect(s.alignmentName).toBe("test.phy");
  });

  it("editMatrix(input) recomputes like importMatrix but keeps the name", () => {
    const next: DistanceInput = {
      names: ["p", "q", "r"],
      lower: [0.1, 0.2, 0.3],
    };
    const s = reducer(matrixSession(), { type: "editMatrix", input: next });
    expect(s.error).toBeNull();
    expect(s.matrixInput).toEqual(next);
    expect(s.matrix?.labels).toEqual(["p", "q", "r"]);
    expect(s.result).not.toBeNull();
    expect(s.step).toBe(0);
    expect(s.alignmentOrigin).toBe("matrix");
    expect(s.alignmentName).toBe("test.phy");
  });

  it("editMatrix with an invalid input sets the error and clears results", () => {
    let s = matrixSession();
    s = reducer(s, { type: "step", to: 2 });
    s = reducer(s, {
      type: "editMatrix",
      input: { names: ["a", "b", "a"], lower: [0.1, 0.2, 0.3] },
    });
    expect(s.error?.kind).toBe("InvalidMatrix");
    expect(s.result).toBeNull();
    expect(s.matrix).toBeNull();
    expect(s.step).toBe(0);
    // No stale step/Q/tree survives; the typed values stay for fixing.
    expect(s.matrixInput?.names).toEqual(["a", "b", "a"]);
  });

  it("importTree on a matrix session clears matrixInput like an imported alignment", () => {
    const tree = parsed("((P:0.2,Q:0.2):0.1,R:0.3);");
    const s = reducer(matrixSession(), { type: "importTree", tree });
    // Exactly what importTree does on an imported alignment today:
    // the imported tree becomes the reference and the alignment
    // returns to the exercise's own origin (re-simulated).
    expect(s.matrixInput).toBeNull();
    expect(s.alignmentOrigin).toBe("simulated");
    expect(s.reference?.origin).toBe("imported");
    expect(s.error).toBeNull();
    expect(s.alignment?.labels.slice().sort()).toEqual(["P", "Q", "R"]);
  });

  it("model/gap/sim patches are inert on a matrix session; only method applies", () => {
    const s = matrixSession();
    expect(
      reducer(s, { type: "setAnalysis", patch: { correction: "K80" } }),
    ).toBe(s);
    expect(reducer(s, { type: "setAnalysis", patch: { kappa: 3 } })).toBe(s);
    expect(
      reducer(s, {
        type: "setAnalysis",
        patch: { site_filter: { kind: "complete" } },
      }),
    ).toBe(s);
    expect(reducer(s, { type: "setSim", patch: { seed: 9 } })).toBe(s);
    expect(
      reducer(s, { type: "setAlphabet", alphabet: "protein" }),
    ).toBe(s);
    expect(reducer(s, { type: "setBranchScale", scale: 2 })).toBe(s);
  });

  it("a matrix exercise session's model stays Supplied under overrides", () => {
    const s = loadedSession(exercise(MATRIX_EXERCISE_JSON));
    expect(
      reducer(s, { type: "setAnalysis", patch: { correction: "K80" } }),
    ).toBe(s);
    expect(
      reducer(s, {
        type: "setAnalysis",
        patch: { site_filter: { kind: "partial", cutoff_pct: 95 } },
      }),
    ).toBe(s);
    expect(s.exercise.analysis.correction).toBe("Supplied");
    expect(s.matrix?.model).toBe("Supplied");
  });

  it("setAnalysis({method}) rebuilds with the other method", () => {
    const s = reducer(matrixSession(), {
      type: "setAnalysis",
      patch: { method: "Upgma" },
    });
    expect(s.error).toBeNull();
    expect(s.exercise.analysis.method).toBe("Upgma");
    expect(s.result).not.toBeNull();
    expect(s.result?.trace && "Upgma" in s.result.trace).toBe(true);
  });

  it("bootstrapRequested is a no-op in a matrix session", () => {
    const s = matrixSession();
    const requested = reducer(s, { type: "bootstrapRequested", jobId: 5 });
    expect(requested).toBe(s);
    const autorun = reducer(s, {
      type: "bootstrapRequested",
      autorun: true,
    });
    expect(autorun).toBe(s);
    // Nothing can start a run: the URL never writes ran: true.
    const st = sessionUrlState(s, { kind: "lesson" });
    expect(st.bootstrap?.ran).toBe(false);
  });

  it("a matrix lesson links by ?lesson= with no imported.matrix", () => {
    const s = loadedSession(exercise(MATRIX_EXERCISE_JSON));
    const st = sessionUrlState(s, { kind: "lesson" });
    expect(st.lesson).toBe("mx-test");
    expect(st.imported).toBeUndefined();
    expect(st.dataset).toBeUndefined();
  });

  it("a sandbox matrix link carries the matrix and only the method override", () => {
    const s = matrixSession();
    const st = sessionUrlState(s, { kind: "lesson" });
    expect(st.imported?.matrix).toEqual(INPUT5);
    expect(st.imported?.alignment).toBeUndefined();
    // spec §4.1: the matrix supplies distances — no sim override, no
    // correction/kappa/site_filter, only `method` applies.
    expect(st.overrides).toEqual({ analysis: { method: "Nj" } });
    expect(Object.keys(st.overrides?.analysis ?? {})).toEqual(["method"]);
  });

  it("the matrix → alignment → ds dataset → matrix → lesson walk keeps every link truthful (Review Focus 4)", () => {
    let s = reducer(loadedSession(exercise(LESSON_JSON)), {
      type: "enterSandbox",
    });

    s = reducer(s, { type: "importMatrix", input: INPUT5, name: "m.phy" });
    expect(hasAlignment(s)).toBe(false);
    expect(s.matrixInput).toEqual(INPUT5);
    expect(s.libraryDataset).toBeNull();
    expect(s.step).toBe(0);
    let st = sessionUrlState(s, { kind: "lesson" });
    expect(st.imported?.matrix).toBeDefined();
    expect(st.imported?.alignment).toBeUndefined();
    expect(st.dataset).toBeUndefined();

    s = reducer(s, { type: "importAlignment", alignment: ALIGNMENT });
    expect(hasAlignment(s)).toBe(true);
    expect(s.alignmentOrigin).toBe("imported");
    expect(s.matrixInput).toBeNull();
    expect(s.libraryDataset).toBeNull();
    expect(s.step).toBe(0);
    st = sessionUrlState(s, { kind: "lesson" });
    expect(st.imported?.alignment).toBeDefined();
    expect(st.imported?.matrix).toBeUndefined();
    expect(st.dataset).toBeUndefined();

    s = reducer(s, {
      type: "importDataset",
      id: "globins",
      title: "Globins",
      alignment: ALIGNMENT,
    });
    expect(s.libraryDataset).toBe("globins");
    expect(s.alignmentOrigin).toBe("imported");
    expect(s.step).toBe(0);
    st = sessionUrlState(s, { kind: "lesson" });
    expect(st.dataset).toBe("globins");
    // A ds= link embeds nothing else.
    expect(st.imported).toBeUndefined();

    s = reducer(s, { type: "importMatrix", input: INPUT5, name: "m.phy" });
    expect(hasAlignment(s)).toBe(false);
    expect(s.matrixInput).toEqual(INPUT5);
    expect(s.libraryDataset).toBeNull();
    expect(s.step).toBe(0);
    st = sessionUrlState(s, { kind: "lesson" });
    expect(st.dataset).toBeUndefined();
    expect(st.imported?.matrix).toBeDefined();
    expect(st.imported?.alignment).toBeUndefined();

    s = reducer(s, { type: "exitSandbox" });
    expect(s.source).toBe("lesson");
    expect(s.alignmentOrigin).toBe("simulated");
    expect(s.matrixInput).toBeNull();
    expect(hasAlignment(s)).toBe(true);
    expect(s.step).toBe(0);
    st = sessionUrlState(s, { kind: "lesson" });
    expect(st.src).toBeUndefined();
    expect(st.imported).toBeUndefined();
    expect(st.dataset).toBeUndefined();
  });
});

describe("matrix links", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const m = /\/exercises\/([^/]+)\.json$/.exec(String(input));
      if (m === null) return new Response("not found", { status: 404 });
      try {
        return new Response(
          readFileSync(
            resolve(
              process.cwd(),
              `../exercises/${decodeURIComponent(m[1])}.json`,
            ),
            "utf8",
          ),
        );
      } catch {
        return new Response("not found", { status: 404 });
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
  });

  /** `d=` url for an arbitrary imported payload. */
  function dUrl(imported: unknown, extra = ""): string {
    return (
      "/?sb=1&d=" +
      encodeURIComponent(
        compressToEncodedURIComponent(JSON.stringify(imported)),
      ) +
      extra
    );
  }

  it("a sandbox matrix link decodes and restores identically", () => {
    const st = sessionUrlState(matrixSession(), { kind: "lesson" });
    const url = encode(st);
    const d = decode(url);
    expect(d).toEqual({ ok: true, state: st });
    // The matrix arrives bitwise: the 0.1+0.2 double and the zero.
    expect(st.imported?.matrix).toEqual(INPUT5);
    expect(st.imported?.matrix?.lower[2]).toBe(0.1 + 0.2);
  });

  it("imported.matrix + imported.alignment is a restore error", () => {
    const d = decode(dUrl({ matrix: INPUT5, alignment: ALIGNMENT }));
    expect(d.ok).toBe(false);
    // The same pair inside a #x= payload fails migration the same way.
    expect(
      migrate({
        v: 3,
        step: 0,
        mode: "concept",
        imported: { matrix: INPUT5, alignment: ALIGNMENT },
      }),
    ).toBeNull();
  });

  it("ds= together with a matrix d= is a restore error", () => {
    const d = decode(dUrl({ matrix: INPUT5 }, "&ds=globins"));
    expect(d.ok).toBe(false);
  });

  it("a malformed imported.matrix is a restore error", () => {
    expect(decode(dUrl({ matrix: { names: "no" } })).ok).toBe(false);
    expect(
      decode(dUrl({ matrix: { names: ["a"], lower: "x" } })).ok,
    ).toBe(false);
  });

  it.each([
    ["correction", { analysis: { correction: "K80" } }],
    ["kappa", { analysis: { kappa: 2 } }],
    ["site_filter", { analysis: { site_filter: { kind: "complete" } } }],
    ["sim", { sim: { seed: 3 } }],
  ])(
    "a matrix link carrying %s is a restore error naming the field",
    (field, overrides) => {
      const o = encodeURIComponent(
        compressToEncodedURIComponent(JSON.stringify(overrides)),
      );
      const d = decode(`/?sb=1&o=${o}&d=${dUrl({ matrix: INPUT5 }).slice(9)}`);
      expect(d.ok).toBe(false);
      if (!d.ok) expect(d.reason).toContain(field);
      // Same rule inside a #x= payload (matrix imported or matrix
      // exercise): the migration refuses it.
      expect(
        migrate({
          v: 3,
          step: 0,
          mode: "concept",
          imported: { matrix: INPUT5 },
          overrides,
        }),
      ).toBeNull();
    },
  );

  it("a #x= matrix exercise carrying overrides is a restore error", () => {
    const x = exercise(MATRIX_EXERCISE_JSON);
    expect(
      migrate({
        v: 3,
        step: 0,
        mode: "concept",
        x,
        overrides: { analysis: { kappa: 2 } },
      }),
    ).toBeNull();
  });

  it("a matrix link with bootstrap.ran restores idle, never an error", () => {
    const st: UrlState = {
      v: 3,
      lesson: "sim-lesson",
      step: 0,
      mode: "concept",
      src: "sandbox",
      imported: { matrix: INPUT5 },
      bootstrap: { replicates: 200, seed: 5, view: "strict", ran: true },
    };
    const s = applyUrlState(loadedSession(exercise(LESSON_JSON)), st);
    expect(s.error).toBeNull();
    expect(s.alignmentOrigin).toBe("matrix");
    // `ran` is ignored for a matrix session: settings land, the
    // bootstrap stays idle.
    expect(s.bootstrap.status).toBe("idle");
    expect(s.bootstrap.autorun).toBe(false);
    expect(s.bootstrap.replicates).toBe(200);
    expect(s.bootstrap.seed).toBe(5);
    expect(s.bootstrap.view).toBe("strict");
  });

  it("a matrix lesson link carrying a forbidden override is a restore error", async () => {
    const o = encodeURIComponent(
      compressToEncodedURIComponent(
        JSON.stringify({ analysis: { site_filter: { kind: "complete" } } }),
      ),
    );
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const m = /\/exercises\/([^/]+)\.json$/.exec(String(input));
      if (m?.[1] === "mx-test") {
        return new Response(MATRIX_EXERCISE_JSON);
      }
      return new Response("not found", { status: 404 });
    });
    history.replaceState(null, "", `/?lesson=mx-test&o=${o}`);
    const r = await resolveInitial(null);
    expect(r.toast).toBe(true);
    expect(r.toastDetail).toContain("site_filter");
  });

  it("a 200-taxon matrix link triggers the long-link notice and still restores", () => {
    const input: DistanceInput = {
      names: Array.from({ length: 200 }, (_, i) => `taxon-${i}`),
      lower: Array.from(
        { length: (200 * 199) / 2 },
        (_, i) => 0.05 + (i % 41) * 0.01,
      ),
    };
    const s = matrixSession(input);
    const st = sessionUrlState(s, { kind: "lesson" });
    const link = encode(st);
    expect(link.length).toBeGreaterThan(LONG_LINK_CHARS);
    expect(longLinkNotice(link)).toBe(
      "This link is very long; some apps may cut it. Export the matrix file instead.",
    );
    // The link still decodes and restores to an identical session —
    // the notice never blocks (spec §4.3).
    const d = decode(link);
    expect(d.ok).toBe(true);
    if (!d.ok) throw new Error("unreachable");
    const r = applyUrlState(loadedSession(exercise(LESSON_JSON)), d.state);
    expect(r.error).toBeNull();
    expect(r.alignmentOrigin).toBe("matrix");
    expect(r.matrixInput).toEqual(input);
    expect(r.exercise.analysis.method).toBe("Nj");
    expect(r.step).toBe(0);
    expect(r.matrix).toEqual(s.matrix);
  });

  it("longLinkNotice is null at or under the limit", () => {
    expect(longLinkNotice("?lesson=x")).toBeNull();
    expect(longLinkNotice("x".repeat(LONG_LINK_CHARS))).toBeNull();
    expect(longLinkNotice("x".repeat(LONG_LINK_CHARS + 1))).not.toBeNull();
  });
});

// --- v1.4c link corpus ---------------------------------------------
//
// `__fixtures__/v3-matrix-urls.json` holds v3 links written by the
// matrix session code: a sandbox matrix (the `d=` payload's
// `imported.matrix`), a custom matrix exercise in `#x=`, and a matrix
// with UPGMA at step 2. Restore must be identical — the same matrix,
// method and step (v1.4c spec §4.3; v stays 3).

interface MatrixCase {
  name: string;
  url: string;
  step: number;
  method: "Nj" | "Upgma";
  errorKind: string | null;
  matrix: Session["matrix"];
}

const CAPTURED_MATRIX: { cases: MatrixCase[] } = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "src/state/__fixtures__/v3-matrix-urls.json"),
    "utf8",
  ),
) as { cases: MatrixCase[] };

describe("v3 matrix link corpus", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
      const m = /\/exercises\/([^/]+)\.json$/.exec(String(input));
      if (m === null) return new Response("not found", { status: 404 });
      try {
        return new Response(
          readFileSync(
            resolve(
              process.cwd(),
              `../exercises/${decodeURIComponent(m[1])}.json`,
            ),
            "utf8",
          ),
        );
      } catch {
        return new Response("not found", { status: 404 });
      }
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    history.replaceState(null, "", "/");
  });

  it("captured all listed cases", () => {
    expect(CAPTURED_MATRIX.cases.length).toBeGreaterThanOrEqual(3);
  });

  it.each(CAPTURED_MATRIX.cases)(
    "v3_matrix_urls_identical: $name restores the identical matrix, method and step",
    async (c) => {
      history.replaceState(null, "", c.url);
      const r = await resolveInitial(null);
      expect(r.toast).toBe(false);
      expect(r.fromUrl).not.toBeNull();
      if (r.exercise === null) throw new Error("resolveInitial found no exercise");
      let s = reducer(initialSession(r.exercise), {
        type: "load",
        exercise: r.exercise,
        source: "lesson",
      });
      s = applyUrlState(s, r.fromUrl!);
      expect(s.step).toBe(c.step);
      expect(s.alignmentOrigin).toBe("matrix");
      expect(hasAlignment(s)).toBe(false);
      expect(s.exercise.analysis.method).toBe(c.method);
      expect(JSON.parse(JSON.stringify(s.matrix))).toEqual(c.matrix);
      expect(s.error?.kind ?? null).toBe(c.errorKind);
    },
  );
});
