// Exercise schema v3 tests (v1.4 plan Task 6, spec §4): the v3
// identifiers — analysis.kappa, the F84 and K2P_PHYLIP corrections,
// sim.model "F84" and sim.base_freqs — are valid only with
// schema_version 3. For every fixture in __fixtures__/ the JSON schema
// and engine.loadExercise must agree (both accept or both refuse),
// except where a rule is a semantic check the schema cannot express.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { engine } from "../engine";

const EXERCISES = resolve("..", "exercises");
const FIXTURES = resolve("src", "lessons", "__fixtures__");

const schema = JSON.parse(
  readFileSync(resolve(EXERCISES, "schema.json"), "utf8"),
) as Record<string, unknown>;
const validate = new Ajv2020({ allErrors: true }).compile(schema);

describe("exercises/schema.json schema v3", () => {
  it.each([
    "v3-k2p-valid.json",
    "v3-k2p-no-kappa.json",
    "v3-f84-sim-valid.json",
    "v3-bad-kappa-zero.json",
    "v3-bad-kappa-on-jc69.json",
    "v3-bad-basefreqs-zero.json",
    "v2-bad-f84.json",
    "v2-bad-kappa-null.json",
    "v3-bad-basefreqs-null.json",
    "v3-bad-basefreqs-array.json",
  ])("schema and load_exercise agree on %s", (file) => {
    const text = readFileSync(resolve(FIXTURES, file), "utf8");
    const schemaOk = validate(JSON.parse(text));
    const r = engine.loadExercise(text);
    expect(
      schemaOk,
      `ajv=${schemaOk} engine=${r.ok} for ${file}`,
    ).toBe(r.ok);
  });

  it("schema accepts base_freqs summing to 0.9; the engine refuses", () => {
    // The sum-to-1 rule is a semantic check the JSON schema cannot
    // express — exercises/schema.json only constrains the shape.
    const text = readFileSync(
      resolve(FIXTURES, "v3-bad-basefreqs-sum.json"),
      "utf8",
    );
    expect(validate(JSON.parse(text))).toBe(true);
    const r = engine.loadExercise(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("InvalidExercise");
      if (r.error.kind === "InvalidExercise") {
        expect(r.error.field).toBe("sim.base_freqs");
      }
    }
  });
});
