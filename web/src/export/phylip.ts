// PHYLIP distance-matrix export (v1.1 plan Task 13, spec §3.2/§5.6).
// The file text comes from engine.write_phylip_matrix with Auto names;
// this wrapper only derives the UI notes: whether Auto fell back to
// Relaxed names, and whether any cell is saturated (written -1.000000,
// PHYLIP's "infinite distance" convention, §3.2).

import { engine } from "../engine/index";
import type { DistanceMatrix } from "../engine/generated/DistanceMatrix";

export interface PhylipMatrixResult {
  /** `neighbor` input text (first line n, then one row per taxon). */
  text: string;
  /** True when a name exceeded 10 characters so Auto used Relaxed. */
  relaxed: boolean;
  /** True when at least one cell is saturated and was written -1.000000. */
  saturated: boolean;
}

/**
 * Serialize the current distance matrix as `neighbor` input. Throws a
 * plain Error on engine failure — the matrix comes from the session, so
 * a failure is a caller bug rather than user input.
 */
export function phylipMatrix(m: DistanceMatrix): PhylipMatrixResult {
  const r = engine.writePhylipMatrix(m, "Auto");
  if (!r.ok) {
    throw new Error(`write_phylip_matrix failed: ${r.error.kind}`);
  }
  return {
    text: r.value,
    // Auto is Strict iff every name fits in 10 characters (spec §3.2).
    relaxed: m.labels.some((label) => label.length > 10),
    saturated: m.cells.some((cell) => cell === "Saturated"),
  };
}
