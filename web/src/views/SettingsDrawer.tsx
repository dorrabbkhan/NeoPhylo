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
  /** The controls sections (App passes the same children the wide
   * layout's `.col-controls` aside shows). */
  children: ReactNode;
}

export function SettingsDrawer({ onClose, children }: SettingsDrawerProps) {
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
    </Sheet>
  );
}
