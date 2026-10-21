// "Watch one replicate" panel (v1.2 plan Task 13, spec §6.5). Opens
// from "How sure are we?" once a run has results, on replicate 1, with
// Previous/Next (bounded 1…N) and ←/→/Esc keyboard control. A pure
// view: App supplies the `replicate_detail` result (computed on the
// main thread, or through the worker when the run's estimate puts one
// replicate over ~2 s) and the original tree exactly as the main view
// draws it — support labels included, rerooted on the reference's
// outgroup when that display is on (the replicate tree is rerooted the
// same way, so both drawings share the toggle state).
//
// Content per spec §6.5: a column strip with each column's draw count
// (0 dimmed, via data-weight), the "U of L columns not drawn" line,
// the replicate tree beside the original with differing groupings
// outlined by the same dotted mark as wrong clades, and "This
// replicate was skipped (saturated)." for failed replicates. The
// difference line uses the method's own comparison — the unrooted RF
// for NJ, the rooted cluster difference for UPGMA — which is what the
// engine reports as `rf_to_original`.

import { useEffect, useMemo, useRef } from "react";
import type { KeyboardEvent } from "react";

import { engine } from "../engine";
import type { Result } from "../engine";
import type { Method } from "../engine/generated/Method";
import type { ReplicateDetail } from "../engine/generated/ReplicateDetail";
import type { Tree } from "../engine/generated/Tree";
import { errorMessage } from "../explain/errors";

import { leafLabelSets, sameSet } from "./stepEmphasis";
import { TreeView } from "./TreeView";

export interface ReplicatePanelProps {
  /** The analysis method — decides grouping matching (rooted clusters
   * for UPGMA, unrooted splits for NJ). */
  method: Method;
  /** Alignment taxon labels (the complement side of an NJ split). */
  taxa: string[];
  /** 0-based replicate index; displayed as "Replicate index+1". */
  index: number;
  /** Replicate count the index is bounded by (the run's total). */
  total: number;
  /** The engine's `replicate_detail` result; null while a worker job
   * for this index is still in flight. */
  detail: Result<ReplicateDetail> | null;
  /** The original tree exactly as the main view draws it (support and
   * reference rooting included). */
  original: Tree;
  /** The reference's outgroup when NJ is drawn rerooted, else null. */
  outgroup: string[] | null;
  clampNegative?: boolean;
  leafSpacing?: number;
  onNavigate: (index: number) => void;
  onClose: () => void;
}

const EMPTY = new Set<number>();
const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/** Internal node ids whose clade is one of `groupings`, and how many
 * groupings matched — for rooted (UPGMA) trees a node matches the
 * grouping itself; for unrooted (NJ) splits it may hold either side,
 * so the complement matches too. */
function differingNodes(
  tree: Tree,
  groupings: string[][],
  taxa: ReadonlySet<string>,
  rooted: boolean,
): { nodes: Set<number>; matched: number } {
  const sets = leafLabelSets(tree);
  const sides = groupings.map((g) => new Set(g));
  const nodes = new Set<number>();
  let matched = 0;
  for (const side of sides) {
    let found = false;
    for (const [id, labs] of sets) {
      if (tree.nodes[id].children.length === 0) continue;
      let hit = sameSet(labs, side);
      if (!hit && !rooted) {
        const comp = new Set([...taxa].filter((l) => !side.has(l)));
        hit = sameSet(labs, comp);
      }
      if (hit) {
        nodes.add(id);
        found = true;
      }
    }
    if (found) matched += 1;
  }
  return { nodes, matched };
}

/** Leaf positions in `tree`'s drawn order (depth-first from its
 * root), used to order another drawing the same way. */
function leafRank(tree: Tree): Map<string, number> {
  const rank = new Map<string, number>();
  let next = 0;
  const dfs = (id: number) => {
    const n = tree.nodes[id];
    if (n.children.length === 0) {
      if (n.label !== null && !rank.has(n.label)) {
        rank.set(n.label, next);
        next += 1;
      }
      return;
    }
    for (const c of n.children) dfs(c);
  };
  dfs(tree.root);
  return rank;
}

/** Copy of `t` with every node's children sorted by their subtree's
 * earliest leaf position in `rank`, so groupings that coincide with
 * the ranked tree draw in the same orientation. Pure view
 * bookkeeping — no topology change. */
function orderLike(t: Tree, rank: ReadonlyMap<string, number>): Tree {
  const best = new Map<number, number>();
  const score = (id: number): number => {
    const memo = best.get(id);
    if (memo !== undefined) return memo;
    const n = t.nodes[id];
    let s = Number.MAX_SAFE_INTEGER;
    if (n.children.length === 0 && n.label !== null) {
      const r = rank.get(n.label);
      if (r !== undefined) s = r;
    }
    for (const c of n.children) s = Math.min(s, score(c));
    best.set(id, s);
    return s;
  };
  score(t.root);
  return {
    ...t,
    nodes: t.nodes.map((n) => ({
      ...n,
      children: [...n.children].sort(
        (a, b) => best.get(a)! - best.get(b)!,
      ),
    })),
  };
}

export function ReplicatePanel({
  method,
  taxa,
  index,
  total,
  detail,
  original,
  outgroup,
  clampNegative = false,
  leafSpacing,
  onNavigate,
  onClose,
}: ReplicatePanelProps) {
  const panelRef = useRef<HTMLElement>(null);
  const restoreRef = useRef<Element | null>(null);

  // Focus management (same convention as PairPanel, spec §6.5): focus
  // moves into the dialog on open and returns to the opener on close.
  useEffect(() => {
    restoreRef.current = document.activeElement;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => {
      const el = restoreRef.current;
      if (el instanceof HTMLElement || el instanceof SVGElement) {
        if (el.isConnected) el.focus();
      }
    };
  }, []);

  const k = index + 1;
  const navigate = (to: number) =>
    onNavigate(Math.max(0, Math.min(total - 1, to)));

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key === "ArrowLeft") {
      e.preventDefault();
      navigate(index - 1);
      return;
    }
    if (e.key === "ArrowRight") {
      e.preventDefault();
      navigate(index + 1);
      return;
    }
    if (e.key !== "Tab") return;
    const panel = panelRef.current;
    if (panel === null) return;
    const els = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => !el.hasAttribute("disabled"));
    if (els.length === 0) {
      e.preventDefault();
      return;
    }
    const idx = els.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && (idx <= 0 || document.activeElement === panel)) {
      e.preventDefault();
      els[els.length - 1].focus();
    } else if (!e.shiftKey && idx === els.length - 1) {
      e.preventDefault();
      els[0].focus();
    }
  };

  const d = detail !== null && detail.ok ? detail.value : null;

  // The side the replicate roots on: the reference's outgroup when
  // that display is on, else the leaf set of the original drawing's
  // root-side first child — the replicate is drawn in the same
  // orientation as "Your tree" so coinciding groupings line up
  // (checkpoint fix; the engine falls back to a terminal branch when
  // that side isn't a split in the replicate).
  const drawnOutgroup = useMemo(() => {
    if (outgroup !== null && outgroup.length > 0) return outgroup;
    const first = original.nodes[original.root].children[0];
    if (first === undefined) return null;
    const set = leafLabelSets(original).get(first);
    return set === undefined ? null : [...set];
  }, [outgroup, original]);

  const origRank = useMemo(() => leafRank(original), [original]);

  const repTree = useMemo(() => {
    if (d === null || d.tree === null) return null;
    let t = d.tree;
    if (drawnOutgroup !== null && drawnOutgroup.length > 0) {
      const r = engine.rerootOnOutgroup(t, drawnOutgroup);
      if (r.ok) t = r.value.tree;
    }
    // Children ordered like the original where groupings coincide, so
    // a replicate with the same groupings draws identically.
    return orderLike(t, origRank);
  }, [d, drawnOutgroup, origRank]);

  const all = useMemo(() => new Set(taxa), [taxa]);
  const rooted = method === "Upgma";
  // Differing groupings are outlined where they occur: each lives in
  // exactly one of the two trees, so it is marked exactly once.
  const repWrong = useMemo(
    () =>
      d !== null && repTree !== null
        ? differingNodes(repTree, d.differing, all, rooted).nodes
        : EMPTY,
    [d, repTree, all, rooted],
  );
  // `matched` counts the differing groupings that live in your tree —
  // the "missing here" half of the difference line. For NJ's
  // unrooted splits it always equals |differing| / 2 = K / 2; for
  // UPGMA's rooted clusters missing and extra can differ.
  const origMatch = useMemo(
    () =>
      d !== null
        ? differingNodes(original, d.differing, all, rooted)
        : { nodes: EMPTY, matched: 0 },
    [d, original, all, rooted],
  );

  return (
    <div className="replicate-panel-backdrop">
      <section
        className="replicate-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="replicate-panel-title"
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="replicate-panel-head">
          <h2 id="replicate-panel-title">
            Replicate {k} of {total}
          </h2>
          <div className="replicate-nav">
            <button
              type="button"
              disabled={index <= 0}
              onClick={() => navigate(index - 1)}
            >
              Previous
            </button>
            <button
              type="button"
              disabled={index >= total - 1}
              onClick={() => navigate(index + 1)}
            >
              Next
            </button>
            <button
              type="button"
              className="close"
              aria-label="Close replicate view"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </header>

        {detail === null && (
          <p className="replicate-computing" role="status">
            Computing replicate {k}…
          </p>
        )}

        {detail !== null && !detail.ok && (
          <p className="error" role="alert">
            <strong>{errorMessage(detail.error).title}.</strong>{" "}
            {errorMessage(detail.error).body}
          </p>
        )}

        {d !== null && (
          <>
            <div
              className="rep-strip"
              role="group"
              aria-label="How many times each column was drawn"
              tabIndex={0}
            >
              {d.weights.map((w, i) => (
                <span key={i} className="rep-col" data-weight={w}>
                  {w}
                </span>
              ))}
            </div>
            <p className="rep-undrawn">
              {d.undrawn} of {d.weights.length} columns not drawn (≈ 37%
              expected)
            </p>

            {d.failed ? (
              <p className="rep-skipped" role="status">
                This replicate was skipped (saturated).
              </p>
            ) : (
              <>
                {d.rf_to_original !== null &&
                  (d.rf_to_original === 0 ? (
                    <p className="rep-diff">
                      This replicate's tree has the same groupings as
                      your tree.
                    </p>
                  ) : (
                    <p className="rep-diff">
                      {origMatch.matched} of your tree's groupings are
                      missing here, and{" "}
                      {d.differing.length - origMatch.matched} different
                      ones appear instead.
                    </p>
                  ))}
                <div className="replicate-trees">
                  {repTree !== null && (
                    <TreeView
                      title={`Replicate ${k}`}
                      tree={repTree}
                      layoutKind="phylogram"
                      highlight={EMPTY}
                      wrong={repWrong}
                      clampNegative={clampNegative}
                      leafSpacing={leafSpacing}
                      splitTaxa={taxa}
                      splitRooted={method === "Upgma"}
                    />
                  )}
                  <TreeView
                    title="Your tree"
                    tree={original}
                    layoutKind="phylogram"
                    highlight={EMPTY}
                    wrong={origMatch.nodes}
                    clampNegative={clampNegative}
                    leafSpacing={leafSpacing}
                    splitTaxa={taxa}
                    splitRooted={method === "Upgma"}
                  />
                </div>
              </>
            )}
          </>
        )}
      </section>
    </div>
  );
}
