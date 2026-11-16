// The typing grid's sheet host (v1.4c Task 8 fix round 2). A 5–10
// taxon table can't fit the 200–282 px import column or the Settings
// drawer, so the grid lives in this Sheet — wide enough for ten taxa
// at every viewport, scrolling inside its own region past that.
//
// Once opened the sheet stays MOUNTED — `open` only toggles `hidden`
// on the wrapper — because the grid's in-progress draft is component
// state an unmount would destroy: a mid-session edit emits
// `onChange(null)`, so nothing outside the grid still holds the typed
// cells. Hiding instead of unmounting is the same contract the
// import panel's matrix tabpanel uses. Sheet's own mount-time focus
// effect covers the first open; the effect below re-enters focus on
// every reopen, and the caller returns focus to the opener on close.

import { useEffect, useRef } from "react";

import type { DistanceInput } from "../../engine/generated/DistanceInput";
import { Sheet } from "../Sheet";

import { MatrixGrid } from "./MatrixGrid";

export interface MatrixGridSheetProps {
  /** Visibility only — the mounted sheet renders `hidden` while
   * false so the grid's draft survives close/reopen. */
  open: boolean;
  /** The committed matrix — the session's `matrixInput` while a
   * matrix session runs, else null. */
  value: DistanceInput | null;
  onChange(input: DistanceInput | null, draftReady?: boolean): void;
  onClose(): void;
}

// Same selector Sheet uses for its focus contract.
const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function MatrixGridSheet({
  open,
  value,
  onChange,
  onClose,
}: MatrixGridSheetProps) {
  const rootRef = useRef<HTMLDivElement>(null);

  // Reopen refocuses the first control — the first open is covered by
  // Sheet's mount effect (this component mounts on the first open, so
  // the two never disagree). Skipped when focus is already inside,
  // e.g. a rerender that re-runs the effect while the sheet is up.
  useEffect(() => {
    if (!open) return;
    const root = rootRef.current;
    if (root === null || root.contains(document.activeElement)) {
      return;
    }
    const first = Array.from(
      root.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).find((el) => !el.hasAttribute("disabled"));
    first?.focus();
  }, [open]);

  return (
    <div ref={rootRef} hidden={!open}>
      <Sheet
        className="matrix-sheet"
        labelledBy="matrix-sheet-title"
        onClose={onClose}
      >
        <header className="matrix-sheet-head">
          <h2 id="matrix-sheet-title">Distance matrix</h2>
          <button
            type="button"
            className="close"
            aria-label="Close the matrix grid"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <MatrixGrid value={value} onChange={onChange} />
      </Sheet>
    </div>
  );
}
