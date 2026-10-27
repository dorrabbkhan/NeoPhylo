// "How sure are we?" panel tests (v1.2 plan Task 11, spec §6.2, §6.6).
// The panel is a pure view over Session.bootstrap; states are driven
// through the real reducer and a dispatch spy or a stateful harness.

import { useState } from "react";
import type { Dispatch } from "react";

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { engine } from "../engine/index";
import type { BootstrapTally } from "../engine/generated/BootstrapTally";
import type { ConsensusKind } from "../engine/generated/ConsensusKind";
import type { Exercise } from "../engine/generated/Exercise";
import type { Method } from "../engine/generated/Method";
import type { Tree } from "../engine/generated/Tree";

import {
  initialSession,
  reducer,
} from "../state/session";
import type { Action, Session } from "../state/session";

import { BootstrapPanel } from "./BootstrapPanel";

afterEach(cleanup);

const TREE5 = "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);";
const TREE3 = "(A:0.1,B:0.2,C:0.3);";
const TREE4 = "(A:0.1,B:0.2,(C:0.15,D:0.1):0.08);";
const TREE3_ROOTED = "((A:0.1,B:0.2):0.05,C:0.15);";
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
      sim: { model: "Jc69", length: 200, seed: 42 },
    },
    reference: { newick, kind: "true" },
    analysis: { correction: "Jc69", method },
    locked: [],
    prompts: [],
    bootstrap: null,
  };
}

function loaded(method: Method = "Nj", newick = TREE5): Session {
  const ex = makeExercise(newick, method);
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

const TALLY: BootstrapTally = {
  method: "Nj",
  labels: ["A", "B", "C", "D", "E"],
  successful: 98,
  failed: 2,
  counts: [
    { labels: ["A", "B"], count: 90 },
    { labels: ["D", "E"], count: 41 },
  ],
};

function consensus(): Record<ConsensusKind, Tree> {
  const t = tree(TREE5);
  return { Strict: t, Majority: t, Extended: t };
}

/** A session with job 7 in flight, at the given progress. */
function running(patch: {
  done?: number;
  total?: number;
  failed?: number;
  etaMs?: number;
} = {}): Session {
  let s = reducer(loaded(), { type: "bootstrapRequested", jobId: 7 });
  s = reducer(s, {
    type: "bootstrapProgress",
    jobId: 7,
    done: patch.done ?? 40,
    total: patch.total ?? 100,
    failed: patch.failed ?? 0,
    etaMs: patch.etaMs ?? 4000,
    support: tree(TREE5),
  });
  return s;
}

/** A session with a finished 100-replicate run (98 used, 2 skipped). */
function done(): Session {
  return reducer(running(), {
    type: "bootstrapDone",
    jobId: 7,
    result: {
      tally: TALLY,
      support: tree(TREE5),
      consensus: consensus(),
      dropped: { Strict: [], Majority: [], Extended: [] },
      failed: 2,
    },
  });
}

/** Stateful wrapper: panel actions run through the real reducer. */
function Harness({
  initial,
  runGated = false,
}: {
  initial: Session;
  runGated?: boolean;
}) {
  const [s, setS] = useState(initial);
  const dispatch: Dispatch<Action> = (a) =>
    setS((cur) => reducer(cur, a));
  return (
    <div className="controls">
      <BootstrapPanel session={s} dispatch={dispatch} runGated={runGated} />
    </div>
  );
}

describe("BootstrapPanel", () => {
  it("renders the panel heading and the grouping-count line", () => {
    render(<Harness initial={loaded()} />);
    expect(
      screen.getByRole("heading", { name: "How sure are we?" }),
    ).toBeTruthy();
    // NJ on 5 taxa: an unrooted binary tree has n−3 = 2 groupings.
    expect(
      screen.getByText(
        "With 5 taxa, an unrooted tree has 2 groupings to test.",
      ),
    ).toBeTruthy();
  });

  it("idle shows the exact §6.8 line, gone once a run starts", () => {
    render(<Harness initial={loaded()} />);
    expect(
      screen.getByText(
        "Run the bootstrap to see how strongly the data supports each grouping.",
      ),
    ).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Run bootstrap/ }));
    expect(
      screen.queryByText(
        "Run the bootstrap to see how strongly the data supports each grouping.",
      ),
    ).toBeNull();
  });

  // Review Focus 1: tiny trees get an explanation instead of an empty
  // result or an error. Method-aware: unrooted n−3, rooted n−2.
  it("NJ, 3 taxa: '0 groupings to test', Run disabled, no error", () => {
    render(<Harness initial={loaded("Nj", TREE3)} />);
    expect(
      screen.getByText(
        "With 3 taxa, an unrooted tree has 0 groupings to test.",
      ),
    ).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /Run bootstrap/ }),
    ).toHaveProperty("disabled", true);
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("NJ, 4 taxa: '1 grouping to test', no error", () => {
    render(<Harness initial={loaded("Nj", TREE4)} />);
    expect(
      screen.getByText(
        "With 4 taxa, an unrooted tree has 1 grouping to test.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("UPGMA, 3 taxa: a rooted tree has 1 grouping to test", () => {
    render(<Harness initial={loaded("Upgma", TREE3_ROOTED)} />);
    expect(
      screen.getByText("With 3 taxa, a rooted tree has 1 grouping to test."),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("UPGMA, 4 taxa: a rooted tree has 2 groupings to test", () => {
    render(<Harness initial={loaded("Upgma", TREE4_ROOTED)} />);
    expect(
      screen.getByText(
        "With 4 taxa, a rooted tree has 2 groupings to test.",
      ),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("clamps replicates to 10–1,000 (out-of-range input never commits)", () => {
    const dispatch = vi.fn();
    render(<BootstrapPanel session={loaded()} dispatch={dispatch} />);
    const field = screen.getByLabelText("Replicates");
    expect(field.getAttribute("min")).toBe("10");
    expect(field.getAttribute("max")).toBe("1000");
    fireEvent.change(field, { target: { value: "5" } });
    fireEvent.change(field, { target: { value: "5000" } });
    expect(dispatch).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "setBootstrapSettings" }),
    );
    fireEvent.change(field, { target: { value: "250" } });
    expect(dispatch).toHaveBeenCalledWith({
      type: "setBootstrapSettings",
      patch: { replicates: 250 },
    });
  });

  it("Run dispatches bootstrapRequested; estimating shows and Cancel works", () => {
    render(<Harness initial={loaded()} />);
    fireEvent.click(screen.getByRole("button", { name: /Run bootstrap/ }));
    expect(screen.getByText(/Estimating/)).toBeTruthy();
    // Cancel while estimating routes through bootstrapCancelRequested.
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText(/Cancelled/)).toBeTruthy();
  });

  it("running: progressbar with aria-valuenow and 'Replicate k of N · about T left'", () => {
    render(<Harness initial={running({ done: 40, total: 100, etaMs: 4000 })} />);
    const bar = screen.getByRole("progressbar");
    expect(bar.getAttribute("aria-valuenow")).toBe("40");
    expect(bar.getAttribute("aria-valuemax")).toBe("100");
    expect(
      screen.getByText("Replicate 40 of 100 · about 4 s left"),
    ).toBeTruthy();
  });

  it("shows the skipped line when F > 0 and the saturation warning over 10%", () => {
    render(
      <Harness
        initial={running({ done: 100, total: 100, failed: 3 })}
      />,
    );
    expect(
      screen.getByText("3 replicates skipped (saturated)"),
    ).toBeTruthy();
    expect(
      screen.queryByText(/close to saturation/),
    ).toBeNull();
    cleanup();
    render(
      <Harness
        initial={running({ done: 100, total: 100, failed: 15 })}
      />,
    );
    expect(
      screen.getByText(
        "The data is close to saturation; support is based on fewer replicates.",
      ),
    ).toBeTruthy();
  });

  it("BootstrapFailed renders the friendly error", () => {
    const s = reducer(running(), {
      type: "bootstrapFailed",
      jobId: 7,
      error: { kind: "BootstrapFailed", failed: 100, total: 100 },
    });
    render(<Harness initial={s} />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain("Every bootstrap replicate failed");
    expect(alert.textContent).toContain("p-distance");
  });

  it("done: completion is announced in an aria-live region", () => {
    render(<Harness initial={done()} />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain(
      "Run complete: 98 of 100 replicates counted.",
    );
  });

  // Review Focus 3: results stay visible after a settings change but are
  // labeled with the settings they were produced with.
  it("labels stale results: 'Results for 100 replicates, seed 1; settings changed, run again to update.'", () => {
    render(<Harness initial={done()} />);
    expect(
      screen.getByText("Results for 100 replicates, seed 1."),
    ).toBeTruthy();
    fireEvent.change(screen.getByLabelText("Replicates"), {
      target: { value: "200" },
    });
    expect(
      screen.getByText(
        "Results for 100 replicates, seed 1; settings changed, run again to update.",
      ),
    ).toBeTruthy();
  });

  it("confirming over-budget runs ask to Start and can be cancelled", () => {
    let s = reducer(loaded(), { type: "bootstrapRequested", jobId: 9 });
    s = reducer(s, {
      type: "bootstrapEstimated",
      jobId: 9,
      msPerReplicate: 1200,
      totalMs: 120_000,
    });
    const dispatch = vi.fn((a: Action) => a);
    render(<BootstrapPanel session={s} dispatch={dispatch} />);
    expect(screen.getByText(/This will take about/)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Start" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "bootstrapConfirmed",
      jobId: 9,
    });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(dispatch).toHaveBeenCalledWith({
      type: "bootstrapCancelRequested",
    });
  });

  it("concept mode shows the §6.6 wording; math mode renders formulas", async () => {
    render(<Harness initial={loaded()} />);
    expect(
      screen.getByText(/87 means this group appeared in 87 of 100/),
    ).toBeTruthy();
    cleanup();
    const s = reducer(loaded(), { type: "setMode", mode: "math" });
    const { container } = render(<Harness initial={s} />);
    // KaTeX renders into elements with class .katex once the lazy chunk
    // resolves (spec §7.2).
    await waitFor(() =>
      expect(container.querySelectorAll(".katex").length).toBeGreaterThan(0),
    );
  });
});

describe("locked bootstrap settings (v1.4 Task 12 pack 3, fix round 1)", () => {
  // The panel honours exercise.locked the way Controls does: a listed
  // path renders its input disabled with the "Fixed for this lesson."
  // tooltip. App passes [] in the sandbox, so unlocked stays as today.
  it("locked bootstrap.replicates and bootstrap.seed render both inputs non-editable", () => {
    const dispatch = vi.fn();
    render(
      <BootstrapPanel
        session={loaded()}
        dispatch={dispatch}
        locked={["bootstrap.replicates", "bootstrap.seed"]}
      />,
    );
    for (const name of ["Replicates", "Seed"]) {
      const field = screen.getByLabelText(name);
      expect(field).toHaveProperty("disabled", true);
      expect(field.getAttribute("title")).toBe("Fixed for this lesson.");
    }
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("an unlocked lesson leaves both inputs editable, unchanged", () => {
    render(<Harness initial={loaded()} />);
    for (const name of ["Replicates", "Seed"]) {
      const field = screen.getByLabelText(name);
      expect(field).toHaveProperty("disabled", false);
      expect(field.getAttribute("title")).toBeNull();
    }
    fireEvent.change(screen.getByLabelText("Replicates"), {
      target: { value: "250" },
    });
    expect(screen.getByLabelText("Replicates")).toHaveProperty(
      "value",
      "250",
    );
  });
});

describe("predict_branch gating (v1.2 Task 14)", () => {
  it("Run is disabled while an unanswered predict_branch prompt gates it", () => {
    render(<Harness initial={loaded()} runGated />);
    expect(
      (screen.getByRole("button", { name: /Run bootstrap/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("Run is enabled once the gate clears", () => {
    render(<Harness initial={loaded()} runGated={false} />);
    expect(
      (screen.getByRole("button", { name: /Run bootstrap/ }) as HTMLButtonElement)
        .disabled,
    ).toBe(false);
  });
});
