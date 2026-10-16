// Sandbox import box (plan Task 20, spec §3.1 and §6.2). Rendered only
// while the session source is "sandbox"; the lesson → sandbox switch
// lives in App. The format is auto-detected: input whose first
// non-space character is ">" goes to engine.parseFasta, everything else
// to engine.parseNewick.
//
// Error flow: a parse failure is stored locally and shown under the
// box; a successful parse dispatches importAlignment/importTree and any
// downstream failure (too few taxa, ragged alignment, label mismatch)
// arrives back through session.error. SaturatedMatrix is handled by the
// §6.3 teaching notice instead of being repeated here.

import { useRef, useState } from "react";
import type { Dispatch } from "react";

import { engine } from "../engine";
import type { NeoError } from "../engine/generated/NeoError";
import { errorMessage } from "../explain/errors";
import type { Action, Session } from "../state/session";

export interface ImportPanelProps {
  session: Session;
  dispatch: Dispatch<Action>;
}

const ACCEPT = ".fasta,.fa,.fas,.nwk,.tre,.txt";

export function ImportPanel({ session, dispatch }: ImportPanelProps) {
  const [text, setText] = useState("");
  const [localError, setLocalError] = useState<NeoError | null>(null);
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
      dispatch({ type: "importAlignment", alignment: r.value });
    } else {
      const r = engine.parseNewick(input);
      if (!r.ok) {
        setLocalError(r.error);
        return;
      }
      setLocalError(null);
      dispatch({ type: "importTree", tree: r.value });
    }
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
        onClick={() =>
          dispatch({
            type: "load",
            exercise: session.exercise,
            source: "lesson",
          })
        }
      >
        Back to the lesson
      </button>
    </section>
  );
}
