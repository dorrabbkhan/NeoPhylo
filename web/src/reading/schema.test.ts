// Reading-set schema tests (v1.4d plan Task 4, spec section 4):
// exercises/reading.schema.json mirrors the structural half of the
// engine's load_reading_set checks. The hand-made sets in
// crates/neophylo-core/tests/reading_inputs/ are the shared corpus: the
// Rust tests pin which files the engine accepts or refuses (and which
// item and field each refusal names); this test pins that the schema
// agrees on every structurally well-formed file — valid-* files are the
// ones the engine fully accepts, sem-* files carry semantic-only faults
// (unknown tips in clade keys, times out of order, tied order_nodes
// ages) that a JSON schema cannot express, and shape-* files are
// rejected by both. (Vitest runs with cwd = web/, so repo files resolve
// relative to "..".)

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";

import Ajv2020 from "ajv/dist/2020.js";
import { describe, expect, it } from "vitest";

const SCHEMA = resolve("..", "exercises", "reading.schema.json");
const INPUTS = resolve("..", "crates", "neophylo-core", "tests", "reading_inputs");

const schema = JSON.parse(readFileSync(SCHEMA, "utf8")) as Record<
  string,
  unknown
>;
const validate = new Ajv2020({ allErrors: true }).compile(schema);

const files = readdirSync(INPUTS)
  .filter((f) => f.endsWith(".json"))
  .sort();

describe("exercises/reading.schema.json", () => {
  it("has a shared corpus of valid-, sem- and shape- files", () => {
    expect(files.some((f) => f.startsWith("valid-"))).toBe(true);
    expect(files.some((f) => f.startsWith("sem-"))).toBe(true);
    expect(files.some((f) => f.startsWith("shape-"))).toBe(true);
  });

  it.each(files.filter((f) => !f.startsWith("shape-")))(
    "schema accepts structurally well-formed %s",
    (file) => {
      const json = JSON.parse(readFileSync(resolve(INPUTS, file), "utf8"));
      expect(validate(json), `ajv errors in ${file}`).toBe(true);
    },
  );

  it.each(files.filter((f) => f.startsWith("shape-")))(
    "schema rejects structurally broken %s",
    (file) => {
      const json = JSON.parse(readFileSync(resolve(INPUTS, file), "utf8"));
      expect(validate(json), `${file} should fail the schema`).toBe(false);
    },
  );
});
