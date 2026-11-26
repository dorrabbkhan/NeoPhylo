// The Export menu's panel body (v1.5 Task 8, owner decision
// 2026-11-26): a lazy chunk — the section shell in ExportMenu.tsx
// keeps the heading and the labelled region in the initial bundle,
// and this body (the export items, the Newick label mode and the
// notices) is fetched on first render like every sheet/panel in
// App.tsx (the §8.2 initial-JS budget). The fetch resolves on mount;
// the SW's `**/*.js` precache keeps it working offline after first
// load. Nothing else changed — the buttons keep their order, names,
// disabled states and keyboard/ARIA behaviour.

import { lazy, Suspense, useState } from "react";

import { engine } from "../engine/index";
import { errorMessage } from "../explain/errors";
import { download } from "../export/download";
import type { Alignment } from "../engine/generated/Alignment";
import type { DistanceMatrix } from "../engine/generated/DistanceMatrix";
import type { Tree } from "../engine/generated/Tree";
import { Icon } from "./nav/Icon";

import type { ExportMenuProps } from "./ExportMenu";

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

// Matrix sessions (v1.4c Task 8 fix round 1, initial-JS budget): the
// three matrix-only items are a lazy chunk — they ship only while a
// matrix session renders the menu.
const MatrixExportItems = lazy(() =>
  import("./matrix/MatrixExportItems").then((m) => ({
    default: m.MatrixExportItems,
  })),
);

export function ExportMenuBody({
  tree,
  alignment,
  correction,
  method,
  clampNegative,
  matrix,
  matrixInput = null,
  matrixSession = false,
  treeView,
  consensusTree,
  figure,
  bootstrap,
  theme,
  title = "neophylo",
}: ExportMenuProps) {
  const [busy, setBusy] = useState(false);
  // Which figure export last failed, so each failure shows its own
  // message — a rejected font fetch must never surface the PNG text.
  const [failed, setFailed] = useState<"svg" | "png" | null>(null);
  const [phylipNote, setPhylipNote] = useState<{
    relaxed: boolean;
    saturated: boolean;
  } | null>(null);
  // null = not yet chosen: the mode then defaults to Compatible when a
  // name on either exportable tree would need quoting (those break
  // ape::read.tree, FigTree and iTOL), else Exact.
  const [chosenMode, setChosenMode] = useState<NameLabelMode | null>(null);
  // §7.3: figure exports print the light palette by default; "Match
  // screen theme" switches them to the current screen theme. It is
  // in-session UI state only — not a device-local preference (§7.4
  // lists only theme/presenter/tourSeen) and never in the URL.
  const [matchScreenTheme, setMatchScreenTheme] = useState(false);
  // Review Focus 1: set when a figure export's names reach outside
  // every bundled font subset.
  const [fontWarning, setFontWarning] = useState(false);
  // `.meg` export (v1.4b Task 11): the whitespace→underscore rename
  // notice and a refused write's engine message.
  const [megNote, setMegNote] = useState<string | null>(null);
  const [megError, setMegError] = useState<string | null>(null);
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

  // The export writers are lazy chunks (v1.3 Task 14, spec §8.2):
  // fetched only when the matching item runs, precached by the SW's
  // `**/*.js` glob so every export still works offline after first
  // load. Only the serialization moved — the shared figure layout
  // stays with the screen code, so the export still draws the
  // identical figure.
  const svg = async () => {
    const { exportSvgDetailed, uncoveredChars } = await import(
      "../export/svg"
    );
    const out = await exportSvgDetailed(tree as Tree, {
      ...figure,
      kind: figure?.kind ?? "phylogram",
      clampNegative,
      theme: matchScreenTheme ? theme : "light",
    });
    // Warn on the texts the export actually drew — a leaf
    // figure.visibleNodes hides is not scanned.
    setFontWarning(uncoveredChars(out.texts).length > 0);
    return out.svg;
  };

  const onSvg = async () => {
    setFailed(null);
    try {
      download(
        "neophylo-tree.svg",
        new Blob([await svg()], { type: "image/svg+xml" }),
      );
    } catch {
      setFailed("svg");
    }
  };

  const onPng = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const [{ exportPng }, svgText] = await Promise.all([
        import("../export/png"),
        svg(),
      ]);
      download("neophylo-tree.png", await exportPng(svgText, 2));
    } catch {
      setFailed("png");
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

  const onR = async () => {
    const { exportR } = await import("../export/rscript");
    download(
      "neophylo-analysis.R",
      new Blob(
        [
          exportR(
            alignment as Alignment,
            correction,
            method,
            bootstrap === null ? undefined : bootstrap,
          ),
        ],
        { type: "text/plain" },
      ),
    );
  };

  // spec §5.6: the matrix in neighbor input format. Auto picks Strict
  // names when they fit in 10 characters, else Relaxed with a note;
  // saturated cells are written -1.000000 (PHYLIP's convention, §3.2).
  const onPhylip = async () => {
    const { phylipMatrix } = await import("../export/phylip");
    const r = phylipMatrix(matrix as DistanceMatrix);
    setPhylipNote({ relaxed: r.relaxed, saturated: r.saturated });
    download(
      "distances.phy",
      new Blob([r.text], { type: "text/plain" }),
    );
  };

  // `.meg` (v1.4b spec §6.3): the lazy export chunk writes the
  // alignment; labels with whitespace come out with underscores —
  // never silently, so the notice names the renames; a refused write
  // shows the engine's error message.
  const onMeg = async () => {
    setMegNote(null);
    setMegError(null);
    const { megAlignment } = await import("../export/meg");
    const r = megAlignment(alignment as Alignment, title);
    if (!r.ok) {
      const m = errorMessage(r.error);
      setMegError(`${m.title} ${m.body}`);
      return;
    }
    download(
      "alignment.meg",
      new Blob([r.value.text], { type: "text/plain" }),
    );
    const renamed = r.value.renamed;
    if (renamed.length > 0) {
      setMegNote(
        `${renamed.length} taxon name${renamed.length > 1 ? "s" : ""} ` +
          `contain${renamed.length > 1 ? "" : "s"} spaces; they are ` +
          `written with underscores ` +
          `(${renamed.map(([, to]) => to).join(", ")})`,
      );
    }
  };

  // spec §6.8 + checkpoint 15: tree items follow the current display
  // and say so in their names — the rerooted outgroup view, the
  // unrooted computed view, or nothing when no toggle exists (UPGMA
  // trees are rooted by the method, and there is no reference view).
  const viewSuffix =
    treeView.kind === "rooted"
      ? `rooted on ${treeView.outgroup.join(", ")}`
      : treeView.kind === "computed"
        ? "as computed, unrooted"
        : null;
  const treeLabel = (base: string) =>
    viewSuffix === null ? base : `${base} (${viewSuffix})`;

  return (
    <>
      <div className="export-buttons">
        <button
          type="button"
          className="btn btn-secondary"
          disabled={tree === null}
          onClick={() => void onSvg()}
        >
          <Icon name="download" />
          {treeLabel("SVG")}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={tree === null || busy}
          onClick={() => void onPng()}
        >
          <Icon name="download" />
          {busy ? "PNG…" : treeLabel("PNG")}
        </button>
        <button
          type="button"
          className="btn btn-secondary"
          disabled={tree === null}
          onClick={onNewick}
        >
          <Icon name="download" />
          {treeLabel("Newick")}
        </button>
        {matrixSession ? (
          <Suspense fallback={null}>
            {/* No alignment exports in a matrix session — no FASTA,
                no alignment .meg, no consensus (v1.4c spec §6.3). */}
            <MatrixExportItems
              matrix={matrix}
              matrixInput={matrixInput}
              method={method}
              title={title}
              onMegNote={setMegNote}
              onMegError={setMegError}
              onPhylipNote={setPhylipNote}
            />
          </Suspense>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={consensusTree === null}
              onClick={onConsensus}
            >
              <Icon name="download" />
              {viewSuffix === null
                ? "Consensus (Newick)"
                : `Consensus (Newick, ${viewSuffix})`}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={alignment === null}
              onClick={() => void onR()}
            >
              <Icon name="download" />
              R script
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={matrix === null}
              onClick={() => void onPhylip()}
            >
              <Icon name="download" />
              Distance matrix (PHYLIP)
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={alignment === null}
              onClick={() => void onMeg()}
            >
              <Icon name="download" />
              Alignment (.meg)
            </button>
          </>
        )}
      </div>
      <label className="export-theme-match">
        <input
          type="checkbox"
          checked={matchScreenTheme}
          onChange={(e) => setMatchScreenTheme(e.target.checked)}
        />
        Match screen theme
      </label>
      {fontWarning && (
        <div className="phylip-note" role="status">
          <p>
            Some names use characters outside the bundled fonts and may
            look different in other programs.
          </p>
        </div>
      )}
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
      {megNote !== null && (
        <div className="phylip-note" role="status">
          <p>{megNote}</p>
        </div>
      )}
      {megError !== null && (
        <p role="status" className="export-error">
          {megError}
        </p>
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
      {failed !== null && (
        <p role="status" className="export-error">
          {failed === "png"
            ? "PNG export failed — try the SVG instead."
            : "SVG export failed — the bundled fonts could not be loaded. Try again."}
        </p>
      )}
    </>
  );
}

// The prop contract lives in ExportMenu.tsx (the shell is the public
// module); re-export it so `import type { ExportMenuProps }` keeps
// working from either path.
export type { ExportMenuProps, TreeViewState } from "./ExportMenu";
