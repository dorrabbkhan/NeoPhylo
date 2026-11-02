// "Coming from MEGA?" help panel (v1.4b plan Task 12, spec §7.2).
// Opened from the header's Guides menu (≥1024 px) or the More menu
// (below 1024 px), it maps MEGA's distance models, gap treatments and
// bootstrap onto NeoPhylo's names, says which outputs are checked
// against MEGA itself and which against PHYLIP, and links across to
// "Coming from PHYLIP?". It renders inside Sheet like PhylipHelp:
// focus moves in, Tab is trapped, Esc closes and focus returns to
// the control that opened it.
//
// Content rules (conductor note 7): only what the parity tests pin —
// no tolerances, percentages or decimal counts as literals, and
// support is a count of replicate trees, never a probability.

import { Sheet } from "./Sheet";

export interface MegaHelpProps {
  onClose: () => void;
  /** Opens "Coming from PHYLIP?": the cross-link swaps this sheet
   * for the other guide. */
  onOpenPhylipHelp: () => void;
}

export function MegaHelp({ onClose, onOpenPhylipHelp }: MegaHelpProps) {
  return (
    <Sheet
      className="pair-panel mega-help"
      labelledBy="mega-help-title"
      onClose={onClose}
    >
      <header className="pair-panel-head">
        <h2 id="mega-help-title">Coming from MEGA?</h2>
        <button
          type="button"
          className="close"
          aria-label="Close MEGA help"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <ul className="phylip-help-map">
        <li>
          <strong>p-distance</strong> → the <strong>p</strong>{" "}
          correction (the proportion of differing sites). MEGA&apos;s
          &quot;No. of differences&quot; — raw counts, not proportions —
          is not offered.
        </li>
        <li>
          <strong>Jukes-Cantor</strong> → <strong>JC69</strong>.
        </li>
        <li>
          <strong>Kimura 2-parameter</strong> → <strong>K80</strong>:
          MEGA&apos;s K2P is the K80 formula, which is the model
          NeoPhylo checks against MEGA. The dnadist-style{" "}
          <code>K2P_PHYLIP</code> correction reproduces PHYLIP&apos;s
          fixed-ratio estimator instead — a different model, so it does
          not match MEGA.
        </li>
        <li>
          <strong>Poisson model</strong> (protein) →{" "}
          <strong>Poisson</strong>.
        </li>
        <li>
          <strong>JTT</strong> → NeoPhylo&apos;s <strong>JTT</strong> is
          validated against PHYLIP&apos;s <code>protdist</code>, not
          MEGA: MEGA&apos;s own JTT estimator differs, and no MEGA-JTT
          model ships — expect small differences on protein data.
        </li>
        <li>
          The three <strong>gap treatments</strong> are the gap
          control&apos;s options: <strong>Pairwise deletion</strong>,{" "}
          <strong>Complete deletion</strong>, and{" "}
          <strong>Partial deletion</strong> with a site-coverage
          cutoff. Partial keeps a column when its coverage is at least
          the cutoff — the same rule MEGA applies.
        </li>
        <li>
          <code>.meg</code> files open and export from the Import and
          Export sections.
        </li>
      </ul>
      <p className="phylip-note">
        Checked against MEGA-CC: the p, JC69, K80 and Poisson distances
        under all three gap treatments, and the NJ and UPGMA trees
        built on them, on the datasets in the test corpus. MEGA&apos;s
        other models (Tamura-Nei, LogDet, gamma-rate variants) have no
        NeoPhylo equivalent.
      </p>
      <p className="phylip-note">
        Bootstrap: both programs remove filtered sites before
        resampling the columns, so each replicate is drawn the same
        way — but the random draws themselves differ (MEGA&apos;s
        bootstrap is unseeded; NeoPhylo&apos;s is seeded). Support
        values therefore agree only within sampling noise: a support is
        a count of replicate trees sharing a grouping, nothing more.
      </p>
      <p className="phylip-note">
        The <a href="?labs">labs</a> list the MEGA handouts as they
        land. Working in PHYLIP too?{" "}
        <button
          type="button"
          className="guide-link"
          onClick={onOpenPhylipHelp}
        >
          Coming from PHYLIP?
        </button>
      </p>
    </Sheet>
  );
}
