// Alphabet badge and override (v1.1 plan Task 10, spec §5.1). The badge
// names the active alignment's alphabet. On imported or embedded data
// it also offers a one-click "Treat as protein/DNA" override that
// dispatches `setAlphabet`; the session reducer reinterprets the data
// and switches any incompatible model to the new alphabet's default,
// reporting the switch in `session.notice`. On simulated data there is
// no override: the alphabet is produced by the simulation model, which
// the sim model menu controls (respecting lesson locks).

import type { Dispatch } from "react";

import type { Alphabet } from "../engine/generated/Alphabet";
import type { Action, Session } from "../state/session";

export interface AlphabetBadgeProps {
  /** Declared alphabet currently in force for the alignment. */
  alphabet: Alphabet;
  /** Where the alignment came from; the override only exists for real
   * (imported/embedded) data — simulated data's alphabet follows the
   * sim model menu instead (v1.1 spec §5.1, checkpoint 10). */
  alignmentOrigin: Session["alignmentOrigin"];
  /** The override is sandbox-only: in a lesson it would bypass the
   * exercise's declared alphabet (checkpoint 12). */
  source: Session["source"];
  dispatch: Dispatch<Action>;
}

export function AlphabetBadge({
  alphabet,
  alignmentOrigin,
  source,
  dispatch,
}: AlphabetBadgeProps) {
  const other: Alphabet = alphabet === "protein" ? "dna" : "protein";
  return (
    <div className="alphabet-badge">
      <span className="alphabet-badge-label">
        {alphabet === "protein" ? "Protein · 20 amino acids" : "DNA"}
      </span>
      {source === "sandbox" && alignmentOrigin !== "simulated" && (
        <button
          type="button"
          onClick={() => dispatch({ type: "setAlphabet", alphabet: other })}
        >
          Treat as {other === "protein" ? "protein" : "DNA"}
        </button>
      )}
    </div>
  );
}
