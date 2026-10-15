import { describe, expect, it } from "vitest";

import { engine } from "./index";

describe("engine wrapper", () => {
  it("parses FASTA text", () => {
    const r = engine.parseFasta(">a\nAC\n");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.labels).toEqual(["a"]);
    }
  });

  it("returns errors as values", () => {
    const r = engine.parseFasta("not fasta");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe("Parse");
    }
  });
});
