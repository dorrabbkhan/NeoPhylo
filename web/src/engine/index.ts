// Thin wrapper over the wasm-bindgen module in `pkg/` (spec §5, plan
// Task 13). There is no engine logic here: every method forwards to the
// bindings and casts the `WasmResult` envelope to `Result<T>`. Errors are
// values — nothing in this module throws on a `NeoError`.

import init, {
  build_tree,
  compare,
  distances,
  load_exercise,
  parse_fasta,
  parse_newick,
  simulate,
  write_newick,
} from "./pkg/neophylo_wasm.js";

import type { Alignment } from "./generated/Alignment";
import type { BuildOptions } from "./generated/BuildOptions";
import type { BuildResult } from "./generated/BuildResult";
import type { DistanceMatrix } from "./generated/DistanceMatrix";
import type { DistModel } from "./generated/DistModel";
import type { Exercise } from "./generated/Exercise";
import type { Method } from "./generated/Method";
import type { NeoError } from "./generated/NeoError";
import type { RfResult } from "./generated/RfResult";
import type { SimSpec } from "./generated/SimSpec";
import type { Trace } from "./generated/Trace";
import type { Tree } from "./generated/Tree";

export type Result<T> = { ok: true; value: T } | { ok: false; error: NeoError };

/**
 * Initialize the wasm module. Resolves the `.wasm` asset next to the
 * bundled JS via the bindings' default `import.meta.url` lookup.
 * Tests instead initialize once in `src/test/setup.ts` with `initSync`,
 * because Node cannot fetch `file:` URLs.
 */
export async function initEngine(): Promise<void> {
  await init();
}

export const engine = {
  parseFasta(text: string): Result<Alignment> {
    return parse_fasta(text);
  },
  parseNewick(text: string): Result<Tree> {
    return parse_newick(text);
  },
  /**
   * Serialize a `Tree` to Newick. The wasm call can only fail on a
   * malformed `Tree` argument — a caller bug rather than user input —
   * so the plan gives this a plain `string` return and we throw `Error`.
   */
  writeNewick(t: Tree): string {
    const r: Result<string> = write_newick(t);
    if (!r.ok) throw new Error(`write_newick failed: ${r.error.kind}`);
    return r.value;
  },
  distances(a: Alignment, m: DistModel): Result<DistanceMatrix> {
    return distances(a, m);
  },
  buildTree(
    m: DistanceMatrix,
    method: Method,
    opts: BuildOptions,
  ): Result<BuildResult> {
    const r: Result<BuildResult> = build_tree(m, method, opts);
    if (!r.ok) return r;
    // serde_wasm_bindgen encodes `None` as `undefined`, but the generated
    // type declares `trace: Trace | null`; normalize at the boundary.
    const trace = r.value.trace as Trace | null | undefined;
    return { ok: true, value: { ...r.value, trace: trace ?? null } };
  },
  compare(truth: Tree, inferred: Tree): Result<RfResult> {
    return compare(truth, inferred);
  },
  simulate(t: Tree, s: SimSpec): Result<Alignment> {
    return simulate(t, s);
  },
  loadExercise(json: string): Result<Exercise> {
    return load_exercise(json);
  },
};
