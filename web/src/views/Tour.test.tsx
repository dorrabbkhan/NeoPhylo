// First-visit tour tests (v1.3 plan Task 12, spec §6.7). Four steps
// highlight the stepper, the trees, the matrix and the Concept/Math
// toggle with Next/Back/Skip and an aria-live description; ending or
// skipping writes the device-local neophylo.tourSeen flag — which is
// what keeps it from showing on the next visit, and what keeps it to
// once per page session when storage is blocked.

import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Dispatch } from "react";

import type { Exercise } from "../engine/generated/Exercise";
import type { Action } from "../state/session";

import { markTourSeen, readTourSeen } from "../design/tour";

import { App } from "./App";
import { MoreMenu } from "./MoreMenu";
import { Tour } from "./Tour";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  window.localStorage.clear();
  // The breakpoint tests set window.innerWidth — restore the suite-wide
  // 1280 pin from src/test/setup.ts.
  window.innerWidth = 1280;
  // A prop-driven <App/> syncs #x= into the URL, which suppresses the
  // auto-start (§6.7) — reset so each test starts at a clean visit.
  history.replaceState(null, "", "/");
});

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
  locked: [],
  prompts: [],
  bootstrap: null,
};

/** Render the tour at `step` with a dispatch spy. */
function renderTour(step: number) {
  const dispatched: Action[] = [];
  const dispatch: Dispatch<Action> = (a) => dispatched.push(a);
  render(<Tour step={step} dispatch={dispatch} />);
  return dispatched;
}

describe("Tour — first visit auto-start (spec §6.7)", () => {
  it("opens on a first visit to / with empty storage", async () => {
    render(<App />);
    await screen.findByRole("img", { name: "True tree" });
    expect(await screen.findByRole("dialog", { name: "Take the tour" }))
      .toBeTruthy();
    // Step 1 highlights the stepper.
    expect(document.querySelector(".tour")?.getAttribute("data-tour-target"))
      .toBe(".stepper");
  });

  it("does not open when neophylo.tourSeen is set", async () => {
    window.localStorage.setItem("neophylo.tourSeen", "1");
    render(<App />);
    await screen.findByRole("img", { name: "True tree" });
    expect(screen.queryByRole("dialog", { name: "Take the tour" })).toBeNull();
  });

  it("does not open for a prop-driven exercise (unit-test path)", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "True tree" });
    expect(screen.queryByRole("dialog", { name: "Take the tour" })).toBeNull();
  });

  it("Review Focus 3: shows with storage blocked, and marks the session seen", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    render(<App />);
    await screen.findByRole("img", { name: "True tree" });
    expect(await screen.findByRole("dialog", { name: "Take the tour" }))
      .toBeTruthy();
    // Dismissing records the session flag even though storage threw.
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(readTourSeen()).toBe(true);
    expect(screen.queryByRole("dialog", { name: "Take the tour" })).toBeNull();
    vi.restoreAllMocks();
  });
});

describe("Tour — steps and controls", () => {
  it("announces each step in an aria-live region", () => {
    renderTour(0);
    const live = screen.getByText(/Tour step 1 of 4/);
    expect(live.closest("[aria-live]")).not.toBeNull();
  });

  it("highlights the stepper, the trees, the matrix and the mode toggle", () => {
    const targets = [".stepper", ".trees", ".matrix-wrap", ".mode-toggle"];
    targets.forEach((selector, step) => {
      cleanup();
      renderTour(step);
      expect(document.querySelector(".tour")?.getAttribute("data-tour-target"))
        .toBe(selector);
    });
  });

  it("Next/Back navigate and Skip ends the tour", () => {
    const dispatched = renderTour(1);
    fireEvent.click(screen.getByRole("button", { name: "Back" }));
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(dispatched.map((a) => a.type)).toEqual([
      "tourBack",
      "tourNext",
      "tourEnd",
    ]);
  });

  it("Back is disabled on the first step", () => {
    renderTour(0);
    expect(screen.getByRole("button", { name: "Back" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("Escape ends the tour", () => {
    const dispatched = renderTour(2);
    fireEvent.keyDown(screen.getByRole("dialog", { name: "Take the tour" }), {
      key: "Escape",
    });
    expect(dispatched.map((a) => a.type)).toEqual(["tourEnd"]);
  });

  it("Arrow keys move between steps", () => {
    const dispatched = renderTour(1);
    const dlg = screen.getByRole("dialog", { name: "Take the tour" });
    fireEvent.keyDown(dlg, { key: "ArrowRight" });
    fireEvent.keyDown(dlg, { key: "ArrowLeft" });
    expect(dispatched.map((a) => a.type)).toEqual(["tourNext", "tourBack"]);
  });
});

describe("Tour — the seen flag (neophylo.tourSeen)", () => {
  it("Skip writes the device-local flag", () => {
    renderTour(0);
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(window.localStorage.getItem("neophylo.tourSeen")).toBe("1");
    expect(readTourSeen()).toBe(true);
  });

  it("survives a blocked write via the session flag", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new DOMException("denied", "SecurityError");
    });
    markTourSeen();
    expect(readTourSeen()).toBe(true);
    vi.restoreAllMocks();
  });
});

describe("Tour — reopen from More (spec §6.7)", () => {
  it("More lists Take the tour and calls back into the app", () => {
    const onTakeTour = vi.fn();
    render(
      <MoreMenu onOpenPhylipHelp={() => {}} onTakeTour={onTakeTour} />,
    );
    fireEvent.click(screen.getByRole("button", { name: "More" }));
    fireEvent.click(
      screen.getByRole("menuitem", { name: "Take the tour" }),
    );
    expect(onTakeTour).toHaveBeenCalledTimes(1);
  });
});

// Task 12 round 2 (§6.7, owner decision 2A): a reopen path at every
// width — the header button at ≥ 1280, the Settings drawer's item at
// 1024–1279, the More menu below 1024 (above). jsdom has no
// matchMedia, so the breakpoint falls back to window.innerWidth.
describe("Tour — reopen paths by width", () => {
  it("wide: the header's Take the tour button opens the tour at step 1", async () => {
    window.innerWidth = 1280;
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "True tree" });
    fireEvent.click(screen.getByRole("button", { name: "Take the tour" }));
    expect(await screen.findByRole("dialog", { name: "Take the tour" }))
      .toBeTruthy();
    expect(document.querySelector(".tour")?.getAttribute("data-tour-target"))
      .toBe(".stepper");
  });

  it("medium: the drawer's item closes it and lands focus in the tour card", async () => {
    window.innerWidth = 1100;
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "True tree" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const drawer = await screen.findByRole("dialog", { name: "Settings" });
    fireEvent.click(
      within(drawer).getByRole("button", { name: "Take the tour" }),
    );
    expect(screen.queryByRole("dialog", { name: "Settings" })).toBeNull();
    const card = await screen.findByRole("dialog", { name: "Take the tour" });
    expect(document.querySelector(".tour")?.getAttribute("data-tour-target"))
      .toBe(".stepper");
    // The closing drawer's focus restore (a passive unmount effect)
    // runs before the mounting card's own passive focus — the card
    // must end up focused, not the header's Settings button.
    expect(document.activeElement).toBe(card);
  });

  it("narrow: the drawer's item stays out — the More menu owns the reopen", async () => {
    window.innerWidth = 800;
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "True tree" });
    fireEvent.click(screen.getByRole("button", { name: "Settings" }));
    const drawer = await screen.findByRole("dialog", { name: "Settings" });
    expect(
      within(drawer).queryByRole("button", { name: "Take the tour" }),
    ).toBeNull();
  });
});
