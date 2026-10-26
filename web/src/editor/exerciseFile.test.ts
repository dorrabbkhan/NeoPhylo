// Exercise file tests (v1.4 plan Task 7, spec §5.4):
// - save validates against exercises/schema.json AND engine.loadExercise,
//   always writes schema_version 3 and never writes a null the schema
//   refuses;
// - import accepts a JSON file or a #x= link (the existing url.ts
//   decoder); schema 1, 2 and 3 equivalents give the same tree;
// - shareLink returns the full URL, { tooLong } over the limit (never a
//   truncated URL) and { error } when the exercise cannot be saved.

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import type { Exercise } from "../engine/generated/Exercise";

import {
  importExercise,
  saveExercise,
  shareLink,
  SHARE_LINK_MAX_LENGTH,
} from "./exerciseFile";

const EXERCISES = resolve("..", "exercises");
const V3_FIXTURES = resolve("src", "lessons", "__fixtures__");

const schema = JSON.parse(
  readFileSync(resolve(EXERCISES, "schema.json"), "utf8"),
) as Record<string, unknown>;
const validate = new Ajv2020({ allErrors: true }).compile(schema);

const exerciseFiles = () =>
  readdirSync(EXERCISES)
    .filter((f) => f.endsWith(".json") && f !== "schema.json")
    .sort();

function load(text: string): Exercise {
  const r = engine.loadExercise(text);
  if (!r.ok) throw new Error(`fixture must load: ${JSON.stringify(r.error)}`);
  return r.value;
}

describe("saveExercise", () => {
  it.each(exerciseFiles())("round-trips exercises/%s through schema 3", (f) => {
    const loaded = load(readFileSync(resolve(EXERCISES, f), "utf8"));
    const saved = saveExercise({ exercise: loaded });
    if (!("json" in saved)) {
      throw new Error(`saveExercise(${f}) failed: ${saved.error}`);
    }
    const parsed = JSON.parse(saved.json);
    expect(parsed.schema_version).toBe(3);
    expect(
      validate(parsed),
      `ajv errors for ${f}: ${JSON.stringify(validate.errors)}`,
    ).toBe(true);
    const reloaded = engine.loadExercise(saved.json);
    expect(reloaded.ok).toBe(true);
    if (reloaded.ok) {
      expect(reloaded.value).toEqual({ ...loaded, schema_version: 3 });
    }
  });

  it.each(["v3-k2p-valid.json", "v3-k2p-no-kappa.json", "v3-f84-sim-valid.json"])(
    "round-trips v3 fixture %s",
    (f) => {
      const loaded = load(readFileSync(resolve(V3_FIXTURES, f), "utf8"));
      const saved = saveExercise({ exercise: loaded });
      if (!("json" in saved)) {
        throw new Error(`saveExercise(${f}) failed: ${saved.error}`);
      }
      const parsed = JSON.parse(saved.json);
      expect(parsed.schema_version).toBe(3);
      expect(validate(parsed), JSON.stringify(validate.errors)).toBe(true);
      const reloaded = engine.loadExercise(saved.json);
      expect(reloaded.ok).toBe(true);
      if (reloaded.ok) expect(reloaded.value).toEqual(loaded);
    },
  );

  it("keeps the file's summary and other engine-ignored keys on import+save", () => {
    const text = readFileSync(resolve(EXERCISES, "nj-basics.json"), "utf8");
    const original = JSON.parse(text) as { summary: string };
    const state = importExercise(text);
    expect(state.ok).toBe(true);
    if (!state.ok) return;
    const saved = saveExercise(state.value);
    if (!("json" in saved)) throw new Error(saved.error);
    expect(JSON.parse(saved.json).summary).toBe(original.summary);
  });

  it("refuses an invalid file and names the first failing field (schema)", () => {
    const ex = load(
      readFileSync(resolve(EXERCISES, "nj-basics.json"), "utf8"),
    );
    if (ex.data.kind !== "simulated") throw new Error("expected simulated");
    const broken: Exercise = {
      ...ex,
      data: { ...ex.data, sim: { ...ex.data.sim, length: 5 } },
    };
    const saved = saveExercise({ exercise: broken });
    expect(saved).toHaveProperty("error");
    if ("error" in saved) expect(saved.error).toContain("sim.length");
  });

  it("refuses an invalid file and names the first failing field (engine)", () => {
    const ex = load(
      readFileSync(resolve(EXERCISES, "nj-basics.json"), "utf8"),
    );
    const broken: Exercise = {
      ...ex,
      reference: { newick: "(((", kind: "true" },
    };
    const saved = saveExercise({ exercise: broken });
    expect(saved).toHaveProperty("error");
    if ("error" in saved) expect(saved.error).toContain("reference.newick");
  });
});

describe("importExercise", () => {
  it("gives the same tree for equivalent schema 1, 2 and 3 files", () => {
    const v1 = JSON.stringify({
      schema_version: 1,
      id: "t",
      title: "t",
      true_tree: "(A:0.1,B:0.2,C:0.3);",
      sim: { model: "JC69", length: 100, seed: 1 },
      analysis: { correction: "JC69", method: "NJ" },
    });
    const body = {
      id: "t",
      title: "t",
      summary: "t",
      alphabet: "dna",
      data: {
        kind: "simulated",
        true_tree: "(A:0.1,B:0.2,C:0.3);",
        sim: { model: "JC69", length: 100, seed: 1 },
      },
      analysis: { correction: "JC69", method: "NJ" },
    };
    const v2 = JSON.stringify({ schema_version: 2, ...body });
    const v3 = JSON.stringify({ schema_version: 3, ...body });

    const states = [v1, v2, v3].map((text) => {
      const r = importExercise(text);
      expect(r.ok, `${text}: ${r.ok ? "" : JSON.stringify(r.error)}`).toBe(
        true,
      );
      if (!r.ok) throw new Error("unreachable");
      return r.value.exercise;
    });
    const trees = states.map((ex) => {
      if (ex.data.kind !== "simulated") throw new Error("expected simulated");
      const t = engine.parseNewick(ex.data.true_tree);
      if (!t.ok) throw new Error("true_tree must parse");
      return t.value;
    });
    expect(trees[1]).toEqual(trees[0]);
    expect(trees[2]).toEqual(trees[0]);
    expect(states[1].data).toEqual(states[0].data);
    expect(states[2].data).toEqual(states[0].data);
  });

  it("imports a v1 #x= link (fixture v1-urls.json, custom-k80)", () => {
    const fixtures = JSON.parse(
      readFileSync(
        resolve("src", "state", "__fixtures__", "v1-urls.json"),
        "utf8",
      ),
    ) as { cases: { name: string; url: string }[] };
    const url = fixtures.cases.find((c) => c.name === "custom-k80")?.url;
    expect(url).toBeDefined();
    const r = importExercise(url as string);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.exercise.data.kind).toBe("simulated");
      if (r.value.exercise.data.kind === "simulated") {
        expect(r.value.exercise.data.sim.model).toHaveProperty("K80");
      }
    }
  });

  it("imports a v2 #x= link (fixture v2-urls.json)", () => {
    const fixtures = JSON.parse(
      readFileSync(
        resolve("src", "state", "__fixtures__", "v2-urls.json"),
        "utf8",
      ),
    ) as { cases: { name: string; url: string }[] };
    const url = fixtures.cases.find((c) => c.url.includes("#x="))?.url;
    expect(url).toBeDefined();
    const r = importExercise(url as string);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.exercise.id).toBe("custom-seed-demo");
  });

  it.each([
    ["a ?lesson= link", "?lesson=nj-basics&s=0&m=concept"],
    ["#x= garbage", "#x=!!!"],
    ["empty #x=", "#x="],
    ["not a link or file", "hello world"],
    ["broken JSON", "{ not json"],
  ])("refuses %s with a readable error, never a throw", (_name, text) => {
    const r = importExercise(text);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidExercise");
  });
});

describe("shareLink", () => {
  const base = "https://neophylo.test/app";

  it.each(exerciseFiles())("produces a decodable link for exercises/%s", (f) => {
    const loaded = load(readFileSync(resolve(EXERCISES, f), "utf8"));
    const r = shareLink({ exercise: loaded }, base);
    expect(r).toHaveProperty("url");
    if (!("url" in r)) return;
    expect(r.url.startsWith(`${base}#x=`)).toBe(true);
    expect(r.url.length).toBeLessThanOrEqual(SHARE_LINK_MAX_LENGTH);
  });

  it("returns tooLong over the limit and never a truncated URL", () => {
    const ex = load(readFileSync(resolve(EXERCISES, "upgma-fails.json"), "utf8"));
    // Deterministic, poorly compressible padding (Math.random is banned).
    let pad = "";
    for (let i = 0; pad.length < SHARE_LINK_MAX_LENGTH; i++) {
      pad += i.toString(36) + "-";
    }
    const big: Exercise = { ...ex, title: ex.title + pad };
    const r = shareLink({ exercise: big }, base);
    expect(r).toEqual({ tooLong: true, maxLength: SHARE_LINK_MAX_LENGTH });
    expect(r).not.toHaveProperty("url");
  });

  it("accepts a link of exactly the limit", () => {
    const ex = load(readFileSync(resolve(EXERCISES, "upgma-fails.json"), "utf8"));
    const first = shareLink({ exercise: ex }, base);
    if (!("url" in first)) throw new Error("baseline link must be short");
    const padLen = SHARE_LINK_MAX_LENGTH - first.url.length;
    expect(padLen).toBeGreaterThan(0);
    const paddedBase = base + "x".repeat(padLen);
    const atLimit = shareLink({ exercise: ex }, paddedBase);
    expect(atLimit).toHaveProperty("url");
    if ("url" in atLimit) {
      expect(atLimit.url.length).toBe(SHARE_LINK_MAX_LENGTH);
    }
    const over = shareLink({ exercise: ex }, paddedBase + "x");
    expect(over).toEqual({ tooLong: true, maxLength: SHARE_LINK_MAX_LENGTH });
  });

  it("returns { error } when the exercise cannot be saved", () => {
    const ex = load(readFileSync(resolve(EXERCISES, "nj-basics.json"), "utf8"));
    if (ex.data.kind !== "simulated") throw new Error("expected simulated");
    const broken: Exercise = {
      ...ex,
      data: { ...ex.data, sim: { ...ex.data.sim, length: 5 } },
    };
    const r = shareLink({ exercise: broken }, base);
    expect(r).toHaveProperty("error");
    expect(r).not.toHaveProperty("url");
  });
});
