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

import { engine } from "../../engine/index";
import { errorMessage } from "../../explain/errors";
import type { DistanceInput } from "../../engine/generated/DistanceInput";
import type { MatrixFile } from "../../engine/generated/MatrixFile";
import type { NeoError } from "../../engine/generated/NeoError";
import type { PasteOptions } from "../../engine/generated/PasteOptions";
import type { PasteQuestion } from "../../engine/generated/PasteQuestion";
import type { Action } from "../../state/actions";
import type { Session } from "../../state/session";

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

/** The asymmetric-square `InvalidMatrix` that offers the
 * lower-triangle re-parse (matrix_parse.rs). */
const ASYMMETRIC = "matrix is not symmetric";

/** Questions can chain — never more than three (conductor's call). */
const MAX_QUESTIONS = 3;

/** The pasted-text options the question buttons settle, one at a
 * time. The engine maps each `PasteQuestion` to one option field. */
const QUESTION: Record<
  PasteQuestion,
  { text: string; answers: [string, boolean][]; field: keyof PasteOptions }
> = {
  FirstColumnNames: {
    text: "Does the first column hold taxon names?",
    answers: [
      ["First column holds names", true],
      ["First column is distances", false],
    ],
    field: "first_column_names",
  },
  HeaderRow: {
    text: "Is the first row a header of names?",
    answers: [
      ["First row is a header", true],
      ["First row is data", false],
    ],
    field: "header_row",
  },
  DecimalComma: {
    text: "What does the comma mean?",
    answers: [
      ["Comma separates cells", false],
      ["Comma is a decimal mark", true],
    ],
    field: "decimal_comma",
  },
};

const EMPTY_OPTS: PasteOptions = {
  first_column_names: null,
  header_row: null,
  decimal_comma: null,
};

/** Parse `text` as a matrix file or paste, answering pending
 * questions from `opts`. Returns the MatrixFile, the next pending
 * question, or a real error. */
function parseMatrixText(
  text: string,
  opts: PasteOptions,
  useLower: boolean,
): { file: MatrixFile | null; question: PasteQuestion | null; error: NeoError | null } {
  const det = engine.detectMatrixFormat(text);
  if (det.ok && det.value !== null) {
    const r =
      det.value === "Meg"
        ? engine.parseMegMatrix(text)
        : engine.parsePhylipMatrix(text, {
            names: "Auto",
            use_lower_if_asymmetric: useLower,
          });
    if (r.ok) return { file: r.value, question: null, error: null };
    return { file: null, question: null, error: r.error };
  }
  const r = engine.parsePastedMatrix(text, opts);
  if (r.ok) return { file: r.value, question: null, error: null };
  if (r.error.kind === "MatrixAmbiguous") {
    return { file: null, question: r.error.question, error: null };
  }
  return { file: null, question: null, error: r.error };
}

export function MatrixImport({ session, dispatch }: MatrixImportProps) {
  const inMatrix = session.alignmentOrigin === "matrix";
  const [text, setText] = useState("");
  const [opts, setOpts] = useState<PasteOptions>(EMPTY_OPTS);
  const [asked, setAsked] = useState(0);
  const [question, setQuestion] = useState<PasteQuestion | null>(null);
  const [offerLower, setOfferLower] = useState(false);
  const [error, setError] = useState<NeoError | null>(null);
  const [notices, setNotices] = useState<string[]>([]);
  // The grid sheet: mounted on the first "Type a matrix…" click and
  // only `hidden` afterwards, so a close keeps the typed draft (the
  // grid's cells are its state — nothing else holds them).
  const [gridMounted, setGridMounted] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const openButtonRef = useRef<HTMLButtonElement>(null);

  const commit = (f: MatrixFile, name: string | null) => {
    setQuestion(null);
    setOfferLower(false);
    setError(null);
    setNotices(f.notices);
    dispatch({
      type: "importMatrix",
      input: f.matrix,
      name: f.title ?? name,
    });
  };

  const fail = (e: NeoError) => {
    setQuestion(null);
    setError(e);
    setOfferLower(
      e.kind === "InvalidMatrix" && e.msg.startsWith(ASYMMETRIC),
    );
  };

  const importText = () => {
    const r = parseMatrixText(text, EMPTY_OPTS, false);
    setAsked(0);
    setOpts(EMPTY_OPTS);
    if (r.file !== null) commit(r.file, null);
    else if (r.question !== null) {
      setAsked(1);
      setError(null);
      setQuestion(r.question);
    } else if (r.error !== null) fail(r.error);
  };

  const answer = (q: PasteQuestion, a: boolean) => {
    const next = { ...opts, [QUESTION[q].field]: a };
    const r = parseMatrixText(text, next, false);
    setOpts(next);
    if (r.file !== null) commit(r.file, null);
    else if (r.question !== null && asked < MAX_QUESTIONS) {
      setAsked(asked + 1);
      setQuestion(r.question);
    } else if (r.error !== null) fail(r.error);
    else {
      // Still ambiguous after MAX_QUESTIONS answers — never guessed.
      setQuestion(null);
      setError({
        kind: "Parse",
        line: 0,
        col: 0,
        msg: "couldn't settle the matrix layout; check the pasted text",
      });
    }
  };

  const useLower = () => {
    const r = parseMatrixText(text, opts, true);
    if (r.file !== null) commit(r.file, null);
    else if (r.question !== null) setQuestion(r.question);
    else if (r.error !== null) fail(r.error);
  };

  const onFile = async (f: File) => {
    const input = await f.text();
    setText(input);
    setAsked(0);
    setOpts(EMPTY_OPTS);
    const r = parseMatrixText(input, EMPTY_OPTS, false);
    if (r.file !== null) commit(r.file, f.name.replace(/\.[^.]+$/, ""));
    else if (r.question !== null) {
      setAsked(1);
      setError(null);
      setQuestion(r.question);
    } else if (r.error !== null) fail(r.error);
  };

  /** The grid's commit channel: a matrix session maps every change
   * to editMatrix (null while the draft is uncommitted); any other
   * session only sees Build-tree emits, which start it through
   * importMatrix. */
  const onGridChange = (input: DistanceInput | null) => {
    if (inMatrix) {
      dispatch({ type: "editMatrix", input });
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
          onChange={(e) => {
            setText(e.target.value);
            setQuestion(null);
            setOfferLower(false);
            setAsked(0);
            setOpts(EMPTY_OPTS);
          }}
        />
        <div>
          <button
            type="button"
            className="primary"
            disabled={text.trim() === ""}
            onClick={importText}
          >
            Import matrix
          </button>
        </div>
      </div>
      {question !== null && (
        <div className="matrix-question" role="group" aria-label="Matrix question">
          <p>{QUESTION[question].text}</p>
          <div className="matrix-answers">
            {QUESTION[question].answers.map(([label, a]) => (
              <button
                key={label}
                type="button"
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
            <button type="button" onClick={useLower}>
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
            className="matrix-open-grid"
            ref={openButtonRef}
            onClick={openGrid}
          >
            Type a matrix…
          </button>
          {gridMounted && !tooManyTaxa && (
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
