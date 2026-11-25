// The engine's `PRECISION` table agreement test (v1.5 spec §5.3,
// plan Task 6): the web formatters for Q-values, branch lengths and
// distances render at the decimals the engine's scoring table
// declares — a numeric task's accepted answer is `scaled(quantity,
// value)`. This test fails when the table and the formatters' output
// disagree, forcing the two back into sync.

import { describe, expect, it } from "vitest";

import { engine } from "../engine/index";
import { fmt } from "../explain/math";

describe("PRECISION", () => {
  it("exports every quantity's decimals", () => {
    const r = engine.precision();
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.length).toBeGreaterThan(0);
      for (const [quantity, decimals] of r.value) {
        expect(decimals, quantity).toBe(3);
      }
    }
  });

  it("the explanation formatter agrees with the table", () => {
    const r = engine.precision();
    if (!r.ok) throw new Error("precision refused");
    // fmt renders `toFixed(decimals)` with trailing zeros trimmed —
    // the same 3 decimals the Q-value/branch-length/distance cells
    // (PairPanel `.toFixed(3)`) show.
    const decimals = Math.max(...r.value.map(([, d]) => d));
    expect(fmt(0.1234567)).toBe(
      (0.1234567).toFixed(decimals).replace(/\.?0+$/, ""),
    );
    expect(fmt(31)).toBe("31");
  });
});
