import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import type { Connect, Plugin } from "vite";
import { VitePWA } from "vite-plugin-pwa";
import { defineConfig } from "vitest/config";

import { writeLicensesPage } from "./scripts/licenses.ts";
import { tokensCssPlugin } from "./src/design/tokensCssPlugin.ts";

// Lesson files live in the repo-level exercises/ directory (spec §7),
// outside Vite's root. loadLesson fetches `/exercises/<id>.json`, so this
// plugin serves that prefix in dev and copies the .json files into the
// build output ("copied to public/ at build", plan Task 21).
const EXERCISES_DIR = fileURLToPath(new URL("../exercises", import.meta.url));
const REPO_ROOT = fileURLToPath(new URL("..", import.meta.url));

// licenses.html (v1.1 release docs §C): combined third-party notices for
// the shipped app — THIRD_PARTY_NOTICES.md plus the Rust crates
// (cargo-about artifact from the licenses CI job, or a local
// `cargo about generate`, or a placeholder when neither exists) plus npm
// production deps. Written into public/ at build start so it is served
// at /licenses.html in dev and copied into dist; the file is gitignored.
// A dependency license outside the accepted list (about.toml /
// ACCEPTED_LICENSES) throws here and fails the build.
function licensesPlugin(): Plugin {
  let generated = false;
  const generate = () => {
    writeLicensesPage(REPO_ROOT);
    generated = true;
  };
  return {
    name: "neophylo-licenses",
    buildStart: generate,
    configureServer() {
      if (!generated) generate();
    },
  };
}

function exercisesPlugin(): Plugin {
  let outDir = "dist";
  const send = (
    req: Connect.IncomingMessage,
    res: import("node:http").ServerResponse,
    next: Connect.NextFunction,
  ) => {
    const name = decodeURIComponent((req.url ?? "").split("?")[0]).replace(
      /^\/+/,
      "",
    );
    // Only serve flat .json names — anything else falls through.
    if (!/^[\w.-]+\.json$/.test(name)) {
      next();
      return;
    }
    const file = join(EXERCISES_DIR, name);
    if (!existsSync(file)) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", "application/json");
    res.end(readFileSync(file));
  };
  return {
    name: "neophylo-exercises",
    configResolved(config) {
      outDir = resolve(config.root, config.build.outDir);
    },
    configureServer(server) {
      server.middlewares.use("/exercises", send);
    },
    closeBundle() {
      if (!existsSync(EXERCISES_DIR)) return;
      const dest = resolve(outDir, "exercises");
      for (const f of readdirSync(EXERCISES_DIR)) {
        if (extname(f) === ".json") {
          cpSync(join(EXERCISES_DIR, f), join(dest, f), { recursive: true });
        }
      }
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // GitHub Pages serves the repo site under /<repo>/. Deploy sets
  // NEOPHYLO_BASE (see .github/workflows/deploy.yml); dev, tests and
  // `vite preview` keep the default "/".
  base: process.env.NEOPHYLO_BASE ?? "/",
  plugins: [
    react(),
    exercisesPlugin(),
    licensesPlugin(),
    // Generated src/design/tokens.css from the TS tokens (spec §3.1) —
    // regenerated at dev-server start and build start.
    tokensCssPlugin(),
    // Offline after first load (spec §2.1): precache the app shell, the
    // wasm engine asset and the copied exercises/*.json — the defaults
    // exclude .wasm and .json. navigateFallback (index.html) is the
    // plugin default, so lesson URLs also resolve offline.
    VitePWA({
      registerType: "autoUpdate",
      workbox: {
        // `**/*.js` also covers the emitted bootstrap worker chunk, so
        // bootstrap runs work offline (v1.2 spec §5); `*.woff2` precaches
        // the bundled fonts (v1.3 spec §4.2).
        globPatterns: ["**/*.{js,css,html,svg,wasm,json,woff2}"],
        // The wasm engine (~300 KB today) plus everything else stays
        // well under this; the default 2 MiB cap would silently drop a
        // growing wasm.
        maximumFileSizeToCacheInBytes: 8 * 1024 * 1024,
      },
      manifest: {
        name: "NeoPhylo",
        short_name: "NeoPhylo",
        description: "Distance-based phylogenetics, step by step",
        theme_color: "#6d28d9",
        background_color: "#ffffff",
        display: "standalone",
        icons: [
          { src: "favicon.svg", sizes: "any", type: "image/svg+xml" },
          { src: "icons.svg", sizes: "any", type: "image/svg+xml" },
        ],
      },
    }),
  ],
  worker: {
    // The bootstrap worker is constructed with `{ type: "module" }`
    // (v1.2 Task 9); the build must emit an ES worker bundle.
    format: "es",
  },
  server: {
    // The default lesson embeds exercises/nj-basics.json via a ?raw
    // import (Task 23); the exercises dir is outside web/, so the fs
    // guard must allow the repo root (dev server + vitest transforms).
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    // Vitest tests live under src/ and scripts/; e2e/*.spec.ts are
    // Playwright's.
    include: ["src/**/*.{test,spec}.{ts,tsx}", "scripts/**/*.test.ts"],
  },
});
