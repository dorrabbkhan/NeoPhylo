// App URL integration (plan Task 22, spec §6.4): the app decodes the
// URL on load and syncs it with history.replaceState on every state
// change. A broken link toasts and falls back to the default lesson.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Exercise } from "../engine/generated/Exercise";
import { decode, encode } from "../state/url";
import { App } from "./App";

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

const NJ_BASICS_TREE = "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);";
const NJ_BASICS: Exercise = {
  schema_version: 2,
  id: "nj-basics",
  title: "How Neighbor-Joining works",
  alphabet: "dna",
  data: {
    kind: "simulated",
    true_tree: NJ_BASICS_TREE,
    sim: { model: "Jc69", length: 1000, seed: 42 },
  },
  reference: { newick: NJ_BASICS_TREE, kind: "true" },
  analysis: { correction: "Jc69", method: "Nj" },
  locked: ["sim.model", "analysis.method"],
  prompts: [],
};

describe("URL state", () => {
  it("restores step, mode and overrides from a #x= link", async () => {
    history.replaceState(
      null,
      "",
      "/" +
        encode({
          v: 3,
          x: NJ_BASICS,
          step: 2,
          mode: "math",
          overrides: {
            sim: { length: 500, seed: 7 },
            analysis: { method: "Upgma" },
          },
        }),
    );
    render(<App />);
    // The UPGMA override rebuilds the trace: 5 taxa → 4 joins.
    expect(await screen.findByText("step 2 of 4")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Math" }).getAttribute("aria-pressed"),
    ).toBe("true");
    // The sim override is visible in the controls column.
    const length = screen.getByLabelText("Length") as HTMLInputElement;
    expect(length.value).toBe("500");
  });

  it("toasts and loads the default lesson when the link can't be decoded", async () => {
    history.replaceState(null, "", "/#x=not-a-valid-payload!!!");
    render(<App />);
    expect(
      await screen.findByText(
        "This link couldn't be opened — showing the default lesson.",
      ),
    ).toBeTruthy();
    expect(await screen.findByRole("img", { name: "True tree" })).toBeTruthy();
  });

  it("syncs the current state into the URL with replaceState", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "True tree" });
    // The replaceState sync runs in an effect after the first session
    // render; waitFor keeps this from racing under load.
    await waitFor(() => expect(window.location.hash).toContain("#x="));
    // The written URL decodes back to a state matching the session.
    const d = decode(window.location.href);
    if (!d.ok) throw new Error("synced URL does not decode");
    expect(d.state.x?.id).toBe("nj-basics");
    expect(d.state.step).toBe(0);
    expect(d.state.mode).toBe("concept");
  });

  it("round-trips a sandbox-imported alignment through a shared link", async () => {
    const fasta = [
      ">T1\nACGT",
      ">T2\nACGT",
      ">T3\nACGA",
      ">T4\nACGT",
      ">T5\nACGG",
      ">T6\nACGT",
    ].join("\n");

    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    fireEvent.click(screen.getByRole("radio", { name: "Sandbox" }));
    fireEvent.change(screen.getByLabelText("Paste sequences or a tree"), {
      target: { value: fasta },
    });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    await screen.findByText("No true tree — import a Newick tree to compare");
    await waitFor(() => expect(window.location.hash).toContain("#x="));
    const sharedUrl = window.location.href;

    // A fresh "student" opens the shared link with no prior state.
    cleanup();
    history.replaceState(null, "", sharedUrl);
    render(<App />);

    expect(
      await screen.findByText(
        "No true tree — import a Newick tree to compare",
      ),
    ).toBeTruthy();
    expect(
      screen
        .getByRole("radio", { name: "Sandbox" })
        .getAttribute("aria-checked"),
    ).toBe("true");
    // The imported alignment's own taxa are on screen, not the lesson's.
    expect(screen.getAllByText("T1").length).toBeGreaterThan(0);
    expect(screen.queryByText("A")).toBeNull();
  });
});
