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

/** Build the two-column name-map CSV, quoting fields containing
 * `"`, `,` or newlines. */
function nameMapCsv(pairs: [string, string][]): string {
  const esc = (s: string) =>
    /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
  const rows = pairs.map(([a, b]) => `${esc(a)},${esc(b)}`);
  return `original,exported\n${rows.join("\n")}\n`;
}

/** Newick label mode (checkpoint-15 fix): standard quoting, or
 * tool-compatible names for ape/FigTree/iTOL. */
type NameLabelMode = "exact" | "compatible";

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
  // null = not yet chosen: the mode then defaults to Compatible when a
  // name on either exportable tree would need quoting (those break
  // ape::read.tree, FigTree and iTOL), else Exact.
  const [chosenMode, setChosenMode] = useState<NameLabelMode | null>(null);
  const needsQuotes =
    (tree !== null && engine.labelsNeedQuotes(tree)) ||
    (consensusTree !== null && engine.labelsNeedQuotes(consensusTree));
  const nameMode: NameLabelMode =
    chosenMode ?? (needsQuotes ? "compatible" : "exact");
  // The renames a compatible export applies (leaf labels are shared
  // between the displayed and consensus trees, so either works).
  const namePairs =
    nameMode === "compatible" && (tree ?? consensusTree) !== null
      ? engine.compatibleNames((tree ?? consensusTree) as Tree)
      : [];

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

  // Both Newick exports honor the label mode (checkpoint-15 fix); a
  // compatible write that renamed anything also downloads the
  // original→exported map CSV.
  const onNewickTree = (t: Tree, filename: string) => {
    const text =
      nameMode === "compatible"
        ? engine.writeNewickCompatible(t, true)
        : engine.writeNewickWithSupport(t);
    download(filename, new Blob([text], { type: "text/plain" }));
    const pairs = engine.compatibleNames(t);
    if (nameMode === "compatible" && pairs.length > 0) {
      download(
        "neophylo-name-map.csv",
        new Blob([nameMapCsv(pairs)], { type: "text/csv" }),
      );
    }
  };

  const onNewick = () => onNewickTree(tree as Tree, "neophylo-tree.nwk");

  const onConsensus = () =>
    onNewickTree(consensusTree as Tree, "neophylo-consensus.nwk");

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
      <label className="newick-name-mode">
        Newick names:{" "}
        <select
          value={nameMode}
          onChange={(e) =>
            setChosenMode(e.target.value as NameLabelMode)
          }
        >
          <option value="exact">Exact (standard Newick, quoted)</option>
          <option value="compatible">
            Compatible (recommended for R, FigTree, iTOL)
          </option>
        </select>
      </label>
      {nameMode === "compatible" && namePairs.length > 0 && (
        <div className="phylip-note" role="status">
          <p>
            {needsQuotes
              ? "Compatible names are the default because some names would " +
                "need quoting, which ape::read.tree turns into NA. "
              : ""}
            Renamed for compatibility (also saved to
            neophylo-name-map.csv):
          </p>
          <ul>
            {namePairs.slice(0, 6).map(([from, to]) => (
              <li key={from}>
                {from} → {to}
              </li>
            ))}
            {namePairs.length > 6 && (
              <li>…and {namePairs.length - 6} more</li>
            )}
          </ul>
        </div>
      )}
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
