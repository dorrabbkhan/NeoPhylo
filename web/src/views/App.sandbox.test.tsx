// Lesson ⇄ Sandbox switch tests (checkpoint-7 fixes, spec §6.2). The
// header radiogroup dispatches enterSandbox/exitSandbox: entering keeps
// the current data and unlocks every control while showing the import
// panel; leaving reloads the lesson from scratch and asks first when
// imported data would be cleared.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Exercise } from "../engine/generated/Exercise";
import { engine } from "../engine";
import { defaultLessonJson } from "../lessons/default";
import { App } from "./App";

afterEach(cleanup);

// Same content as src/lessons/default.ts but without prompts, so the
// stepper isn't gated when checking the "no true tree" RF readout.
const NJ_BASICS: Exercise = {
  schema_version: 2,
  id: "nj-basics",
  title: "How Neighbor-Joining works",
  alphabet: "dna",
  data: {
    kind: "simulated",
    true_tree: "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
    sim: { model: "Jc69", length: 1000, seed: 42 },
  },
  reference: {
    newick: "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
    kind: "true",
  },
  analysis: { correction: "Jc69", method: "Nj" },
  locked: ["sim.model", "analysis.method"],
  prompts: [],
    bootstrap: null,
};

const SIX_TAXA_FASTA = [
  ">T1\nACGT",
  ">T2\nACGT",
  ">T3\nACGA",
  ">T4\nACGT",
  ">T5\nACGG",
  ">T6\nACGT",
].join("\n");

const lesson = (): Exercise => {
  const r = engine.loadExercise(defaultLessonJson);
  if (!r.ok) throw new Error("default lesson failed to parse");
  return r.value;
};

const modelSelect = () =>
  screen.getByLabelText("Simulation model") as HTMLSelectElement;

const importPanel = () => screen.queryByLabelText("Paste sequences or a tree");

describe("Lesson | Sandbox switch", () => {
  it("is a radiogroup with the current mode checked", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    const group = screen.getByRole("radiogroup", { name: "Mode" });
    expect(group).toBeTruthy();
    expect(
      screen
        .getByRole("radio", { name: "Lesson" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    expect(
      screen
        .getByRole("radio", { name: "Sandbox" })
        .getAttribute("aria-checked"),
    ).toBe("false");
  });

  it("unlocks a locked control and shows the import panel; exit restores lock and prompts at step 0", async () => {
    const ex = lesson(); // predict_pair prompt at position 0, locked sim.model
    const question = ex.prompts[0].concept;
    render(<App exercise={ex} />);
    // Lesson mode: prompt visible, locked control disabled, gated stepper.
    await screen.findByText(question);
    expect(modelSelect().disabled).toBe(true);
    expect(importPanel()).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Sandbox" }));
    expect(importPanel()).not.toBeNull();
    expect(modelSelect().disabled).toBe(false);
    expect(screen.queryByText(question)).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Lesson" }));
    expect(await screen.findByText(question)).toBeTruthy();
    expect(modelSelect().disabled).toBe(true);
    expect(importPanel()).toBeNull();
    expect(screen.getByText(/step 0 of/)).toBeTruthy();
  });

  it("keeps the simulated data when entering sandbox — nothing jumps", async () => {
    render(<App exercise={NJ_BASICS} />);
    const grid = await screen.findByRole("grid", { name: "Distance matrix" });
    const before = grid.innerHTML;
    fireEvent.click(screen.getByRole("radio", { name: "Sandbox" }));
    expect(
      screen.getByRole("grid", { name: "Distance matrix" }).innerHTML,
    ).toBe(before);
  });
});

describe("Sandbox true-tree origin", () => {
  it("6 imported sequences T1–T6 against the lesson tree: no error, no RF, no-true-tree message", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    fireEvent.click(screen.getByRole("radio", { name: "Sandbox" }));
    fireEvent.change(screen.getByLabelText("Paste sequences or a tree"), {
      target: { value: SIX_TAXA_FASTA },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    // The lesson tree is gone (labels can't match), no error anywhere.
    expect(
      screen.getByText("No true tree — import a Newick tree to compare"),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.getByRole("img", { name: "Inferred tree" })).toBeTruthy();

    // The stepper ends with the no-true-tree readout, not a number.
    const slider = screen.getByRole("slider") as HTMLInputElement;
    fireEvent.change(slider, { target: { value: slider.max } });
    expect(screen.getByText("RF: — (no true tree)")).toBeTruthy();
    expect(screen.queryByText(/RF = \d/)).toBeNull();
  });

  // Checkpoint 11: an imported alignment collapses the Simulation
  // section to "Your sequences: not simulated." — the same treatment
  // embedded lessons get, instead of greyed-out fields.
  it("shows 'Your sequences: not simulated.' for imported data", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    fireEvent.click(screen.getByRole("radio", { name: "Sandbox" }));
    fireEvent.change(screen.getByLabelText("Paste sequences or a tree"), {
      target: { value: SIX_TAXA_FASTA },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(
      screen.getByText("Your sequences: not simulated."),
    ).toBeTruthy();
    expect(screen.queryByLabelText("Simulation model")).toBeNull();
    expect(screen.queryByLabelText("Length")).toBeNull();
    expect(screen.queryByLabelText("Seed")).toBeNull();
    // Analysis controls stay live on imported data.
    expect(screen.getByLabelText("Distance correction")).toBeTruthy();
  });

  it("offers the alphabet override on imported DNA", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    // Simulated lesson data: no override (the sim model controls it).
    expect(screen.queryByRole("button", { name: /Treat as/ })).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Sandbox" }));
    fireEvent.change(screen.getByLabelText("Paste sequences or a tree"), {
      target: { value: SIX_TAXA_FASTA },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    // Imported real data gets the "Treat as protein" override.
    expect(
      screen.getByRole("button", { name: "Treat as protein" }),
    ).toBeTruthy();
  });

  it("asks before leaving sandbox when imported data would be cleared", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    fireEvent.click(screen.getByRole("radio", { name: "Sandbox" }));
    fireEvent.change(screen.getByLabelText("Paste sequences or a tree"), {
      target: { value: SIX_TAXA_FASTA },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));

    // Declining stays in sandbox with the data intact.
    fireEvent.click(screen.getByRole("radio", { name: "Lesson" }));
    expect(confirmSpy).toHaveBeenCalledWith(
      "Leave sandbox? Your imported data will be cleared.",
    );
    expect(importPanel()).not.toBeNull();

    // Accepting reloads the lesson.
    confirmSpy.mockReturnValue(true);
    fireEvent.click(screen.getByRole("radio", { name: "Lesson" }));
    expect(importPanel()).toBeNull();
    expect(await screen.findByRole("img", { name: "True tree" })).toBeTruthy();
    expect(modelSelect().disabled).toBe(true);
    confirmSpy.mockRestore();
  });
});
