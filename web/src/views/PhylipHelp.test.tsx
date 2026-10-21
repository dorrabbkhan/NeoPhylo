// "Coming from PHYLIP?" help panel (v1.1 plan Task 13, spec §5.5).
// The panel opens from the app header and lists the PHYLIP → NeoPhylo
// mappings; it is a keyboard-accessible dialog (focus in, Esc closes,
// focus returns to the opening button).

import {
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Exercise } from "../engine/generated/Exercise";

import { App } from "./App";
import { PhylipHelp } from "./PhylipHelp";

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

describe("PhylipHelp", () => {
  it("lists the spec §5.5 mappings", () => {
    render(<PhylipHelp onClose={() => {}} />);
    const panel = screen.getByRole("dialog");
    expect(panel.textContent).toMatch(/protdist.*JTT/s);
    expect(panel.textContent).toMatch(/dnadist/);
    expect(panel.textContent).toMatch(/K80/);
    expect(panel.textContent).toMatch(/neighbor.*NJ/s);
    expect(panel.textContent).toMatch(/infile/);
    expect(panel.textContent).toMatch(/Distance matrix \(PHYLIP\)/);
    expect(panel.textContent).toMatch(/renaming/);
  });

  it("moves focus into the dialog and closes on Escape", () => {
    const onClose = vi.fn();
    render(<PhylipHelp onClose={onClose} />);
    const panel = screen.getByRole("dialog");
    expect(panel.contains(document.activeElement)).toBe(true);
    fireEvent.keyDown(panel, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("has a close button", () => {
    const onClose = vi.fn();
    render(<PhylipHelp onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("header entry", () => {
  it('opens from a "Coming from PHYLIP?" button in the header', async () => {
    render(<App exercise={EXERCISE} />);
    const open = await screen.findByRole("button", {
      name: "Coming from PHYLIP?",
    });
    // jsdom doesn't focus a button on click; a keyboard user would have
    // focus on it already.
    open.focus();
    fireEvent.click(open);
    expect(screen.getByRole("dialog")).toBeTruthy();
    // Focus moved into the panel; closing returns it to the button.
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(open);
  });
});
