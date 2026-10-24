// Shared empty/idle state (v1.3 plan Task 12, spec §6.8): a short line
// where a panel would otherwise show nothing — the Sandbox before
// data, the bootstrap panel before a run, the consensus tabs before
// they can draw. `children` carries optional actions (the Sandbox's
// sample buttons).

import type { ReactNode } from "react";

export interface EmptyStateProps {
  /** The exact spec text. */
  text: string;
  children?: ReactNode;
}

export function EmptyState({ text, children }: EmptyStateProps) {
  return (
    <div className="empty-state">
      <p className="empty-state-text">{text}</p>
      {children}
    </div>
  );
}
