// Reading-set registry tests (v1.4d plan Task 8). Named behaviours:
// - `loadBuiltinReadingSet` resolves a shipped set by id through the
//   engine's loader (validation included);
// - `listReadingSets` returns summaries for the shipped sets but
//   never the demo set — `trees-demo` ships for dev/e2e yet stays
//   out of the library listing (owner decision, Task 8 notes).

import { describe, expect, it } from "vitest";

import { listReadingSets, loadBuiltinReadingSet } from "./registry";

describe("loadBuiltinReadingSet", () => {
  it("loads the shipped demo set", async () => {
    const r = await loadBuiltinReadingSet("trees-demo");
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.id).toBe("trees-demo");
      expect(r.value.items.length).toBeGreaterThan(0);
    }
  });

  it("refuses an unknown id with an InvalidReading error", async () => {
    const r = await loadBuiltinReadingSet("no-such-set");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe("InvalidReading");
  });
});

describe("listReadingSets", () => {
  it("excludes trees-demo but returns shipped sets", async () => {
    const sets = await listReadingSets();
    expect(sets.some((s) => s.id === "trees-demo")).toBe(false);
    for (const s of sets) {
      expect(s.id.length).toBeGreaterThan(0);
      expect(s.title.length).toBeGreaterThan(0);
    }
  });
});
