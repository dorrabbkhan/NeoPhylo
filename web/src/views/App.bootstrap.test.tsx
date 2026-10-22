// App-level bootstrap wiring tests (v1.2 plan Task 11, spec §5, §6.2,
// §6.3, §6.7). The shared `bootstrapClient` singleton's methods are
// spied: the App effect is the only page code that talks to it, so a
// run is driven by invoking the captured handlers directly.

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

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
import type { ConsensusKind } from "../engine/generated/ConsensusKind";
import type { Exercise } from "../engine/generated/Exercise";
import type { Method } from "../engine/generated/Method";
import type { Tree } from "../engine/generated/Tree";
import { engine } from "../engine/index";
import { initialSession, reducer } from "../state/session";

import { App } from "./App";

afterEach(cleanup);

const TREE5 = "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);";
const TREE4_ROOTED = "((A:0.1,B:0.1):0.05,(C:0.1,D:0.1):0.05);";

function makeExercise(
  newick: string,
  method: Method,
  opts: { locked?: string[]; reference?: string | null } = {},
): Exercise {
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
    reference:
      opts.reference === null
        ? null
        : { newick: opts.reference ?? newick, kind: "true" },
    analysis: { correction: "Jc69", method },
    locked: opts.locked ?? [],
    prompts: [],
    bootstrap: null,
  };
}

const NJ_BASICS = makeExercise(TREE5, "Nj");

function loaded(ex: Exercise) {
  return reducer(initialSession(ex), {
    type: "load",
    exercise: ex,
    source: "lesson",
  });
}

/** Jump the stepper to its final position. */
function stepToEnd(ex: Exercise) {
  const s = loaded(ex);
  const trace = s.result!.trace!;
  const max =
    "Nj" in trace ? trace.Nj.steps.length + 1 : trace.Upgma.steps.length;
  const slider = screen.getByRole("slider");
  fireEvent.change(slider, { target: { value: String(max) } });
  return max;
}

// -- bootstrapClient spies -------------------------------------------------

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

const startSpy = () => vi.mocked(bootstrapClient.start);
const cancelSpy = () => vi.mocked(bootstrapClient.cancel);

/** The inferred tree with `support` set on every internal branch. */
function withSupport(t: Tree, support: number): Tree {
  return {
    ...t,
    branches: t.branches.map((b, i) =>
      t.nodes[i].children.length > 0 && t.nodes[i].parent !== null
        ? { ...b, support }
        : { ...b },
    ),
  };
}

function inferredSvg(): SVGElement {
  const svg = document.querySelector('svg[aria-label="Inferred tree"]');
  if (!svg) throw new Error("inferred svg not found");
  return svg as unknown as SVGElement;
}

describe("bootstrap panel wiring", () => {
  it("shows the panel only at the final stepper position", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    expect(screen.queryByText("How sure are we?")).toBeNull();
    stepToEnd(NJ_BASICS);
    expect(
      screen.getByRole("heading", { name: "How sure are we?" }),
    ).toBeTruthy();
  });

  it("Run starts exactly one client job with the session's settings", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd(NJ_BASICS);
    fireEvent.click(
      screen.getByRole("button", { name: /Run bootstrap/ }),
    );
    await screen.findByText(/Estimating/);
    expect(startSpy()).toHaveBeenCalledTimes(1);
    const params = startSpy().mock.calls[0][0];
    expect(params.method).toBe("Nj");
    expect(params.model).toBe("Jc69");
    expect(params.seed).toBe(1);
    expect(params.replicates).toBe(100);
    expect(params.alignment.labels).toEqual(["A", "B", "C", "D", "E"]);
  });

  it("two quick model changes cancel once and never restart the worker", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd(NJ_BASICS);
    fireEvent.click(
      screen.getByRole("button", { name: /Run bootstrap/ }),
    );
    await screen.findByText(/Estimating/);
    act(() => {
      handlers!.onProgress({
        done: 40,
        total: 100,
        failed: 0,
        etaMs: 400,
        support: withSupport(loaded(NJ_BASICS).result!.tree, 0.8),
      });
    });
    const jobId = nextJobId;
    // Two data/model changes in quick succession (spec §5).
    const correction = screen.getByLabelText("Distance correction");
    fireEvent.change(correction, { target: { value: "K80" } });
    fireEvent.change(correction, { target: { value: "P" } });
    // Still exactly one started job. Let the queued cancel's ack land,
    // then count: exactly one cancel, addressed to job 1, and the
    // worker was never disposed (no restart) while the App is mounted.
    expect(startSpy()).toHaveBeenCalledTimes(1);
    await act(async () => {});
    expect(cancelSpy()).toHaveBeenCalledTimes(1);
    expect(cancelSpy()).toHaveBeenCalledWith(jobId);
    expect(vi.mocked(bootstrapClient.dispose)).not.toHaveBeenCalled();
    // A late result from the cancelled job is stale: nothing lands.
    act(() => {
      const t = withSupport(loaded(NJ_BASICS).result!.tree, 0.8);
      handlers!.onResult({
        tally: {
          method: "Nj",
          labels: ["A", "B", "C", "D", "E"],
          successful: 100,
          failed: 0,
          counts: [],
        },
        support: t,
        consensus: {
          Strict: t,
          Majority: t,
          Extended: t,
        } as Record<ConsensusKind, Tree>,
        dropped: { Strict: [], Majority: [], Extended: [] },
        failed: 0,
      });
    });
    expect(screen.queryByText(/Results for/)).toBeNull();
    expect(inferredSvg().querySelectorAll(".support-label")).toHaveLength(
      0,
    );
  });

  it("a cancel ack for an old job cannot kill a newly requested run", async () => {
    let resolveCancel: () => void = () => {};
    cancelSpy().mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveCancel = r;
        }),
    );
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd(NJ_BASICS);
    fireEvent.click(
      screen.getByRole("button", { name: /Run bootstrap/ }),
    );
    await screen.findByText(/Estimating/);
    act(() => {
      handlers!.onProgress({
        done: 10,
        total: 100,
        failed: 0,
        etaMs: 400,
        support: loaded(NJ_BASICS).result!.tree,
      });
    });
    const firstJob = nextJobId;
    // Model change clears results and queues a cancel for job 1.
    fireEvent.change(screen.getByLabelText("Distance correction"), {
      target: { value: "K80" },
    });
    // Step back to the end and request a second run while job 1's
    // cancel is still pending.
    stepToEnd(NJ_BASICS);
    fireEvent.click(
      screen.getByRole("button", { name: /Run bootstrap/ }),
    );
    expect(startSpy()).toHaveBeenCalledTimes(2);
    // Now the ack for job 1 lands: the new run must survive.
    await act(async () => resolveCancel());
    expect(screen.getByText(/Estimating/)).toBeTruthy();
    act(() => {
      handlers!.onProgress({
        done: 30,
        total: 100,
        failed: 0,
        etaMs: 100,
        support: loaded(NJ_BASICS).result!.tree,
      });
    });
    expect(
      screen.getByText(/Replicate 30 of 100/),
    ).toBeTruthy();
    expect(firstJob).not.toBe(nextJobId);
  });

  it("progress support labels appear at the final step only", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd(NJ_BASICS);
    fireEvent.click(
      screen.getByRole("button", { name: /Run bootstrap/ }),
    );
    await screen.findByText(/Estimating/);
    const supportTree = withSupport(loaded(NJ_BASICS).result!.tree, 0.87);
    act(() => {
      handlers!.onProgress({
        done: 60,
        total: 100,
        failed: 0,
        etaMs: 100,
        support: supportTree,
      });
    });
    const labels = Array.from(
      inferredSvg().querySelectorAll(".support-label"),
    );
    expect(labels.length).toBeGreaterThan(0);
    for (const el of labels) expect(el.textContent).toBe("87");
    // Spoiler rule: stepping away from the final position hides them.
    const slider = screen.getByRole("slider");
    fireEvent.change(slider, { target: { value: "0" } });
    expect(
      inferredSvg().querySelectorAll(".support-label").length,
    ).toBe(0);
  });

  it("announces completion and labels results with the settings used", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd(NJ_BASICS);
    fireEvent.click(
      screen.getByRole("button", { name: /Run bootstrap/ }),
    );
    await screen.findByText(/Estimating/);
    const t = withSupport(loaded(NJ_BASICS).result!.tree, 0.9);
    act(() => {
      handlers!.onResult({
        tally: {
          method: "Nj",
          labels: ["A", "B", "C", "D", "E"],
          successful: 100,
          failed: 0,
          counts: [],
        },
        support: t,
        consensus: {
          Strict: t,
          Majority: t,
          Extended: t,
        },
        dropped: { Strict: [], Majority: [], Extended: [] },
        failed: 0,
      });
    });
    const status = await screen.findByRole("status");
    expect(status.textContent).toContain("Run complete");
    expect(
      screen.getByText("Results for 100 replicates, seed 1."),
    ).toBeTruthy();
  });
});

describe("reference rooting display (spec §6.7)", () => {
  it("draws the NJ tree rerooted on the reference's outgroup with its caption", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd(NJ_BASICS);
    // The reference's outgroup (C, the smallest root-child subtree)
    // is a split of the computed tree, so the caption names it and the
    // drawn tree has one extra node (the new degree-2 root).
    expect(
      screen.getByText(
        "Drawn with the same outgroup as the reference; rerooting " +
          "changes only the drawing, not the groupings.",
      ),
    ).toBeTruthy();
    const s = loaded(NJ_BASICS);
    const og = engine.referenceOutgroup(s.reference!.tree);
    if (!og.ok) throw new Error("referenceOutgroup failed");
    expect(og.value).toEqual(["C"]);
    const rr = engine.rerootOnOutgroup(s.result!.tree, og.value);
    if (!rr.ok) throw new Error("rerootOnOutgroup failed");
    expect(rr.value.outgroup_is_group).toBe(true);
    expect(
      inferredSvg().querySelectorAll("[data-node]").length,
    ).toBe(rr.value.tree.nodes.length);
    // The rerooted drawing has one extra node: the new degree-2 root.
    expect(rr.value.tree.nodes.length).toBe(s.result!.tree.nodes.length + 1);
  });

  // Checkpoint 11: the toggle's label says what a click switches TO,
  // and aria-pressed says which view is on (pressed = rooted like the
  // reference).
  it("the reroot toggle reflects state in its label and aria-pressed", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd(NJ_BASICS);
    // Rooted view is the default: pressed, offering the computed view.
    const toComputed = screen.getByRole("button", {
      name: "Show as computed (unrooted)",
    });
    expect(toComputed.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(toComputed);
    expect(
      screen.getByText(/drawn here from an arbitrary point/),
    ).toBeTruthy();
    // Computed view: unpressed, offering the rooted view back.
    const toRooted = screen.getByRole("button", {
      name: "Show rooted like the reference",
    });
    expect(toRooted.getAttribute("aria-pressed")).toBe("false");
    fireEvent.click(toRooted);
    expect(
      screen.getByText(/same outgroup as the reference/),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Show as computed (unrooted)" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });

  it("no reroot for UPGMA", async () => {
    const ex = makeExercise(TREE4_ROOTED, "Upgma");
    render(<App exercise={ex} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd(ex);
    expect(document.querySelector(".reroot-toggle")).toBeNull();
    expect(screen.queryByText(/same outgroup as the reference/)).toBeNull();
  });

  it("outgroup not a split: caption names the taxon", async () => {
    // Embedded data: NJ groups A with C, so the reference outgroup
    // {A,B} is not a single group in the inferred tree.
    const fasta =
      ">A\nACGTACGTACGT\n>C\nACGTACGTACGA\n>B\nTCGTTCGTACGT\n" +
      ">D\nTCGTTCGTACGA\n>E\nTCGATCGTACGA\n>F\nTCGATCGTACGC\n" +
      ">G\nTCGATGGTACGA";
    const ex: Exercise = {
      schema_version: 2,
      id: "nosplit",
      title: "nosplit",
      alphabet: "dna",
      data: {
        kind: "embedded",
        fasta,
        source: { citation: "t", license: "CC0", accessions: [] },
      },
      reference: {
        newick: "((A:1,B:1):1,(C:1,D:1):1,((E:1,F:1):1,G:1):1);",
        kind: "true",
      },
      analysis: { correction: "Jc69", method: "Nj" },
      locked: [],
      prompts: [],
    bootstrap: null,
    };
    // Premise: the engine agrees {A,B} is not a split of the NJ tree.
    const s = loaded(ex);
    expect(s.result).not.toBeNull();
    const og = engine.referenceOutgroup(s.reference!.tree);
    if (!og.ok) throw new Error("referenceOutgroup failed");
    expect(og.value).toEqual(["A", "B"]);
    const rr = engine.rerootOnOutgroup(s.result!.tree, og.value);
    if (!rr.ok) throw new Error("rerootOnOutgroup failed");
    if (rr.value.outgroup_is_group) {
      throw new Error("test premise failed: {A,B} is a split here");
    }
    render(<App exercise={ex} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd(ex);
    expect(
      screen.getByText(
        "The reference's outgroup isn't a single group in this tree; " +
          "rooted next to A.",
      ),
    ).toBeTruthy();
  });

  // §6.7 review fix: the method — not the presence of a trace — decides
  // the rerooted drawing, so >50 taxa (no trace, no stepper) get it too.
  const SIXTY_LABELS = Array.from({ length: 60 }, (_, i) => `t${i}`);
  const SIXTY_FASTA = SIXTY_LABELS.map((l) => `>${l}\nACGTACGT`).join("\n");

  /** NJ tree of the 60-taxon zero-matrix alignment (no trace: >50). */
  function sixtyTaxonTree(): Tree {
    const aln = engine.parseFasta(SIXTY_FASTA);
    if (!aln.ok) throw new Error("parseFasta failed");
    const m = engine.distances(aln.value, "Jc69");
    if (!m.ok) throw new Error("distances failed");
    const built = engine.buildTree(m.value, "Nj", { trace: false });
    if (!built.ok) throw new Error("buildTree failed");
    return built.value.tree;
  }

  /** Rooted Newick over all 60 labels whose outgroup is a given cherry. */
  function sixtyTaxonReference(og: [string, string]): string {
    const rest = SIXTY_LABELS.filter((l) => l !== og[0] && l !== og[1]);
    let sub = `${rest[rest.length - 1]}:0.1`;
    for (let i = rest.length - 2; i >= 0; i--) {
      sub = `(${rest[i]}:0.1,${sub}):0.1`;
    }
    return `((${og[0]}:0.1,${og[1]}:0.1):0.1,${sub});`;
  }

  /** Sandbox: import the Newick reference, then the matching FASTA. */
  function importReferenceThenAlignment(newick: string) {
    const box = screen.getByLabelText("Paste sequences or a tree");
    fireEvent.change(box, { target: { value: newick } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
    fireEvent.change(box, { target: { value: SIXTY_FASTA } });
    fireEvent.click(screen.getByRole("button", { name: "Import" }));
  }

  it("a 60-taxon sandbox alignment with an imported reference is drawn rerooted", async () => {
    // The reference's outgroup is a cherry of the computed NJ tree, so
    // it is guaranteed a grouping — the "same outgroup" caption shows.
    const inferred = sixtyTaxonTree();
    const cherry = inferred.nodes.find(
      (n) =>
        n.children.length === 2 &&
        n.children.every((c) => inferred.nodes[c].children.length === 0),
    );
    if (cherry === undefined) throw new Error("no cherry in NJ tree");
    const og = cherry.children.map((c) => inferred.nodes[c].label!) as [
      string,
      string,
    ];
    const newick = sixtyTaxonReference(og);

    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    fireEvent.click(screen.getByRole("radio", { name: "Sandbox" }));
    importReferenceThenAlignment(newick);

    // No stepper above 50 taxa — the tree is final as soon as it
    // exists, and it is drawn rerooted on the reference's outgroup.
    expect(screen.queryByRole("slider")).toBeNull();
    const rr = engine.rerootOnOutgroup(inferred, og);
    if (!rr.ok) throw new Error("rerootOnOutgroup failed");
    expect(rr.value.outgroup_is_group).toBe(true);
    expect(
      inferredSvg().querySelectorAll("[data-node]").length,
    ).toBe(rr.value.tree.nodes.length);
    expect(rr.value.tree.nodes.length).toBe(inferred.nodes.length + 1);
    expect(
      await screen.findByText(
        "Drawn with the same outgroup as the reference; rerooting " +
          "changes only the drawing, not the groupings.",
      ),
    ).toBeTruthy();
  });

  // Checkpoint 11: only branch geometry scales — text stays at the
  // same font size in both views, never below the 12 px floor.
  it("labels keep the same font size in the rooted and computed views", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd(NJ_BASICS);
    const leafFont = () => {
      const el = Array.from(
        inferredSvg().querySelectorAll("g[data-node] > text"),
      ).find((t) => t.textContent === "A");
      if (!el) throw new Error("leaf label A not found");
      return el.getAttribute("font-size");
    };
    const rooted = leafFont();
    fireEvent.click(
      screen.getByRole("button", { name: "Show as computed (unrooted)" }),
    );
    const computed = leafFont();
    expect(computed).toBe(rooted);
    expect(Number(computed)).toBeGreaterThanOrEqual(12);
  });

  it("a 60-taxon UPGMA sandbox alignment stays unrerooted", async () => {
    const inferred = sixtyTaxonTree(); // any 60-label tree works here
    const cherry = inferred.nodes.find(
      (n) =>
        n.children.length === 2 &&
        n.children.every((c) => inferred.nodes[c].children.length === 0),
    );
    if (cherry === undefined) throw new Error("no cherry in NJ tree");
    const og = cherry.children.map((c) => inferred.nodes[c].label!) as [
      string,
      string,
    ];

    render(<App exercise={makeExercise(TREE5, "Upgma")} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    fireEvent.click(screen.getByRole("radio", { name: "Sandbox" }));
    importReferenceThenAlignment(sixtyTaxonReference(og));

    // The drawn tree is the computed UPGMA tree itself — no extra
    // degree-2 root, and no reroot caption at all.
    const aln = engine.parseFasta(SIXTY_FASTA);
    if (!aln.ok) throw new Error("parseFasta failed");
    const m = engine.distances(aln.value, "Jc69");
    if (!m.ok) throw new Error("distances failed");
    const built = engine.buildTree(m.value, "Upgma", { trace: false });
    if (!built.ok) throw new Error("buildTree failed");
    expect(
      inferredSvg().querySelectorAll("[data-node]").length,
    ).toBe(built.value.tree.nodes.length);
    expect(screen.queryByText(/same outgroup|arbitrary point/)).toBeNull();
  });
});

// Checkpoint 11: an analysis change with the stepper at its final
// position shows the new tree's final step immediately — bootstrap
// panel visible, stale support labels gone. From a middle position it
// still resets to step 0.
describe("stepper position after an analysis change (checkpoint 11)", () => {
  // The protein-models lesson's own file: 7 taxa, NJ, correction p →
  // JTT, with a predict_pair gate at position 0.
  const proteinModels = (): Exercise => {
    const r = engine.loadExercise(
      readFileSync(
        resolve("..", "exercises", "protein-models.json"),
        "utf8",
      ),
    );
    if (!r.ok) throw new Error("protein-models failed to load");
    return r.value;
  };

  /** Answer the lesson's position-0 predict_pair with the join's
   * chosen pair (indices into the step's active clusters, which are
   * the matrix's row/column indices). */
  function answerGate(ex: Exercise) {
    const s = loaded(ex);
    const t = s.result!.trace!;
    if (!("Nj" in t)) throw new Error("expected an NJ trace");
    const [a, b] = t.Nj.steps[0].chosen;
    const [i, j] = a < b ? [a, b] : [b, a];
    const grid = screen.getByRole("grid", { name: "Distance matrix" });
    const cell = grid.querySelector(`[data-i="${i}"][data-j="${j}"]`);
    if (cell === null) throw new Error(`no cell ${i},${j}`);
    fireEvent.click(cell);
  }

  const stepText = () =>
    document.querySelector(".stepper-status")!.textContent!;

  it("final position: switching p → JTT stays at the new tree's end", async () => {
    const ex = proteinModels();
    render(<App exercise={ex} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    answerGate(ex);
    // 7 taxa → 4 NJ joins + the final three-way join = position 5.
    fireEvent.change(screen.getByRole("slider"), { target: { value: "5" } });
    expect(stepText()).toContain("step 5 of 5");
    expect(
      screen.getByRole("heading", { name: "How sure are we?" }),
    ).toBeTruthy();

    // A finished run's support labels are on screen before the switch.
    fireEvent.click(
      screen.getByRole("button", { name: /Run bootstrap/ }),
    );
    await screen.findByText(/Estimating/);
    act(() => {
      handlers!.onProgress({
        done: 50,
        total: 100,
        failed: 0,
        etaMs: 200,
        support: withSupport(loaded(ex).result!.tree, 0.42),
      });
    });
    expect(
      inferredSvg().querySelectorAll(".support-label").length,
    ).toBeGreaterThan(0);

    fireEvent.change(screen.getByLabelText("Distance correction"), {
      target: { value: "Jtt" },
    });
    // The new tree's final step shows at once: panel back at idle with
    // a Run button, and the old run's labels are gone.
    expect(stepText()).toContain("step 5 of 5");
    expect(
      screen.getByRole("heading", { name: "How sure are we?" }),
    ).toBeTruthy();
    expect(inferredSvg().querySelectorAll(".support-label")).toHaveLength(
      0,
    );
  });

  it("middle position: switching p → JTT resets to step 0", async () => {
    const ex = proteinModels();
    render(<App exercise={ex} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    answerGate(ex);
    fireEvent.change(screen.getByRole("slider"), { target: { value: "2" } });
    expect(stepText()).toContain("step 2 of 5");

    fireEvent.change(screen.getByLabelText("Distance correction"), {
      target: { value: "Jtt" },
    });
    expect(stepText()).toContain("step 0 of 5");
    expect(screen.queryByText("How sure are we?")).toBeNull();
  });
});

// --- predict_branch (v1.2 Task 14, spec §7.1) --------------------------
// An unanswered predict_branch prompt gates the panel's Run button until
// the student clicks an internal branch of the inferred tree; the run's
// verdict names the weakest grouping.

const PREDICT_BRANCH_PROMPT = {
  at_step: 4, // TREE5 (NJ, 5 taxa): position 3 is the final step.
  type: "predict_branch",
  concept: "Before you run, click the internal branch you think the data supports least.",
  math: null,
  reveal: "The weakest grouping sits on the shortest internal branch.",
  reveal_pair: null,
  after: null,
} as const;

/** The exercise with a predict_branch prompt attached. */
const PREDICT_EXERCISE: Exercise = {
  ...NJ_BASICS,
  prompts: [{ ...PREDICT_BRANCH_PROMPT, reveal_pair: null }],
};

/** TREE5's inferred tree with per-split support: keys are the grouping's
 * sorted leaf set ("D,E" for the (D,E) cherry); unlisted internal edges
 * get 0.75. */
function supportTree(supports: Record<string, number>): Tree {
  const t = loaded(NJ_BASICS).result!.tree;
  const sets = leafLabelSetsForTest(t);
  return {
    ...t,
    branches: t.branches.map((b, i) => {
      const node = t.nodes[i];
      if (node.children.length === 0 || node.parent === null) return b;
      const side = [...(sets.get(i) ?? [])].sort().join(",");
      for (const [k, v] of Object.entries(supports)) {
        if (side === k) return { ...b, support: v };
      }
      return { ...b, support: 0.75 };
    }),
  };
}

/** Leaf sets under each node of `t` (test-local; mirrors
 * layout/splitKeys without importing app internals here). */
function leafLabelSetsForTest(t: Tree): Map<number, Set<string>> {
  const sets = new Map<number, Set<string>>();
  const walk = (id: number): Set<string> => {
    const n = t.nodes[id];
    if (n.children.length === 0) {
      const s = new Set(n.label === null ? [] : [n.label]);
      sets.set(id, s);
      return s;
    }
    const u = new Set<string>();
    for (const c of n.children) for (const l of walk(c)) u.add(l);
    sets.set(id, u);
    return u;
  };
  walk(t.root);
  return sets;
}

function result(t: Tree) {
  return {
    tally: {
      method: "Nj" as const,
      labels: ["A", "B", "C", "D", "E"],
      successful: 100,
      failed: 0,
      counts: [],
    },
    support: t,
    consensus: { Strict: t, Majority: t, Extended: t } as Record<
      ConsensusKind,
      Tree
    >,
    dropped: { Strict: [], Majority: [], Extended: [] },
    failed: 0,
  };
}

describe("predict_branch gating and verdict (v1.2 Task 14)", () => {
  it("Run is disabled until an internal branch is clicked; terminal edges don't answer", async () => {
    render(<App exercise={PREDICT_EXERCISE} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd(PREDICT_EXERCISE);

    const run = screen.getByRole("button", { name: /Run bootstrap/ });
    expect((run as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByText(/Click an internal branch/)).toBeTruthy();

    const svg = inferredSvg();
    // Clicking a terminal edge explains it isn't an answer — the prompt
    // stays open and Run stays gated (leaf D's group carries the split
    // key "D").
    const leafHit = svg.querySelector('g[data-split="D"] .branch-hit');
    expect(leafHit).not.toBeNull();
    fireEvent.click(leafHit!);
    expect(
      screen.getByText("Pick a branch that joins two or more taxa."),
    ).toBeTruthy();
    expect((run as HTMLButtonElement).disabled).toBe(true);
    // Clicking the (D,E) internal branch answers the prompt.
    const hit = svg.querySelector('g[data-split="D|E"] .branch-hit');
    expect(hit).not.toBeNull();
    fireEvent.click(hit!);
    expect(
      (screen.getByRole("button", { name: /Run bootstrap/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
    // No support labels before a run — no spoilers.
    expect(svg.querySelectorAll(".support-label")).toHaveLength(0);
  });

  it("after the run the verdict names the weakest grouping", async () => {
    render(<App exercise={PREDICT_EXERCISE} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd(PREDICT_EXERCISE);
    // Pick the (A,B) side — not the weakest.
    fireEvent.click(
      inferredSvg().querySelector('g[data-split="C|D|E"] .branch-hit')!,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Run bootstrap/ }),
    );
    await screen.findByText(/Estimating/);
    act(() => {
      handlers!.onResult(
        result(supportTree({ "A,B": 0.9, "D,E": 0.41 })),
      );
    });
    expect(
      await screen.findByText(
        "Your prediction: Not quite — the weakest group was (D, E) at 41%.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByText(/shortest internal branch/),
    ).toBeTruthy();
  });

  it("a pick within 5 points of the weakest is still Correct", async () => {
    render(<App exercise={PREDICT_EXERCISE} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd(PREDICT_EXERCISE);
    // Pick the (A,B) side (canonical key C|D|E) — at 44 it sits 3
    // points above the weakest (D,E) at 41.
    fireEvent.click(
      inferredSvg().querySelector('g[data-split="C|D|E"] .branch-hit')!,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Run bootstrap/ }),
    );
    await screen.findByText(/Estimating/);
    act(() => {
      handlers!.onResult(
        result(supportTree({ "A,B": 0.44, "D,E": 0.41 })),
      );
    });
    expect(
      await screen.findByText("Your prediction: Correct"),
    ).toBeTruthy();
  });

  it("the verdict is locked after the first completed run", async () => {
    render(<App exercise={PREDICT_EXERCISE} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd(PREDICT_EXERCISE);
    fireEvent.click(
      inferredSvg().querySelector('g[data-split="C|D|E"] .branch-hit')!,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /Run bootstrap/ }),
    );
    await screen.findByText(/Estimating/);
    act(() => {
      handlers!.onResult(
        result(supportTree({ "D,E": 0.41 })),
      );
    });
    const text =
      "Your prediction: Not quite — the weakest group was (D, E) at 41%.";
    expect(await screen.findByText(text)).toBeTruthy();

    // A rerun whose results would rescore the SAME pick as Correct —
    // the picked grouping becomes the weakest — must not change the
    // locked verdict.
    act(() => {
      handlers!.onResult(
        result(supportTree({ "C,D,E": 0.3 })),
      );
    });
    expect(await screen.findByText(text)).toBeTruthy();
    expect(
      screen.queryByText("Your prediction: Correct"),
    ).toBeNull();
  });
});
