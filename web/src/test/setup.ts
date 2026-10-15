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
