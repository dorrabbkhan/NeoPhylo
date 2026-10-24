// Device-local presenter preference (v1.3 spec §6.6, §7.4). Presenter
// mode lives on <html data-presenter> — where the generated tokens.css
// block reads it to scale the type and spacing tokens 1.5× — and in
// the neophylo.presenter localStorage key, never in shared links.
// Storage reads and writes are try/catch-guarded: where storage is
// blocked the app still works, defaulting to off and keeping the
// toggle session-only.
//
// The index.html inline script repeats readPresenterPref()'s logic so
// data-presenter is set before first paint, ahead of module loading.

export const PRESENTER_STORAGE_KEY = "neophylo.presenter";

/** The stored presenter flag, or false — the default on any missing,
 * unrecognized or unreadable value. */
export function readPresenterPref(): boolean {
  try {
    return window.localStorage.getItem(PRESENTER_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/** Applies the flag to <html data-presenter> and persists it; a
 * storage failure still applies the mode for the rest of the
 * session. The attribute is present only while the mode is on, so
 * the bare `:root[data-presenter]` selector carries it. */
export function applyPresenter(presenter: boolean): void {
  if (presenter) {
    document.documentElement.dataset.presenter = "true";
  } else {
    delete document.documentElement.dataset.presenter;
  }
  try {
    window.localStorage.setItem(
      PRESENTER_STORAGE_KEY,
      presenter ? "1" : "0",
    );
  } catch {
    // Blocked storage — the session flag above still stands.
  }
}
