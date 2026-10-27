// App root switch (v1.4 Task 8): `?editor` mounts the exercise editor
// instead of the lesson app. The editor is a lazy chunk — it (and Task
// 10's ajv import) must never enter the initial bundle (§8.2 budget).
// App never mounts on this route, so its URL replaceState sync can't
// strip the param; the editor page is a full reload back to "/" away.
//
// This is a separate file because main.tsx is a side-effect-only entry
// — react-refresh's only-export-components rule requires component
// definitions to live in a module with exports.

import { lazy, Suspense } from "react";

import { App } from "./views/App";

const EditorPage = lazy(() =>
  import("./views/editor/EditorPage").then((m) => ({
    default: m.EditorPage,
  })),
);

// Fix round 3: `?preview=<nonce>` is the preview tab the editor opens —
// the exercise arrives over postMessage, so the receiver (and its ajv
// import) is a lazy chunk like the editor, never the initial bundle.
const PreviewPage = lazy(() =>
  import("./views/PreviewPage").then((m) => ({
    default: m.PreviewPage,
  })),
);

const params = new URLSearchParams(window.location.search);
const editorRoute = params.has("editor");
const previewRoute = params.has("preview");

const LOADING = (
  <div className="app-loading">
    <p>Loading the NeoPhylo engine…</p>
  </div>
);

export function Root() {
  if (previewRoute) {
    return (
      <Suspense fallback={LOADING}>
        <PreviewPage />
      </Suspense>
    );
  }
  if (editorRoute) {
    return (
      <Suspense
        fallback={
          <div className="app-loading">
            <p>Loading the NeoPhylo engine…</p>
          </div>
        }
      >
        <EditorPage />
      </Suspense>
    );
  }
  return <App />;
}
