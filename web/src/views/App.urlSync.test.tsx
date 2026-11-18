// URL-sync ordering (v1.4c Task 14 fix round 1): the address bar is the
// sandbox's share link, so the session's replaceState must run before
// the new view paints — a passive useEffect can leave the previous
// link showing for a frame after a step or an import. A Profiler
// onRender runs during the commit, after the subtree's layout effects
// but before any passive effect: reading window.location there is the
// jsdom stand-in for "what the address bar shows when this frame
// paints". A test-level assert after fireEvent could never tell the
// two orderings apart — act flushes passive effects before returning.

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Profiler } from "react";
import { afterEach, describe, expect, it } from "vitest";

import type { Exercise } from "../engine/generated/Exercise";
import { decode } from "../state/url";
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
  bootstrap: null,
};

describe("URL sync ordering", () => {
  it("carries the new step in the address bar before the step paints", async () => {
    // The address bar captured mid-commit on the update whose DOM
    // already says "step 1" — no waiting, and no act boundary between
    // the commit and the read.
    let hrefAtStepOne: string | null = null;
    render(
      <Profiler
        id="url-sync"
        onRender={() => {
          const stepper = screen.queryByLabelText("Trace stepper");
          if (stepper?.textContent?.includes("step 1 of 3")) {
            hrefAtStepOne = window.location.href;
          }
        }}
      >
        <App exercise={NJ_BASICS} />
      </Profiler>,
    );
    await screen.findByRole("img", { name: "True tree" });
    fireEvent.click(screen.getByRole("button", { name: "Next step" }));
    if (hrefAtStepOne === null) {
      throw new Error("no commit rendered step 1");
    }
    const d = decode(hrefAtStepOne);
    if (!d.ok) throw new Error("synced URL does not decode");
    expect(d.state.step).toBe(1);
  });
});
