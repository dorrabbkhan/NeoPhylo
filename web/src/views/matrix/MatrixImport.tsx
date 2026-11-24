// The Distance-matrix tab of the import panel (v1.4c spec §6.1; plan
// Task 8). Three routes into one matrix workspace: open a .meg or
// PHYLIP distance file, paste matrix text, or type into the grid —
// the grid lives in the "Type a matrix…" sheet (fix round 2: a
// 5–10-taxon table never fit the import column; the sheet is lazy and
// stays mounted once opened, so the typed draft survives a close).
//
// Paste ambiguities are never guessed (spec §6.1): the engine's
// MatrixAmbiguous error carries one question at a time — first-column
// names, header row, decimal comma — and the UI answers it with one
// click, then re-parses with that option set. Questions can chain
// (the engine asks header before name column), so the paste loop runs
// until Ok or a real error, never more than three questions
// (conductor's call, v1.4c Task 8 notes). An asymmetric square PHYLIP
// paste offers "Use the lower triangle" and re-parses with
// use_lower_if_asymmetric.
//
// Grid wiring: while a matrix session runs, the grid's onChange maps
// to editMatrix — every uncommitted change emits null, dropping the
// session's matrix, tree and stepper to "complete the matrix" until
// the grid's Build-tree button emits the finished input (fix round
// 2's commit model); outside a matrix session only a Build-tree emit
// commits, through importMatrix.

import { lazy, Suspense, useRef, useState } from "react";

import { errorMessage } from "../../explain/errors";
import type { DistanceInput } from "../../engine/generated/DistanceInput";
import type { Action } from "../../state/actions";
import type { Session } from "../../state/session";

import { PASTE_QUESTION, useMatrixPaste } from "./matrixPaste";

// The grid and its Sheet are a lazy chunk inside this already-lazy
// tab (fix round 2): fetched on the first "Type a matrix…" click,
// never with the import panel.
const MatrixGridSheet = lazy(() =>
  import("./MatrixGridSheet").then((m) => ({
    default: m.MatrixGridSheet,
  })),
);

import "./matrix.css";

export interface MatrixImportProps {
  session: Session;
  dispatch: (a: Action) => void;
}

export function MatrixImport({ session, dispatch }: MatrixImportProps) {
  const inMatrix = session.alignmentOrigin === "matrix";
  const {
    text,
    changeText,
    question,
    offerLower,
    error,
    notices,
    importText,
    answer,
    useLower,
    onFile,
  } = useMatrixPaste((f, name) =>
    dispatch({
      type: "importMatrix",
      input: f.matrix,
      name: f.title ?? name,
    }),
  );
  // The grid sheet: mounted on the first "Type a matrix…" click and
  // only `hidden` afterwards, so a close keeps the typed draft (the
  // grid's cells are its state — nothing else holds them).
  const [gridMounted, setGridMounted] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const openButtonRef = useRef<HTMLButtonElement>(null);

  /** The grid's commit channel: a matrix session maps every change
   * to editMatrix (null while the draft is uncommitted); any other
   * session only sees Build-tree emits, which start it through
   * importMatrix. */
  const onGridChange = (input: DistanceInput | null, draftReady?: boolean) => {
    if (inMatrix) {
      dispatch({ type: "editMatrix", input, draftReady });
    } else if (input !== null) {
      dispatch({ type: "importMatrix", input, name: null });
    }
  };

  const openGrid = () => {
    setGridMounted(true);
    setGridOpen(true);
  };
  const closeGrid = () => {
    setGridOpen(false);
    // Sheet can't return focus itself — it stays mounted (hidden), so
    // its unmount-time restore never runs. The opener is the one
    // stable target (fix round 2).
    openButtonRef.current?.focus();
  };

  const shown = error !== null ? errorMessage(error) : null;
  const gridValue = inMatrix ? session.matrixInput : null;
  const tooManyTaxa =
    gridValue !== null && gridValue.names.length > 30;

  return (
    <div className="matrix-import">
      <p className="matrix-route-label">
        Open a .meg or PHYLIP distance file, paste a matrix, or type
        one into the grid. Three to two hundred taxa; the typing grid
        holds up to 30.
      </p>
      <input
        type="file"
        aria-label="Open a matrix file"
        accept=".meg,.phy,.phylip,.txt"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void onFile(f);
          e.target.value = "";
        }}
      />
      <div className="matrix-paste">
        <textarea
          aria-label="Paste a distance matrix"
          rows={6}
          value={text}
          placeholder={
            "A lower triangle or square matrix — PHYLIP, .meg, or a\nplain table with the taxon names first."
          }
          onChange={(e) => changeText(e.target.value)}
        />
        <div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={text.trim() === ""}
            onClick={importText}
          >
            Import matrix
          </button>
        </div>
      </div>
      {question !== null && (
        <div className="matrix-question" role="group" aria-label="Matrix question">
          <p>{PASTE_QUESTION[question].text}</p>
          <div className="matrix-answers">
            {PASTE_QUESTION[question].answers.map(([label, a]) => (
              <button
                key={label}
                type="button"
                className="btn btn-secondary"
                onClick={() => answer(question, a)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {offerLower && (
        <div className="matrix-question" role="group" aria-label="Asymmetric matrix">
          <div className="matrix-answers">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={useLower}
            >
              Use the lower triangle
            </button>
          </div>
        </div>
      )}
      {shown !== null && (
        <p className="field-error" role="alert">
          {shown.title}. {shown.body}
        </p>
      )}
      {notices.length > 0 && (
        <ul className="phylip-note" role="status">
          {notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      {tooManyTaxa ? (
        <p className="matrix-route-label">
          This matrix has {gridValue!.names.length} taxa — the typing
          grid holds up to 30. Open a file or paste to work with it.
        </p>
      ) : (
        <>
          <button
            type="button"
            className="matrix-open-grid btn btn-secondary"
            ref={openButtonRef}
            onClick={openGrid}
          >
            Type a matrix…
          </button>
          {gridMounted && (
            <Suspense fallback={null}>
              <MatrixGridSheet
                open={gridOpen}
                value={gridValue}
                onChange={onGridChange}
                onClose={closeGrid}
              />
            </Suspense>
          )}
        </>
      )}
    </div>
  );
}
