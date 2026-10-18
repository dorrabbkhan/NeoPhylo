// Per-step emphasis across the tree and matrix views (spec §6.2: all
// panels stay in sync with step k, the chosen pair is emphasized in
// every view, and a hovered cell or leaf lights up its counterpart).
// Pure derivation from the session plus the prompt gate, extracted so
// App.tsx stays a wiring shell (same reason stepMatrix.ts exists).

import type { DistanceMatrix } from "../engine/generated/DistanceMatrix";
import type { RfResult } from "../engine/generated/RfResult";
import type { Trace } from "../engine/generated/Trace";
import type { Tree } from "../engine/generated/Tree";

import { stepsOf, traceLength } from "./stepMatrix";
import type { StepMatrix } from "./stepMatrix";

/** Map of every node id to the set of leaf labels under it. */
export function leafLabelSets(tree: Tree): Map<number, Set<string>> {
  const out = new Map<number, Set<string>>();
  const dfs = (id: number): Set<string> => {
    const cached = out.get(id);
    if (cached) return cached;
    const s = new Set<string>();
    const node = tree.nodes[id];
    if (node.children.length === 0 && node.label !== null) s.add(node.label);
    for (const c of node.children) for (const l of dfs(c)) s.add(l);
    out.set(id, s);
    return s;
  };
  dfs(tree.root);
  return out;
}

/** Leaf node ids by taxon label (labels are unique per alignment/tree). */
export function leafIdByLabel(tree: Tree): Map<string, number> {
  const out = new Map<string, number>();
  tree.nodes.forEach((n, id) => {
    if (n.children.length === 0 && n.label !== null) out.set(n.label, id);
  });
  return out;
}

export function leafCount(tree: Tree): number {
  return tree.nodes.reduce(
    (n, node) => n + (node.children.length === 0 ? 1 : 0),
    0,
  );
}

function sameSet<T>(a: ReadonlySet<T>, b: ReadonlySet<T>): boolean {
  if (a.size !== b.size) return false;
  for (const v of a) if (!b.has(v)) return false;
  return true;
}

const NO_LABELS: Set<string> = new Set();

export interface StepEmphasis {
  /** Node ids to highlight in the inferred tree. */
  inferHi: Set<number>;
  /** Node ids to highlight in the true tree. */
  trueHi: Set<number>;
  /** Internal node ids whose clade is absent from the true tree. */
  wrong: Set<number>;
  /** Nodes visible at this position; undefined renders the full tree. */
  visibleNodes: Set<number> | undefined;
  /** Matrix cell (or row/column axis) to highlight. */
  matrixHover: { i: number; j: number } | { axis: number } | null;
}

/**
 * Everything the views emphasize at stepper position `k`.
 *
 * `sm` is the real step matrix (hover resolves against its active
 * clusters); `smShown` is the prompt-gated copy whose `chosen` may be
 * cleared, so an unanswered predict_pair prompt marks nothing.
 */
export function stepEmphasis({
  trace,
  k,
  inferred,
  sm,
  smShown,
  inferSets,
  inferLeafByLabel,
  trueLeafByLabel,
  matrix,
  cellHover,
  hoverLeaf,
  leafPick,
  rf,
  taxa,
}: {
  trace: Trace | null;
  k: number;
  inferred: Tree | null;
  sm: StepMatrix | null;
  smShown: StepMatrix | null;
  inferSets: ReadonlyMap<number, ReadonlySet<string>>;
  inferLeafByLabel: ReadonlyMap<string, number>;
  trueLeafByLabel: ReadonlyMap<string, number>;
  /** The full distance matrix — used when there is no trace. */
  matrix: DistanceMatrix | null;
  cellHover: { i: number; j: number } | null;
  /** A hovered leaf label (trees → matrix row/column). */
  hoverLeaf: string | null;
  /** First leaf of an in-progress two-leaf prompt pick. */
  leafPick: string | null;
  rf: RfResult | null;
  /** Alignment taxon labels (RF complement sides); null without one. */
  taxa: string[] | null;
}): StepEmphasis {
  const inferHi = new Set<number>();
  const trueHi = new Set<number>();
  const steps = trace !== null ? stepsOf(trace) : [];
  const isNj = trace !== null && "Nj" in trace;

  // Highlight a cluster node and the matching leaves in the true tree.
  const markCluster = (id: number) => {
    inferHi.add(id);
    for (const label of inferSets.get(id) ?? NO_LABELS) {
      const t = trueLeafByLabel.get(label);
      if (t !== undefined) trueHi.add(t);
    }
  };
  const markLeaf = (label: string) => {
    const fi = inferLeafByLabel.get(label);
    const ft = trueLeafByLabel.get(label);
    if (fi !== undefined) inferHi.add(fi);
    if (ft !== undefined) trueHi.add(ft);
  };

  // The join under discussion: the chosen pair of the next join — or all
  // three nodes of NJ's final three-way join, which has no single pair.
  if (isNj && k >= steps.length) {
    const f = trace.Nj.final_join;
    markCluster(f.a);
    markCluster(f.b);
    markCluster(f.c);
  } else if (
    smShown !== null &&
    smShown.active !== null &&
    smShown.chosen !== null
  ) {
    markCluster(smShown.active[smShown.chosen[0]]);
    markCluster(smShown.active[smShown.chosen[1]]);
  }

  // Hover: a matrix cell highlights its pair in both trees. When a trace
  // step is shown the indices address `sm.active` clusters; without a
  // trace they address leaf labels of the full matrix.
  if (cellHover !== null && sm !== null && sm.active !== null) {
    for (const idx of [cellHover.i, cellHover.j]) {
      const id = sm.active[idx];
      if (id !== undefined) markCluster(id);
    }
  } else if (cellHover !== null && matrix !== null) {
    for (const idx of [cellHover.i, cellHover.j]) {
      const label = matrix.labels[idx];
      if (label !== undefined) markLeaf(label);
    }
  }
  if (hoverLeaf !== null) markLeaf(hoverLeaf);
  if (leafPick !== null) markLeaf(leafPick);

  // Visible nodes at step k: leaves plus nodes created by steps 1..k
  // (NJ's central node only at the final position).
  let visibleNodes: Set<number> | undefined;
  if (inferred !== null && trace !== null) {
    visibleNodes = new Set<number>();
    for (let id = 0; id < leafCount(inferred); id++) visibleNodes.add(id);
    for (let i = 0; i < k && i < steps.length; i++) {
      visibleNodes.add(steps[i].new_node);
    }
    if (isNj && k === traceLength(trace)) visibleNodes.add(inferred.root);
  }

  // Clades of the inferred tree absent from the true tree (RF splits) —
  // a result verdict, so it only shows at the final position (checkpoint
  // 12). Without a trace the completed tree is always shown.
  const wrong = new Set<number>();
  const atEnd = trace === null || k >= traceLength(trace);
  if (atEnd && inferred !== null && rf !== null && taxa !== null) {
    const all = new Set(taxa);
    for (const split of rf.extra_in_inferred) {
      const side = new Set(split.side);
      const complement = new Set([...all].filter((l) => !side.has(l)));
      for (const [id, labs] of inferSets) {
        if (inferred.nodes[id].children.length === 0) continue;
        if (sameSet(labs, side) || sameSet(labs, complement)) wrong.add(id);
      }
    }
  }

  // Leaf hover → highlight that leaf's matrix row and column: the row of
  // the cluster containing the leaf when a step is shown, else the
  // leaf's own row in the full matrix.
  let matrixHover: { i: number; j: number } | { axis: number } | null =
    cellHover;
  if (hoverLeaf !== null) {
    matrixHover = null;
    if (sm !== null && sm.active !== null) {
      const idx = sm.active.findIndex(
        (id) => inferSets.get(id)?.has(hoverLeaf) === true,
      );
      if (idx >= 0) matrixHover = { axis: idx };
    } else if (matrix !== null) {
      const idx = matrix.labels.indexOf(hoverLeaf);
      if (idx >= 0) matrixHover = { axis: idx };
    }
  }

  return { inferHi, trueHi, wrong, visibleNodes, matrixHover };
}
