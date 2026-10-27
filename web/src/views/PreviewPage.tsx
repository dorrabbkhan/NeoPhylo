// The `?preview=<nonce>` page root (v1.4 Task 10 fix round 3 — owner
// decision: preview at any exercise size). The editor's Preview button
// opens this route in a new tab carrying ONLY the handshake nonce; the
// exercise itself arrives over postMessage (src/editor/preview.ts) and
// is re-validated through the shared import path before the ordinary
// lesson player mounts — exactly what a student sees, unchanged.
// Lazy-loaded like EditorPage so exerciseFile.ts's ajv never enters
// the initial bundle (§8.2 budget). Every failure — no opener, no
// reply, an invalid exercise — is a readable line, never a blank page.

import { useEffect, useState } from "react";

import {
  PREVIEW_NO_OPENER,
  requestPreviewExercise,
} from "../editor/preview";
import { initEngine } from "../engine/index";
import type { Exercise } from "../engine/generated/Exercise";

import { App } from "./App";

export function PreviewPage() {
  // The nonce is read once: the mounted App's own URL sync will
  // replace the address with the player's `#x=` state.
  const [nonce] = useState(
    () =>
      new URLSearchParams(window.location.search).get("preview") ?? "",
  );
  const [error, setError] = useState<string | null>(
    nonce === "" ? PREVIEW_NO_OPENER : null,
  );
  const [exercise, setExercise] = useState<Exercise | null>(null);

  useEffect(() => {
    if (nonce === "") return;
    let cancelled = false;
    let cancel = () => {};
    // loadWireExercise runs engine.loadExercise, so the wasm must be
    // up before the handshake can answer.
    void initEngine().then(() => {
      if (cancelled) return;
      cancel = requestPreviewExercise({
        nonce,
        opener: window.opener ?? null,
        onReply: (r) => {
          if (r.ok) setExercise(r.exercise);
          else setError(r.error);
        },
      });
    });
    return () => {
      cancelled = true;
      cancel();
    };
  }, [nonce]);

  if (exercise !== null) return <App exercise={exercise} />;
  return (
    <main className="editor-page">
      {error === null ? (
        <p className="editor-loading">Opening the preview…</p>
      ) : (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </main>
  );
}
