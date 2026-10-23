/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { initSync } from "../engine/pkg/neophylo_wasm.js";

// Engine-dependent tests run against the real wasm module (plan M3 preamble).
// initSync is used because Vitest runs in Node, where the default fetch-based
// init cannot load a file: URL. Under the jsdom environment import.meta.url is
// an http URL, so the wasm path is resolved against the cwd (web/) instead.
const wasmUrl = new URL("../engine/pkg/neophylo_wasm_bg.wasm", import.meta.url);
const wasmPath =
  wasmUrl.protocol === "file:"
    ? fileURLToPath(wasmUrl)
    : resolve("src/engine/pkg/neophylo_wasm_bg.wasm");
initSync({ module: readFileSync(wasmPath) });

// jsdom has no ResizeObserver; a no-op stub lets components that measure
// their panels mount in tests — they fall back to default geometry.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}

// jsdom has no matchMedia either, so useBreakpoint falls back to
// innerWidth — its default 1024 px is the medium breakpoint, where the
// Task-10 Settings drawer replaces the controls column and existing
// tests would lose their controls. Pin the unit-test viewport at the
// wide edge (1280): tests exercising smaller breakpoints set
// innerWidth and dispatch `resize` themselves.
Object.defineProperty(window, "innerWidth", {
  configurable: true,
  writable: true,
  value: 1280,
});
