// errorMessage maps every NeoError variant to a verbatim plan title plus
// a body naming the specific values and one fix (plan Task 20). The
// function is exhaustive via a `never` check, so this table also serves
// as the variant list: adding a NeoError case without handling it breaks
// compilation, not just a test.

import { describe, expect, it } from "vitest";

import type { NeoError } from "../engine/generated/NeoError";
import { errorMessage } from "./errors";

const VARIANTS: NeoError[] = [
  { kind: "Parse", line: 3, col: 12, msg: "expected ';'" },
  { kind: "UnequalLengths", label: "b", expected: 8, got: 5 },
  { kind: "UnsupportedCharacter", label: "a", position: 4, ch: "!" },
  { kind: "InsufficientOverlap", a: "x", b: "y" },
  { kind: "TooManyTaxa", max: 200, got: 201 },
  { kind: "TooFewTaxa", min: 3, got: 2 },
  { kind: "SaturatedMatrix", cells: [[0, 1]] },
  { kind: "LabelMismatch", only_in_a: ["A", "B"], only_in_b: ["Z"] },
  { kind: "InvalidExercise", field: "true_tree", msg: "branch length missing" },
];

const TITLES: Record<NeoError["kind"], string> = {
  Parse: "Couldn't read line 3",
  UnequalLengths: "Sequences aren't aligned",
  UnsupportedCharacter: "Unexpected character",
  InsufficientOverlap: "Two sequences share no comparable sites",
  TooManyTaxa: "Too many sequences",
  TooFewTaxa: "Need at least 3 sequences",
  SaturatedMatrix: "Some distances can't be estimated",
  LabelMismatch: "Tree and sequences have different names",
  InvalidExercise: "This exercise file has a problem",
};

describe("errorMessage", () => {
  it("gives a non-empty title and body for every NeoError variant", () => {
    for (const e of VARIANTS) {
      const m = errorMessage(e);
      expect(m.title.length).toBeGreaterThan(0);
      expect(m.body.length).toBeGreaterThan(0);
    }
  });

  it("uses the plan's verbatim titles (Parse interpolates the line)", () => {
    for (const e of VARIANTS) {
      expect(errorMessage(e).title).toBe(TITLES[e.kind]);
    }
  });

  it("names the specific values in the body", () => {
    expect(
      errorMessage({
        kind: "UnequalLengths",
        label: "b",
        expected: 8,
        got: 5,
      }).body,
    ).toContain("b");
    expect(
      errorMessage({
        kind: "UnsupportedCharacter",
        label: "a",
        position: 4,
        ch: "!",
      }).body,
    ).toContain("!");
    expect(
      errorMessage({ kind: "InsufficientOverlap", a: "x", b: "y" }).body,
    ).toContain("x");
    expect(
      errorMessage({ kind: "TooManyTaxa", max: 200, got: 201 }).body,
    ).toContain("201");
    expect(
      errorMessage({
        kind: "LabelMismatch",
        only_in_a: ["A"],
        only_in_b: ["Z"],
      }).body,
    ).toContain("Z");
    expect(
      errorMessage({
        kind: "InvalidExercise",
        field: "true_tree",
        msg: "branch length missing",
      }).body,
    ).toContain("true_tree");
  });
});
