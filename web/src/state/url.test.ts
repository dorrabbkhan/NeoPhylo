// URL state tests (plan Task 22, spec §6.4). decode(encode(s)) must
// round-trip any valid state; malformed or unknown-version payloads fail
// cleanly so the app can toast and fall back to the default lesson.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { compressToEncodedURIComponent } from "lz-string";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { engine } from "../engine/index";
import type { Exercise } from "../engine/generated/Exercise";

import { initialSession, reducer } from "./session";
import type { Session } from "./session";
import { applyUrlState, resolveInitial, sessionUrlState } from "./urlRestore";
import { decode, encode, migrate, type UrlState } from "./url";

/** Deterministic PRNG (Math.random is banned in web/src). */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const LABEL_POOL = [
  "Homo sapiens",
  "O'Brien",
  "<b>bold</b>",
  "Δelta_ε",
  "comma,label",
  "semi;colon",
];

const SIM_MODELS = ["Jc69", { K80: { kappa: 2.5 } }] as const;
const CORRECTIONS = ["P", "Jc69", "K80"] as const;
const METHODS = ["Nj", "Upgma"] as const;

function randomExercise(rand: () => number): Exercise {
  const pick = <T>(xs: readonly T[]): T =>
    xs[Math.floor(rand() * xs.length) % xs.length];
  const n = 3 + Math.floor(rand() * 4);
  const labels = Array.from(
    { length: n },
    (_, i) => `${pick(LABEL_POOL)}_${i}`,
  );
  const trueTree = `(${labels.map((l) => `'${l}':0.1`).join(",")});`;
  return {
    schema_version: 2,
    id: `ex-${Math.floor(rand() * 1e6)}`,
    title: `Random "${pick(LABEL_POOL)}" lesson`,
    alphabet: "dna",
    data: {
      kind: "simulated",
      true_tree: trueTree,
      sim: {
        model: pick(SIM_MODELS),
        length: 10 + Math.floor(rand() * 9990),
        seed: Math.floor(rand() * 1e6),
      },
    },
    reference: { newick: trueTree, kind: "true" },
    analysis: { correction: pick(CORRECTIONS), method: pick(METHODS) },
    locked: [],
    prompts: [],
  };
}

function randomState(rand: () => number): UrlState {
  const pick = <T>(xs: readonly T[]): T =>
    xs[Math.floor(rand() * xs.length) % xs.length];
  const s: UrlState = {
    v: 3,
    step: Math.floor(rand() * 20),
    mode: rand() < 0.5 ? "concept" : "math",
  };
  if (rand() < 0.5) s.lesson = `lesson-${Math.floor(rand() * 100)}`;
  if (rand() < 0.3) s.x = randomExercise(rand);
  if (rand() < 0.3) s.src = "sandbox";
  if (rand() < 0.5) {
    s.overrides = {};
    if (rand() < 0.7) s.overrides.sim = { seed: Math.floor(rand() * 1e6) };
    if (rand() < 0.5)
      s.overrides.analysis = { correction: "K80", method: "Upgma" };
    if (rand() < 0.5) s.overrides.branchScale = 0.5 + rand();
  }
  if (rand() < 0.3) {
    s.imported = {};
    if (rand() < 0.7) {
      const n = 3 + Math.floor(rand() * 4);
      s.imported.alignment = {
        labels: Array.from({ length: n }, (_, i) => `${pick(LABEL_POOL)}_${i}`),
        seqs: Array.from({ length: n }, () =>
          Array.from({ length: 20 }, () => Math.floor(rand() * 4)),
        ),
        alphabet: "dna",
      };
    }
    if (rand() < 0.5) {
      s.imported.trueTree = "((A:0.1,B:0.2):0.05,C:0.3);";
    }
  }
  return s;
}

describe("encode/decode round trip", () => {
  it("decode(encode(s)) deep-equals s for random valid states", () => {
    const rand = mulberry32(0xc0ffee);
    for (let i = 0; i < 200; i++) {
      const s = randomState(rand);
      const d = decode(encode(s));
      if (!d.ok) throw new Error(`decode failed for state ${i}`);
      expect(d.state).toEqual(s);
    }
  });

  it("keeps labels with Unicode, quotes and markup intact", () => {
    const s: UrlState = {
      v: 3,
      x: {
        schema_version: 2,
        id: "weird",
        title: "Labels",
        alphabet: "dna",
        data: {
          kind: "simulated",
          true_tree: "('O\\'Brien':0.1,'Homo sapiens':0.2,'<b>x</b>':0.3);",
          sim: { model: { K80: { kappa: 1.5 } }, length: 100, seed: 1 },
        },
        reference: {
          newick: "('O\\'Brien':0.1,'Homo sapiens':0.2,'<b>x</b>':0.3);",
          kind: "true",
        },
        analysis: { correction: "P", method: "Nj" },
        locked: [],
        prompts: [],
      },
      step: 1,
      mode: "math",
    };
    const d = decode(encode(s));
    expect(d).toEqual({ ok: true, state: s });
  });

  it("carries a sandbox-imported alignment and tree through a ?lesson= link", () => {
    const s: UrlState = {
      v: 3,
      lesson: "nj-basics",
      step: 0,
      mode: "concept",
      src: "sandbox",
      imported: {
        alignment: {
          labels: ["O'Brien", "Ångström"],
          seqs: [
            [0, 1, 2, 3],
            [0, 1, 2, 0],
          ],
          alphabet: "dna",
        },
        trueTree: "(A:0.1,B:0.2,C:0.3);",
      },
    };
    const d = decode(encode(s));
    expect(d).toEqual({ ok: true, state: s });
  });
});

describe("decode", () => {
  it("rejects a truncated #x= payload", () => {
    const s: UrlState = {
      v: 3,
      x: randomExercise(mulberry32(1)),
      step: 0,
      mode: "concept",
    };
    const href = encode(s);
    expect(decode(href.slice(0, href.length - 3)).ok).toBe(false);
    expect(decode("#x=!!!").ok).toBe(false);
    expect(decode("#x=").ok).toBe(false);
  });

  it("returns the default state for a bare URL", () => {
    expect(decode("http://example.test/")).toEqual({
      ok: true,
      state: { v: 3, step: 0, mode: "concept" },
    });
    expect(decode("http://example.test/#section")).toEqual({
      ok: true,
      state: { v: 3, step: 0, mode: "concept" },
    });
  });

  it("rejects malformed query parameters", () => {
    expect(decode("http://x/?s=-1").ok).toBe(false);
    expect(decode("http://x/?s=abc").ok).toBe(false);
    expect(decode("http://x/?m=philosophy").ok).toBe(false);
    expect(decode("http://x/?o=@@@").ok).toBe(false);
    expect(decode("http://x/?d=@@@").ok).toBe(false);
  });

  it("ignores unrelated query parameters", () => {
    const d = decode("http://x/?utm=track&s=2&m=math");
    expect(d).toEqual({
      ok: true,
      state: { v: 3, step: 2, mode: "math" },
    });
  });
});

describe("migrate", () => {
  it("returns null for unknown versions", () => {
    expect(migrate({ v: 99 })).toBeNull();
    expect(migrate({ v: "1" })).toBeNull();
    expect(migrate(null)).toBeNull();
    expect(migrate(42)).toBeNull();
    expect(migrate({ step: 3, mode: "math" })).toBeNull();
  });

  it("carries step and mode out of a v0 state (stubbed path)", () => {
    expect(migrate({ v: 0, step: 3, mode: "math" })).toEqual({
      v: 3,
      step: 3,
      mode: "math",
    });
    // Invalid fields fall back to defaults rather than failing.
    expect(migrate({ v: 0, step: -2, mode: "weird" })).toEqual({
      v: 3,
      step: 0,
      mode: "concept",
    });
  });

  it("accepts well-formed v1 and v2 states and rejects broken ones", () => {
    // A v1 state migrates to v 2 with its fields intact.
    expect(migrate({ v: 1, lesson: "nj-basics", step: 2, mode: "concept" }))
      .toEqual({
        v: 3,
        lesson: "nj-basics",
        step: 2,
        mode: "concept",
      });
    const good: UrlState = {
      v: 3,
      lesson: "nj-basics",
      step: 2,
      mode: "concept",
    };
    expect(migrate(good)).toEqual(good);
    expect(migrate({ v: 1, step: -1, mode: "concept" })).toBeNull();
    expect(migrate({ v: 1, step: 0, mode: "x" })).toBeNull();
    expect(migrate({ v: 1, step: 0, mode: "concept", src: "nope" })).toBeNull();
    expect(migrate({ v: 1, step: 0, mode: "concept", x: "str" })).toBeNull();
    expect(
      migrate({ v: 1, step: 0, mode: "concept", overrides: 5 }),
    ).toBeNull();
    expect(migrate({ v: 1, step: 0, mode: "concept", imported: 5 })).toBeNull();
    expect(
      migrate({ v: 1, step: 0, mode: "concept", imported: { trueTree: "x" } }),
    ).toEqual({
      v: 3,
      step: 0,
      mode: "concept",
      imported: { trueTree: "x" },
    });
  });

  it("accepts a well-formed v3 state and rejects a broken bootstrap", () => {
    const good: UrlState = {
      v: 3,
      lesson: "nj-basics",
      step: 2,
      mode: "concept",
      bootstrap: { replicates: 200, seed: 7, view: "majority", ran: true },
    };
    expect(migrate(good)).toEqual(good);
    // v2 payloads migrate to v3 with no bootstrap block.
    expect(migrate({ v: 2, step: 1, mode: "math" })).toEqual({
      v: 3,
      step: 1,
      mode: "math",
    });
    // Malformed bootstrap fields reject the whole payload (same rule
    // as `src`/`overrides`), never a silently dropped setting.
    expect(
      migrate({
        v: 3,
        step: 0,
        mode: "concept",
        bootstrap: { replicates: "100", seed: 1, view: "support", ran: false },
      }),
    ).toBeNull();
    expect(
      migrate({
        v: 3,
        step: 0,
        mode: "concept",
        bootstrap: { replicates: 100, seed: 1, view: "wide", ran: false },
      }),
    ).toBeNull();
    expect(
      migrate({ v: 3, step: 0, mode: "concept", bootstrap: 5 }),
    ).toBeNull();
  });

  it("migrates a v1 #x= exercise through engine.loadExercise", () => {
    // The v1 file shape (flat true_tree/sim, schema_version 1) comes
    // back as a normalized v2 Exercise (v1.1 spec §3.6).
    const state = migrate({
      v: 1,
      x: {
        schema_version: 1,
        id: "old-link",
        title: "An exercise shared by a v1 link",
        true_tree: "((A:0.1,B:0.2):0.05,C:0.3);",
        sim: { model: "JC69", length: 100, seed: 1 },
        analysis: { correction: "JC69", method: "NJ" },
      },
      step: 0,
      mode: "concept",
    });
    expect(state).not.toBeNull();
    expect(state?.x?.schema_version).toBe(2);
    expect(state?.x?.alphabet).toBe("dna");
    expect(state?.x?.data.kind).toBe("simulated");
    expect(state?.x?.reference).toEqual({
      newick: "((A:0.1,B:0.2):0.05,C:0.3);",
      kind: "true",
    });
  });

  it("returns null when a v1 #x= exercise fails to load", () => {
    expect(
      migrate({
        v: 1,
        x: { schema_version: 1, id: "broken" },
        step: 0,
        mode: "concept",
      }),
    ).toBeNull();
  });

  it("defaults a missing alignment alphabet to dna", () => {
    // A v1 `d=`/`imported` alignment had no alphabet field; v1 data is
    // always DNA (matches the serde default, v1.1 spec §3.1).
    const state = migrate({
      v: 1,
      step: 0,
      mode: "concept",
      imported: {
        alignment: { labels: ["a", "b"], seqs: [[65, 67], [65, 71]] },
      },
    });
    expect(state?.imported?.alignment?.alphabet).toBe("dna");
    // Same for the ?-style link path, which never consults `v`.
    const d = decode(
      "http://x/?s=0&m=concept&d=" +
        encodeURIComponent(
          compressToEncodedURIComponent(
            JSON.stringify({
              alignment: { labels: ["a", "b"], seqs: [[65, 67], [65, 71]] },
            }),
          ),
        ),
    );
    expect(d.ok).toBe(true);
    if (!d.ok) throw new Error("unreachable");
    expect(d.state.imported?.alignment?.alphabet).toBe("dna");
  });
});

// --- Task 9: the v1 link corpus -------------------------------------
//
// `__fixtures__/v1-urls.json` was captured on the pre-v2 code: 13 real
// v1 URLs (every built-in lesson at step 0 and mid-step, seed/length
// overrides, two custom `#x=` exercises, two sandbox states) plus the
// step-0 matrix each restored to at full precision. Every URL must
// decode, migrate and recompute to that identical matrix and step
// (v1.1 spec §6.2 "Migration"). Lesson ids resolve through the real
// loader with fetch stubbed to the exercises/ directory.

interface CapturedCase {
  name: string;
  url: string;
  step: number;
  errorKind: string | null;
  matrix: Session["matrix"];
}

const CAPTURED: { cases: CapturedCase[] } = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "src/state/__fixtures__/v1-urls.json"),
    "utf8",
  ),
) as { cases: CapturedCase[] };

describe("v1 link corpus", () => {
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
    expect(CAPTURED.cases.length).toBeGreaterThanOrEqual(12);
  });

  it.each(CAPTURED.cases)(
    "v1_urls_identical: $name restores the identical step-0 matrix and step",
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
      if (r.fromUrl !== null) s = applyUrlState(s, r.fromUrl);
      expect(s.step).toBe(c.step);
      // The fixture is JSON, which cannot express -0 (stringified as
      // 0); round-tripping the live matrix compares like-for-like.
      expect(JSON.parse(JSON.stringify(s.matrix))).toEqual(c.matrix);
      expect(s.error?.kind ?? null).toBe(c.errorKind);
    },
  );
});

// --- Task 10: the v2 link corpus and URL v3 --------------------------
//
// `__fixtures__/v2-urls.json` was captured on the pre-v3 code: 12 real
// v2 URLs (every built-in lesson shape — DNA and protein, simulated and
// embedded — mid-steps, seed/length/model overrides, a custom `#x=`
// exercise and two sandbox imports) plus the matrix each restored to.
// Migration to v3 must not perturb a single restored value (v1.2 plan
// Global Constraints: no changes to existing results).

const CAPTURED_V2: { cases: CapturedCase[] } = JSON.parse(
  readFileSync(
    resolve(process.cwd(), "src/state/__fixtures__/v2-urls.json"),
    "utf8",
  ),
) as { cases: CapturedCase[] };

describe("v2 link corpus", () => {
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
    expect(CAPTURED_V2.cases.length).toBeGreaterThanOrEqual(10);
  });

  it.each(CAPTURED_V2.cases)(
    "v2_urls_identical: $name restores the identical matrix and step",
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
      if (r.fromUrl !== null) s = applyUrlState(s, r.fromUrl);
      expect(s.step).toBe(c.step);
      expect(JSON.parse(JSON.stringify(s.matrix))).toEqual(c.matrix);
      expect(s.error?.kind ?? null).toBe(c.errorKind);
    },
  );
});

describe("URL v3 bootstrap block", () => {
  // Load the real nj-basics file through the engine, as loadLesson does.
  const loaded = (() => {
    const r = engine.loadExercise(
      readFileSync(
        resolve(process.cwd(), "../exercises/nj-basics.json"),
        "utf8",
      ),
    );
    if (!r.ok) throw new Error("loadExercise failed");
    return r.value;
  })();

  function session(): Session {
    return reducer(initialSession(loaded), {
      type: "load",
      exercise: loaded,
      source: "lesson",
    });
  }

  it("url_settings_only: the URL carries bootstrap settings, never results", () => {
    let s = session();
    s = reducer(s, {
      type: "setBootstrapSettings",
      patch: { replicates: 250, seed: 9 },
    });
    s = reducer(s, { type: "setBootstrapView", view: "extended" });
    // Simulate a finished run: results must NOT leak into the link.
    s = reducer(s, { type: "bootstrapRequested", jobId: 4 });
    s = reducer(s, {
      type: "bootstrapDone",
      jobId: 4,
      result: {
        tally: {
          method: "Nj",
          labels: ["A", "B", "C"],
          successful: 250,
          failed: 0,
          counts: [{ labels: ["A", "B"], count: 200 }],
        },
        support: s.result!.tree,
        consensus: {
          Strict: s.result!.tree,
          Majority: s.result!.tree,
          Extended: s.result!.tree,
        },
        dropped: { Strict: [], Majority: [], Extended: [] },
        failed: 0,
      },
    });
    const st = sessionUrlState(s, { kind: "lesson" });
    expect(st.v).toBe(3);
    expect(st.bootstrap).toEqual({
      replicates: 250,
      seed: 9,
      view: "extended",
      ran: true,
    });
    // Exactly the four settings fields — no tally, counts, support or
    // consensus data (v1.2 spec §6.1: results are never stored).
    expect(Object.keys(st.bootstrap ?? {})).toEqual([
      "replicates",
      "seed",
      "view",
      "ran",
    ]);
    const d = decode(encode(st));
    expect(d).toEqual({ ok: true, state: st });
  });

  it("ran is false until a run is requested", () => {
    const st = sessionUrlState(session(), { kind: "lesson" });
    expect(st.bootstrap).toEqual({
      replicates: 100,
      seed: 1,
      view: "support",
      ran: false,
    });
  });

  it("ran_autorun_rule: decode + applyUrlState requests a run; the estimate decides", () => {
    const st: UrlState = {
      v: 3,
      lesson: "nj-basics",
      step: 0,
      mode: "concept",
      bootstrap: { replicates: 200, seed: 5, view: "strict", ran: true },
    };
    let s = session();
    s = applyUrlState(s, st);
    // The request is queued: estimating, autorun flagged, settings in.
    expect(s.bootstrap.status).toBe("estimating");
    expect(s.bootstrap.autorun).toBe(true);
    expect(s.bootstrap.replicates).toBe(200);
    expect(s.bootstrap.seed).toBe(5);
    expect(s.bootstrap.view).toBe("strict");

    // Under the 10,000 ms budget the run goes ahead (status running —
    // the client auto-confirms; a progress message lands next).
    const fast = reducer(s, {
      type: "bootstrapEstimated",
      jobId: 11,
      msPerReplicate: 5,
      totalMs: 5000,
    });
    expect(fast.bootstrap.status).toBe("running");
    expect(fast.bootstrap.autorun).toBe(false);

    // Over the budget: "idle" with a prefilled-run flag, and the job
    // is handed to cancelJobId so the page cancels the worker.
    const slow = reducer(s, {
      type: "bootstrapEstimated",
      jobId: 12,
      msPerReplicate: 500,
      totalMs: 20_000,
    });
    expect(slow.bootstrap.status).toBe("idle");
    expect(slow.bootstrap.prefilledRun).toBe(true);
    expect(slow.bootstrap.jobId).toBeNull();
    expect(slow.bootstrap.cancelJobId).toBe(12);
  });

  it("a manual over-budget estimate asks for confirmation instead", () => {
    let s = reducer(session(), { type: "bootstrapRequested", jobId: 3 });
    s = reducer(s, {
      type: "bootstrapEstimated",
      jobId: 3,
      msPerReplicate: 500,
      totalMs: 20_000,
    });
    expect(s.bootstrap.status).toBe("confirming");
    s = reducer(s, { type: "bootstrapConfirmed", jobId: 3 });
    expect(s.bootstrap.status).toBe("running");
  });
});
