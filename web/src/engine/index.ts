// Thin wrapper over the wasm-bindgen module in `pkg/` (spec §5, plan
// Task 13). There is no engine logic here: every method forwards to the
// bindings and casts the `WasmResult` envelope to `Result<T>`. Errors are
// values — nothing in this module throws on a `NeoError`.

import init, {
  additive_matrix,
  bootstrap_batch,
  bootstrap_batch_filtered,
  build_tree,
  check_task,
  compare,
  compatible_names,
  consensus,
  consensus_dropped,
  content_hash,
  decode_code,
  detect_alphabet,
  detect_matrix_format,
  distances,
  distances_filtered,
  edit_add_leaf,
  edit_detach,
  edit_join,
  edit_move_subtree,
  edit_rename_leaf,
  edit_set_length,
  edit_validate,
  encode_code,
  grade,
  jtt_pair_detail,
  jtt_pair_detail_filtered,
  labels_need_quotes,
  load_assignment,
  load_exercise,
  load_reading_set,
  make_variant,
  matrix_to_distances,
  max_code_len,
  merge_tallies,
  parse_fasta,
  parse_meg,
  parse_meg_matrix,
  parse_newick,
  parse_pasted_matrix,
  parse_phylip,
  parse_phylip_matrix,
  precision,
  prose_names_taxa,
  reading_answer,
  reading_check,
  reading_clade_of,
  reading_tree,
  reading_variant,
  reference_outgroup,
  replicate_detail,
  replicate_detail_filtered,
  reroot_on_outgroup,
  simulate,
  site_mask,
  support_on_tree,
  task_key,
  validate_matrix,
  with_alphabet,
  worksheet_facts,
  write_meg,
  write_meg_matrix,
  write_newick,
  write_newick_compatible,
  write_newick_with_support,
  write_phylip_matrix,
} from "./pkg/neophylo_wasm.js";

import type { AcceptedAnswer } from "./generated/AcceptedAnswer";
import type { Alignment } from "./generated/Alignment";
import type { Alphabet } from "./generated/Alphabet";
import type { AnswerKey } from "./generated/AnswerKey";
import type { Assignment } from "./generated/Assignment";
import type { BootstrapTally } from "./generated/BootstrapTally";
import type { BuildOptions } from "./generated/BuildOptions";
import type { BuildResult } from "./generated/BuildResult";
import type { CodePayload } from "./generated/CodePayload";
import type { ConsensusKind } from "./generated/ConsensusKind";
import type { DistanceInput } from "./generated/DistanceInput";
import type { DistanceMatrix } from "./generated/DistanceMatrix";
import type { DistModel } from "./generated/DistModel";
import type { DroppedGroup } from "./generated/DroppedGroup";
import type { EncodeAttempt } from "./generated/EncodeAttempt";
import type { Exercise } from "./generated/Exercise";
import type { GradeResult } from "./generated/GradeResult";
import type { JoinFacts } from "./generated/JoinFacts";
import type { MatrixFile } from "./generated/MatrixFile";
import type { MatrixFormat } from "./generated/MatrixFormat";
import type { MegFile } from "./generated/MegFile";
import type { Method } from "./generated/Method";
import type { NameMode } from "./generated/NameMode";
import type { NeoError } from "./generated/NeoError";
import type { NodeId } from "./generated/NodeId";
import type { PairDetail } from "./generated/PairDetail";
import type { PasteOptions } from "./generated/PasteOptions";
import type { PhylipMatrixOptions } from "./generated/PhylipMatrixOptions";
import type { PhylipParseResult } from "./generated/PhylipParseResult";
import type { Quantity } from "./generated/Quantity";
import type { ReadingSet } from "./generated/ReadingSet";
import type { ReadingTreeView } from "./generated/ReadingTreeView";
import type { ReplicateDetail } from "./generated/ReplicateDetail";
import type { Response } from "./generated/Response";
import type { RerootResult } from "./generated/RerootResult";
import type { RfResult } from "./generated/RfResult";
import type { Rule } from "./generated/Rule";
import type { SimSpec } from "./generated/SimSpec";
import type { SiteFilter } from "./generated/SiteFilter";
import type { SiteMask } from "./generated/SiteMask";
import type { TaskAnswer } from "./generated/TaskAnswer";
import type { TaskRef } from "./generated/TaskRef";
import type { Tree } from "./generated/Tree";
import type { Variant } from "./generated/Variant";
import type { Verdict } from "./generated/Verdict";

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
  /** Pairwise distances under a site filter (v1.4b spec §3.1);
   * `{ kind: "pairwise" }` is exactly `distances`. */
  distancesFiltered(
    a: Alignment,
    m: DistModel,
    filter: SiteFilter,
  ): Result<DistanceMatrix> {
    return distances_filtered(a, m, filter);
  },
  /** The column weights and removed indices a site filter leaves
   * (v1.4b spec §3.1) — the pair panel's markup source. */
  siteMask(a: Alignment, filter: SiteFilter): Result<SiteMask> {
    return site_mask(a, filter);
  },
  /** Parse `.meg` text into the alignment plus title and notices
   * (v1.4b spec §3.4). Distance-matrix files are refused. */
  parseMeg(text: string): Result<MegFile> {
    return parse_meg(text);
  },
  /** Serialize an `Alignment` as `.meg` text (v1.4b spec §3.4). */
  writeMeg(a: Alignment, title: string): Result<string> {
    return write_meg(a, title);
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
  /** `jttPairDetail` under a site filter (v1.4b spec §3.1, §6.2);
   * `{ kind: "pairwise" }` is bit-identical to `jttPairDetail`. */
  jttPairDetailFiltered(
    a: Alignment,
    i: number,
    j: number,
    filter: SiteFilter,
  ): Result<PairDetail> {
    return jtt_pair_detail_filtered(a, i, j, filter);
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
  /** `bootstrapBatch` under a site filter (v1.4b spec §3.2);
   * `{ kind: "pairwise" }` is bit-identical to `bootstrapBatch`. */
  bootstrapBatchFiltered(
    a: Alignment,
    m: DistModel,
    method: Method,
    filter: SiteFilter,
    seed: number,
    start: number,
    count: number,
  ): Result<BootstrapTally> {
    return bootstrap_batch_filtered(a, m, method, filter, seed, start, count);
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
  /** `replicateDetail` under a site filter (v1.4b spec §3.2);
   * `{ kind: "pairwise" }` is bit-identical to `replicateDetail`. */
  replicateDetailFiltered(
    a: Alignment,
    m: DistModel,
    method: Method,
    filter: SiteFilter,
    seed: number,
    i: number,
  ): Result<ReplicateDetail> {
    return replicate_detail_filtered(a, m, method, filter, seed, i);
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
  /** Join component roots `a` and `b` under a new internal node;
   * `lengths` is `[lenToA, lenToB]`. Returns the edited tree (v1.4 spec
   * §5.1). */
  editJoin(
    t: Tree,
    a: NodeId,
    b: NodeId,
    lengths: [number, number],
  ): Result<Tree> {
    return edit_join(t, a, b, lengths);
  },
  /** Detach `node`'s subtree from its parent (v1.4 spec §5.1). */
  editDetach(t: Tree, node: NodeId): Result<Tree> {
    return edit_detach(t, node);
  },
  /** SPR: move `node` onto the edge above `newParentEdge`; `lengths` is
   * `[splitPosition, lenToNode]` (v1.4 spec §5.1). */
  editMoveSubtree(
    t: Tree,
    node: NodeId,
    newParentEdge: NodeId,
    lengths: [number, number],
  ): Result<Tree> {
    return edit_move_subtree(t, node, newParentEdge, lengths);
  },
  /** Set the length of the edge above `child` (v1.4 spec §5.1). */
  editSetLength(t: Tree, child: NodeId, length: number): Result<Tree> {
    return edit_set_length(t, child, length);
  },
  /** Rename a leaf; duplicates and empty names are refused (v1.4 spec
   * §5.1). */
  editRenameLeaf(t: Tree, leaf: NodeId, name: string): Result<Tree> {
    return edit_rename_leaf(t, leaf, name);
  },
  /** Create a new parentless leaf labelled `name` — a detached
   * component `editJoin`/`editMoveSubtree` can graft (v1.4 Task 9a).
   * Same name rules as `editRenameLeaf`. */
  editAddLeaf(t: Tree, name: string): Result<Tree> {
    return edit_add_leaf(t, name);
  },
  /** True when the root component is a saveable exercise tree (v1.4
   * spec §5.1; engine `edit::validate_editable`). */
  editValidate(t: Tree): Result<void> {
    return edit_validate(t);
  },
  // --- v1.4c matrix + worksheet wrappers (v1.4c spec §5, §7.2) -------
  /** Validate a typed/pasted matrix and get the `DistanceMatrix` the
   * algorithms consume (`Supplied` model). */
  matrixToDistances(input: DistanceInput): Result<DistanceMatrix> {
    return matrix_to_distances(input);
  },
  /** Structural validation only — `ok` carries the verdict. */
  validateMatrix(input: DistanceInput): Result<void> {
    return validate_matrix(input);
  },
  /** Which matrix file format the text looks like, or null. */
  detectMatrixFormat(text: string): Result<MatrixFormat | null> {
    return detect_matrix_format(text);
  },
  /** Parse a PHYLIP distance file (`neighbor` layout). */
  parsePhylipMatrix(
    text: string,
    opts: PhylipMatrixOptions,
  ): Result<MatrixFile> {
    return parse_phylip_matrix(text, opts);
  },
  /** Parse a `.meg` distance file (MEGA's `DataType=Distance`). */
  parseMegMatrix(text: string): Result<MatrixFile> {
    return parse_meg_matrix(text);
  },
  /** Parse a pasted table; unset option fields are asked as
   * `MatrixAmbiguous` instead of guessed. */
  parsePastedMatrix(text: string, opts: PasteOptions): Result<MatrixFile> {
    return parse_pasted_matrix(text, opts);
  },
  /** Serialize a supplied matrix as `.meg` distance text. */
  writeMegMatrix(input: DistanceInput, title: string): Result<string> {
    return write_meg_matrix(input, title);
  },
  /** Patristic matrix of a drawn tree — the editor's "derive from
   * tree" route; `round` is an optional decimals count. */
  additiveMatrix(tree: Tree, round: number | null): Result<DistanceInput> {
    return additive_matrix(tree, round);
  },
  /** One `JoinFacts` per recorded join — row sums, ties and
   * closest-pair flags straight from the trace (v1.4c spec §7.2). */
  worksheetFacts(
    matrix: DistanceMatrix,
    method: Method,
  ): Result<JoinFacts[]> {
    return worksheet_facts(matrix, method);
  },
  // --- v1.4d reading wrappers (v1.4d spec §5, plan Task 5) -----------
  /** Parse and validate a reading-set file (`kind: "reading"`).
   * Every refusal is an `InvalidReading` naming the item and field. */
  loadReadingSet(json: string): Result<ReadingSet> {
    return load_reading_set(json);
  },
  /** The engine answer key of the set's item `item` (spec §5.3). */
  readingAnswer(set: ReadingSet, item: number): Result<AnswerKey> {
    return reading_answer(set, item);
  },
  /** Check a student response against the engine key (spec §5.3). */
  readingCheck(
    set: ReadingSet,
    item: number,
    response: Response,
  ): Result<Verdict> {
    return reading_check(set, item, response);
  },
  /** Apply seeded variant ops in order and return the new set
   * (spec §5.4); answers are recomputed on use, never copied. */
  readingVariant(
    set: ReadingSet,
    seed: number,
    ops: ("rotate" | "shuffle" | "relabel")[],
  ): Result<ReadingSet> {
    return reading_variant(set, seed, ops);
  },
  /** The clade key of the node with exactly these tips — resolves an
   * editor tap to the stable identifier (spec §4.2). */
  readingCladeOf(newick: string, tips: string[]): Result<string[]> {
    return reading_clade_of(newick, tips);
  },
  /** A stored tree resolved for layout — the input of every
   * `readingLayout` call (plan Tasks 5–6). */
  readingTree(set: ReadingSet, name: string): Result<ReadingTreeView> {
    return reading_tree(set, name);
  },
  // --- v1.5 assess wrappers (v1.5 spec §4–§5, plan Task 6) ------------
  //
  // `assignmentJson` is the resolved `.neophylo-assignment.json`
  // shape — a `builtin` reference carries the `file` text its
  // resolver injected — so `served_content_hash` is set on every
  // load and grading can flag `ContentChanged`.
  /** Parse and validate an assignment file; every refusal is an
   * `InvalidAssignment` naming the field. */
  loadAssignment(json: string): Result<Assignment> {
    return load_assignment(json);
  },
  /** The variant `studentId` works (spec §5.2). */
  makeVariant(assignmentJson: string, studentId: string): Result<Variant> {
    return make_variant(assignmentJson, studentId);
  },
  /** The accepted answer of `task` on `variant` (spec §5.3). */
  taskKey(variant: Variant, task: TaskRef): Result<AcceptedAnswer> {
    return task_key(variant, task);
  },
  /** Check a student answer against the engine key (spec §5.3). */
  checkTask(
    variant: Variant,
    task: TaskRef,
    answer: TaskAnswer,
  ): Result<boolean> {
    return check_task(variant, task, answer);
  },
  /** The `NP1-…` completion code Finish produces (spec §5.4): the
   * engine packs the TaskAnswers, normalises the id and stamps the
   * fingerprint — `attempts` is one entry per graded task in order. */
  encodeCode(
    assignmentJson: string,
    variant: Variant,
    studentId: string,
    attempts: EncodeAttempt[],
    finishedMin: number,
  ): Result<string> {
    return encode_code(
      assignmentJson,
      variant,
      studentId,
      attempts,
      finishedMin,
    );
  },
  /** Decode a completion code — `InvalidCode` names the refusal. */
  decodeCode(text: string): Result<CodePayload> {
    return decode_code(text);
  },
  /** Grade a code against the resolved assignment (spec §5.5). */
  grade(
    assignmentJson: string,
    lmsId: string | null,
    code: string,
    rule: Rule,
  ): Result<GradeResult> {
    return grade(assignmentJson, lmsId, code, rule);
  },
  /** The code's worst-case length (spec §5.4) — the builder refuses
   * anything past 250 chars. */
  maxCodeLen(assignmentJson: string): Result<number> {
    return max_code_len(assignmentJson);
  },
  /** The engine's display-precision table (spec §5.3):
   * `[quantity, decimals]` pairs the web formatters agree with. */
  precision(): Result<[Quantity, number][]> {
    return precision();
  },
  /** Per prompt index, the taxon names the exercise's student-facing
   * text mentions (owner decision 2026-11-25). */
  proseNamesTaxa(exercise: Exercise): Result<[number, string[]][]> {
    return prose_names_taxa(exercise);
  },
  /** The `fnv1a64` content hash of a file's exact bytes (spec §5.7). */
  contentHash(text: string): Result<string> {
    return content_hash(text);
  },
};
