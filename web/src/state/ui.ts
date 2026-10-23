// The UI slice of Session (v1.3 spec §7.1): the Concept/Math mode plus
// the viewer prefs — theme, presenter, drawer and tour step. The theme
// is device-local (neophylo.theme, light by default; design/theme.ts);
// presenter/tour wiring lands in Tasks 11 and 12.

import { readThemePref } from "../design/theme";
import type { ThemeName } from "../design/tokens";

import type { Action } from "./actions";
import type { Session } from "./session";

/** The Session slice owned by `uiReducer`. */
export interface UiState {
  mode: "concept" | "math";
  /** Light-first theme on <html data-theme> (spec §3.3). */
  theme: ThemeName;
  /** Presenter mode flag; the scaling lands in Task 11 (spec §6.6). */
  presenter: boolean;
  /** Settings drawer open flag; the drawer lands in Task 10 (§6.4). */
  drawerOpen: boolean;
  /** First-visit tour position; the tour lands in Task 12 (§6.7). */
  tourStep: number | null;
}

export function uiInitial(): UiState {
  return {
    mode: "concept",
    theme: readThemePref(),
    presenter: false,
    drawerOpen: false,
    tourStep: null,
  };
}

/** The UI fields of a session — the input `uiReducer` sees. */
export function uiSlice(s: Session): UiState {
  return {
    mode: s.mode,
    theme: s.theme,
    presenter: s.presenter,
    drawerOpen: s.drawerOpen,
    tourStep: s.tourStep,
  };
}

/** UI-slice reducer: handles the actions that only touch UI state and
 * returns `slice` unchanged for the rest. `ctx` is the pre-action
 * session (read-only) for slices that need read access to other
 * slices; the UI slice needs none. */
export function uiReducer(slice: UiState, a: Action, ctx: Session): UiState {
  void ctx; // the UI slice reads no other slices
  if (a.type === "setMode") return { ...slice, mode: a.mode };
  if (a.type === "setTheme") return { ...slice, theme: a.theme };
  if (a.type === "setDrawer") return { ...slice, drawerOpen: a.open };
  // Task 10 (§6.4): opening the replicate sheet from inside the
  // drawer dismisses the drawer — one modal on screen, not two.
  if (a.type === "setReplicateIndex" && a.index !== null) {
    return { ...slice, drawerOpen: false };
  }
  return slice;
}
