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

/** Internal node ids whose clade is one of `groupings` — for rooted
 * (UPGMA) trees a node matches the grouping itself; for unrooted (NJ)
 * splits it may hold either side, so the complement matches too. */
function differingNodes(
  tree: Tree,
  groupings: string[][],
  taxa: ReadonlySet<string>,
  rooted: boolean,
): Set<number> {
  const sets = leafLabelSets(tree);
  const sides = groupings.map((g) => new Set(g));
  const out = new Set<number>();
  for (const [id, labs] of sets) {
    if (tree.nodes[id].children.length === 0) continue;
    for (const side of sides) {
      if (sameSet(labs, side)) {
        out.add(id);
        break;
      }
      if (!rooted) {
        const comp = new Set([...taxa].filter((l) => !side.has(l)));
        if (sameSet(labs, comp)) {
          out.add(id);
          break;
        }
      }
    }
  }
  return out;
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

  // The replicate tree drawn like the original: when NJ is shown
  // rooted on the reference's outgroup, the replicate gets the same
  // rooting (spec §6.5; the toggle is behind the modal, so the state
  // can't change while the panel is open).
  const repTree = useMemo(() => {
    if (d === null || d.tree === null) return null;
    if (outgroup === null || outgroup.length === 0) return d.tree;
    const r = engine.rerootOnOutgroup(d.tree, outgroup);
    return r.ok ? r.value.tree : d.tree;
  }, [d, outgroup]);

  const all = useMemo(() => new Set(taxa), [taxa]);
  const rooted = method === "Upgma";
  // Differing groupings are outlined where they occur: each lives in
  // exactly one of the two trees, so it is marked exactly once.
  const repWrong = useMemo(
    () =>
      d !== null && repTree !== null
        ? differingNodes(repTree, d.differing, all, rooted)
        : EMPTY,
    [d, repTree, all, rooted],
  );
  const origWrong = useMemo(
    () =>
      d !== null ? differingNodes(original, d.differing, all, rooted) : EMPTY,
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
                {d.rf_to_original !== null && (
                  <p className="rep-diff">
                    This replicate's tree differs from your tree in{" "}
                    {d.rf_to_original} grouping
                    {d.rf_to_original === 1 ? "" : "s"}.
                  </p>
                )}
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
                    />
                  )}
                  <TreeView
                    title="Your tree"
                    tree={original}
                    layoutKind="phylogram"
                    highlight={EMPTY}
                    wrong={origWrong}
                    clampNegative={clampNegative}
                    leafSpacing={leafSpacing}
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
