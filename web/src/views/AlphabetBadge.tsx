// Alphabet badge and override (v1.1 plan Task 10, spec §5.1). The badge
// names the active alignment's alphabet and offers a one-click "Treat
// as protein/DNA" override that dispatches `setAlphabet`; the session
// reducer reinterprets the data and switches any incompatible model to
// the new alphabet's default, reporting the switch in `session.notice`.

import type { Dispatch } from "react";

import type { Alphabet } from "../engine/generated/Alphabet";
import type { Action } from "../state/session";

export interface AlphabetBadgeProps {
  alphabet: Alphabet;
  dispatch: Dispatch<Action>;
}

export function AlphabetBadge({ alphabet, dispatch }: AlphabetBadgeProps) {
  const other: Alphabet = alphabet === "protein" ? "dna" : "protein";
  return (
    <div className="alphabet-badge">
      <span className="alphabet-badge-label">
        {alphabet === "protein" ? "Protein · 20 amino acids" : "DNA"}
      </span>
      <button
        type="button"
        onClick={() => dispatch({ type: "setAlphabet", alphabet: other })}
      >
        Treat as {other === "protein" ? "protein" : "DNA"}
      </button>
    </div>
  );
}
