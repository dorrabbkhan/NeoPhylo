// "Watch one replicate" panel tests (v1.2 plan Task 13, spec §6.5).
// Panel-level tests drive ReplicatePanel directly with real engine
// `replicate_detail` results; the run-side wiring (open button, the
// >2 s worker route) is covered through App with the shared
// `bootstrapClient` spied, as in App.bootstrap.test.tsx.

import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { engine } from "../engine/index";
import type { Result } from "../engine/index";
import {
  bootstrapClient,
} from "../engine/bootstrapClient";
import type {
  BootstrapHandlers,
  ReplicateDetailHandlers,
} from "../engine/bootstrapProtocol";
import type { Alignment } from "../engine/generated/Alignment";
import type { ConsensusKind } from "../engine/generated/ConsensusKind";
import type { Exercise } from "../engine/generated/Exercise";
import type { Method } from "../engine/generated/Method";
import type { ReplicateDetail } from "../engine/generated/ReplicateDetail";
import type { Tree } from "../engine/generated/Tree";
import { initialSession, reducer } from "../state/session";
import type { Session } from "../state/session";

import { App } from "./App";
import { BootstrapPanel } from "./BootstrapPanel";
import { ReplicatePanel } from "./ReplicatePanel";
import type { ReplicatePanelProps } from "./ReplicatePanel";
import { leafLabelSets, sameSet } from "./stepEmphasis";

afterEach(cleanup);

const TREE5 = "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);";

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
  };
}

const NJ_BASICS = makeExercise(TREE5, "Nj");

function loaded(ex: Exercise = NJ_BASICS): Session {
  return reducer(initialSession(ex), {
    type: "load",
    exercise: ex,
    source: "lesson",
  });
}

function tree(newick: string): Tree {
  const r = engine.parseNewick(newick);
  if (!r.ok) throw new Error("parseNewick failed");
  return r.value;
}

const ALN: Alignment = loaded().alignment!;

function detail(i: number, aln: Alignment = ALN): Result<ReplicateDetail> {
  return engine.replicateDetail(aln, "Jc69", "Nj", 1, i);
}

/** The first replicate index whose tree differs from the original. */
function differingIndex(): number {
  for (let i = 0; i < 20; i++) {
    const d = detail(i);
    if (d.ok && !d.value.failed && d.value.differing.length > 0) return i;
  }
  throw new Error("no differing replicate in the first 20");
}

function props(over: Partial<ReplicatePanelProps> = {}): ReplicatePanelProps {
  return {
    method: "Nj",
    taxa: ALN.labels,
    index: 0,
    total: 100,
    detail: detail(0),
    original: loaded().result!.tree,
    outgroup: null,
    onNavigate: vi.fn(),
    onClose: vi.fn(),
    ...over,
  };
}

/* ---- orientation + difference wording helpers (checkpoint fixes) ---- */

const UPGMA_BASICS = makeExercise(TREE5, "Upgma");
const ALN_UPGMA: Alignment = loaded(UPGMA_BASICS).alignment!;

function upgmaDetail(i: number): Result<ReplicateDetail> {
  return engine.replicateDetail(ALN_UPGMA, "Jc69", "Upgma", 1, i);
}

/** Leaf labels of a drawn tree svg, top to bottom. Leaf names are the
 * only classless <text> directly under a node group. */
function leafOrder(svg: Element): (string | null)[] {
  return Array.from(svg.querySelectorAll("g[data-node] > text"))
    .filter((t) => t.getAttribute("class") === null)
    .sort(
      (a, b) =>
        parseFloat(a.getAttribute("y")!) -
        parseFloat(b.getAttribute("y")!),
    )
    .map((t) => t.textContent);
}

/** How many of `differing` appear in `tree` — checked independently of
 * the panel's own bookkeeping (exact side for rooted clusters, side or
 * complement for unrooted splits). */
function missingCount(
  tree: Tree,
  differing: string[][],
  taxa: string[],
  rooted: boolean,
): number {
  const sets = leafLabelSets(tree);
  const all = new Set(taxa);
  let n = 0;
  for (const side of differing) {
    const s = new Set(side);
    for (const [id, labs] of sets) {
      if (tree.nodes[id].children.length === 0) continue;
      if (sameSet(labs, s)) {
        n += 1;
        break;
      }
      if (!rooted) {
        const comp = new Set([...all].filter((l) => !s.has(l)));
        if (sameSet(labs, comp)) {
          n += 1;
          break;
        }
      }
    }
  }
  return n;
}

/** A replicate detail claiming the same groupings as the original,
 * but parsed from a differently-oriented newick — same unrooted NJ
 * topology as TREE5 with the root flipped and children reordered. */
function sameGroupingsDetail(): Result<ReplicateDetail> {
  const d = detail(0);
  if (!d.ok) throw new Error("replicate_detail failed");
  return {
    ok: true,
    value: {
      ...d.value,
      tree: tree("(C:0.3,(D:0.1,E:0.15):0.1,(A:0.1,B:0.2):0.05);"),
      rf_to_original: 0,
      differing: [],
    },
  };
}

/* ---- panel: navigation, strip, undrawn line, trees, failures ---- */

describe("ReplicatePanel", () => {
  it("titles the dialog 'Replicate k of N' and bounds Previous/Next", () => {
    const p = props();
    const { unmount } = render(<ReplicatePanel {...p} />);
    expect(
      screen.getByRole("heading", { name: "Replicate 1 of 100" }),
    ).toBeTruthy();
    const prev = screen.getByRole("button", { name: "Previous" });
    const next = screen.getByRole("button", { name: "Next" });
    expect(prev).toHaveProperty("disabled", true);
    expect(next).toHaveProperty("disabled", false);
    fireEvent.click(next);
    expect(p.onNavigate).toHaveBeenCalledWith(1);
    unmount();

    render(<ReplicatePanel {...props({ index: 99 })} />);
    expect(
      screen.getByRole("heading", { name: "Replicate 100 of 100" }),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Next" }),
    ).toHaveProperty("disabled", true);
    fireEvent.click(screen.getByRole("button", { name: "Previous" }));
    expect(p.onNavigate).toHaveBeenCalledTimes(1);
  });

  it("shows each column's draw count, with 0s dimmed via data-weight", () => {
    const d = detail(0);
    if (!d.ok) throw new Error("replicate_detail failed");
    const { container } = render(<ReplicatePanel {...props({ detail: d })} />);
    const cols = container.querySelectorAll<HTMLElement>("[data-weight]");
    expect(cols.length).toBe(d.value.weights.length);
    const dimmed = container.querySelectorAll('[data-weight="0"]');
    expect(dimmed.length).toBe(d.value.undrawn);
    for (const c of cols) {
      expect(c.textContent).toBe(c.getAttribute("data-weight"));
    }
  });

  it("reports 'U of L columns not drawn (≈ 37% expected)'", () => {
    const d = detail(0);
    if (!d.ok) throw new Error("replicate_detail failed");
    render(<ReplicatePanel {...props({ detail: d })} />);
    expect(
      screen.getByText(
        `${d.value.undrawn} of ${d.value.weights.length} columns not drawn (≈ 37% expected)`,
      ),
    ).toBeTruthy();
  });

  it("draws the replicate tree beside the original and outlines every differing grouping", () => {
    const i = differingIndex();
    const d = detail(i);
    if (!d.ok || d.value.tree === null) throw new Error("expected a tree");
    const { container } = render(
      <ReplicatePanel {...props({ index: i, detail: d })} />,
    );
    expect(
      screen.getByRole("img", { name: `Replicate ${i + 1}` }),
    ).toBeTruthy();
    expect(screen.getByRole("img", { name: "Your tree" })).toBeTruthy();
    // Each differing grouping exists in exactly one of the two trees,
    // so it is outlined exactly once — the same dotted outline as the
    // wrong-clade marks.
    expect(container.querySelectorAll("g.wrong").length).toBe(
      d.value.differing.length,
    );
    // NJ unrooted splits differ symmetrically: the count in your tree
    // equals the count appearing instead (M = K / 2).
    const missing = missingCount(
      loaded().result!.tree,
      d.value.differing,
      ALN.labels,
      false,
    );
    expect(missing).toBe(d.value.differing.length / 2);
    expect(
      screen.getByText(
        `${missing} of your tree's groupings are missing here, and ${missing} different ones appear instead.`,
      ),
    ).toBeTruthy();
  });

  // Owner review: for NJ (unrooted, fully resolved) the count line
  // must read missing == extra == rf/2 across the run — and the
  // outlined groupings are exactly the counted ones on each tree.
  it("missing == extra == rf/2 and outlines == counts over 20 seeded replicates", () => {
    let seen = 0;
    for (let i = 0; i < 20; i++) {
      const d = detail(i);
      if (!d.ok || d.value.failed || d.value.differing.length === 0) {
        continue;
      }
      seen += 1;
      const { unmount } = render(
        <ReplicatePanel {...props({ index: i, detail: d })} />,
      );
      const half = d.value.differing.length / 2;
      expect(
        screen.getByText(
          `${half} of your tree's groupings are missing here, and ${half} different ones appear instead.`,
        ),
      ).toBeTruthy();
      const repSvg = screen.getByRole("img", {
        name: `Replicate ${i + 1}`,
      });
      const origSvg = screen.getByRole("img", { name: "Your tree" });
      // Outlines equal the counts on each side.
      expect(repSvg.querySelectorAll("g.wrong").length).toBe(half);
      expect(origSvg.querySelectorAll("g.wrong").length).toBe(half);
      unmount();
    }
    expect(seen).toBeGreaterThan(0);
  });

  // Owner review: both panel trees render at the same scale factor
  // (1:1 — the natural-size svg) and the same font sizes, never one
  // zoomed and the other shrunk.
  it("the replicate tree and 'Your tree' share one scale factor and font sizes", () => {
    const i = differingIndex();
    const d = detail(i);
    render(<ReplicatePanel {...props({ index: i, detail: d })} />);
    const scale = (svg: Element) => {
      const vb = svg.getAttribute("viewBox")!.split(" ").map(Number);
      return {
        x: Number(svg.getAttribute("width")) / vb[2],
        y: Number(svg.getAttribute("height")) / vb[3],
      };
    };
    const repSvg = screen.getByRole("img", { name: `Replicate ${i + 1}` });
    const origSvg = screen.getByRole("img", { name: "Your tree" });
    expect(scale(repSvg)).toEqual(scale(origSvg));
    const fonts = (svg: Element) =>
      [...svg.querySelectorAll("text")]
        .map((t) => t.getAttribute("font-size"))
        .sort();
    expect(fonts(repSvg)).toEqual(fonts(origSvg));
    // Every label — leaf names, node names, support labels — at or
    // above the 12px floor in BOTH trees.
    for (const svg of [repSvg, origSvg]) {
      for (const t of svg.querySelectorAll("text")) {
        expect(Number(t.getAttribute("font-size"))).toBeGreaterThanOrEqual(
          12,
        );
      }
    }
    expect(screen.getAllByRole("img")).toHaveLength(2);
  });

  it("a replicate with the same groupings says so and draws in the original's orientation", () => {
    // Same unrooted topology as the original, but the parser produced
    // it with a different root placement and child order — the panel
    // must orient it like "Your tree".
    const d = sameGroupingsDetail();
    render(<ReplicatePanel {...props({ detail: d })} />);
    expect(
      screen.getByText(
        "This replicate's tree has the same groupings as your tree.",
      ),
    ).toBeTruthy();
    const rep = screen.getByRole("img", { name: "Replicate 1" });
    const orig = screen.getByRole("img", { name: "Your tree" });
    expect(leafOrder(rep)).toEqual(leafOrder(orig));
  });

  it("wording counts missing and extra UPGMA clusters against your tree", () => {
    const s = loaded(UPGMA_BASICS);
    let i = 0;
    let d = upgmaDetail(i);
    while (
      i < 50 &&
      (!d.ok || d.value.failed || d.value.differing.length === 0)
    ) {
      i += 1;
      d = upgmaDetail(i);
    }
    if (!d.ok || d.value.differing.length === 0) {
      throw new Error("no differing UPGMA replicate in the first 50");
    }
    render(
      <ReplicatePanel
        {...props({
          method: "Upgma",
          taxa: ALN_UPGMA.labels,
          index: i,
          detail: d,
          original: s.result!.tree,
        })}
      />,
    );
    const missing = missingCount(
      s.result!.tree,
      d.value.differing,
      ALN_UPGMA.labels,
      true,
    );
    const extra = d.value.differing.length - missing;
    expect(
      screen.getByText(
        `${missing} of your tree's groupings are missing here, and ${extra} different ones appear instead.`,
      ),
    ).toBeTruthy();
  });

  it("a failed replicate says it was skipped", () => {
    // Every column holds all four bases, so every pair is saturated.
    const parsed = engine.parseFasta(
      ">A\nACGTAC\n>B\nCGTACG\n>C\nGTACGT\n>D\nTACGTA",
    );
    if (!parsed.ok) throw new Error("saturated alignment failed to parse");
    const d = engine.replicateDetail(parsed.value, "Jc69", "Nj", 1, 0);
    if (!d.ok) throw new Error("replicate_detail failed");
    expect(d.value.failed).toBe(true);
    render(
      <ReplicatePanel
        {...props({ detail: d, taxa: parsed.value.labels })}
      />,
    );
    expect(
      screen.getByText("This replicate was skipped (saturated)."),
    ).toBeTruthy();
    expect(screen.queryByRole("img", { name: /Replicate/ })).toBeNull();
  });

  it("keyboard: ←/→ change the replicate (bounded), Esc closes", () => {
    const p = props({ index: 2 });
    render(<ReplicatePanel {...p} />);
    const dialog = screen.getByRole("dialog");
    fireEvent.keyDown(dialog, { key: "ArrowRight" });
    expect(p.onNavigate).toHaveBeenCalledWith(3);
    fireEvent.keyDown(dialog, { key: "ArrowLeft" });
    expect(p.onNavigate).toHaveBeenCalledWith(1);
    fireEvent.keyDown(dialog, { key: "Escape" });
    expect(p.onClose).toHaveBeenCalled();
  });

  it("clamps keyboard navigation at the bounds", () => {
    const p = props({ index: 0, total: 10 });
    const { unmount } = render(<ReplicatePanel {...p} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowLeft" });
    expect(p.onNavigate).toHaveBeenCalledWith(0);
    unmount();
    const q = props({ index: 9, total: 10 });
    render(<ReplicatePanel {...q} />);
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "ArrowRight" });
    expect(q.onNavigate).toHaveBeenCalledWith(9);
  });

  it("a pending worker detail shows a computing status", () => {
    render(<ReplicatePanel {...props({ detail: null })} />);
    expect(screen.getByRole("status").textContent).toContain(
      "Computing replicate 1",
    );
  });
});

/* ---- the BootstrapPanel entry point ---- */

describe("BootstrapPanel 'Watch one replicate'", () => {
  /** A finished 100-replicate run. */
  function done(): Session {
    let s = reducer(loaded(), { type: "bootstrapRequested", jobId: 7 });
    s = reducer(s, {
      type: "bootstrapEstimated",
      jobId: 7,
      msPerReplicate: 5,
      totalMs: 500,
    });
    const t = tree(TREE5);
    return reducer(s, {
      type: "bootstrapDone",
      jobId: 7,
      result: {
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
      },
    });
  }

  it("shows the button once a run has results and opens at replicate 1", () => {
    const dispatch = vi.fn();
    const { unmount } = render(
      <BootstrapPanel session={loaded()} dispatch={dispatch} />,
    );
    expect(
      screen.queryByRole("button", { name: /Watch one replicate/ }),
    ).toBeNull();
    unmount();

    render(<BootstrapPanel session={done()} dispatch={dispatch} />);
    fireEvent.click(
      screen.getByRole("button", { name: /Watch one replicate/ }),
    );
    expect(dispatch).toHaveBeenCalledWith({
      type: "setReplicateIndex",
      index: 0,
    });
  });
});

/* ---- App wiring: open, draw, worker routing ---- */

let runHandlers: BootstrapHandlers | undefined;
let detailHandlers: ReplicateDetailHandlers | undefined;
let nextJobId: number;

beforeEach(() => {
  runHandlers = undefined;
  detailHandlers = undefined;
  nextJobId = 0;
  vi.spyOn(bootstrapClient, "start").mockImplementation((_p, h) => {
    runHandlers = h;
    return ++nextJobId;
  });
  vi.spyOn(bootstrapClient, "detail").mockImplementation((_p, h) => {
    detailHandlers = h;
    return ++nextJobId;
  });
  vi.spyOn(bootstrapClient, "cancel").mockResolvedValue(undefined);
  vi.spyOn(bootstrapClient, "confirm").mockImplementation(() => {});
  vi.spyOn(bootstrapClient, "dispose").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

const detailSpy = () => vi.mocked(bootstrapClient.detail);

function stepToEnd() {
  const s = loaded();
  const trace = s.result!.trace!;
  const max =
    "Nj" in trace ? trace.Nj.steps.length + 1 : trace.Upgma.steps.length;
  fireEvent.change(screen.getByRole("slider"), {
    target: { value: String(max) },
  });
}

function doneResult(): Parameters<
  NonNullable<typeof runHandlers>["onResult"]
>[0] {
  const t = tree(TREE5);
  return {
    tally: {
      method: "Nj",
      labels: ["A", "B", "C", "D", "E"],
      successful: 100,
      failed: 0,
      counts: [],
    },
    support: t,
    consensus: { Strict: t, Majority: t, Extended: t },
    dropped: { Strict: [], Majority: [], Extended: [] },
    failed: 0,
  };
}

describe("App 'Watch one replicate'", () => {
  // Owner review: with a consensus tab selected, "Your tree" must
  // still be the COMPUTED tree — a collapsed consensus made the count
  // read "0 of your tree's groupings are missing here, and N
  // different ones appear instead" while the replicate showed
  // outlines. The panel compares the same unrooted split sets the
  // engine used for `differing`, never the displayed consensus.
  it("the Strict-consensus view does not feed the count: missing == extra == rf/2", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd();
    fireEvent.click(screen.getByRole("button", { name: /Run bootstrap/ }));
    await screen.findByText(/Estimating/);
    act(() =>
      runHandlers!.onEstimate({ msPerReplicate: 5, totalMs: 500 }),
    );
    const star = tree("(A:0.1,B:0.1,C:0.1,D:0.1,E:0.1);");
    const r = doneResult();
    act(() =>
      runHandlers!.onResult({
        ...r,
        consensus: { Strict: star, Majority: r.support, Extended: r.support },
      }),
    );
    // The displayed tree is now the collapsed strict consensus.
    fireEvent.click(screen.getByRole("tab", { name: "Strict" }));
    fireEvent.click(
      await screen.findByRole("button", { name: /Watch one replicate/ }),
    );
    // Navigate to the first differing replicate.
    const i = differingIndex();
    const next = screen.getByRole("button", { name: "Next" });
    for (let j = 0; j < i; j++) fireEvent.click(next);
    expect(
      await screen.findByText(
        "1 of your tree's groupings are missing here, and 1 different ones appear instead.",
      ),
    ).toBeTruthy();
    // "Your tree" draws the computed support tree — the differing
    // grouping is outlined on it too.
    const orig = screen.getByRole("img", { name: "Your tree" });
    expect(orig.querySelectorAll("g.wrong").length).toBe(1);
  });

  it("opens at replicate 1 and computes the detail on the main thread when the estimate is small", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd();
    fireEvent.click(screen.getByRole("button", { name: /Run bootstrap/ }));
    await screen.findByText(/Estimating/);
    act(() =>
      runHandlers!.onEstimate({ msPerReplicate: 5, totalMs: 500 }),
    );
    act(() => runHandlers!.onResult(doneResult()));
    fireEvent.click(
      await screen.findByRole("button", { name: /Watch one replicate/ }),
    );
    expect(
      await screen.findByRole("heading", { name: "Replicate 1 of 100" }),
    ).toBeTruthy();
    // A fast replicate never leaves the main thread (spec §6.5).
    expect(detailSpy()).not.toHaveBeenCalled();
    // Strip, undrawn line and both trees — the original rooted like the
    // reference (the app's default toggle state for NJ + reference).
    const dialog = screen.getByRole("dialog");
    expect(dialog.querySelectorAll("[data-weight]").length).toBe(
      ALN.seqs[0].length,
    );
    expect(dialog.textContent).toContain("columns not drawn");
    expect(
      screen.getByRole("img", { name: "Replicate 1" }),
    ).toBeTruthy();
    expect(screen.getByRole("img", { name: "Your tree" })).toBeTruthy();
  });

  it("an estimate over 2 s routes the detail through the worker as a one-replicate job", async () => {
    render(<App exercise={NJ_BASICS} />);
    await screen.findByRole("img", { name: "Inferred tree" });
    stepToEnd();
    fireEvent.click(screen.getByRole("button", { name: /Run bootstrap/ }));
    await screen.findByText(/Estimating/);
    // A 3 s/replicate estimate needs the confirm gate anyway.
    act(() =>
      runHandlers!.onEstimate({ msPerReplicate: 3000, totalMs: 300_000 }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    act(() => runHandlers!.onResult(doneResult()));
    fireEvent.click(
      await screen.findByRole("button", { name: /Watch one replicate/ }),
    );
    expect(detailSpy()).toHaveBeenCalledTimes(1);
    const params = detailSpy().mock.calls[0][0];
    expect(params.index).toBe(0);
    expect(params.seed).toBe(1);
    expect(params.method).toBe("Nj");
    // Until the worker answers, the panel reports progress.
    expect(await screen.findByText("Computing replicate 1…")).toBeTruthy();
    const d = detail(0);
    if (!d.ok) throw new Error("replicate_detail failed");
    act(() => detailHandlers!.onDetail(d.value));
    expect(
      await screen.findByRole("img", { name: "Replicate 1" }),
    ).toBeTruthy();
  });
});
