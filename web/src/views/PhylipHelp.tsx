// "Coming from PHYLIP?" help panel (v1.1 plan Task 13, spec §5.5).
// Opened from the app header; maps the classic protdist → neighbor
// teaching workflow onto NeoPhylo's equivalents. A keyboard-accessible
// dialog: focus moves in on open, Tab is trapped, Esc closes and focus
// returns to the button that opened it (§6.5, same pattern as
// PairPanel).

import { useEffect, useRef } from "react";
import type { KeyboardEvent } from "react";

export interface PhylipHelpProps {
  onClose: () => void;
}

const FOCUSABLE =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

export function PhylipHelp({ onClose }: PhylipHelpProps) {
  const panelRef = useRef<HTMLElement>(null);
  const restoreRef = useRef<Element | null>(null);

  useEffect(() => {
    restoreRef.current = document.activeElement;
    const panel = panelRef.current;
    const first = panel?.querySelector<HTMLElement>(FOCUSABLE);
    (first ?? panel)?.focus();
    return () => {
      const el = restoreRef.current;
      if (el instanceof HTMLElement || el instanceof SVGElement) {
        if (el.isConnected) el.focus();
      }
    };
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      e.stopPropagation();
      onClose();
      return;
    }
    if (e.key !== "Tab") return;
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
    <div className="pair-panel-backdrop">
      <section
        className="pair-panel phylip-help"
        role="dialog"
        aria-modal="true"
        aria-labelledby="phylip-help-title"
        ref={panelRef}
        tabIndex={-1}
        onKeyDown={onKeyDown}
      >
        <header className="pair-panel-head">
          <h2 id="phylip-help-title">Coming from PHYLIP?</h2>
          <button
            type="button"
            className="close"
            aria-label="Close PHYLIP help"
            onClick={onClose}
          >
            ×
          </button>
        </header>
        <ul className="phylip-help-map">
          <li>
            <code>protdist</code> defaults → the <strong>JTT</strong>{" "}
            correction on protein data. <code>dnadist</code> →{" "}
            <strong>K80</strong>, approximately: PHYLIP&apos;s K2P is a
            fixed-ratio estimator rather than the K80 formula, so distances
            differ slightly (ape is the K80 oracle).
          </li>
          <li>
            <code>neighbor</code> defaults → <strong>NJ</strong>.
          </li>
          <li>
            <code>infile</code> loads directly — paste your PHYLIP file
            into the Sandbox import box.
          </li>
          <li>
            Export → <strong>Distance matrix (PHYLIP)</strong> produces a
            file <code>neighbor</code> reads.
          </li>
          <li>
            No <code>outfile</code>/<code>infile</code> renaming needed —
            exports are downloads, imports take pasted text.
          </li>
        </ul>
      </section>
    </div>
  );
}
