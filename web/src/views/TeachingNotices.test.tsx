// Component tests for TeachingNotices (plan Task 19, spec §6.3). The
// panel is driven by Session state: a SaturatedMatrix error, negative
// branch lengths in the inferred tree, or a nonzero RF split count.
// Sessions are built with the real reducer against the real wasm engine
// (initialized in src/test/setup.ts).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { useState } from "react";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Alignment } from "../engine/generated/Alignment";
import type { Exercise } from "../engine/generated/Exercise";
import type { Session } from "../state/session";
import { exerciseSim, initialSession, reducer } from "../state/session";

import { traceLength } from "./stepMatrix";
import { TeachingNotices } from "./TeachingNotices";
import { engine } from "../engine";

afterEach(cleanup);

// Long branches on a short alignment make every distant pair's observed
// difference exceed the JC69 ceiling (0.75): the distance call succeeds
// and build_tree returns SaturatedMatrix with cells
// [[0,1],[1,2],[1,3],[2,3]] — pairs A–B, B–C, B–D, C–D (verified against
// the wasm build).
const SATURATING: Exercise = {
  schema_version: 2,
  id: "sat",
  title: "Saturation demo",
  alphabet: "dna",
  data: {
    kind: "simulated",
    true_tree: "((A:5,B:5):5,C:5,D:5);",
    sim: { model: "Jc69", length: 10, seed: 1 },
  },
  reference: { newick: "((A:5,B:5):5,C:5,D:5);", kind: "true" },
  analysis: { correction: "Jc69", method: "Nj" },
  locked: [],
  prompts: [],
    bootstrap: null,
};

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

function loaded(ex: Exercise): Session {
  return reducer(initialSession(ex), {
    type: "load",
    exercise: ex,
    source: "lesson",
  });
}

/** Render TeachingNotices around a live session; `holder.s` always
 * reflects the post-dispatch state. */
function renderNotices(initial: Session) {
  const holder = { s: initial };
  function Harness() {
    const [s, setS] = useState(initial);
    holder.s = s;
    return (
      <TeachingNotices
        session={s}
        dispatch={(a) => setS((cur) => reducer(cur, a))}
      />
    );
  }
  render(<Harness />);
  return holder;
}

/** A copy of the session whose inferred tree has one negative branch. */
function withNegativeBranch(s: Session): Session {
  const result = s.result;
  if (result === null) throw new Error("expected a built tree");
  const tree = {
    ...result.tree,
    branches: result.tree.branches.map((b, i) =>
      i === 1 ? { length: -0.05, support: null } : b,
    ),
  };
  return { ...s, result: { ...result, tree } };
}

describe("TeachingNotices — saturation", () => {
  it("shows a panel naming the saturated pairs with the three fixes", () => {
    const s = loaded(SATURATING);
    expect(s.error?.kind).toBe("SaturatedMatrix");
    renderNotices(s);
    expect(screen.getByText(/cannot estimate/i)).toBeTruthy();
    // The pairs come from the error's cell indices through matrix labels.
    expect(screen.getByText(/A–B/)).toBeTruthy();
    expect(screen.getByText(/B–C/)).toBeTruthy();
    expect(screen.getByRole("button", { name: /longer sequences/i }));
    expect(screen.getByRole("button", { name: /shorter branches/i }));
    expect(screen.getByRole("button", { name: /p-distance/i }));
    // The panel carries the p-against-d saturation chart.
    expect(screen.getByRole("img", { name: /asymptote/i })).toBeTruthy();
  });

  it('"Use longer sequences" doubles sim.length', () => {
    const holder = renderNotices(loaded(SATURATING));
    fireEvent.click(screen.getByRole("button", { name: /longer sequences/i }));
    expect(exerciseSim(holder.s.exercise)?.length).toBe(20);
  });

  it('"Use longer sequences" is capped at 10,000', () => {
    const s = loaded(SATURATING);
    const big: Session = {
      ...s,
      exercise:
        s.exercise.data.kind === "simulated"
          ? {
              ...s.exercise,
              data: {
                ...s.exercise.data,
                sim: { ...s.exercise.data.sim, length: 6000 },
              },
            }
          : s.exercise,
    };
    const holder = renderNotices(big);
    fireEvent.click(screen.getByRole("button", { name: /longer sequences/i }));
    expect(exerciseSim(holder.s.exercise)?.length).toBe(10000);
  });

  it('"Use shorter branches" halves branchScale', () => {
    const holder = renderNotices(loaded(SATURATING));
    fireEvent.click(screen.getByRole("button", { name: /shorter branches/i }));
    expect(holder.s.branchScale).toBeCloseTo(0.5);
  });

  it('"Switch to p-distance" changes the correction and clears the error', () => {
    const holder = renderNotices(loaded(SATURATING));
    fireEvent.click(screen.getByRole("button", { name: /p-distance/i }));
    expect(holder.s.exercise.analysis.correction).toBe("P");
    expect(holder.s.error).toBeNull();
  });

  it("a half-working fix reports progress — length and pairs remaining", () => {
    const holder = renderNotices(loaded(SATURATING));
    // SATURATING: len 10 → 20 → 40, all stay saturated (branches 5.0
    // put every distant pair far past the 0.75 ceiling).
    fireEvent.click(screen.getByRole("button", { name: /longer sequences/i }));
    expect(holder.s.error?.kind).toBe("SaturatedMatrix");
    expect(exerciseSim(holder.s.exercise)?.length).toBe(20);
    expect(
      screen.getByText(
        /Still saturated at length 20: \d+ pairs? remains?\. Try again, or choose another fix\./,
      ),
    ).toBeTruthy();
    // A second click updates the progress line, not just the buttons.
    fireEvent.click(screen.getByRole("button", { name: /longer sequences/i }));
    expect(exerciseSim(holder.s.exercise)?.length).toBe(40);
    expect(
      screen.getByText(/Still saturated at length 40:/),
    ).toBeTruthy();
  });

  it('"Use shorter branches" reports the branch scale in the same way', () => {
    const holder = renderNotices(loaded(SATURATING));
    fireEvent.click(screen.getByRole("button", { name: /shorter branches/i }));
    // Halving the 5.0 branches still leaves every pair saturated
    // (verified against the wasm build: 6 pairs).
    expect(holder.s.error?.kind).toBe("SaturatedMatrix");
    expect(
      screen.getByText(
        "Still saturated at branch scale ×0.5: 6 pairs remain. Try again, or choose another fix.",
      ),
    ).toBeTruthy();
  });

  it("the real saturation lesson: one click shows progress, the second builds the tree", () => {
    const raw = readFileSync(
      resolve("..", "exercises", "saturation.json"),
      "utf8",
    );
    const r = engine.loadExercise(raw);
    if (!r.ok) throw new Error("saturation.json failed to load");
    const holder = renderNotices(loaded(r.value));
    // The lesson starts blocked at length 50 (3 saturated pairs).
    expect(holder.s.error?.kind).toBe("SaturatedMatrix");
    // Click 1: 50 → 100. Longer sequences sharpen p but it is still
    // past the ceiling for 4 pairs — the panel says so, at length 100.
    fireEvent.click(screen.getByRole("button", { name: /longer sequences/i }));
    expect(holder.s.error?.kind).toBe("SaturatedMatrix");
    expect(
      screen.getByText(
        "Still saturated at length 100: 4 pairs remain. Try again, or choose another fix.",
      ),
    ).toBeTruthy();
    // Click 2: 100 → 200 — now every pair is under the ceiling and the
    // tree builds; the panel (and its progress line) is gone.
    fireEvent.click(screen.getByRole("button", { name: /longer sequences/i }));
    expect(holder.s.error).toBeNull();
    expect(holder.s.result?.tree).not.toBeNull();
    expect(screen.queryByText(/Still saturated/)).toBeNull();
    expect(screen.queryByText(/cannot estimate/i)).toBeNull();
  });
});

describe("TeachingNotices — imported saturation", () => {
  // Four sequences differing at every site: each pair's observed
  // distance is 1.0, past the 0.75 JC69 ceiling → SaturatedMatrix.
  const SAT4: Alignment = {
    labels: ["T1", "T2", "T3", "T4"],
    seqs: [
      [65, 65, 65, 65, 65, 65, 65, 65], // AAAAAAAA
      [67, 67, 67, 67, 67, 67, 67, 67], // CCCCCCCC
      [71, 71, 71, 71, 71, 71, 71, 71], // GGGGGGGG
      [84, 84, 84, 84, 84, 84, 84, 84], // TTTTTTTT
    ],
    alphabet: "dna",
  };

  it("offers only the p-distance fix — imported data can't be re-simulated", () => {
    const s = reducer(loaded(NJ_BASICS), {
      type: "importAlignment",
      alignment: SAT4,
    });
    expect(s.alignmentOrigin).toBe("imported");
    expect(s.error?.kind).toBe("SaturatedMatrix");
    renderNotices(s);
    expect(
      screen.queryByRole("button", { name: /longer sequences/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /shorter branches/i }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /p-distance/i })).toBeTruthy();
    expect(
      screen.getByText("Your own data can't be re-simulated."),
    ).toBeTruthy();
  });
});

describe("TeachingNotices — embedded saturation", () => {
  // Embedded DNA exercise whose sequences differ at every site: the
  // same all-saturated alignment as the imported case above.
  const EMB_SAT: Exercise = {
    schema_version: 2,
    id: "emb-sat",
    title: "Embedded saturation",
    alphabet: "dna",
    data: {
      kind: "embedded",
      fasta: ">T1\nAAAAAAAA\n>T2\nCCCCCCCC\n>T3\nGGGGGGGG\n>T4\nTTTTTTTT",
      source: { citation: "test", license: "CC0", accessions: [] },
    },
    reference: null,
    analysis: { correction: "Jc69", method: "Nj" },
    locked: [],
    prompts: [],
    bootstrap: null,
  };

  it("embedded_saturation_fixes: offers only the p-distance fix", () => {
    const s = loaded(EMB_SAT);
    expect(s.alignmentOrigin).toBe("embedded");
    expect(s.error?.kind).toBe("SaturatedMatrix");
    renderNotices(s);
    // The re-simulation fixes are hidden — lesson data can't be
    // re-simulated, exactly as for an import.
    expect(
      screen.queryByRole("button", { name: /longer sequences/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /shorter branches/i }),
    ).toBeNull();
    expect(screen.getByRole("button", { name: /p-distance/i })).toBeTruthy();
    expect(
      screen.getByText(
        "This lesson uses real sequences; they can't be re-simulated.",
      ),
    ).toBeTruthy();
  });
});

describe("TeachingNotices — negative branches", () => {
  it("shows the clamp toggle only when a negative branch exists", () => {
    const s = withNegativeBranch(loaded(NJ_BASICS));
    const holder = renderNotices(s);
    expect(screen.getByText(/has a negative branch length/i)).toBeTruthy();
    const toggle = screen.getByRole("switch", {
      name: /negative branches to zero/i,
    });
    expect(toggle.getAttribute("aria-checked")).toBe("false");
    fireEvent.click(toggle);
    expect(holder.s.clampNegative).toBe(true);
  });

  it("shows no notice for an all-positive tree", () => {
    renderNotices(loaded(NJ_BASICS));
    expect(screen.queryByText(/negative branch/i)).toBeNull();
    expect(screen.queryByRole("switch")).toBeNull();
  });
});

describe("TeachingNotices — RF result", () => {
  // The RF notice is a result verdict, so it only renders once the
  // stepper reaches the final position (checkpoint 12): step sessions
  // to the trace end before asserting.
  function atEnd(s: Session): Session {
    const trace = s.result?.trace ?? null;
    return { ...s, step: trace === null ? s.step : traceLength(trace) };
  }

  it('rf = 2 shows "differs … in 1 clade" (rf/2 clades per side)', () => {
    const s: Session = {
      ...atEnd(loaded(NJ_BASICS)),
      rf: {
        rf: 2,
        max_rf: 4,
        normalized: 0.5,
        missing_in_inferred: [{ side: ["A", "B"] }],
        extra_in_inferred: [{ side: ["A", "C"] }],
      },
    };
    renderNotices(s);
    expect(
      screen.getByText(/Your tree differs from the true tree in 1 clade\b/),
    ).toBeTruthy();
  });

  it("stays silent before the final step even when RF > 0", () => {
    // Mid-trace position 0 with a nonzero RF result: the verdict is
    // withheld until the student reaches the end.
    const s: Session = {
      ...loaded(NJ_BASICS),
      step: 0,
      rf: {
        rf: 2,
        max_rf: 4,
        normalized: 0.5,
        missing_in_inferred: [{ side: ["A", "B"] }],
        extra_in_inferred: [{ side: ["A", "C"] }],
      },
    };
    renderNotices(s);
    expect(screen.queryByText(/differs from the true tree/)).toBeNull();
  });

  it("pluralizes and shows no notice when rf = 0", () => {
    const s: Session = {
      ...atEnd(loaded(NJ_BASICS)),
      rf: {
        rf: 4,
        max_rf: 4,
        normalized: 1,
        missing_in_inferred: [{ side: ["A"] }, { side: ["A", "B"] }],
        extra_in_inferred: [{ side: ["C"] }, { side: ["C", "D"] }],
      },
    };
    const { unmount } = render(<HarnessWith s={s} />);
    function HarnessWith({ s }: { s: Session }) {
      return <TeachingNotices session={s} dispatch={() => {}} />;
    }
    expect(
      screen.getByText(/Your tree differs from the true tree in 2 clades/),
    ).toBeTruthy();
    unmount();

    const zero: Session = {
      ...loaded(NJ_BASICS),
      rf: {
        rf: 0,
        max_rf: 4,
        normalized: 0,
        missing_in_inferred: [],
        extra_in_inferred: [],
      },
    };
    renderNotices(zero);
    expect(screen.queryByText(/differs from the true tree/)).toBeNull();
  });

  it("names an accepted classification instead of a true tree (v1.1 Task 10)", () => {
    const s: Session = {
      ...atEnd(loaded(NJ_BASICS)),
      reference: {
        ...loaded(NJ_BASICS).reference!,
        kind: "classification",
      },
      rf: {
        rf: 2,
        max_rf: 4,
        normalized: 0.5,
        missing_in_inferred: [{ side: ["A", "B"] }],
        extra_in_inferred: [{ side: ["A", "C"] }],
      },
    };
    renderNotices(s);
    expect(
      screen.getByText(
        /Your tree differs from the accepted classification in 1 clade\b/,
      ),
    ).toBeTruthy();
  });
});
