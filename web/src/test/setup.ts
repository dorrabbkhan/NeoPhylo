/// <reference types="node" />
import { readFileSync } from "node:fs";

import { initSync } from "../engine/pkg/neophylo_wasm.js";

// Engine-dependent tests run against the real wasm module (plan M3 preamble).
// initSync is used because Vitest runs in Node, where the default fetch-based
// init cannot load a file: URL.
initSync({
  module: readFileSync(
    new URL("../engine/pkg/neophylo_wasm_bg.wasm", import.meta.url),
  ),
});
