// App URL integration (plan Task 22, spec §6.4): the app decodes the
// URL on load and syncs it with history.replaceState on every state
// change. A broken link toasts and falls back to the default lesson.

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Exercise } from "../engine/generated/Exercise";
import { decode, encode } from "../state/url";
import { App } from "./App";

afterEach(() => {
  cleanup();
  history.replaceState(null, "", "/");
});

const NJ_BASICS: Exercise = {
  schema_version: 1,
  id: "nj-basics",
  title: "How Neighbor-Joining works",
  true_tree: "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
  sim: { model: "Jc69", length: 1000, seed: 42 },
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
          v: 1,
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
});
