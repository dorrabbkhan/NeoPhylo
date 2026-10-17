// Exercise schema tests (plan Task 21, spec §7): exercises/schema.json is
// a JSON Schema draft 2020-12 mirroring the engine's load_exercise
// checks — for schema_version 2 files only. The engine still accepts v1
// (old links), but repository lesson files must be v2. Every
// exercises/*.json must validate and declare schema_version 2, and the
// schema and engine must agree — both accept or both reject — on the
// hand-made files in __fixtures__/ (Vitest runs with cwd = web/, so repo
// files are resolved relative to "..").

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

import { engine } from "../engine";
import { defaultLessonJson } from "./default";

const EXERCISES = resolve("..", "exercises");
const FIXTURES = resolve("src", "lessons", "__fixtures__");

const schema = JSON.parse(
  readFileSync(resolve(EXERCISES, "schema.json"), "utf8"),
) as Record<string, unknown>;
const validate = new Ajv2020({ allErrors: true }).compile(schema);

const lessonFiles = () =>
  readdirSync(EXERCISES)
    .filter((f) => f.endsWith(".json") && f !== "schema.json")
    .sort();

describe("exercises/schema.json", () => {
  it("every exercises/*.json declares schema_version 2", () => {
    for (const f of lessonFiles()) {
      const json = JSON.parse(readFileSync(resolve(EXERCISES, f), "utf8"));
      expect(json.schema_version, `${f} must be schema_version 2`).toBe(2);
    }
  });

  it("validates every exercises/*.json lesson file", () => {
    for (const f of lessonFiles()) {
      const json = JSON.parse(readFileSync(resolve(EXERCISES, f), "utf8"));
      expect(validate(json), `ajv errors in ${f}`).toBe(true);
    }
  });

  it("accepts the embedded default lesson", () => {
    expect(validate(JSON.parse(defaultLessonJson))).toBe(true);
    expect(engine.loadExercise(defaultLessonJson).ok).toBe(true);
  });

  it.each([
    "bad-version.json",
    "bad-method.json",
    "bad-length.json",
    "bad-kappa.json",
    "bad-prompt.json",
    "bad-missing.json",
    "odd-valid.json",
  ])("schema and load_exercise agree on %s", (file) => {
    const text = readFileSync(resolve(FIXTURES, file), "utf8");
    const schemaOk = validate(JSON.parse(text));
    const engineOk = engine.loadExercise(text).ok;
    expect(
      schemaOk,
      `ajv=${schemaOk} engine=${engineOk} for ${file}`,
    ).toBe(engineOk);
  });
});
