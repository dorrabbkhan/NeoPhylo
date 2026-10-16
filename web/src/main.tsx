import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import { App } from "./views/App.tsx";
import { ErrorBoundary } from "./views/ErrorBoundary.tsx";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
