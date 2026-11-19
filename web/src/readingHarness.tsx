// Dev-server-only harness entry (v1.4d plan Task 7): mounts
// ReadingHarness at /e2e/reading-harness.html under the Vite dev
// server. Nothing in the app imports this module — the component
// stays out of the initial bundle.

import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { initEngine } from "./engine";
import { ReadingHarness } from "./readingHarnessApp";

declare global {
  interface Window {
    __rt?: { selects: string[][]; rotations: string[][] };
  }
}

async function main() {
  await initEngine();
  window.__rt = { selects: [], rotations: [] };
  const root = document.getElementById("root");
  if (root === null) return;
  createRoot(root).render(
    <StrictMode>
      <ReadingHarness />
    </StrictMode>,
  );
  root.dataset.ready = "1";
}

void main();
