// "Coming from MEGA?" help panel (v1.4b plan Task 12, spec §7.2).
// Opened from the header's Guides menu (≥1024 px) or the More menu
// (below 1024 px), it maps MEGA's distance, gap-treatment and
// bootstrap terms onto the NeoPhylo names and says which numbers are
// checked against MEGA and which against PHYLIP. Same Sheet contract
// as PhylipHelp: focus in, Esc closes, focus returns to the opener.

import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Exercise } from "../engine/generated/Exercise";

import { App } from "./App";
import { MegaHelp } from "./MegaHelp";

afterEach(cleanup);

// Minimal DNA exercise so App renders its header quickly.
const EXERCISE: Exercise = {
  schema_version: 2,
  id: "t",
  title: "t",
  alphabet: "dna",
  data: {
    kind: "simulated",
    true_tree: "(A:0.1,B:0.1,C:0.2);",
    sim: { model: "Jc69", length: 20, seed: 1 },
  },
  reference: { newick: "(A:0.1,B:0.1,C:0.2);", kind: "true" },
  analysis: { correction: "Jc69", method: "Nj" },
  locked: [],
  prompts: [],
  bootstrap: null,
};

describe("MegaHelp", () => {
  it("covers the spec §7.2 topics", () => {
    render(<MegaHelp onClose={() => {}} onOpenPhylipHelp={() => {}} />);
    const panel = screen.getByRole("dialog", {
      name: "Coming from MEGA?",
    });
    // MEGA terms → NeoPhylo names.
    expect(panel.textContent).toMatch(/Kimura 2-parameter/);
    expect(panel.textContent).toMatch(/K80/);
    expect(panel.textContent).toMatch(/K2P_PHYLIP|dnadist/);
    expect(panel.textContent).toMatch(/Poisson/);
    expect(panel.textContent).toMatch(/p-distance|No\. of differences/);
    // The three gap treatments, including the partial cutoff rule.
    expect(panel.textContent).toMatch(/Pairwise deletion/);
    expect(panel.textContent).toMatch(/Complete deletion/);
    expect(panel.textContent).toMatch(/Partial deletion/);
    expect(panel.textContent).toMatch(/coverage/);
    // JTT is validated against PHYLIP's protdist, not MEGA (#117).
    expect(panel.textContent).toMatch(/JTT/);
    expect(panel.textContent).toMatch(/protdist/);
    // Bootstrap support agrees only within sampling noise — never a
    // probability.
    expect(panel.textContent).toMatch(/sampling noise|random/i);
    expect(panel.textContent).not.toMatch(/probabilit/i);
    // Models without a NeoPhylo equivalent are named as such — no
    // "yet" roadmap promise (owner decision 2026-11-02).
    expect(panel.textContent).toMatch(
      /MEGA's\s+other\s+models\s+\(Tamura-Nei,\s+LogDet,\s+gamma-rate\s+variants\)\s+have\s+no\s+NeoPhylo\s+equivalent\./,
    );
    expect(panel.textContent).not.toMatch(/\byet\b/i);
  });

  it("moves focus into the dialog and closes on Escape", () => {
    const onClose = vi.fn();
    render(<MegaHelp onClose={onClose} onOpenPhylipHelp={() => {}} />);
    const panel = screen.getByRole("dialog", {
      name: "Coming from MEGA?",
    });
    expect(panel.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has a close button", () => {
    const onClose = vi.fn();
    render(<MegaHelp onClose={onClose} onOpenPhylipHelp={() => {}} />);
    fireEvent.click(
      screen.getByRole("button", { name: /close/i }),
    );
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('cross-links to "Coming from PHYLIP?"', () => {
    const onOpenPhylipHelp = vi.fn();
    render(
      <MegaHelp onClose={() => {}} onOpenPhylipHelp={onOpenPhylipHelp} />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Coming from PHYLIP\?/ }),
    );
    expect(onOpenPhylipHelp).toHaveBeenCalledTimes(1);
  });
});

describe("header entry", () => {
  it('opens from the header\'s Guides menu — "Coming from MEGA?" item', async () => {
    render(<App exercise={EXERCISE} />);
    const guides = await screen.findByRole("button", { name: "Guides" });
    fireEvent.click(guides);
    const item = screen.getByRole("menuitem", {
      name: "Coming from MEGA?",
    });
    item.focus();
    fireEvent.click(item);
    // The dialog is a lazy chunk like PhylipHelp: the open is async.
    await screen.findByRole("dialog", { name: "Coming from MEGA?" });
  });
});
