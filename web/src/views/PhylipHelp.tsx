// "Coming from PHYLIP?" help panel (v1.1 plan Task 13, spec §5.5).
// Opened from the app header — below 1024 px from the More menu —
// and maps the classic protdist → neighbor teaching workflow onto
// NeoPhylo's equivalents. It renders inside Sheet (v1.3 §6.2): a
// centered dialog above 1024 px, a full-screen sheet below it, with
// the shared focus contract — focus moves in on open, Tab is trapped,
// Esc closes and focus returns to the control that opened it (§6.5,
// same pattern as PairPanel).

import { Sheet } from "./Sheet";

export interface PhylipHelpProps {
  onClose: () => void;
}

export function PhylipHelp({ onClose }: PhylipHelpProps) {
  return (
    <Sheet
      className="pair-panel phylip-help"
      labelledBy="phylip-help-title"
      onClose={onClose}
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
    </Sheet>
  );
}
