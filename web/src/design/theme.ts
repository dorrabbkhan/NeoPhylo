// Device-local theme preference (v1.3 spec §3.3, §7.4). The theme lives
// on `<html data-theme>` and in the `neophylo.theme` localStorage key —
// never in shared links. Storage reads and writes are try/catch-guarded:
// where storage is blocked (private mode, policy) the app still works,
// falling back to the light default and keeping the toggle session-only.
//
// The index.html inline script repeats readThemePref()'s logic so
// data-theme is set before first paint, ahead of module loading.

import type { ThemeName } from "./tokens";

export const THEME_STORAGE_KEY = "neophylo.theme";

/** The stored theme, or "light" — the default regardless of the OS
 * prefers-color-scheme setting and of any storage failure. */
export function readThemePref(): ThemeName {
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === "dark"
      ? "dark"
      : "light";
  } catch {
    return "light";
  }
}

/** Applies `theme` to <html data-theme> and persists it; a storage
 * failure still applies the theme for the rest of the session. */
export function applyTheme(theme: ThemeName): void {
  document.documentElement.dataset.theme = theme;
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // Blocked storage — the session theme above still stands.
  }
}
