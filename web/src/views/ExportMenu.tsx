// Export menu (plan Task 24, spec §6.6; PHYLIP matrix added in v1.1
// Task 13, spec §5.6; bootstrap exports in v1.2 Task 15, spec §6.8).
// Downloads the displayed tree as SVG, PNG or Newick — the displayed
// tree is what the user sees: support labels included, rooted on the
// reference's outgroup when that view is on (the item names say which),
// plus the current consensus view as "Consensus (Newick)", the
// distance matrix as neighbor-readable PHYLIP, and the equivalent R
// script (with a boot.phylo block once a run has finished).

import { useState } from "react";

import { engine } from "../engine/index";
import type { Alignment } from "../engine/generated/Alignment";
import type { DistanceMatrix } from "../engine/generated/DistanceMatrix";
import type { DistModel } from "../engine/generated/DistModel";
import type { Method } from "../engine/generated/Method";
import type { Tree } from "../engine/generated/Tree";
import { exportPng } from "../export/png";
import { phylipMatrix } from "../export/phylip";
import { exportR } from "../export/rscript";
import { exportSvg } from "../export/svg";

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
  /** Outgroup labels when `tree` is drawn rooted like the reference;
   * the tree items name it (e.g. "Newick (rooted on wheat)"). */
  rootedOn: string[] | null;
  /** The tree of the current bootstrap view — the support tree on the
   * "Your tree with support" tab, else the view's consensus tree —
   * exported by "Consensus (Newick)" (v1.2 spec §6.8). */
  consensusTree: Tree | null;
  /** Replicates of the finished run, for the R script's boot.phylo
   * block; null when no run has finished. */
  replicates: number | null;
}

/** Trigger a browser download of `content` under `filename`. */
function download(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function ExportMenu({
  tree,
  alignment,
  correction,
  method,
  clampNegative,
  matrix,
  rootedOn,
  consensusTree,
  replicates,
}: ExportMenuProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [phylipNote, setPhylipNote] = useState<{
    relaxed: boolean;
    saturated: boolean;
  } | null>(null);

  const svg = () =>
    exportSvg(tree as Tree, { kind: "phylogram", clampNegative });

  const onSvg = () =>
    download("neophylo-tree.svg", new Blob([svg()], { type: "image/svg+xml" }));

  const onPng = async () => {
    setBusy(true);
    setFailed(false);
    try {
      download("neophylo-tree.png", await exportPng(svg(), 2));
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const onNewick = () =>
    download(
      "neophylo-tree.nwk",
      new Blob([engine.writeNewickWithSupport(tree as Tree)], {
        type: "text/plain",
      }),
    );

  const onConsensus = () =>
    download(
      "neophylo-consensus.nwk",
      new Blob([engine.writeNewickWithSupport(consensusTree as Tree)], {
        type: "text/plain",
      }),
    );

  const onR = () =>
    download(
      "neophylo-analysis.R",
      new Blob(
        [
          exportR(
            alignment as Alignment,
            correction,
            method,
            replicates === null ? undefined : { replicates },
          ),
        ],
        { type: "text/plain" },
      ),
    );

  // spec §5.6: the matrix in neighbor input format. Auto picks Strict
  // names when they fit in 10 characters, else Relaxed with a note;
  // saturated cells are written -1.000000 (PHYLIP's convention, §3.2).
  const onPhylip = () => {
    const r = phylipMatrix(matrix as DistanceMatrix);
    setPhylipNote({ relaxed: r.relaxed, saturated: r.saturated });
    download(
      "distances.phy",
      new Blob([r.text], { type: "text/plain" }),
    );
  };

  // spec §6.8: tree items follow the current display — rooted like
  // the reference when that view is on — and say so in their names.
  const rootedNote =
    rootedOn !== null ? ` (rooted on ${rootedOn.join(", ")})` : "";

  return (
    <section className="export-menu" aria-label="Export">
      <h2>Export</h2>
      <div className="export-buttons">
        <button type="button" disabled={tree === null} onClick={onSvg}>
          SVG{rootedNote}
        </button>
        <button
          type="button"
          disabled={tree === null || busy}
          onClick={() => void onPng()}
        >
          {busy ? "PNG…" : `PNG${rootedNote}`}
        </button>
        <button type="button" disabled={tree === null} onClick={onNewick}>
          Newick{rootedNote}
        </button>
        <button
          type="button"
          disabled={consensusTree === null}
          onClick={onConsensus}
        >
          Consensus (Newick)
        </button>
        <button type="button" disabled={alignment === null} onClick={onR}>
          R script
        </button>
        <button
          type="button"
          disabled={matrix === null}
          onClick={onPhylip}
        >
          Distance matrix (PHYLIP)
        </button>
      </div>
      {phylipNote !== null && (
        <div className="phylip-note" role="status">
          {phylipNote.relaxed && (
            <p>
              Relaxed names were used: a name longer than 10 characters
              doesn&apos;t fit PHYLIP&apos;s strict format. This file still
              loads in <code>neighbor</code>.
            </p>
          )}
          {phylipNote.saturated && (
            <p>
              Distances that can&apos;t be estimated are written as
              -1.000000 — PHYLIP&apos;s "infinite distance" convention.
            </p>
          )}
        </div>
      )}
      {failed && (
        <p role="status" className="export-error">
          PNG export failed — try the SVG instead.
        </p>
      )}
    </section>
  );
}
