// The `?editor` page root (v1.4 plan Task 8): boots the wasm engine,
// builds the shared EditorHistory on the starter tree and mounts
// EditorPanel. Mounted from main.tsx as a lazy chunk so the editor
// (and Task 10's ajv import) never enters the initial bundle.

import { useEffect, useState } from "react";

import { EditorHistory } from "../../editor/history";
import { engine, initEngine } from "../../engine/index";
import "../../design/fonts.css";

import { Wordmark } from "../Wordmark";
import { EditorPanel } from "./EditorPanel";

/** The starter tree a new exercise begins with — the nj-basics example. */
const STARTER_NEWICK = "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);";

export function EditorPage() {
  const [model, setModel] = useState<EditorHistory | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    initEngine()
      .then(() => engine.parseNewick(STARTER_NEWICK))
      .then((r) => {
        if (cancelled) return;
        if (r.ok) {
          setModel(new EditorHistory(r.value));
        } else {
          setError(
            `The starter tree could not be parsed (${r.error.kind}).`,
          );
        }
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setError(`The NeoPhylo engine could not be loaded. ${String(e)}`);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <main className="editor-page">
      <header className="editor-page-head">
        <a
          className="editor-home"
          href={import.meta.env.BASE_URL}
          aria-label="Back to NeoPhylo"
        >
          <Wordmark size="sm" />
        </a>
      </header>
      {error !== null && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {error === null && model === null && (
        <p className="editor-loading">Loading the NeoPhylo engine…</p>
      )}
      {model !== null && <EditorPanel model={model} />}
    </main>
  );
}
