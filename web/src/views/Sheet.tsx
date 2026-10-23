// Sheet (v1.3 plan Task 10, spec §6.2): the shared modal container the
// app's dialogs render inside — the pair panel, the replicate panel
// and "Coming from PHYLIP?" — plus the Settings drawer. Above 1024 px
// the section is the same centered dialog as before; below 1024 px the
// stylesheet makes it a full-screen sheet (horizontal scroll stays
// inside the panel's own strips).
//
// The one focus contract every overlay shares: focus moves into the
// dialog on open (the first focusable, else the section itself), Tab
// is trapped, Esc closes, and focus returns to whatever was focused
// when it opened — the matrix cell, the header button or the menu
// item. Panels keep their own keys (the replicate view's ←/→) through
// `onKeyDown`, run before the trap so they can preventDefault.

import { useEffect, useRef } from "react";
import type { KeyboardEvent, ReactNode } from "react";

export interface SheetProps {
  /** Presentation classes on the dialog section (`.pair-panel`,
   * `.replicate-panel`, `.settings-drawer`, …). */
  className: string;
  /** id of the element that names the dialog (aria-labelledby). */
  labelledBy: string;
  /** Optional id on the section — the drawer's header button points
   * at it with aria-controls. */
  id?: string;
  onClose: () => void;
  /** Click on the scrim also closes (the Settings drawer; the content
   * dialogs keep their explicit Esc/× contract). */
  closeOnBackdrop?: boolean;
  /** Panel-specific keys, before the focus trap. */
  onKeyDown?: (e: KeyboardEvent<HTMLElement>) => void;
  children: ReactNode;
}

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function Sheet({
  className,
  labelledBy,
  id,
  onClose,
  closeOnBackdrop = false,
  onKeyDown,
  children,
}: SheetProps) {
  const panelRef = useRef<HTMLElement>(null);
  const restoreRef = useRef<Element | null>(null);

  // Focus management (spec §6.2): on open, remember the focused
  // element and move focus into the dialog; on close, put it back —
  // skipped when the opener is gone (a dismissed drawer's button).
  // Disabled controls can't take focus — a .focus() call on one is a
  // no-op and leaves focus on <body> (the replicate view's "Previous"
  // button at index 0 is exactly that), so they are skipped here the
  // same way the Tab trap below skips them.
  useEffect(() => {
    restoreRef.current = document.activeElement;
    const panel = panelRef.current;
    const first =
      panel === null
        ? undefined
        : Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE)).find(
            (el) => !el.hasAttribute("disabled"),
          );
    (first ?? panel)?.focus();
    return () => {
      const el = restoreRef.current;
      if (el instanceof HTMLElement || el instanceof SVGElement) {
        if (el.isConnected) el.focus();
      }
    };
  }, []);

  const handleKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    onKeyDown?.(e);
    if (e.defaultPrevented || e.key !== "Tab") return;
    const panel = panelRef.current;
    if (panel === null) return;
    const els = Array.from(
      panel.querySelectorAll<HTMLElement>(FOCUSABLE),
    ).filter((el) => !el.hasAttribute("disabled"));
    if (els.length === 0) {
      e.preventDefault();
      return;
    }
    const idx = els.indexOf(document.activeElement as HTMLElement);
    if (e.shiftKey && (idx <= 0 || document.activeElement === panel)) {
      e.preventDefault();
      els[els.length - 1].focus();
    } else if (!e.shiftKey && idx === els.length - 1) {
      e.preventDefault();
      els[0].focus();
    }
  };

  return (
    <div
      className="sheet-backdrop"
      onClick={
        closeOnBackdrop
          ? (e) => {
              if (e.target === e.currentTarget) onClose();
            }
          : undefined
      }
    >
      <section
        className={className}
        id={id}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        {children}
      </section>
    </div>
  );
}
