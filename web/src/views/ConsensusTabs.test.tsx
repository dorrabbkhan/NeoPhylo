// Consensus tabs tests (v1.2 plan Task 12, spec §6.4). The tabs are
// driven through the real session reducer: `setBootstrapView` picks
// which of "Your tree with support" | "Majority-rule" | "Extended
// majority" | "Strict" draws. Consensus trees come from the real
// engine (`engine.consensus` / `engine.consensusDropped`) on a fixed
// tally, fed to a done run via the bootstrapClient handler spies —
// the same harness as App.bootstrap.test.tsx.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  bootstrapClient,
} from "../engine/bootstrapClient";
import type { BootstrapHandlers } from "../engine/bootstrapClient";
import type { BootstrapResult } from "../engine/bootstrapProtocol";
import type { BootstrapTally } from "../engine/generated/BootstrapTally";
import type { ConsensusKind } from "../engine/generated/ConsensusKind";
import type { DroppedGroup } from "../engine/generated/DroppedGroup";
import type { Exercise } from "../engine/generated/Exercise";
import type { Method } from "../engine/generated/Method";
import type { Tree } from "../engine/generated/Tree";
import { engine } from "../engine/index";
import { initialSession, reducer } from "../state/session";
import type { Session } from "../state/session";

import { App } from "./App";

afterEach(cleanup);

const TREE5 = "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);";
const TREE4_ROOTED = "((A:0.1,B:0.1):0.05,(C:0.1,D:0.1):0.05);";

function makeExercise(newick: string, method: Method): Exercise {
  return {
    schema_version: 2,
    id: "t",
    title: "t",
    alphabet: "dna",
    data: {
      kind: "simulated",
      true_tree: newick,
      sim: { model: "Jc69", length: 300, seed: 42 },
    },
    reference: { newick, kind: "true" },
    analysis: { correction: "Jc69", method },
    locked: [],
    prompts: [],
    bootstrap: null,
  };
}

const NJ_BASICS = makeExercise(TREE5, "Nj");

function loaded(ex: Exercise): Session {
  return reducer(initialSession(ex), {
    type: "load",
    exercise: ex,
    source: "lesson",
  });
}

/** Jump the stepper to its final position. */
function stepToEnd() {
  const slider = screen.getByRole("slider");
  fireEvent.change(slider, { target: { value: "99" } });
}

// -- bootstrapClient spies (same as App.bootstrap.test.tsx) -----------

let handlers: BootstrapHandlers | undefined;
let nextJobId: number;

beforeEach(() => {
  handlers = undefined;
  nextJobId = 0;
  vi.spyOn(bootstrapClient, "start").mockImplementation((_p, h) => {
    handlers = h;
    return ++nextJobId;
  });
  vi.spyOn(bootstrapClient, "cancel").mockResolvedValue(undefined);
  vi.spyOn(bootstrapClient, "confirm").mockImplementation(() => {});
  vi.spyOn(bootstrapClient, "dispose").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** The tally both consensus trees and dropped lists are built from.
 * NJ splits serialize their CANONICAL side — the one not containing
 * taxon 0 (A) — so the {A,B}|rest split is written "C,D,E": 90/98,
 * {D,E} at 41/98. Majority accepts {C,D,E} only, extended adds {D,E},
 * strict accepts neither. */
const TALLY: BootstrapTally = {
  method: "Nj",
  labels: ["A", "B", "C", "D", "E"],
  successful: 98,
  failed: 2,
  counts: [
    { labels: ["C", "D", "E"], count: 90 },
    { labels: ["D", "E"], count: 41 },
  ],
};

function must<T>(r: { ok: true; value: T } | { ok: false }): T {
  if (!r.ok) throw new Error("engine call failed");
  return r.value;
}

/** The worker's `result` payload, computed with the real engine so the
 * consensus trees carry per-grouping support exactly as a run's would. */
function runResult(original: Tree): BootstrapResult {
  const labels = TALLY.labels;
  const consensus = {} as Record<ConsensusKind, Tree>;
  const dropped = {} as Record<ConsensusKind, DroppedGroup[]>;
  for (const kind of ["Majority", "Extended", "Strict"] as const) {
    consensus[kind] = must(engine.consensus(TALLY, kind, labels));
    dropped[kind] = must(engine.consensusDropped(original, TALLY, kind));
  }
  return {
    tally: TALLY,
    support: must(engine.supportOnTree(original, TALLY)),
    consensus,
    dropped,
    failed: 2,
  };
}

/** Render the app on `ex`, step to the end and finish a bootstrap run
 * whose result is the real engine output for the session's tree. */
async function renderDoneRun(ex: Exercise) {
  render(<App exercise={ex} />);
  await screen.findByRole("img", { name: "Inferred tree" });
  stepToEnd();
  fireEvent.click(screen.getByRole("button", { name: /Run bootstrap/ }));
  await screen.findByText(/Estimating/);
  const original = loaded(ex).result!.tree;
  act(() => {
    handlers!.onResult(runResult(original));
  });
  await screen.findByText(/Run complete/);
  return { original };
}

describe("ConsensusTabs", () => {
  it("renders the four tabs in order inside a real ARIA tablist", async () => {
    await renderDoneRun(NJ_BASICS);
    const tablist = screen.getByRole("tablist");
    const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
    expect(tabs.map((t) => t.textContent)).toEqual([
      "Your tree with support",
      "Majority-rule",
      "Extended majority",
      "Strict",
    ]);
    // Exactly one selected tab, and its aria-controls names the panel.
    const selected = tabs.filter(
      (t) => t.getAttribute("aria-selected") === "true",
    );
    expect(selected).toHaveLength(1);
    expect(selected[0].textContent).toBe("Your tree with support");
    const panel = screen.getByRole("tabpanel");
    for (const t of tabs) {
      expect(t.getAttribute("aria-controls")).toBe(panel.id);
    }
    expect(panel.getAttribute("aria-labelledby")).toBe(selected[0].id);
  });

  it("consensus tabs are disabled until a run is done", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd();
    const consensus = () =>
      screen
        .getAllByRole("tab")
        .filter((t) => t.textContent !== "Your tree with support");
    // Before any run: all three consensus tabs disabled.
    for (const t of consensus()) {
      expect(t).toHaveProperty("disabled", true);
    }
    expect(
      screen.getByRole("tab", { name: "Your tree with support" }),
    ).toHaveProperty("disabled", false);
    // Mid-run: still disabled.
    fireEvent.click(screen.getByRole("button", { name: /Run bootstrap/ }));
    await screen.findByText(/Estimating/);
    for (const t of consensus()) {
      expect(t).toHaveProperty("disabled", true);
    }
    act(() => {
      handlers!.onResult(runResult(loaded(NJ_BASICS).result!.tree));
    });
    await screen.findByText(/Run complete/);
    for (const t of consensus()) {
      expect(t).toHaveProperty("disabled", false);
    }
  });

  it("each consensus tab draws the matching consensus tree as a cladogram with support labels", async () => {
    const { original } = await renderDoneRun(NJ_BASICS);
    const cases: { tab: string; kind: ConsensusKind; caption: string }[] = [
      { tab: "Majority-rule", kind: "Majority", caption: "Majority-rule consensus" },
      { tab: "Extended majority", kind: "Extended", caption: "Extended majority consensus" },
      { tab: "Strict", kind: "Strict", caption: "Strict consensus" },
    ];
    for (const c of cases) {
      fireEvent.click(screen.getByRole("tab", { name: c.tab }));
      const svg = await screen.findByRole("img", { name: c.caption });
      // The drawn tree is `result.consensus[kind]` (here: rerooted on
      // the reference's outgroup like the support tree → +1 node).
      const cons = must(engine.consensus(TALLY, c.kind, TALLY.labels));
      const og = must(engine.referenceOutgroup(original));
      const rr = must(engine.rerootOnOutgroup(cons, og));
      expect(svg.querySelectorAll("[data-node]").length).toBe(
        rr.tree.nodes.length,
      );
      // Support labels on the consensus tree's internal branches —
      // zero for the Strict star, which accepted no grouping.
      const labeled = rr.tree.branches.filter(
        (b, i) => rr.tree.nodes[i].parent !== null && b.support !== null,
      ).length;
      expect(
        svg.querySelectorAll(".support-label").length,
      ).toBe(labeled);
      if (c.kind !== "Strict") expect(labeled).toBeGreaterThan(0);
      // Cladogram: every leaf marker shares one x position (tips
      // aligned at the right edge). A leaf group is one whose direct
      // <text> child is a leaf name — support pills nest their text
      // inside g.support, so they never match.
      const leafX = new Set<number>();
      for (const g of Array.from(svg.querySelectorAll("g[data-node]"))) {
        const circle = g.querySelector("circle");
        const directText = Array.from(g.children).find(
          (c) => c.tagName === "text",
        );
        if (circle !== null && directText !== undefined) {
          leafX.add(Number(circle.getAttribute("cx")));
        }
      }
      expect(leafX.size).toBe(1);
    }
  });

  it("NJ + reference: the consensus view is rerooted like the main tree and the toggle still applies", async () => {
    await renderDoneRun(NJ_BASICS);
    fireEvent.click(screen.getByRole("tab", { name: "Majority-rule" }));
    // Same rooted caption as the support view (§6.7 applies to
    // consensus trees of NJ runs too).
    expect(
      screen.getByText(/same outgroup as the reference/),
    ).toBeTruthy();
    const svg = () => document.querySelector(".tree-col svg")!;
    const cons = must(engine.consensus(TALLY, "Majority", TALLY.labels));
    const rr = must(engine.rerootOnOutgroup(cons, ["C"]));
    expect(svg().querySelectorAll("[data-node]").length).toBe(
      rr.tree.nodes.length,
    );
    fireEvent.click(
      screen.getByRole("button", { name: "Show as computed (unrooted)" }),
    );
    expect(svg().querySelectorAll("[data-node]").length).toBe(
      cons.nodes.length,
    );
  });

  it("UPGMA consensus views are already rooted and never rerooted", async () => {
    const ex = makeExercise(TREE4_ROOTED, "Upgma");
    render(<App exercise={ex} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd();
    fireEvent.click(screen.getByRole("button", { name: /Run bootstrap/ }));
    await screen.findByText(/Estimating/);
    const original = loaded(ex).result!.tree;
    const labels = ["A", "B", "C", "D"];
    const tally: BootstrapTally = {
      method: "Upgma",
      labels,
      successful: 50,
      failed: 0,
      counts: [
        { labels: ["A", "B"], count: 40 },
        { labels: ["C", "D"], count: 30 },
      ],
    };
    const consensus = {} as Record<ConsensusKind, Tree>;
    const dropped = {} as Record<ConsensusKind, DroppedGroup[]>;
    for (const kind of ["Majority", "Extended", "Strict"] as const) {
      consensus[kind] = must(engine.consensus(tally, kind, labels));
      dropped[kind] = must(engine.consensusDropped(original, tally, kind));
    }
    act(() => {
      handlers!.onResult({
        tally,
        support: must(engine.supportOnTree(original, tally)),
        consensus,
        dropped,
        failed: 0,
      });
    });
    await screen.findByText(/Run complete/);
    fireEvent.click(screen.getByRole("tab", { name: "Strict" }));
    const svg = await screen.findByRole("img", { name: "Strict consensus" });
    // The drawn tree is the rooted consensus itself — no extra root
    // node, no reroot caption, no toggle.
    expect(svg.querySelectorAll("[data-node]").length).toBe(
      consensus.Strict.nodes.length,
    );
    expect(screen.queryByText(/same outgroup|arbitrary point/)).toBeNull();
    expect(screen.queryByRole("button", { name: /computed|rooted like/ })).toBeNull();
  });

  it("shows 'Dropped from this consensus: …' sorted by support descending, 'None' when empty", async () => {
    await renderDoneRun(NJ_BASICS);
    // Majority keeps {C,D,E} (90/98 > 49), drops {D,E}.
    fireEvent.click(screen.getByRole("tab", { name: "Majority-rule" }));
    expect(
      screen.getByText("Dropped from this consensus: (D, E) 42%."),
    ).toBeTruthy();
    // Strict drops both — higher support first.
    fireEvent.click(screen.getByRole("tab", { name: "Strict" }));
    expect(
      screen.getByText(
        "Dropped from this consensus: (C, D, E) 92%, (D, E) 42%.",
      ),
    ).toBeTruthy();
    // Extended accepts {D,E} too — nothing dropped.
    fireEvent.click(
      screen.getByRole("tab", { name: "Extended majority" }),
    );
    expect(
      screen.getByText("Dropped from this consensus: None."),
    ).toBeTruthy();
    // The support tab carries no dropped list.
    fireEvent.click(
      screen.getByRole("tab", { name: "Your tree with support" }),
    );
    expect(screen.queryByText(/Dropped from this consensus/)).toBeNull();
  });

  it("arrow keys move through enabled tabs and activate them", async () => {
    await renderDoneRun(NJ_BASICS);
    const tab = (name: string) => screen.getByRole("tab", { name });
    const tablist = screen.getByRole("tablist");
    const selected = () =>
      screen.getAllByRole("tab").find(
        (t) => t.getAttribute("aria-selected") === "true",
      )!;
    tab("Your tree with support").focus();
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(selected().textContent).toBe("Majority-rule");
    expect(document.activeElement).toBe(tab("Majority-rule"));
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    expect(selected().textContent).toBe("Extended majority");
    fireEvent.keyDown(tablist, { key: "ArrowLeft" });
    expect(selected().textContent).toBe("Majority-rule");
    fireEvent.keyDown(tablist, { key: "End" });
    expect(selected().textContent).toBe("Strict");
    fireEvent.keyDown(tablist, { key: "Home" });
    expect(selected().textContent).toBe("Your tree with support");
  });

  it("arrow keys skip disabled tabs while no run is done", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd();
    const tablist = screen.getByRole("tablist");
    screen.getByRole("tab", { name: "Your tree with support" }).focus();
    fireEvent.keyDown(tablist, { key: "ArrowRight" });
    // Nothing else is enabled: the support tab stays selected.
    const selected = screen
      .getAllByRole("tab")
      .find((t) => t.getAttribute("aria-selected") === "true")!;
    expect(selected.textContent).toBe("Your tree with support");
    expect(
      screen.getByRole("tab", { name: "Majority-rule" }),
    ).toHaveProperty("disabled", true);
  });

  it("tab clicks dispatch setBootstrapView through the reducer", async () => {
    await renderDoneRun(NJ_BASICS);
    fireEvent.click(screen.getByRole("tab", { name: "Strict" }));
    expect(
      await screen.findByRole("img", { name: "Strict consensus" }),
    ).toBeTruthy();
    fireEvent.click(
      screen.getByRole("tab", { name: "Your tree with support" }),
    );
    // The support view again shows the inferred tree's caption.
    expect(
      await screen.findByRole("img", { name: "Inferred tree" }),
    ).toBeTruthy();
    expect(screen.queryByRole("img", { name: /consensus/ })).toBeNull();
  });
});
