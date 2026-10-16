// URL state tests (plan Task 22, spec §6.4). decode(encode(s)) must
// round-trip any valid state; malformed or unknown-version payloads fail
// cleanly so the app can toast and fall back to the default lesson.

import { describe, expect, it } from "vitest";

import type { Exercise } from "../engine/generated/Exercise";

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
  return {
    schema_version: 1,
    id: `ex-${Math.floor(rand() * 1e6)}`,
    title: `Random "${pick(LABEL_POOL)}" lesson`,
    true_tree: `(${labels.map((l) => `'${l}':0.1`).join(",")});`,
    sim: {
      model: pick(SIM_MODELS),
      length: 10 + Math.floor(rand() * 9990),
      seed: Math.floor(rand() * 1e6),
    },
    analysis: { correction: pick(CORRECTIONS), method: pick(METHODS) },
    locked: [],
    prompts: [],
  };
}

function randomState(rand: () => number): UrlState {
  const pick = <T>(xs: readonly T[]): T =>
    xs[Math.floor(rand() * xs.length) % xs.length];
  const s: UrlState = {
    v: 1,
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
      v: 1,
      x: {
        schema_version: 1,
        id: "weird",
        title: "Labels",
        true_tree: "('O\\'Brien':0.1,'Homo sapiens':0.2,'<b>x</b>':0.3);",
        sim: { model: { K80: { kappa: 1.5 } }, length: 100, seed: 1 },
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
      v: 1,
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
      v: 1,
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
      state: { v: 1, step: 0, mode: "concept" },
    });
    expect(decode("http://example.test/#section")).toEqual({
      ok: true,
      state: { v: 1, step: 0, mode: "concept" },
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
      state: { v: 1, step: 2, mode: "math" },
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
      v: 1,
      step: 3,
      mode: "math",
    });
    // Invalid fields fall back to defaults rather than failing.
    expect(migrate({ v: 0, step: -2, mode: "weird" })).toEqual({
      v: 1,
      step: 0,
      mode: "concept",
    });
  });

  it("accepts well-formed v1 states and rejects broken ones", () => {
    const good: UrlState = {
      v: 1,
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
    expect(
      migrate({ v: 1, step: 0, mode: "concept", imported: 5 }),
    ).toBeNull();
    expect(
      migrate({ v: 1, step: 0, mode: "concept", imported: { trueTree: "x" } }),
    ).toEqual({
      v: 1,
      step: 0,
      mode: "concept",
      imported: { trueTree: "x" },
    });
  });
});
