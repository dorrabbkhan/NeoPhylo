// Thin wrapper over the wasm-bindgen module in `pkg/` (spec §5, plan
// Task 13). There is no engine logic here: every method forwards to the
// bindings and casts the `WasmResult` envelope to `Result<T>`. Errors are
// values — nothing in this module throws on a `NeoError`.

import init, {
  bootstrap_batch,
  build_tree,
  compare,
  compatible_names,
  consensus,
  consensus_dropped,
  detect_alphabet,
  distances,
  jtt_pair_detail,
  labels_need_quotes,
  load_exercise,
  merge_tallies,
  parse_fasta,
  parse_newick,
  parse_phylip,
  reference_outgroup,
  replicate_detail,
  reroot_on_outgroup,
  simulate,
  support_on_tree,
  with_alphabet,
  write_newick,
  write_newick_compatible,
  write_newick_with_support,
  write_phylip_matrix,
} from "./pkg/neophylo_wasm.js";

import type { Alignment } from "./generated/Alignment";
import type { Alphabet } from "./generated/Alphabet";
import type { BootstrapTally } from "./generated/BootstrapTally";
import type { BuildOptions } from "./generated/BuildOptions";
import type { BuildResult } from "./generated/BuildResult";
import type { ConsensusKind } from "./generated/ConsensusKind";
import type { DistanceMatrix } from "./generated/DistanceMatrix";
import type { DistModel } from "./generated/DistModel";
import type { DroppedGroup } from "./generated/DroppedGroup";
import type { Exercise } from "./generated/Exercise";
import type { Method } from "./generated/Method";
import type { NameMode } from "./generated/NameMode";
import type { NeoError } from "./generated/NeoError";
import type { PairDetail } from "./generated/PairDetail";
import type { PhylipParseResult } from "./generated/PhylipParseResult";
import type { ReplicateDetail } from "./generated/ReplicateDetail";
import type { RerootResult } from "./generated/RerootResult";
import type { RfResult } from "./generated/RfResult";
import type { SimSpec } from "./generated/SimSpec";
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
  /**
   * Serialize a `Tree` to Newick with bootstrap support as internal
   * node labels — integer percent (v1.2 spec §6.8). Same error
   * contract as `writeNewick`.
   */
  writeNewickWithSupport(t: Tree): string {
    const r: Result<string> = write_newick_with_support(t);
    if (!r.ok) {
      throw new Error(`write_newick_with_support failed: ${r.error.kind}`);
    }
    return r.value;
  },
  /**
   * Serialize a `Tree` to Newick with tool-compatible names — chars
   * outside `[A-Za-z0-9._-]` become `_` (runs collapsed), collisions
   * get `_2`/`_3`, no quotes (fix/newick-compatible-names: quoted
   * labels break ape::read.tree, FigTree and iTOL). `support` selects
   * integer-% internal labels.
   */
  writeNewickCompatible(t: Tree, support: boolean): string {
    const r: Result<string> = write_newick_compatible(t, support);
    if (!r.ok) {
      throw new Error(`write_newick_compatible failed: ${r.error.kind}`);
    }
    return r.value;
  },
  /**
   * The (original, exported) renames a compatible Newick write
   * applies — empty when every label is already tool-safe. Feeds the
   * export's name-map CSV and note.
   */
  compatibleNames(t: Tree): [string, string][] {
    const r: Result<[string, string][]> = compatible_names(t);
    if (!r.ok) {
      throw new Error(`compatible_names failed: ${r.error.kind}`);
    }
    return r.value;
  },
  /**
   * True when a verbatim write would quote at least one label — the
   * export's default-name-mode signal.
   */
  labelsNeedQuotes(t: Tree): boolean {
    const r: Result<boolean> = labels_need_quotes(t);
    if (!r.ok) {
      throw new Error(`labels_need_quotes failed: ${r.error.kind}`);
    }
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
    return build_tree(m, method, opts);
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
  /** Parse PHYLIP text; `names` defaults to Auto (the mode used comes
   * back in `names_used`). */
  parsePhylip(text: string, names: NameMode = "Auto"): Result<PhylipParseResult> {
    return parse_phylip(text, names);
  },
  detectAlphabet(a: Alignment): Result<Alphabet> {
    return detect_alphabet(a);
  },
  withAlphabet(a: Alignment, alphabet: Alphabet): Result<Alignment> {
    return with_alphabet(a, alphabet);
  },
  jttPairDetail(a: Alignment, i: number, j: number): Result<PairDetail> {
    return jtt_pair_detail(a, i, j);
  },
  writePhylipMatrix(m: DistanceMatrix, names: NameMode = "Auto"): Result<string> {
    return write_phylip_matrix(m, names);
  },
  /** Run replicates `start..start+count` and tally their groupings
   * (v1.2 spec §3.3, §4). */
  bootstrapBatch(
    a: Alignment,
    m: DistModel,
    method: Method,
    seed: number,
    start: number,
    count: number,
  ): Result<BootstrapTally> {
    return bootstrap_batch(a, m, method, seed, start, count);
  },
  /** Merge two tallies over the same alignment, method and run
   * (v1.2 spec §3.3, §4). */
  mergeTallies(a: BootstrapTally, b: BootstrapTally): Result<BootstrapTally> {
    return merge_tallies(a, b);
  },
  /** Copy the tree with bootstrap support on internal branches
   * (v1.2 spec §3.4, §4). */
  supportOnTree(t: Tree, tally: BootstrapTally): Result<Tree> {
    return support_on_tree(t, tally);
  },
  /** The consensus tree of a tally under `kind` (v1.2 spec §3.5, §4).
   * `labels` must equal `tally.labels` (spec §4 signature; a mismatch
   * is a LabelMismatch error value). */
  consensus(
    tally: BootstrapTally,
    kind: ConsensusKind,
    labels: string[],
  ): Result<Tree> {
    return consensus(tally, kind, labels);
  },
  /** Original-tree groupings dropped by the `kind` consensus, with
   * their support (v1.2 spec §3.5, §4). */
  consensusDropped(
    original: Tree,
    tally: BootstrapTally,
    kind: ConsensusKind,
  ): Result<DroppedGroup[]> {
    return consensus_dropped(original, tally, kind);
  },
  /** The teaching detail of one replicate (v1.2 spec §3.6, §4). */
  replicateDetail(
    a: Alignment,
    m: DistModel,
    method: Method,
    seed: number,
    i: number,
  ): Result<ReplicateDetail> {
    return replicate_detail(a, m, method, seed, i);
  },
  /** The outgroup a rooted reference names (v1.2 spec §3.7, §4). */
  referenceOutgroup(reference: Tree): Result<string[]> {
    return reference_outgroup(reference);
  },
  /** Reroot an unrooted tree at the outgroup's split edge, for display
   * only (v1.2 spec §3.7, §4). */
  rerootOnOutgroup(tree: Tree, outgroup: string[]): Result<RerootResult> {
    return reroot_on_outgroup(tree, outgroup);
  },
};
