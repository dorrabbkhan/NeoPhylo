// Sandbox import box (plan Task 20, spec §3.1 and §6.2; PHYLIP support
// v1.1 plan Task 10, v1.1 spec §5.1). Rendered only while the session
// source is "sandbox"; the lesson → sandbox switch lives in App. The
// format is auto-detected: input whose first non-space character is ">"
// goes to engine.parseFasta, input whose first non-blank line is two
// numbers (`n m`, a PHYLIP header) goes to engine.parsePhylip, and
// everything else to engine.parseNewick.
//
// After a PHYLIP import a "Strict / Relaxed names" toggle shows the
// name mode Auto actually used; toggling it re-parses the same pasted
// text with that mode forced, so a mis-sniffed file can be corrected
// without re-pasting.
//
// Error flow: a parse failure is stored locally and shown under the
// box; a successful parse dispatches importAlignment/importTree and any
// downstream failure (too few taxa, ragged alignment, label mismatch)
// arrives back through session.error. SaturatedMatrix is handled by the
// §6.3 teaching notice instead of being repeated here.

import { useRef, useState } from "react";
import type { Dispatch } from "react";

import { engine } from "../engine";
import type { NameMode } from "../engine/generated/NameMode";
import type { NeoError } from "../engine/generated/NeoError";
import { errorMessage } from "../explain/errors";
import type { Action, Session } from "../state/session";
import { hasImportedData } from "../state/session";

export interface ImportPanelProps {
  session: Session;
  dispatch: Dispatch<Action>;
}

const ACCEPT = ".fasta,.fa,.fas,.nwk,.tre,.phy,.phylip,.txt";

/** True when the first non-blank line is a PHYLIP header `n m`
 * (v1.1 spec §5.1): one or more digits, whitespace, digits. */
function looksLikePhylip(input: string): boolean {
  const first = input.split(/\r?\n/).find((l) => l.trim() !== "") ?? "";
  return /^\s*\d+\s+\d+/.test(first);
}

export function ImportPanel({ session, dispatch }: ImportPanelProps) {
  const [text, setText] = useState("");
  const [localError, setLocalError] = useState<NeoError | null>(null);
  // The last pasted PHYLIP text and the name mode the parse used, so
  // the Strict/Relaxed toggle can re-parse without re-pasting.
  const [phylip, setPhylip] = useState<{
    text: string;
    namesUsed: NameMode;
  } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  if (session.source !== "sandbox") return null;

  const importText = (input: string) => {
    const t = input.trimStart();
    if (t === "") {
      setLocalError(null);
      return;
    }
    if (t.startsWith(">")) {
      const r = engine.parseFasta(input);
      if (!r.ok) {
        setLocalError(r.error);
        return;
      }
      setLocalError(null);
      setPhylip(null);
      dispatch({ type: "importAlignment", alignment: r.value });
    } else if (looksLikePhylip(input)) {
      importPhylip(input, "Auto");
    } else {
      const r = engine.parseNewick(input);
      if (!r.ok) {
        setLocalError(r.error);
        return;
      }
      setLocalError(null);
      setPhylip(null);
      dispatch({ type: "importTree", tree: r.value });
    }
  };

  const importPhylip = (input: string, names: NameMode) => {
    const r = engine.parsePhylip(input, names);
    if (!r.ok) {
      setLocalError(r.error);
      return;
    }
    setLocalError(null);
    setPhylip({ text: input, namesUsed: r.value.names_used });
    dispatch({ type: "importAlignment", alignment: r.value.alignment });
  };

  const onFile = async (file: File) => {
    importText(await file.text());
    // Reset so picking the same file again still fires onChange.
    if (fileRef.current !== null) fileRef.current.value = "";
  };

  const shown =
    localError ??
    (session.error !== null && session.error.kind !== "SaturatedMatrix"
      ? session.error
      : null);
  const msg = shown !== null ? errorMessage(shown) : null;

  return (
    <section className="import-panel" aria-label="Import data">
      <h2>Import data</h2>
      <label className="field import-text">
        <span>Paste sequences or a tree</span>
        <textarea
          rows={6}
          value={text}
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
        />
      </label>
      <div className="import-actions">
        <button type="button" onClick={() => importText(text)}>
          Import
        </button>
        <label className="field import-file">
          <span>Choose a file</span>
          <input
            ref={fileRef}
            type="file"
            accept={ACCEPT}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f !== undefined) void onFile(f);
            }}
          />
        </label>
      </div>
      {phylip !== null && (
        <div
          className="phylip-names"
          role="radiogroup"
          aria-label="PHYLIP name style"
        >
          <p className="import-hint">
            PHYLIP names: Strict takes the first 10 characters of each
            line; Relaxed ends the name at the first space.
          </p>
          {(["Strict", "Relaxed"] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              role="radio"
              aria-checked={phylip.namesUsed === mode}
              onClick={() => importPhylip(phylip.text, mode)}
            >
              {mode} names
            </button>
          ))}
        </div>
      )}
      {msg !== null && (
        <p role="alert" className="error">
          <strong>{msg.title}</strong> {msg.body}
        </p>
      )}
      <p className="import-hint">
        Gaps and ambiguous bases are skipped pair by pair.
      </p>
      <button
        type="button"
        onClick={() => {
          if (
            hasImportedData(session) &&
            !window.confirm(
              "Leave sandbox? Your imported data will be cleared.",
            )
          ) {
            return;
          }
          dispatch({ type: "exitSandbox" });
        }}
      >
        Back to the lesson
      </button>
    </section>
  );
}
