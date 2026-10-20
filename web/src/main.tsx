import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { BootstrapClient, bootstrapClient } from "./engine/bootstrapClient";
import { engine } from "./engine";
import { App } from "./views/App.tsx";
import { ErrorBoundary } from "./views/ErrorBoundary.tsx";

// v1.2 Task 9: `?e2e` exposes the engine and bootstrap client so the
// worker specs can drive real jobs until Task 10 wires the client into
// the session. URL decode ignores unknown params.
if (new URLSearchParams(window.location.search).has("e2e")) {
  (window as unknown as { __neophylo: unknown }).__neophylo = {
    engine,
    bootstrapClient,
    BootstrapClient,
  };
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
