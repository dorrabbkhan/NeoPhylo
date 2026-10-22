// The UI slice of Session (v1.3 spec §7.1). Holds only `mode` for
// now; v1.3 Tasks 6, 10, 11 and 12 extend it with theme, presenter,
// drawer and tour state.

import type { Action } from "./actions";
import type { Session } from "./session";

/** The Session slice owned by `uiReducer`. */
export interface UiState {
  mode: "concept" | "math";
}

export function uiInitial(): UiState {
  return { mode: "concept" };
}

/** The UI fields of a session — the input `uiReducer` sees. */
export function uiSlice(s: Session): UiState {
  return { mode: s.mode };
}

/** UI-slice reducer: handles the actions that only touch UI state and
 * returns `slice` unchanged for the rest. `ctx` is the pre-action
 * session (read-only) for slices that need read access to other
 * slices; the UI slice needs none. */
export function uiReducer(slice: UiState, a: Action, ctx: Session): UiState {
  void ctx; // the UI slice reads no other slices
  if (a.type === "setMode") return { ...slice, mode: a.mode };
  return slice;
}
