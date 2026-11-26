// Export menu (plan Task 24, spec §6.6; PHYLIP matrix added in v1.1
// Task 13, spec §5.6; bootstrap exports in v1.2 Task 15, spec §6.8).
// Downloads the displayed tree as SVG, PNG or Newick — the displayed
// tree is what the user sees: support labels included, rooted on the
// reference's outgroup when that view is on (the item names say which),
// plus the current consensus view as "Consensus (Newick)", the
// distance matrix as neighbor-readable PHYLIP, and the equivalent R
// script (with a boot.phylo block once a run has finished).
//
// The section shell — heading and labelled region — stays in the
// initial bundle; the panel body (the export items, the Newick label
// mode and the notices) is a lazy chunk (v1.5 Task 8, owner decision
// 2026-11-26 — the §8.2 initial-JS budget, same precedent as every
// lazy sheet/panel in App.tsx). It is fetched on first render, so the
// menu looks and behaves exactly as before — same position, focus
// order and ARIA — and the SW's `**/*.js` precache keeps it working
// offline after first load.

import { lazy, Suspense } from "react";

import type { Alignment } from "../engine/generated/Alignment";
import type { DistanceInput } from "../engine/generated/DistanceInput";
import type { DistanceMatrix } from "../engine/generated/DistanceMatrix";
import type { DistModel } from "../engine/generated/DistModel";
import type { Method } from "../engine/generated/Method";
import type { ThemeName } from "../design/tokens";
import type { Tree } from "../engine/generated/Tree";
import type { ExportSvgOptions } from "../export/svg";

export interface ExportMenuProps {
  /** The tree the user sees: support labels and reference rooting
   * already applied (v1.2 spec §6.8). */
  tree: Tree | null;
  alignment: Alignment | null;
  correction: DistModel;
  method: Method;
  clampNegative: boolean;
  /** The session's current leaf distance matrix (spec §5.6 export). */
  matrix: DistanceMatrix | null;
  /** The typed/imported matrix in a matrix session (v1.4c spec §6.3):
   * drives "Matrix (.meg)" and the matrix R script. */
  matrixInput?: DistanceInput | null;
  /** True while the session runs on a supplied matrix: the alignment
   * exports (FASTA/.meg alignment) are not offered and the data items
   * write the matrix (v1.4c spec §6.3). */
  matrixSession?: boolean;
  /** Which drawing `tree` is (v1.2 spec §6.7-6.8, checkpoint 15):
   * the tree items name it — "rooted": the rerooted reference
   * outgroup view ("Newick (rooted on wheat)"); "computed": the
   * unrooted NJ tree the toggle falls back to ("Newick (as computed,
   * unrooted)"); "plain": no toggle exists (UPGMA, no reference or
   * mid-trace), so the items are unnamed ("Newick"). */
  treeView: TreeViewState;
  /** The tree of the current bootstrap view — the support tree on the
   * "Your tree with support" tab, else the view's consensus tree —
   * exported by "Consensus (Newick)" (v1.2 spec §6.8). */
  consensusTree: Tree | null;
  /** The layout inputs of the displayed figure (kind, leaf spacing,
   * measured panel width, visible nodes, split-key taxa/convention).
   * The SVG/PNG exports serialize the SAME figure the screen draws
   * (checkpoint 15); omitted in tests, which then get the standalone
   * defaults. */
  figure?: Omit<ExportSvgOptions, "kind" | "clampNegative"> & {
    kind?: "phylogram" | "cladogram";
  };
  /** Replicates and seed of the finished run, for the R script's
   * bootstrap block; null when no run has finished. */
  bootstrap: { replicates: number; seed: number } | null;
  /** The screen's theme — used for figure exports only when "Match
   * screen theme" is checked; the default is the light print palette
   * (v1.3 spec §7.3). */
  theme: ThemeName;
  /** The `.meg` export's `!Title`: the dataset or file name (v1.4b
   * Task 11) — the session's alignmentName, else the exercise
   * title. */
  title?: string;
}

/** The drawing the tree items export, mirroring the tree column's
 * current view (checkpoint 15). */
export type TreeViewState =
  | { kind: "rooted"; outgroup: string[] }
  | { kind: "computed" }
  | { kind: "plain" };

// The panel body (v1.5 Task 8, owner decision 2026-11-26 — the
// initial-JS budget, the standing App.tsx lazy-panel precedent):
// fetched on first render, not with the app. The SW's `**/*.js`
// precache keeps it working offline after first load.
const ExportMenuBody = lazy(() =>
  import("./ExportMenuBody").then((m) => ({ default: m.ExportMenuBody })),
);

export function ExportMenu(props: ExportMenuProps) {
  return (
    <section className="export-menu" aria-label="Export">
      <h2>Export</h2>
      <Suspense fallback={null}>
        <ExportMenuBody {...props} />
      </Suspense>
    </section>
  );
}
