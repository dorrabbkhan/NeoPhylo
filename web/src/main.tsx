import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { BootstrapClient, bootstrapClient } from "./engine/bootstrapClient";
import { engine } from "./engine";
import { watchReadingLinks } from "./reading/hashWatch";
import { Root } from "./Root.tsx";
import { ErrorBoundary } from "./views/ErrorBoundary.tsx";

// v1.2 Task 9: the `neophylo-e2e` localStorage flag exposes the engine
// and bootstrap client so the worker specs can drive real jobs until
// Task 10 wires the client into the session. A query param doesn't
// work — the app's URL replaceState sync strips unknown params, and
// localStorage survives reloads (needed for the offline spec).
try {
  if (window.localStorage.getItem("neophylo-e2e") === "1") {
    (window as unknown as { __neophylo: unknown }).__neophylo = {
      engine,
      bootstrapClient,
      BootstrapClient,
    };
  }
} catch {
  // localStorage can throw where storage is disabled; the hook is
  // e2e-only, so a failure just means no hook.
}

// Root's route is picked once, at module load — a fragment-only
// navigation that crosses a `#r=` boundary must reload to re-pick it
// (checkpoint fix, owner decision 2026-11-22).
watchReadingLinks();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <Root />
    </ErrorBoundary>
  </StrictMode>,
);
