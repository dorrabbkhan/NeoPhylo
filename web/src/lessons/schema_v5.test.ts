// Exercise schema v5 tests (v1.4c plan Task 5, spec §4): the v5
// identifiers — data.kind "matrix" and the optional `meta` block —
// are valid only with schema_version 5. On a matrix exercise the
// analysis holds `method` only: correction (any spelling, even a
// null key), kappa, site_filter, a top-level bootstrap and
// predict_branch prompts are refused. For every fixture in
// __fixtures__/ the JSON schema and engine.loadExercise must agree
// (both accept or both refuse), except where a rule is a semantic
// check the schema cannot express (lower's length against n(n−1)/2,
// name uniqueness, reference-label matching).

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
// field), mirroring the paths schema.json reports.
const REFUSAL_FIELDS: Record<string, string> = {
  "v5-matrix-correction.json": "analysis.correction",
  "v5-matrix-correction-supplied.json": "analysis.correction",
  "v5-matrix-correction-null.json": "analysis.correction",
  "v5-matrix-kappa.json": "analysis.kappa",
  "v5-matrix-site-filter.json": "analysis.site_filter",
  "v5-matrix-bootstrap.json": "bootstrap",
  "v5-matrix-bootstrap-null.json": "bootstrap",
  "v5-matrix-predict-branch.json": "prompts.0.type",
  "v4-matrix-kind.json": "data.kind",
  "v5-matrix-neg-lower.json": "data.lower",
  "v5-matrix-null-lower.json": "data.lower",
  "v5-matrix-lower-elem-null.json": "data.lower",
  "v5-matrix-lower-object.json": "data.lower",
  "v5-matrix-names-two.json": "data.names",
  "v5-matrix-names-empty.json": "data.names",
  "v5-meta-null.json": "meta",
  "v5-meta-array.json": "meta",
  "v5-meta-objectives-null.json": "meta.objectives",
  "v5-meta-objectives-string.json": "meta.objectives",
  "v5-meta-objectives-nonstring.json": "meta.objectives",
  "v5-meta-prepares-for-null.json": "meta.prepares_for",
  "v5-meta-prepares-for-string.json": "meta.prepares_for",
  "v5-meta-minutes-zero.json": "meta.minutes",
  "v5-meta-minutes-float.json": "meta.minutes",
  "v5-meta-minutes-5e9.json": "meta.minutes",
  "v5-meta-level-expert.json": "meta.level",
  "v5-meta-hand-steps-zero.json": "meta.hand_steps",
  "v5-meta-no-level.json": "meta.level",
  "v4-meta.json": "meta",
  "v4-meta-null.json": "meta",
  "v5-nonsim-supplied.json": "analysis.correction",
};

describe("exercises/schema.json schema v5", () => {
  it.each([
    "v5-matrix-valid.json",
    "v5-matrix-meta-valid.json",
    "v5-meta-valid.json",
    "v5-meta-unknown-ids-valid.json",
    // Integral floats are integers to ajv AND the engine (fix round 1).
    "v5-meta-minutes-5-0.json",
    "v5-meta-minutes-4e3.json",
    "v5-meta-hand-steps-2-0.json",
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

  it.each([
    // lowers length must equal n(n−1)/2 — a cross-field check the
    // schema cannot express.
    ["v5-matrix-lower-short.json"],
    // Name uniqueness is a semantic check, like reveal_pair labels.
    ["v5-matrix-dup-names.json"],
    // A matrix exercise MAY carry a reference; its labels must match
    // names — checked by the engine, not the schema.
    ["v5-matrix-bad-reference.json"],
  ])("schema accepts %s; the engine refuses it", (file) => {
    const text = readFileSync(resolve(FIXTURES, file), "utf8");
    expect(validate(JSON.parse(text))).toBe(true);
    const r = engine.loadExercise(text);
    expect(r.ok).toBe(false);
  });

  it("a loaded matrix exercise carries correction Supplied", () => {
    const text = readFileSync(
      resolve(FIXTURES, "v5-matrix-valid.json"),
      "utf8",
    );
    const r = engine.loadExercise(text);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.analysis.correction).toBe("Supplied");
      expect(r.value.data.kind).toBe("matrix");
    }
  });
});
