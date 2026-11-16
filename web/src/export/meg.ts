// `.meg` export (v1.4b plan Task 11, spec §6.3): a lazy chunk fetched
// by the Export menu item, like the other writers. The engine does
// the writing (science lives in Rust); this module only forwards and
// reports which labels contained whitespace, so the menu can show the
// rename notice — MEGA names can't contain whitespace, so write_meg
// writes each whitespace character as "_".

import { engine } from "../engine/index";
import type { Alignment } from "../engine/generated/Alignment";
import type { DistanceInput } from "../engine/generated/DistanceInput";
import type { NeoError } from "../engine/generated/NeoError";

export interface MegExport {
  text: string;
  /** `[original, written]` pairs for labels containing whitespace —
   * the engine writes them with underscores. */
  renamed: [string, string][];
}

export function megAlignment(
  a: Alignment,
  title: string,
): { ok: true; value: MegExport } | { ok: false; error: NeoError } {
  const r = engine.writeMeg(a, title);
  if (!r.ok) return { ok: false, error: r.error };
  const renamed: [string, string][] = a.labels
    .filter((l) => /\s/.test(l))
    .map((l) => [l, l.replace(/\s/g, "_")]);
  return { ok: true, value: { text: r.value, renamed } };
}

/** A distance matrix as .meg text (v1.4c Task 8, spec §6.3): the
 * engine writes it (names with whitespace become "_"), this wrapper
 * only reports the renames for the menu notice. */
export function megMatrix(
  input: DistanceInput,
  title: string,
): { ok: true; value: MegExport } | { ok: false; error: NeoError } {
  const r = engine.writeMegMatrix(input, title);
  if (!r.ok) return { ok: false, error: r.error };
  const renamed: [string, string][] = input.names
    .filter((l) => /\s/.test(l))
    .map((l) => [l, l.replace(/\s/g, "_")]);
  return { ok: true, value: { text: r.value, renamed } };
}
