// PHYLIP distance-matrix export (v1.1 plan Task 13, spec §3.2/§5.6).
// The text itself is produced by the engine's write_phylip_matrix; the
// wrapper only surfaces the notes the UI shows (Relaxed names, -1 cells).

import { describe, expect, it } from "vitest";

import type { DistanceMatrix } from "../engine/generated/DistanceMatrix";

import { phylipMatrix } from "./phylip";

const M: DistanceMatrix = {
  labels: ["Alpha", "Beta", "Gamma"],
  model: "Jtt",
  cells: [
    { Value: 0 },
    { Value: 0.1 },
    { Value: 0.2 },
    { Value: 0.1 },
    { Value: 0 },
    "Saturated",
    { Value: 0.2 },
    "Saturated",
    { Value: 0 },
  ],
};

describe("phylipMatrix", () => {
  it("produces neighbor input: n, padded names, 6-decimal values", () => {
    const { text, relaxed, saturated } = phylipMatrix(M);
    const lines = text.trimEnd().split("\n");
    expect(lines[0].trim()).toBe("3");
    expect(lines[1]).toMatch(/^Alpha {5}/);
    expect(lines[1]).toContain("0.000000");
    expect(lines[1]).toContain("0.100000");
    // Saturated cells are written as -1.000000 (PHYLIP convention).
    expect(lines[2]).toContain("-1.000000");
    expect(relaxed).toBe(false);
    expect(saturated).toBe(true);
  });

  it("reports relaxed=true when a name exceeds 10 characters", () => {
    const long: DistanceMatrix = {
      ...M,
      labels: ["Homo_sapiens", "Beta", "Gamma"],
    };
    const { text, relaxed } = phylipMatrix(long);
    expect(relaxed).toBe(true);
    // Relaxed rows are name + one space, not padded to 10.
    expect(text).toContain("Homo_sapiens ");
    expect(text.split("\n")[1]).toMatch(/^Homo_sapiens /);
  });
});
