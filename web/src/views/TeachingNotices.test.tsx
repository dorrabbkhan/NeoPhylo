// Component tests for TeachingNotices (plan Task 19, spec §6.3). The
// panel is driven by Session state: a SaturatedMatrix error, negative
// branch lengths in the inferred tree, or a nonzero RF split count.
// Sessions are built with the real reducer against the real wasm engine
// (initialized in src/test/setup.ts).

import { useState } from "react";

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import type { Exercise } from "../engine/generated/Exercise";
import type { Session } from "../state/session";
import { initialSession, reducer } from "../state/session";

import { TeachingNotices } from "./TeachingNotices";

afterEach(cleanup);

// Long branches on a short alignment make every distant pair's observed
// difference exceed the JC69 ceiling (0.75): the distance call succeeds
// and build_tree returns SaturatedMatrix with cells
// [[0,1],[1,2],[1,3],[2,3]] — pairs A–B, B–C, B–D, C–D (verified against
// the wasm build).
const SATURATING: Exercise = {
  schema_version: 1,
  id: "sat",
  title: "Saturation demo",
  true_tree: "((A:5,B:5):5,C:5,D:5);",
  sim: { model: "Jc69", length: 10, seed: 1 },
  analysis: { correction: "Jc69", method: "Nj" },
  locked: [],
  prompts: [],
};

const NJ_BASICS: Exercise = {
  schema_version: 1,
  id: "nj-basics",
  title: "How Neighbor-Joining works",
  true_tree: "((A:0.1,B:0.2):0.05,C:0.3,(D:0.1,E:0.15):0.1);",
  sim: { model: "Jc69", length: 1000, seed: 42 },
  analysis: { correction: "Jc69", method: "Nj" },
  locked: [],
  prompts: [],
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
      i === 1 ? { length: -0.05 } : b,
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
    expect(holder.s.exercise.sim.length).toBe(20);
  });

  it('"Use longer sequences" is capped at 10,000', () => {
    const s = loaded(SATURATING);
    const big: Session = {
      ...s,
      exercise: {
        ...s.exercise,
        sim: { ...s.exercise.sim, length: 6000 },
      },
    };
    const holder = renderNotices(big);
    fireEvent.click(screen.getByRole("button", { name: /longer sequences/i }));
    expect(holder.s.exercise.sim.length).toBe(10000);
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
  it('rf = 2 shows "differs … in 1 clade" (rf/2 clades per side)', () => {
    const s: Session = {
      ...loaded(NJ_BASICS),
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

  it("pluralizes and shows no notice when rf = 0", () => {
    const s: Session = {
      ...loaded(NJ_BASICS),
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
});
