// The editor's matrix route (v1.4c spec §6.4; plan Task 9): the
// controls the settings form shows while "Start from a matrix" is
// the exercise's data — paste one through the exact paste loop the
// sandbox's MatrixImport uses (matrixPaste.ts — never a second
// parser), type one into the lazy MatrixGrid sheet, or derive one
// from the drawn tree through engine.additiveMatrix.
//
// A commit is the draft's EditorMatrix: the DistanceInput, a blank
// Source for `data.source`, the preset's alphabet, and `derivedFrom`
// — writeNewick's canonical text of the tree at derive time, null for
// anything typed or pasted. The settings form compares it to the
// tree's current writeNewick: a mismatch is the "the tree changed"
// line, and the author presses Derive again — a stale matrix is
// never silently saved (conductor's call, documented in
// docs/decisions.md).

import { lazy, Suspense, useRef, useState } from "react";

import type { EditorMatrix } from "../../editor/draft";
import { engine } from "../../engine/index";
import type { Alphabet } from "../../engine/generated/Alphabet";
import type { DistanceInput } from "../../engine/generated/DistanceInput";
import type { Tree } from "../../engine/generated/Tree";
import { errorMessage } from "../../explain/errors";
import { PASTE_QUESTION, useMatrixPaste } from "../matrix/matrixPaste";

// The typing grid is a lazy chunk inside this already-lazy editor
// chunk — fetched on the first "Type a matrix…" click, never with
// the panel or the initial bundle (the budget's hard rule).
const MatrixGridSheet = lazy(() =>
  import("../matrix/MatrixGridSheet").then((m) => ({
    default: m.MatrixGridSheet,
  })),
);

import "../matrix/matrix.css";

export interface MatrixDataProps {
  /** The drawn tree — the derive source and the stale check's
   * reference. */
  tree: Tree;
  /** The committed matrix, or null while none exists. */
  matrix: EditorMatrix | null;
  /** The alphabet a fresh commit writes (the hidden model preset's —
   * `data.alphabet` is required and describes the distances' source
   * data). */
  alphabet: Alphabet;
  onCommit(m: EditorMatrix): void;
}

/** `data.source` for a typed, pasted or derived matrix — the editor
 * collects no citation fields. */
const BLANK_SOURCE = { citation: "", license: "", accessions: [] };

/** The "Round to" choices — decimal places passed to
 * `engine.additiveMatrix`; the engine does every bit of the math. */
const ROUND_CHOICES = [
  { value: "none", label: "No rounding" },
  { value: "0", label: "Whole numbers" },
  { value: "1", label: "1 decimal" },
  { value: "2", label: "2 decimals" },
];

export function MatrixData({
  tree,
  matrix,
  alphabet,
  onCommit,
}: MatrixDataProps) {
  const [round, setRound] = useState("none");
  const [deriveError, setDeriveError] = useState<string | null>(null);
  const [gridMounted, setGridMounted] = useState(false);
  const [gridOpen, setGridOpen] = useState(false);
  const openButtonRef = useRef<HTMLButtonElement>(null);

  const paste = useMatrixPaste((f) =>
    onCommit({
      input: f.matrix,
      source: { ...BLANK_SOURCE, accessions: [] },
      derivedFrom: null,
      alphabet,
    }),
  );

  const commit = (input: DistanceInput, derivedFrom: string | null) =>
    onCommit({
      input,
      source: { ...BLANK_SOURCE, accessions: [] },
      derivedFrom,
      alphabet,
    });

  const derive = () => {
    const r = engine.additiveMatrix(
      tree,
      round === "none" ? null : Number(round),
    );
    if (!r.ok) {
      const m = errorMessage(r.error);
      setDeriveError(`${m.title}. ${m.body}`);
      return;
    }
    setDeriveError(null);
    commit(r.value, engine.writeNewick(tree));
  };

  /** The grid's commit channel: Build tree emits the finished
   * DistanceInput; uncommitted edits emit null and are ignored — the
   * draft's committed matrix stays (a matrix exercise never
   * half-saves). */
  const onGridChange = (input: DistanceInput | null) => {
    if (input !== null) commit(input, null);
  };

  // The stale check (documented in decisions.md): the derivedFrom
  // marker is writeNewick's canonical text, so an edit after a derive
  // — any accepted edit writes a new tree — flags the drift and the
  // author re-derives. Never a silent stale save.
  const stale =
    matrix !== null &&
    matrix.derivedFrom !== null &&
    matrix.derivedFrom !== engine.writeNewick(tree);

  const pasteError =
    paste.error !== null ? errorMessage(paste.error) : null;
  const tooManyTaxa =
    matrix !== null && matrix.input.names.length > 30;

  return (
    <div className="matrix-data">
      <div className="matrix-paste">
        <textarea
          aria-label="Paste a distance matrix"
          rows={4}
          value={paste.text}
          placeholder={
            "A lower triangle or square matrix — PHYLIP, .meg, or a\nplain table with the taxon names first."
          }
          onChange={(e) => paste.changeText(e.target.value)}
        />
        <div>
          <button
            type="button"
            className="btn btn-primary"
            disabled={paste.text.trim() === ""}
            onClick={paste.importText}
          >
            Use this matrix
          </button>
        </div>
      </div>
      {paste.question !== null && (
        <div
          className="matrix-question"
          role="group"
          aria-label="Matrix question"
        >
          <p>{PASTE_QUESTION[paste.question].text}</p>
          <div className="matrix-answers">
            {PASTE_QUESTION[paste.question].answers.map(([label, a]) => (
              <button
                key={label}
                type="button"
                className="btn btn-secondary"
                onClick={() => paste.answer(paste.question!, a)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}
      {paste.offerLower && (
        <div
          className="matrix-question"
          role="group"
          aria-label="Asymmetric matrix"
        >
          <div className="matrix-answers">
            <button
              type="button"
              className="btn btn-secondary"
              onClick={paste.useLower}
            >
              Use the lower triangle
            </button>
          </div>
        </div>
      )}
      {pasteError !== null && (
        <p className="field-error" role="alert">
          {pasteError.title}. {pasteError.body}
        </p>
      )}
      {paste.notices.length > 0 && (
        <ul className="phylip-note" role="status">
          {paste.notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
      <div className="settings-row matrix-derive-row">
        <button
          type="button"
          className="btn btn-secondary"
          ref={openButtonRef}
          onClick={() => {
            setGridMounted(true);
            setGridOpen(true);
          }}
          disabled={tooManyTaxa}
        >
          Type a matrix…
        </button>
        <button type="button" className="btn btn-secondary" onClick={derive}>
          Derive from the drawn tree
        </button>
        <label className="field matrix-round">
          <span>Round to</span>
          <select
            aria-label="Round to"
            value={round}
            onChange={(e) => setRound(e.target.value)}
          >
            {ROUND_CHOICES.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {round !== "none" && (
        <p className="editor-warning">
          Rounded distances may no longer fit this tree exactly.
        </p>
      )}
      {deriveError !== null && (
        <p className="editor-error" role="alert">
          {deriveError}
        </p>
      )}
      {matrix !== null && (
        <p className="editor-hint" role="status">
          {matrix.derivedFrom !== null
            ? `Derived from the drawn tree — ${matrix.input.names.length} taxa.`
            : `A matrix is committed — ${matrix.input.names.length} taxa.`}
        </p>
      )}
      {stale && (
        <p className="editor-warning" role="alert">
          The drawn tree changed since this matrix was derived — press
          Derive from the drawn tree again to refresh it.
        </p>
      )}
      {tooManyTaxa && (
        <p className="editor-hint">
          This matrix has {matrix!.input.names.length} taxa — the
          typing grid holds up to 30. Paste or derive to change it.
        </p>
      )}
      {gridMounted && (
        <Suspense fallback={null}>
          <MatrixGridSheet
            open={gridOpen}
            value={matrix?.input ?? null}
            onChange={onGridChange}
            onClose={() => {
              setGridOpen(false);
              // Same focus contract as the import tab's sheet: the
              // mounted sheet can't restore focus itself (it stays
              // mounted, hidden), so the opener is the stable target.
              openButtonRef.current?.focus();
            }}
          />
        </Suspense>
      )}
    </div>
  );
}
