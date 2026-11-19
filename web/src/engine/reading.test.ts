// Reading-set engine wrappers (v1.4d plan Task 5, spec §5). Every
// wrapper returns `{ ok: true, value }` on valid input and the
// `{ ok: false, error: NeoError }` shape on invalid input — errors are
// values, nothing throws. Test sets come from the shared corpus in
// crates/neophylo-core/tests/reading_inputs/ (Vitest runs with cwd =
// web/, so repo files resolve against "..").

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { engine } from "./index";
import type { ReadingSet } from "./generated/ReadingSet";

const INPUTS = resolve(
  "..",
  "crates",
  "neophylo-core",
  "tests",
  "reading_inputs",
);
const readInput = (f: string) => readFileSync(resolve(INPUTS, f), "utf8");

const POLY = readInput("valid-polytomy.json");
const TIMES = readInput("valid-times.json");
const POOL = readInput("valid-pool.json");

function loadSet(json: string): ReadingSet {
  const r = engine.loadReadingSet(json);
  if (!r.ok) {
    throw new Error(`test set failed to load: ${JSON.stringify(r.error)}`);
  }
  return r.value;
}

describe("loadReadingSet", () => {
  it("loads a valid set", () => {
    const r = engine.loadReadingSet(POLY);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.kind).toBe("reading");
      expect(r.value.id).toBe("test-polytomy");
      expect(r.value.items).toHaveLength(4);
      // The loader resolves the "root" sentinel to the full tip set.
      const letters = r.value.trees["poly"].node_letters;
      expect(letters.find((l) => l.letter === "R")?.on).toEqual([
        "a",
        "b",
        "c",
        "d",
      ]);
    }
  });

  it.each([
    ["unparseable text", "not json"],
    ["a structural refusal", readInput("shape-items-null.json")],
    ["a semantic refusal", readInput("sem-clade-tip.json")],
  ])("refuses %s as an InvalidReading value", (_name, json) => {
    const r = engine.loadReadingSet(json);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidReading");
    }
  });
});

describe("readingAnswer", () => {
  const set = loadSet(POLY);

  it("computes the MRCA answer of an item", () => {
    const r = engine.readingAnswer(set, 1); // q-mrca-poly: tips a, c
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.accepted).toEqual({
        kind: "clade",
        value: ["a", "b", "c"],
      });
      expect(typeof r.value.explanation).toBe("string");
      expect(r.value.explanation.length).toBeGreaterThan(0);
      expect(r.value.authored).toBe(false);
    }
  });

  it("computes the pairwise answer (polytomy = equally close)", () => {
    const r = engine.readingAnswer(set, 0); // q-pair-poly
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.accepted).toEqual({ kind: "pairwise", value: "Equal" });
    }
  });

  it("an out-of-range item index is an error value", () => {
    const r = engine.readingAnswer(set, 99);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidReading");
    }
  });
});

describe("readingCheck", () => {
  const set = loadSet(POLY);

  it("accepts the right pairwise answer", () => {
    const r = engine.readingCheck(set, 0, {
      kind: "pairwise",
      answer: "Equal",
    });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.correct).toBe(true);
    }
  });

  it("rejects the wrong pairwise answer, still ok:true", () => {
    const r = engine.readingCheck(set, 0, { kind: "pairwise", answer: "B" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.correct).toBe(false);
      expect(r.value.explanation.length).toBeGreaterThan(0);
    }
  });

  it("a response kind that does not fit the question is an error value", () => {
    const r = engine.readingCheck(set, 0, { kind: "number", value: 3 });
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidReading");
    }
  });
});

describe("readingVariant", () => {
  const set = loadSet(POOL);

  it("applies ops in order and stays answerable", () => {
    const r = engine.readingVariant(set, 7, ["rotate", "shuffle", "relabel"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      // The transformed set still answers every item.
      for (let i = 0; i < r.value.items.length; i += 1) {
        const key = engine.readingAnswer(r.value, i);
        expect(key.ok).toBe(true);
      }
    }
  });

  it("is deterministic for a seed", () => {
    const a = engine.readingVariant(set, 42, ["rotate"]);
    const b = engine.readingVariant(set, 42, ["rotate"]);
    expect(a).toEqual(b);
  });

  it("rotate preserves answers", () => {
    const rotated = engine.readingVariant(set, 5, ["rotate"]);
    expect(rotated.ok).toBe(true);
    if (rotated.ok) {
      for (let i = 0; i < set.items.length; i += 1) {
        expect(engine.readingAnswer(rotated.value, i)).toEqual(
          engine.readingAnswer(set, i),
        );
      }
    }
  });

  it("an unknown op is an error value", () => {
    const r = engine.readingVariant(set, 1, [
      "rotate",
      "scramble" as "rotate",
    ]);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidExercise");
    }
  });
});

describe("readingCladeOf", () => {
  it("resolves a tip set to its canonical clade key", () => {
    const r = engine.readingCladeOf("((a,b,c),d);", ["c", "a", "b"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual(["a", "b", "c"]);
    }
  });

  it("a single tip names itself", () => {
    const r = engine.readingCladeOf("((a,b,c),d);", ["d"]);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value).toEqual(["d"]);
    }
  });

  it.each([
    ["a tip set no node spans", ["a", "d"]],
    ["an unknown tip", ["a", "zz"]],
  ])("%s is an InvalidReading value", (_name, tips) => {
    const r = engine.readingCladeOf("((a,b,c),d);", tips);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidReading");
    }
  });

  it("bad Newick is an error value", () => {
    const r = engine.readingCladeOf("(((", ["a"]);
    expect(r.ok).toBe(false);
  });
});

describe("readingTree", () => {
  const set = loadSet(TIMES);
  const polySet = loadSet(POLY);

  it("gives the same CladeKey for every node as the definition", () => {
    const r = engine.readingTree(set, "tx");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const view = r.value;
    const { nodes, root } = view;

    // Recompute each clade key from the parent/children structure and
    // compare with the key the binding reports.
    const leafClade = (i: number): string[] => {
      const n = nodes[i];
      expect(
        n.children.length === 0 || n.label === null,
        `node ${i}: internal nodes are unlabeled`,
      ).toBe(true);
      return n.children.length === 0 ? [n.label ?? ""] : [];
    };
    const expectClade = (i: number, seen: Set<number>): string[] => {
      expect(seen.has(i), "the node graph must be acyclic").toBe(false);
      seen.add(i);
      const n = nodes[i];
      const tips =
        n.children.length === 0
          ? leafClade(i)
          : n.children.flatMap((c) => expectClade(c, seen));
      const want = [...new Set(tips)].sort();
      expect(n.clade, `node ${i}`).toEqual(want);
      return want;
    };
    expectClade(root, new Set());
    expect(nodes[root].parent).toBeNull();
    expect(nodes[root].clade).toEqual(["a", "b", "c", "d", "e"]);

    // Parent/children are consistent both ways.
    nodes.forEach((n, i) => {
      n.children.forEach((c) => expect(nodes[c].parent).toBe(i));
      if (n.parent !== null) {
        expect(nodes[n.parent].children).toContain(i);
      }
    });

    // Letters and ages land on the right clades.
    const byKey = (key: string[]) =>
      nodes.find((n) => n.clade.join(",") === key.join(","));
    expect(byKey(["b", "c"])).toMatchObject({ letter: "P", age: 5 });
    expect(byKey(["a", "b", "c"])).toMatchObject({ letter: "Q", age: 8 });
    expect(byKey(["d", "e"])).toMatchObject({ letter: "R", age: 6 });
    expect(byKey(["e"])).toMatchObject({ letter: null, age: 3 });
    expect(byKey(["a", "b", "c", "d", "e"])).toMatchObject({
      letter: "S",
      age: 10,
    });
    expect(byKey(["a"])).toMatchObject({ age: null });

    expect(view.times).toBe("ages");
    expect(view.unit).toBe("Ma");
    expect(view.points).toHaveLength(3);
    expect(view.marks).toEqual([]);
    expect(view.traits).toEqual([]);
  });

  it("reports times \"none\" and a null unit without times", () => {
    const r = engine.readingTree(polySet, "poly");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.times).toBe("none");
      expect(r.value.unit).toBeNull();
      expect(r.value.nodes.length).toBe(6); // 4 tips + polytomy + root
    }
  });

  it("an unknown tree name is an InvalidReading value", () => {
    const r = engine.readingTree(set, "nosuch");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidReading");
    }
  });
});
