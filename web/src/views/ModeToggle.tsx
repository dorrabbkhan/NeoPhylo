// The global Concept/Math toggle (spec §6.2, v1.1 spec §5.2). One
// component shared by the explanation panel and the pair panel so both
// stay synced through `Session.mode` via the `setMode` action —
// switching in either place switches both.

import type { Dispatch } from "react";

import type { Action, Session } from "../state/session";

export interface ModeToggleProps {
  mode: Session["mode"];
  dispatch: Dispatch<Action>;
}

export function ModeToggle({ mode, dispatch }: ModeToggleProps) {
  return (
    <div className="mode-toggle" role="group" aria-label="Explanation mode">
      <button
        type="button"
        aria-pressed={mode === "concept"}
        onClick={() => dispatch({ type: "setMode", mode: "concept" })}
      >
        Concept
      </button>
      <button
        type="button"
        aria-pressed={mode === "math"}
        onClick={() => dispatch({ type: "setMode", mode: "math" })}
      >
        Math
      </button>
    </div>
  );
}
