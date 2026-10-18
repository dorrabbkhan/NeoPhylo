// Export menu (plan Task 24, spec §6.6; PHYLIP matrix added in v1.1
// Task 13, spec §5.6). Downloads the inferred tree as SVG, PNG or
// Newick, the current distance matrix as neighbor-readable PHYLIP,
// plus the equivalent R script for the current alignment, correction
// and method. Tree items are disabled until a tree exists.

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
  tree: Tree | null;
  alignment: Alignment | null;
  correction: DistModel;
  method: Method;
  clampNegative: boolean;
  /** The session's current leaf distance matrix (spec §5.6 export). */
  matrix: DistanceMatrix | null;
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
      new Blob([engine.writeNewick(tree as Tree)], { type: "text/plain" }),
    );

  const onR = () =>
    download(
      "neophylo-analysis.R",
      new Blob([exportR(alignment as Alignment, correction, method)], {
        type: "text/plain",
      }),
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

  return (
    <section className="export-menu" aria-label="Export">
      <h2>Export</h2>
      <div className="export-buttons">
        <button type="button" disabled={tree === null} onClick={onSvg}>
          SVG
        </button>
        <button
          type="button"
          disabled={tree === null || busy}
          onClick={() => void onPng()}
        >
          {busy ? "PNG…" : "PNG"}
        </button>
        <button type="button" disabled={tree === null} onClick={onNewick}>
          Newick
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
