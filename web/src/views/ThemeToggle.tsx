// Header theme toggle (v1.3 spec §3.3, §6.3): switches <html
// data-theme> between light and dark via the setTheme action.
// aria-pressed reflects "dark is on"; the App's theme effect mirrors
// the session theme to the DOM and the device-local neophylo.theme
// pref (design/theme.ts) — never to shared links.

import type { Dispatch } from "react";

import type { ThemeName } from "../design/tokens";
import type { Action } from "../state/session";

export interface ThemeToggleProps {
  theme: ThemeName;
  dispatch: Dispatch<Action>;
}

export function ThemeToggle({ theme, dispatch }: ThemeToggleProps) {
  const dark = theme === "dark";
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-pressed={dark}
      onClick={() =>
        dispatch({ type: "setTheme", theme: dark ? "light" : "dark" })
      }
    >
      Dark mode
    </button>
  );
}
