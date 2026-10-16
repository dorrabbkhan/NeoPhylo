// Export menu (plan Task 24, spec §6.6). Downloads the inferred tree as
// SVG, PNG or Newick, plus the equivalent R script for the current
// alignment, correction and method. Disabled until a tree exists.

import { useState } from "react";

import { engine } from "../engine/index";
import type { Alignment } from "../engine/generated/Alignment";
import type { DistModel } from "../engine/generated/DistModel";
import type { Method } from "../engine/generated/Method";
import type { Tree } from "../engine/generated/Tree";
import { exportPng } from "../export/png";
import { exportR } from "../export/rscript";
import { exportSvg } from "../export/svg";

export interface ExportMenuProps {
  tree: Tree | null;
  alignment: Alignment | null;
  correction: DistModel;
  method: Method;
  clampNegative: boolean;
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
}: ExportMenuProps) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

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
      </div>
      {failed && (
        <p role="status" className="export-error">
          PNG export failed — try the SVG instead.
        </p>
      )}
    </section>
  );
}
