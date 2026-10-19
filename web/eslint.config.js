import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist", "src/engine/pkg", "src/engine/generated"],
  },
  {
    files: ["**/*.{ts,tsx}"],
    extends: [
      js.configs.recommended,
      ...tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
    rules: {
      "no-restricted-properties": [
        "error",
        {
          object: "Math",
          property: "random",
          message:
            "No unseeded randomness (spec): the engine uses seeded RNGs only.",
        },
      ],
    },
  },
  {
    // Playwright config/specs and the build-time scripts run in Node,
    // not the browser.
    files: ["e2e/**/*.ts", "playwright.config.ts", "scripts/**/*.ts"],
    languageOptions: {
      globals: globals.node,
    },
  },
);
