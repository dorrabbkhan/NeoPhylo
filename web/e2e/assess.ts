// Assignment e2e helpers (v1.5 plan Task 8): the `#a=` link wire
// format plus the wasm wrappers the flow specs verify codes and
// task keys with. The specs run in Node, so the engine binds like
// the vitest setup — `initSync` on the pkg's .wasm file — never
// through the browser. The link encoding is replicated here in the
// few lines that define it: `import.meta.glob` (the builtin-text
// registry in src/assess/url.ts) does not exist under the
// Playwright runner, so url.ts can't be imported.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import lzString from "lz-string";

const { compressToEncodedURIComponent } = lzString;

import { initSync } from "../src/engine/pkg/neophylo_wasm.js";
import { bindWasmExports, engine } from "../src/engine/index";
import type { CodePayload } from "../src/engine/generated/CodePayload";
import type { TaskRef } from "../src/engine/generated/TaskRef";
import type { Variant } from "../src/engine/generated/Variant";

let bound = false;

export function ensureEngine(): void {
  if (bound) return;
  const wasmPath = fileURLToPath(
    new URL("../src/engine/pkg/neophylo_wasm_bg.wasm", import.meta.url),
  );
  bindWasmExports(initSync({ module: readFileSync(wasmPath) }));
  bound = true;
}

/** A `#a=` link (path-relative) for an assignment file object —
 *  the same `{ v: 1, assignment }` envelope url.ts encodes. */
export function assignmentLink(assignment: unknown): string {
  return (
    "/#a=" +
    compressToEncodedURIComponent(
      JSON.stringify({ v: 1, assignment }),
    )
  );
}

/** The assignment-file JSON the engine wrappers consume — embedded
 *  content needs no `file` injection, so stringify is the whole
 *  resolve. */
export function makeVariantOrThrow(
  assignment: unknown,
  studentId: string,
): Variant {
  ensureEngine();
  const r = engine.makeVariant(JSON.stringify(assignment), studentId);
  if (!r.ok) throw new Error(`makeVariant failed: ${r.error.kind}`);
  return r.value;
}

/** Decode an NP1 code with the real engine decoder. */
export function decodeCodeOrThrow(text: string): CodePayload {
  ensureEngine();
  const r = engine.decodeCode(text);
  if (!r.ok) throw new Error(`decodeCode failed: ${r.error.kind}`);
  return r.value;
}

/** The engine's accepted numeric answer formatted at the display
 *  precision — the exact string the hidden quantity would read on
 *  screen. */
export function numericKeyText(variant: Variant, task: TaskRef): string {
  ensureEngine();
  const key = engine.taskKey(variant, task);
  if (!key.ok) throw new Error(`taskKey failed: ${key.error.kind}`);
  if (key.value.kind !== "number") {
    throw new Error("expected a numeric task key");
  }
  const prec = engine.precision();
  const decimals =
    prec.ok && task.kind === "numeric"
      ? (prec.value.find(([q]) => q === task.quantity)?.[1] ?? 3)
      : 3;
  return (key.value.value / 10 ** decimals).toFixed(decimals);
}
