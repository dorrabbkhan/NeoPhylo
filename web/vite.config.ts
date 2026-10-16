import { cpSync, existsSync, readdirSync, readFileSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import type { Connect, Plugin } from "vite";
import { defineConfig } from "vitest/config";

// Lesson files live in the repo-level exercises/ directory (spec §7),
// outside Vite's root. loadLesson fetches `/exercises/<id>.json`, so this
// plugin serves that prefix in dev and copies the .json files into the
// build output ("copied to public/ at build", plan Task 21).
const EXERCISES_DIR = fileURLToPath(new URL("../exercises", import.meta.url));

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
  plugins: [react(), exercisesPlugin()],
  server: {
    // The default lesson embeds exercises/nj-basics.json via a ?raw
    // import (Task 23); the exercises dir is outside web/, so the fs
    // guard must allow the repo root (dev server + vitest transforms).
    fs: { allow: [fileURLToPath(new URL("..", import.meta.url))] },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["src/test/setup.ts"],
    // Vitest tests live under src/; e2e/*.spec.ts are Playwright's.
    include: ["src/**/*.{test,spec}.{ts,tsx}"],
  },
});
