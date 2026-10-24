// Header presenter toggle (v1.3 spec §6.3, §6.6): switches <html
// data-presenter> on and off via the setPresenter action, scaling the
// type and spacing tokens 1.5× and hiding the controls for a
// projector view. aria-pressed reflects "presenter is on"; the App's
// presenter effect mirrors the session flag to the DOM and the
// device-local neophylo.presenter pref (design/presenter.ts) — never
// to shared links. It parks with the theme toggle in the sheets'
// reserved strip below 1024 px (same real-input path as PR #74).

import type { Dispatch } from "react";

import type { Action } from "../state/session";

export interface PresenterToggleProps {
  presenter: boolean;
  dispatch: Dispatch<Action>;
}

export function PresenterToggle({
  presenter,
  dispatch,
}: PresenterToggleProps) {
  return (
    <button
      type="button"
      className="presenter-toggle"
      aria-pressed={presenter}
      onClick={() =>
        dispatch({ type: "setPresenter", presenter: !presenter })
      }
    >
      Presenter mode
    </button>
  );
}
