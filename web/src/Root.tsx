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

// Task 11: the lab pages are lazy chunks for the same reason — the
// registry's ajv import must stay out of the initial bundle (§8.2).
const LabIndex = lazy(() =>
  import("./views/labs/LabIndex").then((m) => ({ default: m.LabIndex })),
);
const LabPage = lazy(() =>
  import("./views/labs/LabPage").then((m) => ({ default: m.LabPage })),
);

// v1.4c Task 11: the worksheet and key pages are lazy chunks too —
// the builders, the QR encoder and the instructor gate join the
// registry in deferring until the route is used (§8.2 budget).
const WorksheetPage = lazy(() =>
  import("./views/worksheets/WorksheetPage").then((m) => ({
    default: m.WorksheetPage,
  })),
);
const KeyPage = lazy(() =>
  import("./views/worksheets/KeyPage").then((m) => ({
    default: m.KeyPage,
  })),
);

// v1.4c Task 12: `?library` is the same kind of lazy route — the
// page's registries and worksheet builders stay out of the initial
// bundle like the lab index it absorbs (§8.2).
const LibraryPage = lazy(() =>
  import("./views/library/LibraryPage").then((m) => ({
    default: m.LibraryPage,
  })),
);

// v1.4c Task 13: `?guide` is a lazy route for the same reason — the
// raw guide markdown and the item registries it reads minutes from
// defer until the route is visited (§8.2).
const GuidePage = lazy(() =>
  import("./views/guide/GuidePage").then((m) => ({
    default: m.GuidePage,
  })),
);

// v1.4d Task 8: `?read=<id>` (a shipped set) and `#r=` links (a set
// in the fragment) mount the reading area — a lazy chunk like every
// non-app route so its state and controls stay off the initial path.
const ReadingPage = lazy(() =>
  import("./views/reading/ReadingPage").then((m) => ({
    default: m.ReadingPage,
  })),
);

// v1.5 Task 8: `#a=` assignment links and `?embed` mount the student
// flow and `?grade` mounts the Grade page — all lazy chunks, so
// none reaches the initial bundle either (§8.2).
const AssignmentStart = lazy(() =>
  import("./views/assignment/AssignmentStart").then((m) => ({
    default: m.AssignmentStart,
  })),
);
const GradePage = lazy(() =>
  import("./views/grade/GradePage").then((m) => ({ default: m.GradePage })),
);

const params = new URLSearchParams(window.location.search);
const editorRoute = params.has("editor");
const previewRoute = params.has("preview");
const labsRoute = params.has("labs");
const libraryRoute = params.has("library");
const guideRoute = params.has("guide");
const labRoute = params.get("lab");
const readRoute = params.get("read");
const readHash = window.location.hash;
const worksheetRoute = params.get("worksheet");
const keyRoute = params.get("key");
const gradeRoute = params.has("grade");
// `?embed` routes to the student page; the frame auto-detect lives
// inside the lazy AssignmentStart (spec §7.4) so the try/catch never
// reaches the initial bundle.
const embedRoute = params.has("embed");

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
  if (labRoute !== null && labRoute !== "") {
    return (
      <Suspense fallback={LOADING}>
        <LabPage id={labRoute} />
      </Suspense>
    );
  }
  if (worksheetRoute !== null && worksheetRoute !== "") {
    return (
      <Suspense fallback={LOADING}>
        <WorksheetPage
          id={worksheetRoute}
          kind={params.get("kind") ?? "app"}
        />
      </Suspense>
    );
  }
  if (keyRoute !== null && keyRoute !== "") {
    return (
      <Suspense fallback={LOADING}>
        <KeyPage id={keyRoute} kind={params.get("kind") ?? "app"} />
      </Suspense>
    );
  }
  if (labsRoute) {
    return (
      <Suspense fallback={LOADING}>
        <LabIndex />
      </Suspense>
    );
  }
  if (libraryRoute) {
    return (
      <Suspense fallback={LOADING}>
        <LibraryPage />
      </Suspense>
    );
  }
  if (guideRoute) {
    return (
      <Suspense fallback={LOADING}>
        <GuidePage />
      </Suspense>
    );
  }
  // `#a=` wins like `#r=`: a shared-assignment link always carries
  // its own file, even when a stale query param rides along;
  // `?embed` (or a detected frame) mounts the same student page
  // without chrome (spec §7.4); `?grade` is the offline Grade page.
  if (readHash.includes("#a=") || embedRoute) {
    return (
      <Suspense fallback={LOADING}>
        <AssignmentStart embed={embedRoute} />
      </Suspense>
    );
  }
  if (gradeRoute) {
    return (
      <Suspense fallback={LOADING}>
        <GradePage />
      </Suspense>
    );
  }
  // `#r=` wins over `?read=`: a shared-set link always carries its
  // own set, even when a stale query param rides along.
  if (readHash.includes("#r=") || (readRoute !== null && readRoute !== "")) {
    return (
      <Suspense fallback={LOADING}>
        <ReadingPage id={readRoute} hash={readHash} />
      </Suspense>
    );
  }
  return <App />;
}
