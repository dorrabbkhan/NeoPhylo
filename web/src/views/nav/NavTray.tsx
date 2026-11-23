// The header's icon tray (v1.5 Task 2, spec §16.2 — mockup style B):
// one rounded container carrying the nav items, the destination
// divider and the view controls (theme, presenter, Settings, More).
// Children are supplied per breakpoint by the header — the tray only
// styles and groups them.

import type { ReactNode } from "react";

export function NavTray({ children }: { children: ReactNode }) {
  return (
    <nav className="nav-tray" aria-label="Header navigation">
      {children}
    </nav>
  );
}

/** The rule between the where-to-go items and the view controls. */
export function NavDivider() {
  return <span className="nav-divider" aria-hidden="true" />;
}
