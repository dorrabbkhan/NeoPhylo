// Settings drawer (v1.3 plan Task 10, spec §6.4): below the wide
// breakpoint the controls column's sections — Simulation, Analysis,
// How sure are we?, Import and Export — live in this left-side overlay
// opened from the header's Settings button. It rides the shared Sheet
// contract: focus moves in and is trapped, Esc and a scrim click close
// it, and focus returns to the button that opened it.

import type { ReactNode } from "react";

import { Sheet } from "./Sheet";

export interface SettingsDrawerProps {
  onClose: () => void;
  /** §6.7 reopen path at the medium breakpoint (Task 12, owner
   * decision B): when set, a "Take the tour" item closes the drawer
   * and calls back. Undefined below 1024 — the More menu owns the
   * reopen there — and the drawer itself never opens at ≥ 1280. */
  onTakeTour?: () => void;
  /** §6.5 lab-index link at the medium breakpoint (v1.4 Task 11):
   * the header's "PHYLIP labs" link fits only at ≥ 1280, so the
   * drawer carries it at 1024–1279 and the More menu below 1024. */
  labsHref?: string;
  /** The controls sections (App passes the same children the wide
   * layout's `.col-controls` aside shows). */
  children: ReactNode;
}

export function SettingsDrawer({
  onClose,
  onTakeTour,
  labsHref,
  children,
}: SettingsDrawerProps) {
  return (
    <Sheet
      className="settings-drawer"
      id="settings-drawer"
      labelledBy="settings-drawer-title"
      onClose={onClose}
      closeOnBackdrop
    >
      <header className="settings-drawer-head">
        <h2 id="settings-drawer-title">Settings</h2>
        <button
          type="button"
          className="close"
          aria-label="Close settings"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      {children}
      {labsHref !== undefined && (
        <a className="settings-drawer-labs" href={labsHref}>
          PHYLIP labs
        </a>
      )}
      {onTakeTour !== undefined && (
        <button
          type="button"
          className="settings-drawer-tour"
          onClick={() => {
            onClose();
            onTakeTour();
          }}
        >
          Take the tour
        </button>
      )}
    </Sheet>
  );
}
