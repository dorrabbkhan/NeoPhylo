// The matrix session's export items (v1.4c spec §6.3; Task 8 fix
// round 1, initial-JS budget): a lazy chunk inside ExportMenu's
// button row — the matrix-only items ship only when a matrix session
// renders the menu. The three items write the SUPPLIED matrix: its
// own R script (square inline, ape::nj / phangorn::upgma on
// as.dist(m), no alignment and no bootstrap), neighbor-readable
// PHYLIP and a MEGA distance file. Notes and errors ride the parent's
// status areas — the same places the alignment items report to.

import { errorMessage } from "../../explain/errors";
import { download } from "../../export/download";
import type { DistanceInput } from "../../engine/generated/DistanceInput";
import type { DistanceMatrix } from "../../engine/generated/DistanceMatrix";
import type { Method } from "../../engine/generated/Method";

export interface MatrixExportItemsProps {
  /** The session's leaf distance matrix (engine output). */
  matrix: DistanceMatrix | null;
  /** The typed/imported matrix — the R script and .meg write it. */
  matrixInput: DistanceInput | null;
  method: Method;
  /** The .meg export's `!Title` (the session's display name). */
  title: string;
  /** The shared whitespace-rename notice sink (same text as the
   * alignment .meg item's). */
  onMegNote(note: string | null): void;
  onMegError(msg: string | null): void;
  /** The PHYLIP note sink (relaxed names, saturated cells). */
  onPhylipNote(note: { relaxed: boolean; saturated: boolean }): void;
}

/** The whitespace→underscore rename notice — the identical sentence
 * the alignment .meg item builds. */
function megRenameNote(renamed: [string, string][]): string {
  return (
    `${renamed.length} taxon name${renamed.length > 1 ? "s" : ""} ` +
    `contain${renamed.length > 1 ? "" : "s"} spaces; they are ` +
    `written with underscores ` +
    `(${renamed.map(([, to]) => to).join(", ")})`
  );
}

export function MatrixExportItems({
  matrix,
  matrixInput,
  method,
  title,
  onMegNote,
  onMegError,
  onPhylipNote,
}: MatrixExportItemsProps) {
  // The supplied matrix's own R script — the full square inline,
  // ape::nj / phangorn::upgma on as.dist(m).
  const onMatrixR = async () => {
    const { exportMatrixR } = await import("../../export/rscript");
    download(
      "neophylo-analysis.R",
      new Blob([exportMatrixR(matrixInput as DistanceInput, method)], {
        type: "text/plain",
      }),
    );
  };

  // The supplied matrix as neighbor-readable PHYLIP — the same
  // writer as the alignment path, exported under its own name.
  const onMatrixPhylip = async () => {
    const { phylipMatrix } = await import("../../export/phylip");
    const r = phylipMatrix(matrix as DistanceMatrix);
    onPhylipNote({ relaxed: r.relaxed, saturated: r.saturated });
    download("matrix.phy", new Blob([r.text], { type: "text/plain" }));
  };

  // The supplied matrix as a MEGA distance file: the engine's
  // writeMegMatrix; whitespace names get the same rename notice as
  // the alignment export, a refused write the engine's message.
  const onMegMatrix = async () => {
    onMegNote(null);
    onMegError(null);
    const { megMatrix } = await import("../../export/meg");
    const r = megMatrix(matrixInput as DistanceInput, title);
    if (!r.ok) {
      const m = errorMessage(r.error);
      onMegError(`${m.title} ${m.body}`);
      return;
    }
    download(
      "matrix.meg",
      new Blob([r.value.text], { type: "text/plain" }),
    );
    if (r.value.renamed.length > 0) onMegNote(megRenameNote(r.value.renamed));
  };

  return (
    <>
      {/* No alignment exports in a matrix session — no FASTA, no
          alignment .meg, no consensus (v1.4c spec §6.3). */}
      <button
        type="button"
        disabled={matrixInput === null}
        onClick={() => void onMatrixR()}
      >
        R script
      </button>
      <button
        type="button"
        disabled={matrix === null}
        onClick={() => void onMatrixPhylip()}
      >
        Matrix (PHYLIP)
      </button>
      <button
        type="button"
        disabled={matrixInput === null}
        onClick={() => void onMegMatrix()}
      >
        Matrix (.meg)
      </button>
    </>
  );
}
