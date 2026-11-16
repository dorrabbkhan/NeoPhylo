// Worksheet builders (v1.4c plan Task 11, spec §7.2). Sheets and keys
// are generated — never written — so every number here is an engine
// value (trace, worksheetFacts, seeded bootstrap tally); TypeScript
// only formats and lays out, it never derives distances, Q, row sums
// or support counts.

import type { Alignment } from "../engine/generated/Alignment";
import type { BuildResult } from "../engine/generated/BuildResult";
import type { DistanceInput } from "../engine/generated/DistanceInput";
import type { DistanceMatrix } from "../engine/generated/DistanceMatrix";
import type { Exercise } from "../engine/generated/Exercise";
import type { ExerciseMeta } from "../engine/generated/ExerciseMeta";
import type { JoinFacts } from "../engine/generated/JoinFacts";
import type { Method } from "../engine/generated/Method";
import type { Trace } from "../engine/generated/Trace";
import type { Tree } from "../engine/generated/Tree";
import { engine, type Result } from "../engine/index";
import type { LabExercise } from "../labs/registry";
import { splitKeys } from "../layout/splitKeys";

import type {
  CompanionItem,
  CompanionKey,
  CompanionSheet,
  PaperKey,
  PaperSheet,
} from "./types";

/** The exercise a worksheet is for — a lab source unwraps to its
 * exercise. */
export function exerciseOf(src: Exercise | LabExercise): Exercise {
  return "exercise" in src ? src.exercise : src;
}

/** The exercise's alignment as shipped — null for matrix data. Mirrors
 * analysis.ts's embedded/simulated origins (no overrides: a worksheet
 * belongs to the exercise as written). */
export function exerciseAlignment(ex: Exercise): Result<Alignment> | null {
  if (ex.data.kind === "matrix") return null;
  if (ex.data.kind === "embedded") {
    const parsed = engine.parseFasta(ex.data.fasta);
    if (!parsed.ok) return parsed;
    return engine.withAlphabet(parsed.value, ex.alphabet);
  }
  const tree = engine.parseNewick(ex.data.true_tree);
  if (!tree.ok) return tree;
  return engine.simulate(tree.value, ex.data.sim);
}

/** The matrix a paper worksheet prints — the supplied input, or the
 * engine's computed distances converted back to a DistanceInput (spec
 * §7.2). Null when any cell saturated. */
export function exerciseDistanceInput(ex: Exercise): DistanceInput | null {
  if (ex.data.kind === "matrix") {
    return { names: [...ex.data.names], lower: [...ex.data.lower] };
  }
  const a = exerciseAlignment(ex);
  if (a === null || !a.ok) return null;
  const dist = engine.distancesFiltered(
    a.value,
    ex.analysis.correction,
    ex.analysis.site_filter ?? { kind: "pairwise" },
  );
  if (!dist.ok) return null;
  const m = dist.value;
  const n = m.labels.length;
  const lower: number[] = [];
  for (let i = 1; i < n; i += 1) {
    for (let j = 0; j < i; j += 1) {
      const c = m.cells[i * n + j];
      if (c === "Saturated") return null;
      lower.push(c.Value);
    }
  }
  return { names: [...m.labels], lower };
}

export interface WorksheetRun {
  matrix: DistanceMatrix;
  joins: JoinFacts[];
  build: BuildResult;
  /** The build trace; null when the engine produced none. */
  trace: Trace | null;
}

/** The engine run every worksheet kind shares: worksheetFacts plus a
 * traced build (the trace supplies each join's active cluster names,
 * distance matrix and Q matrix for the sheet blocks). */
export function worksheetRun(
  m: DistanceMatrix,
  method: Method,
): Result<WorksheetRun> {
  const joins = engine.worksheetFacts(m, method);
  if (!joins.ok) return joins;
  const build = engine.buildTree(m, method, { trace: true });
  if (!build.ok) return build;
  return {
    ok: true,
    value: {
      matrix: m,
      joins: joins.value,
      build: build.value,
      trace: build.value.trace,
    },
  };
}

/** How many joins the paper sheet asks the student to work by hand
 * (spec §7.2): all joins for n ≤ 6, the first two for 7–8;
 * meta.hand_steps wins, capped at the trace's join count. */
export function handSteps(
  n: number,
  joins: number,
  meta?: ExerciseMeta,
): number {
  const byDefault = n <= 6 ? joins : 2;
  return Math.min(meta?.hand_steps ?? byDefault, joins);
}

/** The paper worksheet model, or null when the exercise has too many
 * taxa (> 8) or no printable matrix (spec §7.2). */
export function paperSheet(
  src: Exercise | LabExercise,
  link: string,
): PaperSheet | null {
  const ex = exerciseOf(src);
  const input = exerciseDistanceInput(ex);
  if (input === null || input.names.length > 8) return null;
  const dm = engine.matrixToDistances(input);
  if (!dm.ok) return null;
  const run = worksheetRun(dm.value, ex.analysis.method);
  if (!run.ok) return null;
  const minutes =
    ("exercise" in src ? src.lab.minutes : undefined) ??
    ex.meta?.minutes ??
    null;
  return {
    title: ex.title,
    minutes,
    matrix: input,
    method: ex.analysis.method,
    handSteps: handSteps(input.names.length, run.value.joins.length, ex.meta),
    link,
  };
}

/** The in-app companion sheet — one item per prompt (predict_pair and
 * note items anchor their join step, predict_branch anchors the
 * bootstrap run), plus one item per chain entry for labs (spec §7.2). */
export function companionSheet(src: Exercise | LabExercise): CompanionSheet {
  const ex = exerciseOf(src);
  const items: CompanionItem[] = ex.prompts.map((p) => {
    if (p.type === "predict_pair") {
      return {
        step: p.at_step,
        question: `At step ${p.at_step}, which pair did you predict, and why?`,
      };
    }
    if (p.type === "predict_branch") {
      return {
        step: "bootstrap",
        question:
          "Before the bootstrap run, which internal branch did you predict would be least supported, and why?",
      };
    }
    return {
      step: p.at_step,
      question: `After step ${p.at_step}: write one sentence on what changed.`,
    };
  });
  if ("exercise" in src) {
    const mega = src.lab.tool === "mega";
    for (const entry of src.lab.chain) {
      items.push({
        step: "lab",
        question: mega
          ? `Follow “${entry}” in MEGA; record what it reports.`
          : `Run ${entry} in PHYLIP; record what it reports.`,
      });
    }
  }
  return { title: ex.title, items };
}

/** Display form of an engine pair: `a–b` (the en dash the app's reveal
 * text uses between two cluster names). */
function pairText(pair: [string, string]): string {
  return `${pair[0]}–${pair[1]}`;
}

/** The paper answer key: every value filled in plus one "common
 * mistake" line per join whose closest pair is not the joined pair
 * (spec §7.2). */
export function paperKey(
  sheet: PaperSheet,
  joins: JoinFacts[],
  tree: Tree,
): PaperKey {
  const mistakes = joins
    .filter((j) => !j.chosen_is_closest)
    .map(
      (j) =>
        `Join ${j.step}: picking ${j.closest.map(pairText).join(" or ")} ` +
        "because their distance is smallest.",
    );
  return { sheet, joins, mistakes, tree };
}

export interface BootstrapKeyFacts {
  replicates: number;
  seed: number;
  successful: number;
  /** The inferred tree's least-supported grouping and its count. */
  least: { grouping: string[]; count: number };
  /** Count of replicate trees per internal branch of the inferred
   * tree, in tree order. */
  supports: { grouping: string[]; count: number }[];
}

/** The seeded bootstrap run's values for a key — the exercise's own
 * bootstrap settings, or the app defaults (100 replicates, seed 1)
 * when it declares none. Null for matrix exercises and exercises with
 * no bootstrap content (no settings, no predict_branch prompt). */
export function bootstrapKeyFacts(
  ex: Exercise,
): Result<BootstrapKeyFacts | null> {
  const hasBootstrap =
    ex.bootstrap !== null ||
    ex.prompts.some((p) => p.type === "predict_branch");
  const a = exerciseAlignment(ex);
  if (a === null || !hasBootstrap) return { ok: true, value: null };
  if (!a.ok) return a;
  const replicates = ex.bootstrap?.replicates ?? 100;
  const seed = ex.bootstrap?.seed ?? 1;
  const tally = engine.bootstrapBatchFiltered(
    a.value,
    ex.analysis.correction,
    ex.analysis.method,
    ex.analysis.site_filter ?? { kind: "pairwise" },
    seed,
    0,
    replicates,
  );
  if (!tally.ok) return tally;
  const dm = engine.distancesFiltered(
    a.value,
    ex.analysis.correction,
    ex.analysis.site_filter ?? { kind: "pairwise" },
  );
  if (!dm.ok) return dm;
  const build = engine.buildTree(dm.value, ex.analysis.method, {
    trace: false,
  });
  if (!build.ok) return build;
  const tree = build.value.tree;
  const rooted = ex.analysis.method === "Upgma";
  const keys = splitKeys(tree, dm.value.labels, rooted);
  const counts = new Map(
    tally.value.counts.map((c) => [
      [...c.labels].sort().join("|"),
      c.count,
    ]),
  );
  const supports: { grouping: string[]; count: number }[] = [];
  for (const [id, key] of keys) {
    const node = tree.nodes[id];
    if (node.parent === null || node.children.length === 0) continue;
    supports.push({
      grouping: key.split("|"),
      count: counts.get(key) ?? 0,
    });
  }
  if (supports.length === 0) return { ok: true, value: null };
  let least = supports[0];
  for (const s of supports) {
    if (s.count < least.count) least = s;
  }
  return {
    ok: true,
    value: {
      replicates,
      seed,
      successful: tally.value.successful,
      least,
      supports,
    },
  };
}

export interface CompanionKeyContext {
  joins: JoinFacts[] | null;
  bootstrap: BootstrapKeyFacts | null;
}

/** The sampling-noise caption every seeded-run key carries (spec §7.2;
 * no tolerance wording — owner ruling on #126 pending). */
export const BOOTSTRAP_CAPTION =
  "Your numbers from MEGA or PHYLIP will differ by sampling noise.";

/** The companion answer key: predict_pair → the joined pair (every
 * tied pair when the join is tied), predict_branch → the seeded run's
 * least-supported grouping, bootstrap chain items → the seeded run's
 * support counts; writing prompts get null. */
export function companionKey(
  sheet: CompanionSheet,
  src: Exercise | LabExercise,
  ctx: CompanionKeyContext,
): CompanionKey {
  const ex = exerciseOf(src);
  const answers = sheet.items.map((item, i) => {
    if (item.step === "lab") {
      // Chain entries with no engine-checkable number stay writing
      // prompts; a resampling step of a bootstrap lab gets the seeded
      // run's support counts (conductor's call, Task 11 notes).
      if (
        ctx.bootstrap !== null &&
        /bootstrap|seqboot|consense/i.test(item.question)
      ) {
        const b = ctx.bootstrap;
        return (
          `Seeded run (${b.replicates} replicates, seed ${b.seed}): ` +
          b.supports
            .map((s) => `${s.grouping.join(", ")} — ${s.count}`)
            .join("; ") +
          "."
        );
      }
      return null;
    }
    const prompt = ex.prompts[i];
    if (prompt === undefined) return null;
    if (prompt.type === "predict_pair") {
      const join = ctx.joins?.find((j) => j.step === prompt.at_step);
      if (join === undefined) return null;
      if (join.tied.length > 1) {
        const same = join.tie_same_split
          ? " Either pair gives the same tree."
          : "";
        return (
          `${join.tied.map(pairText).join(" or ")} are tied. ` +
          `NeoPhylo joins ${pairText(join.chosen)}.${same}`
        );
      }
      return pairText(join.chosen);
    }
    if (prompt.type === "predict_branch") {
      const b = ctx.bootstrap;
      if (b === null) return null;
      return (
        `The least-supported grouping is ${b.least.grouping.join(", ")} — ` +
        `${b.least.count} of ${b.successful} replicate trees.`
      );
    }
    return null;
  });
  return {
    sheet,
    answers,
    caption: ctx.bootstrap === null ? null : BOOTSTRAP_CAPTION,
  };
}
