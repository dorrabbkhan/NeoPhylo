// The one-click paste loop every matrix route shares (v1.4c spec
// §6.1): detect the format, parse, and when the engine answers
// MatrixAmbiguous ask its question — first-column names, header row,
// decimal comma — then re-parse with that option set. Questions can
// chain (the engine asks header before name column), so the loop runs
// until Ok or a real error, never more than three questions
// (conductor's call, v1.4c Task 8 notes). An asymmetric square PHYLIP
// paste offers "Use the lower triangle" and re-parses with
// use_lower_if_asymmetric.
//
// Task 9 extracts this from MatrixImport so the editor's matrix route
// runs the exact same questions and answers — never a second parser.

import { useState } from "react";

import { engine } from "../../engine/index";
import type { MatrixFile } from "../../engine/generated/MatrixFile";
import type { NeoError } from "../../engine/generated/NeoError";
import type { PasteOptions } from "../../engine/generated/PasteOptions";
import type { PasteQuestion } from "../../engine/generated/PasteQuestion";

/** The asymmetric-square `InvalidMatrix` that offers the
 * lower-triangle re-parse (matrix_parse.rs). */
const ASYMMETRIC = "matrix is not symmetric";

/** Questions can chain — never more than three (conductor's call). */
const MAX_QUESTIONS = 3;

/** The pasted-text options the question buttons settle, one at a
 * time. The engine maps each `PasteQuestion` to one option field. */
export const PASTE_QUESTION: Record<
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

export interface PasteResult {
  file: MatrixFile | null;
  question: PasteQuestion | null;
  error: NeoError | null;
}

/** Parse `text` as a matrix file or paste, answering pending
 * questions from `opts`. Returns the MatrixFile, the next pending
 * question, or a real error. */
export function parseMatrixText(
  text: string,
  opts: PasteOptions,
  useLower: boolean,
): PasteResult {
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

/** The whole paste state machine: textarea value, the pending
 * ambiguity question and the answers collected so far, the
 * asymmetric-square offer, the last real error and the parsed file's
 * notices. `onCommit` runs once per successful parse; `accept` also
 * drives a file-picker import. */
export function useMatrixPaste(
  onCommit: (f: MatrixFile, name: string | null) => void,
) {
  const [text, setText] = useState("");
  const [opts, setOpts] = useState<PasteOptions>(EMPTY_OPTS);
  const [asked, setAsked] = useState(0);
  const [question, setQuestion] = useState<PasteQuestion | null>(null);
  const [offerLower, setOfferLower] = useState(false);
  const [error, setError] = useState<NeoError | null>(null);
  const [notices, setNotices] = useState<string[]>([]);

  const commit = (f: MatrixFile, name: string | null) => {
    setQuestion(null);
    setOfferLower(false);
    setError(null);
    setNotices(f.notices);
    onCommit(f, name);
  };

  const fail = (e: NeoError) => {
    setQuestion(null);
    setError(e);
    setOfferLower(
      e.kind === "InvalidMatrix" && e.msg.startsWith(ASYMMETRIC),
    );
  };

  const settle = (r: PasteResult) => {
    if (r.file !== null) commit(r.file, null);
    else if (r.question !== null) {
      setAsked(1);
      setError(null);
      setQuestion(r.question);
    } else if (r.error !== null) fail(r.error);
  };

  /** The Import/parse button for the pasted text. */
  const importText = () => {
    const r = parseMatrixText(text, EMPTY_OPTS, false);
    setAsked(0);
    setOpts(EMPTY_OPTS);
    settle(r);
  };

  /** One click on an ambiguity question's answer. */
  const answer = (q: PasteQuestion, a: boolean) => {
    const next = { ...opts, [PASTE_QUESTION[q].field]: a };
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

  /** The "Use the lower triangle" offer on an asymmetric square. */
  const useLower = () => {
    const r = parseMatrixText(text, opts, true);
    if (r.file !== null) commit(r.file, null);
    else if (r.question !== null) setQuestion(r.question);
    else if (r.error !== null) fail(r.error);
  };

  /** A file picked from the OS dialog — parsed like a paste, with the
   * file's base name as the fallback title. */
  const onFile = async (f: File) => {
    const input = await f.text();
    setText(input);
    setAsked(0);
    setOpts(EMPTY_OPTS);
    const r = parseMatrixText(input, EMPTY_OPTS, false);
    if (r.file !== null) commit(r.file, f.name.replace(/\.[^.]+$/, ""));
    else settle(r);
  };

  /** Typing re-arms the ambiguity flow from scratch. */
  const changeText = (next: string) => {
    setText(next);
    setQuestion(null);
    setOfferLower(false);
    setAsked(0);
    setOpts(EMPTY_OPTS);
  };

  return {
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
  };
}
