// The `?editor` page root (v1.4 plan Task 8): boots the wasm engine,
// builds the shared EditorHistory on the starter tree and mounts
// EditorPanel. Mounted from main.tsx as a lazy chunk so the editor
// (and Task 10's ajv import) never enters the initial bundle.

import { lazy, Suspense, useEffect, useState } from "react";

import { EditorHistory } from "../../editor/history";
import { engine, initEngine } from "../../engine/index";
import "../../design/fonts.css";

import { Wordmark } from "../Wordmark";
import { EditorPanel } from "./EditorPanel";

// v1.4d Task 10: the reading-set editor is its own lazy chunk, so the
// initial-JS budget never sees it (the budget is nearly full — never
// import it eagerly here).
const ReadingEditor = lazy(() =>
  import("./reading/ReadingEditor").then((m) => ({
    default: m.ReadingEditor,
  })),
);

/** The starter tree a new exercise begins with — the nj-basics example. */
const STARTER_NEWICK = "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);";

type EditorMode = "exercise" | "reading";

export function EditorPage() {
  const [model, setModel] = useState<EditorHistory | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<EditorMode>("exercise");

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
      {model !== null && (
        <>
          <fieldset className="editor-mode">
            <legend>What are you making?</legend>
            <label className="editor-mode-opt">
              <input
                type="radio"
                name="editor-mode"
                checked={mode === "exercise"}
                onChange={() => setMode("exercise")}
              />
              Distance exercise
            </label>
            <label className="editor-mode-opt">
              <input
                type="radio"
                name="editor-mode"
                checked={mode === "reading"}
                onChange={() => setMode("reading")}
              />
              Tree reading set
            </label>
          </fieldset>
          {mode === "exercise" ? (
            <EditorPanel model={model} />
          ) : (
            <Suspense
              fallback={
                <p className="editor-loading">Loading the reading editor…</p>
              }
            >
              <ReadingEditor model={model} />
            </Suspense>
          )}
        </>
      )}
    </main>
  );
}
