// Exercise schema v4 tests (v1.4b plan Task 6, spec §4): the v4
// identifiers — analysis.site_filter and the "Poisson" correction —
// are valid only with schema_version 4. For every fixture in
// __fixtures__/ the JSON schema and engine.loadExercise must agree
// (both accept or both refuse), except where a rule is a semantic
// check the schema cannot express (model/alphabet compatibility).

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

// The field each refusal must name (the engine's InvalidExercise
// field), mirroring the paths schema.json's siteFilter def reports.
const REFUSAL_FIELDS: Record<string, string> = {
  "v4-bad-site-filter-null.json": "analysis.site_filter",
  "v4-bad-site-filter-array.json": "analysis.site_filter",
  "v4-bad-site-filter-string.json": "analysis.site_filter",
  "v4-bad-kind.json": "analysis.site_filter.kind",
  "v4-bad-kind-missing.json": "analysis.site_filter.kind",
  "v4-bad-partial-no-cutoff.json": "analysis.site_filter.cutoff_pct",
  "v4-bad-cutoff-101.json": "analysis.site_filter.cutoff_pct",
  "v4-bad-cutoff-neg.json": "analysis.site_filter.cutoff_pct",
  "v4-bad-cutoff-float.json": "analysis.site_filter.cutoff_pct",
  "v4-bad-cutoff-string.json": "analysis.site_filter.cutoff_pct",
  "v4-bad-cutoff-null.json": "analysis.site_filter.cutoff_pct",
  "v4-bad-cutoff-array.json": "analysis.site_filter.cutoff_pct",
  "v4-bad-cutoff-on-complete.json": "analysis.site_filter.cutoff_pct",
  "v4-bad-cutoff-on-pairwise.json": "analysis.site_filter.cutoff_pct",
  "v3-bad-site-filter.json": "analysis.site_filter",
  "v3-bad-site-filter-null.json": "analysis.site_filter",
  "v3-bad-poisson.json": "analysis.correction",
};

describe("exercises/schema.json schema v4", () => {
  it.each([
    "v4-partial-95-valid.json",
    "v4-complete-valid.json",
    "v4-pairwise-valid.json",
    "v4-poisson-valid.json",
    ...Object.keys(REFUSAL_FIELDS),
  ])("schema and load_exercise agree on %s", (file) => {
    const text = readFileSync(resolve(FIXTURES, file), "utf8");
    const schemaOk = validate(JSON.parse(text));
    const r = engine.loadExercise(text);
    expect(
      schemaOk,
      `ajv=${schemaOk} engine=${r.ok} for ${file}`,
    ).toBe(r.ok);
  });

  it.each(Object.entries(REFUSAL_FIELDS))(
    "%s is refused at %s",
    (file, field) => {
      const text = readFileSync(resolve(FIXTURES, file), "utf8");
      const r = engine.loadExercise(text);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.error.kind).toBe("InvalidExercise");
        if (r.error.kind === "InvalidExercise") {
          expect(r.error.field).toBe(field);
        }
      }
    },
  );

  it("schema accepts Poisson on DNA; the engine refuses the alphabet mismatch", () => {
    // Model/alphabet compatibility is a semantic check the schema
    // cannot express — exercises/schema.json only constrains the shape
    // (the same rule "Kimura" and "JTT" get on DNA).
    const text = readFileSync(
      resolve(FIXTURES, "v4-bad-poisson-dna.json"),
      "utf8",
    );
    expect(validate(JSON.parse(text))).toBe(true);
    const r = engine.loadExercise(text);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("ModelAlphabetMismatch");
    }
  });
});
